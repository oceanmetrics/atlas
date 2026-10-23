// The registry lens draws a row's raster from its EPSG:3857 copy when the row carries one (registry v2's
// `cog_3857_url`, `cog_3857_url_005`), through the same `RasterSource` seam as every browser-drawn Item, and keeps
// titiler for a row without the column. The two-row fixture: `COPY_RECORD` (both copies; a real v7 side-table row
// for the native one and a real pool row for the 0.05 degree one) and `PLAIN_RECORD` (no copy column at all).
import { beforeEach, describe, expect, it } from "vitest";
import { registryItem, COPY_ASSET, type CopySides } from "../../../src/lib/catalog/registry/item";
import { itemTemplateOf } from "../../../src/lib/catalog/registry/ref";
import { rowsFromRecords } from "../../../src/lib/catalog/registry/rows";
import { rasterChoiceOf, releaseCogSources } from "../../../src/lib/raster/cog";
import { rasterAssetOf } from "../../../src/lib/catalog/assets";
import { collectionMapInputs } from "../../../src/lens/collection/mapInputs";
import {
  rasterOriginOf,
  tallyCounts,
  tallyLine,
  tallyRasters,
} from "../../../src/lib/raster/drawTally";
import { rowFromRecord as sideRow, type Cog3857Row } from "../../../src/lib/release/cog3857";
import type { CollectionEntry } from "../../../src/lib/catalog/load";
import { LEATHERBACK_RECORD, UNMATCHED_RECORD, nativeCollection } from "./support";

const S3 = "https://s3.us-east-1.amazonaws.com/oceanmetrics.io-public/marine-atlas/";
// the registry names path-style S3; rows read through onStorage land on the build's host (the storage host since
// catalog 0.6.0, the cutover of 2026-10-23)
const ON = (u: string) => u.replace(S3, "https://storage.oceanmetrics.io/marine-atlas/");
const COPY_RECORD = {
  ...LEATHERBACK_RECORD,
  cog_url: `${S3}native/am/40ff91f6bd61a934.tif`,
  cog_url_005: `${S3}cog/global05/c6d64b86a5fb90e1.tif`,
  cog_3857_url: `${S3}v7/cog_3857/native/am/40ff91f6bd61a934_3857.tif`,
  cog_3857_url_005: `${S3}cog_3857/c6d64b86a5fb90e1_3857.tif`,
};
const PLAIN_RECORD = { ...UNMATCHED_RECORD, cog_3857_url: null, cog_3857_url_005: null };
const rows = rowsFromRecords([COPY_RECORD, PLAIN_RECORD]);
const [copyRow, plainRow] = [rows.get(COPY_RECORD.sp_key)!, rows.get(PLAIN_RECORD.sp_key)!];

const HIST = [
  5, 7, 8, 8, 5, 8, 8, 5, 4, 7, 11, 7, 14, 9, 8, 10, 11, 12, 8, 10, 39, 25, 27, 21, 20, 20, 24, 21,
  27, 47, 69, 657,
];
const side = (hash: string, key: string, z: [number, number]): Cog3857Row =>
  sideRow({
    content_hash: hash,
    cog_3857_key: key,
    zoom_min: z[0],
    zoom_max: z[1],
    bands: 1,
    data_type: ["uint8"],
    nodata: [0],
    statistics: [{ minimum: 1, maximum: 100, mean: 85.4 }],
    histogram: [{ count: 32, min: 1, max: 100, buckets: HIST }],
  })!;
const SIDE_NATIVE = side(
  "40ff91f6bd61a934",
  "marine-atlas/v7/cog_3857/native/am/40ff91f6bd61a934_3857.tif",
  [0, 2],
);
const SIDE_005 = side(
  "c6d64b86a5fb90e1",
  "marine-atlas/cog_3857/c6d64b86a5fb90e1_3857.tif",
  [1, 5],
);

// `cogRasterSource` keeps one live source per file: each test starts without the previous one
beforeEach(() => releaseCogSources());

const template = itemTemplateOf(nativeCollection());
const entry: CollectionEntry = {
  id: "aquamaps_native",
  title: "AquaMaps",
  href: "https://x.test/aquamaps_native/collection.json",
  group: "oceanmetrics",
  external: false,
  status: "ok",
  collection: nativeCollection(),
  error: null,
};
const item = (r: typeof copyRow, rep?: string, sides?: CopySides) =>
  registryItem(r, "aquamaps_native", template, { rep, sides });
const inputs = (it: ReturnType<typeof item>) =>
  collectionMapInputs({ entry, item: it, style: null, values: null, marker: null });

describe("registry rows read the copy columns", () => {
  it("a row with the columns carries both copies; a row without them (or a v1 registry) has null", () => {
    expect(copyRow.cog3857Url).toBe(ON(COPY_RECORD.cog_3857_url));
    expect(copyRow.cog3857Url005).toBe(ON(COPY_RECORD.cog_3857_url_005));
    expect(plainRow.cog3857Url).toBeNull();
    expect(plainRow.cog3857Url005).toBeNull();
    const v1 = rowsFromRecords([LEATHERBACK_RECORD]).get(LEATHERBACK_RECORD.sp_key)!;
    expect(v1.cog3857Url).toBeNull();
  });
});

describe("the Item of a row with a copy", () => {
  it("lists the copy as cog_3857 (data + visual, EPSG:3857) beside the 4326 original, which stays `data`", () => {
    const it = item(copyRow, undefined, { native: SIDE_NATIVE });
    expect(Object.keys(it.assets)).toEqual(["cog", "cog_3857", "cog_005", "cog_3857_005"]);
    expect(it.assets.cog_3857).toMatchObject({
      href: ON(COPY_RECORD.cog_3857_url),
      roles: ["data", "visual"],
      "proj:code": "EPSG:3857",
      "atlas:zoom": [0, 2],
      "atlas:rescale": [1, 100],
    });
    expect(it.assets.cog.roles).toEqual(["data"]);
    expect(it.assets.cog_3857_005.roles).toEqual(["reference"]);
    expect(rasterAssetOf(it)!.url).toBe(ON(COPY_RECORD.cog_url));
  });
  it("band statistics and histogram come from the side table row (band 1), the template keeps nodata and unit", () => {
    const band = (
      item(copyRow, undefined, { native: SIDE_NATIVE }).assets.cog_3857.bands as object[]
    )[0];
    expect(band).toMatchObject({
      name: "suitability",
      data_type: "uint8",
      nodata: 0,
      unit: "percent",
      statistics: { minimum: 1, maximum: 100, mean: 85.4 },
      histogram: { count: 32, min: 1, max: 100, buckets: HIST },
    });
  });
  it("rep=005 makes the 0.05 degree copy the drawn one, with the 0.05 degree side row", () => {
    const it = item(copyRow, "005", { "005": SIDE_005 });
    expect(it.assets[COPY_ASSET["005"]].roles).toEqual(["data", "visual"]);
    expect(it.assets[COPY_ASSET.native].roles).toEqual(["reference"]);
    const c = rasterChoiceOf(it);
    expect(c.kind === "cog" && c.draw.asset.href).toBe(ON(COPY_RECORD.cog_3857_url_005));
    expect(c.kind === "cog" && c.values.asset.href).toBe(ON(COPY_RECORD.cog_url_005));
  });
  it("a row without the column lists no copy and keeps its titiler choice", () => {
    const it = item(plainRow);
    expect(Object.keys(it.assets)).toEqual(["cog"]);
    expect(rasterChoiceOf(it).kind).toBe("titiler");
  });
  it("a row with a native copy only draws 0.05 degree through titiler (the copy is a reference, not drawn)", () => {
    const half = rowsFromRecords([{ ...COPY_RECORD, cog_3857_url_005: null }]).get("Rep-3437")!;
    expect(rasterChoiceOf(item(half, "native", { native: SIDE_NATIVE })).kind).toBe("cog");
    expect(rasterChoiceOf(item(half, "005")).kind).toBe("titiler");
  });
});

describe("the registry lens draws a copy through cog:// and a plain row through titiler", () => {
  it("copy row: a cog:// tile template of the 3857 copy, the legend histogram from the side table, no titiler", () => {
    const out = inputs(item(copyRow, undefined, { native: SIDE_NATIVE }));
    expect(out.rasterBackend).toBe("cog");
    expect(out.raster!.tiles[0].startsWith(`cog://${ON(COPY_RECORD.cog_3857_url)}`)).toBe(true);
    expect(out.raster!.tiles[0]).not.toContain("/cog/tiles/");
    expect(out.raster!.maxzoom).toBe(2);
    expect(out.cogUrl).toBe(ON(COPY_RECORD.cog_url)); // the point read goes to the 4326 original
    expect(out.legend?.histogram).toMatchObject({ binCount: 32, counts: HIST, min: 1, max: 100 });
    expect(out.legend?.unit).toBe("percent");
  });
  it("copy row, side table row missing: still drawn from the copy, the legend has no histogram", () => {
    const out = inputs(item(copyRow, undefined, { native: null }));
    expect(out.rasterBackend).toBe("cog");
    expect(out.legend?.histogram).toBeNull();
    expect(out.raster!.maxzoom).toBeUndefined();
  });
  it("copy row while the side table is being read: nothing is drawn, and not through titiler either", () => {
    const pending = item(copyRow);
    expect(pending.assets.cog_3857["atlas:stats_pending"]).toBe(true);
    expect(rasterChoiceOf(pending).kind).toBe("cog");
    const out = inputs(pending);
    expect(out.raster).toBeNull();
    expect(out.rasterBackend).toBeNull();
    expect(out.legend).toBeNull();
  });
  it("plain row: titiler, as before", () => {
    const out = inputs(item(plainRow));
    expect(out.rasterBackend).toBe("titiler");
    expect(out.raster!.tiles[0]).toContain("/cog/tiles/");
  });
});

describe("the About tally counts the registry lens's rasters", () => {
  it("a copy row is `browser`, a plain row `titiler`; two views of the lens tally 1 of 2", () => {
    const a = inputs(item(copyRow, undefined, { native: SIDE_NATIVE })).raster;
    const b = inputs(item(plainRow)).raster;
    expect(rasterOriginOf(a)).toMatchObject({ origin: "browser" });
    expect(rasterOriginOf(a)!.key.startsWith(ON(COPY_RECORD.cog_3857_url))).toBe(true);
    expect(rasterOriginOf(b)?.origin).toBe("titiler");
    let seen = tallyRasters({}, [a]);
    seen = tallyRasters(seen, [b]);
    // the 0.05 degree copy of the same taxon is a raster of its own
    seen = tallyRasters(seen, [inputs(item(copyRow, "005", { "005": SIDE_005 })).raster]);
    expect(tallyLine(tallyCounts(seen))).toBe("2 of 3 rasters drawn from the browser");
  });
  it("a pending copy adds nothing to the tally (no layer yet)", () => {
    expect(tallyRasters({}, [inputs(item(copyRow)).raster])).toEqual({});
  });
});
