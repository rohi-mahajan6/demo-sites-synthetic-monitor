'use strict';

const { decide, emptySiteState } = require('./alert-state');

/**
 * Applies the alert rules to one run: updates per-site state, and opens, comments on or closes
 * GitHub Issues and sends Telegram messages. Without a GitHub client the actions are only logged
 * (local runs), and the state does not pretend an issue exists.
 *
 * A failed delivery never loses the result: the run file is already written. The state is adjusted
 * so the action is tried again on the next run, and the failure is returned to the caller.
 */
const STATUS_TEXT = {
  fail: 'failing',
  error: 'erroring (monitor problem)',
  unavailable: 'unavailable',
};

function describe(result) {
  const lines = [
    `Site: ${result.siteName} (${result.url})`,
    `Journey: ${result.journey}`,
    `Status: ${result.status}${result.attempts.length > 1 ? ` (after ${result.attempts.length} attempts)` : ''}`,
  ];
  if (result.failingStep) {
    lines.push(`Failing step: ${result.failingStep.index + 1}. ${result.failingStep.name}`);
    lines.push(`Error: ${result.failingStep.error}`);
    if (result.failingStep.httpStatus) lines.push(`HTTP status: ${result.failingStep.httpStatus}`);
  }
  return lines;
}

function issueBody(result, run, siteState) {
  return [
    ...describe(result).map((l) => `- ${l}`),
    `- Consecutive non-pass runs: ${siteState.nonPassStreak}`,
    `- First seen in this alert: ${run.timestamp}`,
    run.ci.runUrl ? `- Run: ${run.ci.runUrl}` : null,
    '',
    'Screenshots and traces of failed attempts are attached to the run as the "failure-evidence" artifact.',
    'This issue closes automatically when the journey passes again. An unavailable result never closes it.',
  ].filter((l) => l !== null).join('\n');
}

async function applyAlerts({ run, state, github, telegram, log = console.log }) {
  const failures = [];
  const nextState = { ...state, sites: { ...(state.sites || {}) } };

  const notify = async (text) => {
    if (!telegram) return;
    try {
      await telegram.send(text);
    } catch (err) {
      failures.push(err.message);
    }
  };

  for (const result of run.results) {
    const previous = nextState.sites[result.site] || emptySiteState();
    const { state: siteState, actions } = decide(previous, result.status);
    const label = `${result.siteName} ${result.journey}`;

    for (const action of actions) {
      if (!github) {
        log(`[alert] ${action.type} for ${label} (no GitHub token: logged only)`);
        // Keep the state honest: no issue was really opened or closed.
        if (action.type === 'open') siteState.alertedStatus = null;
        continue;
      }
      try {
        if (action.type === 'open') {
          const existing = await github.findOpenIssue(result.site);
          if (existing) {
            siteState.issueNumber = existing;
            await github.comment(existing, `Still not passing as of ${run.timestamp}.\n\n${describe(result).map((l) => `- ${l}`).join('\n')}`);
            log(`[alert] reused open issue #${existing} for ${label}`);
          } else {
            const title = `[monitor] ${label} is ${STATUS_TEXT[result.status] || result.status}`;
            const issue = await github.open(result.site, title, issueBody(result, run, siteState));
            siteState.issueNumber = issue.number;
            log(`[alert] opened issue #${issue.number} for ${label}`);
            await notify(`ALERT: ${label} is ${result.status}\n${describe(result).slice(2).join('\n')}\n${issue.url}`);
          }
        } else if (action.type === 'comment') {
          await github.comment(action.issueNumber, `Status changed from ${action.previousStatus} to ${result.status} at ${run.timestamp}.\n\n${describe(result).map((l) => `- ${l}`).join('\n')}${run.ci.runUrl ? `\n- Run: ${run.ci.runUrl}` : ''}`);
          log(`[alert] commented on issue #${action.issueNumber} for ${label}`);
        } else if (action.type === 'close') {
          await github.close(action.issueNumber, `Passing again at ${run.timestamp} (${result.durationMs} ms).${run.ci.runUrl ? `\n\nRun: ${run.ci.runUrl}` : ''}`);
          log(`[alert] closed issue #${action.issueNumber} for ${label}`);
          await notify(`RECOVERED: ${label} is passing again (${result.durationMs} ms).`);
        }
      } catch (err) {
        failures.push(`${label} ${action.type}: ${err.message}`);
        // Undo the optimistic change so the action is retried on the next run.
        if (action.type === 'open') siteState.alertedStatus = null;
        if (action.type === 'close') {
          siteState.issueNumber = action.issueNumber;
          siteState.alertedStatus = action.previousStatus;
        }
        continue;
      }
      if (action.type === 'close') siteState.issueNumber = null;
    }
    nextState.sites[result.site] = siteState;
  }

  nextState.updatedAt = run.timestamp;
  return { state: nextState, failures };
}

module.exports = { applyAlerts };
