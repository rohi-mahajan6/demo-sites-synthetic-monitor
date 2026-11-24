# demo-sites-synthetic-monitor

Synthetic monitoring for three public demo sites. Every 6 hours a real browser runs one critical journey per site. The results are stored as JSON, a status page shows uptime and latency, and repeated failures open a GitHub Issue and send a Telegram alert.

> ⚠️ The targets are **public third-party demo sites** used for practice: SauceDemo (Sauce Labs), ParaBank (Parasoft) and the InvenTree demo. This project is not affiliated with any of them. Every journey is read-only, runs one at a time, four times a day.

## 1. Problem statement

A homepage that returns 200 says little about whether users can actually log in and finish a task. This project checks a complete user journey on each site, tells a site that is down apart from a journey that is broken, and alerts only when a problem persists, so a single slow response does not page anyone.

## 2. Monitored journeys

| Site | Journey | Steps | Success means |
| ---- | ------- | ----- | ------------- |
| SauceDemo | `checkout` | open login → log in → add backpack → cart → checkout details → finish | 6 products listed, cart badge is 1, the cart holds the backpack, the total is a well-formed amount, header reads "Thank you for your order!" |
| ParaBank | `login-balance` | API login → open home → UI login → accounts overview → account activity | API returns a customer id, at least one account row, the activity page shows that account and a well-formed balance (format only: the shared demo data changes constantly) |
| InvenTree demo | `login-dashboard` | `GET /api/` → open login → log in → session user → parts list | server identifies as InvenTree (version recorded), the dashboard loads, `/api/user/me/` returns the configured user, the parts list renders the rows the parts API returned (same count, first part name shown) |

Each step waits for the element or value it needs, never a fixed sleep and never only a URL change.

Timeouts: 30 s for navigation, 15 s for element waits, 20 s for the InvenTree login redirect, and 120 s for a whole journey.

## 3. How results are classified

| Status | Meaning |
| ------ | ------- |
| `pass` | Every step succeeded |
| `fail` | The site answered, but a step did not see what it expected (assertion, missing element, HTTP 4xx) |
| `unavailable` | DNS, TLS or connection failure, HTTP 5xx, HTTP 429 rate limiting on a login API, or no response to the first navigation within 30 s |
| `error` | A problem in the monitor itself (missing credential, browser crash, code bug) |

Where a login goes through an API (ParaBank, InvenTree), the check reads that API's answer, so a rejected login (`fail`, HTTP 400/401/403) is told apart from rate limiting or a server error (`unavailable`).

A journey that does not pass is retried once, 30 s later, in a fresh browser context. Both attempts are recorded. A pass on the retry is stored as `pass` with `flaky: true`. Screenshots and Playwright traces of failed attempts are uploaded as a workflow artifact and kept for 30 days.

## 4. Alerting

| Condition | Action |
| --------- | ------ |
| `fail` or `error`, 2 consecutive non-pass runs | Open a GitHub Issue (labels `monitor-alert`, `site:<id>`) and send a Telegram message |
| `unavailable`, 3 consecutive runs (18 h) | Same |
| Status changes while an issue is open | One comment on the issue |
| Same status again | Nothing (no comment every 6 hours) |
| `pass` | Close the issue with a comment, send a recovery message |

`unavailable` never closes an issue. Only a return to `pass` does. Telegram is optional; without its secrets, alerts go to GitHub Issues only.

## 5. Architecture

```
GitHub Actions (cron 30 0,6,12,18 * * *)
 └─ monitor job
     ├─ run-monitor.js ── one headless Chromium, sites one after another
     │    ├─ checks/<site>.js     journey steps
     │    ├─ utils/journey-runner timing, timeouts, classification, evidence
     │    ├─ utils/retry          one retry after 30 s
     │    └─ utils/alerting       alert-state rules → GitHub Issues / Telegram
     ├─ results → data branch (results/YYYY-MM/<timestamp>.json, state.json)
     └─ failure evidence → workflow artifact
 └─ dashboard job ── build-dashboard.js → static page with Chart.js
 └─ deploy job ── GitHub Pages
```

The `main` branch only holds code. Results live on a separate `data` branch, committed by `github-actions[bot]`. Each run is one JSON file (schema v1): run id, timestamp, trigger, CI run URL, and per site the status, duration, attempts, `flaky`, failing step with its error and HTTP status, per-step timings, metadata such as the InvenTree server version, and evidence file names.

The monitor job exits 0 when a run is recorded, even if sites are down, because that is data. It exits 1 if no run could be recorded and 2 if a run was recorded but an alert could not be delivered. Results that exist are still committed in both cases.

## 6. Execution evidence

Live status page: **https://rohi-mahajan6.github.io/demo-sites-synthetic-monitor/**

All results below come from real runs. Raw results are on the [`data` branch](https://github.com/rohi-mahajan6/demo-sites-synthetic-monitor/tree/data).

### First CI run: InvenTree failure caught ([run 45393071911](https://github.com/rohi-mahajan6/demo-sites-synthetic-monitor/actions/runs/45393071911), 2026-11-24 12:24 UTC)

| Site | Status | Duration | Detail |
| ---- | ------ | -------- | ------ |
| SauceDemo | pass | 755 ms | |
| ParaBank | pass | 1382 ms | |
| InvenTree demo | **fail** (both attempts) | 22792 ms | step `log in`: `page.waitForURL: Timeout 20000ms exceeded` |

The retry ran 30 s later and failed the same way. Screenshots and traces of both attempts were uploaded, and no issue was opened, because the alert rule needs 2 consecutive failures.

**Cause: a login timing race in the check, not in the site.** The InvenTree login form becomes visible before the app finishes its startup session checks (`GET /api/auth/v1/auth/session`, called twice). Text typed during that window is lost when the form re-renders: the fields are cleared and the click sends no login request. Tracing three local logins reproduced it in one of three.

**Fix** (commit `57d4c93`):
- wait for the login page's network to settle before typing;
- confirm both fields still hold their values before submitting;
- read the login API's answer, so a rejected login (400) is reported as `fail` and rate limiting (429) or a server error (5xx) as `unavailable`, instead of a generic timeout.

The fixed journey then passed 5 of 5 local runs.

### Green run after the fix ([run 45400063311](https://github.com/rohi-mahajan6/demo-sites-synthetic-monitor/actions/runs/45400063311), 2026-11-24 13:07 UTC)

| Site | Status | Duration | Detail |
| ---- | ------ | -------- | ------ |
| SauceDemo | pass | 625 ms | 6 products, total $32.39 |
| ParaBank | pass | 1031 ms | 18 accounts |
| InvenTree demo | pass | 11678 ms | login API 200, 25 rows rendered, 411 parts, server 1.8.0 dev (API 583) |

All three passed on the first attempt. The status page then showed 2 runs, and InvenTree's 7-day uptime was 50%, because the earlier failure is kept in the history.

### Local run before the first CI run (2026-11-24, Windows, Node 26, Playwright 1.65.1)

| Site | Status | Duration |
| ---- | ------ | -------- |
| SauceDemo | pass | 4151 ms |
| ParaBank | pass | 9305 ms |
| InvenTree demo | pass | 13215 ms |

## 7. Run locally

```bash
npm ci
npx playwright install chromium
cp .env.example .env          # fill in each site's published demo credentials
npm run monitor               # writes results-local/results/... and results-local/state.json
npm run dashboard             # builds ./site from results-local; open site/index.html
```

`node src/run-monitor.js --site saucedemo` runs a single site. Without `GITHUB_TOKEN`, alerts are only printed.

## 8. Responsible use

- Read-only journeys only. No accounts, transfers or stored data are created on any site. The SauceDemo checkout runs entirely in the browser.
- One browser, one journey at a time, four runs a day, and at most one retry.
- Credentials are the sites' published demo accounts, kept in `.env` locally and in repository secrets in CI.

## License

MIT. See [LICENSE](LICENSE).

Dependencies: Playwright (Apache-2.0), Chart.js (MIT), dotenv (BSD-2-Clause).
