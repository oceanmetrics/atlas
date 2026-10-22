// The generic flower hook (`atlas:flower`): one fixture per rule, on the synthetic aquamaps_eov collection
// (tests/fixtures/catalog/: eov x metric = 8 x 2 items, one 9-band COG per metric, `atlas:bidx` = the band).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { instanceTokensCss } from "../../scripts/instance.mjs";
import {
  ABSENT_NOTE,
  FLOWER_COLORS,
  bandValueOf,
  flowerColorFor,
  flowerPetalsFor,
  flowerSpecOf,
} from "../../src/lib/catalog/flower";
import { loadCatalog, loadItems, type CollectionEntry } from "../../src/lib/catalog/load";
import type { StacItem } from "../../src/lib/catalog/types";
import { computeFlowerGeometry } from "../../src/lib/ui/flowerGeometry";
import { FIXTURE_BASE, fakeFetch } from "./support";

let entry: CollectionEntry;
let items: StacItem[];

beforeAll(async () => {
  const o = { base: FIXTURE_BASE, fetchImpl: fakeFetch().fetch, cache: new Map() };
  const cat = await loadCatalog(o);
  if (!cat.ok) throw new Error("catalog fixture");
  entry = cat.value.entries.find((e) => e.id === "aquamaps_eov")!;
  const res = await loadItems(entry, o);
  if (!res.ok) throw new Error("items fixture");
  items = res.value.items;
});

// bands 1..9 = all, fish, hardCorals, mangroves, marineMammals, seabirds, seagrasses, seaTurtles, n_eov.
// `all` (50) is the plain mean of the five reportable EOVs (80, 60, 40, 20, 50); seabirds are masked (null),
// seagrasses carry the Byte nodata 255, and neither is a petal.
const BANDS = [50, 80, 60, 40, 20, null, 255, 50, 5];
const RISK = { eov: "all", metric: "risk" };

describe("flowerSpecOf: the hook is the collection's atlas:flower", () => {
  it("reads dimension + composite from the fixture collection", () => {
    expect(flowerSpecOf(entry.collection)).toEqual({ dimension: "eov", composite: "all" });
  });
  it("null when absent or malformed", () => {
    expect(flowerSpecOf(null)).toBeNull();
    expect(flowerSpecOf({ ...entry.collection!, "atlas:flower": undefined })).toBeNull();
    const bad = { ...entry.collection!, "atlas:flower": { dimension: "eov" } };
    expect(flowerSpecOf(bad as never)).toBeNull();
  });
});

describe("flowerPetalsFor: petal mapping", () => {
  it("one petal per EOV except the composite, in the dimension's order, labelled from atlas:labels", () => {
    const v = flowerPetalsFor(entry, items, RISK, { values: BANDS })!;
    expect(v.components.map((c) => c.key)).toEqual([
      "fish",
      "hardCorals",
      "mangroves",
      "marineMammals",
      "seabirds",
      "seagrasses",
      "seaTurtles",
    ]);
    expect(v.components.map((c) => c.label)).toEqual([
      "Fish",
      "Hard corals",
      "Mangroves",
      "Marine mammals",
      "Seabirds",
      "Seagrasses",
      "Sea turtles",
    ]);
    expect(v.compositeLabel).toBe("All EOVs (mean)");
    expect(v.subject).toBe("Risk-weighted share");
  });

  it("each EOV is drawn with its category token; mangroves have their own; unknown -> --cat-other", () => {
    const v = flowerPetalsFor(entry, items, RISK, { values: BANDS })!;
    expect(Object.fromEntries(v.components.map((c) => [c.key, c.color]))).toEqual({
      fish: "--cat-fish",
      hardCorals: "--cat-coral",
      mangroves: "--cat-mangrove",
      marineMammals: "--cat-mammal",
      seabirds: "--cat-bird",
      seagrasses: "--cat-primprod",
      seaTurtles: "--cat-turtle",
    });
    expect(flowerColorFor("dolphins")).toBe("--cat-other");
    expect(flowerColorFor("toString")).toBe("--cat-other"); // not an Object.prototype hit
  });

  it("every colour token the map names exists in tokens.css, in both themes", () => {
    const css = readFileSync(instanceTokensCss(), "utf8");
    for (const token of [...Object.values(FLOWER_COLORS), "--cat-other"]) {
      const defs = css.match(new RegExp(`^\\s*${token}:`, "gm")) ?? [];
      expect(defs.length, token).toBe(2);
    }
  });
});

describe("flowerPetalsFor: band lookup by atlas:bidx", () => {
  it("each petal reads the band its own item names (one point read serves them all)", () => {
    const v = flowerPetalsFor(entry, items, RISK, { values: BANDS })!;
    const score = (k: string) => v.components.find((c) => c.key === k)!.score;
    expect([score("fish"), score("hardCorals"), score("mangroves")]).toEqual([80, 60, 40]);
    expect([score("marineMammals"), score("seaTurtles")]).toEqual([20, 50]);
  });

  it("the share metric (another COG, the same bands) resolves the same way", () => {
    const v = flowerPetalsFor(entry, items, { eov: "fish", metric: "share" }, { values: BANDS })!;
    expect(v.subject).toBe("Share (unweighted)");
    expect(v.components.find((c) => c.key === "fish")!.score).toBe(80);
  });

  it("follows atlas:bidx, not the item's position: moving fish to band 8 reads band 8", () => {
    const moved = items.map((i) =>
      i.id === "fish_risk" ? { ...i, assets: { cog: { ...i.assets.cog, "atlas:bidx": 8 } } } : i,
    ) as StacItem[];
    const v = flowerPetalsFor(entry, moved, RISK, { values: BANDS })!;
    expect(v.components.find((c) => c.key === "fish")!.score).toBe(50);
  });

  it("an item with no atlas:bidx reads band 1", () => {
    const item = {
      ...items[0],
      assets: { cog: { ...items[0].assets.cog, "atlas:bidx": undefined } },
    };
    expect(bandValueOf(item as StacItem, { values: [33, 44] })).toBe(33);
  });
});

describe("flowerPetalsFor: nodata is a null petal, not a zero", () => {
  it("null, the declared nodata 255 and an out-of-range value are all null; a real 0 stays 0", () => {
    const v = flowerPetalsFor(entry, items, RISK, {
      values: [50, 0, 255, null, 20, 7, 255, 50, 5],
    })!;
    const score = (k: string) => v.components.find((c) => c.key === k)!.score;
    expect(score("fish")).toBe(0); // a real zero is a petal of zero length, not missing
    expect(score("hardCorals")).toBeNull(); // 255, the declared nodata
    expect(score("mangroves")).toBeNull(); // masked pixel
  });

  it("255 is null even when the asset declares no nodata (outside atlas:value_range [0, 100])", () => {
    const bare = (id: string) => {
      const item = items.find((i) => i.id === id)!;
      return {
        ...item,
        assets: { cog: { ...item.assets.cog, "raster:bands": undefined } },
      } as StacItem;
    };
    expect(bandValueOf(bare("all_risk"), { values: [0, 255] })).toBe(0); // band 1
    expect(bandValueOf(bare("fish_risk"), { values: [0, 255] })).toBeNull(); // band 2
  });

  it("a short values array (fewer bands than the item names) is null, not NaN", () => {
    expect(
      bandValueOf(
        items.find((i) => i.id === "seaTurtles_risk")!,
        { values: [1, 2] },
      ),
    ).toBeNull();
  });

  it("the slot of a null petal is kept and the mean leaves it out", () => {
    const v = flowerPetalsFor(entry, items, RISK, { values: BANDS })!;
    const g = computeFlowerGeometry(v.components);
    expect(g.sliceCount).toBe(7);
    expect(g.petals.map((p) => p.key)).toEqual([
      "fish",
      "hardCorals",
      "mangroves",
      "marineMammals",
      "seaTurtles",
    ]);
    expect(g.noData.map((s) => s.key)).toEqual(["seabirds", "seagrasses"]);
  });
});

describe("flowerPetalsFor: atlas:absent items", () => {
  it("seabirds and seagrasses are empty slots with the not-in-AquaMaps note, whatever the band holds", () => {
    const v = flowerPetalsFor(entry, items, RISK, { values: [50, 80, 60, 40, 20, 99, 99, 50, 5] })!;
    for (const k of ["seabirds", "seagrasses"]) {
      const c = v.components.find((x) => x.key === k)!;
      expect(c.score).toBeNull();
      expect(c.note).toBe(ABSENT_NOTE);
    }
    expect(ABSENT_NOTE).toBe("(not in AquaMaps)");
    expect(v.components.filter((c) => c.note)).toHaveLength(2);
  });

  it("a present EOV that is merely masked here has no note (no data, not absent)", () => {
    const v = flowerPetalsFor(entry, items, RISK, {
      values: [50, null, 60, 40, 20, null, null, 50, 5],
    })!;
    const fish = v.components.find((c) => c.key === "fish")!;
    expect(fish.score).toBeNull();
    expect(fish.note).toBeUndefined();
  });

  it("the item may give its own note", () => {
    const own = items.map((i) =>
      i.id === "seabirds_risk"
        ? { ...i, properties: { ...i.properties, "atlas:absent_note": "(no taxa modelled)" } }
        : i,
    ) as StacItem[];
    const v = flowerPetalsFor(entry, own, RISK, { values: BANDS })!;
    expect(v.components.find((c) => c.key === "seabirds")!.note).toBe("(no taxa modelled)");
  });
});

describe("flowerPetalsFor: the centre is the composite band and equals the mean of the petals", () => {
  it("centre = band 1 (the `all` item), read by its own atlas:bidx", () => {
    expect(flowerPetalsFor(entry, items, RISK, { values: BANDS })!.center).toBe(50);
  });

  it("on the fixture the composite equals the plain mean of the non-null petals (both are defined that way)", () => {
    const v = flowerPetalsFor(entry, items, RISK, { values: BANDS })!;
    const nonNull = v.components.map((c) => c.score).filter((s): s is number => s !== null);
    const mean = nonNull.reduce((a, b) => a + b, 0) / nonNull.length;
    expect(v.center).toBe(mean);
    expect(computeFlowerGeometry(v.components).centerValue).toBe(mean);
    // handing the geometry the composite as its centre changes nothing, and overrides when they differ
    expect(computeFlowerGeometry(v.components, { centerValue: v.center }).centerValue).toBe(mean);
    expect(computeFlowerGeometry(v.components, { centerValue: 49 }).centerValue).toBe(49);
    expect(computeFlowerGeometry(v.components, { centerValue: null }).centerValue).toBeNull();
  });

  it("no reportable EOV in the cell: every petal and the centre are null", () => {
    const v = flowerPetalsFor(entry, items, RISK, { values: Array(9).fill(null) })!;
    expect(v.center).toBeNull();
    expect(v.components.every((c) => c.score === null)).toBe(true);
  });
});

describe("flowerPetalsFor: when there is no flower", () => {
  it("null without atlas:flower, without the point read, or with a dimension the cube lacks", () => {
    const plain = { collection: { ...entry.collection!, "atlas:flower": undefined } };
    expect(flowerPetalsFor(plain as never, items, RISK, { values: BANDS })).toBeNull();
    expect(flowerPetalsFor(entry, items, RISK, null)).toBeNull();
    const wrong = {
      collection: { ...entry.collection!, "atlas:flower": { dimension: "x", composite: "y" } },
    };
    expect(flowerPetalsFor(wrong as never, items, RISK, { values: BANDS })).toBeNull();
    expect(flowerPetalsFor(null, items, RISK, { values: BANDS })).toBeNull();
  });
});

describe("the hook is generic: no collection id is hard-coded in src/ (regression)", () => {
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      return statSync(p).isDirectory() ? walk(p) : [p];
    });
  it("`aquamaps_eov` appears nowhere under src/", () => {
    const hits = walk("src").filter((p) => readFileSync(p, "utf8").includes("aquamaps_eov"));
    expect(hits).toEqual([]);
  });
});
