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
| `unavailable` | DNS, TLS or connection failure, HTTP 5xx, or no response to the first navigation within 30 s |
| `error` | A problem in the monitor itself (missing credential, browser crash, code bug) |

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

Local run on 2026-11-24 (Windows, Node 26, Playwright 1.65.1), real sites:

| Site | Status | Duration |
| ---- | ------ | -------- |
| SauceDemo | pass | 4151 ms |
| ParaBank | pass | 9305 ms |
| InvenTree demo | pass | 13215 ms |

_Pending: scheduled CI runs and the published status page. This section will only contain results from real runs._

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
