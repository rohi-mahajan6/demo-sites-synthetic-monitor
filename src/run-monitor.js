'use strict';

/**
 * Entry point.
 *   node src/run-monitor.js [--results-dir DIR] [--state-file FILE] [--artifacts-dir DIR] [--site ID]
 *
 * 1. Load credentials (.env locally, repository secrets in CI).
 * 2. Run each site's journey one after another in one headless Chromium, with one retry after 30 s.
 * 3. Write one JSON file for the run (schema v1).
 * 4. Update the alert state, then open, comment on or close GitHub Issues and send Telegram messages.
 *
 * Exit codes: 0 = run recorded (sites being down is data, not a monitor failure);
 * 1 = the monitor could not record a run; 2 = run recorded but an alert could not be delivered.
 */
require('dotenv').config({ quiet: true });

const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');

const { SITES, TIMEOUTS, RETRY_DELAY_MS } = require('./config/sites');
const { STATUS, MonitorConfigError, shortError } = require('./utils/status');
const { runAttempt } = require('./utils/journey-runner');
const { withRetry } = require('./utils/retry');
const { SCHEMA_VERSION, writeRun, readJson, writeJson } = require('./utils/results-store');
const { applyAlerts } = require('./utils/alerting');
const githubIssues = require('./utils/github-issues');
const telegram = require('./utils/telegram');

function parseArgs(argv) {
  const args = {
    resultsDir: 'results-local/results',
    stateFile: 'results-local/state.json',
    artifactsDir: 'artifacts',
    site: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const [key, value] = [argv[i], argv[i + 1]];
    if (key === '--results-dir') args.resultsDir = value;
    else if (key === '--state-file') args.stateFile = value;
    else if (key === '--artifacts-dir') args.artifactsDir = value;
    else if (key === '--site') args.site = value;
    else throw new Error(`unknown argument ${key}`);
    i += 1;
  }
  return args;
}

function credentialsFor(site) {
  const username = process.env[site.credentials.username];
  const password = process.env[site.credentials.password];
  const missing = Object.values(site.credentials).filter((name) => !process.env[name]);
  return { username, password, missing };
}

async function runSite(browser, site, artifactsDir) {
  const creds = credentialsFor(site);
  const runOnce = async (attempt) => {
    if (creds.missing.length) {
      return {
        status: STATUS.ERROR,
        durationMs: 0,
        failingStep: { name: 'setup', index: -1, error: new MonitorConfigError(`missing ${creds.missing.join(', ')}`).message, httpStatus: null },
        steps: [],
        meta: {},
        artifacts: [],
        configError: true,
      };
    }
    return runAttempt({
      browser,
      site,
      check: site.check(),
      credentials: { username: creds.username, password: creds.password },
      timeouts: TIMEOUTS,
      attempt,
      artifactsDir,
    });
  };

  const { final, attempts, flaky } = await withRetry(runOnce, {
    delayMs: RETRY_DELAY_MS,
    shouldRetry: (r) => !r.configError,
    onRetry: (r) => console.log(`  ${site.id}: attempt 1 ${r.status} (${r.failingStep && r.failingStep.error}); retrying in ${RETRY_DELAY_MS / 1000} s`),
  });

  return {
    site: site.id,
    siteName: site.name,
    journey: site.journey,
    url: site.url,
    status: final.status,
    durationMs: final.durationMs,
    attempts: attempts.map((a, i) => ({
      attempt: i + 1,
      status: a.status,
      durationMs: a.durationMs,
      failingStep: a.failingStep,
    })),
    flaky,
    failingStep: final.failingStep,
    steps: final.steps,
    meta: final.meta,
    artifacts: attempts.flatMap((a) => a.artifacts),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const sites = args.site ? SITES.filter((s) => s.id === args.site) : SITES;
  if (!sites.length) throw new Error(`no site with id "${args.site}"`);

  const timestamp = new Date().toISOString();
  const inCi = process.env.GITHUB_ACTIONS === 'true';
  const run = {
    schemaVersion: SCHEMA_VERSION,
    runId: process.env.GITHUB_RUN_ID || `local-${timestamp.replace(/[:.]/g, '-')}`,
    timestamp,
    trigger: process.env.GITHUB_EVENT_NAME || 'local',
    ci: {
      runUrl: inCi ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` : null,
      runner: inCi ? `${process.env.RUNNER_OS || 'unknown'} (GitHub Actions)` : `${os.platform()} (local)`,
    },
    results: [],
  };

  const browser = await chromium.launch({ headless: true });
  try {
    // One site at a time, never in parallel: these are shared public demos.
    for (const site of sites) {
      console.log(`${site.id}: ${site.journey}`);
      let result;
      try {
        result = await runSite(browser, site, args.artifactsDir);
      } catch (err) {
        // A crash inside the runner is a monitor problem, recorded as error for this site only.
        result = {
          site: site.id, siteName: site.name, journey: site.journey, url: site.url,
          status: STATUS.ERROR, durationMs: 0, attempts: [], flaky: false,
          failingStep: { name: 'runner', index: -1, error: shortError(err), httpStatus: null },
          steps: [], meta: {}, artifacts: [],
        };
      }
      run.results.push(result);
      const detail = result.failingStep ? ` at "${result.failingStep.name}": ${result.failingStep.error}` : '';
      console.log(`  ${site.id}: ${result.status}${result.flaky ? ' (flaky)' : ''} in ${result.durationMs} ms${detail}`);
    }
  } finally {
    await browser.close().catch(() => {});
  }

  const file = writeRun(args.resultsDir, run);
  console.log(`results written to ${path.normalize(file)}`);

  const github = githubIssues.createClient({ token: process.env.GITHUB_TOKEN, repository: process.env.GITHUB_REPOSITORY });
  const tg = telegram.createClient({ token: process.env.TELEGRAM_BOT_TOKEN, chatId: process.env.TELEGRAM_CHAT_ID });
  if (inCi && !github) console.log('::warning::GITHUB_TOKEN or GITHUB_REPOSITORY missing; alerts are only logged.');

  const previousState = readJson(args.stateFile, { sites: {} });
  const { state, failures } = await applyAlerts({ run, state: previousState, github, telegram: tg });
  writeJson(args.stateFile, state);

  if (failures.length) {
    for (const f of failures) console.log(`${inCi ? '::error::' : ''}alert delivery failed: ${f}`);
    process.exitCode = 2;
  }
}

main().catch((err) => {
  console.error(`run-monitor: ${err.stack || err}`);
  process.exitCode = 1;
});
