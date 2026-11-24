'use strict';

const { STATUS } = require('./status');

/**
 * Alert rules agreed in step 1:
 * - fail or error: alert after 2 consecutive non-pass runs for the same site.
 * - unavailable: alert after 3 consecutive unavailable runs (18 hours at 4 runs a day).
 * - An open issue is closed only when the site returns to pass. Unavailable never closes it.
 * - While an issue is open, a change of status (for example fail -> unavailable) adds one comment;
 *   repeating the same status adds nothing, so a long outage does not produce a comment every 6 hours.
 *
 * Pure function: given the stored state for one site and this run's result, returns the next state
 * and the actions to take. The caller performs the actions and keeps issueNumber in sync.
 */
const FAIL_THRESHOLD = 2;
const UNAVAILABLE_THRESHOLD = 3;

function emptySiteState() {
  return { lastStatus: null, nonPassStreak: 0, unavailableStreak: 0, issueNumber: null, alertedStatus: null };
}

function decide(previous, status) {
  const state = { ...emptySiteState(), ...(previous || {}) };
  const actions = [];

  if (status === STATUS.PASS) {
    if (state.issueNumber) actions.push({ type: 'close', issueNumber: state.issueNumber, previousStatus: state.alertedStatus });
    return {
      state: { ...state, lastStatus: status, nonPassStreak: 0, unavailableStreak: 0, alertedStatus: null },
      actions,
    };
  }

  state.nonPassStreak += 1;
  state.unavailableStreak = status === STATUS.UNAVAILABLE ? state.unavailableStreak + 1 : 0;
  state.lastStatus = status;

  if (state.issueNumber) {
    if (status !== state.alertedStatus) {
      actions.push({ type: 'comment', issueNumber: state.issueNumber, previousStatus: state.alertedStatus });
      state.alertedStatus = status;
    }
    return { state, actions };
  }

  const reached =
    status === STATUS.UNAVAILABLE
      ? state.unavailableStreak >= UNAVAILABLE_THRESHOLD
      : state.nonPassStreak >= FAIL_THRESHOLD;
  if (reached) {
    actions.push({ type: 'open' });
    state.alertedStatus = status;
  }
  return { state, actions };
}

module.exports = { decide, emptySiteState, FAIL_THRESHOLD, UNAVAILABLE_THRESHOLD };
