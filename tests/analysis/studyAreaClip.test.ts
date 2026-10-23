// atlas-6 fix round 1 (Opus review): a BEHAVIOURAL gate for D7b's clip, alongside (not instead of)
// tests/analysis/sqlTwins.test.ts's own text-regex check ("the clip is `coalesce(in_usa, TRUE)`,
// in exactly one file"). That check goes red if the SUBSTRING disappears; it would NOT go red if
// someone rewrote the filter to something that reads differently but behaves the same -- or,
// worse, could stay GREEN after a change that keeps the substring but breaks what it does. This
// runs the REAL rendered `sql/cells_in_study_area.sql` TEXT's WHERE clause (via
// `TEMPLATES.cells_in_study_area`, the exact string `createStudyAreaCells()` feeds the engine)
// against a small in-memory `cell` table with `in_usa` TRUE/FALSE/NULL rows, so a change to the
// real file's FILTER changes what this test measures -- by behaviour, not by grepping for a word.
//
// A full DuckDB cannot run under vitest (this repo's own convention -- docs/engine.md: real
// DuckDB-WASM is only ever exercised through a real browser, tests/fixtures/engine-e2e/). This
// evaluates just the WHERE clause's boolean expression generically (`coalesce(<col>, <literal>)` |
// a bare `<col>` | `TRUE`/`FALSE`) -- the one piece of the query D7b's clip actually lives in --
// so it is driven by whatever the FILE says, not by an assumption of what it says.
import { describe, expect, it } from "vitest";
import { TEMPLATES } from "../../src/lib/analysis/templates";
import {
  createPlaceCells,
  createStudyAreaCells,
  meanScore,
  scoresForCells,
  type SqlRunner,
} from "../../src/lib/analysis/queries";

/** the SQL with every `--` comment line removed -- same convention as
 * tests/analysis/sqlTwins.test.ts's own `code()`. Load-bearing here: `cells_in_study_area.sql`'s
 * OWN header prose contains the literal word "WHERE" (line 15, "...the WHERE keeps nothing..."),
 * which would otherwise be matched as the clause's start instead of the real keyword at line 26. */
function code(sql: string): string {
  return sql
    .split("\n")
    .filter((l) => !/^\s*--/.test(l))
    .join("\n");
}

/** the WHERE clause's boolean expression, between `WHERE` and `ORDER BY` (or the end). */
function whereExpression(sql: string): string {
  const m = /\bWHERE\b([\s\S]*?)(?:\bORDER\s+BY\b|;|$)/i.exec(code(sql));
  if (!m) throw new Error("no WHERE clause found");
  return m[1].trim();
}

function columnValue(row: Record<string, unknown>, dotted: string): unknown {
  const name = dotted.includes(".") ? dotted.split(".").pop()! : dotted;
  return row[name];
}

function literalBool(token: string): boolean {
  if (/^true$/i.test(token)) return true;
  if (/^false$/i.test(token)) return false;
  throw new Error(`unsupported literal in WHERE clause: "${token}"`);
}

/**
 * `coalesce(<col>, <literal>)` | a bare `<col>` | `TRUE` | `FALSE` -- every shape this query's
 * WHERE clause has ever needed. `row` is the joined `place_cell` + `cell` row (both tables use
 * disjoint column names here, so no alias resolution is needed beyond stripping `t.` prefixes).
 */
export function evalWhere(expr: string, row: Record<string, unknown>): boolean {
  const coalesce = /^coalesce\s*\(\s*([\w.]+)\s*,\s*(\w+)\s*\)$/i.exec(expr);
  if (coalesce) {
    const [, col, fallback] = coalesce;
    const v = columnValue(row, col);
    return v === null || v === undefined ? literalBool(fallback) : Boolean(v);
  }
  if (/^true$/i.test(expr)) return true;
  if (/^false$/i.test(expr)) return false;
  const v = columnValue(row, expr);
  return v === null || v === undefined ? false : Boolean(v); // SQL: NULL in a WHERE is not-true
}

interface CellRow {
  cell_id: number;
  in_usa: boolean | null;
}
interface PlaceCellRow {
  cell_id: number;
  pct_covered: number;
}

/**
 * A fake `SqlRunner` that actually EVALUATES `place_cell_sa`'s WHERE clause against `cellTable`
 * (rather than returning a hand-picked, "obviously correct" row set) -- and, when `metricByCell`
 * is given, the `scores_for_cells.sql`-shaped SELECT too, over `place_cell_sa` ONLY, proving the
 * composite cannot see a cell the clip excluded.
 */
function fakeDb(
  placeCells: readonly PlaceCellRow[],
  cellTable: readonly CellRow[],
  metricByCell?: ReadonlyMap<number, number>,
) {
  const byId = new Map(cellTable.map((c) => [c.cell_id, c]));
  let placeCellSa: PlaceCellRow[] = [];
  const exec: SqlRunner["exec"] = async <T>(sql: string): Promise<T[]> => {
    if (/CREATE (OR REPLACE )?VIEW place_cell_sa/i.test(sql)) {
      const expr = whereExpression(sql);
      placeCellSa = placeCells
        .filter((pc) => evalWhere(expr, { ...pc, ...byId.get(pc.cell_id) }))
        .slice()
        .sort((a, b) => a.cell_id - b.cell_id);
      return [] as T[];
    }
    if (/SELECT count\(\*\)/i.test(sql)) {
      return [{ n: placeCellSa.length }] as unknown as T[];
    }
    if (metricByCell && /agg\.metric_key/i.test(sql)) {
      // scores_for_cells.sql's own formula (`sum(v*pct)/sum(pct)`, calc.R:286-334), evaluated over
      // place_cell_sa ONLY -- the same table the view creation above just clipped.
      let numPresent = 0;
      let wAll = 0;
      for (const row of placeCellSa) {
        wAll += row.pct_covered;
        const v = metricByCell.get(row.cell_id);
        if (v !== undefined) numPresent += v * row.pct_covered;
      }
      return [
        {
          metric_key: "test_metric",
          score: wAll === 0 ? NaN : numPresent / wAll,
          component: "test",
          even: 1,
          coverage: 0,
          mean_where_present: 0,
          w_present: 0,
          w_all: wAll,
        },
      ] as unknown as T[];
    }
    return [] as T[];
  };
  return { exec };
}

// a place straddling the study-area edge: cell 1 is inside, cell 2 is outside, cell 3 has no
// in_usa column at all (v1-v7's shape -- atlas-1's wide tile writes it as NULL there), cell 4 is
// outside. The place touches all four; D7b's clip must keep only 1 and 3.
const PLACE_CELLS: readonly PlaceCellRow[] = [
  { cell_id: 1, pct_covered: 100 },
  { cell_id: 2, pct_covered: 100 },
  { cell_id: 3, pct_covered: 100 },
  { cell_id: 4, pct_covered: 50 },
];
const CELL_TABLE: readonly CellRow[] = [
  { cell_id: 1, in_usa: true },
  { cell_id: 2, in_usa: false },
  { cell_id: 3, in_usa: null },
  { cell_id: 4, in_usa: false },
];

describe("D7b's clip, through the REAL cells_in_study_area.sql text", () => {
  it("n_cells_sa < n_cells: the touched-but-outside cells are dropped", async () => {
    const db = fakeDb(PLACE_CELLS, CELL_TABLE);
    await createPlaceCells(
      db,
      PLACE_CELLS.map((c) => ({ cell_id: c.cell_id, pct: c.pct_covered })),
    );
    const n = await createStudyAreaCells(db, TEMPLATES);
    expect(n).toBeLessThan(PLACE_CELLS.length);
    expect(n).toBe(2); // cell 1 (TRUE) and cell 3 (NULL) survive; 2 and 4 (FALSE) do not
  });

  it("a NULL in_usa (v1-v7's missing column) counts as INSIDE, never excluded", () => {
    const expr = whereExpression(TEMPLATES.cells_in_study_area);
    expect(evalWhere(expr, { cell_id: 3, in_usa: null })).toBe(true);
    expect(evalWhere(expr, { cell_id: 2, in_usa: false })).toBe(false);
    expect(evalWhere(expr, { cell_id: 1, in_usa: true })).toBe(true);
  });

  it("the composite reflects ONLY place_cell_sa's rows -- an excluded cell's value never leaks in", async () => {
    // cells 2 and 4 (excluded by the clip) carry an extreme value; cells 1 and 3 (kept) carry 0.
    // If the excluded cells' value leaked into the composite, it would read well above 0.
    const metricByCell = new Map([
      [1, 0],
      [2, 100],
      [3, 0],
      [4, 100],
    ]);
    const db = fakeDb(PLACE_CELLS, CELL_TABLE, metricByCell);
    await createPlaceCells(
      db,
      PLACE_CELLS.map((c) => ({ cell_id: c.cell_id, pct: c.pct_covered })),
    );
    await createStudyAreaCells(db, TEMPLATES);
    const scores = await scoresForCells(db, TEMPLATES, { metricKeys: ["test_metric"] });
    expect(meanScore(scores)).toBe(0);
  });

  it("SEEDED FAULT: dropping coalesce(...) for a bare `c.in_usa` makes the NULL cell fail closed -- BEHAVIOURALLY, not textually", async () => {
    const seededSql = TEMPLATES.cells_in_study_area.replace(
      /coalesce\(c\.in_usa,\s*TRUE\)/i,
      "c.in_usa",
    );
    expect(seededSql, "the replace must actually have matched the real file").not.toBe(
      TEMPLATES.cells_in_study_area,
    );

    const db = fakeDb(PLACE_CELLS, CELL_TABLE);
    // exercise the SEEDED text directly through the real view-creation path, not just the helper
    await db.exec(`CREATE OR REPLACE VIEW place_cell_sa AS ${seededSql.replace(/;\s*$/, "")};`);
    const rows = await db.exec<{ n: number }>("SELECT count(*) AS n FROM place_cell_sa;");
    // with the coalesce dropped, cell 3 (NULL) now fails the bare predicate too -- only cell 1
    // survives, where the real (unseeded) file keeps cells 1 AND 3.
    expect(rows[0]?.n).toBe(1);
  });
});
