// Hermetic fixtures for the map (atlas-map). Not a `*.spec.ts`, so Playwright never runs it as a
// test on its own — same convention as e2e/hermetic.ts.
//
// Everything the map fetches is routed: the zones PMTiles archive (a REAL 7 KB archive built with
// tippecanoe, served with working HTTP range support, because that is how the `pmtiles://` protocol
// reads it), the CARTO basemap tiles and the titiler score tiles. No spec here ever touches the
// live network.
import { readFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import type { Page, Route } from "@playwright/test";
import { safeRoute } from "./routeSafety";

/** the committed archive. Rebuild with:
 *   tippecanoe -o zones.pmtiles -l programarea -Z0 -z6 --no-tile-compression --force zones.geojson
 * from `e2e/fixtures/map/` (source: zones.geojson, 4 Program-Area rectangles in US waters). */
export const ZONES_PMTILES_PATH = fileURLToPath(
  new URL("./fixtures/map/zones.pmtiles", import.meta.url),
);

/** the URL the fixture boot.json advertises for the zones archive. */
export const ZONES_PMTILES_URL =
  "https://s3.us-east-1.amazonaws.com/oceanmetrics.io-public/marine-atlas/v7/zones/programarea_2026-01/zones.pmtiles";

/** a fixture COG; only its URL matters, since the tiles are routed. */
export const SCORE_COG_URL =
  "https://s3.us-east-1.amazonaws.com/oceanmetrics.io-public/marine-atlas/cog/usa05/fixture.tif";

/** `{ver}/app/boot.json`, trimmed to what the map module reads (atlas-1's contract). */
export const BOOT_FIXTURE = {
  schema: 1,
  ver: "v7",
  grid_id: "usa05",
  grid: {
    nc: 3103,
    nr: 2006,
    xmin: 141.1,
    ymax: 74.75,
    resx: 0.05,
    resy: 0.05,
    lon360: true,
    tile: { size: 50 },
  },
  study_areas: [
    { key: "FULL", label: "All US waters", lon: -101.304, lat: 46.9, zoom: 2.16 },
    { key: "GA", label: "Gulf of America", lon: -89.089, lat: 26.251, zoom: 3.74 },
  ],
  units: [
    {
      zone_set_key: "programarea_2026-01",
      fld: "programarea_key",
      label: "Program areas",
      pmtiles: ZONES_PMTILES_URL,
      source_layer: "programarea",
    },
  ],
  zones: {
    programarea: [
      { key: "GAA", name: "Gulf of America", label_pt: [-90, 27] },
      { key: "MDA", name: "Mid Atlantic", label_pt: [-72, 38] },
      { key: "CGA", name: "Cook Inlet", label_pt: [-155, 57] },
      { key: "CAA", name: "Central California", label_pt: [-125, 38] },
    ],
  },
};

// --- a solid PNG, so a painted pixel has an EXACT expected colour -------------------------------

function crc32(buf: Buffer): number {
  let c = ~0;
  for (const byte of buf) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

/** a solid opaque PNG, one colour, a full 256 px tile. Every pixel of a routed tile is exactly this
 * colour — which is what lets a `readPixels` probe assert a VALUE rather than "not the background".
 * Full-size, not 1×1: MapLibre uploads the decoded image as the tile texture and a 1×1 tile paints
 * nothing usable (measured, atlas-map). */
export function solidPng(r: number, g: number, b: number, size = 256, a = 255): Buffer {
  const channels = a === 255 ? 3 : 4;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = channels === 3 ? 2 : 6; // colour type: truecolour [+ alpha]
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(size * channels)]); // filter 0 + pixels
  for (let x = 0; x < size; x++) {
    row[1 + x * channels] = r;
    row[2 + x * channels] = g;
    row[3 + x * channels] = b;
    if (channels === 4) row[4 + x * channels] = a;
  }
  const idat = deflateSync(Buffer.concat(Array.from({ length: size }, () => row)));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** the "paper" (light) theme's basemap fixture colour. Through 0.10.34 every spec/script that never
 * set `theme=` resolved here, because `DEFAULT_SEL.theme` was `"auto"` and every headless engine in
 * this repo reports `prefersDark` as a real `false` (`resolveTheme("auto", false)` -> paper).
 *
 * 0.10.29's U2a changed `DEFAULT_SEL.theme` to `"dark"` (dark-by-default), so a bare URL with no
 * `?theme=` now resolves to NAVY, not paper — `scoresRasterProbe`/`speciesRasterProbe`
 * (scripts/verify.mjs) and the shared `BLENDED_RASTER_RGB` constants in scores-hermetic.ts /
 * species.timing.spec.ts were fixed to blend against `BASEMAP_RGB_NAVY` below instead. This colour
 * is now current only for a spec that explicitly navigates with `?theme=light`. */
export const BASEMAP_RGB: [number, number, number] = [0, 102, 153];
/** the "navy" (dark) theme's basemap fixture colour — M5: before this, both themes routed to the
 * SAME `BASEMAP_RGB`, so a theme switch could be proven only by the DECLARED style JSON containing
 * a different `sprite` string, never by a painted pixel (the review's exact finding: "proves
 * neither the swap nor the paint"). Distinct enough from `BASEMAP_RGB` that no plausible blend or
 * anti-aliasing edge could confuse the two. Since 0.10.29's U2a this is also the DEFAULT a bare URL
 * (no `?theme=`) resolves to — no longer "only a spec that explicitly requests theme=dark/navy".*/
export const BASEMAP_RGB_NAVY: [number, number, number] = [10, 20, 40];
/** fixture water colour by RESOLVED theme (`document.documentElement.dataset.theme`), for a probe
 * that already knows which theme it is looking at rather than assuming `BASEMAP_RGB`. */
export const BASEMAP_RGB_BY_THEME: Record<"navy" | "paper", [number, number, number]> = {
  paper: BASEMAP_RGB,
  navy: BASEMAP_RGB_NAVY,
};
/** the score raster's fixture colour — distinct from either basemap colour, so a probe can tell
 * them apart. */
export const RASTER_RGB: [number, number, number] = [255, 127, 42];

/**
 * Serve the PMTiles archive with real HTTP range support: the `pmtiles://` protocol reads the
 * header, then the directory, then each tile with a `Range` header, and a handler that ignored it
 * would hand back the whole file for every read and decode garbage.
 */
export async function routeZonesPmtiles(
  page: Page,
  url = ZONES_PMTILES_URL,
  path = ZONES_PMTILES_PATH,
) {
  const file = readFileSync(path);
  await page.route(
    url,
    safeRoute((route) => fulfillRanged(route, file)),
  );
}

/** answer a (possibly `Range`) request for `file`, as an S3 object would. */
export function fulfillRanged(route: Route, file: Buffer) {
  const range = route.request().headers()["range"];
  const m = range ? /bytes=(\d+)-(\d*)/.exec(range) : null;
  if (!m) {
    return route.fulfill({
      status: 200,
      contentType: "application/octet-stream",
      headers: { "accept-ranges": "bytes", "access-control-allow-origin": "*" },
      body: file,
    });
  }
  const start = Number(m[1]);
  const end = m[2] ? Number(m[2]) : file.length - 1;
  const slice = file.subarray(start, end + 1);
  return route.fulfill({
    status: 206,
    contentType: "application/octet-stream",
    headers: {
      "accept-ranges": "bytes",
      "content-range": `bytes ${start}-${end}/${file.length}`,
      "access-control-allow-origin": "*",
    },
    body: slice,
  });
}

/** the fixture's own tiles.json + tile-template URLs — CARTO's real shape (verified live
 * 2026-09-23: source id "carto", `tiles.basemaps.cartocdn.com/vector/carto.streets/v1/tiles.json`,
 * four `tiles-{a,b,c,d}` XYZ subdomains for the `.mvt` tiles themselves), simplified to ONE
 * subdomain since a fixture never needs real load-balancing. */
const BASEMAP_TILES_JSON_URL =
  "https://tiles.basemaps.cartocdn.com/vector/carto.streets/v1/tiles.json";
const BASEMAP_TILE_URL_TEMPLATE =
  "https://tiles.basemaps.cartocdn.com/vectortiles/carto.streets/v1/{z}/{x}/{y}.mvt";

/** `#rrggbb` for `BASEMAP_RGB`, so the fixture's vector "water" fill paints the exact colour the
 * blend-math assertions (`scores.firstpaint.spec.ts`, `species.timing.spec.ts`) already expect —
 * unchanged by the raster-to-vector basemap swap. */
function rgbHex([r, g, b]: readonly [number, number, number]): string {
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

/** a MINIMAL CARTO-shaped style.json: one `background` layer + one `water` fill on the "carto"
 * vector source — real CARTO ships 93 layers; this is enough to exercise `style.ts#composeStyle`'s
 * real merge (sources/sprite/glyphs/layers, namespaced, "basemap" role FIRST) without shipping the
 * whole style into a test fixture. M5 (atlas-8 review round 2): each theme's fixture now paints its
 * OWN colour (`BASEMAP_RGB_BY_THEME`) — before this, both themes routed to the same `BASEMAP_RGB`
 * and a theme switch could only be proven by the DECLARED style JSON containing a different
 * `sprite` string, never by a painted pixel. `sprite` (CARTO's own, theme-named path) is still the
 * theme-distinguishing field of the STYLE, asserted against the real `map.getStyle()` now (not a
 * recomposed style object) by `e2e/map.spec.ts`'s theme-switch test, alongside the new pixel probe. */
function basemapStyleFixture(theme: "navy" | "paper") {
  const rgb = rgbHex(BASEMAP_RGB_BY_THEME[theme]);
  return {
    version: 8,
    sources: { carto: { type: "vector", url: BASEMAP_TILES_JSON_URL } },
    sprite: `https://tiles.basemaps.cartocdn.com/gl/${theme === "navy" ? "dark-matter" : "positron"}-gl-style/sprite`,
    glyphs: "https://tiles.basemaps.cartocdn.com/fonts/{fontstack}/{range}.pbf",
    layers: [
      { id: "background", type: "background", paint: { "background-color": rgb } },
      {
        id: "water",
        type: "fill",
        source: "carto",
        "source-layer": "water",
        paint: { "fill-color": rgb },
      },
    ],
  };
}

/** CARTO's own style.json URL per theme (`layers/basemap.ts#basemapForTheme`'s real shape). */
const BASEMAP_STYLE_URL: Record<"navy" | "paper", string> = {
  navy: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
  paper: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
};

/** the committed archive: tippecanoe (`-l water -Z0 -z0 --no-tile-compression`), a single polygon
 * spanning the whole world -> a tile whose "water" layer covers the WHOLE tile (buffered past
 * 0-4096), so it paints solid regardless of which {z}/{x}/{y} a probe happens to land on — the
 * same "one fixture answers every tile request" trick `solidPng()` uses for a raster tile. */
const BASEMAP_TILE_PATH = fileURLToPath(
  new URL("./fixtures/map/basemap-water.pbf", import.meta.url),
);

/**
 * Routes the WHOLE CARTO vector-style chain a real basemap now needs, given the per-theme
 * style.json body and the `.mvt` tile bytes every `{z}/{x}/{y}` request answers with: the
 * `sources.carto` TileJSON (shared — the fixture's "water" `source-layer` name never changes),
 * every tile request, and the sprite (`.json` + `.png`, `@2x` included). `routeGlyphs()` stays a
 * separate call — every spec already calls it on its own — so this never duplicates that route.
 */
async function routeBasemapVectorChain(
  page: Page,
  styleFixture: (theme: "navy" | "paper") => unknown,
  tile: Buffer,
  styleJsonDelayMs = 0,
) {
  for (const theme of ["navy", "paper"] as const) {
    const body = JSON.stringify(styleFixture(theme));
    await page.route(
      BASEMAP_STYLE_URL[theme],
      safeRoute(async (route) => {
        // 0.10.20: a SLOW style.json is a first-class fixture, not an edge case — the basemap
        // used to be dropped for the life of the page whenever this response landed after the
        // last reactive recompose (see `scores.firstpaint.spec.ts`'s slow-basemap gate).
        if (styleJsonDelayMs > 0) await new Promise((r) => setTimeout(r, styleJsonDelayMs));
        return route.fulfill({ status: 200, contentType: "application/json", body });
      }),
    );
  }
  await page.route(
    BASEMAP_TILES_JSON_URL,
    safeRoute((route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          tilejson: "2.2.0",
          tiles: [BASEMAP_TILE_URL_TEMPLATE],
          minzoom: 0,
          maxzoom: 14,
          vector_layers: [{ id: "water", minzoom: 0, maxzoom: 14, fields: {} }],
        }),
      }),
    ),
  );
  await page.route(
    (url) => /\/vectortiles\/carto\.streets\/v1\/\d+\/\d+\/\d+\.mvt$/.test(url.pathname),
    safeRoute((route) =>
      route.fulfill({ status: 200, contentType: "application/x-protobuf", body: tile }),
    ),
  );
  await page.route(
    (url) => /\/gl\/(dark-matter|positron)-gl-style\/sprite(@2x)?\.json$/.test(url.pathname),
    safeRoute((route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: "{}" }),
    ),
  );
  await page.route(
    (url) => /\/gl\/(dark-matter|positron)-gl-style\/sprite(@2x)?\.png$/.test(url.pathname),
    safeRoute((route) =>
      route.fulfill({ status: 200, contentType: "image/png", body: solidPng(0, 0, 0, 1, 0) }),
    ),
  );
}

/** the every-spec default: a flat, single-colour "water" fill (`BASEMAP_RGB`) — exact pixel math
 * for the raster-over-basemap blend assertions (`scores.firstpaint.spec.ts`,
 * `species.timing.spec.ts`), unchanged by the raster-to-vector basemap swap. */
export async function routeBasemapStyle(page: Page, opts: { styleJsonDelayMs?: number } = {}) {
  await routeBasemapVectorChain(
    page,
    basemapStyleFixture,
    readFileSync(BASEMAP_TILE_PATH),
    opts.styleJsonDelayMs ?? 0,
  );
}

/** the committed archive for `routeVariedBasemapStyle()`: 64 alternating tippecanoe-built squares
 * (a `shade` 0/1 property) spanning the whole world -> an 8x8 checkerboard at tile-local scale —
 * the vector analogue of the raster checkerboard fix round 2 item 6 introduced (a reviewer's
 * captured report map PNG was one flat colour, which a luminance-only guard let through): a
 * captured map PNG needs REAL pixel variance to tell a genuine render from a flat placeholder. */
const BASEMAP_VARIED_TILE_PATH = fileURLToPath(
  new URL("./fixtures/map/basemap-water-varied.pbf", import.meta.url),
);
/** exported (M4, atlas-8 review round 2) so `e2e/report-hermetic.ts`'s pixel-proof can compute the
 * exact alpha-blended colour a place's score-coloured circle paints OVER this checkerboard,
 * instead of asserting only that the captured image is non-blank. */
export const VARIED_DARK: [number, number, number] = [8, 40, 84];
export const VARIED_LIGHT: [number, number, number] = [176, 208, 232];

function variedBasemapStyleFixture(theme: "navy" | "paper") {
  return {
    ...basemapStyleFixture(theme),
    layers: [
      { id: "background", type: "background", paint: { "background-color": rgbHex(VARIED_DARK) } },
      {
        id: "water",
        type: "fill",
        source: "carto",
        "source-layer": "water",
        paint: {
          "fill-color": ["match", ["get", "shade"], 1, rgbHex(VARIED_LIGHT), rgbHex(VARIED_DARK)],
        },
      },
    ],
  };
}

/**
 * A basemap with REAL pixel variance — for a spec whose own assertion is about the CAPTURED map
 * image, not an exact probed colour (`e2e/report.spec.ts`'s map-PNG-capture checks; see
 * `reportMap.ts#captureRejectionReason`, fix round 2 item 6). Registered exactly like
 * `routeBasemapStyle()`, just with the checkerboard tile/style above instead of the flat default.
 */
export async function routeVariedBasemapStyle(page: Page) {
  await routeBasemapVectorChain(
    page,
    variedBasemapStyleFixture,
    readFileSync(BASEMAP_VARIED_TILE_PATH),
  );
}

/** every titiler `/cog/tiles` request → one solid PNG of a different colour. */
export async function routeTitilerTiles(page: Page) {
  const png = solidPng(...RASTER_RGB);
  await page.route(
    "https://titiler-v8.marinesensitivity.org/**",
    safeRoute((route) => route.fulfill({ status: 200, contentType: "image/png", body: png })),
  );
}

/** the glyph endpoint a label layer would fetch — routed so a symbol layer cannot reach the live
 * network either. A 200 with an EMPTY body, not a 404: the live CARTO endpoint answers 200 for
 * `layers/basemap.ts`'s font stack (verified with `curl -sI` on the exact requested URL), and a
 * 404 in the fixture makes Chromium log a console "error" (its own resource-load reporting, not
 * MapLibre's) the moment any spec's boot fixture gives a zone `label_pt` — which every fixture
 * here now does (atlas-4's zones carry labels by default), OR the merged CARTO style's own place/
 * road labels (which every basemap now carries). A zero-byte body is still a VALID (empty) glyph
 * protobuf, so MapLibre reads it as "no glyphs in this range", never an error. Scoped to `/fonts/`
 * specifically (not the whole `tiles.basemaps.cartocdn.com` host) so it never shadows this file's
 * OWN tiles.json/`.mvt`/sprite routes on the same host. */
export async function routeGlyphs(page: Page) {
  await page.route(
    "https://tiles.basemaps.cartocdn.com/fonts/**",
    safeRoute((route) =>
      route.fulfill({ status: 200, contentType: "application/x-protobuf", body: "" }),
    ),
  );
}

/** the first-paint contract (plan D3 Tier 0): the map must paint with ZERO WASM bytes. Aborting
 * every `.wasm` makes that structural rather than aspirational. */
export async function blockWasm(page: Page) {
  await page.route(
    "**/*.wasm",
    safeRoute((route) => route.abort()),
  );
}

/**
 * How many features of one layer the map draws right now, robust on the globe (R4-ci).
 * `queryRenderedFeatures({ layers })` with no geometry answers `[]` on the globe whenever a
 * viewport corner is off the sphere, whatever is painted -- the round-4 left-dock fit centre is
 * such a camera -- so when it says 0 this falls back to the layer's loaded tiles (same steps as
 * `src/lib/map/queryLayers.ts#queryLayerFeatures`, which has the unit tests; this copy runs
 * in-page and cannot import it). `-1` while the layer or its source is not there yet.
 */
export function renderedLayerCount(page: Page, layerId: string, sourceId: string) {
  return page.evaluate(
    ([lyr, src]) => {
      const map = (
        window as unknown as {
          __atlasMap: { handle: { map: Record<string, (...a: unknown[]) => unknown> } };
        }
      ).__atlasMap.handle.map as unknown as {
        getLayer(
          id: string,
        ): { sourceLayer?: string; minzoom?: number; maxzoom?: number } | undefined;
        isSourceLoaded(id: string): boolean;
        queryRenderedFeatures(o: { layers: string[] }): unknown[];
        getLayoutProperty(id: string, n: string): unknown;
        getFilter(id: string): unknown;
        getZoom(): number;
        querySourceFeatures(s: string, o: object): unknown[];
      };
      const layer = map.getLayer(lyr);
      if (!layer) return -1;
      if (!map.isSourceLoaded(src)) return -1;
      const n = map.queryRenderedFeatures({ layers: [lyr] }).length;
      if (n > 0) return n;
      if (map.getLayoutProperty(lyr, "visibility") === "none") return 0;
      const z = map.getZoom();
      if (typeof layer.minzoom === "number" && z < layer.minzoom) return 0;
      if (typeof layer.maxzoom === "number" && z >= layer.maxzoom) return 0;
      const opts: { sourceLayer?: string; filter?: unknown } = {};
      if (layer.sourceLayer) opts.sourceLayer = layer.sourceLayer;
      const filter = map.getFilter(lyr);
      if (filter) opts.filter = filter;
      return map.querySourceFeatures(src, opts).length;
    },
    [layerId, sourceId],
  );
}
