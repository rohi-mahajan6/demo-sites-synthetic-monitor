'use strict';

/**
 * Result classification: pass | fail | unavailable | error.
 * - unavailable: DNS/TLS/connection failure, HTTP 5xx, or a timeout on the first navigation.
 *   The site (or the network to it) is down; the journey itself may be fine.
 * - fail: the site answered, but a journey step did not see what it expected
 *   (assertion failed, element missing within its wait, page changed).
 * - error: a problem in the monitor itself (missing credential, browser failed to start, code bug).
 */
const STATUS = Object.freeze({
  PASS: 'pass',
  FAIL: 'fail',
  UNAVAILABLE: 'unavailable',
  ERROR: 'error',
});

/** The site could not be reached, or answered with a server error. */
class UnavailableError extends Error {
  constructor(message, httpStatus = null) {
    super(message);
    this.name = 'UnavailableError';
    this.httpStatus = httpStatus;
  }
}

/** The site answered, but not with what the journey expects. */
class JourneyFailure extends Error {
  constructor(message, httpStatus = null) {
    super(message);
    this.name = 'JourneyFailure';
    this.httpStatus = httpStatus;
  }
}

/** The monitor is misconfigured (for example a missing credential). Not retried. */
class MonitorConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'MonitorConfigError';
  }
}

// Network-level failures reported by Chromium (net::ERR_*) and by Node (request context).
const NETWORK_ERROR = /net::ERR_|ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|EHOSTUNREACH|socket hang up|getaddrinfo/i;
// Errors thrown by Playwright APIs start with the API name, for example "locator.click: Timeout 15000ms exceeded".
const PLAYWRIGHT_API_ERROR = /^(page|locator|frame|elementHandle|apiRequestContext|browserContext)\.\w+:/;

/** Maps an error thrown by a journey to a status. */
function classifyError(err) {
  if (err instanceof UnavailableError) return STATUS.UNAVAILABLE;
  if (err instanceof JourneyFailure) return STATUS.FAIL;
  if (err instanceof MonitorConfigError) return STATUS.ERROR;
  const message = String((err && err.message) || err);
  if (NETWORK_ERROR.test(message)) return STATUS.UNAVAILABLE;
  if ((err && err.name === 'TimeoutError') || PLAYWRIGHT_API_ERROR.test(message)) return STATUS.FAIL;
  return STATUS.ERROR;
}

/** First line of an error message, trimmed, without Playwright's call log. */
function shortError(err) {
  const message = String((err && err.message) || err);
  return message.split('\n')[0].trim().slice(0, 300);
}

module.exports = { STATUS, UnavailableError, JourneyFailure, MonitorConfigError, classifyError, shortError };
