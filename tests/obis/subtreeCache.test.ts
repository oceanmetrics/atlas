// The class files the WoRMS subtree keeps in DuckDB-WASM (src/lens/collection/h3/subtreeCache.ts) and the one read of
// the species lookup its two readers share (lookup.ts). The cache on a stub engine (a store of byte sizes, a `drop`
// that records); the runner (`runSubtree`) on the same stub with a stubbed fetch, so the lookup's fetches are counted
// where the page counts them.
import { beforeEach, describe, expect, it } from "vitest";
import { readLookup } from "../../src/lens/collection/h3/cellSpecies";
import { forgetLookups, loadLookup } from "../../src/lens/collection/h3/lookup";
import { classFileUrl, loadedWords, subtreeTableOf } from "../../src/lens/collection/h3/subtree";
import { ClassFileCache, LOADED_CAP_BYTES } from "../../src/lens/collection/h3/subtreeCache";
import {
  runSubtree,
  type SubtreeEngine,
  type SubtreeRequest,
} from "../../src/lens/collection/h3/subtreeRun";
import { buffer, collection, spec } from "./support";

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
const lookupBytes = buffer("species/species.parquet");

/** a fetch that serves the lookup and answers HEAD for the class files by a size table; counts the lookup's GETs */
function stubFetch(fileSizes: Record<string, number>) {
  const log = { lookupGets: 0, heads: 0 };
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (init?.method === "HEAD") {
      log.heads++;
      const n = fileSizes[url];
      return n === undefined
        ? new Response(null, { status: 404 })
        : new Response(null, { status: 200, headers: { "content-length": String(n) } });
    }
    if (url === LOOKUP_URL) {
      log.lookupGets++;
      return new Response(lookupBytes.slice(0));
    }
    return new Response("", { status: 404 });
  }) as typeof fetch;
  return { f, log };
}

/** the engine the runner uses, answering the queries it asks by their first words */
function stubEngine(classOf: (aphiaid: number) => string, fileSizes: Record<string, number>) {
  const store = new Map<string, { bytes: number }>();
  const calls = { loadBytes: [] as number[], load: [] as string[], drop: [] as string[] };
  const engine: SubtreeEngine = {
    store: { get: (n: string) => store.get(n), has: (n: string) => store.has(n) } as never,
    loadBytes: async (name, _digest, bytes) => {
      if (store.has(name)) return;
      calls.loadBytes.push(bytes.byteLength);
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
      const aphia = Number(/list_contains\(l\.lineage, (\d+)\)/.exec(sql)?.[1] ?? NaN);
      if (sql.startsWith("CREATE TABLE") || sql.startsWith("DROP")) return [];
      if (sql.includes("count(*)::INTEGER AS cells")) return [{ cells: 3 }];
      // the classes query, then the taxa query (both name the aphiaid; the taxa one selects `aphiaid` alone)
      const id = Number(/(\d+)\)/.exec(sql.slice(sql.lastIndexOf("list_contains")))?.[1]);
      return sql.includes("class") && sql.includes("GROUP BY")
        ? [{ class: classOf(id || aphia), taxa: 1, records: 10 }]
        : [{ aphiaid: id || aphia }];
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

beforeEach(forgetLookups);

describe("the lookup is read once per page", () => {
  it("a subtree and then the Cell pane's names cause one fetch of the lookup", async () => {
    const { f, log } = stubFetch({ [fileOf("Mammalia")]: 276_067 });
    const { engine, calls } = stubEngine(() => "Mammalia", { [fileOf("Mammalia")]: 276_067 });
    const out = await runSubtree(req(2688), f, { engine });
    expect(out.kind).toBe("ready");
    expect(out.read.lookupBytes).toBe(lookupBytes.byteLength);
    // the pane: the same loader, then its names out of the same bytes
    const got = await loadLookup(LOOKUP_URL, f);
    const names = await readLookup(spec(), got.buffer);
    expect(names.size).toBeGreaterThan(0);
    expect(got.fetched).toBe(0);
    expect(log.lookupGets).toBe(1);
    // the engine was given a copy: its registration did not detach the bytes the pane parsed
    expect(calls.loadBytes).toEqual([lookupBytes.byteLength]);
    expect(got.buffer.byteLength).toBe(lookupBytes.byteLength);
  });
  it("the Cell pane first, then a subtree: still one fetch, and the subtree reports no lookup bytes", async () => {
    const { f, log } = stubFetch({ [fileOf("Mammalia")]: 276_067 });
    const { engine } = stubEngine(() => "Mammalia", { [fileOf("Mammalia")]: 276_067 });
    const got = await loadLookup(LOOKUP_URL, f);
    expect(got.fetched).toBe(lookupBytes.byteLength);
    const out = await runSubtree(req(2688), f, { engine });
    expect(out.kind).toBe("ready");
    expect(out.read.lookupBytes).toBe(0);
    expect(log.lookupGets).toBe(1);
  });
  it("two readers asking at once share the one request", async () => {
    const { f, log } = stubFetch({ [fileOf("Mammalia")]: 276_067 });
    const { engine } = stubEngine(() => "Mammalia", { [fileOf("Mammalia")]: 276_067 });
    const [a, b] = await Promise.all([
      runSubtree(req(2688), f, { engine }),
      loadLookup(LOOKUP_URL, f),
    ]);
    expect(a.kind).toBe("ready");
    expect(b.bytes).toBe(lookupBytes.byteLength);
    expect(log.lookupGets).toBe(1);
  });
  it("a failed read is forgotten: the next ask fetches again", async () => {
    let n = 0;
    const f = (async () =>
      ++n === 1
        ? new Response("", { status: 503 })
        : new Response(lookupBytes.slice(0))) as typeof fetch;
    await expect(loadLookup(LOOKUP_URL, f)).rejects.toThrow("HTTP 503");
    expect((await loadLookup(LOOKUP_URL, f)).fetched).toBe(lookupBytes.byteLength);
    expect(n).toBe(2);
  });
});

describe("the runner drops the older class files past the cap", () => {
  it("three taxa in three classes with a small cap: the oldest goes, the current stays, the line says so", async () => {
    const sizes = { [fileOf("A")]: 6 * MB, [fileOf("B")]: 6 * MB, [fileOf("C")]: 6 * MB };
    const { f } = stubFetch(sizes);
    const { engine, calls } = stubEngine((id) => ({ 1: "A", 2: "B", 3: "C" })[id] ?? "A", sizes);
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
    expect(calls.drop[0]).toContain("class_A_"); // the file of class A, the oldest
    // a zoom back to taxon 3 reads and drops nothing
    const again = await run(3);
    expect(again.read.droppedFiles).toBe(0);
    expect(again.read.bytes).toBe(0);
    expect(calls.load).toEqual([fileOf("A"), fileOf("B"), fileOf("C")]);
    expect(c.read.capBytes).toBe(13 * MB);
  });
});
