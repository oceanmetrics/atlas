// atlas-map: the shared map module, on the REAL shell, fully hermetic.
//
// The assertion that carries the maplibre-gl 6.10 pin is the VECTOR one (docs/spikes/S2.md,
// consequence 4): `isSourceLoaded()` AND `queryRenderedFeatures().length > 0`, with the failure
// message naming the layer. The vector source here is a gazetteer place layer (the default-on
// "NOAA national marine sanctuaries" overlay): the hermetic gazetteer answers its `places.pmtiles` with
// the repo's one real 7 KB archive (`e2e/fixtures/map/zones.pmtiles`, four rectangles in US waters). Rasters paint with a dead worker, so a `readPixels` gate alone is not a
// check — the `?url` wiring produces a build that paints tiles and silently never parses a single
// vector tile.
//
// atlas-8 step 2: widened from chromium-only to all three engines. S2's numbers were measured on
// headless Chromium/swiftshader only; WebKit and Firefox's headless GL stacks needed their own
// measurement, done here -- all four assertions below (vector render, raster paint, theme-swap
// setStyle, camera replaceState) pass on all three, at comparable speed (measured: 6-8s for the
// whole file per engine, vs ~2s for chromium alone in the original S2 note -- no fault of the
// engines here; see scripts/verify.mjs's own note on running MANY pages back to back).
import { expect, test, type Page } from "@playwright/test";
import { collectConsoleErrors, collectRequests, routeBucket, waitForHydration } from "./hermetic";
import {
  BASEMAP_RGB_BY_THEME,
  RASTER_RGB,
  SCORE_COG_URL,
  blockWasm,
  renderedLayerCount,
  routeBasemapStyle,
  routeGlyphs,
  routeTitilerTiles,
} from "./map-hermetic";

// SERIAL, on purpose (S2 consequence 12, "the timing gate runs alone"): four WebGL maps built at
// once on one software GL renderer, inside a suite already running three engines in parallel, is
// contention — observed as `isSourceLoaded()` still false after 20 s in a run where the same test
// passes in 2 s alone. The assertions are unchanged; only their concurrency is.
test.describe.configure({ mode: "serial" });

// the repo's desktop viewport (scripts/verify.mjs's matrix), pinned here because the probe points
// below are only inside the canvas at a known size — the default device viewport left the map
// 300 px tall and put the Gulf probe off the bottom edge (measured, atlas-map).
test.use({ viewport: { width: 1280, height: 800 } });

/** two points in open ocean, inside the default FULL camera on a 1280×800 desktop viewport. */
const OCEAN_PROBES: Array<[number, number]> = [
  [-90, 26], // Gulf of America
  [-125, 38], // off central California
];

declare global {
  interface Window {
    __atlasMap?: {
      handle: {
        map: {
          isSourceLoaded(id: string): boolean;
          queryRenderedFeatures(opts: { layers: string[] }): unknown[];
          getCanvas(): HTMLCanvasElement;
          project(lngLat: [number, number]): { x: number; y: number };
          loaded(): boolean;
          getLayer(id: string): unknown;
        };
        applyStyle(style: unknown): void;
      };
      composeStyle(input: Record<string, unknown>): unknown;
      inputs(): Record<string, unknown>;
    };
  }
}

async function gotoMap(page: Page, path = "/") {
  await blockWasm(page);
  await routeBucket(page);
  await routeBasemapStyle(page);
  await routeTitilerTiles(page);
  await routeGlyphs(page);
  await page.goto(path);
  await waitForHydration(page);
  await page.waitForFunction(() => !!window.__atlasMap, undefined, { timeout: 15_000 });
}

/**
 * How many features the zones line layer is currently rendering.
 *
 * 0.10.14: the `getLayer` guard is load-bearing, not defensive noise. `Map.isSourceLoaded(id)`
 * FIRES AN ErrorEvent (`There is no tile manager with ID '<id>'`, maplibre-gl 6
 * `Map.isSourceLoaded`) when the style does not currently hold that source, and an unhandled
 * MapLibre ErrorEvent lands in `console.error` — i.e. in the very array the test below then
 * asserts is empty. This polls from the instant `window.__atlasMap` exists, which is BEFORE the
 * zones style is composed (boot.json's units are read first) and again across every
 * `setStyle(diff:true)` rebuild, so on a slow runner the poll lands in that window and the PROBE
 * manufactures the error it is about to fail on (ubuntu-latest, run 35819393922: 6-8 identical
 * errors, while the poll itself still ended >0). `getLayer` returns `undefined` for an absent
 * layer and fires nothing — the same guard `species.timing.spec.ts` already uses. The assertion
 * is unweakened: the layer must exist, its source must be loaded, AND it must render a feature.
 */
function zoneFeatureCount(page: Page) {
  return renderedLayerCount(page, "ov-noaa_sanctuaries-line", "ov-noaa_sanctuaries");
}

/** the REAL applied style (`map.getStyle()`), not a recomposed `composeStyle(inputs())` object —
 * M5 (atlas-8 review round 2). `getStyle()` is not on the shared `Window.__atlasMap` global
 * declaration (every `e2e/*.ts` file that declares that global must use the IDENTICAL shape —
 * `species-hermetic.ts`'s own header explains why — so a method only this file needs is cast in
 * locally instead of widening that shared interface everywhere). */
function getAppliedStyle(page: Page) {
  return page.evaluate(() =>
    (
      window.__atlasMap as unknown as {
        handle: { map: { getStyle(): { sprite?: string } } };
      }
    ).handle.map.getStyle(),
  );
}

/** read back one pixel of the WebGL canvas at a lon/lat (needs `preserveDrawingBuffer`). */
function readPixel(page: Page, lon: number, lat: number) {
  return page.evaluate(
    ([lng, la]) => {
      const map = window.__atlasMap!.handle.map;
      const canvas = map.getCanvas();
      const gl = (canvas.getContext("webgl2") ??
        canvas.getContext("webgl")) as WebGLRenderingContext | null;
      if (!gl) return null;
      const dpr = canvas.width / canvas.clientWidth;
      const p = map.project([lng, la]);
      const px = new Uint8Array(4);
      gl.readPixels(
        Math.round(p.x * dpr),
        Math.round(canvas.height - p.y * dpr),
        1,
        1,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        px,
      );
      return [px[0], px[1], px[2], px[3]];
    },
    [lon, lat] as const,
  );
}

test.describe("map module, first paint with **/*.wasm blocked", () => {
  test("renders a VECTOR feature from a place layer's PMTiles", async ({ page }) => {
    const errors = collectConsoleErrors(page);
    const requests = collectRequests(page);
    await gotoMap(page);

    await expect
      .poll(() => zoneFeatureCount(page), {
        message:
          'source "ov-noaa_sanctuaries" / layer "ov-noaa_sanctuaries-line" never rendered a vector feature — ' +
          "the maplibre worker is the first thing to check (docs/spikes/S2.md: the `?url` wiring " +
          "paints rasters and silently parses no vector tiles)",
        timeout: 20_000,
      })
      .toBeGreaterThan(0);

    // no worker/shared 404 and no wasm byte (S2 consequence 4 + plan D3 Tier 0)
    expect(requests.filter((u) => /\.wasm(\?|$)/.test(u))).toEqual([]);
    expect(requests.filter((u) => /duckdb/i.test(u))).toEqual([]);
    expect(errors).toEqual([]);
  });

  // regression: zone-layer-renders-with-left-dock (R4-ci, 2026-10-01). Round 4 docked the panel
  // LEFT by default, which moved the fit's centre; on the globe MapLibre's no-geometry viewport
  // query then answered [] for the painted lines, so specs read "no layer". This pins the real
  // property: under the default left dock the Program Area lines ARE drawn where the fixture says
  // (a box query around Central California's rectangle hits), and the probe + the app's
  // `renderedZoneOutline` both see them.
  test("zone-layer-renders-with-left-dock: the zone lines are drawn and countable under the default left dock", async ({
    page,
  }) => {
    // a camera over the fixture rectangle (explicit, so the collection fit does not move it)
    await gotoMap(page, "/?map=-125,38,4");
    await expect.poll(() => zoneFeatureCount(page), { timeout: 20_000 }).toBeGreaterThan(0);
    const dock = await page.evaluate(() =>
      document.querySelector("[data-panel-dock]")?.getAttribute("data-panel-dock"),
    );
    expect(dock, "the default desktop dock is left (R4-B)").toBe("left");
    const hits = await page.evaluate(() => {
      const map = window.__atlasMap!.handle.map as unknown as {
        project(l: [number, number]): { x: number; y: number };
        queryRenderedFeatures(
          g: [[number, number], [number, number]],
          o: { layers: string[] },
        ): unknown[];
      };
      // CAA fixture rectangle (-129..-121 x 34..42): its west edge midpoint
      const p = map.project([-129, 38]);
      return map.queryRenderedFeatures(
        [
          [p.x - 12, p.y - 12],
          [p.x + 12, p.y + 12],
        ],
        { layers: ["ov-noaa_sanctuaries-line"] },
      ).length;
    });
    expect(hits, "the CAA line must be hit-testable at its drawn position").toBeGreaterThan(0);
  });

  test("paints a raster at two ocean probe points", async ({ page }) => {
    // `ov=` (no place layers): their faint fills would tint the probed pixel; the explicit camera keeps
    // both probe points on screen (the default view fits the collection's extent)
    await gotoMap(page, "/?ov=&map=-105,34,2.2");
    await page.waitForFunction(() => window.__atlasMap!.handle.map.loaded(), undefined, {
      timeout: 20_000,
    });

    // atlas-8 fix round 1 (root cause, instrumented with page.on("response")/a monkey-patched
    // applyStyle, not guessed): Shell.svelte's own `$effect` re-applies ITS composed style
    // (`raster: scoresLens?.mapExtra.raster ?? null`) whenever `scoresLens` changes -- and
    // `../lens/scores/state.svelte`, lazy-loaded (`import("../lens/scores/state.svelte")`) and
    // instantiated by DEFAULT (lens="scores" is the default), flips `scoresLens` from `null` to
    // the real store exactly once, the moment that chunk resolves (0.10.21 fix 1: this used to be
    // `ScoresLens.svelte`'s own `$effect`/`bind:mapExtra` -- the PANEL component, before the
    // map-input store moved to a lens-level module the panel being mounted has no bearing on).
    // That state flip is what re-triggers Shell's effect and wipes out ANY raster this test
    // injects before that lazy chunk finishes fetching+parsing+running -- a race this repo's own
    // module-loading timing usually won on Chromium and reproducibly lost on WebKit/Firefox
    // (measured: "no tile manager with ID 'r_lyr'" once the layer was removed out from under an
    // in-flight tile). `map.loaded()` and even "boot's zones arrived" say nothing about whether
    // that lazy store has ALSO resolved, so the fix is not a longer wait for a single event but a
    // self-healing one: (re-)inject the raster as part of EVERY poll iteration, not once before
    // it, so the injection that survives is always the LAST one relative to the store's resolve,
    // whichever engine's module-loading timing wins that race.
    const injectRaster = (cog: string) =>
      page.evaluate((cogUrl) => {
        const api = window.__atlasMap!;
        api.handle.applyStyle(
          api.composeStyle({
            ...api.inputs(),
            projection: "mercator", // a flat probe: globe warps where a fixed lon/lat lands
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
      }, cog);

    await injectRaster(SCORE_COG_URL);

    for (const [lon, lat] of OCEAN_PROBES) {
      await expect
        .poll(
          async () => {
            await injectRaster(SCORE_COG_URL); // re-assert: cheap, idempotent once settled
            return (await readPixel(page, lon, lat))?.slice(0, 3).join(",");
          },
          {
            message: `no raster pixel painted at ${lon},${lat}`,
            timeout: 20_000,
          },
        )
        .toBe(RASTER_RGB.join(","));
    }
  });

  // M5 (atlas-8 review round 2): the old version of this test proved neither the swap nor the
  // paint — "swapped" was read off `JSON.stringify(composeStyle(inputs()))`, a RECOMPOSED style
  // object the map may never have applied, and "painted" was `readPixel(...) != null`, which a
  // dead WebGL context (`null` background too) would also satisfy trivially. Both fixture themes
  // also shared one water colour (`map-hermetic.ts`'s old `BASEMAP_RGB` for both), so even a
  // correct pixel probe could not have told them apart. Now: `map.getStyle()` (the REAL applied
  // style, not a recomposition) carries the theme's `sprite`, and an ocean pixel is read back
  // before/after and checked against each theme's OWN fixture colour
  // (`BASEMAP_RGB_BY_THEME`, map-hermetic.ts) — proving the swap is actually rendered, not just
  // declared.
  test("a theme switch swaps the basemap and keeps the zones drawn", async ({ page }) => {
    // an explicit camera that keeps the open-ocean probe (0, 0) on screen (the default view fits the
    // collection's extent, the US Atlantic coast)
    await gotoMap(page, "/?map=-30,10,2");
    await expect.poll(() => zoneFeatureCount(page), { timeout: 20_000 }).toBeGreaterThan(0);

    const before = await page.evaluate(() => document.documentElement.dataset.theme);
    const beforeTheme = before === "navy" ? "navy" : "paper";

    const styleBefore = await getAppliedStyle(page);
    expect(styleBefore.sprite).toContain(beforeTheme === "navy" ? "dark-matter" : "positron");
    // a real painted pixel, not the declared style — open ocean, no zone line under it (0,0).
    // POLLED, not a single read: `zoneFeatureCount` above only proves the ZONE pmtiles fetch
    // landed, a separate async source from the basemap's OWN CARTO style.json + tile fetch —
    // under heavy contention (measured: a full multi-engine suite run) the basemap can still be
    // mid-fetch (reading the flat `--surface-map` background colour) even after zones settle.
    await expect
      .poll(async () => (await readPixel(page, 0, 0))?.slice(0, 3), { timeout: 30_000 })
      .toEqual(BASEMAP_RGB_BY_THEME[beforeTheme]);

    await page.locator('[data-control="theme"]').click();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.dataset.theme))
      .not.toBe(before);

    // the zones survive the setStyle(diff) — the regression a piecemeal addLayer() would produce
    await expect.poll(() => zoneFeatureCount(page), { timeout: 20_000 }).toBeGreaterThan(0);

    const afterTheme = beforeTheme === "navy" ? "paper" : "navy";
    const styleAfter = await getAppliedStyle(page);
    expect(styleAfter.sprite).toContain(afterTheme === "navy" ? "dark-matter" : "positron");
    // the fixtures really do differ (would make the pixel assertion below vacuous otherwise)
    expect(BASEMAP_RGB_BY_THEME[afterTheme]).not.toEqual(BASEMAP_RGB_BY_THEME[beforeTheme]);
    // the SAME pixel now reads the OTHER theme's colour — proves the swap actually painted
    await expect
      .poll(async () => (await readPixel(page, 0, 0))?.slice(0, 3), { timeout: 30_000 })
      .toEqual(BASEMAP_RGB_BY_THEME[afterTheme]);
  });

  test("the camera is written back to the URL with replaceState, debounced", async ({ page }) => {
    await gotoMap(page);
    const historyLength = await page.evaluate(() => history.length);
    await page.evaluate(() => {
      // a user-driven move (no `atlasProgrammatic` event data) — the same path a drag takes
      (window.__atlasMap!.handle.map as unknown as { jumpTo(o: unknown): void }).jumpTo({
        center: [-89.089, 26.251],
        zoom: 3.74,
      });
    });
    await expect.poll(() => page.url(), { timeout: 5_000 }).toContain("map=-89.089,26.251,3.74");
    // replaceState, never pushState: a link reproduces its view without growing a back stack
    expect(await page.evaluate(() => history.length)).toBe(historyLength);
  });
});
