'use strict';

/**
 * InvenTree demo journey "login-dashboard" (read-only user):
 * GET /api/ -> 200 (server version recorded in meta) -> UI login (aria-label login-username /
 * login-password) -> dashboard loads -> the session belongs to the configured user
 * -> parts list renders the rows the parts API returned (count and first part name match).
 */
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
  });

  await step('log in', async () => {
    await page.locator('input[aria-label="login-username"]').fill(credentials.username);
    await page.locator('input[aria-label="login-password"]').fill(credentials.password);
    await page.locator('button[type="submit"]', { hasText: 'Log In' }).click();
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
