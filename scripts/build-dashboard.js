'use strict';

/**
 * Builds the static status page from the run files on the data branch.
 *   node scripts/build-dashboard.js [--results-dir DIR] [--out DIR]
 *
 * Output (all static, no external requests at view time):
 *   index.html, app.js, chart.umd.min.js (copied from node_modules/chart.js), data.js (window.MONITOR_DATA)
 *
 * With no results yet (first deploy, or the data branch does not exist), it still builds a page
 * that says so, instead of failing the job.
 */
const fs = require('node:fs');
const path = require('node:path');
const { readRuns } = require('../src/utils/results-store');
const { SITES } = require('../src/config/sites');

const DAY = 24 * 60 * 60 * 1000;
const HISTORY_RUNS = 28; // 7 days at 4 runs a day
const RECENT_PROBLEMS = 20;

function parseArgs(argv) {
  const args = { resultsDir: 'results-local/results', out: 'site' };
  for (let i = 0; i < argv.length; i += 2) {
    if (argv[i] === '--results-dir') args.resultsDir = argv[i + 1];
    else if (argv[i] === '--out') args.out = argv[i + 1];
    else throw new Error(`unknown argument ${argv[i]}`);
  }
  return args;
}

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

/**
 * Uptime = pass runs / runs that measured the site. "error" runs are a problem in the monitor,
 * not in the site, so they are left out of both sides.
 */
function uptime(points, sinceMs) {
  const measured = points.filter((p) => Date.parse(p.timestamp) >= sinceMs && p.status !== 'error');
  if (!measured.length) return { percent: null, runs: 0 };
  const passed = measured.filter((p) => p.status === 'pass').length;
  return { percent: Math.round((passed / measured.length) * 1000) / 10, runs: measured.length };
}

function summarise(runs, now) {
  const sites = SITES.map(({ id, name, journey, url }) => {
    const points = [];
    for (const run of runs) {
      const r = run.results.find((x) => x.site === id);
      if (!r) continue;
      points.push({
        timestamp: run.timestamp,
        runUrl: run.ci && run.ci.runUrl,
        status: r.status,
        flaky: Boolean(r.flaky),
        durationMs: r.durationMs,
        failingStep: r.failingStep ? `${r.failingStep.name}: ${r.failingStep.error}` : null,
        meta: r.meta || {},
      });
    }
    const last30 = points.filter((p) => Date.parse(p.timestamp) >= now - 30 * DAY);
    const passDurations = last30.filter((p) => p.status === 'pass').map((p) => p.durationMs).sort((a, b) => a - b);
    const latest = points[points.length - 1] || null;
    return {
      id, name, journey, url,
      latest,
      lastPass: [...points].reverse().find((p) => p.status === 'pass') || null,
      uptime7d: uptime(points, now - 7 * DAY),
      uptime30d: uptime(points, now - 30 * DAY),
      latencyP50: percentile(passDurations, 50),
      latencyP95: percentile(passDurations, 95),
      flaky30d: last30.filter((p) => p.flaky).length,
      history: points.slice(-HISTORY_RUNS),
      series: last30.map((p) => ({ t: p.timestamp, ms: p.status === 'pass' ? p.durationMs : null, status: p.status, flaky: p.flaky })),
    };
  });

  const problems = [];
  for (const run of runs) {
    for (const r of run.results) {
      if (r.status !== 'pass' || r.flaky) {
        problems.push({
          timestamp: run.timestamp,
          runUrl: run.ci && run.ci.runUrl,
          site: r.siteName || r.site,
          status: r.status,
          flaky: Boolean(r.flaky),
          detail: r.failingStep
            ? `${r.failingStep.name}: ${r.failingStep.error}`
            : (r.attempts && r.attempts[0] && r.attempts[0].failingStep ? `attempt 1 ${r.attempts[0].status} at ${r.attempts[0].failingStep.name}: ${r.attempts[0].failingStep.error}` : ''),
        });
      }
    }
  }

  return {
    generatedAt: new Date(now).toISOString(),
    runCount: runs.length,
    firstRun: runs.length ? runs[0].timestamp : null,
    lastRun: runs.length ? runs[runs.length - 1].timestamp : null,
    sites,
    problems: problems.reverse().slice(0, RECENT_PROBLEMS),
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const { runs, skipped } = readRuns(args.resultsDir);
  for (const f of skipped) console.warn(`skipped unreadable run file ${f}`);

  const data = summarise(runs, Date.now());
  const root = path.join(__dirname, '..');
  fs.rmSync(args.out, { recursive: true, force: true });
  fs.mkdirSync(args.out, { recursive: true });
  fs.copyFileSync(path.join(root, 'dashboard', 'index.html'), path.join(args.out, 'index.html'));
  fs.copyFileSync(path.join(root, 'dashboard', 'app.js'), path.join(args.out, 'app.js'));
  fs.copyFileSync(path.join(root, 'node_modules', 'chart.js', 'dist', 'chart.umd.min.js'), path.join(args.out, 'chart.umd.min.js'));
  // Escape "<" so no value from a run file can close the script tag.
  fs.writeFileSync(path.join(args.out, 'data.js'), `window.MONITOR_DATA = ${JSON.stringify(data).replace(/</g, '\\u003c')};\n`);
  fs.writeFileSync(path.join(args.out, '.nojekyll'), '');

  console.log(`dashboard built in ${path.normalize(args.out)} from ${runs.length} run(s)${runs.length ? ` (${data.firstRun} to ${data.lastRun})` : ' (no results yet)'}`);
}

main();
