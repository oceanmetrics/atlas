import { expect, test } from "@playwright/test";

// Fix round 1's gate. Real browser, real `location` (navigated with a fake place + report title
// already in the URL's fragment: `#pl=g1.test.AAAA&t=secret`), real `navigator.sendBeacon`/`fetch`
// for the Sheet beacon leg — everything main.ts's createAnalytics() call leaves at its guarded
// defaults, which no unit test (all injected fakes) exercises.
//
// GA4's real `gtag.js` is never loaded here (this repo's e2e specs are hermetic — no spec ever
// touches the live network, and this app does not wire the GA loader script into any page yet, see
// analytics.ts's module header) — so this spec cannot observe gtag.js's own internal automatic
// page_view behavior directly. What it CAN and does prove, for real, is: (a) every argument this
// app's code itself ever hands to `gtag(...)` (captured via an injected sink into `window.__gtagCalls`
// — the same seam a real gtag.js loader would sit behind) is clean, under a REAL browser location
// carrying a real hash; (b) the REAL Sheet-beacon request this code sends over the real DOM APIs is
// clean too. docs/analytics.md covers the one thing neither this spec nor any code here can enforce:
// the GA4 dashboard's Enhanced Measurement history-page-view setting.
//
// SEEDED FAULT (documented, not committed as a separate broken build — see the coordinator's fix
// round 1 report): deleting the explicit `page_location`/`page_title` fields from analytics.ts's
// `config` gtag call turns this spec red on the "config call" assertions below, the same way it
// turns tests/analytics/analytics.test.ts red (verified by hand during fix round 1).

const FORBIDDEN = ["pl=", "g1.", "AAAA", "secret"];

function assertClean(label: string, text: string) {
  for (const token of FORBIDDEN) {
    expect(text, `${label} must not contain "${token}"`).not.toContain(token);
  }
}

test("no request, and no gtag() call, ever carries the URL fragment's place/report-title data", async ({
  page,
}) => {
  const beaconRequests: { url: string; postData: string | null }[] = [];
  const gaHostRequests: { url: string; postData: string | null }[] = [];

  await page.route("**/log", async (route) => {
    beaconRequests.push({ url: route.request().url(), postData: route.request().postData() });
    await route.fulfill({ status: 200, body: "{}" });
  });
  // defensive: no request should ever reach a real GA host from this fixture (gtag.js is not
  // loaded), but if a later change adds the loader script, this still has to stay clean.
  await page.route(
    /google-analytics\.com|analytics\.google\.com|googletagmanager\.com/,
    async (route) => {
      gaHostRequests.push({ url: route.request().url(), postData: route.request().postData() });
      await route.abort();
    },
  );

  await page.goto("/?ver=test#pl=g1.test.AAAA&t=secret");

  // sanity check: prove the fragment really does carry the secret in this real browser, so a
  // passing spec below is not passing because the setup silently failed to carry it at all.
  const hash = await page.evaluate(() => window.location.hash);
  expect(hash).toContain("pl=g1.test.AAAA");
  expect(hash).toContain("secret");

  await page.evaluate(() => window.__track());
  // sendBeacon is fire-and-forget; give the routed request a moment to land.
  await page.waitForTimeout(200);

  const gtagCalls = await page.evaluate(() => window.__gtagCalls);
  const gtagText = JSON.stringify(gtagCalls);
  assertClean("window.__gtagCalls (every gtag() call this app made)", gtagText);

  for (const req of [...beaconRequests, ...gaHostRequests]) {
    assertClean(`request URL ${req.url}`, req.url);
    if (req.postData) assertClean(`request body for ${req.url}`, req.postData);
  }

  expect(
    gaHostRequests,
    "no request to a real GA host — gtag.js is not loaded in this phase",
  ).toEqual([]);
  expect(
    beaconRequests.length,
    "the Sheet beacon leg must have actually fired at least once",
  ).toBeGreaterThan(0);

  // the config call: explicit page_location, send_page_view: false (fix round 1's two named faults).
  const configCall = (gtagCalls as unknown[][]).find((c) => c[0] === "config");
  expect(configCall, "gtag('config', ...) must have been called").toBeDefined();
  expect(configCall?.[1], "the config call carries the configured measurement id").toBe(
    "G-TEST000000",
  );
  const configParams = configCall?.[2] as Record<string, unknown>;
  expect(configParams.send_page_view).toBe(false);
  expect(configParams.page_location).toBeTruthy();
  assertClean("config call's page_location", String(configParams.page_location));

  // every event call (including the manually-fired page_view) carries its own page_location too.
  const eventCalls = (gtagCalls as unknown[][]).filter((c) => c[0] === "event");
  expect(eventCalls.length).toBeGreaterThan(0);
  for (const call of eventCalls) {
    const params = call[2] as Record<string, unknown>;
    expect(
      params.page_location,
      `event ${String(call[1])} must carry an explicit page_location`,
    ).toBeTruthy();
    assertClean(`event ${String(call[1])}'s page_location`, String(params.page_location));
  }
});
