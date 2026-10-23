// The review checklist for `sql/*.sql` (atlas-2's "Review checklist (Opus)"), as tests:
//
//   - `value` is absent from every SQL file; metrics are addressed by `metric_key`.
//   - each file's header names its R twin and the fixture that pins it.
//   - every parameter goes through `lit()`; only app-built fragments use the fixed RAW allow-list.
//   - the `cell_model` join is chosen by `boot.id_field`, never hard-coded.
//
// Each one ships with its seeded fault asserted here, so none of them is a check that cannot fail.
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { TEMPLATES } from "../../src/lib/analysis/templates";
import {
  cellModelKeySql,
  componentMetricKeys,
  createPlaceCells,
  METRIC_PATTERN,
  meanScore,
  scoresForCells,
  speciesForZone,
  type ComponentScore,
  type SqlRunner,
} from "../../src/lib/analysis/queries";
import { RAW_ALLOWLIST } from "../../src/lib/engine/sql";

const SQL_DIR = new URL("../../sql/", import.meta.url);
const ALL = readdirSync(SQL_DIR).filter((f) => f.endsWith(".sql"));
// `smoke_count.sql` is the one file in here that is NOT a twin of anything: atlas-2 Step 3's Sonnet
// half shipped it to prove placeholder substitution / lit() escaping end to end against a real
// DuckDB-WASM connection. `cell_value.sql` (atlas-4 fix round 3, the scores click popup) is the
// second: it reads ONE column of the wide `cell` tile for a cell the release's grid already
// resolved, which has no msens twin because the R app read that same value from a COG pixel
// instead (`cog_point_value()`) -- the very thing plan D4 forbids here. (`cell_histogram.sql`, round 3's per-click histogram source, was retired by
// round 4 R4-A: the legend histogram now comes from `/cog/statistics`, display-only, D4.) The
// `value` scan still covers both; the twin-header and placeholder-set rules are about the PORTED queries and would be meaningless against a probe or a UI-only read.
const TWINS = ALL.filter((f) => f !== "smoke_count.sql" && f !== "cell_value.sql");
const FILES = ALL;
const text = (f: string) => readFileSync(new URL(f, SQL_DIR), "utf8");

/** the SQL with every `--` comment line removed, which is what the code rules apply to. */
const code = (sql: string) =>
  sql
    .split("\n")
    .filter((l) => !/^\s*--/.test(l))
    .join("\n");

/** records every statement it is handed and answers nothing -- enough to inspect rendered SQL. */
function recorder(): SqlRunner & { sql: string[] } {
  const sql: string[] = [];
  return {
    sql,
    async exec<T>(s: string): Promise<T[]> {
      sql.push(s);
      return [];
    },
  };
}

// ---- `value` never appears (the source scan) ----------------------------------------------------

/**
 * Find `value` used as an identifier.
 *
 * Two spellings are legitimate and are the reason this is a function rather than a `grep`:
 * `zone_value` is a COLUMN of the published `app/zone_taxon.parquet` contract, and `VALUE` is a
 * DuckDB `UNPIVOT` keyword (`INTO NAME metric_key VALUE v`). Anything else is the v1-v7 measurement
 * column that atlas-1's contract renamed, and a published object or generated SQL that says it is
 * the one thing the review forbids by name.
 */
export function findValueIdentifier(sql: string): string[] {
  const hits: string[] = [];
  const re = /(^|[^_A-Za-z])(value)(?![_A-Za-z])/g;
  for (const m of code(sql).matchAll(re)) {
    const at = m.index! + m[1].length;
    const before = code(sql).slice(Math.max(0, at - 40), at);
    // the UNPIVOT keyword, always written `... NAME <ident> VALUE`
    if (/\bNAME\s+[A-Za-z_][A-Za-z0-9_]*\s+$/.test(before) && m[2] === "value") continue;
    hits.push(
      code(sql)
        .slice(Math.max(0, at - 30), at + 30)
        .replace(/\s+/g, " "),
    );
  }
  return hits;
}

describe("sql/*.sql: `value` never appears", () => {
  it("scans a non-empty set of files", () => {
    expect(FILES.length).toBeGreaterThanOrEqual(9);
  });

  for (const f of FILES) {
    it(`${f} addresses metrics by metric_key, never \`value\``, () => {
      expect(findValueIdentifier(text(f))).toEqual([]);
    });
  }

  it("the scanner is not vacuous: it flags a seeded `value`", () => {
    expect(findValueIdentifier("SELECT cm.value FROM model_cell cm")).toHaveLength(1);
    expect(findValueIdentifier("SELECT sum(value * pct) FROM x")).toHaveLength(1);
  });

  it("allows the two legitimate spellings", () => {
    expect(findValueIdentifier("WHERE zone_value = 'GAA'")).toEqual([]);
    expect(findValueIdentifier("UNPIVOT c ON a, b INTO NAME metric_key VALUE v")).toEqual([]);
  });
});

// ---- every file names its twin and its fixture ---------------------------------------------------

describe("sql/*.sql headers", () => {
  for (const f of TWINS) {
    it(`${f} names its R twin and the fixture that pins it`, () => {
      const head = text(f)
        .split("\n")
        .filter((l) => /^\s*--/.test(l))
        .join("\n");
      expect(head, "no header comment").not.toBe("");
      expect(head).toMatch(/R twin:/);
      expect(head, "the twin must cite a file:line in msens").toMatch(/\bR\/[a-z_]+\.R:\d+/);
      expect(head).toMatch(/Pinned by:/);
    });
  }
});

// ---- placeholders: lit() or the fixed RAW allow-list --------------------------------------------

const placeholdersOf = (sql: string) =>
  [...sql.matchAll(/\{\{([a-zA-Z_]\w*)\}\}/g)].map((m) => m[1]);

describe("sql/*.sql placeholders", () => {
  it("every RAW placeholder is in the fixed allow-list; everything else is a lit() value", () => {
    const raw = new Set(["cols", "from", "predicate"]);
    expect([...RAW_ALLOWLIST].sort()).toEqual([...raw].sort());
    const seen = new Set<string>();
    for (const f of TWINS) for (const p of placeholdersOf(text(f))) seen.add(p);
    // the only names any twin uses: two RAW fragments and three literal parameters
    expect([...seen].sort()).toEqual([
      "cell_id",
      "cols",
      "metric_pattern",
      "zone_fld",
      "zone_value",
    ]);
  });

  it("a header comment never mentions a placeholder by its braces (renderSql is not comment-aware)", () => {
    for (const f of TWINS) {
      const head = text(f)
        .split("\n")
        .filter((l) => /^\s*--/.test(l));
      expect(head.join("\n"), `${f} header`).not.toMatch(/\{\{/);
    }
  });
});

describe("every parameter goes through lit()", () => {
  it("a zone value carrying a quote and a statement terminator is inert", async () => {
    const db = recorder();
    await speciesForZone(db, TEMPLATES, {
      zoneFld: "programarea_key",
      zoneValue: "'; DROP TABLE cell; --",
    });
    const sql = db.sql.join("\n");
    expect(sql).toContain("'''; DROP TABLE cell; --'");
    expect(sql).not.toMatch(/=\s*'';\s*DROP/);
  });

  it("a cell id and the metric pattern are literals, not interpolation", async () => {
    const db = recorder();
    await createPlaceCells(db, [{ cell_id: 12, pct: 50 }]);
    expect(db.sql.join("\n")).toContain("(12, 50)");
    expect(TEMPLATES.scores_for_cells).toContain("{{metric_pattern}}");
    expect(METRIC_PATTERN).toBe("_ecoregion_rescaled$");
  });

  it("a component key that is not a plain identifier is refused, never quoted into place", async () => {
    const db = recorder();
    // ident() throws BEFORE the promise is built, which is the point: a bad column name never
    // reaches a rendered statement at all
    expect(() =>
      scoresForCells(db, TEMPLATES, { metricKeys: ['x"; DROP TABLE cell; --'] }),
    ).toThrow(/not a valid SQL identifier/);
    expect(db.sql).toEqual([]);
  });
});

// ---- the id_field join ---------------------------------------------------------------------------

describe("the cell_model join is chosen by boot.id_field", () => {
  it("v8+ goes through `model` on mdl_id", () => {
    const sql = cellModelKeySql(TEMPLATES, "mdl_key");
    expect(sql).toMatch(/JOIN\s+model\s+mo\s+ON\s+mo\.mdl_id\s*=\s*cm\.mdl_id/);
    expect(code(sql)).not.toMatch(/\bmdl_seq\b/);
  });

  it("v1-v7 reads mdl_seq directly and never mentions mdl_id (v7 has no such column)", () => {
    const sql = code(cellModelKeySql(TEMPLATES, "mdl_seq"));
    expect(sql).toMatch(/cm\.mdl_seq/);
    expect(sql, "a hard-coded mdl_id is the v7 `Binder Error`").not.toMatch(/\bmdl_id\b/);
    expect(sql).not.toMatch(/\bmodel\b/);
  });

  it("both branches publish the same three columns, so the twin above is generation-blind", () => {
    for (const f of ["mdl_key", "mdl_seq"]) {
      const sql = code(cellModelKeySql(TEMPLATES, f));
      expect(sql).toMatch(/cm\.cell_id/);
      expect(sql).toMatch(/cm\.val\b/);
      expect(sql).toMatch(/AS mdl_key/);
    }
  });

  it("an unknown id_field is refused rather than guessed", () => {
    expect(() => cellModelKeySql(TEMPLATES, "mdl_id")).toThrow(/neither 'mdl_key'.*nor 'mdl_seq'/);
    expect(() => cellModelKeySql(TEMPLATES, "")).toThrow();
  });
});

// ---- the two rules the parity harness's RED side exists for --------------------------------------

describe("the blend and the study-area clip are where they are supposed to be", () => {
  it("the clip is `coalesce(in_usa, TRUE)`, in exactly one file", () => {
    expect(code(TEMPLATES.cells_in_study_area)).toMatch(/coalesce\(c\.in_usa,\s*TRUE\)/i);
    const others = FILES.filter((f) => f !== "cells_in_study_area.sql");
    for (const f of others) expect(code(text(f)), f).not.toMatch(/in_usa,\s*TRUE/i);
  });

  it("scores divide by the study-area weight (w_all), not by the present weight (w_present)", () => {
    const sql = code(TEMPLATES.scores_for_cells);
    expect(sql).toMatch(/agg\.num_present\s*\/\s*w\.w_all\s+AS score/);
    // the old, unblended formula must still be RETURNED -- the panel needs it and the parity
    // harness's red side reads it off this very column
    expect(sql).toMatch(/agg\.num_present\s*\/\s*agg\.w_present\s+AS mean_where_present/);
  });

  it("scores and species read the SAME clipped cell set (D7b)", () => {
    expect(code(TEMPLATES.scores_for_cells)).toContain("place_cell_sa");
    expect(code(TEMPLATES.species_for_cells)).toContain("place_cell_sa");
    expect(code(TEMPLATES.cells_in_study_area)).toContain("place_cell");
  });
});

// ---- small pure helpers ---------------------------------------------------------------------------

describe("componentMetricKeys / meanScore", () => {
  it("reads the component layers out of boot, never a constant list", () => {
    const boot = {
      layers: [
        { metric_key: "extrisk_bird", category: "raw" },
        { metric_key: "extrisk_bird_ecoregion_rescaled", category: "component" },
        { metric_key: "score_x", category: "composite" },
        { metric_key: "primprod_ecoregion_rescaled", category: "component" },
      ],
    };
    expect(componentMetricKeys(boot)).toEqual([
      "extrisk_bird_ecoregion_rescaled",
      "primprod_ecoregion_rescaled",
    ]);
    expect(componentMetricKeys({})).toEqual([]);
    expect(componentMetricKeys(null)).toEqual([]);
  });

  it("averages the components that HAVE a score, weighted by `even`", () => {
    const s = (score: number, even = 1) => ({ score, even }) as ComponentScore;
    expect(meanScore([s(10), s(20)])).toBe(15);
    expect(meanScore([s(10), s(20, 3)])).toBe(17.5);
    expect(meanScore([])).toBeNaN();
  });
});
