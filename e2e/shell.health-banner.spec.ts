// V3 (P round, 2026-09-24): Ben's own report -- titiler-v8 was unreachable for an hour tonight
// and the live atlas kept rendering a perfectly normal-looking map with NO raster and NO word to
// the user. This is the real-browser proof for src/lib/health/* + src/shell/health.svelte.ts +
// src/lib/ui/HealthBanner.svelte: routes the tiler host to a 503 (page.route, never the live
// network), asserts the banner names the host and reason, that Retry re-probes, and that
// unrouting (a recovered service) clears it.
import { expect, test, type Page } from "@playwright/test";
import { collectRequests, routeBucket, waitForHydration } from "./hermetic";
import {
  SCORE_COG_URL,
  blockWasm,
  routeBasemapStyle,
  routeGlyphs,
  routeZonesPmtiles,
} from "./map-hermetic";
import { safeRoute } from "./routeSafety";

// no local `declare global` here -- e2e/map.spec.ts already augments `Window.__atlasMap` globally
// with the real shape, and TypeScript refuses two conflicting global augmentations in the same
// program; `window.__atlasMap` below resolves against that shared declaration.

const TILER_HOST = "https://titiler-v8.marinesensitivity.org";

/** every request under the tiler host (including `/healthz`) answers 503, until `stop()`. Counts
 * `/healthz` hits specifically so a test can prove a click actually issued a NEW probe. */
function routeTilerDown(page: Page) {
  let healthzHits = 0;
  const handler = safeRoute((route: Parameters<Parameters<Page["route"]>[1]>[0]) => {
    if (route.request().url().endsWith("/healthz")) healthzHits++;
    return route.fulfill({ status: 503, contentType: "text/plain", body: "service unavailable" });
  });
  return {
    install: () => page.route(`${TILER_HOST}/**`, handler),
    stop: () => page.unroute(`${TILER_HOST}/**`, handler),
    healthzHits: () => healthzHits,
  };
}

async function gotoWithFailingTiler(page: Page, down: ReturnType<typeof routeTilerDown>) {
  await blockWasm(page);
  await routeBucket(page);
  await routeZonesPmtiles(page);
  await routeBasemapStyle(page);
  await routeGlyphs(page);
  // registered AFTER routeBucket()'s own titiler route (routeMapTileOrigins, hermetic.ts) --
  // Playwright matches page.route handlers in REVERSE registration order, so this one wins.
  await down.install();
  await page.goto("/");
  await waitForHydration(page);
  await page.waitForFunction(() => !!window.__atlasMap, undefined, { timeout: 15_000 });
}

const banner = (page: Page) => page.getByTestId("health-banner");

test.describe("V3: titiler-v8 down — a visible banner replaces the silent empty map", () => {
  test("boot-time probe (trigger a): the banner names the host and the HTTP reason", async ({
    page,
  }) => {
    const down = routeTilerDown(page);
    await gotoWithFailingTiler(page, down);

    await expect(banner(page)).toBeVisible({ timeout: 15_000 });
    await expect(banner(page)).toContainText("Map tiles unavailable");
    await expect(banner(page)).toContainText("titiler-v8.marinesensitivity.org");
    await expect(banner(page)).toContainText("HTTP 503");
    await expect(banner(page)).toContainText("Raster layers cannot be drawn");
    // role="status", not an alert dialog that steals focus -- the map controls stay usable.
    await expect(banner(page)).toHaveAttribute("role", "status");
  });

  test("a real map raster-tile failure (trigger b) raises the banner on its own, tiler healthy at boot", async ({
    page,
  }) => {
    // tiler UP at boot (routeBucket's own default titiler route, hermetic.ts's
    // routeMapTileOrigins): the boot-time probe (trigger a) succeeds, so nothing this test later
    // observes can be explained by that first probe -- only a REAL tile failure can raise it.
    await blockWasm(page);
    await routeBucket(page);
    await routeZonesPmtiles(page);
    await routeBasemapStyle(page);
    await routeGlyphs(page);
    await page.goto("/");
    await waitForHydration(page);
    await page.waitForFunction(() => !!window.__atlasMap, undefined, { timeout: 15_000 });
    await expect(banner(page)).toBeHidden();

    // NOW the service goes down -- registered after the page has already loaded, so it only
    // affects requests from here on (the boot probe above already succeeded against the OLD
    // route). Because the tiler's last known result is "ok" (not "down"), the store's backoff gate
    // does not apply to the very next probe (registry.ts#canProbe) -- so this reprobes IMMEDIATELY
    // off the tile failure below, with no artificial wait needed.
    const down = routeTilerDown(page);
    await down.install();

    // a real raster source under the now-failing tiler host -- the same __atlasMap seam
    // e2e/map.spec.ts's own raster-paint test uses, so this never depends on a lens' own data
    // pipeline resolving. Re-asserted on every poll: the shell re-applies its OWN composed style
    // whenever a lazy lens store resolves, which can wipe an injected raster that landed first (the
    // race map.spec.ts's raster test documents), so the injection that survives must be the last.
    const injectRaster = () =>
      page.evaluate((cogUrl) => {
        const api = window.__atlasMap!;
        api.handle.applyStyle(
          api.composeStyle({
            ...api.inputs(),
            raster: {
              id: "r_lyr",
              tiles: [
                "https://titiler-v8.marinesensitivity.org/cog/tiles/WebMercatorQuad/{z}/{x}/{y}.png" +
                  `?url=${encodeURIComponent(cogUrl)}&colormap_name=spectral_r&rescale=0,90`,
              ],
              opacity: 1,
            },
          }),
        );
      }, SCORE_COG_URL);

    await expect
      .poll(
        async () => {
          await injectRaster();
          return banner(page).isVisible();
        },
        { message: "a failing raster tile never raised the banner", timeout: 20_000 },
      )
      .toBe(true);
    await expect(banner(page)).toContainText("titiler-v8.marinesensitivity.org");
  });

  test("Retry (trigger c) re-probes, and a recovered service clears the banner", async ({
    page,
  }) => {
    const down = routeTilerDown(page);
    await gotoWithFailingTiler(page, down);
    await expect(banner(page)).toBeVisible({ timeout: 15_000 });

    const requests = collectRequests(page);
    const hitsBefore = down.healthzHits();
    await banner(page).getByRole("button", { name: "Retry" }).click();
    await expect
      .poll(() => down.healthzHits(), { message: "Retry did not issue a new /healthz probe" })
      .toBeGreaterThan(hitsBefore);
    expect(requests.some((u) => u.endsWith("/healthz"))).toBe(true);
    // still down (the route still answers 503) -- the banner stays, it does not clear itself.
    await expect(banner(page)).toBeVisible();

    // the service "recovers": drop the failing route, let routeBucket's own 200 answer instead.
    await down.stop();
    await banner(page).getByRole("button", { name: "Retry" }).click();
    await expect(banner(page)).toBeHidden({ timeout: 15_000 });
  });
});

// P round 2 (CI run 36070452831, three-engine job: 97/1119 failed on chromium, webkit AND
// firefox): the banner used to be `position: fixed` at the viewport's top edge, so whenever it
// showed it painted OVER `.topbar` and swallowed every click meant for a control underneath it --
// this is the real-browser proof that a topbar control stays clickable with the banner up. See
// HealthBanner.svelte's own header comment for the placement fix (now `.stage`-scoped, below the
// topbar's separate CSS Grid row).
test.describe("P round 2: the banner never covers the top bar", () => {
  test("with the tiler down, a click on Feedback and on the lens switch still work", async ({
    page,
  }) => {
    const down = routeTilerDown(page);
    await gotoWithFailingTiler(page, down);
    await expect(banner(page)).toBeVisible({ timeout: 15_000 });

    // Feedback: a real topbar control the OLD fixed overlay sat directly on top of -- clicking it
    // opens the screenshot-feedback <dialog> (TopBarActions.svelte's onFeedbackClick).
    await page.locator('[data-control="feedback"]').click();
    await expect(page.locator("dialog[open]")).toBeVisible({ timeout: 2000 });
    await page.keyboard.press("Escape");
    await expect(page.locator("dialog[open]")).toBeHidden();

    // the lens switch: another topbar control, further along the same strip the banner used to
    // cover end to end.
    const speciesButton = page
      .locator('[data-control="lens-switch"]')
      .getByRole("button", { name: "Species" });
    await speciesButton.click();
    await expect(speciesButton).toHaveAttribute("aria-pressed", "true", { timeout: 2000 });

    // the banner itself is still up throughout -- this proves the controls are reachable WITH it
    // showing, not merely that it happened to have cleared.
    await expect(banner(page)).toBeVisible();
  });
});

// P round 2, second half of the same incident: the data-origin probe misread an ORDINARY hermetic
// fixture's app/boot.json 404 (no release publishes it yet -- routeBucket()'s own 404 when no
// `boot` fixture is given, hermetic.ts) as the release data being DOWN, so this banner appeared on
// nearly every shell spec that never asked for it -- see probe.ts's own P round 2 comment. This is
// the regression test for that: the plain hermetic fixture (no `boot` argument, tiler healthy)
// must show NO banner, ever.
test.describe("P round 2: an ordinary hermetic fixture never raises a banner", () => {
  test("no boot.json fixture, tiler healthy: no banner within 5s of boot", async ({ page }) => {
    await blockWasm(page);
    await routeBucket(page); // NO `boot` arg -- app/boot.json 404s, like most shell specs
    await routeZonesPmtiles(page);
    await routeBasemapStyle(page);
    await routeGlyphs(page);
    await page.goto("/");
    await waitForHydration(page);
    await page.waitForFunction(() => !!window.__atlasMap, undefined, { timeout: 15_000 });
    await expect(banner(page)).toBeHidden();

    // the boot-time data-origin probe (trigger a) fires as soon as `early.version` resolves --
    // give it (and a misclassification, were the bug still present) time to actually land.
    await page.waitForTimeout(5000);
    await expect(banner(page)).toBeHidden();
  });
});
