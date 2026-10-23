import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  choiceOfRow,
  clearCog3857Cache,
  contentHashOf,
  copyHref,
  readCog3857Row,
  resolveCog3857,
  rowFromRecord,
  sharedTableUrl,
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
    expect(
      contentHashOf(
        `https://oceanmetrics.io-public.s3.amazonaws.com/marine-atlas/cog/usa05/${HASH}.tif`,
      ),
    ).toBe(HASH);
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
    expect(b.statistics).toEqual({
      minimum: 1,
      maximum: 100,
      mean: 38.7591,
      stddev: 31.7423,
      valid_percent: 1.41,
    });
    expect(b.histogram!.count).toBe(32);
    expect(b.histogram!.buckets).toHaveLength(32);
    expect(b.histogram!.buckets.slice(0, 4)).toEqual([5444, 2185, 1653, 1616]);
  });

  it("a hash it does not list, and a table that is not Parquet, give no row", async () => {
    expect(await readCog3857Row(table(), "ffffffffffffffff")).toBeNull();
    expect(
      await readCog3857Row(
        new TextEncoder().encode("<Error>403</Error>").buffer as ArrayBuffer,
        HASH,
      ),
    ).toBeNull();
  });

  it("a record without a hash or a key is no row", () => {
    expect(rowFromRecord({ content_hash: HASH })).toBeNull();
    expect(rowFromRecord({ cog_3857_key: "marine-atlas/v7/x_3857.tif" })).toBeNull();
  });
});

describe("resolveCog3857", () => {
  it("answers the cog choice: draw the 3857 copy, read values from the 4326 original, the lens's hints on both", async () => {
    const hints = { "atlas:rescale": [1, 100] as [number, number], "atlas:colormap": "spectral_r" };
    const c = await resolveCog3857("v7", URL_, hints, { source: table(), sharedSource: null });
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
    expect(
      await resolveCog3857("v7", URL_, {}, { source: notParquet, sharedSource: null }),
    ).toEqual({ kind: "titiler" });
    expect(
      await resolveCog3857(
        "v7",
        `${PUBLIC_DATA_BASE}cog/usa05/ffffffffffffffff.tif`,
        {},
        { source: table(), sharedSource: null },
      ),
    ).toEqual({ kind: "titiler" });
    expect(
      await resolveCog3857(
        "v7",
        "https://x.org/a.tif",
        {},
        { source: table(), sharedSource: null },
      ),
    ).toEqual({ kind: "titiler" });
  });

  it('a NaN nodata is written as STAC\'s "nan"', () => {
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
    expect(c.kind === "cog" && c.draw.asset.bands![0]).toEqual({
      data_type: "float32",
      nodata: "nan",
    });
  });
});

// D8 part 2: one shared table for every release (`{PUBLIC_DATA_BASE}tables/cog_3857.parquet`, written by
// `cog-3857-batch --pool`): the pool's own copies at marine-atlas/cog_3857/<hash>_3857.tif and v7's rows as they are.
// The fixture: v7's real row of HASH (a pointer, its v7 key) and one pool row of a global05 hash.
const SHARED = new URL("../fixtures/release/cog_3857_shared.parquet", import.meta.url);
const sharedBytes = (): ArrayBuffer => {
  const b = readFileSync(SHARED);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
};
const POOL_HASH = "1111222233334444";
const POOL_URL = `${PUBLIC_DATA_BASE}cog/global05/${POOL_HASH}.tif`;
const ONLY_V7 = "0009290baa128741"; // in the v7 fixture, not in the shared one

describe("the shared table first, the release table as the fallback", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("lives at the registry root, beside versions.json", () => {
    expect(sharedTableUrl()).toBe(`${PUBLIC_DATA_BASE}tables/cog_3857.parquet`);
  });

  it("a pool row draws its copy under marine-atlas/cog_3857/, a pointer row its v7 key", async () => {
    const pool = await resolveCog3857(
      "v7b",
      POOL_URL,
      {},
      { source: table(), sharedSource: sharedBytes() },
    );
    expect(pool.kind === "cog" && pool.draw.asset.href).toBe(
      `${PUBLIC_DATA_BASE}cog_3857/${POOL_HASH}_3857.tif`,
    );
    expect(pool.kind === "cog" && pool.draw.asset["atlas:zoom"]).toEqual([0, 7]);
    expect(pool.kind === "cog" && pool.values.asset.href).toBe(POOL_URL);
    const ptr = await resolveCog3857(
      "v7c",
      URL_,
      {},
      { source: new ArrayBuffer(8), sharedSource: sharedBytes() },
    );
    expect(ptr.kind === "cog" && ptr.draw.asset.href).toBe(
      `${PUBLIC_DATA_BASE}v7/cog_3857/cog/usa05/${HASH}_3857.tif`,
    );
  });

  it("a hash the shared table lacks, or a shared table that cannot be read, falls back to the release's", async () => {
    const url = `${PUBLIC_DATA_BASE}cog/usa05/${ONLY_V7}.tif`;
    const want = `${PUBLIC_DATA_BASE}v7/cog_3857/cog/usa05/${ONLY_V7}_3857.tif`;
    const a = await resolveCog3857("v7", url, {}, { source: table(), sharedSource: sharedBytes() });
    expect(a.kind === "cog" && a.draw.asset.href).toBe(want);
    const b = await resolveCog3857(
      "v7",
      url,
      {},
      { source: table(), sharedSource: new ArrayBuffer(8) },
    );
    expect(b.kind === "cog" && b.draw.asset.href).toBe(want);
    // in neither: titiler (seeded fault: the pool row's hash dropped from the shared table)
    expect(
      await resolveCog3857(
        "v7b",
        `${PUBLIC_DATA_BASE}cog/global05/ffffffffffffffff.tif`,
        {},
        {
          source: table(),
          sharedSource: sharedBytes(),
        },
      ),
    ).toEqual({ kind: "titiler" });
  });

  it("over the network: the shared table is opened once per page for every release, the release table only on a miss", async () => {
    const calls: string[] = [];
    const bytes: Record<string, ArrayBuffer> = {
      [sharedTableUrl()]: sharedBytes(),
      [sideTableUrl("v7")]: table(),
    };
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? "GET"} ${url}`);
      const b = bytes[url];
      if (!b) return new Response("<Error>403</Error>", { status: 403 });
      if (init?.method === "HEAD")
        return new Response(null, {
          status: 200,
          headers: { "content-length": `${b.byteLength}` },
        });
      return new Response(b.slice(0), { status: 200 });
    });
    const p = await resolveCog3857("v7b", POOL_URL);
    const q = await resolveCog3857("v7c", URL_);
    expect([p.kind, q.kind]).toEqual(["cog", "cog"]);
    expect(calls.filter((c) => c.endsWith(sharedTableUrl())).length).toBeLessThanOrEqual(2); // one HEAD, one GET
    expect(calls.filter((c) => c.startsWith("HEAD") && c.endsWith(sharedTableUrl()))).toHaveLength(
      1,
    );
    expect(calls.some((c) => c.includes("/v7b/") || c.includes("/v7c/"))).toBe(false);
    // a miss in the shared table reads the release's own
    const r = await resolveCog3857("v7", `${PUBLIC_DATA_BASE}cog/usa05/${ONLY_V7}.tif`);
    expect(r.kind).toBe("cog");
    expect(calls.filter((c) => c.startsWith("HEAD") && c.endsWith(sharedTableUrl()))).toHaveLength(
      1,
    );
    expect(calls.some((c) => c.endsWith(sideTableUrl("v7")))).toBe(true);
  });
});
