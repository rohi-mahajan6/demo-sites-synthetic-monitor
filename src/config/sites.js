'use strict';

/**
 * Site definitions and timeouts.
 * Timeouts agreed in step 1: first navigation 30 s, element waits 15 s,
 * InvenTree login redirect 20 s, whole journey 120 s. One retry after 30 s.
 */
const TIMEOUTS = {
  navigationMs: 30_000,
  elementMs: 15_000,
  inventreeLoginRedirectMs: 20_000,
  journeyMs: 120_000,
};

const RETRY_DELAY_MS = 30_000;

const SITES = [
  {
    id: 'saucedemo',
    name: 'SauceDemo',
    journey: 'checkout',
    url: 'https://www.saucedemo.com/',
    credentials: { username: 'SAUCE_USERNAME', password: 'SAUCE_PASSWORD' },
    check: () => require('../checks/saucedemo'),
  },
  {
    id: 'parabank',
    name: 'ParaBank',
    journey: 'login-balance',
    url: 'https://parabank.parasoft.com/parabank/',
    credentials: { username: 'PARABANK_USERNAME', password: 'PARABANK_PASSWORD' },
    check: () => require('../checks/parabank'),
  },
  {
    id: 'inventree',
    name: 'InvenTree demo',
    journey: 'login-dashboard',
    url: 'https://demo.inventree.org/',
    credentials: { username: 'INVENTREE_USERNAME', password: 'INVENTREE_PASSWORD' },
    check: () => require('../checks/inventree'),
  },
];

module.exports = { TIMEOUTS, RETRY_DELAY_MS, SITES };
