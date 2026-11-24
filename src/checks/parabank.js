'use strict';

/**
 * ParaBank journey "login-balance" (read-only, nothing is transferred or opened):
 * API GET /services/bank/login/{user}/{password} -> 200 with a customer id. This is the real
 * credential check: the public UI login is not a reliable signal on its own (exploration note Q1).
 * -> UI login -> overview has at least one account row -> open the first account's activity.
 * Success: the activity page shows that account number and a well-formed balance.
 * The balance is checked for format, not value: the shared demo data changes all the time.
 */
const BASE = 'https://parabank.parasoft.com/parabank/';
const MONEY = /^-?\$-?[\d,]+\.\d{2}$/;

async function run({ page, step, goto, apiGet, expect, credentials, meta }) {
  await step('API login', async () => {
    const url = `${BASE}services/bank/login/${encodeURIComponent(credentials.username)}/${encodeURIComponent(credentials.password)}`;
    const res = await apiGet(url, { headers: { Accept: 'application/json' } });
    expect(res.status() === 200, `API login answered HTTP ${res.status()}`);
    const body = await res.json().catch(() => null);
    expect(body && Number.isInteger(body.id), 'API login response has no customer id');
  });

  await step('open home page', async () => {
    await goto(`${BASE}index.htm`);
    await page.locator('input[name="username"]').waitFor();
  });

  await step('log in', async () => {
    await page.locator('input[name="username"]').fill(credentials.username);
    await page.locator('input[name="password"]').fill(credentials.password);
    await page.locator('input[value="Log In"]').click();
    const welcome = page.locator('#leftPanel .smallText', { hasText: 'Welcome' });
    const error = page.locator('#rightPanel .error');
    await Promise.race([welcome.waitFor(), error.waitFor()]);
    if (await error.isVisible()) expect(false, `login shows error: ${(await error.innerText()).trim().slice(0, 200)}`);
  });

  let accountId;
  await step('accounts overview', async () => {
    // Rows are filled by an XHR after the page loads.
    const links = page.locator('#accountTable tbody tr td a');
    await links.first().waitFor();
    const count = await links.count();
    expect(count >= 1, 'accounts overview has no accounts');
    meta.accountCount = count;
    accountId = (await links.first().innerText()).trim();
    expect(/^\d+$/.test(accountId), `first account number "${accountId}" is not numeric`);
  });

  await step('account activity', async () => {
    await page.locator('#accountTable tbody tr td a').first().click();
    // The details are also filled by an XHR: wait for the values, not the URL.
    await page.locator('#accountId', { hasText: accountId }).waitFor();
    await page.waitForFunction(() => {
      const el = document.querySelector('#balance');
      return el && el.textContent.trim() !== '';
    });
    const text = (await page.locator('#balance').innerText()).trim();
    expect(MONEY.test(text), `balance "${text}" is not a money amount`);
  });
}

module.exports = { run };
