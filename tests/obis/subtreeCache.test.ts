// The class files the WoRMS subtree keeps in DuckDB-WASM (src/lens/collection/h3/subtreeCache.ts) and the reads of
// the species lookup made once per page (lookup.ts): the lineage file whole (obisindicators 0.12's
// `species/lineage.parquet`), the lookup's class columns and the Cell pane's names by range reads, never the whole
// 4.5 MB lookup. The cache on a stub engine (a store of byte sizes, a `drop` that records); the runner (`runSubtree`)
// on the same stub with the fixture release behind a counting fetch, so the reads are counted where the page counts
// them.
import { beforeEach, describe, expect, it } from "vitest";
import { readLookup } from "../../src/lens/collection/h3/cellSpecies";
import { forgetLookups, loadColumns, loadLookup } from "../../src/lens/collection/h3/lookup";
import { classFileUrl, loadedWords, subtreeTableOf } from "../../src/lens/collection/h3/subtree";
import { ClassFileCache, LOADED_CAP_BYTES } from "../../src/lens/collection/h3/subtreeCache";
import {
  runSubtree,
  type SubtreeEngine,
  type SubtreeRequest,
} from "../../src/lens/collection/h3/subtreeRun";
import { buffer, collection, localFetch, spec } from "./support";

const MB = 1024 * 1024;

/** the engine's store of byte sizes and its drops, nothing else */
function stubCacheEngine(sizes: Record<string, number>) {
  const store = new Map<string, { bytes: number }>(
    Object.entries(sizes).map(([k, v]) => [k, { bytes: v }]),
  );
  const drops: string[] = [];
  return {
    drops,
    store,
    engine: {
      store: { get: (n: string) => store.get(n) },
      drop: async (n: string) => {
        drops.push(n);
        store.delete(n);
      },
    },
  };
}

describe("the class files kept in the engine", () => {
  it("past the cap the least recently used file is dropped, never the current one", async () => {
    const s = stubCacheEngine({ a: 10 * MB, b: 10 * MB, c: 10 * MB });
    const cache = new ClassFileCache(s.engine, 25 * MB);
    cache.acquire(["a"])();
    cache.acquire(["b"])();
    expect(await cache.trim()).toEqual({ dropped: [], droppedBytes: 0, loadedBytes: 20 * MB });
    const release = cache.acquire(["c"]);
    const t = await cache.trim();
    expect(t).toEqual({ dropped: ["a"], droppedBytes: 10 * MB, loadedBytes: 20 * MB });
    expect(s.drops).toEqual(["a"]);
    expect(cache.loadedBytes()).toBe(20 * MB);
    release();
  });
  it("a file used again is younger than one not used: the order is use, not registration", async () => {
    const s = stubCacheEngine({ a: 10 * MB, b: 10 * MB, c: 10 * MB });
    const cache = new ClassFileCache(s.engine, 25 * MB);
    cache.acquire(["a"])();
    cache.acquire(["b"])();
    cache.acquire(["a"])(); // a zoom back to a: b is now the oldest
    cache.acquire(["c"])();
    await cache.trim();
    expect(s.drops).toEqual(["b"]);
  });
  it("drops as many as the cap asks, oldest first, and stops at the cap", async () => {
    const s = stubCacheEngine({ a: 8 * MB, b: 8 * MB, c: 8 * MB, d: 8 * MB });
    const cache = new ClassFileCache(s.engine, 17 * MB);
    for (const n of ["a", "b", "c"]) cache.acquire([n])();
    const hold = cache.acquire(["d"]);
    const t = await cache.trim();
    expect(s.drops).toEqual(["a", "b"]);
    expect(t.loadedBytes).toBe(16 * MB);
    hold();
  });
  it("a file another computation holds is not dropped, even when it is the oldest", async () => {
    const s = stubCacheEngine({ a: 10 * MB, b: 10 * MB, c: 10 * MB });
    const cache = new ClassFileCache(s.engine, 15 * MB);
    const inFlight = cache.acquire(["a"]);
    cache.acquire(["b"])();
    const current = cache.acquire(["c"]);
    await cache.trim();
    expect(s.drops).toEqual(["b"]); // a is held, c is current: only b can go
    expect(cache.loadedBytes()).toBe(20 * MB); // still over the cap: nothing else may be dropped
    inFlight();
    current();
    await cache.trim();
    expect(s.drops).toEqual(["b", "a"]);
  });
  it("a current set over the cap alone is kept whole", async () => {
    const s = stubCacheEngine({ a: 20 * MB, b: 20 * MB });
    const cache = new ClassFileCache(s.engine, 32 * MB);
    cache.acquire(["a", "b"]);
    expect((await cache.trim()).dropped).toEqual([]);
    expect(LOADED_CAP_BYTES).toBe(32 * MB);
  });
  it("the read line says how much is loaded and the cap, and what was dropped", () => {
    expect(loadedWords({ loadedBytes: 27 * MB, capBytes: 32 * MB })).toBe(
      " 27 MB of species tables loaded; older ones are dropped past 32 MB.",
    );
    expect(
      loadedWords({
        loadedBytes: 20 * MB,
        capBytes: 32 * MB,
        droppedFiles: 2,
        droppedBytes: 14 * MB,
      }),
    ).toBe(
      " 20 MB of species tables loaded; older ones are dropped past 32 MB. Dropped 2 older files (14 MB).",
    );
    expect(loadedWords({ loadedBytes: 276_067, capBytes: 32 * MB })).toContain(
      "0.26 MB of species tables loaded",
    );
    expect(loadedWords({})).toBe("");
  });
});

// ---- the runner on a stub engine --------------------------------------------------------------------------------

const T = subtreeTableOf(collection())!;
const LOOKUP_URL = T.lookup;
const LINEAGE_URL = T.lineage!;
const lookupFile = buffer("species/species.parquet");
const lineageFile = buffer("species/lineage.parquet");

/** the fixture release behind a fetch (Range honoured), HEAD answered for the class files by a size table; counts the
 * GETs of the lineage and the lookup, whole (no Range) and ranged, and their bytes */
function stubFetch(fileSizes: Record<string, number>) {
  const log = { lineageGets: 0, lookupWhole: 0, lookupRanged: 0, lookupBytes: 0, heads: 0 };
  const local = localFetch();
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (init?.method === "HEAD") {
      log.heads++;
      const n = fileSizes[url];
      return n === undefined
        ? new Response(null, { status: 404 })
        : new Response(null, { status: 200, headers: { "content-length": String(n) } });
    }
    const ranged = new Headers(init?.headers).has("range");
    const r = await local(input, init);
    if (url === LINEAGE_URL) log.lineageGets++;
    if (url === LOOKUP_URL) {
      if (ranged) log.lookupRanged++;
      else log.lookupWhole++;
      log.lookupBytes += Number(r.headers.get("content-length") ?? 0);
    }
    return r;
  }) as typeof fetch;
  return { f, log };
}

/** the engine the runner uses: the taxa query answered by a table (the AphiaID asked -> its taxa), the class files
 * by their sizes, the cells query by a count */
function stubEngine(taxaOf: (aphiaid: number) => number[], fileSizes: Record<string, number>) {
  const store = new Map<string, { bytes: number }>();
  const calls = {
    loadBytes: [] as { name: string; bytes: number }[],
    load: [] as string[],
    drop: [] as string[],
    sql: [] as string[],
  };
  const engine: SubtreeEngine = {
    store: { get: (n: string) => store.get(n), has: (n: string) => store.has(n) } as never,
    loadBytes: async (name, _digest, bytes) => {
      if (store.has(name)) return;
      calls.loadBytes.push({ name, bytes: bytes.byteLength });
      store.set(name, { bytes: bytes.byteLength });
    },
    load: async (name, url) => {
      if (store.has(name)) return;
      calls.load.push(url);
      store.set(name, { bytes: fileSizes[url] ?? 0 });
    },
    drop: async (name) => {
      calls.drop.push(name);
      store.delete(name);
    },
    exec: (async (sql: string) => {
      calls.sql.push(sql);
      if (sql.startsWith("CREATE TABLE") || sql.startsWith("DROP")) return [];
      if (sql.includes("count(*)::INTEGER AS cells")) return [{ cells: 3 }];
      const id = Number(/list_contains\(lineage, (\d+)\)/.exec(sql)?.[1]);
      return taxaOf(id).map((aphiaid) => ({ aphiaid }));
    }) as never,
    exportParquet: async () => new Uint8Array(8),
  };
  return { engine, calls, store };
}

const req = (aphiaid: number): SubtreeRequest => ({
  table: T,
  aphiaid,
  name: `taxon ${aphiaid}`,
  res: 3,
  tableRes: 3,
  decade: null,
  ranges: null,
  indicators: ["n"],
  esn: 50,
});
const fileOf = (cls: string) => classFileUrl(T, 3, cls);
// the fixture's taxa: Cetacea's Mammalia, a fish, a bird
const CETACEA = [137087, 137088, 137089];
const TAXA: Record<number, number[]> = { 2688: CETACEA, 1: [126291], 2: [137087], 3: [137142] };
const taxaOf = (id: number) => TAXA[id] ?? [];

beforeEach(forgetLookups);

describe("the lookup is read once per page", () => {
  it("a subtree reads the lineage file whole and the lookup's class columns by range, never the whole lookup", async () => {
    const sizes = { [fileOf("Mammalia")]: 276_067 };
    const { f, log } = stubFetch(sizes);
    const { engine, calls } = stubEngine(taxaOf, sizes);
    const out = await runSubtree(req(2688), f, { engine });
    expect(out.kind).toBe("ready");
    if (out.kind !== "ready") return;
    expect(log.lineageGets).toBe(1);
    expect(log.lookupWhole).toBe(0);
    expect(log.lookupRanged).toBeGreaterThanOrEqual(1);
    // the lineage registered in the engine from a copy, its own bytes
    expect(calls.loadBytes).toEqual([
      { name: expect.stringContaining("lineage_parquet"), bytes: lineageFile.byteLength },
    ]);
    // the taxa from the lineage file, the classes and records from the lookup's columns
    expect(
      calls.sql.some((x) => x.includes("lineage_parquet") && x.includes("list_contains")),
    ).toBe(true);
    expect(out.classes).toEqual(["Mammalia"]);
    expect([...out.taxa].sort()).toEqual(CETACEA);
    expect(out.records).toBeGreaterThan(0);
    // what the read line counts: the lineage and the class columns, under the whole lookup
    expect(out.read.lookupBytes).toBe(lineageFile.byteLength + log.lookupBytes);
    // (the fixture lookup is 9 KB, inside the first 64 KiB suffix read; the live one's class columns are 0.45 of 4.5 MB)
    expect(log.lookupBytes).toBeLessThanOrEqual(lookupFile.byteLength);
    // Reproduce reads the lineage file, not the lookup
    expect(out.sql).toContain("species/lineage.parquet");
    expect(out.sql).not.toContain("species/species.parquet");
  });
  it("a second subtree on the page reads neither the lineage nor the class columns again", async () => {
    const sizes = { [fileOf("Mammalia")]: 276_067, [fileOf("Teleostei")]: 1_000 };
    const { f, log } = stubFetch(sizes);
    const { engine, calls } = stubEngine(taxaOf, sizes);
    await runSubtree(req(2688), f, { engine });
    const ranged = log.lookupRanged;
    const b = await runSubtree(req(1), f, { engine });
    expect(b.kind).toBe("ready");
    expect(b.read.lookupBytes).toBe(0);
    expect(log.lineageGets).toBe(1);
    expect(log.lookupRanged).toBe(ranged);
    expect(calls.loadBytes).toHaveLength(1);
  });
  it("two readers asking at once share the one request", async () => {
    const sizes = { [fileOf("Mammalia")]: 276_067, [fileOf("Teleostei")]: 1_000 };
    const { f, log } = stubFetch(sizes);
    const { engine } = stubEngine(taxaOf, sizes);
    const [a, b, c] = await Promise.all([
      runSubtree(req(2688), f, { engine }),
      runSubtree(req(1), f, { engine }),
      loadLookup(LINEAGE_URL, f),
    ]);
    expect(a.kind).toBe("ready");
    expect(b.kind).toBe("ready");
    expect(c.bytes).toBe(lineageFile.byteLength);
    expect(log.lineageGets).toBe(1);
  });
  it("the Cell pane's names: the whole lookup, one read per page, with the EOV column", async () => {
    const { f, log } = stubFetch({});
    const a = await loadLookup(LOOKUP_URL, f);
    const b = await loadLookup(LOOKUP_URL, f);
    expect(a.fetched).toBe(lookupFile.byteLength);
    expect(b.fetched).toBe(0);
    expect(log.lookupWhole).toBe(1);
    const names = await readLookup(spec(), b.buffer);
    expect(names.size).toBe(91);
    expect(names.get(126291)).toMatchObject({ species: "Derichthys serpentinus", eov: "fish" });
  });
  it("the Cell pane first, then a subtree: its class columns come out of the pane's bytes, no range read", async () => {
    const sizes = { [fileOf("Mammalia")]: 276_067 };
    const { f, log } = stubFetch(sizes);
    const { engine } = stubEngine(taxaOf, sizes);
    await loadLookup(LOOKUP_URL, f);
    const out = await runSubtree(req(2688), f, { engine });
    expect(out.kind).toBe("ready");
    expect(log.lookupWhole).toBe(1);
    expect(log.lookupRanged).toBe(0);
    expect(log.lineageGets).toBe(1);
    expect(out.read.lookupBytes).toBe(lineageFile.byteLength);
    if (out.kind === "ready") expect(out.classes).toEqual(["Mammalia"]);
  });
  it("the class columns by range: their chunks merged across small gaps, asked once per page", async () => {
    const { f, log } = stubFetch({});
    const cols = ["aphiaid", "class", "records"];
    const a = await loadColumns(LOOKUP_URL, cols, f);
    const b = await loadColumns(LOOKUP_URL, [...cols].reverse(), f);
    expect(a.fetched).toBeGreaterThan(0);
    expect(b.fetched).toBe(0);
    expect(b.requests).toBe(0);
    expect(log.lookupWhole).toBe(0);
    expect(b.rows).toHaveLength(91);
    expect(Object.keys(b.rows[0]).sort()).toEqual(["aphiaid", "class", "records"]);
  });
  it("a release with no lineage file: the whole lookup holds the lineage, read once", async () => {
    const c = collection() as unknown as Record<string, Record<string, unknown>>;
    delete c["obis:species"].lineage;
    const T11 = subtreeTableOf(c)!;
    expect(T11.lineage).toBeNull();
    const sizes = { [fileOf("Mammalia")]: 276_067 };
    const { f, log } = stubFetch(sizes);
    const { engine, calls } = stubEngine(taxaOf, sizes);
    const out = await runSubtree({ ...req(2688), table: T11 }, f, { engine });
    expect(out.kind).toBe("ready");
    expect(log.lineageGets).toBe(0);
    expect(log.lookupWhole).toBe(1);
    expect(log.lookupRanged).toBe(0);
    expect(calls.loadBytes[0].bytes).toBe(lookupFile.byteLength);
    // the one whole read is counted once
    expect(out.read.lookupBytes).toBe(lookupFile.byteLength);
  });
  it("a failed read is forgotten: the next ask fetches again", async () => {
    let n = 0;
    const f = (async () =>
      ++n === 1
        ? new Response("", { status: 503 })
        : new Response(lineageFile.slice(0))) as typeof fetch;
    await expect(loadLookup(LINEAGE_URL, f)).rejects.toThrow("HTTP 503");
    expect((await loadLookup(LINEAGE_URL, f)).fetched).toBe(lineageFile.byteLength);
    expect(n).toBe(2);
    let m = 0;
    const local = localFetch();
    const g = (async (input: RequestInfo | URL, init?: RequestInit) =>
      ++m === 1 ? new Response("", { status: 503 }) : local(input, init)) as typeof fetch;
    await expect(loadColumns(LOOKUP_URL, ["aphiaid"], g)).rejects.toThrow("503");
    expect((await loadColumns(LOOKUP_URL, ["aphiaid"], g)).rows).toHaveLength(91);
  });
});

describe("the runner drops the older class files past the cap", () => {
  it("three taxa in three classes with a small cap: the oldest goes, the current stays, the line says so", async () => {
    const sizes = {
      [fileOf("Teleostei")]: 6 * MB,
      [fileOf("Mammalia")]: 6 * MB,
      [fileOf("Aves")]: 6 * MB,
    };
    const { f } = stubFetch(sizes);
    const { engine, calls } = stubEngine(taxaOf, sizes);
    const run = (id: number) => runSubtree(req(id), f, { engine, cap: 13 * MB });
    const a = await run(1);
    const b = await run(2);
    expect(a.read.droppedFiles + b.read.droppedFiles).toBe(0);
    expect(b.read.loadedBytes).toBe(12 * MB);
    const c = await run(3);
    expect(c.read.droppedFiles).toBe(1);
    expect(c.read.droppedBytes).toBe(6 * MB);
    expect(c.read.loadedBytes).toBe(12 * MB);
    expect(calls.drop).toHaveLength(1);
    expect(calls.drop[0]).toContain("class_Teleostei_"); // the file of the first taxon's class, the oldest
    // a zoom back to taxon 3 reads and drops nothing
    const again = await run(3);
    expect(again.read.droppedFiles).toBe(0);
    expect(again.read.bytes).toBe(0);
    expect(calls.load).toEqual([fileOf("Teleostei"), fileOf("Mammalia"), fileOf("Aves")]);
    expect(c.read.capBytes).toBe(13 * MB);
  });
});
