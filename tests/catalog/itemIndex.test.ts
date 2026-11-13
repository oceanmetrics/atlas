// The one-file item index (src/lib/catalog/load.ts#loadItems, `rel: "items"`): a collection with 578 Items
// listed them one request each (~16 s before the first hex drew on the real SEFSC collection). With the index
// the loader makes ONE request; each `item` link takes the index feature with its id AS IF fetched from the
// link's own URL (so `../values.parquet` still means the collection's file), and anything the index cannot give
// falls back to the per-item fetch, with a warning in `failed`, never fatally. The synthetic catalog
// (tests/fixtures/catalog/) with an index built from biotrack's own item files.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { hexAssetOf, valuesAssetOf } from "../../src/lib/catalog/assets";
import {
  ITEM_INDEX_REL,
  loadCatalog,
  loadItems,
  type CollectionEntry,
} from "../../src/lib/catalog/load";
import type { StacItem } from "../../src/lib/catalog/types";
import { FIXTURE_BASE, fakeFetch, jsonResponse, type Override } from "./support";

const ROOT = join(__dirname, "../fixtures/catalog/biotrack_indicators");
const COLLECTION_URL = `${FIXTURE_BASE}biotrack_indicators/collection.json`;
const INDEX_URL = `${FIXTURE_BASE}biotrack_indicators/items.json`;
const ITEM_FILES = readdirSync(join(ROOT, "items")).filter((f) => f.endsWith(".json"));
const itemDoc = (file: string) =>
  JSON.parse(readFileSync(join(ROOT, "items", file), "utf8")) as Record<string, unknown>;
const ALL_FEATURES = ITEM_FILES.map(itemDoc);

/** the collection with an index link, and the index answered by `index` (a body, or a Response). */
function withIndex(
  index: unknown,
  extra: Override = () => undefined,
  editLinks: (links: { rel: string; href: string; id?: unknown }[]) => void = () => undefined,
): Override {
  return (url) => {
    if (url === COLLECTION_URL) {
      const c = JSON.parse(readFileSync(join(ROOT, "collection.json"), "utf8"));
      c.links.push({ rel: ITEM_INDEX_REL, href: "./items.json", type: "application/geo+json" });
      editLinks(c.links);
      return jsonResponse(c);
    }
    if (url === INDEX_URL) return index instanceof Response ? index : jsonResponse(index);
    return extra(url);
  };
}

async function load(override?: Override) {
  const f = fakeFetch(override);
  const cache = new Map();
  const cat = await loadCatalog({ base: FIXTURE_BASE, fetchImpl: f.fetch, cache });
  if (!cat.ok) throw new Error("catalog failed");
  const entry = cat.value.entries.find((e) => e.id === "biotrack_indicators") as CollectionEntry;
  const before = f.calls.length;
  const res = await loadItems(entry, { fetchImpl: f.fetch, cache });
  if (!res.ok) throw new Error(`items failed: ${res.error.message}`);
  return { ...res.value, calls: f.calls.slice(before) };
}

const itemCalls = (calls: string[]) =>
  calls.filter((u) => u.includes("/biotrack_indicators/items/"));
const byId = (items: StacItem[]) => Object.fromEntries(items.map((it) => [it.id, it]));
const fc = (features: unknown[]) => ({ type: "FeatureCollection", features });

describe("the item index (rel: items)", () => {
  it("one request instead of one per item", async () => {
    const plain = await load();
    expect(itemCalls(plain.calls)).toHaveLength(ITEM_FILES.length);
    const indexed = await load(withIndex(fc(ALL_FEATURES)));
    expect(indexed.calls).toEqual([INDEX_URL]);
    expect(indexed.items.map((it) => it.id).sort()).toEqual(plain.items.map((it) => it.id).sort());
    expect(indexed.failed).toEqual([]);
  });

  it("resolves every relative href exactly as the per-item fetch does (against the ITEM's url)", async () => {
    const plain = byId((await load()).items);
    const indexed = byId((await load(withIndex(fc(ALL_FEATURES)))).items);
    for (const [id, it] of Object.entries(plain)) {
      const ix = indexed[id];
      expect(ix["atlas:url"], id).toBe(it["atlas:url"]);
      expect(valuesAssetOf(ix), id).toEqual(valuesAssetOf(it));
      expect(hexAssetOf(ix, null), id).toEqual(hexAssetOf(it, null));
      // the collection's own files, not the catalog's (`../values.parquet` from `items/<id>.json`)
      expect(valuesAssetOf(ix)?.url).toBe(`${FIXTURE_BASE}biotrack_indicators/values.parquet`);
      expect(ix).toEqual(it);
    }
  });

  it("an item the index lacks is fetched on its own, with a warning", async () => {
    const res = await load(withIndex(fc(ALL_FEATURES.slice(1))));
    const lacking = ITEM_FILES[0];
    expect(itemCalls(res.calls)).toEqual([`${FIXTURE_BASE}biotrack_indicators/items/${lacking}`]);
    expect(res.items).toHaveLength(ITEM_FILES.length);
    expect(res.failed).toHaveLength(1);
    expect(res.failed[0]).toMatchObject({ url: INDEX_URL });
    expect(res.failed[0].message).toMatch(new RegExp(`lacks 1 of ${ITEM_FILES.length} items`));
  });

  it("a malformed index (not JSON, not a FeatureCollection, an HTTP error) falls back to every item, never fatally", async () => {
    for (const bad of [
      new Response("{not json", { status: 200 }),
      { type: "Feature", id: "x" },
      { type: "FeatureCollection", features: "nope" },
      new Response("gone", { status: 404 }),
    ]) {
      const res = await load(withIndex(bad));
      expect(itemCalls(res.calls)).toHaveLength(ITEM_FILES.length);
      expect(res.items).toHaveLength(ITEM_FILES.length);
      expect(res.failed).toHaveLength(1);
      expect(res.failed[0].message).toMatch(/^item index not used/);
    }
  });

  it("a feature whose id matches no item link is ignored; a link whose id the index lacks is fetched", async () => {
    const [first, ...rest] = ALL_FEATURES;
    const res = await load(
      withIndex(
        fc([{ ...first, id: `${first.id}_renamed` }, { ...rest[0], id: "ghost" }, ...rest]),
      ),
    );
    const ids = res.items.map((it) => it.id);
    expect(ids).not.toContain("ghost");
    expect(ids).not.toContain(`${first.id}_renamed`);
    expect(ids.sort()).toEqual(ALL_FEATURES.map((f) => f.id as string).sort());
    expect(itemCalls(res.calls)).toEqual([
      `${FIXTURE_BASE}biotrack_indicators/items/${String(first.id)}.json`,
    ]);
  });

  it("an item link's own `id` names its feature when it carries one", async () => {
    const first = ALL_FEATURES[0];
    const res = await load(
      withIndex(fc(ALL_FEATURES), undefined, (links) => {
        const link = links.find(
          (l) => l.rel === "item" && l.href.endsWith(`/${String(first.id)}.json`),
        )!;
        link.href = "./items/renamed-on-disk.json";
        link.id = first.id;
      }),
    );
    expect(itemCalls(res.calls)).toEqual([]);
    const it0 = res.items.find((it) => it.id === first.id)!;
    // still resolved against ITS link's url
    expect(it0["atlas:url"]).toBe(`${FIXTURE_BASE}biotrack_indicators/items/renamed-on-disk.json`);
  });
});

describe("the overlays fixture's index (tests/fixtures/overlays/sefsc_fixture/items.json)", () => {
  it("holds exactly the objects of the item files its collection links, in link order", () => {
    const dir = join(__dirname, "../fixtures/overlays/sefsc_fixture");
    const coll = JSON.parse(readFileSync(join(dir, "collection.json"), "utf8"));
    const hrefs = (coll.links as { rel: string; href: string }[])
      .filter((l) => l.rel === "item")
      .map((l) => l.href);
    const index = JSON.parse(readFileSync(join(dir, "items.json"), "utf8"));
    expect(coll.links.some((l: { rel: string }) => l.rel === ITEM_INDEX_REL)).toBe(true);
    expect(index.type).toBe("FeatureCollection");
    expect(index.features).toEqual(
      hrefs.map((h) => JSON.parse(readFileSync(join(dir, h), "utf8"))),
    );
  });
});
