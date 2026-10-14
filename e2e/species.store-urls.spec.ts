// R5-3: the species lens against the content-addressed asset store's URL SHAPES, fully hermetic.
//
// After the asset-store migration a PMTiles original lives at
// `{bucket}native/{ds_key}/{hash}.pmtiles` (shared across releases, so its features may be keyed
// differently from the input: the asset carries `source_key`) and a gridded surface at
// `{bucket}cog/{grid_id}/{hash}.tif`. Both are on the bucket origin, which `routeBucket` 404s by
// default -- so a regression that built a URL from anything but the shard's own asset (a
// `{ver}/native/..` guess, a `file.marinesensitivity.org` host) would draw nothing here, and one
// that filtered the range on the input's key instead of `source_key` would draw zero features.
// Modelled on `species.smoke.spec.ts`'s R4-skey pair (same range.pmtiles fixture, same
// `renderedLayerCount` probe); network is entirely mocked.
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { collectRequests } from "./hermetic";
import { renderedLayerCount, routeZonesPmtiles } from "./map-hermetic";
import {
  STORE_COG_URL,
  STORE_INPUT_KEY,
  STORE_PMTILES_URL,
  STORE_SOURCE_KEY,
  WRYBILL_SP,
  gotoSpecies,
  storeShapedWrybillShard,
} from "./species-hermetic";

test.describe.configure({ mode: "serial" });
test.use({ viewport: { width: 1280, height: 800 } });

// one Gulf polygon, source layer `bl`, `mdl_key = "bl|22693928"` -- the same tile the R4-skey pair uses
const RANGE_FIXTURE = fileURLToPath(new URL("./fixtures/map/range.pmtiles", import.meta.url));
const SHARD = { "v9/app/taxon/28.json": storeShapedWrybillShard() };
const serveStoreRange = (page: Page) => routeZonesPmtiles(page, STORE_PMTILES_URL, RANGE_FIXTURE);

const filterOf = (page: Page, layerId: string) =>
  page.evaluate(
    (id) =>
      (
        window as unknown as {
          __atlasMap: { handle: { map: { getFilter(i: string): unknown } } };
        }
      ).__atlasMap.handle.map.getFilter(id),
    layerId,
  );

test.describe("species lens with store-shaped asset URLs (R5-3)", () => {
  test("Original: the range filters on the asset's source_key and is fetched from native/{ds}/{hash}.pmtiles", async ({
    page,
  }) => {
    const requests = collectRequests(page);
    await gotoSpecies(page, `/?sp=${WRYBILL_SP}&in=bl&ver=v9`, "v9", SHARD, serveStoreRange);

    await expect
      .poll(() => renderedLayerCount(page, "species-range", "species-range"), {
        timeout: 15_000,
        message: "the range never drew a feature (filtered on the wrong key, or the URL 404ed)",
      })
      .toBeGreaterThan(0);

    // the filter carries the tile's key, never the input's own
    expect(await filterOf(page, "species-range")).toEqual([
      "==",
      ["get", "mdl_key"],
      STORE_SOURCE_KEY,
    ]);
    expect(JSON.stringify(await filterOf(page, "species-range"))).not.toContain(STORE_INPUT_KEY);

    // the archive was read from the store URL (header + directory + tile reads)
    expect(requests.filter((u) => u === STORE_PMTILES_URL).length).toBeGreaterThan(0);
    // ...and no request names a versioned/legacy copy of the same file
    expect(
      requests.filter(
        (u) => /\.pmtiles/.test(u) && u !== STORE_PMTILES_URL && !u.includes("/gazetteer/"), // (place layers are not the range)
      ),
    ).toEqual([]);
  });

  test("Interpolated: titiler is asked about the store's cog/{grid}/{hash}.tif, never a {ver}/native path", async ({
    page,
  }) => {
    const requests = collectRequests(page);
    await gotoSpecies(
      page,
      `/?sp=${WRYBILL_SP}&in=bl&rep=model&ver=v9`,
      "v9",
      SHARD,
      serveStoreRange,
    );

    // `/healthz` (the health banner's probe) carries no COG url; tiles and the legend histogram do
    const tiles = () =>
      requests.filter((u) => u.startsWith("https://titiler-v8.") && /\/cog\//.test(u));
    await expect
      .poll(() => tiles().length, { timeout: 15_000, message: "no titiler tile was requested" })
      .toBeGreaterThan(0);

    const cogParams = tiles().map((u) => new URL(u).searchParams.get("url"));
    expect(cogParams.length).toBeGreaterThan(0);
    // every species raster request (tiles + the legend's histogram) asks about exactly the store COG (URLSearchParams decodes it)
    for (const p of cogParams) expect(p).toBe(STORE_COG_URL);
    // the Interpolated surface is a raster: the range layer is not on screen
    expect(
      requests.filter((u) => /\.pmtiles/.test(u) && !u.includes("/gazetteer/")), // (place layers are not the range)
    ).toEqual([]);
  });
});
