// analysis/queries.ts -- the thin layer that RUNS the `sql/*.sql` twins (atlas-2 Step 3b).
//
// Deliberately engine-agnostic: everything here talks to a {@link SqlRunner} (one `exec(sql)`
// method) and a {@link Templates} record of the `sql/*.sql` file CONTENTS. `src/lib/analysis/
// sources.ts` supplies the browser's (a real `Engine` over DuckDB-WASM, templates imported with
// `?raw`); `scripts/parity/run.mjs` supplies Node's (the same files read from disk) -- so the parity
// harness exercises this orchestration, not a second copy of it, and only the plumbing below it
// differs. That is the whole reason this module has no import from `engine/engine.ts`.
//
// EVERY value a template substitutes goes through `lit()`; the only RAW fragments are `cols`, which
// is `ident()`-validated column names, and `from`, a `TableStore` ref -- sql.ts's fixed allow-list.
import { combineSpeciesPartials, type SpeciesAgg, type SpeciesPartial } from "./combine";
import type { CellCoverage } from "../geo/coverage";
import { ident, lit, renderSql } from "../engine/sql";

/** the one method the SQL twins need from a database. */
export interface SqlRunner {
  exec<T = Record<string, unknown>>(sql: string): Promise<T[]>;
}

/** the contents of `sql/*.sql`, keyed by basename. */
export interface Templates {
  cells_in_study_area: string;
  scores_for_cells: string;
  species_for_cells: string;
  species_for_zone: string;
  species_shares: string;
  cell_components: string;
  cell_value: string;
  composition: string;
  cell_model_key: string;
  cell_model_seq: string;
}

/**
 * The component-metric regex `msens::scores_for_cells()` defaults to (calc.R:287).
 *
 * The trailing `$` is what excludes the `_prepctareaweighting` intermediate keys -- the very
 * numbers the old, unblended formula computed -- so it is not decoration.
 */
export const METRIC_PATTERN = "_ecoregion_rescaled$";

/** a `boot.json` layer row, as much of it as this module reads. */
interface BootLayer {
  metric_key?: unknown;
  category?: unknown;
}

/**
 * The component `metric_key`s of a release, from `boot.layers` -- never a hard-coded list.
 *
 * atlas-1 publishes `category: "component"` for exactly the keys matching {@link METRIC_PATTERN}
 * (app_bundle.R:428-432), and the set genuinely differs by release: v7 has `extrisk_other`, v9 has
 * `extrisk_primary_producer` instead. Reading it from `boot` is what keeps one build serving both.
 */
export function componentMetricKeys(boot: unknown): string[] {
  const layers = (boot as { layers?: unknown })?.layers;
  if (!Array.isArray(layers)) return [];
  return (layers as BootLayer[])
    .filter((l) => l.category === "component" && typeof l.metric_key === "string")
    .map((l) => l.metric_key as string);
}

/** `metric_key`s, validated as SQL identifiers and joined for a `cols` RAW slot. */
function colsOf(metricKeys: readonly string[]): string {
  if (!metricKeys.length) throw new Error("no component metric_key columns to read");
  return metricKeys.map(ident).join(", ");
}

// ---- the place's cell set ---------------------------------------------------------------------

/** rows are inserted in chunks so one statement never carries a 14,000-row VALUES list. */
const INSERT_CHUNK = 1000;

async function insertRows(
  db: SqlRunner,
  table: string,
  columns: readonly string[],
  rows: readonly (readonly (string | number | boolean | null)[])[],
): Promise<void> {
  const cols = columns.map(ident).join(", ");
  for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
    const chunk = rows.slice(i, i + INSERT_CHUNK);
    const values = chunk.map((r) => `(${r.map((v) => lit(v)).join(", ")})`).join(", ");
    await db.exec(`INSERT INTO ${ident(table)} (${cols}) VALUES ${values};`);
  }
}

/**
 * Materialize a place's `(cell_id, pct_covered)` as the `place_cell` table the SQL twins read.
 *
 * The R twin ships the same pairs as an inline `VALUES` list (calc.R:300-306, 601-604). A table is
 * used here instead for one reason: a Program-Area-sized place is ~14,000 rows and every value goes
 * through `lit()`, so a single statement would be a ~300 KB SQL string parsed inside the WASM
 * worker. Chunked `INSERT`s keep each statement small; the contents are identical.
 */
export async function createPlaceCells(
  db: SqlRunner,
  cells: readonly CellCoverage[],
): Promise<void> {
  await db.exec(
    "CREATE OR REPLACE TABLE place_cell (cell_id INTEGER NOT NULL, pct_covered DOUBLE NOT NULL);",
  );
  await insertRows(
    db,
    "place_cell",
    ["cell_id", "pct_covered"],
    cells.map((c) => [c.cell_id, c.pct]),
  );
}

/**
 * Create `place_cell_sa`, the study-area-clipped cell set (`sql/cells_in_study_area.sql`, D7b).
 *
 * ONE view, created once, read by BOTH `sql/scores_for_cells.sql` and `sql/species_for_cells.sql`:
 * that is D7b's "one cell set per custom place drives scores, species, area and N cells" expressed
 * as plumbing rather than as a convention two call sites have to remember.
 *
 * Requires `place_cell` and the `cell` view (the wide tiles covering those cells) to exist.
 */
export async function createStudyAreaCells(db: SqlRunner, t: Templates): Promise<number> {
  await db.exec(`CREATE OR REPLACE VIEW place_cell_sa AS ${stripTrailing(t.cells_in_study_area)};`);
  const rows = await db.exec<{ n: number }>("SELECT count(*) AS n FROM place_cell_sa;");
  return Number(rows[0]?.n ?? 0);
}

/** a view body must not end in a stray `;` or comment-only tail. */
function stripTrailing(sql: string): string {
  return sql.replace(/;\s*$/, "").trimEnd();
}

/**
 * `species_agg` is a VIEW on the zone path and a TABLE on the cell path, and DuckDB refuses to
 * `CREATE OR REPLACE` across those two types ("Existing object ... is of type View, trying to
 * replace with type Table"). Dropping both shapes first is what lets one session answer a zone and
 * then a place without a stale object deciding which query is legal.
 *
 * `IF EXISTS` is not enough on its own: `DROP VIEW IF EXISTS x` still errors when `x` exists as a
 * TABLE ("trying to drop type View"), so each drop is attempted and its error swallowed. Nothing
 * else in this module swallows an error -- these two, and only these two, are "make sure the name
 * is free", where every failure mode is a name that is already free.
 */
async function dropBoth(db: SqlRunner, name: string): Promise<void> {
  for (const kind of ["VIEW", "TABLE"]) {
    try {
      await db.exec(`DROP ${kind} IF EXISTS ${ident(name)};`);
    } catch {
      /* the name holds the other kind, which the next iteration drops */
    }
  }
}

// ---- scores ------------------------------------------------------------------------------------

export interface ComponentScore {
  metric_key: string;
  score: number;
  component: string;
  even: number;
  coverage: number;
  mean_where_present: number;
  w_present: number;
  w_all: number;
}

/**
 * The blended component scores of the current place -- `sql/scores_for_cells.sql`.
 *
 * Requires `place_cell_sa` and `cell`. Returns one row per component that has a value SOMEWHERE in
 * the place; a component with none gets no row (calc.R:323), which {@link meanScore} then excludes
 * from the composite exactly as `msens::mean_score()` does.
 */
export function scoresForCells(
  db: SqlRunner,
  t: Templates,
  opts: { metricKeys: readonly string[]; metricPattern?: string },
): Promise<ComponentScore[]> {
  return db.exec<ComponentScore>(
    renderSql(
      t.scores_for_cells,
      { metric_pattern: opts.metricPattern ?? METRIC_PATTERN },
      { raw: { cols: colsOf(opts.metricKeys) } },
    ),
  );
}

/**
 * The composite -- `msens::mean_score()` (calc.R:714-716): the `even`-weighted mean of the
 * components that HAVE a score. `NaN` when none does, which is the honest answer for a place with
 * no scored cell (R's `weighted.mean(numeric(0))` is `NaN` too).
 */
export function meanScore(scores: readonly ComponentScore[]): number {
  let num = 0;
  let den = 0;
  for (const s of scores) {
    // Number(), not a bare `s.score`: a DuckDB DOUBLE arrives as a JS number through
    // duckdb-wasm's Arrow result but as a JSON number-or-string through other runners, and a
    // silently-skipped string row would make the composite NaN rather than wrong -- which is how
    // this was found.
    const score = Number(s.score);
    const even = Number(s.even);
    if (!Number.isFinite(score) || !Number.isFinite(even)) continue;
    num += score * even;
    den += even;
  }
  return den === 0 ? NaN : num / den;
}

/** one clicked cell's component values -- `sql/cell_components.sql`. */
export function cellComponents(
  db: SqlRunner,
  t: Templates,
  opts: { cellId: number; metricKeys: readonly string[]; metricPattern?: string },
): Promise<Record<string, unknown>[]> {
  return db.exec(
    renderSql(
      t.cell_components,
      { cell_id: opts.cellId, metric_pattern: opts.metricPattern ?? METRIC_PATTERN },
      { raw: { cols: colsOf(opts.metricKeys) } },
    ),
  );
}

/**
 * One clicked cell's value for ONE caller-chosen `metric_key` -- `sql/cell_value.sql`, the scores
 * click popup's own read (atlas-4 §6.6 fix round 3: "the displayed layer's value", which may be the
 * composite, a component or a raw metric -- {@link cellComponents} only ever reads the component
 * set). `null` when the cell carries no row (off-grid or the tile has not been mounted) or the
 * column is NULL for that cell -- both real answers, never a throw.
 */
export function cellValue(
  db: SqlRunner,
  t: Templates,
  opts: { cellId: number; metricKey: string },
): Promise<number | null> {
  // NOT an `async function`: `ident()` (inside `colsOf`) must throw SYNCHRONOUSLY, before any
  // statement is built or `db.exec` is even called — the same rule `scoresForCells()` above
  // follows, and `tests/analysis/queries.test.ts` pins it the same way `sqlTwins.test.ts` does.
  const sql = renderSql(
    t.cell_value,
    { cell_id: opts.cellId },
    { raw: { cols: colsOf([opts.metricKey]) } },
  );
  return db.exec<{ val: unknown }>(sql).then((rows) => {
    const val = rows[0]?.val;
    return typeof val === "number" && Number.isFinite(val) ? val : null;
  });
}

// ---- species -----------------------------------------------------------------------------------

export interface SpeciesRow extends SpeciesAgg {
  suit_er: number;
  suit_er_area: number;
  cat_suit_er_area: number;
  pct_cat: number;
}

const SPECIES_AGG_COLUMNS = [
  "sp_cat",
  "sp_common",
  "sp_scientific",
  "taxon_id",
  "taxon_authority",
  "er_code",
  "er_score",
  "is_mmpa",
  "is_mbta",
  "mdl_key",
  "area_km2",
  "avg_suit",
] as const;

/** `sql/species_shares.sql` over whatever `species_agg` currently holds (calc.R:569-579). */
async function shares(db: SqlRunner, t: Templates): Promise<SpeciesRow[]> {
  const rows = await db.exec<SpeciesRow>(renderSql(t.species_shares));
  // one view, so `sql/composition.sql` describes the SAME selection as the table beside it
  await db.exec(`CREATE OR REPLACE VIEW species_sel AS ${stripTrailing(t.species_shares)};`);
  return rows;
}

/** the species table of a named zone -- `sql/species_for_zone.sql` then `sql/species_shares.sql`. */
export async function speciesForZone(
  db: SqlRunner,
  t: Templates,
  opts: { zoneFld: string; zoneValue: string },
): Promise<SpeciesRow[]> {
  const sel = renderSql(t.species_for_zone, {
    zone_fld: opts.zoneFld,
    zone_value: opts.zoneValue,
  });
  await dropBoth(db, "species_agg");
  await db.exec(`CREATE VIEW species_agg AS ${stripTrailing(sel)};`);
  return shares(db, t);
}

/**
 * The species table of a place, in BOUNDED MEMORY -- `sql/species_for_cells.sql` per batch of <= 8
 * `cell_model` tiles, combined by `combineSpeciesPartials()`, then `sql/species_shares.sql`.
 *
 * `mount(tiles)` is the caller's "make `cell_model` and `cell_model_key` mean exactly these tiles"
 * -- in the browser it fetches and registers them; in the harness it points a view at the local
 * files. `unmount(tiles)` is called after EVERY batch, including the last and including on the way
 * out of a failure, because dropping the batch's buffers is the entire point of batching.
 */
export async function speciesForCells(
  db: SqlRunner,
  t: Templates,
  opts: {
    batches: readonly (readonly number[])[];
    mount: (tiles: readonly number[]) => Promise<void>;
    unmount?: (tiles: readonly number[]) => Promise<void>;
  },
): Promise<SpeciesRow[]> {
  const partials: SpeciesPartial[][] = [];
  for (const tiles of opts.batches) {
    await opts.mount(tiles);
    try {
      partials.push(await db.exec<SpeciesPartial>(renderSql(t.species_for_cells)));
    } finally {
      await opts.unmount?.(tiles);
    }
  }
  const agg = combineSpeciesPartials(partials);
  await dropBoth(db, "species_agg");
  await db.exec(`CREATE TABLE species_agg (
    sp_cat VARCHAR, sp_common VARCHAR, sp_scientific VARCHAR, taxon_id VARCHAR,
    taxon_authority VARCHAR, er_code VARCHAR, er_score DOUBLE, is_mmpa BOOLEAN,
    is_mbta BOOLEAN, mdl_key VARCHAR, area_km2 DOUBLE, avg_suit DOUBLE);`);
  await insertRows(
    db,
    "species_agg",
    SPECIES_AGG_COLUMNS,
    agg.map((r) => SPECIES_AGG_COLUMNS.map((c) => r[c] as string | number | boolean | null)),
  );
  return shares(db, t);
}

/** the treemap's rows -- `sql/composition.sql` over the current `species_sel`. */
export function composition(db: SqlRunner, t: Templates): Promise<Record<string, unknown>[]> {
  return db.exec(renderSql(t.composition));
}

/** the `cell_model` -> `mdl_key` twin this release needs, by `boot.id_field` (atlas-1's one fact). */
export function cellModelKeySql(t: Templates, idField: string): string {
  if (idField === "mdl_key") return t.cell_model_key;
  if (idField === "mdl_seq") return t.cell_model_seq;
  throw new Error(
    `boot.id_field '${idField}' is neither 'mdl_key' (v8+) nor 'mdl_seq' (v1-v7): the cell_model ` +
      `join cannot be guessed (sql/cell_model_key.sql)`,
  );
}
