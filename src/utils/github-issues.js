'use strict';

/**
 * Opens, comments on and closes GitHub Issues through the REST API.
 * Needs GITHUB_TOKEN (issues: write) and GITHUB_REPOSITORY ("owner/name"); both come from Actions.
 * Every alert issue carries the labels "monitor-alert" and "site:<id>", which is how an open issue
 * is found again if the state file is ever lost.
 */
const API = 'https://api.github.com';
const ALERT_LABEL = 'monitor-alert';

function createClient({ token, repository, fetchImpl = fetch }) {
  if (!token || !repository) return null;

  async function call(method, path, body) {
    const res = await fetchImpl(`${API}/repos/${repository}${path}`, {
      method,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'demo-sites-synthetic-monitor',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`GitHub ${method} ${path} -> HTTP ${res.status} ${text.slice(0, 200)}`);
    }
    return res.status === 204 ? null : res.json();
  }

  return {
    async findOpenIssue(siteId) {
      const labels = encodeURIComponent(`${ALERT_LABEL},site:${siteId}`);
      const issues = await call('GET', `/issues?state=open&labels=${labels}&per_page=10`);
      const issue = issues.find((i) => !i.pull_request);
      return issue ? issue.number : null;
    },
    async open(siteId, title, body) {
      const issue = await call('POST', '/issues', { title, body, labels: [ALERT_LABEL, `site:${siteId}`] });
      return { number: issue.number, url: issue.html_url };
    },
    async comment(number, body) {
      await call('POST', `/issues/${number}/comments`, { body });
    },
    async close(number, body) {
      await call('POST', `/issues/${number}/comments`, { body });
      await call('PATCH', `/issues/${number}`, { state: 'closed', state_reason: 'completed' });
    },
  };
}

module.exports = { createClient, ALERT_LABEL };
