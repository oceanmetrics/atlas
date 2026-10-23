import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  choiceOfRow,
  clearCog3857Cache,
  contentHashOf,
  copyHref,
  READ_COLUMNS,
  readCog3857Row,
  resolveCog3857,
  urlFile,
  type RangedFile,
  rowFromRecord,
  sharedTableUrl,
  sideTableUrl,
} from "../../src/lib/release/cog3857";
import { PUBLIC_DATA_BASE } from "../../src/lib/release/dataBase";

// build week 6 step 5 (D7, D8): a MST release COG is drawn from its 3857 copy when the release's side table
// (`{ver}/tables/cog_3857.parquet`, written by pipeline `build.py cog-3857-batch`) has its content_hash, else by
// titiler. The fixture is two real v7 rows (written by the batch on the mini, 2026-10-23) after 1,022 synthetic
// ones, in two row groups of 512 sorted by content_hash with 64-row pages and the page index (the published table's
// layout at a fixture's scale: pipeline `cog3857.write_table`, 8,192-row groups, 128-row pages), so the real rows sit
// in the second group.
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

// build week 6: a first lookup is the footer once and one page of each column, not a 512 KB tail and a row group.
/** a file that counts what is read from it: `reads` is every `slice` as [start, end). */
function counting(buf: ArrayBuffer): RangedFile & { reads: [number, number][] } {
  const reads: [number, number][] = [];
  return {
    reads,
    byteLength: buf.byteLength,
    slice(start, end = buf.byteLength) {
      reads.push([start, end]);
      return buf.slice(start, end);
    },
  };
}
const sum = (r: [number, number][]) => r.reduce((a, [s, e]) => a + e - s, 0);

/** a fetch that serves `bytes` with `Range` (206 and a Content-Range) like the bucket; `log` gets "METHOD url range". */
function rangeServer(
  bytes: ArrayBuffer,
  log: string[] = [],
  opts: { honorRange?: boolean; contentRange?: boolean } = {},
) {
  const { honorRange = true, contentRange = true } = opts;
  return async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const range = new Headers(init?.headers).get("range");
    log.push(`${init?.method ?? "GET"} ${url}${range ? ` ${range}` : ""}`);
    if (init?.method === "HEAD")
      return new Response(null, {
        status: 200,
        headers: { "content-length": `${bytes.byteLength}` },
      });
    const m = range && honorRange ? /^bytes=(\d*)-(\d*)$/.exec(range) : null;
    if (!m) return new Response(bytes.slice(0), { status: 200 });
    const total = bytes.byteLength;
    const [start, end] =
      m[1] === "" ? [total - Number(m[2]), total - 1] : [Number(m[1]), Number(m[2])];
    return new Response(bytes.slice(start, end + 1), {
      status: 206,
      headers: contentRange ? { "content-range": `bytes ${start}-${end}/${total}` } : {},
    });
  };
}

describe("what a lookup reads", () => {
  it("opens in two requests, the 8-byte trailer and then exactly the footer: footer + 8 bytes", async () => {
    const buf = table();
    const footer = new DataView(buf).getUint32(buf.byteLength - 8, true);
    const f = counting(buf);
    expect(await readCog3857Row(f, HASH)).not.toBeNull();
    expect(f.reads.slice(0, 2)).toEqual([
      [buf.byteLength - 8, buf.byteLength],
      [buf.byteLength - 8 - footer, buf.byteLength - 8],
    ]);
    expect(sum(f.reads.slice(0, 2))).toBe(footer + 8);
  });

  it("the footer is parsed once per source: the second hash reads no trailer and no footer", async () => {
    const url = "https://example.org/t.parquet";
    const fetched: string[] = [];
    vi.stubGlobal("fetch", rangeServer(table(), fetched));
    try {
      await readCog3857Row(url, HASH);
      const after = fetched.length;
      await readCog3857Row(url, "0009290baa128741");
      expect(fetched.slice(after).some((c) => c.endsWith("bytes=-8"))).toBe(false);
      expect(fetched.filter((c) => c.endsWith("bytes=-8"))).toHaveLength(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("the page index: the lookup after the open reads less than half of one row group (seeded fault: no page index)", async () => {
    const buf = table();
    const f = counting(buf);
    await readCog3857Row(f, HASH);
    const lookup = sum(f.reads.slice(2));
    // the control: the same read without the page index reads the group's chunks of the same columns whole
    const { parquetMetadata, parquetReadObjects } = await import("hyparquet");
    const { compressors } = await import("hyparquet-compressors");
    const c = counting(buf);
    await parquetReadObjects({
      file: c,
      metadata: parquetMetadata(buf),
      compressors,
      columns: READ_COLUMNS,
      filter: { content_hash: { $eq: HASH } },
    });
    expect(sum(c.reads)).toBeGreaterThan(0);
    expect(lookup).toBeLessThan(sum(c.reads) / 2);
    // and the whole table is read by neither
    expect(lookup).toBeLessThan(buf.byteLength / 4);
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
    const served: Record<string, ReturnType<typeof rangeServer>> = {
      [sharedTableUrl()]: rangeServer(sharedBytes(), calls),
      [sideTableUrl("v7")]: rangeServer(table(), calls),
    };
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      const f = served[url];
      if (!f) {
        calls.push(`${init?.method ?? "GET"} ${url}`);
        return new Response("<Error>403</Error>", { status: 403 });
      }
      return f(url, init);
    });
    const p = await resolveCog3857("v7b", POOL_URL);
    const q = await resolveCog3857("v7c", URL_);
    expect([p.kind, q.kind]).toEqual(["cog", "cog"]);
    // the shared table's open is the tail range and then the footer, once for both releases, and no HEAD
    const shared = calls.filter((c) => c.includes(sharedTableUrl()));
    expect(shared.filter((c) => c.endsWith("bytes=-8"))).toHaveLength(1);
    expect(shared.some((c) => c.startsWith("HEAD"))).toBe(false);
    expect(calls.some((c) => c.includes("/v7b/") || c.includes("/v7c/"))).toBe(false);
    // a miss in the shared table reads the release's own
    const r = await resolveCog3857("v7", `${PUBLIC_DATA_BASE}cog/usa05/${ONLY_V7}.tif`);
    expect(r.kind).toBe("cog");
    expect(
      calls.filter((c) => c.includes(sharedTableUrl()) && c.endsWith("bytes=-8")),
    ).toHaveLength(1);
    expect(calls.some((c) => c.includes(sideTableUrl("v7")))).toBe(true);
  });
});

describe("urlFile: a file read by ranges", () => {
  const URL_T = "https://example.org/t.parquet";
  afterEach(() => vi.unstubAllGlobals());

  it("a server that ignores Range sends the whole file once, and the lookup still answers", async () => {
    const log: string[] = [];
    vi.stubGlobal("fetch", rangeServer(table(), log, { honorRange: false }));
    const row = await readCog3857Row(URL_T, HASH);
    expect(row?.contentHash).toBe(HASH);
    expect(log).toHaveLength(1);
  });

  it("a 206 without an exposed Content-Range takes its length from a HEAD", async () => {
    const log: string[] = [];
    const f = await urlFile(URL_T, rangeServer(table(), log, { contentRange: false }) as never);
    expect(f.byteLength).toBe(table().byteLength);
    expect(log.map((c) => c.split(" ")[0])).toEqual(["GET", "HEAD"]);
  });

  it("a 403 is no table (titiler), not a throw", async () => {
    vi.stubGlobal("fetch", async () => new Response("<Error>403</Error>", { status: 403 }));
    expect(await readCog3857Row(URL_T, HASH)).toBeNull();
  });
});
