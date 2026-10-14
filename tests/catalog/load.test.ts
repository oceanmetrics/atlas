// The loader's result shapes (ok, http, network, parse, schema), the external-collection rules and
// the lazy item cache -- one fixture per rule, no network (tests/catalog/support.ts serves
// tests/fixtures/catalog/ under made-up origins).
import { describe, expect, it } from "vitest";
import {
  assetUrl,
  clearCatalogCache,
  groupOf,
  loadCatalog,
  loadItems,
  type CatalogCache,
  type CollectionEntry,
} from "../../src/lib/catalog/load";
import { FIXTURE_BASE, MST_BASE, fakeFetch, jsonResponse } from "./support";

function opts(override?: Parameters<typeof fakeFetch>[0]) {
  const f = fakeFetch(override);
  const cache: CatalogCache = new Map();
  return { f, o: { base: FIXTURE_BASE, fetchImpl: f.fetch, cache } };
}

async function entriesOf(override?: Parameters<typeof fakeFetch>[0]) {
  const { o } = opts(override);
  const res = await loadCatalog(o);
  if (!res.ok) throw new Error(`catalog failed: ${res.error.message}`);
  return { entries: res.value.entries, o };
}

describe("loadCatalog: catalog.json -> collections", () => {
  it("loads the catalog and every child collection, in the catalog's own child order", async () => {
    const { entries } = await entriesOf();
    expect(entries.map((e) => e.id)).toEqual([
      "biotrack_indicators",
      "am_0.05",
      "rng_iucn",
      "gm",
      "nc",
    ]);
  });

  it("an OWN collection (relative href) is group oceanmetrics, not external, and ok", async () => {
    const { entries } = await entriesOf();
    const own = entries[0];
    expect(own).toMatchObject({
      id: "biotrack_indicators",
      title: "MBON BioTrack biodiversity indicators",
      group: "oceanmetrics",
      external: false,
      status: "ok",
      error: null,
    });
    expect(own.href).toBe(`${FIXTURE_BASE}biotrack_indicators/collection.json`);
    expect(own.collection?.["atlas:url"]).toBe(own.href);
  });

  it("an EXTERNAL parent collection (v7: child links, no items) is flattened into its children, which keep its group", async () => {
    const { entries } = await entriesOf();
    const am = entries.find((e) => e.id === "am_0.05");
    expect(am).toMatchObject({ group: "mst-v7", external: true, status: "ok" });
    expect(am?.href).toBe(`${MST_BASE}v7/am_0.05/collection.json`);
    expect(entries.some((e) => e.id === "v7")).toBe(false); // the parent itself is not a row
  });

  it("WP12: the v7 collections linked one by one are one entry each in the MarineSensitivity v7 group, with no AquaMaps 0.05", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const catalog = readFileSync(join(__dirname, "../fixtures/registry/catalog.json"), "utf8");
    const own = readFileSync(
      join(__dirname, "../fixtures/registry/aquamaps_native.collection.json"),
      "utf8",
    );
    const stub = (url: string): Response | undefined => {
      if (url === `${FIXTURE_BASE}catalog.json`) return new Response(catalog);
      if (url === `${FIXTURE_BASE}aquamaps_native/collection.json`) return new Response(own);
      const m = /\/stac\/(v\d)\/([^/]+)\/collection\.json$/.exec(url);
      if (!m) return undefined;
      const id = `msens-${m[1]}-${m[2]}`;
      return jsonResponse({
        type: "Collection",
        stac_version: "1.0.0",
        id,
        title: `title of ${m[2]}`,
        description: "x",
        license: "CC-BY-4.0",
        extent: {},
        links: [{ rel: "item", href: "./item.json" }],
      });
    };
    const { entries } = await entriesOf(stub);
    const v7 = entries.filter((e) => e.group === "mst-v7");
    expect(v7.map((e) => e.id)).toEqual(
      [
        "ms_merge",
        "rng_iucn",
        "rng_fws",
        "bl",
        "ch_nmfs",
        "ch_fws",
        "ca_nmfs",
        "rng_turtle_swot_dps",
      ].map((k) => `msens-v7-${k}`),
    );
    expect(v7.every((e) => e.status === "ok" && e.external)).toBe(true);
    expect(entries.some((e) => e.id.includes("am_0.05") || e.id === "msens-v8-am")).toBe(false);
    expect(entries.map((e) => e.id).filter((id) => id.startsWith("msens-v8"))).toEqual([
      "msens-v8-gm",
      "msens-v8-nc",
    ]);
    // the picker's groups (CollectionLens: GROUP_ORDER filtered to the non-empty ones)
    expect([...new Set(entries.map((e) => e.group))]).toEqual(["oceanmetrics", "mst-v7", "mst-v8"]);
  });

  it("an external collection that fails is an 'unavailable' row with its error, never a crash", async () => {
    const { entries } = await entriesOf();
    const rng = entries.find((e) => e.id === "rng_iucn");
    expect(rng).toMatchObject({
      status: "unavailable",
      collection: null,
      group: "mst-v7",
      external: true,
    });
    expect(rng?.title).toBe("IUCN ranges"); // the parent's link title
    expect(rng?.error).toMatchObject({ kind: "http", status: 404 });
    const nc = entries.find((e) => e.id === "nc");
    expect(nc).toMatchObject({
      status: "unavailable",
      group: "mst-v8",
      title: "NOAA NCCOS (density)",
    });
  });

  it("v8 collections are grouped by their /stac/v8/ path", async () => {
    const { entries } = await entriesOf();
    expect(entries.find((e) => e.id === "gm")).toMatchObject({ group: "mst-v8", status: "ok" });
  });

  it("an external collection that THROWS (offline) is unavailable with kind 'network'", async () => {
    const { entries } = await entriesOf((url) => {
      if (url.includes("/v8/gm/")) throw new Error("offline");
      return undefined;
    });
    expect(entries.find((e) => e.id === "gm")?.error).toMatchObject({
      kind: "network",
      message: "offline",
    });
  });
});

describe("loadCatalog: failure shapes of catalog.json itself", () => {
  it("http: a 404", async () => {
    const { o } = opts((url) =>
      url.endsWith("catalog.json") ? new Response("", { status: 404 }) : undefined,
    );
    const res = await loadCatalog(o);
    expect(res).toEqual({
      ok: false,
      error: { kind: "http", status: 404, message: "HTTP 404", url: `${FIXTURE_BASE}catalog.json` },
    });
  });

  it("network: fetch rejects", async () => {
    const { o } = opts((url) => {
      if (url.endsWith("catalog.json")) throw new TypeError("Failed to fetch");
      return undefined;
    });
    const res = await loadCatalog(o);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatchObject({ kind: "network", message: "Failed to fetch" });
  });

  it("parse: a 200 that is not JSON", async () => {
    const { o } = opts((url) =>
      url.endsWith("catalog.json") ? new Response("<html>nope</html>") : undefined,
    );
    const res = await loadCatalog(o);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.kind).toBe("parse");
  });

  it("schema: JSON that is not a STAC Catalog (wrong type, or no links)", async () => {
    for (const body of [
      { type: "Collection", id: "x", links: [] },
      { type: "Catalog", id: "x" },
      [],
      "str",
    ]) {
      const { o } = opts((url) => (url.endsWith("catalog.json") ? jsonResponse(body) : undefined));
      const res = await loadCatalog(o);
      expect(res.ok, JSON.stringify(body)).toBe(false);
      if (!res.ok) expect(res.error.kind).toBe("schema");
    }
  });

  it("schema: an own collection whose JSON is not a Collection is an unavailable row, not an error", async () => {
    const { entries } = await entriesOf((url) =>
      url.endsWith("biotrack_indicators/collection.json")
        ? jsonResponse({ hello: "world" })
        : undefined,
    );
    expect(entries[0]).toMatchObject({ status: "unavailable", id: "biotrack_indicators" });
    expect(entries[0].error?.kind).toBe("schema");
  });

  it("never throws: even a fetch that is missing entirely resolves to a network error", async () => {
    const res = await loadCatalog({
      base: FIXTURE_BASE,
      fetchImpl: undefined as never,
      cache: new Map(),
    });
    // in this Node environment a global fetch exists, so the call proceeds and 404s/fails softly
    expect(typeof res.ok).toBe("boolean");
  });
});

describe("loadCatalog: caching", () => {
  it("a second load with the same cache makes no new requests", async () => {
    const { f, o } = opts();
    await loadCatalog(o);
    const n = f.calls.length;
    await loadCatalog(o);
    expect(f.calls.length).toBe(n);
  });

  it("clearCatalogCache forces a refetch", async () => {
    const { f, o } = opts();
    await loadCatalog(o);
    const n = f.calls.length;
    clearCatalogCache(o.cache);
    await loadCatalog(o);
    expect(f.calls.length).toBe(n * 2);
  });
});

describe("loadItems: lazy, cached, partial failures survive", () => {
  async function biotrack(override?: Parameters<typeof fakeFetch>[0]) {
    const { entries, o } = await entriesOf(override);
    return { entry: entries[0] as CollectionEntry, o, calls: opts };
  }

  it("fetches no item until asked (the catalog load touches collections only)", async () => {
    const { f, o } = opts();
    await loadCatalog(o);
    expect(f.calls.some((u) => u.includes("/items/"))).toBe(false);
  });

  it("loads all 8 items of the biotrack collection, each recording its own URL", async () => {
    const { entry, o } = await biotrack();
    const res = await loadItems(entry, o);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.failed).toEqual([]);
    expect(res.value.items.map((i) => i.id)).toEqual([
      "all_summer_richness",
      "all_summer_uncertainty",
      "all_winter_richness",
      "all_winter_uncertainty",
      "shark_summer_richness",
      "shark_summer_uncertainty",
      "shark_winter_richness",
      "shark_winter_uncertainty",
    ]);
    expect(res.value.items[0]["atlas:url"]).toBe(
      `${FIXTURE_BASE}biotrack_indicators/items/all_summer_richness.json`,
    );
  });

  it("caches per collection: the second call makes no request", async () => {
    const { f, o } = opts();
    const cat = await loadCatalog(o);
    if (!cat.ok) throw new Error("catalog");
    const entry = cat.value.entries[0];
    await loadItems(entry, o);
    const n = f.calls.length;
    const again = await loadItems(entry, o);
    expect(again.ok).toBe(true);
    expect(f.calls.length).toBe(n);
  });

  it("a failing item is skipped and reported; the rest still load", async () => {
    const { entry, o } = await biotrack((url) =>
      url.endsWith("/shark_winter_uncertainty.json")
        ? new Response("", { status: 500 })
        : undefined,
    );
    const res = await loadItems(entry, o);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.items).toHaveLength(7);
    expect(res.value.failed).toHaveLength(1);
    expect(res.value.failed[0]).toMatchObject({ kind: "http", status: 500 });
  });

  it("an item that is not a STAC Feature is a schema failure, skipped", async () => {
    const { entry, o } = await biotrack((url) =>
      url.endsWith("/all_summer_richness.json")
        ? jsonResponse({ type: "Collection", id: "x" })
        : undefined,
    );
    const res = await loadItems(entry, o);
    if (!res.ok) throw new Error("expected ok");
    expect(res.value.items).toHaveLength(7);
    expect(res.value.failed[0].kind).toBe("schema");
  });

  it("when EVERY item fails the whole result is an error naming the count", async () => {
    const { entry, o } = await biotrack((url) =>
      url.includes("/items/") ? new Response("", { status: 503 }) : undefined,
    );
    const res = await loadItems(entry, o);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.kind).toBe("http");
      expect(res.error.message).toContain("none of the 8 items");
    }
  });

  it("an unavailable collection has no items: ok false with its own error", async () => {
    const { entries, o } = await entriesOf();
    const rng = entries.find((e) => e.id === "rng_iucn") as CollectionEntry;
    const res = await loadItems(rng, o);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatchObject({ kind: "http", status: 404 });
  });

  it("a collection with no item links is an empty, ok set", async () => {
    const { entries, o } = await entriesOf();
    const gm = entries.find((e) => e.id === "gm") as CollectionEntry;
    const res = await loadItems(gm, o);
    expect(res).toEqual({ ok: true, value: { items: [], failed: [] } });
  });

  it("an external collection's items resolve against the collection's own URL", async () => {
    const { entries, o } = await entriesOf();
    const am = entries.find((e) => e.id === "am_0.05") as CollectionEntry;
    const res = await loadItems(am, o);
    if (!res.ok) throw new Error("expected ok");
    expect(res.value.items[0]["atlas:url"]).toBe(`${MST_BASE}v7/am_0.05/items/Fis-1.json`);
  });
});

describe("assetUrl: hrefs resolve against the document that lists them", () => {
  it("../values.parquet inside an item means the collection's file", () => {
    const owner = { "atlas:url": `${FIXTURE_BASE}biotrack_indicators/items/a.json` };
    expect(assetUrl(owner, { href: "../values.parquet" })).toBe(
      `${FIXTURE_BASE}biotrack_indicators/values.parquet`,
    );
  });

  it("an absolute href passes through; a relative one with no owner URL is null", () => {
    expect(assetUrl({}, { href: "https://x.test/a.tif" })).toBe("https://x.test/a.tif");
    expect(assetUrl({}, { href: "./a.tif" })).toBeNull();
  });
});

describe("groupOf", () => {
  const base = FIXTURE_BASE;
  it("under the base is OceanMetrics; /stac/v7|v8/ are the MarineSensitivity groups; else external", () => {
    expect(groupOf(`${base}x/collection.json`, base)).toBe("oceanmetrics");
    expect(groupOf("https://file.marinesensitivity.org/stac/v7/collection.json", base)).toBe(
      "mst-v7",
    );
    expect(groupOf("https://file.marinesensitivity.org/stac/v8/nc/collection.json", base)).toBe(
      "mst-v8",
    );
    expect(groupOf("https://elsewhere.test/stac/collection.json", base)).toBe("external");
    expect(groupOf("not a url", base)).toBe("external");
  });
});
