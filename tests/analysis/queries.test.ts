// atlas-4 fix round 3: `cellValue()` — the scores lens' click popup reads the wide `cell` tile for
// ONE caller-chosen `metric_key` (never a rendered raster pixel, plan D4). `cellComponents()` and
// friends are exercised through `tests/analysis/sqlTwins.test.ts`'s recorder pattern already; this
// file covers the one new query that test does not (it is not a "twin" of any msens function — see
// that file's TWINS exclusion comment).
import { describe, expect, it } from "vitest";
import { cellValue, type SqlRunner } from "../../src/lib/analysis/queries";
import { TEMPLATES } from "../../src/lib/analysis/templates";

/** answers a fixed row set, and records every statement it is handed. */
function fakeDb(rows: Record<string, unknown>[]): SqlRunner & { sql: string[] } {
  const sql: string[] = [];
  return {
    sql,
    async exec<T>(s: string): Promise<T[]> {
      sql.push(s);
      return rows as unknown as T[];
    },
  };
}

describe("cellValue", () => {
  it("renders the requested metric_key as an ident()-validated column, never a lit()-quoted string", async () => {
    const db = fakeDb([{ val: 42 }]);
    const got = await cellValue(db, TEMPLATES, { cellId: 12345, metricKey: "score" });
    expect(got).toBe(42);
    expect(db.sql[0]).toContain('"score" AS val');
    expect(db.sql[0]).toContain("cell_id = 12345");
    expect(db.sql[0]).not.toContain("'score'");
  });

  it("a component (_ecoregion_rescaled) or raw metric_key works the same as the composite", async () => {
    const db = fakeDb([{ val: 17.5 }]);
    const got = await cellValue(db, TEMPLATES, {
      cellId: 1,
      metricKey: "extrisk_bird_ecoregion_rescaled",
    });
    expect(got).toBe(17.5);
  });

  it("no row (off-grid, or the tile is not mounted) -> null, never a throw", async () => {
    const db = fakeDb([]);
    expect(await cellValue(db, TEMPLATES, { cellId: 1, metricKey: "score" })).toBeNull();
  });

  it("a NULL column value -> null, never NaN or a string", async () => {
    const db = fakeDb([{ val: null }]);
    expect(await cellValue(db, TEMPLATES, { cellId: 1, metricKey: "score" })).toBeNull();
  });

  it("a metric_key that is not a plain identifier is refused before any statement is built", () => {
    const db = fakeDb([]);
    expect(() =>
      cellValue(db, TEMPLATES, { cellId: 1, metricKey: 'x"; DROP TABLE cell; --' }),
    ).toThrow(/not a valid SQL identifier/);
    expect(db.sql).toEqual([]);
  });
});
