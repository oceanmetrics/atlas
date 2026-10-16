// The raster cell -> species table (`atlas:cell_species`): one fixture per rule, on the synthetic aquamaps_eov
// collection (tests/fixtures/catalog/aquamaps_eov/): tile 954 holds cells 9844265-9844267 in four 3-row row
// groups, `species.parquet` is the lookup. hyparquet reads the fixture files from Node buffers.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  cellAreaKm2,
  cellOf,
  cellSpeciesCsv,
  countLine,
  createCellSpeciesStore,
  defaultGroup,
  filterRows,
  formatShare,
  groupCounts,
  joinRows,
  linksFor,
  parseCellSpecies,
  readLookup,
  readTile,
  redlistCounts,
  shareOf,
  sortRows,
  tileHref,
  type CellSpeciesDescriptor,
  type CellSpeciesRow,
  type SpeciesRecord,
  type TileRow,
} from "../../src/lib/catalog/cellSpecies";
import { loadCatalog, type CollectionEntry } from "../../src/lib/catalog/load";
import { speciesAssetsOf } from "../../src/lib/catalog/species";
import { parseSel } from "../../src/lib/state/codec";
import { FIXTURE_BASE, fakeFetch } from "./support";

const DIR = join(__dirname, "../fixtures/catalog/aquamaps_eov");
const buf = (rel: string): ArrayBuffer => {
  const b = readFileSync(join(DIR, rel));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};

let entry: CollectionEntry;
let d: CellSpeciesDescriptor;
let lookup: Map<number, SpeciesRecord>;
let tile66: TileRow[];

const CELL = 9844266;
const LAT = 21.625; // the centre of cell 9844266

beforeAll(async () => {
  const cat = await loadCatalog({
    base: FIXTURE_BASE,
    fetchImpl: fakeFetch().fetch,
    cache: new Map(),
  });
  if (!cat.ok) throw new Error("catalog fixture");
  entry = cat.value.entries.find((e) => e.id === "aquamaps_eov")!;
  d = parseCellSpecies(entry.collection)!;
  const lk = await readLookup(buf("species.parquet"), d);
  if (!lk.ok) throw new Error(lk.error.message);
  lookup = lk.value;
  const t = await readTile(buf("cell_species/tile=954/data_0.parquet"), CELL, d);
  if (!t.ok) throw new Error(t.error.message);
  tile66 = t.value;
});

afterEach(() => vi.unstubAllGlobals());

describe("parseCellSpecies: the collection's atlas:cell_species descriptor", () => {
  it("reads the fixture's descriptor, resolving the tile template and the lookup against the collection", () => {
    expect(d).toMatchObject({
      tileTemplate: `${FIXTURE_BASE}aquamaps_eov/cell_species/tile={tile}/data_0.parquet`,
      lookupUrl: `${FIXTURE_BASE}aquamaps_eov/species.parquet`,
      tileDeg: 5,
      grid: { ncol: 7200, nrow: 3600, x0: -180, y0: 90, res: 0.05 },
      keyColumn: "cell_id",
      speciesColumn: "aphia_id",
      lookupKey: "aphia_id",
      valueColumn: "suit",
      valueRange: [1, 100],
      valueLabel: "Suitability",
      groupColumn: "eov",
      groupDimension: "eov",
      totalColumn: "total_suit_area",
    });
    expect(d.links.map((l) => [l.label, l.sameApp])).toEqual([
      ["Atlas", true],
      ["WoRMS", false],
      ["IUCN", false],
      ["AquaMaps", false],
    ]);
  });

  it("null without the field, with another layout, or without a grid / key column / lookup asset", () => {
    const c = entry.collection!;
    const field = c["atlas:cell_species"] as Record<string, unknown>;
    const with_ = (patch: Record<string, unknown>) =>
      parseCellSpecies({ ...c, "atlas:cell_species": { ...field, ...patch } } as never);
    expect(parseCellSpecies(null)).toBeNull();
    expect(parseCellSpecies({ ...c, "atlas:cell_species": undefined })).toBeNull();
    expect(with_({ layout: "single" })).toBeNull();
    expect(with_({ grid: { ncol: 7200 } })).toBeNull();
    expect(with_({ key_column: "" })).toBeNull();
    expect(with_({ lookup_asset: "nope" })).toBeNull();
    expect(with_({ href_template: "./cell_species/data_0.parquet" })).toBeNull(); // no {tile}
  });

  it("the hex collections' table reader leaves a raster collection alone (regression: both use assets named cell_species)", () => {
    expect(speciesAssetsOf(entry.collection)).toBeNull();
  });
});

describe("cellOf / tileHref: the 0.05 degree grid", () => {
  it("(-86.73, 21.62) is cell 9844266 in tile 954 (the notebook's flower example)", () => {
    const c = cellOf(-86.73, 21.62, d.grid)!;
    expect(c.cellId).toBe(9844266);
    expect(c.tile).toBe(954);
    expect(c.lat).toBeCloseTo(21.625, 9);
    expect(c.lon).toBeCloseTo(-86.725, 9);
    expect([c.row, c.col]).toEqual([1367, 1865]);
  });

  it("the corners: first cell / tile 0, last cell / last tile, and the wrap at 180", () => {
    expect(cellOf(-179.99, 89.99, d.grid)).toMatchObject({ cellId: 1, tile: 0 });
    expect(cellOf(179.99, -89.99, d.grid)).toMatchObject({ cellId: 7200 * 3600, tile: 2591 });
    expect(cellOf(180, 0, d.grid)?.col).toBe(0);
    expect(cellOf(540.01, 0, d.grid)?.col).toBe(0);
  });

  it("the centre of a cell is in that cell, and a cell edge belongs to the cell east / south of it", () => {
    const c = cellOf(-86.73, 21.62, d.grid)!;
    expect(cellOf(c.lon, c.lat, d.grid)?.cellId).toBe(c.cellId);
    expect(cellOf(-86.75, 21.65, d.grid)).toMatchObject({ row: 1367, col: 1865 }); // exact edges, float-safe
    expect(cellOf(-85.05, 21.65, d.grid)?.col).toBe(1899);
  });

  it("outside the grid or not a number: null", () => {
    expect(cellOf(0, 90.01, d.grid)).toBeNull();
    expect(cellOf(0, -90, d.grid)).toBeNull();
    expect(cellOf(Number.NaN, 0, d.grid)).toBeNull();
  });

  it("tileHref fills {tile}", () => {
    expect(tileHref("./cell_species/tile={tile}/data_0.parquet", 954)).toBe(
      "./cell_species/tile=954/data_0.parquet",
    );
  });
});

describe("cellAreaKm2 / shareOf: the spherical band the workflow uses", () => {
  it("an equatorial 0.05 degree cell is 30.9 km², smaller towards the poles, symmetric", () => {
    expect(cellAreaKm2(0)).toBeCloseTo(30.91, 2);
    expect(cellAreaKm2(60)).toBeLessThan(cellAreaKm2(30));
    expect(cellAreaKm2(-40.025)).toBeCloseTo(cellAreaKm2(40.025), 9);
  });

  it("the 20 cells of a 1 degree band add up to R² · dlon · (sin(lat1) - sin(lat2)) exactly", () => {
    const rad = Math.PI / 180;
    let sum = 0;
    for (let i = 0; i < 20; i++) sum += cellAreaKm2(10.025 + i * 0.05);
    const exact = 6371.0088 ** 2 * (0.05 * rad) * (Math.sin(10.05 * rad) - Math.sin(10 * rad));
    // one cell wide: the 20 cells span 1 degree of latitude and one 0.05 degree column
    const band = 6371.0088 ** 2 * (0.05 * rad) * (Math.sin(11 * rad) - Math.sin(10 * rad));
    expect(sum).toBeCloseTo(band, 8);
    expect(cellAreaKm2(10.025)).toBeCloseTo(exact, 10);
  });

  it("share = suit · area / total (total is summed with suitability on the 1-100 scale)", () => {
    const a = cellAreaKm2(LAT);
    expect(shareOf(100, LAT, 100 * a)).toBeCloseTo(1, 12);
    expect(shareOf(50, LAT, 100 * a)).toBeCloseTo(0.5, 12);
    expect(shareOf(95, LAT, 9.5e7)).toBeCloseTo((95 * a) / 9.5e7, 15);
  });

  it("no total (missing, zero, negative): no share, never Infinity", () => {
    for (const t of [null, undefined, 0, -3, Number.NaN]) expect(shareOf(50, LAT, t)).toBeNull();
  });

  it("formatShare: three significant figures, a floor, blank when unknown", () => {
    expect(formatShare(0.0000102)).toBe("0.00102%");
    expect(formatShare(0.5)).toBe("50%");
    expect(formatShare(1e-9)).toBe("<0.0001%");
    expect(formatShare(0)).toBe("0%");
    expect(formatShare(null)).toBe("");
  });
});

describe("readTile: one cell out of a sorted tile", () => {
  const cols = { keyColumn: "cell_id", speciesColumn: "aphia_id", valueColumn: "suit" };
  const tile = () => buf("cell_species/tile=954/data_0.parquet");

  it("prunes row groups from the footer statistics: one cell costs the footer plus one row group", async () => {
    // regression: the shorthand filter { cell_id: X } read every row group of a real 12.8 MB tile
    const file = tile();
    const ranges: [number, number][] = [];
    const counting = {
      byteLength: file.byteLength,
      slice: async (a: number, b?: number) => {
        ranges.push([a, b ?? file.byteLength]);
        return file.slice(a, b);
      },
    };
    const r = await readTile(counting, 9844266, cols);
    expect(r.ok && r.value.length).toBe(6);
    // the fixture has four 3-row row groups and the cell's six rows span two of them: footer + 2
    // groups = 3 ranges; a full read (the shorthand filter) would touch all four plus the footer = 5
    expect(ranges.length).toBeLessThanOrEqual(3);
    // the first and last row groups (cells 9844265 and 9844267) are never fetched as data: no range
    // other than the footer read (the one that ends at the file's end) covers their first data page
    const { parquetMetadata } = await import("hyparquet");
    const meta = parquetMetadata(file);
    const dataRanges = ranges.filter(([, b]) => b !== file.byteLength);
    for (const g of [0, 3]) {
      const off = Number(meta.row_groups[g].columns[0].meta_data?.data_page_offset ?? -1);
      expect(off).toBeGreaterThan(0);
      expect(dataRanges.some(([a, b]) => a <= off && off < b)).toBe(false);
    }
  });

  it("the cell's rows, suitability high to low (the file is sorted by cell then suit desc)", () => {
    expect(tile66).toEqual([
      { speciesId: 100001, suit: 95 },
      { speciesId: 100002, suit: 80 },
      { speciesId: 100003, suit: 72 },
      { speciesId: 100004, suit: 55 },
      { speciesId: 100005, suit: 41 },
      { speciesId: 100006, suit: 12 },
    ]);
  });

  it("a neighbouring cell reads only its own rows, from its own row group", async () => {
    const west = await readTile(tile(), 9844265, cols);
    const east = await readTile(tile(), 9844267, cols);
    expect(west.ok && west.value.map((r) => r.speciesId)).toEqual([100001, 100007, 100003]);
    expect(east.ok && east.value.map((r) => r.speciesId)).toEqual([100001, 100002, 100006]);
  });

  it("a cell with no rows is an empty list, not an error", async () => {
    expect(await readTile(tile(), 1, cols)).toEqual({ ok: true, value: [] });
  });

  it("a missing tile (404, or the 403 of a public bucket) is an empty cell; a server error is a LoadError", async () => {
    const answer = (status: number) =>
      vi.stubGlobal("fetch", async () => new Response("", { status }));
    answer(404);
    expect(await readTile("https://t.test/a/tile=1/data_0.parquet", 5, cols)).toEqual({
      ok: true,
      value: [],
    });
    answer(403);
    expect(await readTile("https://t.test/b/tile=2/data_0.parquet", 5, cols)).toEqual({
      ok: true,
      value: [],
    });
    answer(500);
    const bad = await readTile("https://t.test/c/tile=3/data_0.parquet", 5, cols);
    expect(bad).toMatchObject({ ok: false, error: { kind: "http", status: 500 } });
  });

  it("not a Parquet file, or a missing column: a LoadError, never a throw", async () => {
    const junk = new TextEncoder().encode("not parquet").buffer as ArrayBuffer;
    expect((await readTile(junk, 1, cols)).ok).toBe(false);
    expect((await readTile(tile(), 1, { ...cols, valueColumn: "nope" })).ok).toBe(false);
  });
});

describe("readLookup / joinRows", () => {
  it("the lookup is keyed by aphia_id with names, group, Red List, weight and total area", () => {
    expect(lookup.size).toBe(7);
    expect(lookup.get(100001)).toMatchObject({
      scientificName: "Thunnus albacares",
      commonName: "Yellowfin tuna",
      group: "fish",
      redlist: "NT",
      weight: 0.2,
      totalArea: 9.5e7,
    });
    expect(lookup.get(100007)).toMatchObject({ commonName: "", redlist: "DD", weight: null });
  });

  it("a lookup without the key column is a schema error", async () => {
    const r = await readLookup(buf("species.parquet"), { ...d, lookupKey: "nope" });
    expect(r).toMatchObject({ ok: false, error: { kind: "schema" } });
  });

  it("the cell's table: names, group, suitability and the share of the species' global habitat", () => {
    const rows = joinRows(tile66, lookup, LAT);
    expect(rows).toHaveLength(6);
    const tuna = rows[0];
    expect(tuna).toMatchObject({
      scientificName: "Thunnus albacares",
      commonName: "Yellowfin tuna",
      group: "fish",
      suit: 95,
      redlist: "NT",
      weight: 0.2,
    });
    expect(tuna.share).toBeCloseTo((95 * cellAreaKm2(LAT)) / 9.5e7, 15);
  });

  it("a species the lookup does not know stays in the table, named by its id, with no share", () => {
    const [row] = joinRows([{ speciesId: 999, suit: 40 }], lookup, LAT);
    expect(row).toMatchObject({
      scientificName: "Species 999",
      group: "",
      redlist: "",
      share: null,
    });
  });
});

describe("the table's rules: sort, filter, counts, default group", () => {
  const rows = (): CellSpeciesRow[] => joinRows(tile66, lookup, LAT);
  const names = (r: readonly CellSpeciesRow[]) => r.map((x) => x.scientificName);

  it("sorts by suitability descending by default, and by the other keys", () => {
    expect(rows().map((r) => r.suit)).toEqual([95, 80, 72, 55, 41, 12]);
    expect(sortRows(rows().reverse()).map((r) => r.suit)).toEqual([95, 80, 72, 55, 41, 12]);
    expect(names(sortRows(rows(), "name"))).toEqual([
      "Acropora palmata",
      "Chelonia mydas",
      "Orbicella faveolata",
      "Scarus guacamaia",
      "Thunnus albacares",
      "Tursiops truncatus",
    ]);
    // most threatened first: CR, EN (name order), NT, LC
    expect(sortRows(rows(), "redlist").map((r) => r.redlist)).toEqual([
      "CR",
      "EN",
      "EN",
      "EN",
      "NT",
      "LC",
    ]);
    expect(sortRows(rows(), "group").map((r) => r.group)).toEqual([
      "fish",
      "fish",
      "hardCorals",
      "hardCorals",
      "marineMammals",
      "seaTurtles",
    ]);
    expect(sortRows(rows(), "share")[0].scientificName).toBe("Acropora palmata"); // 0.72 of a small habitat
  });

  it("sorting never mutates its input, and a share-less row sorts last", () => {
    const r = rows();
    const copy = [...r];
    sortRows(r, "name");
    expect(r).toEqual(copy);
    const unknown = joinRows([{ speciesId: 999, suit: 100 }], lookup, LAT);
    expect(sortRows([...unknown, ...r], "share").at(-1)?.speciesId).toBe(999);
  });

  it("filters by group and by text (scientific name, common name, group, Red List code)", () => {
    expect(names(filterRows(rows(), { group: "hardCorals" }))).toEqual([
      "Acropora palmata",
      "Orbicella faveolata",
    ]);
    expect(names(filterRows(rows(), { query: "  TUNA " }))).toEqual(["Thunnus albacares"]);
    expect(names(filterRows(rows(), { query: "orbi" }))).toEqual(["Orbicella faveolata"]);
    expect(filterRows(rows(), { query: "EN" }).length).toBeGreaterThanOrEqual(3); // the code, and "coral"-free names
    expect(filterRows(rows(), { query: "zzz" })).toEqual([]);
    expect(filterRows(rows(), { group: "fish", query: "parrot" })).toHaveLength(1);
    expect(filterRows(rows(), {})).toHaveLength(6);
  });

  it("filters by Red List codes: one code, two codes (either), none = no filter, combined with group and query", () => {
    expect(names(filterRows(rows(), { redlist: ["CR"] }))).toEqual(["Acropora palmata"]);
    expect(filterRows(rows(), { redlist: ["EN"] })).toHaveLength(3);
    expect(filterRows(rows(), { redlist: ["CR", "NT"] })).toHaveLength(2);
    expect(filterRows(rows(), { redlist: [] })).toHaveLength(6);
    expect(filterRows(rows(), { redlist: ["XX"] })).toEqual([]);
    // with the group: the Red List codes narrow within it
    const corals = filterRows(rows(), { group: "hardCorals" });
    expect(corals).toHaveLength(2);
    expect(filterRows(rows(), { group: "hardCorals", redlist: ["CR"] })).toHaveLength(1);
    expect(filterRows(rows(), { group: "fish", redlist: ["CR"] })).toEqual([]);
    // and with the text query
    expect(names(filterRows(rows(), { redlist: ["CR", "EN"], query: "orbi" }))).toEqual([
      "Orbicella faveolata",
    ]);
  });

  it("counts species per group in the given order, and the CR / EN / VU / NT chips", () => {
    expect(groupCounts(rows(), ["fish", "hardCorals", "mangroves", "marineMammals"])).toEqual([
      { group: "fish", count: 2 },
      { group: "hardCorals", count: 2 },
      { group: "marineMammals", count: 1 },
      { group: "seaTurtles", count: 1 },
    ]);
    expect(redlistCounts(rows())).toEqual([
      { code: "CR", count: 1 },
      { code: "EN", count: 3 },
      { code: "NT", count: 1 },
    ]);
    expect(countLine(6)).toBe("6 species in this cell");
    expect(countLine(0)).toBe("0 species in this cell");
  });

  it("the list starts on the selected EOV, and on all of them for the composite or without the dimension", () => {
    expect(defaultGroup(d, { eov: "fish", metric: "risk" }, "all")).toBe("fish");
    expect(defaultGroup(d, { eov: "all", metric: "risk" }, "all")).toBeNull();
    expect(defaultGroup(d, {}, "all")).toBeNull();
    expect(defaultGroup({ groupDimension: null }, { eov: "fish" }, "all")).toBeNull();
  });
});

describe("linksFor: the Atlas link keeps the camera", () => {
  const row = (id: number) => joinRows([{ speciesId: id, suit: 50 }], lookup, LAT)[0];
  const MAP = { lon: -86.7, lat: 21.6, zoom: 5 };

  it("Atlas is this app's URL for the taxon on the 0.05 degree surface, with the current map=", () => {
    const [atlas] = linksFor(row(100001), d, MAP);
    expect(atlas).toMatchObject({ label: "Atlas", sameApp: true });
    expect(atlas.href.startsWith("?")).toBe(true);
    const sel = parseSel({ search: atlas.href, hash: "" });
    expect(sel).toMatchObject({
      c: "aquamaps_native",
      sp: "Fis-24082",
      rep: "005",
      lens: "collection",
    });
    expect(sel.map).toEqual(MAP);
    expect(atlas.patch).toMatchObject({
      c: "aquamaps_native",
      sp: "Fis-24082",
      rep: "005",
      map: MAP,
    });
    expect(atlas.patch).toHaveProperty("i", undefined);
  });

  it("without a camera the link carries no map= and its patch leaves the camera alone", () => {
    const [atlas] = linksFor(row(100001), d);
    expect(atlas.href).not.toContain("map=");
    expect(atlas.patch).not.toHaveProperty("map");
  });

  it("WoRMS, IUCN and AquaMaps are the lookup's URL columns, external", () => {
    const links = linksFor(row(100001), d, MAP);
    expect(links.map((l) => l.label)).toEqual(["Atlas", "WoRMS", "IUCN", "AquaMaps"]);
    expect(links[1]).toEqual({
      label: "WoRMS",
      href: "https://www.marinespecies.org/aphia.php?p=taxdetails&id=100001",
      sameApp: false,
    });
    expect(links[2].href).toBe("https://www.iucnredlist.org/species/21857/");
    expect(links[3].href).toBe("https://www.aquamaps.org/preMap2.php?cache=1&SpecID=Fis-24082");
  });

  it("a species with no AquaMaps key or no URL has no such link (only WoRMS here)", () => {
    expect(linksFor(row(100007), d, MAP).map((l) => l.label)).toEqual(["WoRMS"]);
  });

  it("a URL column that is not http(s) is dropped (it comes from a data file)", () => {
    const r = row(100001);
    r.columns = { ...r.columns, iucn_url: "javascript:alert(1)", aquamaps_url: "data:text/html,x" };
    expect(linksFor(r, d, MAP).map((l) => l.label)).toEqual(["Atlas", "WoRMS"]);
  });

  it("the sp key is URL-encoded", () => {
    const r = row(100001);
    r.columns = { ...r.columns, sp_key: "A&b=c" };
    expect(linksFor(r, d)[0].href).toContain("sp=A%26b%3Dc");
  });
});

describe("cellSpeciesCsv", () => {
  it("one row per species with raw values, share as a percentage", () => {
    const csv = cellSpeciesCsv(sortRows(joinRows(tile66, lookup, LAT)), CELL, d).split("\r\n");
    expect(csv[0]).toBe(
      "cell_id,aphia_id,scientific_name,common_name,group,suitability,share_pct,redlist,weight",
    );
    expect(csv[1].startsWith(`${CELL},100001,Thunnus albacares,Yellowfin tuna,fish,95,`)).toBe(
      true,
    );
    expect(csv[1].endsWith(",NT,0.2")).toBe(true);
    expect(csv.filter(Boolean)).toHaveLength(7);
  });
});

describe("createCellSpeciesStore: the lookup once, each cell once", () => {
  const mk = () => {
    const calls = { tile: [] as string[], lookup: 0 };
    const store = createCellSpeciesStore(d, {
      readTile: async (url, cellId) => {
        calls.tile.push(`${url}#${cellId}`);
        return { ok: true, value: [] };
      },
      readLookup: async () => {
        calls.lookup++;
        return { ok: true, value: new Map() };
      },
    });
    return { store, calls };
  };

  it("reads the lookup once and each cell once, from its tile's URL", async () => {
    const { store, calls } = mk();
    await Promise.all([store.lookup(), store.lookup()]);
    await store.cell({ cellId: 7, tile: 954 });
    await store.cell({ cellId: 7, tile: 954 });
    await store.cell({ cellId: 8, tile: 954 });
    expect(calls.lookup).toBe(1);
    expect(calls.tile).toEqual([
      `${FIXTURE_BASE}aquamaps_eov/cell_species/tile=954/data_0.parquet#7`,
      `${FIXTURE_BASE}aquamaps_eov/cell_species/tile=954/data_0.parquet#8`,
    ]);
  });

  it("a failed read is not kept: the retry asks again", async () => {
    let n = 0;
    const store = createCellSpeciesStore(d, {
      readTile: async (url) =>
        ++n === 1
          ? { ok: false, error: { kind: "network", url: String(url), message: "down" } }
          : { ok: true, value: [{ speciesId: 1, suit: 2 }] },
    });
    expect((await store.cell({ cellId: 1, tile: 1 })).ok).toBe(false);
    await Promise.resolve();
    expect((await store.cell({ cellId: 1, tile: 1 })).ok).toBe(true);
    expect(n).toBe(2);
  });
});
