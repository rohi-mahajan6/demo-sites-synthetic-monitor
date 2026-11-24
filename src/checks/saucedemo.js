'use strict';

/**
 * SauceDemo journey "checkout" (read-only; the shop runs entirely in the browser, no order is stored):
 * open / -> log in -> wait for 6 inventory items -> add backpack (badge = 1)
 * -> cart shows the backpack -> checkout -> fill details -> overview shows a well-formed total -> finish.
 * Success: complete-header = "Thank you for your order!".
 */
const BASE = 'https://www.saucedemo.com/';
const tid = (id) => `[data-test="${id}"]`;

async function run({ page, step, goto, expect, credentials, meta }) {
  await step('open login page', async () => {
    await goto(BASE);
    await page.locator(tid('login-button')).waitFor();
  });

  await step('log in', async () => {
    await page.locator(tid('username')).fill(credentials.username);
    await page.locator(tid('password')).fill(credentials.password);
    await page.locator(tid('login-button')).click();
    // Wait for the products (or the login error), not for the URL: the list renders after navigation.
    const error = page.locator(tid('error'));
    const items = page.locator(tid('inventory-item'));
    await Promise.race([items.nth(5).waitFor(), error.waitFor()]);
    if (await error.isVisible()) expect(false, `login rejected: ${(await error.innerText()).trim()}`);
    const count = await items.count();
    expect(count === 6, `expected 6 inventory items, found ${count}`);
    meta.inventoryItems = count;
  });

  await step('add backpack to cart', async () => {
    await page.locator(tid('add-to-cart-sauce-labs-backpack')).click();
    const badge = page.locator(tid('shopping-cart-badge'));
    await badge.waitFor();
    const text = (await badge.innerText()).trim();
    expect(text === '1', `cart badge shows "${text}", expected "1"`);
  });

  await step('open cart', async () => {
    await page.locator(tid('shopping-cart-link')).click();
    const item = page.locator(tid('inventory-item-name'));
    await item.first().waitFor();
    const names = (await item.allInnerTexts()).map((n) => n.trim());
    expect(names.length === 1 && names[0] === 'Sauce Labs Backpack', `cart contains ${JSON.stringify(names)}`);
  });

  await step('enter checkout details', async () => {
    await page.locator(tid('checkout')).click();
    await page.locator(tid('firstName')).fill('Synthetic');
    await page.locator(tid('lastName')).fill('Monitor');
    await page.locator(tid('postalCode')).fill('10001');
    await page.locator(tid('continue')).click();
    const total = page.locator(tid('total-label'));
    await total.waitFor();
    const text = (await total.innerText()).trim();
    expect(/^Total: \$\d+\.\d{2}$/.test(text), `unexpected total label "${text}"`);
    meta.total = text.replace('Total: ', '');
  });

  await step('finish order', async () => {
    await page.locator(tid('finish')).click();
    const header = page.locator(tid('complete-header'));
    await header.waitFor();
    const text = (await header.innerText()).trim();
    expect(text === 'Thank you for your order!', `confirmation header is "${text}"`);
  });
}

module.exports = { run };
