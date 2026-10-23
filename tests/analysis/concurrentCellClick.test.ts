// atlas-8 review round 2, item 3a: the scores lens' click popup (`cellClick.ts#fetchCellValue`)
// and the Table panel's single-CELL species path (`speciesLoad.ts#loadSpeciesRowsFor`) used to
// build the shared `cell`/`place_cell`/`place_cell_sa`/`species_agg` objects OUTSIDE
// `exclusive()` -- the same fixed-name objects a place analysis (`places/results.ts`) builds, so
// either one running beside a place analysis on the SAME engine could interleave with it exactly
// like usability B1's 0.10.21 race (`concurrentPlaces.test.ts`). This drives the REAL `Engine` +
// `AnalysisSources` (`nodeEngine.ts`, the same harness) with a cell click AND a species-for-cell
// load running alongside a place analysis, and asserts each gets exactly its solo result.
//
// A separate fixture from `concurrentPlaces.test.ts` on purpose (isolation, not shared setup) --
// same 8x8-grid-in-four-4x4-tiles shape, proven correct there.
import { beforeAll, describe, expect, it } from "vitest";
import { AnalysisSources } from "../../src/lib/analysis/sources";
import { TEMPLATES } from "../../src/lib/analysis/templates";
import { gridFromBoot, tileOf } from "../../src/lib/grid/grid";
import type { AreaGeometry } from "../../src/lib/geo/types";
import type { DataEngineContext } from "../../src/places/dataEngine";
import { computeScoreResults, type ScoreResults } from "../../src/places/results";
import { fetchCellValue } from "../../src/lens/scores/cellClick";
import { loadSpeciesRowsFor } from "../../src/lens/scores/speciesLoad";
import { instantiateNodeDuckdb, nodeEngine, type NodeDuckdb } from "./nodeEngine";

const NC = 8;
const TILE = 4;
const BASE = "https://fixture.test/";
const VER = "vT";
const METRIC = "extrisk_bird_ecoregion_rescaled";

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
  layers: [{ metric_key: METRIC, category: "component" }],
  tables: {},
};

const rowOf = (id: number) => Math.floor((id - 1) / NC) + 1;
const colOf = (id: number) => ((id - 1) % NC) + 1;
const tileOfCell = (id: number) =>
  Math.floor((rowOf(id) - 1) / TILE) * (NC / TILE) + Math.floor((colOf(id) - 1) / TILE);

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
      `cell_id,in_usa,area_km2,${METRIC}`,
      ...mine.map((id) => `${id},${inUsa(id)},${20 + id / 10},${id * 1.5}`),
    ].join("\n");
    files.set(`${VER}/app/cell/tile=${t}/data_0.parquet`, enc(cellCsv));
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

/** tile 3 (bottom-right): 16 cells, 7 outside (row 8 + column 8) -> 9 of 16 in the study area. */
const PLACE_B = box(-124.79, 41.61, -124.61, 41.79);
/** cell 2 (tile 0, row 1 col 2 -- IN the study area, unlike column 1's land strip): bird = 2 * 1.5
 * = 3; species = sp:1 (top half) + sp:3 (everywhere). */
const CLICK_CELL_ID = 2;

let bindings: NodeDuckdb;

beforeAll(async () => {
  bindings = await instantiateNodeDuckdb();
}, 180_000);

async function freshCtx(): Promise<DataEngineContext> {
  const engine = nodeEngine(bindings, BASE, fixtureFiles());
  const sources = new AnalysisSources(engine, {
    url: (p) => `${BASE}${VER}/${p}`,
    boot: BOOT,
    templates: TEMPLATES,
  });
  await sources.coreTables();
  return { engine, sources, grid: gridFromBoot(BOOT) };
}

function plain<T>(v: T): T {
  return JSON.parse(
    JSON.stringify(v, (_k, x: unknown) => (typeof x === "bigint" ? Number(x) : x)),
  ) as T;
}

async function clickCell(ctx: DataEngineContext): Promise<number | null> {
  const grid = gridFromBoot(BOOT);
  const tile = tileOf(CLICK_CELL_ID, grid);
  return fetchCellValue(ctx.sources, { cellId: CLICK_CELL_ID, tile, metricKey: METRIC });
}

async function speciesForClickedCell(ctx: DataEngineContext) {
  return plain(
    await loadSpeciesRowsFor(ctx.sources, BOOT, {
      selection: { kind: "cell", cellId: CLICK_CELL_ID },
      zoneAllKey: "z:all",
    }),
  );
}

const score = async (ctx: DataEngineContext, g: AreaGeometry) =>
  plain(await computeScoreResults(ctx, BOOT, g));

let soloClickValue: number | null;
let soloClickSpecies: Awaited<ReturnType<typeof speciesForClickedCell>>;
let soloB: ScoreResults;

describe("item 3a: a cell click never races a place analysis sharing its engine", () => {
  beforeAll(async () => {
    const ctx = await freshCtx();
    soloClickValue = await clickCell(ctx);
    const ctx2 = await freshCtx();
    soloClickSpecies = await speciesForClickedCell(ctx2);
    const ctx3 = await freshCtx();
    soloB = await score(ctx3, PLACE_B);
  }, 120_000);

  it("the solo baselines are the fixture's own arithmetic (so the comparison below is not vacuous)", () => {
    expect(soloClickValue).toBe(3);
    expect(soloClickSpecies.map((r) => r.mdl_key).sort()).toEqual(["sp:1", "sp:3"]);
    expect(soloB.coverage).toEqual({ nCellsTotal: 16, nCellsStudyArea: 9, coveragePct: 56.25 });
  });

  it("a cell click alongside a place analysis: both get their solo result", async () => {
    const ctx = await freshCtx();
    const [value, b] = await Promise.all([clickCell(ctx), score(ctx, PLACE_B)]);
    expect(value).toBe(soloClickValue);
    expect(b).toEqual(soloB);
  }, 60_000);

  it("the single-cell species path alongside a place analysis: both get their solo result", async () => {
    const ctx = await freshCtx();
    const [sp, b] = await Promise.all([speciesForClickedCell(ctx), score(ctx, PLACE_B)]);
    expect(sp).toEqual(soloClickSpecies);
    expect(b).toEqual(soloB);
  }, 60_000);

  it("a click and the species path together, beside a place analysis: all three get their solo result", async () => {
    const ctx = await freshCtx();
    const [value, sp, b] = await Promise.all([
      clickCell(ctx),
      speciesForClickedCell(ctx),
      score(ctx, PLACE_B),
    ]);
    expect(value).toBe(soloClickValue);
    expect(sp).toEqual(soloClickSpecies);
    expect(b).toEqual(soloB);
  }, 60_000);
});
