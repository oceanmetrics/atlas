// atlas-4 step 2 — the flower's title and its three data paths (cell / zone / default), as pure
// transforms into `FlowerComponentInput[]` (src/lib/ui/flowerGeometry.ts). The component-name rule
// (`extrisk_` / `_ecoregion_rescaled` stripped, `_` -> space, `all` dropped) is shared with
// `sql/cell_components.sql`'s own `regexp_replace` chain and `boot.ts`'s zone metrics — this module
// is the ONE place both paths turn a raw key into a component label, so they cannot drift apart.
//
// atlas-4 fix round 2: v8/v9 publish EIGHT `*_ecoregion_rescaled` keys, not seven — a
// `primary_producer` SPECIES category (`extrisk_primary_producer_ecoregion_rescaled`) alongside
// the unrelated `primprod_ecoregion_rescaled` environmental metric (raw satellite productivity,
// not a species score). Verified against the publish pipeline itself
// (`workflows/score_cell_metrics.qmd`: `comp_keys <- c(glue("extrisk_{sp_cats}_ecoregion_rescaled"),
// "primprod_ecoregion_rescaled")`, then `composite = ROUND(AVG(cm.val))` over exactly those keys) —
// BOTH terms genuinely feed the composite as separate, equally-weighted inputs; neither is fake or
// "unscored". The collision is a FLOWER DISPLAY problem only: `categories.ts`'s `SYNONYMS` table
// folds both onto the same `primprod` category slot (it predates v8/v9 publishing both at once —
// see its own comment), and `computeFlowerGeometry()` throws when two inputs resolve to one
// category. `dedupeFlowerComponents()` below is the fix: ONE slot per category, keeping the
// ER-weighted species-category term (comparable to the other six species categories the flower
// already shows) and dropping the bare environmental twin from the FLOWER ONLY — the species table,
// composition treemap and the composite score itself are untouched and keep using both.
import { categoryKeyFor } from "../../lib/ui/categories";
import type { FlowerComponentInput } from "../../lib/ui/flowerGeometry";
import { formatSubject } from "../../lib/format";
import type { ZoneRow } from "./boot";

/** `metric_key` -> component label: `extrisk_bird_ecoregion_rescaled` -> `"bird"`,
 * `primprod_ecoregion_rescaled` -> `"primprod"` (parity doc §7.2 / §13.11, verbatim). */
export function componentLabel(metricKey: string): string {
  return metricKey
    .replace(/^extrisk_/, "")
    .replace(/_ecoregion_rescaled$/, "")
    .replace(/_/g, " ");
}

interface DedupCandidate {
  key: string; // the resolved label
  score: number | null;
  /** true = the ER-weighted species-category term, which wins a category collision. */
  preferred: boolean;
}

export interface DedupResult {
  components: FlowerComponentInput[];
  /** the raw label(s) dropped because they collided with an already-kept category — surfaced so
   * the caller (`FlowerPanel.svelte`) can announce it once rather than silently dropping data. */
  droppedLabels: string[];
}

/**
 * ONE flower slot per resolved category (`categories.ts`'s `categoryKeyFor`), in input order.
 * When two inputs resolve to the SAME category, the `preferred` one wins and the other is
 * reported in `droppedLabels`. An input that resolves to NO known category never collides with
 * anything (several genuinely unrecognized labels is ordinary data, not a caller bug — the same
 * rule `computeFlowerGeometry()` already applied before this fix).
 */
export function dedupeFlowerComponents(candidates: readonly DedupCandidate[]): DedupResult {
  const winnerByCategory = new Map<string, DedupCandidate>();
  for (const c of candidates) {
    const catKey = categoryKeyFor(c.key);
    if (catKey === null) continue;
    const existing = winnerByCategory.get(catKey);
    if (!existing || (c.preferred && !existing.preferred)) winnerByCategory.set(catKey, c);
  }
  const components: FlowerComponentInput[] = [];
  const droppedLabels: string[] = [];
  for (const c of candidates) {
    const catKey = categoryKeyFor(c.key);
    const winner = catKey === null ? null : winnerByCategory.get(catKey);
    if (catKey === null || c === winner) {
      components.push({ key: c.key, score: c.score });
    } else {
      droppedLabels.push(c.key);
    }
  }
  return { components, droppedLabels };
}

/** every `*_ecoregion_rescaled` metric key present in `metrics`, turned into flower inputs, with
 * `component == "all"` dropped (parity doc §7.2: "all dropping `component == 'all'`"), THEN
 * de-duplicated one slot per category (see this module's header). */
function fromMetrics(metrics: Record<string, number>): DedupResult {
  const candidates: DedupCandidate[] = [];
  for (const [rawKey, score] of Object.entries(metrics)) {
    if (!/_ecoregion_rescaled$/.test(rawKey)) continue;
    const label = componentLabel(rawKey);
    if (label === "all") continue;
    candidates.push({
      key: label,
      score: Number.isFinite(score) ? score : null,
      preferred: rawKey.startsWith("extrisk_"),
    });
  }
  return dedupeFlowerComponents(candidates);
}

/** the clicked zone's flower (`boot.zones[unit]`'s row for `key`). `null` when the zone or its
 * metrics are missing — the caller falls back to "no data" rather than an empty flower. */
export function zoneFlowerComponents(zones: readonly ZoneRow[], key: string): DedupResult | null {
  const zone = zones.find((z) => z.key === key);
  return zone ? fromMetrics(zone.metrics) : null;
}

interface FlowerDefaultRow {
  component?: unknown;
  score?: unknown;
}

/** `boot.flower_default[zoneAllKey]` — already `{component, score}` rows (not `metric_key`-shaped
 * like `boot.zones[*].metrics`), so this reads the label directly rather than through
 * `componentLabel()`. The row carries no raw `metric_key`, so the extrisk_/bare distinction is
 * read off the LABEL itself: `componentLabel()` only ever produces the bare literal `"primprod"`
 * for the environmental metric (nothing else strips down to exactly that string), so "this label
 * is anything OTHER than the literal `primprod`" is an equivalent test for "this came from an
 * `extrisk_*` key" — verified against the live v9 `flower_default` shape (`{component:"primary
 * producer",...}` and `{component:"primprod",...}` as two separate rows for the same release).
 * `null` when the release publishes none (e.g. v1, which predates the cache — parity doc §11
 * gotcha 3/§13.12: this file's fallback is the caller's, never invented data). */
export function defaultFlowerComponents(boot: unknown, zoneAllKey: string): DedupResult | null {
  const flowerDefault = (boot as { flower_default?: Record<string, unknown> } | null | undefined)
    ?.flower_default;
  const rows =
    flowerDefault && typeof flowerDefault === "object" ? flowerDefault[zoneAllKey] : undefined;
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const candidates: DedupCandidate[] = [];
  for (const r of rows as FlowerDefaultRow[]) {
    if (!r || typeof r.component !== "string" || r.component === "all") continue;
    const score = typeof r.score === "number" ? r.score : null;
    candidates.push({ key: r.component, score, preferred: r.component !== "primprod" });
  }
  return dedupeFlowerComponents(candidates);
}

/** one `sql/cell_components.sql` row, as returned by the engine. */
export interface CellComponentRow {
  metric_key: string;
  val: unknown;
  component: string;
}

/** the clicked cell's flower — `sql/cell_components.sql`'s rows already carry `component` computed
 * server-side (DuckDB's own `regexp_replace` chain, kept byte-identical to `componentLabel()`
 * above) and `metric_key` itself, so the extrisk_/bare distinction is read directly off it, then
 * de-duplicated the same way as the other two paths. */
export function cellFlowerComponents(rows: readonly CellComponentRow[]): DedupResult {
  const candidates: DedupCandidate[] = [];
  for (const r of rows) {
    if (r.component === "all") continue;
    candidates.push({
      key: r.component,
      score: typeof r.val === "number" && Number.isFinite(r.val) ? r.val : null,
      preferred: r.metric_key.startsWith("extrisk_"),
    });
  }
  return dedupeFlowerComponents(candidates);
}

/**
 * D3(b) (Opus 5.5 eyes-on, 2026-09-24): the Flower panel's own EMPTY-STATE copy, distinct from a
 * genuine query failure. The owner's report: a click on a cell with no value used to read "No
 * flower data is published for this selection in this release" — wording that BLAMES THE DATA for
 * what is really "nothing scored is selected" (the fix at the click site, `state.svelte.ts`'s
 * `showCellPopup`, means this branch is reached mainly by a stale/deep-linked selection pointing at
 * a cell the release genuinely never scored, or by a state that resolves to no components for some
 * other benign reason — never by a plain land click any more). A THROWN error while fetching the
 * clicked cell's components (`ScoresLens.svelte`'s own `cellFlowerToken` effect) is a SEPARATE,
 * distinct condition that must never be confused with "there is simply nothing to show" — see the
 * `errorMessage` branch below, and `tests/lens/scores/flower.test.ts`'s "assert both" pair.
 */
export function flowerEmptyText(errorMessage?: string | null): string {
  if (errorMessage) return `The flower could not be loaded: ${errorMessage}`;
  return "Click a scored cell on the map to see its flower.";
}

/** `flower_panel_title` (parity doc §7.1), now UI-4's one shared subject line: a clicked cell reads
 * "Cell {id} · {lat}° N, {lon}° W"; a clicked zone names itself; nothing selected reads "All US
 * waters" (UI-5 — the SAME no-selection label the Zoom-to-region select already uses, replacing
 * this panel's own "Full study area" wording). `formatSubject()` (`lib/format.ts`) is the ONE place
 * this text is built now — the map popup and the species table header route through it too, so a
 * clicked cell can never read differently across the three panels again. */
export function flowerTitle(
  selection:
    | { kind: "cell"; cellId: number; lon: number; lat: number }
    | { kind: "zone"; name: string }
    | null,
): string {
  return formatSubject(selection);
}
