import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import {
  choiceOfRow,
  clearCog3857Cache,
  contentHashOf,
  copyHref,
  readCog3857Row,
  resolveCog3857,
  rowFromRecord,
  sideTableUrl,
} from "../../src/lib/release/cog3857";
import { PUBLIC_DATA_BASE } from "../../src/lib/release/dataBase";

// build week 6 step 5 (D7, D8): a MST release COG is drawn from its 3857 copy when the release's side table
// (`{ver}/tables/cog_3857.parquet`, written by pipeline `build.py cog-3857-batch`) has its content_hash, else by
// titiler. The fixture is two real v7 rows (written by the batch on the mini, 2026-10-23) after 1,022 synthetic
// ones, in two row groups of 512 sorted by content_hash, so the real rows sit in the second group.
const FIXTURE = new URL("../fixtures/release/cog_3857_v7.parquet", import.meta.url);
const table = (): ArrayBuffer => {
  const b = readFileSync(FIXTURE);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
};
const HASH = "00087703522463db";
const URL_ = `${PUBLIC_DATA_BASE}cog/usa05/${HASH}.tif`;

beforeEach(() => clearCog3857Cache());

describe("names", () => {
  it("the content hash is the original's file stem, path-style or virtual-host", () => {
    expect(contentHashOf(URL_)).toBe(HASH);
    expect(contentHashOf(`https://oceanmetrics.io-public.s3.amazonaws.com/marine-atlas/cog/usa05/${HASH}.tif`)).toBe(HASH);
    expect(contentHashOf(`${URL_}?b=1`)).toBe(HASH);
    expect(contentHashOf(`${PUBLIC_DATA_BASE}native/bl/${HASH}.pmtiles`)).toBeNull();
    expect(contentHashOf("https://x.org/score_risk.tif")).toBeNull();
  });

  it("the copy's href is its key under the release data base; a key outside marine-atlas/ is none", () => {
    expect(copyHref(`marine-atlas/v7/cog_3857/cog/usa05/${HASH}_3857.tif`, PUBLIC_DATA_BASE)).toBe(
      `${PUBLIC_DATA_BASE}v7/cog_3857/cog/usa05/${HASH}_3857.tif`,
    );
    expect(copyHref("atlas/x_3857.tif", PUBLIC_DATA_BASE)).toBeNull();
    expect(sideTableUrl("v7")).toBe(`${PUBLIC_DATA_BASE}v7/tables/cog_3857.parquet`);
  });
});

describe("the side table", () => {
  it("reads one hash's row from the second row group", async () => {
    const row = await readCog3857Row(table(), HASH);
    expect(row).not.toBeNull();
    expect(row!.key).toBe(`marine-atlas/v7/cog_3857/cog/usa05/${HASH}_3857.tif`);
    expect(row!.url).toBe(URL_);
    expect(row!.zoom).toEqual([1, 5]);
    expect(row!.bands).toHaveLength(1);
    const b = row!.bands[0];
    expect([b.data_type, b.nodata]).toEqual(["uint8", 0]);
    expect(b.statistics).toEqual({ minimum: 1, maximum: 100, mean: 38.7591, stddev: 31.7423, valid_percent: 1.41 });
    expect(b.histogram!.count).toBe(32);
    expect(b.histogram!.buckets).toHaveLength(32);
    expect(b.histogram!.buckets.slice(0, 4)).toEqual([5444, 2185, 1653, 1616]);
  });

  it("a hash it does not list, and a table that is not Parquet, give no row", async () => {
    expect(await readCog3857Row(table(), "ffffffffffffffff")).toBeNull();
    expect(await readCog3857Row(new TextEncoder().encode("<Error>403</Error>").buffer as ArrayBuffer, HASH)).toBeNull();
  });

  it("a record without a hash or a key is no row", () => {
    expect(rowFromRecord({ content_hash: HASH })).toBeNull();
    expect(rowFromRecord({ cog_3857_key: "marine-atlas/v7/x_3857.tif" })).toBeNull();
  });
});

describe("resolveCog3857", () => {
  it("answers the cog choice: draw the 3857 copy, read values from the 4326 original, the lens's hints on both", async () => {
    const hints = { "atlas:rescale": [1, 100] as [number, number], "atlas:colormap": "spectral_r" };
    const c = await resolveCog3857("v7", URL_, hints, { source: table() });
    expect(c.kind).toBe("cog");
    if (c.kind !== "cog") return;
    expect(c.draw.key).toBe("cog_3857");
    expect(c.draw.asset.href).toBe(`${PUBLIC_DATA_BASE}v7/cog_3857/cog/usa05/${HASH}_3857.tif`);
    expect(c.draw.asset["proj:code"]).toBe("EPSG:3857");
    expect(c.draw.asset.roles).toEqual(["data", "visual"]);
    expect(c.draw.asset["atlas:zoom"]).toEqual([1, 5]);
    expect(c.values.asset.href).toBe(URL_);
    expect(c.values.asset["proj:code"]).toBe("EPSG:4326");
    for (const a of [c.draw.asset, c.values.asset]) {
      expect(a["atlas:rescale"]).toEqual([1, 100]);
      expect(a["atlas:colormap"]).toBe("spectral_r");
      expect(a.bands![0].nodata).toBe(0);
      expect(a.bands![0].statistics!.maximum).toBe(100);
    }
  });

  it("falls back to titiler: no side table, no row, not a store key (seeded faults)", async () => {
    const notParquet = new TextEncoder().encode("not parquet").buffer as ArrayBuffer;
    expect(await resolveCog3857("v7", URL_, {}, { source: notParquet })).toEqual({ kind: "titiler" });
    expect(
      await resolveCog3857("v7", `${PUBLIC_DATA_BASE}cog/usa05/ffffffffffffffff.tif`, {}, { source: table() }),
    ).toEqual({ kind: "titiler" });
    expect(await resolveCog3857("v7", "https://x.org/a.tif", {}, { source: table() })).toEqual({ kind: "titiler" });
  });

  it("a NaN nodata is written as STAC's \"nan\"", () => {
    const row = rowFromRecord({
      content_hash: HASH,
      cog_3857_key: `marine-atlas/v7/cog_3857/cog/usa05/${HASH}_3857.tif`,
      bands: 1,
      data_type: ["float32"],
      nodata: [NaN],
      statistics: [null],
      histogram: [null],
    })!;
    const c = choiceOfRow(row, PUBLIC_DATA_BASE, URL_);
    expect(c.kind === "cog" && c.draw.asset.bands![0]).toEqual({ data_type: "float32", nodata: "nan" });
  });
});
