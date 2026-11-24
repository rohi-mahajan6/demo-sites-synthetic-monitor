'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { STATUS, UnavailableError, JourneyFailure, classifyError, shortError } = require('./status');

/**
 * Runs one attempt of a site's journey in a fresh browser context and returns
 * { status, durationMs, failingStep, steps, meta, artifacts }.
 *
 * The check receives a small toolkit:
 *   step(name, fn)    times a named step and records it
 *   goto(url, opts)   navigation that turns network errors, 5xx and timeouts into "unavailable"
 *   apiGet(url, opts) GET through the browser's request context, with the same mapping
 *   expect(cond, msg) throws a JourneyFailure when cond is falsy
 *   meta              object copied into the result (versions, counts)
 */
async function runAttempt({ browser, site, check, credentials, timeouts, attempt, artifactsDir }) {
  const steps = [];
  const meta = {};
  const artifacts = [];
  let failingStep = null;
  let currentStep = null;
  let navigated = false;

  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  context.setDefaultTimeout(timeouts.elementMs);
  context.setDefaultNavigationTimeout(timeouts.navigationMs);
  await context.tracing.start({ screenshots: true, snapshots: true });
  const page = await context.newPage();

  const toUnavailableOnNetwork = (err, what) => {
    if (classifyError(err) === STATUS.UNAVAILABLE) throw new UnavailableError(`${what}: ${shortError(err)}`);
    throw err;
  };

  const tools = {
    page,
    credentials,
    timeouts,
    meta,
    expect(condition, message) {
      if (!condition) throw new JourneyFailure(message);
    },
    async step(name, fn) {
      const started = Date.now();
      currentStep = { name, index: steps.length };
      try {
        const value = await fn();
        steps.push({ name, status: STATUS.PASS, durationMs: Date.now() - started });
        return value;
      } catch (err) {
        steps.push({ name, status: classifyError(err), durationMs: Date.now() - started });
        throw err;
      }
    },
    async goto(url, options = {}) {
      const first = !navigated;
      navigated = true;
      let response;
      try {
        response = await page.goto(url, { waitUntil: 'domcontentloaded', ...options });
      } catch (err) {
        // A timeout on the very first navigation means the site did not answer at all.
        if (first && err.name === 'TimeoutError') throw new UnavailableError(`no response from ${url} within ${timeouts.navigationMs} ms`);
        toUnavailableOnNetwork(err, `navigation to ${url}`);
      }
      const status = response ? response.status() : null;
      if (status !== null && status >= 500) throw new UnavailableError(`${url} answered HTTP ${status}`, status);
      if (status !== null && status >= 400) throw new JourneyFailure(`${url} answered HTTP ${status}`, status);
      return response;
    },
    async apiGet(url, options = {}) {
      let response;
      try {
        response = await page.request.get(url, { timeout: timeouts.navigationMs, ...options });
      } catch (err) {
        if (err.name === 'TimeoutError') throw new UnavailableError(`no response from ${url} within ${timeouts.navigationMs} ms`);
        toUnavailableOnNetwork(err, `request to ${url}`);
      }
      const status = response.status();
      if (status >= 500) throw new UnavailableError(`${url} answered HTTP ${status}`, status);
      return response;
    },
  };

  const started = Date.now();
  let status = STATUS.PASS;
  let timer;
  try {
    const journey = Promise.resolve().then(() => check.run(tools));
    journey.catch(() => {}); // if the overall timeout wins, the abandoned journey must not crash the process
    const overall = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new JourneyFailure(`journey did not finish within ${timeouts.journeyMs} ms`)), timeouts.journeyMs);
    });
    await Promise.race([journey, overall]);
  } catch (err) {
    status = classifyError(err);
    failingStep = {
      name: currentStep ? currentStep.name : 'setup',
      index: currentStep ? currentStep.index : -1,
      error: shortError(err),
      httpStatus: err.httpStatus || null,
    };
  } finally {
    clearTimeout(timer);
  }
  const durationMs = Date.now() - started;

  // Keep evidence only for attempts that did not pass.
  if (status !== STATUS.PASS && artifactsDir) {
    const dir = path.join(artifactsDir, site.id);
    fs.mkdirSync(dir, { recursive: true });
    const shot = path.join(dir, `attempt-${attempt}.png`);
    const trace = path.join(dir, `attempt-${attempt}-trace.zip`);
    try {
      await page.screenshot({ path: shot, fullPage: true, timeout: 10_000 });
      artifacts.push(path.relative(artifactsDir, shot).split(path.sep).join('/'));
    } catch { /* page may be gone; the trace still has the last snapshot */ }
    try {
      await context.tracing.stop({ path: trace });
      artifacts.push(path.relative(artifactsDir, trace).split(path.sep).join('/'));
    } catch { /* ignore */ }
  } else {
    await context.tracing.stop().catch(() => {});
  }
  await context.close().catch(() => {});

  return { status, durationMs, failingStep, steps, meta, artifacts };
}

module.exports = { runAttempt };
