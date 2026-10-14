// Shared Playwright helpers so every spec against the real built shell stays HERMETIC (every
// bucket URL routed to a fixture, matching e2e/shell.smoke.spec.ts's original convention) instead
// of each spec re-inventing its own fixture registry. Not a `*.spec.ts` file, so playwright.config.ts
// never tries to run it as a test on its own.
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import type { IncompleteResult } from "axe-core";
import {
  ZONES_PMTILES_PATH,
  fulfillRanged,
  routeBasemapStyle,
  routeGlyphs,
  solidPng,
} from "./map-hermetic";
import { isTeardownRaceError, safeRoute } from "./routeSafety";

export { isTeardownRaceError, safeRoute };

export const BUCKET = "https://s3.us-east-1.amazonaws.com/oceanmetrics.io-public/marine-atlas/";

// The shell no longer reads a release registry (no `latest.txt`, `versions.json`, `session.json`): the
// catalog is `atlas/catalog.json` under CATALOG_BASE, and the Species lens reads one pinned MST release
// (`v7`) from BUCKET. A missing `boot.json` legitimately 404s in a spec that does not need the species
// lens; Chromium and WebKit (not Firefox) still surface a fetch()'s non-2xx as a console "error"
// regardless of the .catch() -- so this is the ONE class of message a spec allows through; anything
// else still fails it.
export const EXPECTED_MISSING_FILES = new Set(["boot.json"]);

/** the catalog origin the app reads by default (`src/lib/catalog/base.ts`). */
export const ATLAS_BASE = "https://s3.us-east-1.amazonaws.com/oceanmetrics.io-public/atlas/";
/** the MarineSensitivity STAC the catalog links by reference. */
export const MST_STAC_BASE = "https://file.marinesensitivity.org/stac/";
/** the gazetteer tree (`index/layers.json` = the place-layer manifest). */
export const GAZETTEER_BASE =
  "https://s3.us-east-1.amazonaws.com/oceanmetrics.io-public/gazetteer/";

// any PMTiles archive the shell asks for (a collection's hex grid, a gazetteer layer) is answered by one
// small real archive, so a 404 never reaches the console; its layer name matches nothing, so nothing paints
const ANY_PMTILES = readFileSync(ZONES_PMTILES_PATH);

/** the extent the e2e biotrack collection carries (west, south, east, north): the US Atlantic coast. */
export const BIOTRACK_BBOX = [-82, 24, -64, 46] as const;

const CATALOG_FIXTURES = new URL("../tests/fixtures/catalog/", import.meta.url);
const gazRow = (
  slug: string,
  title: string,
  place_type: string,
  attribution: string,
  n: number,
) => ({
  slug,
  title,
  collection: slug,
  pmtiles: `https://storage.oceanmetrics.io/gazetteer/${slug}/places.pmtiles`,
  // every PMTiles request is answered by the one zones archive (ANY_PMTILES), whose vector layer is
  // `programarea`: naming it here makes the overlays draw real polygons (e2e/map.spec.ts counts them)
  source_layer: "programarea",
  geom_type: "MultiPolygon",
  n,
  paint: {
    fill: { "fill-color": "#e08a1e", "fill-opacity": 0.45 },
    line: { "line-color": "#a85f00", "line-width": 1 },
  },
  place_type,
  attribution,
  license: "CC-PDDC",
});
/** a three-row `index/layers.json`: two default-on overlays and one off. */
export const GAZETTEER_MANIFEST = {
  layers: [
    gazRow(
      "noaa_sanctuaries",
      "NOAA national marine sanctuaries",
      "protected_area",
      "ONMS credit. Processed by Ocean Metrics.",
      47,
    ),
    gazRow(
      "boem_wind_leases",
      "BOEM offshore wind leases",
      "lease",
      "BOEM credit. Processed by Ocean Metrics.",
      52,
    ),
    gazRow(
      "mpa_inventory",
      "Marine protected areas inventory",
      "mpa",
      "MPA credit. Processed by Ocean Metrics.",
      981,
    ),
  ],
};

/**
 * Answer the gazetteer's place-layer manifest with an EMPTY list, registered after `routeBucket`
 * (the newest route wins): no overlay is on the map. A spec that clicks or probes the map for what a
 * LENS draws (the species popup, a raster pixel) wants no place layer drawn over it: an overlay
 * feature under the pointer owns the click (one card at a time, `lib/map/clickInfo.ts`).
 */
export async function routeNoPlaceLayers(page: Page) {
  await page.route(
    `${GAZETTEER_BASE}index/layers.json`,
    safeRoute((route) => route.fulfill({ status: 200, json: { layers: [] } })),
  );
}

/**
 * The catalog, the MarineSensitivity STAC and the gazetteer manifest, routed to fixtures
 * (`tests/fixtures/catalog/`, served under the real origins): no spec reaches the live network for
 * them. Anything else under those origins answers 404 (an unlisted data file, a hex tile).
 */
export async function routeAtlasData(page: Page) {
  await page.route(
    (url) =>
      url.href.startsWith(ATLAS_BASE) ||
      url.href.startsWith(MST_STAC_BASE) ||
      url.href.startsWith(GAZETTEER_BASE),
    safeRoute((route) => {
      const href = route.request().url();
      if (href.split("?")[0].endsWith(".pmtiles")) return fulfillRanged(route, ANY_PMTILES);
      if (href.startsWith(GAZETTEER_BASE)) {
        return href.endsWith("index/layers.json")
          ? route.fulfill({ status: 200, json: GAZETTEER_MANIFEST })
          : route.fulfill({ status: 404, body: "" });
      }
      const rel = href.startsWith(ATLAS_BASE)
        ? href.slice(ATLAS_BASE.length)
        : `mst/${href.slice(MST_STAC_BASE.length)}`;
      const path = fileURLToPath(new URL(rel.split("?")[0], CATALOG_FIXTURES));
      if (!existsSync(path)) {
        // a collection the fixture tree does not carry (the loader's own tests cover "unavailable"):
        // an empty one, so the picker is full and the console stays clean
        const m = /\/([^/]+)\/collection\.json$/.exec(href);
        return m
          ? route.fulfill({
              status: 200,
              json: { type: "Collection", id: m[1], title: m[1], links: [] },
            })
          : route.fulfill({ status: 404, body: "" });
      }
      if (rel === "biotrack_indicators/collection.json") {
        // the fixture publishes no extent (the loader's own tests want that); the shell fits the
        // collection's extent on first load, which the camera specs measure
        const collection = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
        collection.extent ??= { spatial: { bbox: [BIOTRACK_BBOX] } };
        return route.fulfill({ status: 200, json: collection });
      }
      return route.fulfill({
        status: 200,
        contentType: path.endsWith(".json") ? "application/json" : "application/octet-stream",
        body: readFileSync(path),
      });
    }),
  );
}

/**
 * The map's cross-origin tile/style/glyph origins → fixtures, so no spec ever reaches the live
 * network for them. The basemap is CARTO's vector GL style now (atlas-map basemap fix, 2026-09-23:
 * the raster endpoint started requiring a key) — `routeBasemapStyle()` (map-hermetic.ts) routes its
 * WHOLE chain (style.json, its TileJSON, every `.mvt` tile, the sprite, wrapped with `safeRoute()`
 * throughout — see routeSafety.ts's own header for the teardown-race it guards); `routeGlyphs()`
 * covers the font range every basemap now needs for CARTO's own place/road labels, not just a zone
 * label. A spec that needs a distinguishable PAINTED score-raster pixel (e2e/map.spec.ts) still
 * registers its OWN, later-winning titiler route — Playwright matches handlers in reverse
 * registration order.
 */
export async function routeMapTileOrigins(page: Page) {
  await routeBasemapStyle(page);
  await routeGlyphs(page);
  // a real (transparent) PNG, not a 204 and not a hand-typed base64 blob: MapLibre reports a tile
  // it cannot DECODE through `map.on("error")`, which logs to the console — and "zero console
  // errors" is the smoke spec's whole assertion (an invalid literal produced 35 of them).
  await page.route(
    "https://titiler-v8.marinesensitivity.org/**",
    safeRoute((route) =>
      route.fulfill({ status: 200, contentType: "image/png", body: solidPng(0, 0, 0, 1, 0) }),
    ),
  );
}

export function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const url = msg.location()?.url ?? "";
    const basename = url.split("/").pop() ?? "";
    if (msg.text().includes("Failed to load resource") && EXPECTED_MISSING_FILES.has(basename))
      return;
    errors.push(`[${msg.type()}] ${msg.text()} (${url})`);
  });
  page.on("pageerror", (err) => errors.push(String(err)));
  return errors;
}

/** every URL the page requested, so a test can assert what was NOT fetched. */
export function collectRequests(page: Page): string[] {
  const urls: string[] = [];
  page.on("request", (req) => urls.push(req.url()));
  return urls;
}

/**
 * Every cross-origin GET the shell makes, routed to a fixture: the release bucket (latest.txt,
 * versions.json, each release's manifest and — when `boot` is given — `{ver}/app/boot.json`) AND
 * the map's tile origins.
 *
 * The tile origins are folded in here on purpose (atlas-map): the moment the shell mounted a real
 * MapLibre map, EVERY spec that loads the shell started requesting CARTO basemap tiles, and a
 * hermeticity rule that each spec has to remember separately is one that a future spec will
 * silently break. `routeBucket` is the one call every shell spec already makes.
 */
export async function routeBucket(
  page: Page,
  boot?: object,
  // a spec that hands a species `boot` fixture is about what the Species lens draws and clicks: no
  // place layer is drawn over it unless it asks (`routeNoPlaceLayers`' own header says why)
  placeLayers: boolean = boot === undefined,
) {
  await routeMapTileOrigins(page);
  await routeAtlasData(page);
  if (!placeLayers) await routeNoPlaceLayers(page);
  await page.route(
    (url) => url.href.startsWith(BUCKET),
    safeRoute(async (route) => {
      const path = route.request().url().slice(BUCKET.length);
      // the Species lens reads one pinned release (v7): its boot fixture answers at that path whatever
      // release the fixture itself describes
      if (boot && /^v[0-9]+[a-z]?\/app\/boot\.json/.test(path)) {
        return route.fulfill({ status: 200, json: boot });
      }
      return route.fulfill({ status: 404, body: "" }); // app/boot.json: not published for a spec without `boot`
    }),
  );
}

/** the shell's one hermetic setup for a public load: the catalog, the tile origins, the gazetteer
 * manifest, then the navigation. */
export async function gotoPublicShell(page: Page, path = "/") {
  await routeBucket(page);
  await page.goto(path);
}

/**
 * Aborts the app's own entry chunk (`./assets/index-<hash>.js`, the built `<script type="module">`
 * index.html emits) so ONLY the static skeleton + inlined critical CSS ever paints -- no
 * hydration, ever. Used by both the geometry-equality gate (e2e/shell.cls.spec.ts) and the
 * no-flash gate (e2e/shell.theme-flash.spec.ts): a real browser-level way to isolate "what does
 * the skeleton alone look like" from "what does main.ts's `$effect` paper over a few ms later."
 * Does not block `modulepreload-polyfill-*.js` or `report-*.js` -- only the app entry.
 */
export async function blockAppBundle(page: Page) {
  await page.route(
    (url) => /\/assets\/index-[^/]*\.js$/.test(url.pathname),
    safeRoute((route) => route.abort()),
  );
}

/** waits for the REAL Rail component (`.rail`, not the skeleton's `.sk-rail`) to exist -- the
 * signal that main.ts has cleared the skeleton and Shell.svelte has mounted. */
export async function waitForHydration(page: Page) {
  await page.waitForSelector("#rail-region .rail", { state: "attached" });
}

/** `#rrggbb` -> the exact `rgb(r, g, b)` string `getComputedStyle` returns, for asserting a
 * computed background/color against a `tokens.css` value without a color-parsing library. */
export function hexToRgb(hex: string): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) throw new Error(`not a #rrggbb color: "${hex}"`);
  const [r, g, b] = m.slice(1).map((h) => parseInt(h, 16));
  return `rgb(${r}, ${g}, ${b})`;
}

/**
 * atlas-3 closing review, item 4: axe's own `color-contrast` rule cannot statically resolve two
 * kinds of composited color this app uses on purpose (color-mix()/backdrop-filter glass surfaces,
 * and SVG <text> painted over a <rect> it reports as "overlapped" even though the label and its
 * background share one element and one fixed, separately-gated contrast) -- so both
 * e2e/gallery.spec.ts and e2e/shell.a11y.spec.ts exempt `color-contrast` from their "every
 * incomplete finding is triaged" gate. A rule-id-keyed exemption alone is a silent hole: it would
 * also cover a FUTURE unrelated color-contrast defect, however many nodes or for whatever reason
 * axe cites, forever. This pins it instead: a node-count ceiling (the number actually measured
 * for this page/viewport, recorded by the caller) and a closed set of the axe "cannot determine"
 * message keys actually observed here -- a new incomplete node, or an existing one axe now cites
 * for a NEW reason, still fails even though the rule id is still `color-contrast`.
 *
 * To re-triage after a real content change: run the failing spec, read the new count/reason from
 * the failure, and only raise the ceiling (or add a reason key) once you've confirmed the new case
 * is actually gated elsewhere (e.g. scripts/contrast.mjs) -- never just to make the number match.
 */
export function extractColorContrastReasonKeys(nodes: IncompleteResult["nodes"]): string[] {
  return nodes.flatMap((node) => {
    const checks = [...node.any, ...node.all, ...node.none];
    return checks
      .map((c) => (c.data as { messageKey?: string } | null)?.messageKey)
      .filter((k): k is string => typeof k === "string");
  });
}

/**
 * Asserts axe's `incomplete` results contain nothing EXCEPT `color-contrast`, and that
 * `color-contrast`'s own node count/reasons stay within the pinned ceiling/allow-list above.
 */
export function assertColorContrastIncompletePinned(
  incomplete: IncompleteResult[],
  ceiling: number,
  allowedReasonKeys: readonly string[],
) {
  const untriaged = incomplete.filter((v) => v.id !== "color-contrast");
  if (untriaged.length) {
    throw new Error(
      `axe reported an untriaged incomplete finding (not color-contrast): ${JSON.stringify(untriaged, null, 2)}`,
    );
  }
  const colorContrast = incomplete.find((v) => v.id === "color-contrast");
  const nodeCount = colorContrast?.nodes.length ?? 0;
  if (nodeCount > ceiling) {
    throw new Error(
      `color-contrast incomplete node count ${nodeCount} exceeds the pinned ceiling of ${ceiling}`,
    );
  }
  const reasons = colorContrast ? extractColorContrastReasonKeys(colorContrast.nodes) : [];
  const unexpected = reasons.filter((k) => !allowedReasonKeys.includes(k));
  if (unexpected.length) {
    throw new Error(
      `color-contrast incomplete cited an unexpected reason: ${JSON.stringify(unexpected)} (allowed: ${JSON.stringify(allowedReasonKeys)})`,
    );
  }
}
