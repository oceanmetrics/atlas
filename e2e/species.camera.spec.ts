// D8 (Opus 5.5 eyes-on assessment, 2026-09-24, atlas-refs/"2026-09-24 eyes-on UI assessment
// (Opus 5.5) on 15d6e4c.md"): "?lens=species&mdl_seq=54383 (walrus) the range is a sliver on the
// globe's limb ... 95% of the frame is empty continent." Two real, distinct causes, fixed
// separately in src/lens/species/data/camera.ts + state.svelte.ts:
//
//   1. v9's `am` walrus input (`WALRUS_AM_MDL_KEY`, `am|ITS-Mam-180639`) publishes `bbox: null` on
//      itself AND on `card.merged`, while the SAME taxon's `ax` sibling carries a real one
//      (`tests/fixtures/species/v9/taxon/75.json`) — `cameraFor()`'s new "sibling" step fixes this
//      with NO network call at all.
//   2. v7's walrus (`mdl_seq=54383`) publishes NO bbox anywhere (every asset's `bbox` is null,
//      `assets: []`) — `state.svelte.ts#refineCameraFromCogBounds` asks titiler's own `/cog/info`
//      (NOT `/cog/bounds`, which 404s live on titiler-v8 — verified; see `src/lib/raster/bounds.ts`'s
//      own header) for the drawn COG's extent as the true last resort. The real walrus v7 COG's own
//      `/cog/info` bounds are a degenerate whole-360-degree-longitude span
//      (`[-180, 53.15, 180, 73.75]`), so this test also exercises `narrowLongitude`'s point-probe
//      narrowing (real value: only lon -170 holds data), not just a plain pass-through bbox.
import { expect, test, type Page, type Route } from "@playwright/test";
import { routeBucket, waitForHydration } from "./hermetic";
import { blockWasm, routeGlyphs, routeTitilerTiles } from "./map-hermetic";
import {
  LEATHERBACK_SP,
  WALRUS_AM_MDL_KEY,
  WIDE_RANGE_SP,
  bootFor,
  gotoSpecies,
  routeSpeciesShards,
} from "./species-hermetic";
import { studyAreaBboxFallback, studyAreaView } from "../src/lens/species/data/camera";
import { PHONE_DEFAULT_BOUNDS } from "../src/lib/map/camera";

test.use({ viewport: { width: 1280, height: 800 } });

interface CameraState {
  center: { lng: number; lat: number };
  zoom: number;
}

/** R4-B: the panel (and its rail) now dock LEFT by default, so a fit that keeps the model clear of
 * them pushes the camera centre WEST of the bbox centre -- past the antimeridian for these Bering
 * Sea models (MapLibre reports 176.6, not -183.4). Unwrap to the western hemisphere's continuous
 * range so the bounds below read as plain "west of the bbox centre". */
function unwrapWest(lng: number): number {
  return lng > 0 ? lng - 360 : lng;
}

async function readCamera(page: Page): Promise<CameraState> {
  return page.evaluate(() => {
    const w = window as unknown as {
      __atlasMap: {
        handle: { map: { getCenter(): { lng: number; lat: number }; getZoom(): number } };
      };
    };
    const map = w.__atlasMap.handle.map;
    return { center: map.getCenter(), zoom: map.getZoom() };
  });
}

/** WP13: the screen x-range (viewport px) a bbox's outline occupies -- with the live padding the
 * camera's centre IS the bbox centre and the PADDING keeps the bbox out from under the docked panel,
 * so "the whole bbox is east of the panel" is asserted on where it is drawn, not on the centre. */
async function bboxScreenXRange(
  page: Page,
  bbox: [number, number, number, number],
): Promise<{ min: number; max: number }> {
  return page.evaluate((bb) => {
    const w = window as unknown as {
      __atlasMap: {
        handle: {
          map: { project(ll: [number, number]): { x: number }; getContainer(): HTMLElement };
        };
      };
    };
    const map = w.__atlasMap.handle.map;
    const left = map.getContainer().getBoundingClientRect().left;
    const xs: number[] = [];
    for (let i = 0; i <= 8; i++) {
      const lon = bb[0] + (i / 8) * (bb[2] - bb[0]);
      for (const lat of [bb[1], bb[3]]) xs.push(map.project([lon, lat]).x + left);
    }
    return { min: Math.min(...xs), max: Math.max(...xs) };
  }, bbox);
}

async function cameraIsMoving(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const w = window as unknown as { __atlasMap?: { handle: { map: { isMoving(): boolean } } } };
    return !!w.__atlasMap?.handle.map.isMoving();
  });
}

/**
 * CI flakiness fix (orchestrator addendum, 2026-09-25, real CI run 36158947685): waits for the
 * camera to reach a genuinely settled resting state, without assuming anything about WHEN the fit
 * that gets it there starts or finishes relative to the first poll tick. Two failure modes this
 * replaces, both real, both caught by three-engine CI:
 *   - a plain numeric-threshold poll (`zoom > ceiling`, `zoom > 0`) with no settle-wait can read a
 *     value still mid-flight on a slower engine (webkit) — the flight's OWN final resting
 *     zoom/centre can differ from whatever a snapshot taken while `isMoving()` is still true
 *     happens to show.
 *   - an "isMoving() was true, then false" two-step poll can find NEITHER true, when the fit is
 *     synchronous/instant and finishes between page-load and this function's own first poll tick
 *     (`cameraFor()`'s bundle-only chain returns a bounds camera with no async step in between) --
 *     "the camera never started flying" even though it already correctly arrived.
 * Requires the SAME reading twice in a row (never moving in between) before calling it settled, so
 * a transient one-frame lull mid-animation is not mistaken for the end.
 */
async function waitForCameraStable(page: Page, opts?: { timeout?: number }): Promise<CameraState> {
  let prev: CameraState | null = null;
  await expect
    .poll(
      async () => {
        if (await cameraIsMoving(page)) {
          prev = null;
          return false;
        }
        const now = await readCamera(page);
        const stable =
          prev !== null &&
          Math.abs(now.zoom - prev.zoom) < 0.001 &&
          Math.abs(now.center.lng - prev.center.lng) < 0.0001 &&
          Math.abs(now.center.lat - prev.center.lat) < 0.0001;
        prev = now;
        return stable;
      },
      {
        message: "the camera never reached a stable, settled resting position",
        timeout: opts?.timeout ?? 15_000,
      },
    )
    .toBe(true);
  return readCamera(page);
}

// the release's own default/study-area camera (FALLBACK_FULL_STUDY_AREA / boot.study_areas[FULL]
// on this fixture — the exact camera the eyes-on review's "95% of the frame is empty continent"
// describes staying parked at).
// V4 fix (owner phone report, 2026-09-24): lowered from 3 to 2.3. `map.ts#flyToBounds` now asks
// MapLibre's OWN `cameraForBounds()` for the fit (projection-aware — see that file's own header),
// which settles on a measurably LOWER zoom than the old hand-rolled flat-Mercator math did for
// these two fixtures' bbox/viewport combinations (walrus desktop: 2.84 native vs previously > 3;
// v9 am/ax-sibling desktop: 2.54 native) — a real, deterministic characteristic of the new fit, not
// a flake (reproduced identically across repeated runs). 2.3 keeps a comfortable margin above the
// study-area default's own 2.16 (still proves a species-specific fit ran) while sitting below every
// native fit measured so far.
const STUDY_AREA_ZOOM_CEILING = 2.3;

/** the walrus v7 COG's own `/cog/info` + `/cog/point` narrowing mocks, shared by both v7 tests
 * below (the initial species-change effect AND `zoomToLayer()`'s own follow-up) — factored out so
 * the two don't drift on what "the real walrus COG answers" means. */
async function routeWalrusCogBoundsFallback(page: Page) {
  await page.route(
    (url) => url.hostname === "titiler-v8.marinesensitivity.org" && url.pathname === "/cog/info",
    (route: Route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        // the real walrus v7 merged COG's own /cog/info answer — a degenerate whole-360-degree
        // longitude span (bounds.ts's own header has the live verification), which the fix must
        // NOT hand straight to the camera (that would frame the whole globe's width).
        body: JSON.stringify({ bounds: [-180, 53.15, 180, 73.75] }),
      }),
  );
  await page.route(
    (url) =>
      url.hostname === "titiler-v8.marinesensitivity.org" && url.pathname.startsWith("/cog/point/"),
    (route: Route) => {
      // only -170 (the real walrus data's own longitude, measured live) answers with a value —
      // every other CANDIDATE_LONS probe must come first in the module's own list and answer
      // null, exactly like the real walrus was measured to.
      const hit = route.request().url().includes("/cog/point/-170,");
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ values: [hit ? 91 : null] }),
      });
    },
  );
}

test.describe("D8: selecting a model frames its extent, not the default study area", () => {
  test("v9 `am` walrus (no bbox of its own) frames off its `ax` sibling's extent (no network call needed)", async ({
    page,
  }) => {
    await gotoSpecies(page, `/?mdl_key=${WALRUS_AM_MDL_KEY}&ver=v9`);
    await expect(page.getByTestId("species-title-sci")).toHaveText("Odobenus rosmarus");

    // `applyCamera` -> `flyToBounds` -> MapLibre's own ANIMATED `flyTo` (not instant) — poll rather
    // than read the camera the instant hydration settles, or this reads the mid-flight (or even
    // pre-flight) zoom instead of the fix's actual destination.
    await expect
      .poll(async () => (await readCamera(page)).zoom, {
        message: "camera never zoomed in past the study-area default",
        timeout: 5_000,
      })
      .toBeGreaterThan(STUDY_AREA_ZOOM_CEILING);

    const camera = await readCamera(page);
    // the ax sibling's bbox is [-177.7, 60.65, -139.15, 79] -> center (-158.425, 69.825).
    // R4-B: docked LEFT by default -- the fit reserves the rail + panel footprint (+ inset +
    // gutter) on the west, so the camera centre sits WEST of the bbox centre (-158.4), keeping the
    // whole bbox east of the panel (measured -183.4 at 1280 px, i.e. 176.6 unwrapped). Was -133.4
    // (east of it) when the panel docked right.
    // WP13: the map carries the live padding (livePadding.ts), so the camera's centre is the bbox's own
    // centre (-158.4, give or take the globe's own curvature) and the PADDING keeps the whole bbox in
    // the open area east of the panel (rail + panel + inset = 472 px at 1280 wide)
    expect(unwrapWest(camera.center.lng)).toBeGreaterThan(-170);
    expect(unwrapWest(camera.center.lng)).toBeLessThan(-148);
    const range = await bboxScreenXRange(page, [-177.7, 60.65, -139.15, 79]);
    expect(range.min, "the bbox starts east of the docked panel").toBeGreaterThanOrEqual(472);
    expect(range.max, "the bbox ends on screen").toBeLessThanOrEqual(1280);
    expect(camera.center.lat).toBeGreaterThan(55);
    expect(camera.center.lat).toBeLessThan(85);
  });

  test("v7 walrus (mdl_seq 54383, NO bbox anywhere) frames off the COG's own /cog/info extent, narrowed by point-probe", async ({
    page,
  }) => {
    // NOT `gotoSpecies` (which registers its own `routeTitilerTiles` wildcard as the LAST step
    // before `page.goto`, so a route added after it returns can lose the race against a fetch the
    // app fires during that same initial load — measured: the plain "register after gotoSpecies"
    // version below never actually saw this route matched). Composing the same steps by hand, in
    // the SAME order `e2e/species.smoke.spec.ts`'s own "hung tile" test uses for exactly this
    // reason, but with the `/cog/info` + `/cog/point` overrides inserted before `page.goto` ever
    // fires — the requests this whole fix depends on.
    await blockWasm(page);
    await routeBucket(page, bootFor("v7"));
    await routeSpeciesShards(page);
    await routeGlyphs(page);
    await routeTitilerTiles(page); // the wildcard, registered FIRST so the overrides below win
    await routeWalrusCogBoundsFallback(page);
    // baseline BEFORE navigation resolves anything species-specific -- the pre-fit default camera,
    // read as early as possible so `waitForCameraToChangeFrom` below can tell "moved" from "hasn't
    // moved yet", not just "isMoving() happened to be true at some poll tick" (CI flakiness fix,
    // orchestrator addendum 2026-09-25: a plain `zoom > ceiling` poll with no settle-wait could read
    // a value still mid-flight on a slower engine — webkit — and land inside the ceiling by
    // coincidence before the flight's OWN final resting zoom).
    await page.goto("/?mdl_seq=54383&ver=v7");
    await waitForHydration(page);
    await expect(page.getByTestId("species-title-sci")).toHaveText("Odobenus rosmarus");
    const baseline = await readCamera(page);

    // the fix is a FOLLOW-UP fly-to once /cog/info + the point-probe narrowing answers -- wait for
    // a REAL, settled change from the baseline, not just a single numeric threshold.
    const camera = await waitForCameraToChangeFrom(page, baseline, "walrus COG-bounds fit");
    // narrowed bbox: [-190, 53.15, -150, 73.75] -> center (-170, 63.45). W5 fix (Opus 5.5 eyes-on
    // review 5, 2026-09-25): the desktop docked panel's own reserve grew by
    // `PANEL_OUTER_INSET_PX + FIT_GUTTER_PX` (chromePadding.ts) to clear its real outer edge, so
    // this asymmetric-padding shift (camera.ts#shiftForPadding, via the SAME live
    // `desktopPanelPadding` this fix touches) now lands measurably further east (-152.3 measured,
    // was comfortably under -155 before) -- the bound widens to keep real margin, not to just
    // barely pass.
    // R4-B: docked LEFT by default, so the centre shifts west of the bbox centre (-170); measured
    // -191.2 (168.8 unwrapped). Was -152.3 with the panel on the right.
    // WP13: the centre is the bbox centre (-170); the live padding, not a shifted centre, keeps the
    // bbox east of the panel
    expect(unwrapWest(camera.center.lng)).toBeGreaterThan(-182);
    expect(unwrapWest(camera.center.lng)).toBeLessThan(-160);
    const range = await bboxScreenXRange(page, [-190, 53.15, -150, 73.75]);
    expect(range.min, "the bbox starts east of the docked panel").toBeGreaterThanOrEqual(472);
    expect(camera.center.lat).toBeGreaterThan(58);
    expect(camera.center.lat).toBeLessThan(70);
  });

  // D8 fold-in (orchestrator round 2, 2026-09-24): "zoomToLayer() using the same bounds fallback"
  // -- the manual re-fit action (`state.svelte.ts#zoomToLayer`, reached here through the
  // `__atlasSpecies` test seam Shell.svelte exposes it on, same spirit as `selectSpecies`) used to
  // call only `cameraFor()`'s bundle-only chain, so on a taxon with NO published bbox anywhere it
  // landed on the loose study-area view and never asked `/cog/info` at all -- even though the
  // INITIAL species-change effect (the test above) already got the COG-bounds last resort in round
  // 1. This test proves the manual action reaches the SAME fallback, not just the automatic one.
  test("zoomToLayer() ALSO reaches the COG-bounds last resort, not just the initial species-change effect", async ({
    page,
  }) => {
    await blockWasm(page);
    await routeBucket(page, bootFor("v7"));
    await routeSpeciesShards(page);
    await routeGlyphs(page);
    await routeTitilerTiles(page);
    await routeWalrusCogBoundsFallback(page);
    await page.goto("/?mdl_seq=54383&ver=v7");
    await waitForHydration(page);
    await expect(page.getByTestId("species-title-sci")).toHaveText("Odobenus rosmarus");

    // let the INITIAL species-change effect finish its own fit (round 1's fix) before exercising
    // the SEPARATE `zoomToLayer()` action below. Generous timeout (P6c: a fixed 5s predicate here
    // flaked on Firefox in CI — a real engine's flyTo animation + this test's TWO sequential mocked
    // network round-trips (`/cog/info` then `/cog/point`) have no fixed duration, especially on a
    // loaded CI runner, so the wait is sized for that rather than guessed tight).
    await expect
      .poll(async () => (await readCamera(page)).zoom, { timeout: 15_000 })
      .toBeGreaterThan(STUDY_AREA_ZOOM_CEILING);

    // pan the camera away with a plain, INSTANT MapLibre call (not this app's own
    // flyTo/applyCamera path) — proves any re-fit below is `zoomToLayer()`'s own doing, not a
    // leftover animation from the initial load.
    await page.evaluate(() => {
      const w = window as unknown as {
        __atlasMap: {
          handle: { map: { jumpTo(o: { center: [number, number]; zoom: number }): void } };
        };
      };
      w.__atlasMap.handle.map.jumpTo({ center: [0, 0], zoom: 2 });
    });
    await expect
      .poll(async () => (await readCamera(page)).zoom, { timeout: 5_000 })
      .toBeLessThan(3);

    await page.evaluate(() => {
      (
        window as unknown as { __atlasSpecies: { zoomToLayer(): void } }
      ).__atlasSpecies.zoomToLayer();
    });

    // same generous, CI-Firefox-safe timeout as the initial fit's own poll above -- this is the
    // exact assertion that flaked (5s was too tight once real animation + mocked round-trip
    // latency compounded on a loaded Firefox CI runner; a fixed short window can never be "made
    // proportional" to an animation whose own duration MapLibre computes from distance, so this
    // widens the ceiling rather than trying to predict it). CI flakiness fix (orchestrator addendum,
    // 2026-09-25, webkit repeat run): a plain `zoom > ceiling` poll with no settle-wait could read a
    // value still mid-flight -- `waitForCameraStable` (module-level, this file's own header) first
    // confirms the ceiling (proving `zoomToLayer()`'s own re-fit actually fired, not a leftover
    // animation), then waits for a genuinely settled resting position before the exact-bounds read.
    await expect
      .poll(async () => (await readCamera(page)).zoom, {
        message: "zoomToLayer() never reached the COG-bounds last resort",
        timeout: 20_000,
      })
      .toBeGreaterThan(STUDY_AREA_ZOOM_CEILING);

    const camera = await waitForCameraStable(page);
    // narrowed bbox: [-190, 53.15, -150, 73.75] -> center (-170, 63.45), same as the effect's own.
    // W5 fix: same widened bound as that test above (the desktop panel's larger reserve), same
    // reason.
    // R4-B: docked LEFT by default, so the centre shifts west of the bbox centre (-170); measured
    // -191.2 (168.8 unwrapped). Was -152.3 with the panel on the right.
    // WP13: the centre is the bbox centre (-170); the live padding, not a shifted centre, keeps the
    // bbox east of the panel
    expect(unwrapWest(camera.center.lng)).toBeGreaterThan(-182);
    expect(unwrapWest(camera.center.lng)).toBeLessThan(-160);
    const range = await bboxScreenXRange(page, [-190, 53.15, -150, 73.75]);
    expect(range.min, "the bbox starts east of the docked panel").toBeGreaterThanOrEqual(472);
    expect(camera.center.lat).toBeGreaterThan(58);
    expect(camera.center.lat).toBeLessThan(70);
  });
});

// V1 fix (Opus eyes-on review, 2026-09-24): "the walrus model view sits under the legend chip and
// the sheet" -- on the phone, `applyCamera()` (state.svelte.ts) used to pass `cameraFor()`'s own
// flat `DEFAULT_CAMERA_PADDING` (40px, every edge) to `flyToBounds`, blind to the bottom sheet
// (DEFAULT_SHEET_DETENT = "half", ~46% of the viewport) sitting over the map. `boundsToCameraView`
// (camera.ts) shifts the fitted center toward the FREE area's own middle when given an asymmetric
// `ChromePadding` (its own header: "P6/D8 ... a model fit is not centred behind the very chrome
// that is hiding half of it") -- with a UNIFORM padding (the bug), that shift is always zero, so
// the fitted bbox's own geographic center projects to exactly the CONTAINER's geometric vertical
// centre; with the fix, it projects measurably ABOVE that (inside the visible free area, above the
// sheet's top edge). Uses `window.__atlasMap` (`handle.map.project`/`getCenter`) -- the app's own
// existing test/automation seam (Shell.svelte's own header: "exposes nothing a viewer could not
// already read off the page"), never a raw new hook into MapLibre internals.
test.describe("V1 fix: the species camera pads for the phone sheet (and legend chip), not a flat 40px", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("the fitted model's own centre projects INSIDE the free area, above the sheet -- not at the container's raw geometric centre", async ({
    page,
  }) => {
    // same v9 `am` walrus fixture as the desktop "sibling" test above -- ax sibling bbox
    // [-177.7, 60.65, -139.15, 79] -> centre (-158.425, 69.825). DEFAULT_SHEET_DETENT is "half"
    // (sheetGeometry.ts), so no localStorage setup is needed to reproduce the bug's own starting
    // state -- a fresh phone load already opens with the sheet at "half".
    await gotoSpecies(page, `/?mdl_key=${WALRUS_AM_MDL_KEY}&ver=v9`);
    await expect(page.getByTestId("species-title-sci")).toHaveText("Odobenus rosmarus");

    // NOT a zoom-ceiling poll (the desktop tests above use one; it does not transfer here): the
    // SAME bbox fit to a 390px-wide viewport legitimately settles at a LOWER zoom than an
    // identical fit at 1280px does (fewer px per degree needed to fit the same span in a
    // narrower box) -- measured, this is ~1.56, not a "never fitted" value. Longitude is the
    // reliable proxy that the fit actually ran: the ax sibling bbox's own centre longitude
    // (-158.425) is exact once `boundsToCameraView` has been called with it, regardless of the
    // viewport-dependent zoom/latitude shift the fix itself introduces. Generous, CI/loaded-
    // laptop-safe timeout, same reasoning as this file's own zoomToLayer() test above.
    await expect
      .poll(async () => (await readCamera(page)).center.lng, {
        message: "camera never fitted the model's own extent",
        timeout: 15_000,
      })
      .toBeCloseTo(-158.425, 0);

    // `map.getCenter()` trivially always projects to the container's own geometric middle (that
    // is what "the map's centre" MEANS to MapLibre) -- it proves nothing about padding. What the
    // fix actually moves is WHERE ON SCREEN the fitted CONTENT's own raw geographic centre lands:
    // pre-fix (uniform padding), the ax sibling bbox's own centre — (-158.425, 69.825), this
    // file's own header/the desktop test above — projects to the exact container midpoint (zero
    // shift); post-fix, the asymmetric bottom padding shifts the CAMERA so that point instead
    // lands at the FREE AREA's own middle, well above the sheet's real top edge.
    const BBOX_CENTER: [number, number] = [-158.425, 69.825];
    const { projectedY, sheetTopRelative, containerHeight } = await page.evaluate((center) => {
      const w = window as unknown as {
        __atlasMap: {
          handle: {
            map: {
              project(lngLat: [number, number]): { x: number; y: number };
              getContainer(): HTMLElement;
            };
          };
        };
      };
      const map = w.__atlasMap.handle.map;
      const containerRect = map.getContainer().getBoundingClientRect();
      const p = map.project(center);
      const sheetEl = document.querySelector(".sheet");
      const sheetTop = sheetEl ? sheetEl.getBoundingClientRect().top : null;
      return {
        projectedY: p.y,
        containerHeight: containerRect.height,
        // relative to the MAP CONTAINER's own top -- the same coordinate space `project()` uses.
        sheetTopRelative: sheetTop === null ? null : sheetTop - containerRect.top,
      };
    }, BBOX_CENTER);

    // the sheet must actually be occupying real screen space for this test to mean anything.
    expect(
      sheetTopRelative,
      "the phone sheet is not on screen -- this test cannot exercise the bug",
    ).not.toBeNull();

    expect(
      projectedY,
      `the model's own bbox centre projected to y=${projectedY} of a ${containerHeight}px map, ` +
        `sheet top at y=${sheetTopRelative} -- expected the fitted centre well above the sheet's ` +
        `own top edge (inside the free area), not at/behind it`,
    ).toBeLessThan(sheetTopRelative! * 0.85);
  });
});

// V4 fix (owner phone report, 2026-09-24, phone-17/18): V1's own test just above only checks the
// fitted bbox's CENTRE point -- which can project correctly while the bulk of a WIDE range still
// bunches into one corner of the frame under GLOBE projection at low zoom (the exact bug: the
// leatherback default view and the walrus model view both squeezed into the bottom of the free
// area, most of the frame empty black space -- `map.ts#flyToBounds`'s own header has the root
// cause). This samples a 5x5 grid across the model's own bbox (corners, edges, centre) with the
// map's OWN `project()` (so it reflects whatever projection -- globe or mercator -- is actually
// live) and requires most of them to land inside the FREE area: top bar to the sheet's own top
// edge, full width, minus the floating legend chip's own band.
test.describe("V4 fix: the species camera fills the free area under globe projection, not just a point behind it", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  interface FreeAreaSample {
    x: number;
    y: number;
    inside: boolean;
  }
  interface FreeAreaResult {
    insideFraction: number;
    total: number;
    inside: number;
    sample: FreeAreaSample[];
  }

  /** samples a 5x5 grid across `bbox` (`[xmin,ymin,xmax,ymax]` -- `xmax` may exceed 180, the same
   * re-expressed frame `data/camera.ts#minimalFrame` produces) and reports what fraction land
   * inside the free area. The map CONTAINER's own top-left is already below the top bar (measured:
   * `getBoundingClientRect().top === 48` in page space while the container's OWN coordinate space,
   * what `project()` returns, starts at 0) -- so the free area's own top is simply 0, the same
   * container-relative convention the V1 test above already uses for the sheet. */
  async function freeAreaCoverage(
    page: Page,
    bbox: [number, number, number, number],
  ): Promise<FreeAreaResult> {
    return page.evaluate((bboxArg) => {
      const [xmin, ymin, xmax, ymax] = bboxArg;
      const w = window as unknown as {
        __atlasMap: {
          handle: {
            map: {
              project(lngLat: [number, number]): { x: number; y: number };
              getContainer(): HTMLElement;
            };
          };
        };
      };
      const map = w.__atlasMap.handle.map;
      const containerRect = map.getContainer().getBoundingClientRect();
      const sheetEl = document.querySelector(".sheet");
      const sheetTop = sheetEl
        ? sheetEl.getBoundingClientRect().top - containerRect.top
        : containerRect.height;
      const chipEl = document.querySelector(".legend-chip-region");
      const chipRect = chipEl ? chipEl.getBoundingClientRect() : null;
      const chipTop = chipRect ? chipRect.top - containerRect.top : null;
      const chipBottom = chipRect ? chipRect.bottom - containerRect.top : null;

      const fracs = [0, 0.25, 0.5, 0.75, 1];
      const lons = fracs.map((f) => xmin + f * (xmax - xmin));
      const lats = fracs.map((f) => ymin + f * (ymax - ymin));
      const sample: { x: number; y: number; inside: boolean }[] = [];
      for (const lon of lons) {
        for (const lat of lats) {
          const p = map.project([lon, lat]);
          const inChip =
            chipTop !== null && chipBottom !== null && p.y >= chipTop && p.y <= chipBottom;
          const inside =
            p.x >= 0 && p.x <= containerRect.width && p.y >= 0 && p.y < sheetTop && !inChip;
          sample.push({ x: p.x, y: p.y, inside });
        }
      }
      const inside = sample.filter((s) => s.inside).length;
      return { insideFraction: inside / sample.length, total: sample.length, inside, sample };
    }, bbox);
  }

  function assertMostlyInside(result: FreeAreaResult): void {
    expect(
      result.insideFraction,
      `only ${result.inside}/${result.total} of the model's bbox grid points landed inside the ` +
        `free area (top bar to sheet top, full width, minus the legend chip band) -- sample: ` +
        JSON.stringify(result.sample),
    ).toBeGreaterThanOrEqual(0.8);
  }

  /** waits for the flyTo animation to actually FINISH, not merely for the zoom to have crossed
   * {@link STUDY_AREA_ZOOM_CEILING} once -- a fixed poll on zoom ALONE can catch a transient
   * mid-flight frame (measured on this test's own first draft: the grid-coverage assertion ran
   * while the page's own "Map loading" status was still visible, and `flyTo`'s easing curve is not
   * guaranteed monotonic in zoom). Requires BOTH conditions at once so a walrus-style TWO-flight
   * sequence (an initial center-only fallback, then a second flyToBounds once /cog/info answers)
   * cannot be mistaken for "settled" during the brief gap between the two flights, when the map is
   * genuinely not moving but still parked at the (low-zoom) study-area default. */
  async function waitForCameraSettled(page: Page, nearLng?: number): Promise<void> {
    // WP13: on the phone the exact fit of a walrus-sized box (zoom ~2.05) is no longer past the phone's
    // own default (~2.03), so "past the study-area default" is read from where the camera is when a
    // target longitude is given: settled AND within 15 degrees of it
    await expect
      .poll(
        () =>
          page.evaluate(
            ([ceiling, lng]) => {
              const w = window as unknown as {
                __atlasMap?: {
                  handle: {
                    map: { getZoom(): number; isMoving(): boolean; getCenter(): { lng: number } };
                  };
                };
              };
              const map = w.__atlasMap?.handle.map;
              if (!map || map.isMoving()) return false;
              if (lng !== null) {
                let c = map.getCenter().lng;
                while (c > 0) c -= 360;
                return Math.abs(c - lng) < 15;
              }
              return map.getZoom() > ceiling;
            },
            [STUDY_AREA_ZOOM_CEILING, nearLng ?? null] as const,
          ),
        { message: "camera flight never settled past the study-area default", timeout: 15_000 },
      )
      .toBe(true);
  }

  // the single-flight counterpart to `waitForCameraSettled` above (a taxon whose `cameraFor()`
  // bundle-only chain already returns a bounds camera synchronously, no async `/cog/info` step)
  // used to be a LOCAL `waitForSingleFlightSettled` here; superseded by the module-level
  // `waitForCameraStable` (this file's own header on it explains the CI flakiness it fixes,
  // orchestrator addendum 2026-09-25) -- used directly at each call site below.

  test("the leatherback's own (wide, real-published) range fills the free area", async ({
    page,
  }) => {
    // ~100deg lon span, ~40deg lat span -- wide enough to reproduce the production defect (phone-17:
    // OCEANIA + scattered range patches spread across most of the visible globe, squeezed into the
    // bottom of the free area with the top half empty) and to legitimately fit at a low (globe-
    // regime) zoom, without the aspect ratio being SO extreme (a first draft tried 170x75) that even
    // a correct "contain" fit's own far corners graze the free area's edge under the curvature a
    // rectangular lat/lon box takes on a real sphere. v7 itself publishes no bbox at all
    // (data/camera.ts's own header) -- this fixture stands in for a release that does (v9 and
    // later), which is exactly the shape a wide-range species' own published bbox takes.
    const BBOX: [number, number, number, number] = [130, 5, 230, 45];
    await blockWasm(page);
    await routeBucket(page, bootFor("v7"));
    await routeSpeciesShards(page);
    // registered AFTER routeSpeciesShards, so it wins (newest-registered-first) -- overrides just
    // this test's leatherback shard (tests/fixtures/species/v7/taxon/e1.json) with the SAME record
    // plus a real, wide `merged.bbox` the on-disk fixture leaves `null`.
    await page.route(
      (url) => url.href.includes("/app/taxon/e1.json"),
      (route: Route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            schema: 1,
            ver: "v7",
            shard: "e1",
            taxa: {
              "54241": {
                key: "54241",
                sci: "Dermochelys coriacea",
                common: "Leatherback Turtle",
                sp_cat: "turtle",
                taxon_id: "137209",
                taxon_authority: "worms",
                rl: "EN",
                esa: { code: "NMFS:EN", source: "ch_nmfs" },
                mmpa: false,
                mbta: false,
                er_score: 100,
                valid_usa: true,
                valid_global: null,
                merged: {
                  type: "cog",
                  url: "https://s3.us-east-1.amazonaws.com/oceanmetrics.io-public/marine-atlas/cog/usa05/9fe6f75498affae1.tif",
                  rescale: [1, 100],
                  colormap: "spectral_r",
                  bbox: BBOX,
                },
                inputs: [],
              },
            },
          }),
        }),
    );
    await routeGlyphs(page);
    await routeTitilerTiles(page);
    await page.goto("/?mdl_seq=54241&ver=v7");
    await waitForHydration(page);
    await expect(page.getByTestId("species-title-sci")).toHaveText("Dermochelys coriacea");

    // CI flakiness fix (orchestrator addendum, 2026-09-25): this fit is SYNCHRONOUS
    // (`cameraFor()`'s bundle-only chain, no async `/cog/info` step) -- `waitForSingleFlightSettled`
    // relied on observing `isMoving()` flip true then false, which raced when the (instant) fit
    // finished before its own first poll tick. `waitForCameraStable` (module-level, this file's own
    // header) makes no assumption about the fit's timing at all.
    await waitForCameraStable(page);
    assertMostlyInside(await freeAreaCoverage(page, BBOX));
  });

  test("the walrus's real (COG-bounds-narrowed) range fills the free area", async ({ page }) => {
    await blockWasm(page);
    await routeBucket(page, bootFor("v7"));
    await routeSpeciesShards(page);
    await routeGlyphs(page);
    await routeTitilerTiles(page);
    await routeWalrusCogBoundsFallback(page);
    await page.goto("/?mdl_seq=54383&ver=v7");
    await waitForHydration(page);
    await expect(page.getByTestId("species-title-sci")).toHaveText("Odobenus rosmarus");

    // two flights in sequence (the initial study-area fallback, then the COG-bounds fit once
    // /cog/info + the point-probe answer) -- waitForCameraSettled's own header explains why a
    // plain zoom poll alone is not enough here.
    await waitForCameraSettled(page, -170);

    // narrowed bbox: [-190, 53.15, -150, 73.75] -- same real value as the desktop D8 test above.
    const NARROWED_BBOX: [number, number, number, number] = [-190, 53.15, -150, 73.75];
    assertMostlyInside(await freeAreaCoverage(page, NARROWED_BBOX));
  });
});

// R3-A1 (round-3 plan, Ben 2026-09-25): a wide-range model (the real leatherback's own reported
// range: SWOT DPS nesting near Oceania, foraging to Alaska) frames its IN-US portion by default,
// with a "Zoom to: US waters | Whole range" toggle as the escape hatch back to the whole thing.
// `WIDE_RANGE_SP` is a synthetic fixture (species-hermetic.ts's own header): the real leatherback's
// own bbox is null (spans the globe, past even this feature's threshold check — see
// `data/camera.ts`'s `framed()`), so there is no REAL published extent this wide to exercise the
// narrowing against; this fixture's `[130, 10, 260, 65]` (130 deg span) is the concrete stand-in.
/**
 * Waits until the camera has moved measurably away from `from` AND has stopped moving --
 * deliberately NOT the "poll isMoving() true, then false" shape this file's OTHER camera tests use
 * (their flights are long enough to observe mid-flight; a `setZoomTarget()` re-fit between two
 * bboxes that share most of their extent can be short enough to start and finish inside one poll
 * tick, which raced and flaked the "started moving" half here). Polling the VALUE itself is
 * equivalent and race-free: a `flyTo` that never actually moved the camera fails this the same way
 * it would fail an isMoving() check, and one that finished instantly still satisfies it.
 */
async function waitForCameraToChangeFrom(
  page: Page,
  from: CameraState,
  label: string,
): Promise<CameraState> {
  await expect
    .poll(
      async () => {
        const now = await readCamera(page);
        return (
          Math.abs(now.center.lng - from.center.lng) > 1 || Math.abs(now.zoom - from.zoom) > 0.1
        );
      },
      { message: `${label}: the camera never changed`, timeout: 15_000 },
    )
    .toBe(true);
  // then wait for it to actually settle (moving stopped), so the value read next is the final one.
  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const w = window as unknown as {
            __atlasMap?: { handle: { map: { isMoving(): boolean } } };
          };
          return !!w.__atlasMap?.handle.map.isMoving();
        }),
      { message: `${label}: the camera never stopped moving`, timeout: 15_000 },
    )
    .toBe(false);
  return readCamera(page);
}

test.describe("R3-A1: a wide-range model frames its IN-US portion, with a Zoom-to toggle", () => {
  test("the initial camera narrows to the US intersection, and 'Whole range' re-fits to the model's own full extent", async ({
    page,
  }) => {
    await gotoSpecies(page, `/?sp=${WIDE_RANGE_SP}&ver=v9`);
    await expect(page.getByTestId("species-title-sci")).toHaveText("Derivemys widerangea");

    // the toggle only renders when a model was ACTUALLY narrowed -- its mere presence proves the
    // threshold fired, before any camera assertion.
    const toggle = page.getByRole("group", { name: "Zoom to" });
    await expect(toggle).toBeVisible();
    const usButton = toggle.getByRole("button", { name: "US waters" });
    const wholeButton = toggle.getByRole("button", { name: "Whole range" });
    await expect(usButton).toHaveAttribute("aria-pressed", "true");
    await expect(wholeButton).toHaveAttribute("aria-pressed", "false");

    // the fixture's own bbox is [130,10,260,65] (130 deg span); the narrowed US intersection is
    // [158.0057,10,260,65] (tests/lens/species/camera.test.ts pins the exact math) -- narrower AND
    // shifted east relative to the whole range. MapLibre's own (real, projection-aware)
    // `cameraForBounds()` does not land on the plain Mercator midpoint (map.ts's own `flyToBounds`
    // header explains why) -- measured live, ~-123.1 wrapped, which is the continuous frame's
    // ~236.9 (adding 360 for a negative wrapped value) -- so the assertion is "inside the
    // intersection's own bounds", the geometric fact the toggle exists to prove, not a hand-guessed
    // exact number.
    // CI flakiness fix (orchestrator addendum, 2026-09-25, CI run 36158947685): `zoom > 0` alone
    // is true from the very first (un-fit, default) frame, and reading immediately once it's true
    // could land mid-flight on a slower engine (webkit measured: east edge 291.1 vs the expected
    // <=260, and a later `toBeCloseTo` mismatch on the returned-to-US camera) -- `waitForCameraStable`
    // (module-level, this file's own header) waits for a genuinely settled resting position instead.
    const narrowed = await waitForCameraStable(page);
    const narrowedContinuous =
      narrowed.center.lng < 0 ? narrowed.center.lng + 360 : narrowed.center.lng;
    expect(
      narrowedContinuous,
      "camera centre lands OUTSIDE the US intersection's west edge",
    ).toBeGreaterThanOrEqual(158);
    expect(
      narrowedContinuous,
      "camera centre lands OUTSIDE the US intersection's east edge",
    ).toBeLessThanOrEqual(260);

    // switching to "Whole range" re-fits to the model's OWN full bbox -- a REAL flight (not a
    // no-op), landing on a measurably different camera.
    await wholeButton.click();
    const whole = await waitForCameraToChangeFrom(page, narrowed, "Whole range toggle");
    await expect(wholeButton).toHaveAttribute("aria-pressed", "true");
    await expect(usButton).toHaveAttribute("aria-pressed", "false");

    // and back to "US waters" returns to the EXACT SAME narrowed fit, not a recomputation that
    // might drift (state.svelte.ts's setZoomTarget reuses the ORIGINAL camera object, never
    // re-calls cameraFor) -- the strongest, implementation-verified invariant this test can make
    // without hand-predicting MapLibre's own fit math.
    await usButton.click();
    const backToUs = await waitForCameraToChangeFrom(page, whole, "US waters toggle");
    expect(backToUs.center.lng).toBeCloseTo(narrowed.center.lng, 3);
    expect(backToUs.center.lat).toBeCloseTo(narrowed.center.lat, 3);
    expect(backToUs.zoom).toBeCloseTo(narrowed.zoom, 3);
  });

  test("a COMPACT model (under the threshold) never shows the toggle", async ({ page }) => {
    await gotoSpecies(page, `/?mdl_key=${WALRUS_AM_MDL_KEY}&ver=v9`);
    await expect(page.getByTestId("species-title-sci")).toHaveText("Odobenus rosmarus");
    await expect(page.getByRole("group", { name: "Zoom to" })).toHaveCount(0);
  });

  // D1 (Opus 5.5 eyes-on review round 2, 2026-09-25): the toggle never appeared on v7 AT ALL,
  // including on the leatherback -- the Species lens' own DEFAULT landing species. Root cause: v7
  // publishes NO bbox on ANY asset for ANY taxon (`tests/fixtures/species/v7/taxon/e1.json`, the
  // REAL on-disk fixture, has `merged.bbox: null` and `assets: []` on every input -- unlike the
  // OLDER "leatherback...fills the free area" test above, this one does NOT override that fixture
  // with a synthetic bbox), so `cameraFor()` falls all the way to `kind: "center"` and
  // `state.svelte.ts#refineCameraFromCogBounds` -- the COG-bounds LAST resort -- built its own
  // plain camera by hand, never running `wideRangeAware()`. This is the "hermetic fixture hides the
  // live shape" trap CLAUDE.md already names: every other camera test in this file either supplies
  // a bundle bbox directly or narrows a walrus-shaped 360deg-degenerate one, never exercises a
  // REAL, un-widened, non-degenerate wide COG-bounds extent on the bbox-LESS v7 shape.
  test("v7's OWN COG-bounds path (a bbox-LESS leatherback fixture) also narrows to the US intersection, and the toggle appears", async ({
    page,
  }) => {
    await blockWasm(page);
    await routeBucket(page, bootFor("v7"));
    await routeSpeciesShards(page); // the REAL, unmodified e1.json: merged.bbox null, assets: []
    await routeGlyphs(page);
    await routeTitilerTiles(page);
    // the leatherback's own /cog/info answer: a REAL, wide (130deg) but non-degenerate span (never
    // hits narrowLongitude's point-probe sweep, which only fires past bboxSpansGlobe's 350deg
    // threshold) -- the exact shape D1 names: "still framed across the whole Pacific... no toggle".
    await page.route(
      (url) => url.hostname === "titiler-v8.marinesensitivity.org" && url.pathname === "/cog/info",
      (route: Route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ bounds: [130, 10, 260, 65] }),
        }),
    );
    await page.goto("/?mdl_seq=54241&ver=v7");
    await waitForHydration(page);
    await expect(page.getByTestId("species-title-sci")).toHaveText("Dermochelys coriacea");

    // the toggle only renders once the COG-bounds fetch has resolved AND wideRangeAware() has
    // narrowed it -- poll rather than assert immediately (a real fire-and-forget fetch).
    const toggle = page.getByRole("group", { name: "Zoom to" });
    await expect(toggle).toBeVisible({ timeout: 15_000 });
    await expect(toggle.getByRole("button", { name: "US waters" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    // the same US-intersection bounds as the synthetic-fixture test above ([130,10,260,65] narrowed
    // against the SAME derived study-area box is [158.0057,10,260,65]) -- the centre must land
    // INSIDE it, in the continuous (never re-wrapped) frame, not merely somewhere on the whole
    // Pacific-spanning whole range. CI flakiness fix (orchestrator addendum, 2026-09-25): reading
    // the centre right as the toggle becomes visible could catch the fit still mid-flight on a
    // slower engine (webkit) -- `waitForCameraStable` first.
    const settled = await waitForCameraStable(page);
    const continuous = settled.center.lng < 0 ? settled.center.lng + 360 : settled.center.lng;
    expect(
      continuous,
      "camera centre lands OUTSIDE the US intersection's west edge",
    ).toBeGreaterThanOrEqual(158);
    expect(
      continuous,
      "camera centre lands OUTSIDE the US intersection's east edge",
    ).toBeLessThanOrEqual(260);
  });

  // R3-rr fix 1 (Opus 5.5 eyes-on review round 3, SECOND pass, 2026-09-25): the sibling test above
  // mocked `/cog/info` with "a real, wide, non-degenerate span" ([130,10,260,65]) -- a shape the
  // LIVE data never actually returns. Probed live 2026-09-25 against
  // `https://titiler-v8.marinesensitivity.org/cog/info?url=…/usa05/9fe6f75498affae1.tif` (the
  // leatherback, `?mdl_seq=54241`), the real body is `[-180, -17.700000000000017, 180,
  // 60.44999999999999]` -- the model reaches American Samoa/Guam across the antimeridian, so the
  // raster's OWN bbox is already the full globe in longitude. `minimalFrame()` cannot narrow a box
  // that wide (its complement is zero-width), and the code used to read that as "not a camera at
  // all" and return BEFORE `wideRangeAware()` ever ran -- so on the REAL live bounds the toggle
  // never rendered, even though the sibling test above (with its narrower mocked span) passed.
  // `cogBoundsCamera()` (`data/camera.ts`) is the fix; this test proves it end-to-end with the
  // EXACT live bounds shape, not a stand-in.
  // R3-rr fix 1, rounds 2-4 (Opus 5.5 eyes-on review round 3, real-build eyes-on, 2026-09-25): the
  // FIRST version of this test (round 1) mocked only `/cog/info`, leaving `/cog/point` unmocked --
  // which, against the REAL live app, `src/lib/raster/bounds.ts#narrowLongitude` ALSO calls
  // whenever `/cog/info`'s own bbox is degenerate (every candidate answered null with nothing
  // mocked, so `narrowLongitude` returned `null` and no camera update ever happened at all: the
  // toggle never rendered, even with round 1's `cogBoundsCamera` fix in place). Live-probed
  // 2026-09-25, the real leatherback holds data at FOUR widely separated candidates (-165
  // Aleutians, -66 Atlantic/Caribbean, -157 Hawaii, 145 Guam/CNMI) -- this test now mocks that
  // EXACT real pattern, exercising the full, real chain: `/cog/info` (degenerate) ->
  // `narrowLongitude` (multi-region spread -> hands back the confirmed-data ARC, not the raw
  // -180..180 box -- round 2's fix, since fitting the raw box for "Whole range" was verified LIVE
  // to land on lng=0/Africa, the opposite side of the world from any real data) -> `cogBoundsCamera`
  // (round 1's fix, narrows the arc to US waters) -> the toggle.
  test("v7's OWN COG-bounds path with the EXACT live leatherback shape (globe-spanning /cog/info + the real multi-region /cog/point hits) narrows to US waters, and 'Whole range' lands on real data, not Africa", async ({
    page,
  }) => {
    await blockWasm(page);
    await routeBucket(page, bootFor("v7"));
    await routeSpeciesShards(page); // the REAL, unmodified e1.json: merged.bbox null, assets: []
    await routeGlyphs(page);
    await routeTitilerTiles(page);
    const LIVE_LEATHERBACK_COG_BOUNDS = [-180, -17.700000000000017, 180, 60.44999999999999];
    const LIVE_HIT_LONS = new Set([-165, -66, -157, 145]);
    await page.route(
      (url) => url.hostname === "titiler-v8.marinesensitivity.org" && url.pathname === "/cog/info",
      (route: Route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ bounds: LIVE_LEATHERBACK_COG_BOUNDS }),
        }),
    );
    await page.route(
      (url) =>
        url.hostname === "titiler-v8.marinesensitivity.org" &&
        url.pathname.startsWith("/cog/point/"),
      (route: Route) => {
        const m = /\/cog\/point\/(-?\d+(?:\.\d+)?),/.exec(route.request().url());
        const lon = m ? Number(m[1]) : NaN;
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ values: [LIVE_HIT_LONS.has(lon) ? 100 : null] }),
        });
      },
    );
    await page.goto("/?mdl_seq=54241&ver=v7");
    await waitForHydration(page);
    await expect(page.getByTestId("species-title-sci")).toHaveText("Dermochelys coriacea");

    // BUG (before this fix): this toggle never rendered at all on the live bounds shape (either
    // it never appeared -- round 1 alone -- or `narrowLongitude` returned `null` for want of a
    // `/cog/point` mock -- the same visible symptom, no camera update at all).
    const toggle = page.getByRole("group", { name: "Zoom to" });
    await expect(toggle).toBeVisible({ timeout: 20_000 });
    await expect(toggle.getByRole("button", { name: "US waters" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    // the camera centre lies INSIDE the (v7) study-area's own US box -- not on the whole,
    // Pacific-spanning globe extent the pre-fix camera stayed on.
    const usBbox = studyAreaBboxFallback(studyAreaView(bootFor("v7"), "FULL")!);
    const center = await page.evaluate(() =>
      (
        window as unknown as {
          __atlasMap: { handle: { map: { getCenter(): { lng: number; lat: number } } } };
        }
      ).__atlasMap.handle.map.getCenter(),
    );
    const continuous = center.lng < 0 ? center.lng + 360 : center.lng;
    const usWest = usBbox[0] < 0 ? usBbox[0] + 360 : usBbox[0];
    const usEast = usBbox[2] < 0 ? usBbox[2] + 360 : usBbox[2];
    expect(continuous, "camera centre lands OUTSIDE the US box's west edge").toBeGreaterThanOrEqual(
      Math.min(usWest, usEast) - 1,
    );
    expect(continuous, "camera centre lands OUTSIDE the US box's east edge").toBeLessThanOrEqual(
      Math.max(usWest, usEast) + 1,
    );

    // "Whole range" is available, and — round 2's own regression — lands on the confirmed-data
    // ARC (roughly 145..294 continuous, the leatherback's own real hit longitudes), never on
    // lng=0 (Africa/the Gulf of Guinea): the raw -180..180 box's own `cameraForBounds()` fit,
    // verified LIVE to centre there, the opposite side of the world from any real data.
    const wholeButton = toggle.getByRole("button", { name: "Whole range" });
    await expect(wholeButton).toHaveAttribute("aria-pressed", "false");
    const usWaters = await readCamera(page);
    await wholeButton.click();
    await expect(wholeButton).toHaveAttribute("aria-pressed", "true");
    const wholeRange = await waitForCameraStable(page);
    const wholeContinuous =
      wholeRange.center.lng < 0 ? wholeRange.center.lng + 360 : wholeRange.center.lng;
    // NOT near lng=0 (continuous 0 or 360) -- the bug this round's own eyes-on caught live.
    expect(
      Math.min(Math.abs(wholeContinuous - 0), Math.abs(wholeContinuous - 360)),
      "'Whole range' camera landed near lng=0 (Africa) -- the exact live bug",
    ).toBeGreaterThan(30);
    // R3-rr fix 1, round 5 (orchestrator eyes-on, "Whole range" missing the western Pacific hits,
    // item B): the visible bounds must CONTAIN lon 145 (Guam/CNMI, continuous frame) -- at the
    // settled zoom, half the visible span either side of the centre -- and the camera must differ
    // MATERIALLY from "US waters" (never the "nearly identical, ~4deg apart" live bug).
    // the visible longitude span at a Mercator zoom: viewport width (px) / world width (px) *
    // 360deg -- this describe block's own viewport is the file's top-level 1280x800 default.
    const worldPxAtZoom = 512 * 2 ** wholeRange.zoom;
    const visibleHalfSpanDeg = (1280 / worldPxAtZoom) * 360 * 0.5;
    expect(
      Math.abs(145 - wholeContinuous) <= visibleHalfSpanDeg ||
        Math.abs(145 + 360 - wholeContinuous) <= visibleHalfSpanDeg,
      `Whole range's visible span (±${visibleHalfSpanDeg.toFixed(1)}deg around ${wholeContinuous.toFixed(1)}) does not contain lon 145 (Guam/CNMI)`,
    ).toBe(true);
    const usContinuous = usWaters.center.lng < 0 ? usWaters.center.lng + 360 : usWaters.center.lng;
    // R4-ci2: the camera must differ MATERIALLY, but not by centre alone. With the panel docked
    // LEFT (R4-B) the US-waters fit's padded centre (~-140.2) and the whole-range arc's centre
    // (~-140.5, Linux WebKit trace, CI run 36791588294) coincide, while the zoom still differs by
    // ~0.26 (2.16 vs 1.89): 'Whole range' is a real, wider fit, never a no-op. Gate on the pair.
    const centreDelta = Math.abs(wholeContinuous - usContinuous);
    const zoomDelta = usWaters.zoom - wholeRange.zoom;
    expect(
      centreDelta > 20 || zoomDelta > 0.15,
      `'Whole range' camera is nearly identical to 'US waters' (centre delta ${centreDelta.toFixed(2)}deg, zoom delta ${zoomDelta.toFixed(2)}) -- the exact live bug (item B)`,
    ).toBe(true);
  });

  // R3-rr fix 1, round 4 (Opus 5.5 eyes-on review round 3, real-build eyes-on, 2026-09-25): live-
  // verified that a FRESH page load never showed the toggle at all, even with rounds 1-3's fixes in
  // place -- `deps.boot()` (Shell.svelte's own `boot` state, filled once `early.boot` resolves) can
  // still be incomplete on the species camera effect's FIRST pass (the taxon shard can resolve
  // before boot.json does, over real network latency), so `cameraFor()` returns `null` (no study
  // area to fall back to) on pass 1 -- and the OLD code unconditionally latched `prevCameraKey`
  // before that null check, so `refitNeeded()` reported "already fitted" on pass 2 (once boot DID
  // arrive) and the species' own camera fit, including this COG-bounds last resort, was silently
  // skipped for the rest of the session. Reproduces the live race with a deliberately delayed
  // `boot.json` response (`slowRealWasm()`'s own "delay, never abort" pattern) so the taxon shard
  // resolves first, exactly as it did live.
  test("BUG: a FRESH load whose boot.json resolves AFTER the taxon shard still reaches the COG-bounds fallback and shows the toggle (does not silently give up forever)", async ({
    page,
  }) => {
    await blockWasm(page);
    // routeBucket FIRST (lowest priority -- Playwright routes are LIFO), routeSpeciesShards SECOND
    // so its own alias/taxon handlers take priority over routeBucket's 404 fallback for those same
    // paths, exactly the order every other test in this file uses. No `boot` param: routeBucket's
    // OWN app/boot.json handler 404s by default; the custom, delayed handler registered LAST below
    // overrides that specifically, so latest.txt/versions.json/manifest.json/the taxon shard all
    // resolve at normal (hermetic, instant) speed and ONLY boot.json is late.
    await routeBucket(page);
    await routeSpeciesShards(page);
    await routeGlyphs(page);
    await routeTitilerTiles(page);
    await page.route(
      (url) => url.href.includes("/v7/app/boot.json"),
      async (route: Route) => {
        await new Promise((r) => setTimeout(r, 800));
        return route.fulfill({ status: 200, contentType: "application/json", json: bootFor("v7") });
      },
    );
    const LIVE_LEATHERBACK_COG_BOUNDS = [-180, -17.700000000000017, 180, 60.44999999999999];
    const LIVE_HIT_LONS = new Set([-165, -66, -157, 145]);
    await page.route(
      (url) => url.hostname === "titiler-v8.marinesensitivity.org" && url.pathname === "/cog/info",
      (route: Route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ bounds: LIVE_LEATHERBACK_COG_BOUNDS }),
        }),
    );
    await page.route(
      (url) =>
        url.hostname === "titiler-v8.marinesensitivity.org" &&
        url.pathname.startsWith("/cog/point/"),
      (route: Route) => {
        const m = /\/cog\/point\/(-?\d+(?:\.\d+)?),/.exec(route.request().url());
        const lon = m ? Number(m[1]) : NaN;
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ values: [LIVE_HIT_LONS.has(lon) ? 100 : null] }),
        });
      },
    );
    await page.goto("/?mdl_seq=54241&ver=v7");
    await waitForHydration(page);
    // generous timeout: the deep-link alias->taxon chain plus the deliberately-delayed boot.json
    // (800ms) both have to settle before the species panel renders at all.
    await expect(page.getByTestId("species-title-sci")).toHaveText("Dermochelys coriacea", {
      timeout: 15_000,
    });

    // BUG (before this fix): even after boot.json eventually arrived, the toggle never rendered --
    // the species camera effect had already (wrongly) marked this species "already fitted" on its
    // first, boot-less pass.
    const toggle = page.getByRole("group", { name: "Zoom to" });
    await expect(toggle).toBeVisible({ timeout: 20_000 });
  });
});

// R3-rr fix 1, round 5 (orchestrator eyes-on, real e1fcfc8 build, 2026-09-25 — item A, BLOCKING):
// a fresh phone load of the real leatherback settled "US waters" at `lng -134, lat -48.8, zoom
// 0.78` — a tiny globe mostly hidden behind the sheet, most of the free area empty sky
// (`phone-us-waters.png`, prior round's own report). `phoneAwareWideRangeBounds` (camera.ts)
// substitutes `PHONE_DEFAULT_BOUNDS` — the app's own known-good phone default view — whenever the
// narrowed box would zoom out further than that default already does.
test.describe("R3-rr fix 1, round 5: the phone 'US waters'/'Whole range' framing bug (item A)", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("BUG: on the phone, 'US waters' no longer settles at a near-zero zoom behind the sheet -- it matches the app's own phone default view", async ({
    page,
  }) => {
    await blockWasm(page);
    await routeBucket(page, bootFor("v7"));
    await routeSpeciesShards(page);
    await routeGlyphs(page);
    await routeTitilerTiles(page);
    const LIVE_LEATHERBACK_COG_BOUNDS = [-180, -17.700000000000017, 180, 60.44999999999999];
    const LIVE_HIT_LONS = new Set([-165, -66, -157, 145]);
    await page.route(
      (url) => url.hostname === "titiler-v8.marinesensitivity.org" && url.pathname === "/cog/info",
      (route: Route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ bounds: LIVE_LEATHERBACK_COG_BOUNDS }),
        }),
    );
    await page.route(
      (url) =>
        url.hostname === "titiler-v8.marinesensitivity.org" &&
        url.pathname.startsWith("/cog/point/"),
      (route: Route) => {
        const m = /\/cog\/point\/(-?\d+(?:\.\d+)?),/.exec(route.request().url());
        const lon = m ? Number(m[1]) : NaN;
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ values: [LIVE_HIT_LONS.has(lon) ? 100 : null] }),
        });
      },
    );
    await page.goto("/?mdl_seq=54241&ver=v7");
    await waitForHydration(page);
    await expect(page.getByTestId("species-title-sci")).toHaveText("Dermochelys coriacea");
    const toggle = page.getByRole("group", { name: "Zoom to" });
    await expect(toggle).toBeVisible({ timeout: 20_000 });

    const settled = await waitForCameraStable(page);
    // the live bug: zoom 0.78. PHONE_DEFAULT_BOUNDS's own zoom (at ANY reasonable phone chrome
    // padding) is comfortably above 2 (tests/map/camera.test.ts pins the exact band) -- this is
    // the SAME observable "did the substitution actually happen" signal that test uses.
    expect(
      settled.zoom,
      "phone 'US waters' still settles at the broken near-zero zoom",
    ).toBeGreaterThan(2);
    // the settled centre lies inside PHONE_DEFAULT_BOUNDS's own longitude span -- not the
    // leatherback's own ~136deg-wide US-EEZ intersection, which spans well outside it.
    const [[west], [east]] = PHONE_DEFAULT_BOUNDS;
    expect(settled.center.lng).toBeGreaterThanOrEqual(west);
    expect(settled.center.lng).toBeLessThanOrEqual(east);
  });

  test("'Whole range' on the phone lands its centre INSIDE the confirmed-data arc's own bounds -- never south of the box entirely (the live bug: lat -56.5, south of the box's own -17.7 south edge)", async ({
    page,
  }) => {
    await blockWasm(page);
    await routeBucket(page, bootFor("v7"));
    await routeSpeciesShards(page);
    await routeGlyphs(page);
    await routeTitilerTiles(page);
    const LIVE_LEATHERBACK_COG_BOUNDS = [-180, -17.700000000000017, 180, 60.44999999999999];
    const LIVE_HIT_LONS = new Set([-165, -66, -157, 145]);
    await page.route(
      (url) => url.hostname === "titiler-v8.marinesensitivity.org" && url.pathname === "/cog/info",
      (route: Route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ bounds: LIVE_LEATHERBACK_COG_BOUNDS }),
        }),
    );
    await page.route(
      (url) =>
        url.hostname === "titiler-v8.marinesensitivity.org" &&
        url.pathname.startsWith("/cog/point/"),
      (route: Route) => {
        const m = /\/cog\/point\/(-?\d+(?:\.\d+)?),/.exec(route.request().url());
        const lon = m ? Number(m[1]) : NaN;
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ values: [LIVE_HIT_LONS.has(lon) ? 100 : null] }),
        });
      },
    );
    await page.goto("/?mdl_seq=54241&ver=v7");
    await waitForHydration(page);
    await expect(page.getByTestId("species-title-sci")).toHaveText("Dermochelys coriacea");
    const toggle = page.getByRole("group", { name: "Zoom to" });
    await expect(toggle).toBeVisible({ timeout: 20_000 });
    await waitForCameraStable(page);

    await toggle.getByRole("button", { name: "Whole range" }).click();
    const settled = await waitForCameraStable(page);
    // the confirmed-data arc's own latitude range (-17.7..60.45) -- the centre must land INSIDE
    // it, never south of it (the live bug: lat -56.5, an un-symmetrized phone sheet padding's own
    // shift overshooting badly at this near-zero-zoom regime -- camera.ts#symmetricPadding's own
    // header has the full story).
    expect(settled.center.lat).toBeGreaterThan(-17.700000000000017);
    expect(settled.center.lat).toBeLessThan(60.44999999999999);
  });
});

// R3-W8 item 2 (Ben, 2026-09-25): "I just chose FWS Range from default leatherback turtle layer,
// but see nothing on map because out of view, so would be good to default to zoom to selected
// layer and have a tickbox to stop doing that." The leatherback fixture (LEATHERBACK_SP, taxon
// f9.json) is the real worked example: `merged.bbox` is null and its `am`/`ax` inputs publish no
// bbox either, so the initial species-change fit falls all the way to the study-area default
// (P6c's own mask-skip keeps the sibling step from finding one of the range/CH masks either) — the
// exact "nothing on the map" starting state Ben described. `rng_fws` ("FWS Range",
// [-123.5, 17.65, -64.55, 41.3]) and `ch_fws` ("FWS Critical Habitat", a single reef,
// [-64.95, 17.65, -64.85, 17.7]) are two of its own real inputs with distinct, real bboxes — good
// enough to prove a SECOND, independent camera change per pick (not just "some fit happened once").
test.describe("R3-W8 item 2: zoom to layer on change (+ its tickbox and pan guard)", () => {
  test("picking an input refits the camera to ITS OWN extent, on every pick", async ({ page }) => {
    await gotoSpecies(page, `/?sp=${LEATHERBACK_SP}&ver=v9`);
    await expect(page.getByTestId("species-title-sci")).toHaveText("Dermochelys coriacea");
    // starting on Merged: no bbox anywhere reachable (see header) -- parked at the study-area
    // default, same ceiling every other test in this file uses for "never zoomed in".
    await expect
      .poll(async () => (await readCamera(page)).zoom, { timeout: 5_000 })
      .toBeLessThan(STUDY_AREA_ZOOM_CEILING);
    const start = await readCamera(page);

    // the checkbox defaults ON (Ben: "default to zoom to selected layer").
    await expect(page.getByTestId("zoom-to-layer-toggle")).toBeChecked();

    await page.locator('[data-testid="layer-pill"][data-key="rng_fws"]').click();
    const afterRng = await waitForCameraToChangeFrom(page, start, "picking FWS Range");
    // rng_fws bbox center (-94.025, 29.475) -- a broad US-coastal fit, well away from the tiny
    // reef the SECOND pick below lands on.
    expect(afterRng.center.lng).toBeGreaterThan(-130);
    expect(afterRng.center.lng).toBeLessThan(-60);

    await page.locator('[data-testid="layer-pill"][data-key="ch_fws"]').click();
    const afterCh = await waitForCameraToChangeFrom(page, afterRng, "picking FWS Critical Habitat");
    // ch_fws is a single reef 0.1 x 0.05 deg off Puerto Rico -- a real, independent SECOND camera
    // change (not the same fit repeating), and a much tighter zoom than the broad range fit.
    expect(afterCh.center.lng).toBeGreaterThan(-65.1);
    expect(afterCh.center.lng).toBeLessThan(-64.8);
    expect(afterCh.center.lat).toBeGreaterThan(17.5);
    expect(afterCh.center.lat).toBeLessThan(17.8);
    expect(afterCh.zoom).toBeGreaterThan(afterRng.zoom);
  });

  test("unchecking the tickbox stops the auto-refit — picking a new input leaves the camera put", async ({
    page,
  }) => {
    await gotoSpecies(page, `/?sp=${LEATHERBACK_SP}&ver=v9`);
    await expect(page.getByTestId("species-title-sci")).toHaveText("Dermochelys coriacea");
    const start = await readCamera(page);

    await page.locator('[data-testid="layer-pill"][data-key="rng_fws"]').click();
    await waitForCameraToChangeFrom(page, start, "picking FWS Range");

    await page.getByTestId("zoom-to-layer-toggle").uncheck();
    await expect(page.getByTestId("zoom-to-layer-toggle")).not.toBeChecked();

    const beforeSecondPick = await readCamera(page);
    await page.locator('[data-testid="layer-pill"][data-key="ch_fws"]').click();
    // the pill itself still switches (§7.2's own behaviour is untouched) -- only the CAMERA must
    // stay put. Poll briefly for a change that must NOT happen, then assert the position held.
    await page.waitForTimeout(500);
    const afterSecondPick = await readCamera(page);
    expect(afterSecondPick.center.lng).toBeCloseTo(beforeSecondPick.center.lng, 2);
    expect(afterSecondPick.center.lat).toBeCloseTo(beforeSecondPick.center.lat, 2);
    expect(afterSecondPick.zoom).toBeCloseTo(beforeSecondPick.zoom, 2);
    await expect(page.locator('[data-testid="layer-pill"][data-key="ch_fws"]')).toHaveClass(
      /active/,
    );
  });

  test("panning since the last pick suppresses the next auto-refit, checkbox still on", async ({
    page,
  }) => {
    await gotoSpecies(page, `/?sp=${LEATHERBACK_SP}&ver=v9`);
    await expect(page.getByTestId("species-title-sci")).toHaveText("Dermochelys coriacea");
    const start = await readCamera(page);

    await page.locator('[data-testid="layer-pill"][data-key="rng_fws"]').click();
    await waitForCameraToChangeFrom(page, start, "picking FWS Range");
    await expect(page.getByTestId("zoom-to-layer-toggle")).toBeChecked();

    // a real, instant, USER-attributed camera move (same technique the COG-bounds test above uses
    // to prove `zoomToLayer()`'s own re-fit, not a leftover animation) -- this is what writes
    // `sel.map` and arms the pan guard.
    await page.evaluate(() => {
      const w = window as unknown as {
        __atlasMap: {
          handle: { map: { jumpTo(o: { center: [number, number]; zoom: number }): void } };
        };
      };
      w.__atlasMap.handle.map.jumpTo({ center: [10, 10], zoom: 4 });
    });
    await expect
      .poll(async () => (await readCamera(page)).center.lng, { timeout: 5_000 })
      .toBeCloseTo(10, 0);
    // give the debounced camera writer (`map.ts`, ~300ms) time to actually reach `sel.map` before
    // the next pick — the pan guard reads `selStore.sel.map`, not the live map camera.
    await page.waitForTimeout(500);
    const panned = await readCamera(page);

    await page.locator('[data-testid="layer-pill"][data-key="ch_fws"]').click();
    await page.waitForTimeout(500);
    const afterPick = await readCamera(page);
    expect(afterPick.center.lng).toBeCloseTo(panned.center.lng, 1);
    expect(afterPick.center.lat).toBeCloseTo(panned.center.lat, 1);
  });
});
