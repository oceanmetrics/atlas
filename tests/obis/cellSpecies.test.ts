// The Cell pane's species (build week 4, step 5): the species behind a hexagon's records from the release's own
// species table (no h3t). The fixture is a real slice of the published table: the res-3 children of two res-2
// hexagons, 826a8ffffffffff (100 records of 29 species on the map) and 825acffffffffff (102 records of 25), with
// obisindicators 0.12's files made from it (tests/fixtures/obis_h3/scripts/make_v012.py): `res=1`, `res=2` summed by
// parent, `res=3/p=<res-1 parent>` split by res-1 parent (815afffffffffff, 816abffffffffff), the lookup's `eov`.
import { describe, expect, it } from "vitest";
import { ReleaseReader } from "@oceanmetrics/map";
import {
  cellPlan,
  COLUMN_GAP,
  columnRanges,
  flatParentOf,
  lookupColumnsOf,
  filterSpecies,
  overlapsPeriod,
  readCellRows,
  readLine,
  SPECIES_TAIL,
  SPLIT_TAIL,
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
import type { H3Spec } from "../../src/lib/catalog/h3";
import { buffer, collection, localFetch, REL, spec } from "./support";
import { parseH3 } from "../../src/lib/catalog/h3";

const S = spec();
/** the same release as obisindicators 0.11 published it: `species_flat/res=3.parquet` only, no split, no EOV column */
function spec011(): H3Spec {
  const c = collection() as unknown as Record<string, Record<string, Record<string, unknown>>>;
  const sp = c["obis:species"];
  sp.flat = { href_template: sp.flat.href_template, resolutions: [3] };
  delete sp.lineage;
  delete sp.eov;
  return parseH3(c as never)!;
}
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
    // 0.11: res 3 only, so a res-2 hexagon sums its children's rows
    const S11 = spec011();
    const lookup = await readLookup(S11, buffer("species/species.parquet"));
    for (const h3 of ["826a8ffffffffff", "825acffffffffff"]) {
      const got = (await readCellRows(S11, h3, reader()))!;
      expect(got.plan.scope).toBe("children");
      expect(got.plan.url).toBe(`${REL}species_flat/res=3.parquet`);
      const rows = speciesRows(got.summed, lookup, null);
      const t = totalsOf(rows);
      const map = await own(h3);
      expect(t).toEqual({ records: map.n, names: map.sp });
      expect(totalsNote(t, map, false)).toBeNull();
    }
  });
  it("0.12: a res-2 hexagon reads its own rows of res=2.parquet, the same list as its children's", async () => {
    const lookup = await readLookup(S, buffer("species/species.parquet"));
    for (const h3 of ["826a8ffffffffff", "825acffffffffff"]) {
      const got = (await readCellRows(S, h3, reader()))!;
      expect(got.plan).toMatchObject({
        scope: "cell",
        tableRes: 2,
        url: `${REL}species_flat/res=2.parquet`,
      });
      const rows = speciesRows(got.summed, lookup, null);
      const map = await own(h3);
      expect(totalsOf(rows)).toEqual({ records: map.n, names: map.sp });
      const kids = (await readCellRows(spec011(), h3, reader()))!;
      expect([...got.summed.entries()].sort()).toEqual([...kids.summed.entries()].sort());
    }
  });
  it("0.12: a res-3 hexagon reads its res-1 parent's split file, the rows the whole res=3.parquet has", async () => {
    for (const h3 of ["836a8afffffffff", "835accfffffffff"]) {
      const stats = { requests: 0, bytes: 0 };
      const split = new ReleaseReader({ fetch: localFetch(stats), tail: SPLIT_TAIL });
      const got = (await readCellRows(S, h3, reader(), split))!;
      expect(got.plan.split).toEqual({ parentRes: 1, parent: flatParentOf(h3, 1) });
      expect(got.plan.url).toBe(`${REL}species_flat/res=3/p=${flatParentOf(h3, 1)}.parquet`);
      // the split file is under the 64 KiB tail: one request, the whole file, its row groups served from it
      expect(stats.requests).toBe(1);
      expect(got.requests).toBe(1);
      expect(got.groupsRead).toBeGreaterThanOrEqual(1);
      expect(got.groupsSkipped).toBeGreaterThanOrEqual(1);
      const whole = (await readCellRows(spec011(), h3, reader()))!;
      expect(whole.plan.url).toBe(`${REL}species_flat/res=3.parquet`);
      expect([...got.summed.entries()].sort()).toEqual([...whole.summed.entries()].sort());
      expect(got.summed.size).toBeGreaterThan(0);
    }
  });
  it("0.12: a res-5 hexagon lists its res-3 parent's species from that parent's res-1 file", async () => {
    // 85 6a8a 8 under 836a8afffffffff (its res-5 child with digits 0 0): the list of the res-3 hexagon
    const h3 = "856a8a03fffffff";
    const got = (await readCellRows(S, h3, reader()))!;
    expect(got.plan).toMatchObject({ res: 5, tableRes: 3, scope: "parent" });
    expect(got.plan.url).toBe(`${REL}species_flat/res=3/p=816abffffffffff.parquet`);
    const parent = (await readCellRows(S, "836a8afffffffff", reader()))!;
    expect([...got.summed.entries()].sort()).toEqual([...parent.summed.entries()].sort());
  });
  it("reads only the row groups under the hexagon (cell-sorted, small groups)", async () => {
    for (const [s, h3] of [
      [spec011(), "826a8ffffffffff"],
      [S, "836a8afffffffff"],
    ] as const) {
      const stats = { requests: 0, bytes: 0 };
      const got = (await readCellRows(s, h3, reader(stats)))!;
      const whole = buffer(got.plan.url.replace(REL, "")).byteLength;
      expect(stats.requests).toBeGreaterThanOrEqual(1);
      expect(stats.bytes).toBeLessThanOrEqual(whole);
      expect(got.groupsSkipped).toBeGreaterThanOrEqual(1);
    }
  });
  it("a split file the release does not have (no records under that parent) is an empty list, not an error", async () => {
    // 832834fffffffff (Monterey) lies under 81283ffffffffff, which the fixture release has no file for
    const got = (await readCellRows(S, "832834fffffffff", reader()))!;
    expect(got.plan.url).toBe(`${REL}species_flat/res=3/p=81283ffffffffff.parquet`);
    expect(got.summed.size).toBe(0);
    expect(got.requests).toBe(1);
    expect(got.bytes).toBe(0);
    // a whole resolution's file that is missing is not a hexagon of the table (the pane says so)
    const noFile = spec011();
    noFile.speciesFlat!.hrefTemplate = `${REL}species_flat/nope_{res}.parquet`;
    expect(await readCellRows(noFile, "836a8afffffffff", reader())).toBeNull();
  });
  it("a split file that fails (HTTP 503) is an error, never an empty list", async () => {
    const failing = (async (input: RequestInfo | URL, init?: RequestInit) =>
      String(input).includes("/p=")
        ? new Response("", { status: 503 })
        : localFetch()(input, init)) as typeof fetch;
    const r = new ReleaseReader({ fetch: failing, tail: SPLIT_TAIL });
    await expect(readCellRows(S, "836a8afffffffff", reader(), r)).rejects.toThrow("503");
  });
  it("the pane's read: the table's requests and bytes of this call, the footer kept for the next hexagon", async () => {
    // one reader per page with the 128 KiB tail (SPECIES_TAIL): the first hexagon opens the table, the second
    // reads row groups only (or nothing, when its groups are in the cache)
    const stats = { requests: 0, bytes: 0 };
    const r = new ReleaseReader({ fetch: localFetch(stats), tail: SPECIES_TAIL });
    expect(SPECIES_TAIL).toBe(131_072);
    expect(SPLIT_TAIL).toBe(65_536);
    const a = (await readCellRows(S, "826a8ffffffffff", r))!;
    expect(a.requests).toBe(stats.requests);
    expect(a.bytes).toBe(stats.bytes);
    expect(a.requests).toBeGreaterThanOrEqual(1);
    expect(a.groupsRead).toBeGreaterThanOrEqual(1);
    const before = { ...stats };
    const b = (await readCellRows(S, "825acffffffffff", r))!;
    // the second call opens nothing again: its requests are the ones counted since, and fewer than the first's
    expect(b.requests).toBe(stats.requests - before.requests);
    expect(b.bytes).toBe(stats.bytes - before.bytes);
    expect(b.requests).toBeLessThan(a.requests);
    expect(b.summed.size).toBeGreaterThan(0);
  });
  it("the pane prints the bytes it read (KB, requests, row groups, the names once, ms)", () => {
    expect(
      readLine({
        bytes: 329_000,
        requests: 2,
        groupsRead: 1,
        groupsSkipped: 369,
        lookupBytes: 0,
        ms: 310,
      }),
    ).toBe("Read 321 KB of the species table in 2 requests, 1 of 370 row groups; 310 ms.");
    expect(
      readLine({
        bytes: 68_000,
        requests: 1,
        groupsRead: 1,
        groupsSkipped: 0,
        lookupBytes: 2_097_152,
        ms: 150,
      }),
    ).toBe(
      "Read 66 KB of the species table in 1 request, 1 of 1 row groups, plus the names, 2,048 KB, once per page; 150 ms.",
    );
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
  it("which file for which hexagon (0.12): res 1 and 2 their own file, res 3 its res-1 parent's, res 5 its res-3 parent's", () => {
    const flat = {
      hrefTemplate: "https://x/species_flat/res={res}.parquet",
      resolutions: [1, 2, 3],
      parentTemplate: "https://x/species_flat/res={res}/p={parent}.parquet",
      parentRes: { "3": 1 },
    };
    // Monterey: 852834c7fffffff (res 5) -> 832834fffffffff -> 822837fffffffff -> 81283ffffffffff (h3-js cellToParent)
    expect(cellPlan("81283ffffffffff", flat)).toMatchObject({
      res: 1,
      tableRes: 1,
      scope: "cell",
      url: "https://x/species_flat/res=1.parquet",
      split: null,
    });
    expect(cellPlan("822837fffffffff", flat)).toMatchObject({
      res: 2,
      tableRes: 2,
      scope: "cell",
      url: "https://x/species_flat/res=2.parquet",
      split: null,
    });
    const r3 = cellPlan("832834fffffffff", flat)!;
    expect(r3).toMatchObject({
      res: 3,
      tableRes: 3,
      scope: "cell",
      url: "https://x/species_flat/res=3/p=81283ffffffffff.parquet",
      split: { parentRes: 1, parent: "81283ffffffffff" },
    });
    expect(r3.range).toEqual([BigInt("0x832834fffffffff"), BigInt("0x832834fffffffff")]);
    const r5 = cellPlan("852834c7fffffff", flat)!;
    expect(r5).toMatchObject({
      res: 5,
      tableRes: 3,
      scope: "parent",
      url: "https://x/species_flat/res=3/p=81283ffffffffff.parquet",
      split: { parentRes: 1, parent: "81283ffffffffff" },
    });
    expect(r5.range).toEqual([BigInt("0x832834fffffffff"), BigInt("0x832834fffffffff")]);
    // res 0: its res-1 children in res=1.parquet
    expect(cellPlan("8029fffffffffff", flat)).toMatchObject({
      tableRes: 1,
      scope: "children",
      url: "https://x/species_flat/res=1.parquet",
    });
    // no parent_template: res 3 reads the whole res=3.parquet (the fallback)
    const whole = { hrefTemplate: flat.hrefTemplate, resolutions: flat.resolutions };
    expect(cellPlan("832834fffffffff", whole)).toMatchObject({
      url: "https://x/species_flat/res=3.parquet",
      split: null,
    });
    // a release with res 3 only, split by res 1: a res-1 hexagon's children are all in its own file, a res-0
    // hexagon's are in seven files, so it reads the whole one
    const only3 = { ...flat, resolutions: [3] };
    expect(cellPlan("81283ffffffffff", only3)).toMatchObject({
      scope: "children",
      url: "https://x/species_flat/res=3/p=81283ffffffffff.parquet",
    });
    expect(cellPlan("8029fffffffffff", only3)).toMatchObject({
      scope: "children",
      url: "https://x/species_flat/res=3.parquet",
      split: null,
    });
  });
  it("the parent a split file is named by: the res-1 parent's hex id (h3-js cellToParent's)", () => {
    expect(flatParentOf("8329a9fffffffff", 1)).toBe("8129bffffffffff");
    expect(flatParentOf("85283473fffffff", 1)).toBe("81283ffffffffff");
    expect(flatParentOf("852834c7fffffff", 1)).toBe("81283ffffffffff");
    expect(flatParentOf("836a8afffffffff", 1)).toBe("816abffffffffff");
    expect(flatParentOf("835accfffffffff", 1)).toBe("815afffffffffff");
    expect(flatParentOf("830800fffffffff", 1)).toBe("81083ffffffffff"); // a pentagon
    expect(flatParentOf("83db71fffffffff", 1)).toBe("81db7ffffffffff"); // the southern ocean
    expect(flatParentOf("81283ffffffffff", 1)).toBe("81283ffffffffff"); // a res-1 hexagon is its own
  });
  it("the EOV species lists: an EOV layer keeps the species whose `eov` is its key", async () => {
    expect(S.speciesEov).toEqual({
      column: "eov",
      counts: { fish: 27, marineMammals: 37, seabirds: 5 },
    });
    expect(lookupColumnsOf(S)).toContain("eov");
    expect(lookupColumnsOf(spec011())).not.toContain("eov");
    const lookup = await readLookup(S, buffer("species/species.parquet"));
    const got = (await readCellRows(S, "826a8ffffffffff", reader()))!;
    const all = speciesRows(got.summed, lookup, null);
    const fish = speciesRows(got.summed, lookup, null, null, "fish");
    expect(fish.length).toBeGreaterThan(0);
    expect(fish.length).toBeLessThan(all.length);
    expect(fish.every((r) => r.class === "Teleostei")).toBe(true);
    expect(all.filter((r) => r.class === "Teleostei").map((r) => r.aphiaid)).toEqual(
      fish.map((r) => r.aphiaid),
    );
    // an EOV with no species in the hexagon is an empty list; no key keeps every species
    expect(speciesRows(got.summed, lookup, null, null, "mangroves")).toEqual([]);
    expect(speciesRows(got.summed, lookup, null, null, null)).toEqual(all);
    // a lookup without the column (0.11) has no eov on its rows, so an EOV key would keep nothing: the layer
    // passes no key then (the pane says the list is every taxon's)
    const old = await readLookup(spec011(), buffer("species/species.parquet"));
    expect([...old.values()].every((r) => r.eov === undefined)).toBe(true);
  });
  it("the lookup's column chunks: one range each with no gap allowed, merged across gaps under COLUMN_GAP", async () => {
    const { parquetMetadata } = await import("hyparquet");
    const md = parquetMetadata(buffer("species/species.parquet"));
    const chunks = md.row_groups.length;
    const tight = columnRanges(md, ["aphiaid", "class", "records"], 0);
    expect(tight.length).toBeGreaterThanOrEqual(1);
    expect(tight.length).toBeLessThanOrEqual(3 * chunks);
    // every asked chunk lies inside one range; an unasked column's chunk is not asked when the gap is 0
    for (const g of md.row_groups)
      for (const c of g.columns) {
        const m = c.meta_data!;
        // a chunk starts at its dictionary page (when it has one) and runs its compressed size
        const a = Number(m.dictionary_page_offset ?? m.data_page_offset);
        const b = a + Number(m.total_compressed_size);
        const inside = tight.some(([x, y]) => x <= a && b <= y);
        const touched = tight.some(([x, y]) => a < y && x < b);
        if (["aphiaid", "class", "records"].includes(m.path_in_schema[0]))
          expect(inside).toBe(true);
        else expect(touched).toBe(false);
      }
    expect(columnRanges(md, ["aphiaid", "class", "records"]).length).toBeLessThanOrEqual(
      tight.length,
    );
    expect(COLUMN_GAP).toBe(16_384);
    // two chunks 10 bytes apart are one range under a gap of 10, two under 9
    const two = {
      row_groups: [
        {
          columns: [
            {
              meta_data: { path_in_schema: ["a"], data_page_offset: 4n, total_compressed_size: 6n },
            },
            {
              meta_data: {
                path_in_schema: ["b"],
                data_page_offset: 20n,
                total_compressed_size: 5n,
              },
            },
          ],
        },
      ],
    };
    expect(columnRanges(two, ["a", "b"], 10)).toEqual([[4, 25]]);
    expect(columnRanges(two, ["a", "b"], 9)).toEqual([
      [4, 10],
      [20, 25],
    ]);
    expect(columnRanges(two, ["b"], 100)).toEqual([[20, 25]]);
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
