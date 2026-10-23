// report/scores.ts -- the Table of Scores (atlas-7 §5) and D7b's coverage footnotes.
//
// R twin: report.qmd:326-349 -- one row per place in SUBMISSION ORDER (no sorting, no row limit),
// columns `Area | N cells | <one per component> | Overall`, everything 0 dp except `N cells`
// (comma), and `Overall = msens::mean_score(scores)` = `weighted.mean(score, even)` with every
// `even == 1`, i.e. THE PLAIN MEAN OF THE COMPONENTS PRESENT (msens/R/calc.R:714-716).
//
// A component with no value anywhere in a place gets NO ROW from `sql/scores_for_cells.sql`
// (calc.R:323) -- so it is absent from the mean, not a zero in it. That is why `overall` divides by
// the number of components PRESENT and why the column exists for a place that has no value for it:
// the table's columns are the union over the report's places, the cell is blank, and the place's
// own Overall never saw it.
//
// THE FOOTNOTES ARE D7b, NOT DECORATION (master plan D7b: "the report states the share of each
// place inside the study area, and the Table of Scores footnotes any component whose coverage is
// below 100 % with its coverage and mean where present"). `score = coverage * mean_where_present`
// is an identity of the blend (sql/scores_for_cells.sql's header), so "17.7" on a component
// covering 1.4 % of the place means 17.7 blended over the whole place from a mean of 1,255 where it
// exists. Printing 17.7 with no footnote implies 17.7 everywhere. The old report printed exactly
// that, for every component, on every area.
//
// P4 (Ben, phone, "Report" tool -- "these Report table foot notes seem completely duplicative and
// unhelpful"): the ORIGINAL rule footnoted anything short of ~100.0000000 % coverage, which in
// practice is every component of every place (float coverage is essentially never exactly 1) --
// eight near-identical footnotes restating each cell's own value, one per component, on a single
// area. TWO changes, both deliberate:
//  1. The FLOOR moved from "~100 %" to 99 % (`COVERAGE_FOOTNOTE_FLOOR_PCT`, compared against the
//     SAME `formatCoveragePctFloor()` value the sentence prints -- 99.0 % and above never
//     footnotes, 88.3 % does), so a genuinely-complete-enough component stops earning a marker.
//  2. Footnotes are GROUPED ONE PER PLACE (never one per (place, component) pair): every component
//     below the floor, and every component ABSENT (a null cell, shown as "--" -- today that always
//     means the workflow's own `score_zone_metrics` coverage floor deleted its `_ecoregion_rescaled`
//     row rather than publishing a zero, `model.ts#zoneComponents`'s own header), joins ONE sentence
//     per place, comma-separated, and every triggering cell in that row shares the SAME single
//     footnote id.
import { formatCoveragePctFloor, formatScore0 } from "./format";

/** a component score as the engine returns it (`sql/scores_for_cells.sql`), widened so a ZONE
 * place -- whose numbers come from published `zone_metric` rows, which carry no coverage of their
 * own -- can supply `null` rather than a fabricated 1. */
export interface ReportComponent {
  metric_key: string;
  /** `flower.ts#componentLabel()`'s label: `bird`, `primary producer`, `primprod`. */
  component: string;
  score: number;
  /** always 1 -- msens' `even` (equal weights), carried so `overall` is visibly a weighted mean
   * whose weights happen to be equal, not a mean that forgot them. */
  even: number;
  /** `w_present / w_all`, a 0-1 FRACTION; `null` when the source cannot say. */
  coverage: number | null;
  /** the mean over just the cells that carry the component; `null` with `coverage`. */
  mean_where_present: number | null;
}

/** `msens::mean_score()`: `weighted.mean(score, even, na.rm = TRUE)` over the components PRESENT.
 * `null` (R's `NaN`) when none is -- the honest answer for a place with no scored cell. */
export function overallScore(components: readonly ReportComponent[]): number | null {
  let num = 0;
  let den = 0;
  for (const c of components) {
    const score = Number(c.score);
    const even = Number(c.even);
    if (!Number.isFinite(score) || !Number.isFinite(even)) continue;
    num += score * even;
    den += even;
  }
  return den === 0 ? null : num / den;
}

/** the component columns of the whole table: every label any place scored, first-seen order (so a
 * one-place report keeps `sql/scores_for_cells.sql`'s own `ORDER BY metric_key`). */
export function componentColumns(
  places: readonly { components: readonly ReportComponent[] }[],
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of places) {
    for (const c of p.components) {
      if (seen.has(c.component)) continue;
      seen.add(c.component);
      out.push(c.component);
    }
  }
  return out;
}

export interface ScoresTableFootnote {
  /** 1-based, in the order the places carrying one are first referenced. */
  id: number;
  place: string;
  /** every component this place's footnote covers (below-floor and absent alike), in table-column
   * order -- P4: ONE footnote per place, not one per (place, component) pair. */
  components: string[];
  /** the sentence a renderer prints under the table. */
  text: string;
}

export interface ScoresTableCell {
  component: string;
  score: number | null;
  /** the footnote ids attached to this cell (0 or 1 today). */
  footnotes: number[];
}

export interface ScoresTableRow {
  name: string;
  areaKm2: number | null;
  nCells: number | null;
  cells: ScoresTableCell[];
  overall: number | null;
}

export interface ScoresTable {
  /** the component labels, in column order (between `N cells` and `Overall`). */
  components: string[];
  rows: ScoresTableRow[];
  footnotes: ScoresTableFootnote[];
  /** the accessibility gate's text equivalent for the whole table. */
  summary: string;
  /** the static method narrative (fix round 2, item 1 -- spec §2.6, verbatim). */
  narrative: string;
}

// fix round 2, item 1 (spec §2.6, verbatim).
const TABLE_NARRATIVE =
  "Mean component and overall sensitivity scores per area of interest, with the count of " +
  "raster cells (N cells) included in the analysis. Component scores are ecoregionally " +
  "rescaled (0–100) averages across all cells in each area.";

/** coverage is a 0-1 fraction; the floor a component's coverage must clear to escape a footnote
 * (P4: was "anything short of ~100 %", which footnoted nearly every component of nearly every
 * place -- see this module's own header). Compared against the FLOORED, 1-dp percent the footnote
 * sentence itself prints (`formatCoveragePctFloor`), so "99.0 %" is the exact boundary: 99.0 % and
 * above never footnotes, 98.9 % (and 88.3 %) does. */
const COVERAGE_FOOTNOTE_FLOOR_PCT = 99;

/** the workflow's own wording for an absent component (P4): a Program-Area component whose scored
 * cells cover less than the workflow's 5 % coverage floor has its `_ecoregion_rescaled` row
 * DELETED, never zeroed (`model.ts#zoneComponents`'s own header) -- so a null cell here always
 * means exactly this, and the note says so instead of leaving the "--" unexplained. */
function absentClause(component: string): string {
  return `${component} not scored (coverage below the 5% floor)`;
}

export interface ScoresTablePlace {
  name: string;
  areaKm2: number | null;
  nCells: number | null;
  components: readonly ReportComponent[];
  overall: number | null;
}

/**
 * The table, in the places' own order, with ONE footnote per place (P4 -- see this module's own
 * header): every component below {@link COVERAGE_FOOTNOTE_FLOOR_PCT}, and every component ABSENT
 * (a null cell), joins one comma-separated sentence, and every triggering cell in that row carries
 * the SAME footnote id. A place with nothing to note gets no footnote at all -- no markers, no list
 * entry.
 *
 * A component whose `coverage` is `null` (present, but the release published no
 * `_prepctareaweighting` twin) gets NO marker: "we cannot say" is not "it is complete" -- see
 * `model.ts#zoneComponents`.
 */
export function scoresTable(places: readonly ScoresTablePlace[]): ScoresTable {
  const components = componentColumns(places);
  const footnotes: ScoresTableFootnote[] = [];
  const rows: ScoresTableRow[] = places.map((p) => {
    const byLabel = new Map(p.components.map((c) => [c.component, c]));
    const clauses: string[] = [];
    const triggered = new Set<string>();

    const cells: ScoresTableCell[] = components.map((component) => {
      const c = byLabel.get(component);
      if (!c) {
        clauses.push(absentClause(component));
        triggered.add(component);
        return { component, score: null, footnotes: [] };
      }
      const flooredPct =
        c.coverage !== null && Number.isFinite(c.coverage) ? floorPct(c.coverage) : null;
      if (flooredPct !== null && flooredPct < COVERAGE_FOOTNOTE_FLOOR_PCT) {
        let clause = `${component} scored over ${formatCoveragePctFloor(c.coverage as number)} of the area`;
        if (c.mean_where_present !== null && Number.isFinite(c.mean_where_present)) {
          const meanRounded = formatScore0(c.mean_where_present);
          // "mean X where scored" is appended ONLY when it says something the cell's own displayed
          // value does not already -- never a redundant restatement of the same rounded number.
          if (meanRounded !== formatScore0(c.score)) clause += `, mean ${meanRounded} where scored`;
        }
        clauses.push(clause);
        triggered.add(component);
      }
      return { component, score: c.score, footnotes: [] };
    });

    if (clauses.length > 0) {
      const id = footnotes.length + 1;
      footnotes.push({
        id,
        place: p.name,
        components: [...triggered],
        text: `${p.name}: ${clauses.join(", ")}.`,
      });
      for (const cell of cells) if (triggered.has(cell.component)) cell.footnotes = [id];
    }

    return { name: p.name, areaKm2: p.areaKm2, nCells: p.nCells, cells, overall: p.overall };
  });

  return {
    components,
    rows,
    footnotes,
    summary: describeScoresTable(rows),
    narrative: TABLE_NARRATIVE,
  };
}

/** the SAME floor `formatCoveragePctFloor()` renders (`floor(pct * 10) / 10`), as a bare number for
 * the threshold comparison -- one floor rule, never a second one that could drift from the sentence
 * the reader actually sees. */
function floorPct(coverage: number): number {
  return Math.floor(coverage * 1000) / 10;
}

/** SC 1.1.1: the table's own text equivalent -- one sentence per place naming its Overall. */
export function describeScoresTable(rows: readonly ScoresTableRow[]): string {
  if (rows.length === 0) return "Table of scores: no places.";
  const parts = rows.map(
    (r) => `${r.name} ${r.overall === null ? "no data" : formatScore0(r.overall)}`,
  );
  return (
    `Table of scores, ${rows.length} place${rows.length === 1 ? "" : "s"}, overall score: ` +
    `${parts.join("; ")}.`
  );
}
