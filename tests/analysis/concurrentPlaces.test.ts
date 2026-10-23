// usability B1: "place analyses race on shared DuckDB tables: coverage reads 0 / 100 / 200 %, and
// a place can show another place's scores". Observed on the live 0.10.21 -- one 18,354 km² box
// read 0.0 %, 100.0 % and 200.0 % "inside the study area" (1,344 of 672 cells) from run to run.
//
// Every place analysis builds the SAME fixed-name objects (`cell`, `place_cell`, `place_cell_sa`,
// `cell_model`, `cell_model_key`, `species_agg`, `species_sel`) with one statement per `await`, on
// ONE connection. `Engine`'s chain orders STATEMENTS, not analyses, so two analyses in flight at once
// (a drawn place's scores + "Show analysis cells"; a running analysis + the next upload's study-area
// check) interleave: `CREATE OR REPLACE place_cell` twice then `INSERT` twice doubles the table
// (the 200 %), a replace between an insert and the count empties it (the 0 %), and a `cell` view
// redefined over another place's tiles hands one place the other's numbers.
//
// This drives the REAL `Engine` + `AnalysisSources` + `places/results.ts` + `places/studyArea.ts`
// over a real DuckDB (`nodeEngine.ts`), and asserts the one property that matters: a place analysed
// alongside another gets EXACTLY what it gets alone.
import { beforeAll, describe, expect, it } from "vitest";
import { AnalysisSources } from "../../src/lib/analysis/sources";
import { TEMPLATES } from "../../src/lib/analysis/templates";
import { gridFromBoot } from "../../src/lib/grid/grid";
import type { AreaGeometry } from "../../src/lib/geo/types";
import type { DataEngineContext } from "../../src/places/dataEngine";
import {
  computeScoreResults,
  computeSpeciesResults,
  placeCellsInStudyArea,
  type ScoreResults,
} from "../../src/places/results";
import { touchesStudyArea } from "../../src/places/studyArea";
import { instantiateNodeDuckdb, nodeEngine, type NodeDuckdb } from "./nodeEngine";

// ---- the fixture: an 8 x 8 grid in four 4 x 4 tiles --------------------------------------------

const NC = 8;
const TILE = 4;
const BASE = "https://fixture.test/";
const VER = "vT";

const BOOT = {
  ver: VER,
  built_at: "2026-09-23T00:00:00Z",
  id_field: "mdl_key",
  grid: {
    nc: NC,
    nr: NC,
    xmin: -125,
    ymax: 42,
    resx: 0.05,
    resy: 0.05,
    lon360: false,
    tile: { size: TILE },
  },
  layers: [
    { metric_key: "extrisk_bird_ecoregion_rescaled", category: "component" },
    { metric_key: "extrisk_fish_ecoregion_rescaled", category: "component" },
  ],
  tables: {},
};

const rowOf = (id: number) => Math.floor((id - 1) / NC) + 1;
const colOf = (id: number) => ((id - 1) % NC) + 1;
const tileOfCell = (id: number) =>
  Math.floor((rowOf(id) - 1) / TILE) * (NC / TILE) + Math.floor((colOf(id) - 1) / TILE);

/** land / foreign water: column 1 of the top half, and the bottom-right tile's last row + column. */
function inUsa(id: number): boolean {
  const r = rowOf(id);
  const c = colOf(id);
  if (c === 1 && r <= 4) return false;
  if (r === 8 && c >= 5) return false;
  if (c === 8 && r >= 5) return false;
  return true;
}

const enc = (s: string) => new TextEncoder().encode(s);

function fixtureFiles(): Map<string, Uint8Array> {
  const files = new Map<string, Uint8Array>();
  const cells = Array.from({ length: NC * NC }, (_, i) => i + 1);
  for (let t = 0; t < 4; t++) {
    const mine = cells.filter((id) => tileOfCell(id) === t);
    const cellCsv = [
      "cell_id,in_usa,area_km2,extrisk_bird_ecoregion_rescaled,extrisk_fish_ecoregion_rescaled",
      // bird on every cell; fish on odd cells only, so its coverage is partial (a blend, D7)
      ...mine.map(
        (id) => `${id},${inUsa(id)},${20 + id / 10},${id * 1.5},${id % 2 ? 100 - id : ""}`,
      ),
    ].join("\n");
    files.set(`${VER}/app/cell/tile=${t}/data_0.parquet`, enc(cellCsv));
    // sp:1 lives in the top half, sp:2 in the bottom half, sp:3 everywhere
    const cm = ["cell_id,mdl_id,val"];
    for (const id of mine) {
      if (rowOf(id) <= 4) cm.push(`${id},1,${10 + colOf(id)}`);
      else cm.push(`${id},2,${80 - rowOf(id)}`);
      cm.push(`${id},3,50`);
    }
    files.set(`${VER}/serve/cell_model/tile=${t}/data_0.parquet`, enc(cm.join("\n")));
  }
  files.set(
    `${VER}/app/taxon.parquet`,
    enc(
      [
        "key,sp_cat,common,sci,taxon_id,taxon_authority,er_code,er_score,is_mmpa,is_mbta,valid_usa",
        "sp:1,bird,gull,Larus one,worms:1,worms,EN,50,false,true,true",
        "sp:2,fish,cod,Gadus two,worms:2,worms,VU,30,false,false,true",
        "sp:3,mammal,whale,Balaena three,worms:3,worms,CR,80,true,false,true",
      ].join("\n"),
    ),
  );
  files.set(`${VER}/tables/model.parquet`, enc("mdl_id,mdl_key\n1,sp:1\n2,sp:2\n3,sp:3"));
  files.set(`${VER}/app/zone_taxon.parquet`, enc("zone_value,mdl_key\nz:1,sp:1"));
  files.set(`${VER}/app/taxonomy.parquet`, enc("taxon_id,Kingdom\nworms:1,Animalia"));
  return files;
}

const box = (x0: number, y0: number, x1: number, y1: number): AreaGeometry => ({
  type: "Polygon",
  coordinates: [
    [
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1],
      [x0, y0],
    ],
  ],
});

/** tile 0: 16 cells, 4 of them (column 1) outside the study area -> 12 of 16, 75 %. */
const PLACE_A = box(-124.99, 41.81, -124.81, 41.99);
/** tile 3: 16 cells, 7 outside (row 8 + column 8) -> 9 of 16, 56.25 %. */
const PLACE_B = box(-124.79, 41.61, -124.61, 41.79);
/** tile 1: 16 cells, all inside -> 16 of 16, 100 % -- a doubled table reads exactly 200 %. */
const PLACE_C = box(-124.79, 41.81, -124.61, 41.99);

// ---- the harness -------------------------------------------------------------------------------

let bindings: NodeDuckdb;

beforeAll(async () => {
  bindings = await instantiateNodeDuckdb();
}, 180_000);

/** a fresh engine + sources, booted exactly as `places/dataEngine.ts` boots them. */
async function freshCtx(): Promise<DataEngineContext> {
  const engine = nodeEngine(bindings, BASE, fixtureFiles());
  const sources = new AnalysisSources(engine, {
    url: (p) => `${BASE}${VER}/${p}`, // what `dataUrl(ver, path)` builds
    boot: BOOT,
    templates: TEMPLATES,
  });
  await sources.coreTables();
  return { engine, sources, grid: gridFromBoot(BOOT) };
}

/** Arrow rows -> plain values, so a solo and a concurrent result compare by value. */
function plain<T>(v: T): T {
  return JSON.parse(
    JSON.stringify(v, (_k, x: unknown) => (typeof x === "bigint" ? Number(x) : x)),
  ) as T;
}

const score = async (ctx: DataEngineContext, g: AreaGeometry) =>
  plain(await computeScoreResults(ctx, BOOT, g));
const species = async (ctx: DataEngineContext, g: AreaGeometry) =>
  plain((await computeSpeciesResults(ctx, g)).rows);
const saCells = async (ctx: DataEngineContext, g: AreaGeometry) =>
  plain(await placeCellsInStudyArea(ctx, g));

const coverageOf = (r: ScoreResults) => r.coverage;

// ---- solo: the ground truth each concurrent run must reproduce ----------------------------------

interface Solo {
  a: ScoreResults;
  b: ScoreResults;
  c: ScoreResults;
  speciesA: Awaited<ReturnType<typeof species>>;
  cellsC: Awaited<ReturnType<typeof saCells>>;
}
let solo: Solo;

describe("usability B1: place analyses on one engine never share state", () => {
  beforeAll(async () => {
    const ctx = await freshCtx();
    solo = {
      a: await score(ctx, PLACE_A),
      b: await score(ctx, PLACE_B),
      c: await score(ctx, PLACE_C),
      speciesA: await species(ctx, PLACE_A),
      cellsC: await saCells(ctx, PLACE_C),
    };
  }, 120_000);

  it("the solo baseline is the fixture's own arithmetic (so the comparison below is not vacuous)", () => {
    expect(coverageOf(solo.a)).toEqual({ nCellsTotal: 16, nCellsStudyArea: 12, coveragePct: 75 });
    expect(coverageOf(solo.b)).toEqual({
      nCellsTotal: 16,
      nCellsStudyArea: 9,
      coveragePct: 56.25,
    });
    expect(coverageOf(solo.c)).toEqual({ nCellsTotal: 16, nCellsStudyArea: 16, coveragePct: 100 });
    // two components each, and three places with three different composites
    for (const r of [solo.a, solo.b, solo.c]) expect(r.components).toHaveLength(2);
    expect(new Set([solo.a.composite, solo.b.composite, solo.c.composite]).size).toBe(3);
    // A (top half) has sp:1 + sp:3, never sp:2 (bottom half)
    expect(solo.speciesA.map((r) => r.mdl_key).sort()).toEqual(["sp:1", "sp:3"]);
    expect(solo.cellsC).toHaveLength(16);
  });

  it("two DIFFERENT places analysed at once each get their own solo result", async () => {
    const ctx = await freshCtx();
    const [a, b] = await Promise.all([score(ctx, PLACE_A), score(ctx, PLACE_B)]);
    expect({ a, b }).toEqual({ a: solo.a, b: solo.b });
  }, 60_000);

  it("the same place analysed twice at once (scores + Show analysis cells) never doubles its cells -- the 200 % symptom", async () => {
    const ctx = await freshCtx();
    const [c, cells] = await Promise.all([score(ctx, PLACE_C), saCells(ctx, PLACE_C)]);
    // stated separately so a red names the symptom the assessor saw, not just "not equal"
    expect(c.coverage.nCellsStudyArea).not.toBe(2 * c.coverage.nCellsTotal);
    expect(c.coverage).toEqual(solo.c.coverage);
    expect(c).toEqual(solo.c);
    expect(cells).toEqual(solo.cellsC);
  }, 60_000);

  it("a place's species list is its own while another place's scores run", async () => {
    const ctx = await freshCtx();
    const [sp, b] = await Promise.all([species(ctx, PLACE_A), score(ctx, PLACE_B)]);
    expect({ sp, b }).toEqual({ sp: solo.speciesA, b: solo.b });
  }, 60_000);

  it("the next upload's study-area check does not leak into an analysis already running", async () => {
    const ctx = await freshCtx();
    const [a, touches] = await Promise.all([
      score(ctx, PLACE_A),
      touchesStudyArea(ctx, { name: "B", geometry: PLACE_B } as Parameters<
        typeof touchesStudyArea
      >[1]),
    ]);
    expect(touches).toBe(true);
    expect(a).toEqual(solo.a);
  }, 60_000);

  it("three places at once, in every role, each still get their solo result", async () => {
    const ctx = await freshCtx();
    const [a, b, c, cells] = await Promise.all([
      score(ctx, PLACE_A),
      score(ctx, PLACE_B),
      score(ctx, PLACE_C),
      saCells(ctx, PLACE_C),
    ]);
    expect({ a, b, c, cells }).toEqual({ a: solo.a, b: solo.b, c: solo.c, cells: solo.cellsC });
  }, 60_000);
});
