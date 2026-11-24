'use strict';

const { STATUS } = require('./status');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Runs an attempt, and once more after delayMs if it did not pass.
 * Both attempts are kept. The final status is the last attempt's status;
 * a pass on the retry is reported as pass with flaky: true.
 *
 * shouldRetry(result) lets the caller skip the retry (for example on a missing credential).
 */
async function withRetry(runOnce, { delayMs, shouldRetry = () => true, onRetry = () => {} }) {
  const attempts = [];
  const first = await runOnce(1);
  attempts.push(first);

  if (first.status !== STATUS.PASS && shouldRetry(first)) {
    onRetry(first);
    await sleep(delayMs);
    attempts.push(await runOnce(2));
  }

  const final = attempts[attempts.length - 1];
  return {
    final,
    attempts,
    flaky: attempts.length > 1 && final.status === STATUS.PASS,
  };
}

module.exports = { withRetry, sleep };
