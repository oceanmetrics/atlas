// The public species list of a clicked cell: the group rule, sort, class pill, share bar, hover index, CSV.
// One small fixture per branch; the same code runs against the 248,834-row table in the app.
import { describe, expect, it } from "vitest";
import {
  classPill,
  countLine,
  inGroup,
  likelyCountIndex,
  likelySpeciesText,
  modeledCount,
  shareByGroup,
  speciesAssetsOf,
  speciesCsv,
  speciesDataFromRows,
  speciesInCell,
  type SpeciesData,
  type SpeciesInfo,
} from "../../src/lib/catalog/species";
import type { StacCollection } from "../../src/lib/catalog/types";

const SPECIES_ROWS = [
  {
    aphia_id: 1,
    scientific_name: "Alopias vulpinus",
    common_name: "common thresher",
    iucn_code: "VU",
    redlisted: true,
    group2: "Shark",
  },
  {
    aphia_id: 2,
    scientific_name: "Carcharhinus leucas",
    common_name: "bull shark",
    iucn_code: "NT",
    redlisted: false,
    group2: "Shark",
  },
  {
    aphia_id: 3,
    scientific_name: "Caretta caretta",
    common_name: "",
    iucn_code: "EN",
    redlisted: true,
    group2: "Turtle",
  },
  {
    aphia_id: 4,
    scientific_name: "Lutjanus griseus",
    common_name: "gray snapper",
    iucn_code: "LC",
    redlisted: false,
    group2: "Fish",
  },
  {
    aphia_id: 5,
    scientific_name: "Phoca vitulina",
    common_name: "harbor seal",
    iucn_code: "LC",
    redlisted: false,
    group2: "Seal",
  },
];
// cell 10 summer: all five species; cell 10 winter: one; cell 11 summer: shark 2 only
const CELL_ROWS = [
  { FID: 10, season: "summer", aphia_id: 2, prob: 0.7, class: "Likely" },
  { FID: 10, season: "summer", aphia_id: 1, prob: 0.91, class: "Very likely" },
  { FID: 10, season: "summer", aphia_id: 3, prob: 0.7, class: "Likely" },
  { FID: 10, season: "summer", aphia_id: 4, prob: 0.85, class: "Very likely" },
  { FID: 10, season: "summer", aphia_id: 5, prob: 0.61, class: "Likely" },
  { FID: 10, season: "winter", aphia_id: 4, prob: 0.8, class: "Very likely" },
  { FID: 11, season: "summer", aphia_id: 2, prob: 0.66, class: "Likely" },
  { FID: 12, season: "summer", aphia_id: 3n, prob: 0.9, class: "Very likely" }, // bigint, as hyparquet gives int64
];
const data = (): SpeciesData => speciesDataFromRows(CELL_ROWS, SPECIES_ROWS);
const names = (l: { scientificName: string }[]) => l.map((s) => s.scientificName);

describe("inGroup (the group rule, one fixture per branch)", () => {
  const info = (over: Partial<SpeciesInfo>): SpeciesInfo => ({
    aphiaId: 1,
    scientificName: "x",
    commonName: "",
    iucnCode: "",
    redlisted: false,
    group: "Fish",
    ...over,
  });
  it("all (or no group) is every species", () => {
    expect(inGroup(info({}), "all")).toBe(true);
    expect(inGroup(info({ group: "Seal" }), undefined)).toBe(true);
    expect(inGroup(info({ group: "Invertebrate" }), "")).toBe(true);
  });
  it("redlisted is redlisted == true, whatever the group", () => {
    expect(inGroup(info({ redlisted: true, group: "Turtle" }), "redlisted")).toBe(true);
    expect(inGroup(info({ redlisted: false, group: "Shark" }), "redlisted")).toBe(false);
  });
  it("a named group matches the species' coarse group case-insensitively (shark vs Shark)", () => {
    expect(inGroup(info({ group: "Shark" }), "shark")).toBe(true);
    expect(inGroup(info({ group: "Fish" }), "shark")).toBe(false);
    expect(inGroup(info({ group: "Seal" }), "turtle")).toBe(false);
  });
});

describe("speciesInCell", () => {
  it("all: every likely species of the cell and season, probability descending, ties by name", () => {
    const l = speciesInCell(data(), 10, "summer", "all");
    expect(names(l)).toEqual([
      "Alopias vulpinus", // 0.91
      "Lutjanus griseus", // 0.85
      "Carcharhinus leucas", // 0.7, ties with Caretta caretta: by scientific name
      "Caretta caretta",
      "Phoca vitulina", // 0.61
    ]);
    expect(l[0]).toMatchObject({
      prob: 0.91,
      cls: "Very likely",
      commonName: "common thresher",
      iucnCode: "VU",
    });
  });
  it("redlisted keeps only redlisted species", () => {
    expect(names(speciesInCell(data(), 10, "summer", "redlisted"))).toEqual([
      "Alopias vulpinus",
      "Caretta caretta",
    ]);
  });
  it("shark keeps only sharks", () => {
    expect(names(speciesInCell(data(), 10, "summer", "shark"))).toEqual([
      "Alopias vulpinus",
      "Carcharhinus leucas",
    ]);
  });
  it("uses the item's season", () => {
    expect(names(speciesInCell(data(), 10, "winter", "all"))).toEqual(["Lutjanus griseus"]);
  });
  it("a cell with no rows, or no species passing the group, is an empty list", () => {
    expect(speciesInCell(data(), 999, "summer", "all")).toEqual([]);
    expect(speciesInCell(data(), 11, "summer", "turtle")).toEqual([]);
    expect(speciesInCell(data(), 10, "spring", "all")).toEqual([]);
  });
  it("an int64 (bigint) AphiaID joins like a number", () => {
    expect(names(speciesInCell(data(), 12, "summer", "all"))).toEqual(["Caretta caretta"]);
  });
  it("regression: a species absent from the lookup keeps its AphiaID as its name, never vanishes", () => {
    const d = speciesDataFromRows(
      [{ FID: 1, season: "summer", aphia_id: 77, prob: 0.7, class: "Likely" }],
      SPECIES_ROWS,
    );
    expect(names(speciesInCell(d, 1, "summer", "all"))).toEqual(["AphiaID 77"]);
  });
  it("probabilities are the source's three decimals, not float32 noise", () => {
    const d = speciesDataFromRows(
      [{ FID: 1, season: "summer", aphia_id: 1, prob: 0.867, class: "Likely" }],
      SPECIES_ROWS,
    );
    expect(speciesInCell(d, 1, "summer", "all")[0].prob).toBe(0.867);
  });
});

describe("classPill", () => {
  it("maps the two likely classes and nothing else", () => {
    expect(classPill("Very likely")).toEqual({ label: "Very likely", tone: "very" });
    expect(classPill("Likely")).toEqual({ label: "Likely", tone: "likely" });
    expect(classPill("Unlikely")).toBeNull();
    expect(classPill("")).toBeNull();
  });
});

describe("modeledCount and the count line", () => {
  it("counts the species the models cover per group", () => {
    expect(modeledCount(data(), "all")).toBe(5);
    expect(modeledCount(data(), "shark")).toBe(2);
    expect(modeledCount(data(), "redlisted")).toBe(2);
    expect(modeledCount(data(), "ray")).toBe(0);
  });
  it("reads 'N species likely (prob >= 0.6) of M modeled in this group'", () => {
    expect(countLine(12, 37)).toBe("12 species likely (prob >= 0.6) of 37 modeled in this group");
    expect(countLine(0, 2)).toBe("0 species likely (prob >= 0.6) of 2 modeled in this group");
  });
});

describe("shareByGroup", () => {
  const sp = (cls: string) => ({ cls }) as never;
  it("% Very likely, % Likely, and the rest of the modeled species", () => {
    const share = shareByGroup([sp("Very likely"), sp("Very likely"), sp("Likely")], 10);
    expect(share).toEqual({ veryLikely: 20, likely: 10, rest: 70 });
  });
  it("always sums to 100", () => {
    const s = shareByGroup([sp("Very likely"), sp("Likely"), sp("Likely")], 7);
    expect(s.veryLikely + s.likely + s.rest).toBeCloseTo(100, 10);
  });
  it("an empty list is all rest; zero modeled species is all rest (no division by zero)", () => {
    expect(shareByGroup([], 5)).toEqual({ veryLikely: 0, likely: 0, rest: 100 });
    expect(shareByGroup([sp("Likely")], 0)).toEqual({ veryLikely: 0, likely: 0, rest: 100 });
  });
  it("more likely species than modeled (a stale lookup) is capped at 100", () => {
    const s = shareByGroup([sp("Very likely"), sp("Very likely"), sp("Likely")], 2);
    expect(s).toEqual({ veryLikely: 100, likely: 0, rest: 0 });
  });
});

describe("likelyCountIndex (the hover lookup)", () => {
  it("fid -> likely species of the season for the group; cells with none are absent", () => {
    const all = likelyCountIndex(data(), "summer", "all");
    expect([...all.entries()].sort()).toEqual([
      [10, 5],
      [11, 1],
      [12, 1],
    ]);
    expect(likelyCountIndex(data(), "winter", "all").get(10)).toBe(1);
    const sharks = likelyCountIndex(data(), "summer", "shark");
    expect(sharks.get(10)).toBe(2);
    expect(sharks.get(11)).toBe(1);
    expect(sharks.has(12)).toBe(false);
  });
  it("agrees with the panel's list for every cell", () => {
    for (const group of ["all", "redlisted", "shark", "turtle"]) {
      const idx = likelyCountIndex(data(), "summer", group);
      for (const fid of [10, 11, 12, 13]) {
        expect(idx.get(fid) ?? 0).toBe(speciesInCell(data(), fid, "summer", group).length);
      }
    }
  });
  it("an unknown season is an empty index", () => {
    expect(likelyCountIndex(data(), "spring", "all").size).toBe(0);
  });
  it("hover text", () => {
    expect(likelySpeciesText(12)).toBe("12 likely species");
    expect(likelySpeciesText(0)).toBe("0 likely species");
  });
});

describe("speciesCsv", () => {
  it("writes the raw list with cell and season columns, RFC 4180 quoted", () => {
    const d = speciesDataFromRows(
      [{ FID: 4, season: "summer", aphia_id: 9, prob: 0.7, class: "Likely" }],
      [
        {
          aphia_id: 9,
          scientific_name: "Genus species",
          common_name: 'big, "red" fish',
          iucn_code: "LC",
          redlisted: false,
          group2: "Fish",
        },
      ],
    );
    const csv = speciesCsv(speciesInCell(d, 4, "summer", "all"), 4, "summer");
    expect(csv).toBe(
      "fid,season,aphia_id,scientific_name,common_name,prob,class,iucn_code\r\n" +
        '4,summer,9,Genus species,"big, ""red"" fish",0.7,Likely,LC\r\n',
    );
  });
});

describe("speciesAssetsOf", () => {
  const base = { type: "Collection", id: "c", links: [] } as unknown as StacCollection;
  const coll = (assets: Record<string, unknown>) =>
    ({
      ...base,
      "atlas:url": "https://x.test/atlas/c/collection.json",
      assets,
    }) as unknown as StacCollection;
  it("resolves both assets against the collection", () => {
    const a = speciesAssetsOf(
      coll({
        cell_species: { href: "./cell_species.parquet" },
        species: { href: "./species.parquet" },
      }),
    );
    expect(a).toEqual({
      cellSpeciesUrl: "https://x.test/atlas/c/cell_species.parquet",
      speciesUrl: "https://x.test/atlas/c/species.parquet",
    });
  });
  it("is null unless both exist (an MST collection publishes neither)", () => {
    expect(speciesAssetsOf(coll({ cell_species: { href: "./cell_species.parquet" } }))).toBeNull();
    expect(speciesAssetsOf(coll({}))).toBeNull();
    expect(speciesAssetsOf(null)).toBeNull();
  });
});
