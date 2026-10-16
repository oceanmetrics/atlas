// Dimension selectors and item resolution: one fixture per rule (tests/fixtures/catalog/: the
// biotrack collection, group {all, shark} x season {summer, winter} x metric {richness, uncertainty},
// eight items), plus the `?c=&i=` URL grammar's round trip through parseSel/formatSel.
import { beforeAll, describe, expect, it } from "vitest";
import {
  availableValues,
  defaultSelection,
  dimsOf,
  itemDims,
  itemTitleOf,
  pickEntry,
  prettify,
  resolveItem,
  selectDim,
  selPatchFor,
  snapItem,
  viewOf,
} from "../../src/lib/catalog/dims";
import { loadCatalog, loadItems, type CollectionEntry } from "../../src/lib/catalog/load";
import { formatSel, parseSel } from "../../src/lib/state/codec";
import { DEFAULT_SEL } from "../../src/lib/state/types";
import type { StacCollection, StacItem } from "../../src/lib/catalog/types";
import { FIXTURE_BASE, fakeFetch } from "./support";

let entries: CollectionEntry[];
let biotrack: CollectionEntry;
let items: StacItem[];
// the catalog's FIRST child, so the bare URL opens it: AquaMaps EOV share, eov x metric = 8 x 2 items
let eov: CollectionEntry;
let eovItems: StacItem[];

beforeAll(async () => {
  const o = { base: FIXTURE_BASE, fetchImpl: fakeFetch().fetch, cache: new Map() };
  const cat = await loadCatalog(o);
  if (!cat.ok) throw new Error("catalog fixture");
  entries = cat.value.entries;
  biotrack = entries.find((e) => e.id === "biotrack_indicators")!;
  eov = entries.find((e) => e.id === "aquamaps_eov")!;
  const res = await loadItems(biotrack, o);
  if (!res.ok) throw new Error("items fixture");
  items = res.value.items;
  const eres = await loadItems(eov, o);
  if (!eres.ok) throw new Error("eov items fixture");
  eovItems = eres.value.items;
});

const coll = (partial: Partial<StacCollection>): StacCollection =>
  ({ type: "Collection", id: "c", links: [], ...partial }) as StacCollection;
const item = (id: string, dims: Record<string, string>): StacItem =>
  ({ type: "Feature", id, properties: { "atlas:dims": dims }, assets: {}, links: [] }) as StacItem;

describe("dimsOf: the selectors come from cube:dimensions", () => {
  it("lists the non-spatial dimensions in DECLARATION order, with their values", () => {
    const dims = dimsOf(biotrack.collection);
    expect(dims.map((d) => d.key)).toEqual(["group", "season", "metric"]);
    expect(dims[1].values.map((v) => v.value)).toEqual(["summer", "winter"]);
  });

  it("skips spatial and geometry dimensions (the grid itself is never a selector)", () => {
    const c = coll({
      "cube:dimensions": {
        x: { type: "spatial", values: [1, 2] },
        geom: { type: "geometry", values: ["a"] },
        season: { type: "other", values: ["summer"] },
      },
    });
    expect(dimsOf(c).map((d) => d.key)).toEqual(["season"]);
  });

  it("labels: atlas:labels, then {value,label} objects, then a prettified value", () => {
    const dims = dimsOf(biotrack.collection);
    expect(dims[0].values).toEqual([
      { value: "all", label: "All species" },
      { value: "shark", label: "Sharks" },
    ]);
    const c = coll({
      "cube:dimensions": {
        taxon: { type: "other", values: [{ value: "fis_1", label: "Fish one" }, "red_snapper"] },
      },
    });
    expect(dimsOf(c)[0].values).toEqual([
      { value: "fis_1", label: "Fish one" },
      { value: "red_snapper", label: "Red snapper" },
    ]);
  });

  it("the selector label is the cube's title, else the key title-cased; the description is kept", () => {
    const c = coll({
      "cube:dimensions": {
        group: { type: "other", values: ["a"], description: "species group" },
        season_of_year: { type: "other", values: ["a"], title: "Season" },
      },
    });
    const dims = dimsOf(c);
    expect(dims[0]).toMatchObject({ label: "Group", description: "species group" });
    expect(dims[1].label).toBe("Season");
  });

  it("numeric values are stringified; duplicates dropped", () => {
    const c = coll({
      "cube:dimensions": { year: { type: "temporal", values: [2020, 2021, 2020] } },
    });
    expect(dimsOf(c)[0].values.map((v) => v.value)).toEqual(["2020", "2021"]);
  });

  it("a collection with NO cube:dimensions derives them from its items, first-seen order", () => {
    const its = [item("a", { b: "x", a: "p" }), item("b", { b: "y", a: "p" })];
    const dims = dimsOf(coll({}), its);
    expect(dims.map((d) => d.key)).toEqual(["b", "a"]);
    expect(dims[0].values.map((v) => v.value)).toEqual(["x", "y"]);
  });

  it("an item value the cube's values omit is appended, so every item stays reachable", () => {
    const c = coll({ "cube:dimensions": { season: { type: "other", values: ["summer"] } } });
    const dims = dimsOf(c, [item("w", { season: "winter" })]);
    expect(dims[0].values.map((v) => v.value)).toEqual(["summer", "winter"]);
  });

  it("no collection, no items: no selectors", () => {
    expect(dimsOf(null)).toEqual([]);
  });
});

describe("defaultSelection: the first value of every dimension", () => {
  it("biotrack: all / summer / richness", () => {
    expect(defaultSelection(dimsOf(biotrack.collection))).toEqual({
      group: "all",
      season: "summer",
      metric: "richness",
    });
  });
});

describe("resolveItem: the item whose dims match exactly", () => {
  it("finds the one item for a full selection", () => {
    expect(
      resolveItem(items, { group: "shark", season: "winter", metric: "uncertainty" })?.id,
    ).toBe("shark_winter_uncertainty");
  });

  it("null when no item has that combination", () => {
    expect(
      resolveItem(items, { group: "turtle", season: "winter", metric: "richness" }),
    ).toBeNull();
  });

  it("a partial selection matches the first item agreeing on the keys it names", () => {
    expect(resolveItem(items, { group: "shark" })?.id).toBe("shark_summer_richness");
  });

  it("itemDims stringifies and tolerates an item with no dims", () => {
    expect(itemDims(item("n", { year: 2020 as unknown as string }))).toEqual({ year: "2020" });
    expect(itemDims({ ...item("x", {}), properties: {} } as StacItem)).toEqual({});
  });
});

describe("snapItem: switching one selector snaps the others to the nearest existing item", () => {
  // a sparse cube: taxon A has both seasons, taxon B only winter
  const sparse = [
    item("a_summer", { taxon: "A", season: "summer" }),
    item("a_winter", { taxon: "A", season: "winter" }),
    item("b_winter", { taxon: "B", season: "winter" }),
  ];

  it("an exact match wins", () => {
    expect(snapItem(sparse, { taxon: "A", season: "winter" }, "season")?.id).toBe("a_winter");
  });

  it("changing taxon to B (no summer item) keeps B and snaps season to winter", () => {
    expect(snapItem(sparse, { taxon: "B", season: "summer" }, "taxon")?.id).toBe("b_winter");
  });

  it("the changed dimension must agree: an item without that value is never chosen", () => {
    expect(snapItem(sparse, { taxon: "Z", season: "summer" }, "taxon")).toBeNull();
  });

  it("without a changed dimension, the most dimensions in agreement wins; ties to the first item", () => {
    expect(snapItem(sparse, { taxon: "B", season: "summer" })?.id).toBe("a_summer");
  });

  it("no items: null", () => {
    expect(snapItem([], { a: "b" })).toBeNull();
  });

  it("selectDim wires it: change one value of the current selection", () => {
    const selected = { taxon: "A", season: "summer" };
    expect(selectDim(sparse, selected, "taxon", "B")?.id).toBe("b_winter");
  });
});

describe("availableValues: the values that still lead to an item", () => {
  it("every value is available on the full cube", () => {
    const dims = dimsOf(biotrack.collection);
    const sel = defaultSelection(dims);
    expect([...availableValues(dims[1], items, sel)].sort()).toEqual(["summer", "winter"]);
  });

  it("on a sparse cube, a selector greys out what no item reaches given the others", () => {
    const sparse = [
      item("a_summer", { taxon: "A", season: "summer" }),
      item("b_winter", { taxon: "B", season: "winter" }),
    ];
    const dims = dimsOf(coll({}), sparse);
    const seasonDim = dims.find((d) => d.key === "season")!;
    expect([...availableValues(seasonDim, sparse, { taxon: "B", season: "summer" })]).toEqual([
      "winter",
    ]);
  });
});

describe("pickEntry: ?c= selects a collection; unknown or unavailable falls back to the first available", () => {
  it("default (no c): the first available entry, the AquaMaps EOV share", () => {
    expect(pickEntry(entries, undefined)?.id).toBe("aquamaps_eov");
  });

  it("the bare URL opens aquamaps_eov at all x risk (first value of each dimension)", () => {
    const entry = pickEntry(entries, undefined)!;
    const v = viewOf(entry.collection, eovItems, undefined);
    expect(v.dims.map((d) => d.key)).toEqual(["eov", "metric"]);
    expect(v.dims[0].values.map((x) => x.value)[0]).toBe("all");
    expect(v.dims[1].values.map((x) => x.value)[0]).toBe("risk");
    expect(v.item?.id).toBe("all_risk");
    expect(v.selected).toEqual({ eov: "all", metric: "risk" });
  });

  it("the dimension labels come from atlas:labels, and a title composes from them", () => {
    const dims = dimsOf(eov.collection, eovItems);
    expect(dims[0].values.find((x) => x.value === "all")?.label).toBe("All EOVs (mean)");
    expect(dims[1].values.find((x) => x.value === "risk")?.label).toBe("Risk-weighted share");
    expect(
      itemTitleOf(
        eovItems.find((i) => i.id === "all_risk")!,
        dims,
      ),
    ).toBe("All EOVs (mean) · Risk-weighted share");
  });

  it("a known id selects it", () => {
    expect(pickEntry(entries, "am_0.05")?.id).toBe("am_0.05");
  });

  it("an unknown id falls back to the default, never errors", () => {
    expect(pickEntry(entries, "nope")?.id).toBe("aquamaps_eov");
  });

  it("an UNAVAILABLE entry is never selectable (c=rng_iucn falls back)", () => {
    expect(pickEntry(entries, "rng_iucn")?.id).toBe("aquamaps_eov");
  });

  it("no available entry at all: null", () => {
    expect(
      pickEntry(
        entries.filter((e) => e.status !== "ok"),
        undefined,
      ),
    ).toBeNull();
    expect(pickEntry([], undefined)).toBeNull();
  });
});

describe("viewOf: ?i= selects an item; the default is the first value of each dimension", () => {
  it("default: the all / summer / richness item", () => {
    const v = viewOf(biotrack.collection, items, undefined);
    expect(v.item?.id).toBe("all_summer_richness");
    expect(v.selected).toEqual({ group: "all", season: "summer", metric: "richness" });
  });

  it("a known item id selects it, and the selectors follow its own dims", () => {
    const v = viewOf(biotrack.collection, items, "shark_winter_uncertainty");
    expect(v.item?.id).toBe("shark_winter_uncertainty");
    expect(v.selected).toEqual({ group: "shark", season: "winter", metric: "uncertainty" });
  });

  it("an unknown item id falls back to the default item", () => {
    expect(viewOf(biotrack.collection, items, "nope").item?.id).toBe("all_summer_richness");
  });

  it("when the default combination has no item, the nearest one is used", () => {
    const sparse = [item("only", { group: "b", season: "winter" })];
    const c = coll({
      "cube:dimensions": {
        group: { type: "other", values: ["a", "b"] },
        season: { type: "other", values: ["summer", "winter"] },
      },
    });
    expect(viewOf(c, sparse, undefined).item?.id).toBe("only");
  });

  it("no items: no item, but the selectors still exist", () => {
    const v = viewOf(biotrack.collection, [], undefined);
    expect(v.item).toBeNull();
    expect(v.dims).toHaveLength(3);
  });
});

describe("URL state: ?c=<collection>&i=<item> round trips and the default is an EMPTY url", () => {
  it("the default view writes nothing", () => {
    const patch = selPatchFor(
      entries,
      eov,
      eovItems,
      viewOf(eov.collection, eovItems, undefined).item,
    );
    expect(patch).toEqual({ c: undefined, i: undefined });
    expect(formatSel({ ...DEFAULT_SEL, ...patch })).toEqual({ search: "", hash: "" });
  });

  it("a non-default item writes only i", () => {
    const fish = eovItems.find((i) => i.id === "fish_risk")!;
    const patch = selPatchFor(entries, eov, eovItems, fish);
    expect(patch).toEqual({ c: undefined, i: "fish_risk" });
    expect(formatSel({ ...DEFAULT_SEL, ...patch }).search).toBe("?i=fish_risk");
  });

  it("the biotrack collection is no longer the default: it writes c (and its default item writes no i)", () => {
    const patch = selPatchFor(
      entries,
      biotrack,
      items,
      viewOf(biotrack.collection, items, undefined).item,
    );
    expect(patch).toEqual({ c: "biotrack_indicators", i: undefined });
  });

  it("a non-default collection writes c (and its item, when not that collection's default)", () => {
    const am = entries.find((e) => e.id === "am_0.05")!;
    const amItems = [item("Fis-1", { taxon: "Fis-1" }), item("Fis-2", { taxon: "Fis-2" })];
    expect(selPatchFor(entries, am, amItems, amItems[0])).toEqual({ c: "am_0.05", i: undefined });
    expect(selPatchFor(entries, am, amItems, amItems[1])).toEqual({ c: "am_0.05", i: "Fis-2" });
  });

  it("round trip: URL -> Sel -> view -> patch -> URL is the identity", () => {
    for (const search of [
      "",
      "?i=seaTurtles_share",
      "?c=aquamaps_eov&i=fish_share",
      "?c=biotrack_indicators&i=shark_winter_richness",
      "?c=biotrack_indicators",
    ]) {
      const sel = parseSel({ search, hash: "" });
      const entry = pickEntry(entries, sel.c)!;
      const its = entry.id === "aquamaps_eov" ? eovItems : items;
      const view = viewOf(entry.collection, its, sel.i);
      const patch = selPatchFor(entries, entry, its, view.item);
      const out = formatSel({ ...sel, ...patch }).search;
      // c equal to the default collection normalises away; everything else must match exactly
      const expected = search.replace("c=aquamaps_eov&", "").replace("?c=aquamaps_eov", "");
      expect(out, search).toBe(expected);
    }
  });

  it("the ?c / ?i keys parse and format as plain strings", () => {
    const sel = parseSel({ search: "?c=am_0.05&i=Fis-1", hash: "" });
    expect(sel.c).toBe("am_0.05");
    expect(sel.i).toBe("Fis-1");
    expect(formatSel(sel).search).toBe("?c=am_0.05&i=Fis-1");
  });

  it("an empty c / i is absent", () => {
    const sel = parseSel({ search: "?c=&i=", hash: "" });
    expect(sel.c).toBeUndefined();
    expect(sel.i).toBeUndefined();
  });
});

describe("?catalog= override: validated https only, and it survives the URL round trip", () => {
  it("an https base is kept (and normalised to end in /)", () => {
    const sel = parseSel({ search: "?catalog=https://staging.example.test/atlas", hash: "" });
    expect(sel.catalog).toBe("https://staging.example.test/atlas/");
    expect(formatSel(sel).search).toBe("?catalog=https://staging.example.test/atlas/");
  });

  it("http, relative and credentialed values are dropped, never carried", () => {
    for (const bad of ["http://x.test/a/", "/atlas/", "https://u:p@x.test/a/", "javascript:1"]) {
      const sel = parseSel({ search: `?catalog=${encodeURIComponent(bad)}`, hash: "" });
      expect(sel.catalog, bad).toBeUndefined();
    }
  });
});

describe("prettify", () => {
  it("underscores to spaces, first letter up", () => {
    expect(prettify("red_listed")).toBe("Red listed");
    expect(prettify("shark")).toBe("Shark");
  });
});
