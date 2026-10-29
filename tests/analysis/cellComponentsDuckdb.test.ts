// `sql/cell_components.sql` EXECUTED (not just rendered) by a real DuckDB -- v10 P6: the component-name
// strip takes the national scope's suffixes, and UNPIVOT INCLUDE NULLS + `include_null_rows` keep a
// component a cell has no value for ONLY when asked (the national flower's hollow slot), leaving every
// v1-v9 call's rows unchanged. The vitest harness has no in-process DuckDB (duckdb-wasm needs a browser
// worker, `npm run e2e:engine`), so this drives the `duckdb` CLI when it is on the PATH and is skipped
// where it is not (CI): a local gate, not a CI one.
import { execFileSync, spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { TEMPLATES } from "../../src/lib/analysis/templates";
import { COMPONENT_SQL_PATTERN } from "../../src/lib/analysis/scope";
import { METRIC_PATTERN } from "../../src/lib/analysis/queries";
import { ident, renderSql } from "../../src/lib/engine/sql";

const HAS_DUCKDB = spawnSync("duckdb", ["--version"]).status === 0;

const FIXTURE = `CREATE TABLE cell AS SELECT 7 AS cell_id, 25.0 AS area_km2, TRUE AS in_usa, TRUE AS in_pra,
  NULL::DOUBLE AS extrisk_turtle_v10_global, 210.0 AS extrisk_bird_v10_global,
  12.0 AS extrisk_bird_ecoregion_rescaled, NULL::DOUBLE AS extrisk_turtle_ecoregion_rescaled;`;

function run(cols: string[], pattern: string, includeNulls: boolean) {
  const sql = renderSql(
    TEMPLATES.cell_components,
    { cell_id: 7, metric_pattern: pattern, include_null_rows: includeNulls },
    { raw: { cols: cols.map(ident).join(", ") } },
  );
  const out = execFileSync("duckdb", ["-json", "-c", `${FIXTURE}\n${sql}`], { encoding: "utf8" });
  return (JSON.parse(out) as { metric_key: string; val: number | null; component: string }[]).map(
    (r) => [r.metric_key, r.val, r.component],
  );
}

describe.skipIf(!HAS_DUCKDB)("cell_components.sql on DuckDB", () => {
  const NATION = ["extrisk_bird_v10_global", "extrisk_turtle_v10_global"];
  const ECO = ["extrisk_bird_ecoregion_rescaled", "extrisk_turtle_ecoregion_rescaled"];

  it("national: the suffix strip names the component, and a NULL component is a row when asked", () => {
    expect(run(NATION, COMPONENT_SQL_PATTERN.nation, true)).toEqual([
      ["extrisk_bird_v10_global", 210, "bird"],
      ["extrisk_turtle_v10_global", null, "turtle"],
    ]);
  });

  it("national without include_null_rows: the NULL component is not a row", () => {
    expect(run(NATION, COMPONENT_SQL_PATTERN.nation, false)).toEqual([
      ["extrisk_bird_v10_global", 210, "bird"],
    ]);
  });

  it("ecoregion (v1-v9): unchanged -- the same strip, a NULL component still not a row", () => {
    expect(run(ECO, METRIC_PATTERN, false)).toEqual([
      ["extrisk_bird_ecoregion_rescaled", 12, "bird"],
    ]);
  });

  it("the nation pattern leaves the other scope's columns out", () => {
    expect(run([...NATION, ...ECO], COMPONENT_SQL_PATTERN.nation, true).map((r) => r[0])).toEqual([
      "extrisk_bird_v10_global",
      "extrisk_turtle_v10_global",
    ]);
  });
});
