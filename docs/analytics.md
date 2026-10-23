# Analytics: what code enforces, and the one thing it cannot

> **Status in OceanMetrics Atlas (WP11, 2026-10-14).** The module (`src/lib/analytics/`) and its privacy rules still apply, but analytics are now OFF unless `VITE_GA_ID` / `VITE_LOG_URL` are set at build time. The `report` title, the Shiny `scores`/`species` apps, the `Atlas (preview)` page title and the Sheet it names are upstream (MarineSensitivity) details. The `?catalog=` and `?collection=` keys never reach a page location.

`src/lib/analytics/` (plan atlas-2 `analytics/`, port of `msens::ga_js`) sends GA4 hits and a batched
Sheet-log beacon. Every hit this module builds carries an explicit, sanitized `page_location` and a
fixed `page_title` — never the live page's own href/fragment, never the live document title (see
`src/lib/analytics/analytics.ts`'s module header for the fix-round-1 privacy defect and its fix, and
`tests/analytics/analytics.test.ts` / `tests/analytics/noRawLocation.wiring.test.ts` for the gates).

That covers every hit **this code** constructs. It does not cover a hit gtag.js constructs on its
own initiative.

## The Ocean Metrics instance: GA4 is the bar's

On an instance with the Ocean Metrics bar (`instance.json` `nav`, the oceanmetrics instance), `VITE_GA_ID` goes to the
bar, not to this module: `gaLegs()` (`src/lib/analytics/gaId.ts`) hands it to `<om-nav data-ga>` and gives
`createAnalytics()` no measurement id, so exactly one side configures GA4. The bar (`@oceanmetrics/nav` >= 0.2.0, its
README "Analytics") is the loader every Ocean Metrics page shares: it appends the gtag.js script (this module never
does, see `analytics.ts`'s header), configures `anonymize_ip: true`, `allow_google_signals: false`,
`allow_ad_personalization_signals: false`, `send_page_view: false`, and sends its own page_view with a rebuilt
`page_location` (origin + path: no query, no fragment, so no `#pl=` or `#t=`), on load and on each change of that
location. The Sheet leg (`VITE_LOG_URL`) stays this module's. What the oceanmetrics instance does not send to GA4 any
more is this module's `track()` events; an instance without the bar (marinesensitivity) keeps this module's GA4 leg
whole.

Gates: `tests/analytics/gaId.test.ts` (`gaLegs`), `tests/nav.test.ts` (the shell's wiring), `tests/check-ga.test.ts`
and `scripts/check-ga.mjs` (run by `build-instance.yml` on every instance's dist: no gtag.js script tag in any page, the
id in the build exactly when `VITE_GA_ID` is set), and `e2e/fixtures/nav-analytics/` (`npm run e2e:nav-analytics`, in
`pages.yml`'s analytics-privacy job): two real builds of the instance, without the id (no `data-ga`, no tag, no
`dataLayer`) and with `G-TEST000000` (one tag, one config, anonymized; `replaceState`, `pushState` and a hash edit
carrying `#pl=` and `#t=` leave no trace in any gtag() call or request). Seeded by hand: with this module's GA leg
also on, the spec reads two configs and goes red.

The setting below applies to the bar's hits exactly as to this module's: the `oceanmetrics.io` property is one property
for the whole domain, so its web stream's history setting must be off for every Ocean Metrics page.

## The GA4 property setting that must stay OFF

GA4's **Enhanced Measurement** has a per-stream toggle: **"Page changes based on browser history
events."** When ON, gtag.js installs its own `pushState`/`replaceState`/`popstate` hooks and fires a
fresh automatic page_view on every URL change it observes — reading the live page location itself,
at that moment, with no way for this module's code to intervene. Atlas is a single-page app whose
entire view state (including place geometry and the report title) lives in the URL and changes via
`history.replaceState` (`src/lib/state/`, plan D8) — exactly the kind of change this setting watches
for. If it is ON, every `replaceState` call would independently leak the current URL, fragment
included, to Google, regardless of anything `src/lib/analytics/` does.

**This must be OFF for measurement ID `the configured measurement ID (`VITE_GA_ID`)`.** It is a GA4 dashboard property setting, not
something a pinned dependency version or a code review can enforce — it can be changed by anyone with
Editor access on the property, at any time, without touching this repo. Treat it the same as an
infrastructure control: verify it's off during setup, and re-verify it after any GA4
admin-console change to this property.

**Where to check it:** GA4 Admin → Data Streams → the web stream for this property → **Enhanced
measurement** (gear icon) → **Page changes based on browser history events**. Must read **Off**.

## Enabling the Sheet leg

The Sheet-log beacon (`analytics.ts`'s `flush()`) is a no-op until a build-time `logUrl` is
supplied. That comes from **`VITE_LOG_URL`**, a _repository variable_ on this repo (GitHub →
`oceanmetrics/atlas` → Settings → Secrets and variables → Actions → **Variables** tab, not
Secrets — the URL ships in the public bundle either way, same reasoning as `VITE_FEEDBACK_URL`).
`.github/workflows/pages.yml`'s `checks` job forwards it into `npx vite build`;
`src/lib/analytics/logUrl.ts`'s `analyticsLogUrl()` reads it at build time (unset, empty, or
anything not `https://...` resolves to `""`, which `analytics.ts` treats the same as "no Sheet leg
configured" — GA4 still receives events).

**Value**: the same Apps Script `/exec` URL the Shiny apps (`scores`/`species`) already use as the
`MSENS_LOG_URL` server env var — no new Sheet or Apps Script deployment is needed. The atlas writes
rows into the SAME Sheet, using the SAME 16 `ms_log_header()` columns, with `app = "atlas"`
distinguishing its rows from the Shiny apps'. `apps/analytics/README.md` in the sibling
`MarineSensitivity/apps` repo documents the Sheet + Apps Script setup itself.

**How to confirm it's live**: after a Pages deploy with the variable set, open the deployed app,
DevTools → Network, filter for `script.google.com`, and use the app for a few seconds (a batch
flushes every 10 events or 15s, or on tab hide — `analytics.ts`'s `DEFAULT_BATCH`/
`DEFAULT_INTERVAL_MS`). A request to that host, and a matching new row with `app = "atlas"` in the
Sheet within ~15 s, confirms the wiring end to end.

## How to verify in the network panel

However that setting is configured, the network panel is the ground truth. Open DevTools → Network,
filter for `google-analytics.com` or `analytics.google.com` (gtag.js's collection endpoint,
`/g/collect`), navigate the app (including a place draw / report title change, which writes `#pl=`
and `#t=`), and inspect each request's query string:

- The `dl` parameter (`page_location`) must be `https://<host>/<path>?<allowed query keys only>` —
  **no `#` character anywhere in it, ever.** A `dl` value containing `#pl=` or `#t=` means either
  this module's `send_page_view`/explicit-`page_location` fix has regressed, or the Enhanced
  Measurement history setting above is back on and firing its own hit around this module entirely.
- The `dt` parameter (`page_title`) must be exactly `Atlas` or `Atlas (preview)` — never a report
  title.

The same check applies to the Sheet beacon (filter for the configured `VITE_LOG_URL` host instead):
its request body's `page` field must match the same `dl`-shaped value, never contain `#`.

## Automated coverage

- `tests/analytics/analytics.test.ts` — every `gtag("config", ...)`, the manually-fired
  `gtag("event", "page_view", ...)`, and every `track()`-driven `gtag("event", ...)` carry an
  explicit `page_location`/`page_title`; the config call sets `send_page_view: false`; `page_title`
  never reflects a poisoned `document.title`; `updateLocation()` keeps both fields current across a
  simulated `history.replaceState`.
- `tests/analytics/noRawLocation.wiring.test.ts` — source-scans `src/lib/analytics/**` for any
  reference (code OR comment) to the live page location's `href`/fragment fields or to the document's
  own URL/location globals; zero hits allowed.
- `e2e/fixtures/analytics-privacy/` + `e2e/analytics-privacy.spec.ts` — loads a real browser page
  whose URL carries `#pl=g1.test.AAAA&t=secret`, intercepts every outgoing request via `page.route`,
  triggers a `track()` call, and asserts no request (any host) contains `pl=`, `g1.`, `AAAA` or
  `secret` in its URL or body. This is the one gate that exercises the REAL DOM (real `location`,
  real `sendBeacon`/`fetch`) rather than injected fakes.

None of these can see inside Google's own GA4 property configuration — that's what this document's
network-panel check is for.
