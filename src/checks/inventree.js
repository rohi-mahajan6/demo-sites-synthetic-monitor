'use strict';

/**
 * InvenTree demo journey "login-dashboard" (read-only user):
 * GET /api/ -> 200 (server version recorded in meta) -> UI login (aria-label login-username /
 * login-password) -> dashboard loads -> the session belongs to the configured user
 * -> parts list renders the rows the parts API returned (count and first part name match).
 */
const { UnavailableError, JourneyFailure } = require('../utils/status');

const BASE = 'https://demo.inventree.org';

async function run({ page, step, goto, apiGet, expect, credentials, timeouts, meta }) {
  await step('API server info', async () => {
    const res = await apiGet(`${BASE}/api/`, { headers: { Accept: 'application/json' } });
    expect(res.status() === 200, `/api/ answered HTTP ${res.status()}`);
    const body = await res.json().catch(() => null);
    expect(body && body.server === 'InvenTree', '/api/ did not identify as an InvenTree server');
    meta.serverVersion = body.version || null;
    meta.apiVersion = body.apiVersion || null;
  });

  await step('open login page', async () => {
    await goto(`${BASE}/web/login`);
    await page.locator('input[aria-label="login-username"]').waitFor();
    // The inputs appear before the app has finished its startup session checks (GET
    // /api/auth/v1/auth/session, run twice). Typing during that window is lost: the form re-renders,
    // the fields are cleared and the click sends no login request. Wait for the network to settle.
    // If it never goes fully idle, carry on: the value check in the next step still catches a reset form.
    await page.waitForLoadState('networkidle', { timeout: timeouts.elementMs }).catch(() => {});
  });

  await step('log in', async () => {
    const username = page.locator('input[aria-label="login-username"]');
    const password = page.locator('input[aria-label="login-password"]');
    await username.fill(credentials.username);
    await password.fill(credentials.password);
    // Make sure the form still holds what was typed before submitting it.
    const typed = await username.inputValue();
    const typedPassword = await password.inputValue();
    if (typed !== credentials.username || typedPassword !== credentials.password) {
      throw new JourneyFailure('login form was reset before submit (fields lost their values)');
    }
    // Read the login API's own answer, so a rejected login, rate limiting and a server error each get
    // a clear result instead of all looking like "the redirect timed out".
    const loginResponse = page.waitForResponse(
      (r) => new URL(r.url()).pathname === '/api/auth/v1/auth/login' && r.request().method() === 'POST',
      { timeout: timeouts.inventreeLoginRedirectMs },
    );
    await page.locator('button[type="submit"]', { hasText: 'Log In' }).click();
    const res = await loginResponse;
    const status = res.status();
    meta.loginHttpStatus = status;
    if (status >= 500) throw new UnavailableError(`login API answered HTTP ${status}`, status);
    // 429: the site is up but refuses logins from this client for now. Not a broken journey,
    // so it counts as unavailable (alerts after 3 runs, never closes an issue).
    if (status === 429) throw new UnavailableError('login rate-limited: login API answered HTTP 429', status);
    if (status === 400 || status === 401 || status === 403) {
      throw new JourneyFailure(`login rejected: login API answered HTTP ${status} (check the credentials)`, status);
    }
    if (!res.ok()) throw new JourneyFailure(`login API answered HTTP ${status}`, status);
    // The redirect comes after the auth calls finish (about 6 s in exploration); then the dashboard renders.
    await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: timeouts.inventreeLoginRedirectMs });
    await page.waitForFunction(() => document.title.includes('Dashboard'));
  });

  await step('session user', async () => {
    // page.request shares the browser session's cookies, so this asks who the UI is logged in as.
    const res = await apiGet(`${BASE}/api/user/me/`, { headers: { Accept: 'application/json' } });
    expect(res.status() === 200, `/api/user/me/ answered HTTP ${res.status()}`);
    const me = await res.json().catch(() => null);
    expect(me && me.username === credentials.username, `logged in as "${me && me.username}", expected "${credentials.username}"`);
  });

  await step('parts list', async () => {
    // The table loads one page of parts from /api/part/?...&limit=25. Rows have no <a> links (they
    // navigate on click), so the check compares what is rendered with what the API returned:
    // the same number of data rows, and the first row shows the first part's name.
    // A "no records" placeholder or a half-rendered table cannot pass this.
    const tableData = page.waitForResponse((r) => {
      const u = new URL(r.url());
      return u.pathname === '/api/part/' && u.searchParams.has('limit') && r.request().method() === 'GET';
    });
    await goto(`${BASE}/web/part/category/index/parts`);
    const res = await tableData;
    expect(res.status() === 200, `/api/part/ answered HTTP ${res.status()}`);
    const body = await res.json().catch(() => null);
    const parts = body && Array.isArray(body.results) ? body.results : null;
    expect(parts && parts.length >= 1, 'parts API returned no parts');

    const rows = page.locator('table tbody tr.mantine-datatable-row');
    await page.waitForFunction((n) => document.querySelectorAll('table tbody tr.mantine-datatable-row').length === n, parts.length);
    const firstRow = (await rows.first().innerText()).replace(/\s+/g, ' ');
    expect(firstRow.includes(parts[0].name), `first row "${firstRow.slice(0, 80)}" does not show part "${parts[0].name}"`);
    meta.partsListRows = await rows.count();
    meta.partsTotal = typeof body.count === 'number' ? body.count : null;
  });
}

module.exports = { run };
