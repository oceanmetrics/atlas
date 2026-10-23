// report/format.ts -- the report's display formats, in one place (atlas-7 §5/§6).
//
// Every rule here is the old report's, spelled out: "0 dp except `N cells` (comma)" (§5),
// `scales::comma(accuracy = 1)` on every count (§6a), `scales::percent(er_score, accuracy = 1)` on
// a 0-1 fraction and `comma(round(suit_er_area, 0))` on the Score column (§6b). They are display
// only -- nothing here ever feeds a number back into the model, so a formatting change can never
// move a score (the CSV exporter writes the RAW frame, `src/lens/scores/species.ts#toCsv`).
//
// `en-US` grouping matches `scales::comma()`, which is what the reports being replaced used.

const GROUPED = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

function finite(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/** a count / `N cells`: comma-grouped, 0 dp (`scales::comma(accuracy = 1)`). */
export function formatCount(v: unknown): string {
  return finite(v) ? GROUPED.format(Math.round(v)) : "";
}

/** a score or an area: 0 dp, comma-grouped -- §5's "0 dp except `N cells`" (which is the same
 * rounding; `N cells` is called out only because it is an integer already). */
export function formatScore0(v: unknown): string {
  return finite(v) ? GROUPED.format(Math.round(v)) : "";
}

/** `er_score`, a 0-1 FRACTION, as an integer percent (`scales::percent(accuracy = 1)`). */
export function formatErScore(v: unknown): string {
  return finite(v) ? `${Math.round(v * 100)}%` : "";
}

/** a coverage FRACTION (0-1) as a percent with up to 1 dp, ROUNDED (not for an "over X%" claim --
 * see {@link formatCoveragePctFloor} for that). Whole percents print without a decimal. */
export function formatCoveragePct(v: unknown): string {
  if (!finite(v)) return "";
  const pct = v * 100;
  const r = Math.round(pct * 10) / 10;
  return Number.isInteger(r) ? `${r}%` : `${r.toFixed(1)}%`;
}

/**
 * A coverage fraction as a percent, FLOORED to 1 dp -- fix round 2, item 4: the footnote's
 * "scored over X% of the place" is a claim that coverage EXCEEDS X, and `Math.round()` can make
 * that claim false (0.998740 rounds to "99.9%", which the place's actual 99.874% coverage does
 * NOT exceed). Flooring instead means "over {this}%" is always true, never a rounding artifact.
 * A whole percent still prints without a decimal.
 */
export function formatCoveragePctFloor(v: unknown): string {
  if (!finite(v)) return "";
  const pct = v * 100;
  const r = Math.floor(pct * 10) / 10;
  return Number.isInteger(r) ? `${r}%` : `${r.toFixed(1)}%`;
}

/** R's `round(x, 1)` on the map's fill value (report.qmd:152: `score = round(mean_score(...), 1)`).
 * R rounds half to EVEN; JS `Math.round` rounds half UP. The difference only ever shows on an exact
 * .x5, and the value it decides is a MAP COLOR, never a reported number -- but it is spelled
 * explicitly here rather than left to whichever `Math.round` a reader assumes. */
export function round1HalfEven(v: number): number {
  const scaled = v * 10;
  const floor = Math.floor(scaled);
  const diff = scaled - floor;
  let n: number;
  if (diff > 0.5) n = floor + 1;
  else if (diff < 0.5) n = floor;
  else n = floor % 2 === 0 ? floor : floor + 1;
  return n / 10;
}

/** an ISO-8601 instant, for the provenance block and the permalink. */
export function isoInstant(now: Date): string {
  return now.toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** the header's human-readable generation stamp: `2026-09-22 18:04 UTC` (the old report's
 * `"YYYY-MM-DD HH:mm"`, with the zone stated because a browser's is not the server's). */
export function utcStamp(now: Date): string {
  const iso = now.toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

/** sentence-cases a source common name for DISPLAY only (P round V5 fix, Opus eyes-on desktop-15:
 * "lowercase 'great hammerhead shark' and 'sicklefin devil ray'" in the Top-20 table) -- first
 * letter up, the rest untouched (never a per-word title-case, which would wrongly capitalize
 * "hammerhead"/"shark"/"devil"/"ray"). `sp_common` itself, and every href built from `mdl_key`,
 * stay the release's raw string; only the rendered table cell goes through this. */
export function formatCommonName(name: string): string {
  const trimmed = name.trim();
  return trimmed ? trimmed[0].toUpperCase() + trimmed.slice(1) : trimmed;
}

/** `MarineSensitivity_{slug}_{ver}_{YYYY-MM-DD}` -- the export file stem (atlas-7 export 2). */
export function slugify(s: string): string {
  return (
    s
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "report"
  );
}
