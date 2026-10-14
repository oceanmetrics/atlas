import { describe, expect, it, vi } from "vitest";
import {
  OTHER_GROUP,
  defaultRegistryKey,
  loadRegistryIndex,
  parseRegistryIndex,
  searchRegistry,
} from "../../../src/lib/catalog/registry/search";
import { MatchRank, groupByCat, rankRow, visibleRows } from "../../../src/lens/species/data/picker";
import type { Loaded } from "../../../src/lib/catalog/load";
import type { TaxaIndex } from "../../../src/lens/species/data/picker";

// [key, scientific_name, common_name, sp_cat] as registry_index.json publishes them ('' = none)
const RAW: unknown[] = [
  ["Fis-1", "Thunnus thynnus", "Western Atlantic Bluefin Tuna", "fish"],
  ["Fis-2", "Thunnus orientalis", "Pacific Bluefin Tuna", "fish"],
  ["Fis-3", "Thunnus", "", "fish"],
  ["Rep-3437", "Dermochelys coriacea", "Leatherback Turtle", "turtle"],
  ["Rep-5", "Lepidochelys kempii", "Kemp's Ridley Turtle", "turtle"],
  ["Inv-9", "Sepia officinalis", "Common cuttlefish", "invertebrate"],
  ["SLB-64971", "Abylopsis eschscholtzi", "", ""],
  ["Fis-7", "Thunnidae señorita", "Señorita Fish", "fish"],
];
const index = (): TaxaIndex => {
  const i = parseRegistryIndex(RAW);
  if (typeof i === "string") throw new Error(i);
  return i;
};
const keys = (q: string) => searchRegistry(index(), q).map((m) => m.row.key);

describe("parseRegistryIndex", () => {
  it("makes the picker's own rows: label `group: sci (common)`, every taxon offered", () => {
    const i = index();
    expect(i.rows).toHaveLength(8);
    expect(i.byKey.get("Rep-3437")).toMatchObject({
      sci: "Dermochelys coriacea",
      common: "Leatherback Turtle",
      cat: "turtle",
      label: "turtle: Dermochelys coriacea (Leatherback Turtle)",
      validUsa: true,
    });
    expect(i.byKey.get("Fis-3")?.label).toBe("fish: Thunnus");
  });
  it("a taxon with no sp_cat is grouped under `other`", () => {
    const i = index();
    expect(i.byKey.get("SLB-64971")?.cat).toBe(OTHER_GROUP);
    const groups = groupByCat(visibleRows(i, false)).map((g) => g.cat);
    expect(groups).toContain("other");
    expect(groups).toEqual([...groups].sort());
    expect(groupByCat(visibleRows(i, false)).find((g) => g.cat === "other")!.rows).toHaveLength(1);
  });
  it("a malformed index names the first violation", () => {
    expect(parseRegistryIndex({})).toMatch(/not an array/);
    expect(parseRegistryIndex([["k"]])).toMatch(/row 0/);
    expect(parseRegistryIndex([["", "Sci", "", ""]])).toMatch(/no key/);
    expect(parseRegistryIndex([["k", "", "", ""]])).toMatch(/no scientific name/);
  });
});

describe("searchRegistry: the Species picker's ranking", () => {
  it("exact scientific name first, then prefix, over scientific and common names", () => {
    expect(keys("thunnus thynnus")).toEqual(["Fis-1"]);
    // exact `Thunnus` (genus-only taxon) beats the prefix matches; prefix matches by scientific name
    expect(keys("thunnus").slice(0, 3)).toEqual(["Fis-3", "Fis-2", "Fis-1"]);
  });
  it("common names are searched, word-start beats substring", () => {
    expect(keys("bluefin")).toEqual(["Fis-2", "Fis-1"]);
    const ranks = Object.fromEntries(
      searchRegistry(index(), "turtle").map((m) => [m.row.key, m.rank]),
    );
    expect(ranks["Rep-3437"]).toBe(MatchRank.WordCommon);
  });
  it("folds case, diacritics and the curly apostrophe", () => {
    expect(keys("SENORITA")).toContain("Fis-7");
    expect(keys("kemp's")).toEqual(["Rep-5"]);
    expect(keys("kemp’s")).toEqual(["Rep-5"]);
  });
  it("rankRow orders the tiers as the picker does", () => {
    const i = index();
    const r = i.byKey.get("Fis-1")!;
    expect(rankRow(r, "thunnus thynnus")).toBe(MatchRank.ExactSci);
    expect(rankRow(r, "thunn")).toBe(MatchRank.PrefixSci);
    expect(rankRow(r, "tuna")).toBe(MatchRank.WordCommon);
    expect(rankRow(r, "zzz")).toBe(MatchRank.None);
  });
  it("does not filter by US waters (a global registry), and honours the limit", () => {
    expect(searchRegistry(index(), "", 3)).toHaveLength(3);
    expect(searchRegistry(index(), "e", 2)).toHaveLength(2);
    expect(keys("abylopsis")).toEqual(["SLB-64971"]);
  });
});

describe("the default taxon", () => {
  it("is Dermochelys coriacea when the registry has it, else the first row, else null", () => {
    expect(defaultRegistryKey(index().rows)).toBe("Rep-3437");
    expect(defaultRegistryKey(index().rows.filter((r) => r.key !== "Rep-3437"))).toBe("Fis-1");
    expect(defaultRegistryKey([])).toBeNull();
    expect(defaultRegistryKey([{ key: "k", scientificName: "Dermochelys coriacea" }])).toBe("k");
  });
});

describe("loadRegistryIndex: lazy, cached, never throws", () => {
  it("fetches once per URL, shares a concurrent ask, and parses to the picker's index", async () => {
    const fetchJson = vi.fn(async () => RAW);
    const cache = new Map<string, Promise<Loaded<TaxaIndex>>>();
    const [a, b] = await Promise.all([
      loadRegistryIndex("https://x.test/i.json", fetchJson, cache),
      loadRegistryIndex("https://x.test/i.json", fetchJson, cache),
    ]);
    await loadRegistryIndex("https://x.test/i.json", fetchJson, cache);
    expect(fetchJson).toHaveBeenCalledTimes(1);
    expect(a.ok && b.ok && a.value === b.value).toBe(true);
  });
  it("a failure is an error result and is retried next time", async () => {
    const cache = new Map<string, Promise<Loaded<TaxaIndex>>>();
    const bad = vi.fn(async () => {
      throw new Error("HTTP 503");
    });
    const res = await loadRegistryIndex("https://x.test/i.json", bad, cache);
    expect(res).toMatchObject({ ok: false, error: { kind: "http", url: "https://x.test/i.json" } });
    await new Promise((r) => setTimeout(r, 0));
    const good = vi.fn(async () => RAW);
    expect((await loadRegistryIndex("https://x.test/i.json", good, cache)).ok).toBe(true);
    expect(good).toHaveBeenCalledTimes(1);
  });
  it("a body that is not an index is a schema error", async () => {
    const res = await loadRegistryIndex("https://x.test/j.json", async () => ({ a: 1 }), new Map());
    expect(res).toMatchObject({ ok: false, error: { kind: "schema" } });
  });
});
