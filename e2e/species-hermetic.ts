// Shared hermetic fixtures/helpers for the species lens (atlas-5), used by BOTH
// e2e/species.smoke.spec.ts (the functional species-lens behaviour) and e2e/species.timing.spec.ts
// (the cold first-paint TIMING gate, split out per atlas-8's rule: a first-paint/first-frame timing
// gate runs alone in its own Playwright project, gated on the median of N >= 3 cold runs, never a
// single sample -- see playwright.config.ts's "timing" project and workflows' "atlas-8
// verification, accessibility, performance.md", 2026-09-21 handover). Not a `*.spec.ts` file, so
// Playwright never tries to run it as a test on its own -- same convention as e2e/hermetic.ts and
// e2e/map-hermetic.ts.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { BUCKET, routeBucket, waitForHydration } from "./hermetic";
import { blockWasm, routeBasemapStyle, routeGlyphs, routeTitilerTiles } from "./map-hermetic";
import { safeRoute } from "./routeSafety";

// NOT a `declare global` augmentation of `Window.__atlasMap` — e2e/map.spec.ts already declares
// one, and TypeScript requires every declaration of the SAME global interface member to have an
// IDENTICAL type; a second, differently-shaped one is a compile error. This is a plain type, cast
// to at each call site instead (`window as unknown as { __atlasMap: AtlasMapForSpecies }`).
export interface AtlasMapForSpecies {
  handle: {
    map: {
      isSourceLoaded(id: string): boolean;
      getLayer(id: string): unknown;
      getCanvas(): HTMLCanvasElement;
      getCenter(): { lng: number; lat: number };
      project(lngLat: [number, number]): { x: number; y: number };
      loaded(): boolean;
    };
  };
}

/** the merged key's `|`/`:` as a real browser navigation bar would encode them — a literal `|` is
 * not a valid URI character (`page.goto` must not be handed one raw). */
export const LEATHERBACK_SP = encodeURIComponent("ms_merge|WORMS:137209");
export const WALRUS_AM_MDL_KEY = encodeURIComponent("am|ITS-Mam-180639");
/** `valid_usa: false` — the "US-only toggle falls back to the default" case's non-US taxon. */
export const WRYBILL_SP = encodeURIComponent("ms_merge|BOTW:22693928");
/** R3-A1: `tests/fixtures/species/derived/taxon-widerange.json`'s synthetic taxon — a 130°-span
 * bbox (`[130, 10, 260, 65]`), over `WIDE_RANGE_SPAN_DEG`, loosely modelled on the real v7
 * leatherback's reported range. The shard id (`84`, below) is DERIVED from this key's trailing
 * digits mod 256 (`shardIdFor`) — changing the key without recomputing it 404s silently through
 * `routeBucket`'s own fallback. */
export const WIDE_RANGE_SP = encodeURIComponent("ms_merge|DERIVED:900");

const FIXTURES = new URL("../tests/fixtures/species/", import.meta.url);
function readFixture(path: string): unknown {
  return JSON.parse(readFileSync(fileURLToPath(new URL(path, FIXTURES)), "utf8"));
}

const STUDY_AREAS_V9 = readFixture("v9/study-areas.json");
const STUDY_AREAS_V7 = readFixture("v7/study-areas.json");
const DATASETS_V9 = readFixture("v9/datasets.json");
const DATASETS_V7 = readFixture("v7/datasets.json");

export function bootFor(ver: "v9" | "v7") {
  return {
    schema: 1,
    ver,
    grid_id: ver === "v9" ? "global05" : "usa05",
    grid:
      ver === "v9"
        ? { nc: 7200, nr: 3600, xmin: -180, ymax: 90, resx: 0.05, resy: 0.05, tile: { size: 50 } }
        : {
            nc: 3103,
            nr: 2006,
            xmin: 141.1,
            ymax: 74.75,
            resx: 0.05,
            resy: 0.05,
            lon360: true,
            tile: { size: 50 },
          },
    study_areas: ver === "v9" ? STUDY_AREAS_V9 : STUDY_AREAS_V7,
    units: [],
    datasets: ver === "v9" ? DATASETS_V9 : DATASETS_V7,
    // U6 (round 2): every fixture taxon here (leatherback/walrus/wrybill) publishes
    // `colormap: "spectral_r"` (tests/fixtures/species/v9/taxon/*.json) -- without a matching
    // `boot.palettes` entry, `paletteStopsFromBoot()` (src/lib/raster/ramps.ts) returns null and
    // `speciesMapInputs()` never builds a legend at all (no DOM node, not even an empty one --
    // SpeciesLegend.svelte has no fallback branch). None of the existing specs against this
    // fixture ever checked the legend's OWN presence (only `species-title-sci` etc.), so this gap
    // was invisible until e2e/tour.spec.ts's species walk asserted `[data-testid="species-legend"]`
    // directly. 11 real stops, copied from e2e/report-hermetic.ts's own BOOT_V9 fixture.
    palettes: {
      spectral_r: [
        "#9E0142",
        "#D53E4F",
        "#F46D43",
        "#FDAE61",
        "#FEE08B",
        "#FFFFBF",
        "#E6F598",
        "#ABDDA4",
        "#66C2A5",
        "#3288BD",
        "#5E4FA2",
      ],
    },
  };
}

/** every `app/**` shard this spec's fixtures cover, keyed by the path under the release prefix. The
 * Species lens reads ONE pinned release (`v7`, `src/lib/release/mst.ts`), so a fixture set (v9's
 * global05 taxa, or v7's own) is always SERVED under `v7/`; the set only picks the files. */
const SHARD_FILES: Record<"v9" | "v7", Record<string, string>> = {
  v9: {
    "app/taxa.json": "v9/taxa.json",
    "app/taxon/f9.json": "v9/taxon/f9.json",
    "app/taxon/75.json": "v9/taxon/75.json",
    "app/taxon/28.json": "v9/taxon/28.json",
    // R3-A1: WIDE_RANGE_SP's shard (shardIdFor("ms_merge|DERIVED:900") === "84") — reached only via
    // `?sp=` (never legacy `mdl_key`/`mdl_seq`), so no matching alias entry is needed.
    "app/taxon/84.json": "derived/taxon-widerange.json",
    "app/alias/f9.json": "v9/alias/f9.json",
    "app/alias/9f.json": "v9/alias/9f.json",
  },
  v7: {
    "app/taxon/6f.json": "v7/taxon/6f.json",
    "app/alias/6f.json": "v7/alias/6f.json",
    // V4 fix (owner phone report, 2026-09-24): the leatherback fixture (54241, mdl_seq).
    "app/taxon/e1.json": "v7/taxon/e1.json",
    "app/alias/e1.json": "v7/alias/e1.json",
  },
};

/** `v9/app/taxon/28.json` and `v7/app/taxon/28.json` both mean "the shard `app/taxon/28.json`". */
const underRelease = (path: string) => path.replace(/^v[0-9]+[a-z]?\//, "");

/** exported so a spec that needs to compose its OWN route order (e.g. registering a hung titiler
 * handler that must win over `gotoSpecies`'s own `routeTitilerTiles`) can call every other piece
 * of this setup without duplicating it — see species.smoke.spec.ts's hung-tile-fallback test. */
export async function routeSpeciesShards(
  page: Page,
  overrides: Record<string, unknown> = {},
  set: "v9" | "v7" = "v9",
) {
  const byPath = new Map(Object.entries(overrides).map(([k, v]) => [underRelease(k), v]));
  await page.route(
    (url) => url.href.startsWith(BUCKET) && url.href.includes("/app/"),
    safeRoute((route) => {
      const path = underRelease(route.request().url().slice(BUCKET.length));
      if (byPath.has(path)) return route.fulfill({ status: 200, json: byPath.get(path) });
      const other = set === "v9" ? "v7" : "v9";
      const file = SHARD_FILES[set][path] ?? SHARD_FILES[other][path];
      // NOT a known species shard path (e.g. app/boot.json) — fall through to routeBucket's
      // handler (registered BEFORE this one; Playwright tries routes newest-first, and
      // `fallback()` hands the request to the next-most-recently-registered matching route,
      // rather than this handler's own 404 shadowing routeBucket's real boot.json fixture).
      if (!file) return route.fallback();
      return route.fulfill({ status: 200, json: readFixture(file) });
    }),
  );
}

export async function gotoSpecies(
  page: Page,
  path: string,
  ver: "v9" | "v7" = "v9",
  shardOverrides: Record<string, unknown> = {},
  // R5-3: routes registered AFTER routeBucket and BEFORE the navigation, so a spec can serve a URL
  // under the release bucket (a store-shaped `native/..`/`cog/..` key) that routeBucket's own
  // catch-all would otherwise 404 (Playwright tries the newest route first).
  beforeGoto?: (page: Page) => Promise<void>,
) {
  await blockWasm(page);
  // `ver` names the FIXTURE SET (v9 = the global05 taxa, v7 = the usa05 ones); either is served under
  // the one pinned release the lens reads
  await routeBucket(page, bootFor(ver));
  await routeSpeciesShards(page, shardOverrides, ver);
  await routeBasemapStyle(page);
  await routeTitilerTiles(page);
  await routeGlyphs(page);
  if (beforeGoto) await beforeGoto(page);
  await page.goto(path);
  await waitForHydration(page);
}

/** the v9 Wrybill shard (one `bl` PMTiles input) re-keyed the way a backfilled v7 release does it:
 * the input's `mdl_key` is a bare legacy number while the tile's features still carry
 * `bl|22693928`; `sourceKey` (the asset's `source_key`) says which value they are stored under
 * (omit it for the pre-fix shard shape). The asset points at `rangeUrl`, the one-polygon
 * `range.pmtiles` fixture (layer `bl`, `mdl_key = "bl|22693928"`), over the Gulf. */
export function v7ShapedWrybillShard(rangeUrl: string, sourceKey?: string): unknown {
  const shard = readFixture("v9/taxon/28.json") as {
    taxa: Record<string, { inputs: { mdl_key: string; assets: Record<string, unknown>[] }[] }>;
  };
  const input = shard.taxa["ms_merge|BOTW:22693928"]!.inputs[0]!;
  input.mdl_key = "17626";
  const asset = input.assets[0]!;
  asset.url = rangeUrl;
  asset.bbox = [-96, 24, -84, 30];
  if (sourceKey !== undefined) asset.source_key = sourceKey;
  return shard;
}

/** R5-3: the content-addressed store's URL shapes (asset-store migration, 2026-10): a PMTiles
 * original at `native/{ds_key}/{hash}.pmtiles` and a gridded COG at `cog/{grid_id}/{hash}.tif`,
 * both on the bucket origin, both unversioned (no `{ver}/` segment, no `?v=`). */
export const STORE_PMTILES_URL = `${BUCKET}native/bl/0b1c2d3e4f5a6b7c.pmtiles`;
export const STORE_COG_URL = `${BUCKET}cog/global05/9f8e7d6c5b4a3921.tif`;
/** the feature key the shared tile stores the range under (the fixture's one Gulf polygon). */
export const STORE_SOURCE_KEY = "bl|22693928";
/** the input's own key in the shard -- deliberately NOT the tile's key, so only `source_key` can
 * make the range draw. */
export const STORE_INPUT_KEY = "bl|store-input-17626";

/** the v9 Wrybill shard (one `bl` input) re-shaped the way the store-backed releases publish it:
 * an Original PMTiles asset at {@link STORE_PMTILES_URL} carrying `source_key` (different from the
 * input's own key) and an Interpolated COG at {@link STORE_COG_URL}. */
export function storeShapedWrybillShard(): unknown {
  const shard = readFixture("v9/taxon/28.json") as {
    taxa: Record<string, { inputs: { mdl_key: string; assets: Record<string, unknown>[] }[] }>;
  };
  const input = shard.taxa["ms_merge|BOTW:22693928"]!.inputs[0]!;
  input.mdl_key = STORE_INPUT_KEY;
  const original = input.assets[0]!;
  original.url = STORE_PMTILES_URL;
  original.source_key = STORE_SOURCE_KEY;
  original.bbox = [-96, 24, -84, 30];
  input.assets.push({
    rep: "model",
    type: "cog",
    url: STORE_COG_URL,
    rescale: [1, 100],
    colormap: "spectral_r",
    source_layer: null,
    bbox: [-96, 24, -84, 30],
  });
  return shard;
}
