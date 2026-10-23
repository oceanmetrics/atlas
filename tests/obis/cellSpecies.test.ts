// The Cell pane's species (build week 4, step 5): the species behind a hexagon's records from the release's own
// species table (no h3t). The fixture is a real slice of the published table: the res-3 children of two res-2
// hexagons, 826a8ffffffffff (100 records of 29 species on the map) and 825acffffffffff (102 records of 25).
import { describe, expect, it } from "vitest";
import { ReleaseReader } from "@oceanmetrics/map";
import {
  cellPlan,
  filterSpecies,
  overlapsPeriod,
  readCellRows,
  readLookup,
  shareText,
  sortSpecies,
  SPECIES_CSV_COLUMNS,
  speciesCsv,
  speciesCsvName,
  speciesRows,
  sumBySpecies,
  totalsNote,
  totalsOf,
  wormsUrl,
  yearsText,
  type SpeciesRow,
} from "../../src/lens/collection/h3/cellSpecies";
import { buffer, localFetch, REL, spec } from "./support";

const S = spec();
const reader = (stats = { requests: 0, bytes: 0 }) =>
  new ReleaseReader({ fetch: localFetch(stats) });
/** the hexagon's own values on the map: the all layer at its resolution */
async function own(h3: string) {
  const r = await reader().rows(
    `${REL}all/res=2/data_0.parquet`,
    [[BigInt(`0x${h3}`), BigInt(`0x${h3}`)]],
    {
      id: "cell_id",
      idType: "int64",
      columns: ["n", "sp"],
    },
  );
  return { n: r!.columns.n[0], sp: r!.columns.sp[0] };
}

describe("the species of a hexagon", () => {
  it("the species sum to the cell's n and the names to its sp (a res-2 hexagon: its res-3 children)", async () => {
    const lookup = await readLookup(S, buffer("species/species.parquet"));
    for (const h3 of ["826a8ffffffffff", "825acffffffffff"]) {
      const got = (await readCellRows(S, h3, reader()))!;
      expect(got.plan.scope).toBe("children");
      const rows = speciesRows(got.summed, lookup, null);
      const t = totalsOf(rows);
      const map = await own(h3);
      expect(t).toEqual({ records: map.n, names: map.sp });
      expect(totalsNote(t, map, false)).toBeNull();
    }
  });
  it("reads only the row groups under the hexagon (cell-sorted, small groups)", async () => {
    const stats = { requests: 0, bytes: 0 };
    await readCellRows(S, "826a8ffffffffff", reader(stats));
    const whole = buffer("species_flat/res=3.parquet").byteLength;
    expect(stats.requests).toBeGreaterThanOrEqual(1);
    expect(stats.bytes).toBeLessThanOrEqual(whole);
  });
  it("names and ranks from the lookup; a class layer keeps its class", async () => {
    const lookup = await readLookup(S, buffer("species/species.parquet"));
    const got = (await readCellRows(S, "826a8ffffffffff", reader()))!;
    const rows = speciesRows(got.summed, lookup, null);
    expect(rows[0].records).toBeGreaterThanOrEqual(rows[rows.length - 1].records);
    expect(rows.every((r) => r.species && !r.species.startsWith("AphiaID"))).toBe(true);
    const cls = rows[0].class!;
    const only = speciesRows(got.summed, lookup, { rank: "class", taxon: cls });
    expect(only.length).toBeGreaterThan(0);
    expect(only.every((r) => r.class === cls)).toBe(true);
    // a rank the lookup has no column for keeps every species
    expect(speciesRows(got.summed, lookup, { rank: "kingdom", taxon: "Animalia" }).length).toBe(
      rows.length,
    );
  });
  it("which rows a hexagon reads: its own at res 3, its children coarser, its parent finer", () => {
    expect(cellPlan("8348c0fffffffff", [3])).toMatchObject({ res: 3, tableRes: 3, scope: "cell" });
    expect(cellPlan("81197ffffffffff", [3])).toMatchObject({
      res: 1,
      tableRes: 3,
      scope: "children",
    });
    const p = cellPlan("85283473fffffff", [3])!;
    expect(p).toMatchObject({ res: 5, tableRes: 3, scope: "parent" });
    expect(p.range[0]).toBe(p.range[1]);
    expect(cellPlan("nope", [3])).toBeNull();
    expect(cellPlan("8348c0fffffffff", [])).toBeNull();
  });
  it("richness counts names: two AphiaIDs of one name are one species", () => {
    const summed = sumBySpecies({
      aphiaid: [10, 11, 12, 10],
      n: [5, 3, 2, 1],
      name_key: [7, 7, 8, 7],
      year_min: [2001, 1999, NaN, 1990],
      year_max: [2005, 2010, NaN, 1995],
    });
    expect(summed.get(10)).toEqual({ n: 6, nameKey: 7, yearMin: 1990, yearMax: 2005 });
    const rows = speciesRows(summed, new Map(), null);
    expect(totalsOf(rows)).toEqual({ records: 11, names: 2 });
    expect(rows.find((r) => r.aphiaid === 12)).toMatchObject({
      yearMin: null,
      yearMax: null,
      species: "AphiaID 12",
    });
  });
});

describe("the expanded table", () => {
  const R = (o: Partial<SpeciesRow>): SpeciesRow => ({
    aphiaid: 1,
    nameKey: null,
    species: "x",
    phylum: null,
    class: null,
    order: null,
    family: null,
    records: 0,
    yearMin: null,
    yearMax: null,
    ...o,
  });
  const rows = [
    R({
      aphiaid: 1,
      species: "Larus occidentalis",
      class: "Aves",
      family: "Laridae",
      records: 50,
      yearMin: 1990,
      yearMax: 2020,
    }),
    R({
      aphiaid: 2,
      species: "Delphinus delphis",
      class: "Mammalia",
      family: "Delphinidae",
      records: 5,
    }),
    R({
      aphiaid: 3,
      species: "Sebastes mystinus",
      class: "Teleostei",
      family: "Sebastidae",
      records: 945,
      yearMin: 2001,
      yearMax: 2001,
    }),
  ];
  it("filter words, sort nulls last, 500 rows", () => {
    expect(filterSpecies(rows, "aves lar").map((r) => r.aphiaid)).toEqual([1]);
    expect(filterSpecies(rows, "  ").length).toBe(3);
    expect(sortSpecies(rows, "yearMin", "asc").map((r) => r.aphiaid)).toEqual([1, 3, 2]);
    expect(sortSpecies(rows, "yearMin", "desc").map((r) => r.aphiaid)).toEqual([3, 1, 2]);
    expect(sortSpecies(rows, "species", "asc").map((r) => r.species)[0]).toBe("Delphinus delphis");
  });
  it("share as a percentage, first-last years", () => {
    expect(shareText(5, 1000)).toBe("0.5%");
    expect(shareText(1, 10000)).toBe("<0.1%");
    expect(shareText(1, 0)).toBe("");
    expect(yearsText(rows[0])).toBe("1990–2020");
    expect(yearsText(rows[2])).toBe("2001");
    expect(yearsText(rows[1])).toBe("");
  });
  it("csv columns and file name", () => {
    const csv = speciesCsv({ h3: "8348c0fffffffff", res: 3, rows, records: 1000 });
    const [head, first] = csv.split("\n");
    expect(head.split(",")).toEqual([...SPECIES_CSV_COLUMNS]);
    expect(first).toBe(
      "8348c0fffffffff,3,Larus occidentalis,1,,Aves,,Laridae,50,0.050000,1990,2020",
    );
    expect(
      speciesCsvName({
        prefix: "oceanmetrics-atlas",
        h3: "8348c0fffffffff",
        layer: "fish",
        period: "1990s",
        release: "v20261012",
      }),
    ).toBe("oceanmetrics-atlas_species_8348c0fffffffff_fish_1990s_v20261012.csv");
    expect(
      speciesCsvName({
        prefix: "a",
        h3: "x",
        layer: "Incertae sedis",
        period: "all",
        release: null,
      }),
    ).toBe("a_species_x_Incertae-sedis_all_release.csv");
  });
  it("totals note", () => {
    expect(totalsNote({ records: 10, names: 2 }, { n: 10, sp: 2 }, false)).toBeNull();
    expect(totalsNote({ records: 9, names: 2 }, { n: 10, sp: 2 }, false)).toBe(
      "The species list (9 records of 2 species) does not add up to the hexagon's 10 records of 2 species.",
    );
    expect(totalsNote({ records: 9, names: 2 }, { n: 10, sp: 2 }, true)).toBeNull();
  });
  it("a period keeps the species whose first-last years overlap it; WoRMS link", () => {
    expect(overlapsPeriod(rows[0], { grain: "decade", value: "1990" })).toBe(true);
    expect(overlapsPeriod(rows[2], { grain: "decade", value: "1990" })).toBe(false);
    expect(overlapsPeriod(rows[2], { grain: "year", value: "2001" })).toBe(true);
    expect(overlapsPeriod(rows[1], { grain: "year", value: "2001" })).toBe(false);
    expect(overlapsPeriod(rows[1], null)).toBe(true);
    expect(wormsUrl(137147)).toBe("https://www.marinespecies.org/aphia.php?p=taxdetails&id=137147");
  });
});
