// The WoRMS subtree in the page (obis-hex parity rows 7, 10, 11; src/lens/collection/h3/subtree.ts): its SQL run on
// DuckDB-WASM's own engine (the pinned @duckdb/duckdb-wasm 1.32.0 in-process node build, the same v1.4.3 engine the
// page boots), against a hand-computed 3-cell fixture and against one real res-3 cell of the release, where the
// subtree of Animalia equals the published Animalia head (obisindicators' week-4 export proved the head equals the
// subtree SQL; this proves the port does).
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { cellIdOf, h3OfCellId, parentId } from "@oceanmetrics/map";
import {
  boxHolds,
  boxRanges,
  classFileUrl,
  domainsOf,
  hiveSegment,
  parentIdSql,
  rangeOf,
  readLine,
  subtreeAsk,
  subtreeClassesSql,
  subtreeCoverage,
  subtreeLine,
  subtreePlan,
  subtreeRes,
  subtreeSql,
  subtreeSummarySql,
  subtreeTableOf,
  subtreeTaxaSql,
  subtreeTaxonPart,
  taxonLine,
  viewBox,
} from "../../src/lens/collection/h3/subtree";
import { instantiateNodeDuckdb, type NodeDuckdb } from "../analysis/nodeEngine";
import { collection, REL } from "./support";

let db: NodeDuckdb;
let q: <T = Record<string, unknown>>(sql: string) => T[];

beforeAll(async () => {
  db = await instantiateNodeDuckdb();
  db.reset();
  const conn = db.connect();
  q = <T>(sql: string) =>
    conn
      .query(sql)
      .toArray()
      .map((r) => ({ ...r }) as T);
}, 60_000);

const num = (v: unknown) => (typeof v === "bigint" ? Number(v) : (v as number));
const lit = (v: string | null) => (v === null ? "NULL" : `'${v.replaceAll("'", "''")}'`);

/** a lookup table from rows (aphiaid, name_key, class, lineage, records) */
function lookupTable(
  name: string,
  rows: {
    aphiaid: number;
    name_key: number;
    class: string | null;
    lineage: number[];
    records: number;
  }[],
) {
  q(
    `CREATE OR REPLACE TABLE ${name} AS SELECT * FROM (VALUES ${rows
      .map(
        (r) =>
          `(${r.aphiaid}::BIGINT, ${r.name_key}::INTEGER, ${lit(r.class)}, [${r.lineage.join(", ")}]::BIGINT[], ${r.records}::BIGINT)`,
      )
      .join(", ")}) t(aphiaid, name_key, class, lineage, records)`,
  );
}
/** a species-table rows table (cell_id, aphiaid, name_key, n) */
function rowsTable(
  name: string,
  rows: { cell_id: string | bigint; aphiaid: number; name_key: number; n: number }[],
) {
  q(
    `CREATE OR REPLACE TABLE ${name} AS SELECT * FROM (VALUES ${rows
      .map(
        (r) =>
          `(${String(r.cell_id)}::BIGINT, ${r.aphiaid}::BIGINT, ${r.name_key}::INTEGER, ${r.n}::BIGINT)`,
      )
      .join(", ")}) t(cell_id, aphiaid, name_key, n)`,
  );
}

// ---- the hand-computed fixture ----------------------------------------------------------------------------------
// Cetacea (2688): 101 and 102/103 (one name, two aphiaids: name_key 2) in Mammalia, 104 with no class (_none);
// 201 a seal and 301 a fish are not in the subtree.
const CETACEA = 2688;
const LOOKUP = [
  { aphiaid: 101, name_key: 1, class: "Mammalia", lineage: [101, 2688, 1837, 2], records: 90 },
  { aphiaid: 102, name_key: 2, class: "Mammalia", lineage: [102, 2688, 1837, 2], records: 70 },
  { aphiaid: 103, name_key: 2, class: "Mammalia", lineage: [103, 2688, 1837, 2], records: 10 },
  { aphiaid: 104, name_key: 3, class: null, lineage: [104, 2688, 1837, 2], records: 25 },
  { aphiaid: 201, name_key: 4, class: "Mammalia", lineage: [201, 999, 1837, 2], records: 500 },
  { aphiaid: 301, name_key: 5, class: "Teleostei", lineage: [301, 11676, 2], records: 99 },
];
const A = "831914fffffffff";
const B = "831915fffffffff";
const C = "831916fffffffff";
const id = (h3: string) => cellIdOf(h3).toString();
const ROWS = [
  // A: names 1 and 2 at 30 records each, N = 60 (each name leaves 30 < 50: esi = 1), the seal left out
  { cell_id: id(A), aphiaid: 101, name_key: 1, n: 30 },
  { cell_id: id(A), aphiaid: 102, name_key: 2, n: 30 },
  { cell_id: id(A), aphiaid: 201, name_key: 4, n: 500 },
  // B: N = 15 < 50: no ES(50)
  { cell_id: id(B), aphiaid: 101, name_key: 1, n: 10 },
  { cell_id: id(B), aphiaid: 104, name_key: 3, n: 5 },
  // C: name 2 is 102 (40) + 103 (10) = 50, name 1 50, name 3 20, N = 120; the fish left out
  { cell_id: id(C), aphiaid: 102, name_key: 2, n: 40 },
  { cell_id: id(C), aphiaid: 103, name_key: 2, n: 10 },
  { cell_id: id(C), aphiaid: 101, name_key: 1, n: 50 },
  { cell_id: id(C), aphiaid: 104, name_key: 3, n: 20 },
  { cell_id: id(C), aphiaid: 301, name_key: 5, n: 99 },
];

/** C(n, k) exactly */
function choose(n: number, k: number): bigint {
  let r = 1n;
  for (let i = 0; i < k; i++) r = (r * BigInt(n - i)) / BigInt(i + 1);
  return r;
}
/** Hurlbert's ES(m) by hand: sum over species of 1 - C(N - ni, m) / C(N, m) */
function esByHand(counts: number[], m = 50): number | null {
  const N = counts.reduce((a, b) => a + b, 0);
  if (N < m) return null;
  return counts.reduce((a, ni) => {
    if (N - ni < m) return a + 1;
    // the ratio of two big integers as a double, to 15 digits
    const SCALE = 10n ** 30n;
    return a + 1 - Number((choose(N - ni, m) * SCALE) / choose(N, m)) / 1e30;
  }, 0);
}
const shannonOf = (c: number[]) => {
  const N = c.reduce((a, b) => a + b, 0);
  return -c.reduce((a, x) => a + (x / N) * Math.log(x / N), 0);
};
const simpsonOf = (c: number[]) => {
  const N = c.reduce((a, b) => a + b, 0);
  return c.reduce((a, x) => a + (x / N) ** 2, 0);
};

describe("the subtree's indicators (obisindicators' SQL, on DuckDB-WASM)", () => {
  it("the hand-computed 3-cell fixture: n, sp (names), Shannon, Simpson, ES(50)", () => {
    lookupTable("lk", LOOKUP);
    rowsTable("rows3", ROWS);
    const got = q(
      subtreeSql({ rows: "rows3", lookup: "lk", aphiaid: CETACEA, res: 3, tableRes: 3 }),
    );
    expect(got.map((r) => h3OfCellId(BigInt(r.cell_id as bigint)))).toEqual([A, B, C]);
    const want = { [A]: [30, 30], [B]: [10, 5], [C]: [50, 50, 20] };
    for (const r of got) {
      const c = want[h3OfCellId(BigInt(r.cell_id as bigint))];
      expect(num(r.n)).toBe(c.reduce((a, b) => a + b, 0));
      expect(num(r.sp)).toBe(c.length);
      expect(r.shannon as number).toBeCloseTo(shannonOf(c), 12);
      expect(r.simpson as number).toBeCloseTo(simpsonOf(c), 12);
      const es = esByHand(c);
      if (es === null) expect(r.es).toBeNull();
      else expect(r.es as number).toBeCloseTo(es, 10);
    }
    // the cases by name: A's ES(50) is 2 (each name leaves fewer than 50), B has none, C's two terms are real
    expect(got[0].es).toBe(2);
    expect(got[0].shannon as number).toBeCloseTo(Math.log(2), 12);
    expect(got[1].es).toBeNull();
    expect(got[2].es as number).toBeGreaterThan(2.9);
    expect(got[2].es as number).toBeLessThan(3);
  });

  it("a name with two aphiaids is one species (sp counts name_key), the taxa outside the lineage are left out", () => {
    const got = q(
      subtreeSql({ rows: "rows3", lookup: "lk", aphiaid: CETACEA, res: 3, tableRes: 3 }),
    );
    const c = got.find((r) => h3OfCellId(BigInt(r.cell_id as bigint)) === C)!;
    expect(num(c.sp)).toBe(3); // not 4 (102 and 103 share a name), not 4 or 5 (no fish)
    expect(num(c.n)).toBe(120); // not 219 (the fish's 99)
    // the whole order would hold the seal: lineage 1837 keeps it
    const all = q(subtreeSql({ rows: "rows3", lookup: "lk", aphiaid: 1837, res: 3, tableRes: 3 }));
    expect(num(all.find((r) => h3OfCellId(BigInt(r.cell_id as bigint)) === A)!.n)).toBe(560);
  });

  it("res 1 and 2 roll res 3 up by the parent's bits: the counts summed, the indicators recomputed", () => {
    const parent = h3OfCellId(parentId(cellIdOf(A), 2));
    expect([B, C].map((h) => h3OfCellId(parentId(cellIdOf(h), 2)))).toEqual([parent, parent]);
    const got = q(
      subtreeSql({ rows: "rows3", lookup: "lk", aphiaid: CETACEA, res: 2, tableRes: 3 }),
    );
    expect(got).toHaveLength(1);
    expect(h3OfCellId(BigInt(got[0].cell_id as bigint))).toBe(parent);
    const c = [30 + 10 + 50, 30 + 50, 5 + 20]; // names 1, 2, 3 over A, B and C
    expect(num(got[0].n)).toBe(195);
    expect(num(got[0].sp)).toBe(3);
    expect(got[0].shannon as number).toBeCloseTo(shannonOf(c), 12);
    expect(got[0].simpson as number).toBeCloseTo(simpsonOf(c), 12);
    expect(got[0].es as number).toBeCloseTo(esByHand(c)!, 10);
  });

  it("parentIdSql is h3Bits' parentId (h3-js's cellToParent) on ids at res 3 to 5", () => {
    const ids = [A, "8529a9b7fffffff", "8448c91ffffffff", "85283473fffffff", "8001fffffffffff"];
    for (const h of ids) {
      const cid = cellIdOf(h);
      for (let r = 0; r <= Number((cid >> 52n) & 15n); r++) {
        const [row] = q<{ p: bigint }>(`SELECT ${parentIdSql(`${cid}::BIGINT`, r)} AS p`);
        expect(h3OfCellId(BigInt(row.p))).toBe(h3OfCellId(parentId(cid, r)));
      }
    }
  });

  it("the view's box keeps the rows in its ranges only", () => {
    const a = cellIdOf(A);
    const got = q(
      subtreeSql({
        rows: "rows3",
        lookup: "lk",
        aphiaid: CETACEA,
        res: 3,
        tableRes: 3,
        ranges: [[a, a]],
      }),
    );
    expect(got.map((r) => h3OfCellId(BigInt(r.cell_id as bigint)))).toEqual([A]);
    expect(
      q(
        subtreeSql({
          rows: "rows3",
          lookup: "lk",
          aphiaid: CETACEA,
          res: 3,
          tableRes: 3,
          ranges: [],
        }),
      ),
    ).toEqual([]);
  });

  it("the taxa from the lookup's lineage, and the classes they fall in (a NULL class is _none)", () => {
    expect(
      q(subtreeTaxaSql("lk", CETACEA))
        .map((r) => num(r.aphiaid))
        .sort(),
    ).toEqual([101, 102, 103, 104]);
    expect(q(subtreeClassesSql("lk", CETACEA))).toEqual(
      [
        { class: "Mammalia", taxa: 3, records: 170 },
        { class: "_none", taxa: 1, records: 25 },
      ].sort((x, y) => (x.class < y.class ? -1 : 1)),
    );
    expect(q(subtreeClassesSql("lk", 11676))).toEqual([
      { class: "Teleostei", taxa: 1, records: 99 },
    ]);
    expect(q(subtreeClassesSql("lk", 424242))).toEqual([]);
  });

  it("the summary: p02 to p98 per indicator (quantile_cont), the cells with a value", () => {
    q(
      `CREATE OR REPLACE TABLE cells AS ${subtreeSql({ rows: "rows3", lookup: "lk", aphiaid: CETACEA, res: 3, tableRes: 3 })}`,
    );
    const [row] = q(subtreeSummarySql("cells", ["es", "n"]));
    const d = domainsOf(row, ["es", "n"]);
    expect(d.cells).toBe(3);
    expect(d.byIndicator.es!.cells).toBe(2);
    expect(d.byIndicator.n!.cells).toBe(3);
    const [qq] = q<{ lo: number; hi: number }>(
      "SELECT quantile_cont(x, 0.02) lo, quantile_cont(x, 0.98) hi FROM (SELECT unnest([15, 60, 120]::DOUBLE[]) x)",
    );
    expect(rangeOf(d.byIndicator.n)).toEqual([qq.lo, qq.hi]);
  });
});

describe("the real cell: the subtree of Animalia equals the published Animalia head (res 3, 831914fffffffff)", () => {
  const fx = JSON.parse(
    readFileSync("tests/fixtures/obis_h3/subtree/animalia_831914.json", "utf8"),
  ) as {
    rows: { cell_id: string; aphiaid: number; name_key: number; n: number }[];
    lookup: {
      aphiaid: number;
      name_key: number;
      class: string | null;
      lineage: number[];
      records: number;
    }[];
    head: {
      h3: string;
      cell_id: string;
      n: number;
      sp: number;
      shannon: number;
      simpson: number;
      es: number;
    };
  };
  it("n and sp exactly, Shannon, Simpson and ES(50) to floating point", () => {
    lookupTable("lk_real", fx.lookup);
    rowsTable("rows_real", fx.rows);
    // every taxon of the cell is in the fixture, Animalia's and the others' (the filter has work to do)
    expect(fx.rows.length).toBe(227);
    expect(fx.lookup.filter((l) => l.lineage.includes(2)).length).toBe(146);
    const [got] = q(
      subtreeSql({ rows: "rows_real", lookup: "lk_real", aphiaid: 2, res: 3, tableRes: 3 }),
    );
    expect(h3OfCellId(BigInt(got.cell_id as bigint))).toBe(fx.head.h3);
    expect(num(got.n)).toBe(fx.head.n);
    expect(num(got.sp)).toBe(fx.head.sp);
    expect(got.shannon as number).toBeCloseTo(fx.head.shannon, 12);
    expect(got.simpson as number).toBeCloseTo(fx.head.simpson, 12);
    // lgamma in the browser's libm and in the release's native DuckDB differ in the last digits: 2e-11 relative here
    expect(Math.abs((got.es as number) - fx.head.es) / fx.head.es).toBeLessThan(1e-9);
  });
});

describe("the files", () => {
  const T = subtreeTableOf(collection() as unknown as Record<string, unknown>)!;
  it("the table from the collection: the class template, the lookup, _none, the decade table", () => {
    expect(T.template).toBe(`${REL}species/res={res}/class={class}/data_0.parquet`);
    expect(T.resolutions).toEqual([3, 4, 5]);
    expect(T.lookup).toBe(`${REL}species/species.parquet`);
    expect(T.nullClass).toBe("_none");
    expect(T.decade?.resolutions).toEqual([3, 4]);
    expect(T.decade?.decades).toContain("1990");
    expect(subtreeTableOf({})).toBeNull();
    expect(
      subtreeTableOf({ "h3:species_table": { href_template: "x/res={res}.parquet" } }),
    ).toBeNull();
  });
  it("a class with a space is encoded as the store holds it (%2520)", () => {
    expect(hiveSegment("Mammalia")).toBe("Mammalia");
    expect(hiveSegment("Apicomplexa incertae sedis")).toBe("Apicomplexa%2520incertae%2520sedis");
    expect(hiveSegment("_none")).toBe("_none");
    expect(classFileUrl(T, 4, "Mammalia")).toBe(
      `${REL}species/res=4/class=Mammalia/data_0.parquet`,
    );
    expect(classFileUrl(T, 3, "Aves", "1990")).toBe(
      `${REL}species_decade/res=3/decade=1990/class=Aves/data_0.parquet`,
    );
  });
});

describe("the cap and the words", () => {
  it("auto draws the zoom's resolution up to 5 (4 with a decade); a pin is clamped, with a note; res 1 and 2 read 3", () => {
    const t = [3, 4, 5];
    expect(subtreeRes({ res: "auto", zoom: 1, decade: false, tableRes: t })).toMatchObject({
      res: 1,
      tableRes: 3,
      note: null,
    });
    expect(subtreeRes({ res: "auto", zoom: 4.5, decade: false, tableRes: t })).toMatchObject({
      res: 3,
      tableRes: 3,
    });
    expect(subtreeRes({ res: "auto", zoom: 6, decade: false, tableRes: t })).toMatchObject({
      res: 5,
      tableRes: 5,
      note: null,
    });
    expect(subtreeRes({ res: "auto", zoom: 9, decade: false, tableRes: t }).note).toContain(
      "up to res 5",
    );
    expect(subtreeRes({ res: 7, zoom: 9, decade: false, tableRes: t })).toMatchObject({
      res: 5,
      tableRes: 5,
    });
    expect(subtreeRes({ res: 7, zoom: 9, decade: false, tableRes: t }).note).toContain(
      "res 7 is shown as res 5",
    );
    expect(subtreeRes({ res: 5, zoom: 4, decade: true, tableRes: [3, 4] })).toMatchObject({
      res: 4,
      tableRes: 4,
    });
  });
  it("a set over 25 MB is refused with its byte estimate and the resolution that would serve it", () => {
    const f = (bytes: number) => ({ url: "u", bytes, cls: "Teleostei" });
    expect(subtreePlan({ name: "Teleostei", res: 5, files: [f(13_764_660), f(722_388)] })).toEqual({
      bytes: 14_487_048,
      over: false,
      line: null,
    });
    const p = subtreePlan({
      name: "Teleostei",
      res: 5,
      files: [f(13_764_660), f(722_388)],
      max: 10 * 1024 * 1024,
      coarser: [
        { res: 4, bytes: 8_645_567 },
        { res: 3, bytes: 5_170_744 },
      ],
    });
    expect(p.over).toBe(true);
    expect(p.line).toBe(
      "The subtree of Teleostei at res 5 would read 13.8 MB of the species table (2 files), over the 10.0 MB the page reads at once: pin res 4 (8.25 MB) or coarser.",
    );
  });
  it("the sentence line, the chip, the taxon line, the read line, the coverage", () => {
    expect(subtreeLine("Cetacea")).toBe(
      "subtree of Cetacea (computed in the browser from the species table, res ≤ 5)",
    );
    expect(subtreeTaxonPart("Cetacea", "Infraorder")).toEqual({
      label: "Whales and dolphins",
      qual: "(infraorder Cetacea, WoRMS)",
      control: "taxon",
    });
    expect(subtreeTaxonPart("Megaptera novaeangliae", "Species").qual).toBe("(species, WoRMS)");
    const rec = {
      id: 2688,
      name: "Cetacea",
      authority: "Brisson, 1762",
      rank: "Infraorder",
      status: "accepted",
      acceptedId: 2688,
      acceptedName: "Cetacea",
      kingdom: "Animalia",
      phylum: "Chordata",
      class: "Mammalia",
    };
    expect(taxonLine(rec, 1234567)).toBe(
      "Cetacea Brisson, 1762 · infraorder · accepted · 1,234,567 records",
    );
    expect(taxonLine({ ...rec, id: 9, status: "unaccepted" }, null)).toContain(
      "accepted name Cetacea (AphiaID 2688), whose subtree is shown",
    );
    expect(
      readLine({ bytes: 508_716, files: 2, lookupBytes: 4_086_019, cells: 4567, ms: 1234.4 }),
    ).toBe(
      "Read 0.49 MB of the species table (2 files) and the lookup (3.90 MB, once per page); 4,567 hexagons in 1,234 ms.",
    );
    expect(subtreeCoverage({ indicator: "es", valued: 12, cells: 30 })).toBe(
      "12 of 30 hexagons of the subtree have ≥ 50 records",
    );
    expect(subtreeCoverage({ indicator: "sp", valued: 30, cells: 30 })).toBe(
      "30 hexagons of the subtree",
    );
  });
  it("the taxon= values it asks: aphia:<id>, or <rank>:<name>", () => {
    expect(subtreeAsk("aphia:2688")).toEqual({ kind: "aphia", id: 2688 });
    expect(subtreeAsk("aphia:0")).toBeNull();
    expect(subtreeAsk("infraorder:Cetacea")).toEqual({
      kind: "name",
      rank: "infraorder",
      name: "Cetacea",
    });
    expect(subtreeAsk("Cetacea")).toBeNull();
    expect(subtreeAsk(undefined)).toBeNull();
  });
});

describe("the view's box at res 5", () => {
  it("grown by a quarter, rounded out to half degrees; a world-wide view has none", () => {
    expect(viewBox([-122.3, 36.4, -121.7, 37.1])).toEqual([-122.5, 36, -121.5, 37.5]);
    expect(viewBox([-200, -60, 200, 60])).toBeNull();
    expect(boxHolds([-122.5, 36, -121.5, 37.5], [-122.2, 36.5, -121.8, 37])).toBe(true);
    expect(boxHolds([-122.5, 36, -121.5, 37.5], [-123, 36.5, -121.8, 37])).toBe(false);
  });
  it("the ranges hold the res-5 cells of the box and not a cell outside it", async () => {
    // h3-js (the map package's own dependency) places the cells; the app forms the ranges with the package's tileRanges
    const { latLngToCell } = await import("h3-js");
    const r = boxRanges([-122.5, 36, -121.5, 37.5], 5, 9)!;
    const inR = (h: string) => {
      const c = cellIdOf(h);
      return r.some(([a, b]) => c >= a && c <= b);
    };
    expect(inR(latLngToCell(36.75, -122.1, 5))).toBe(true); // Monterey Bay
    expect(inR(latLngToCell(36.2, -121.7, 5))).toBe(true); // Big Sur, inside the box
    expect(inR(latLngToCell(34.0, -120.0, 5))).toBe(false); // the Channel Islands, south of it
    expect(inR(latLngToCell(36.75, 140.0, 5))).toBe(false); // off Japan
    // across the antimeridian the box wraps
    const fiji = boxRanges([178, -19, 182, -16], 5, 7)!;
    expect(
      fiji.some(
        ([a, b]) =>
          cellIdOf(latLngToCell(-17.5, -179.5, 5)) >= a &&
          cellIdOf(latLngToCell(-17.5, -179.5, 5)) <= b,
      ),
    ).toBe(true);
    expect(
      fiji.some(
        ([a, b]) =>
          cellIdOf(latLngToCell(-17.5, 178.5, 5)) >= a &&
          cellIdOf(latLngToCell(-17.5, 178.5, 5)) <= b,
      ),
    ).toBe(true);
  });
});
