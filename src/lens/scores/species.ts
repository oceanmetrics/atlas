// atlas-4 step 2 — the species table's header/filename text (parity doc §7.3), display formats
// (§7.4/7.5) and its two link rules (taxon -> BOTW/WoRMS, model -> the species lens IN PLACE). Pure
// string/number transforms only; the SQL rows themselves come from `src/lib/analysis/queries.ts`
// (`speciesForZone`/`speciesForCells`), already built by atlas-2/atlas-5's shared engine layer.
import { formatSel } from "../../lib/state/codec";
import { defaultOut, type Sel } from "../../lib/state/types";
import { signif3 } from "../../lib/geo/round";
import { formatSubject } from "../../lib/format";
import type { ScoresSelection } from "./selection";

/** the release's one drawable unit's singular display name, for the species header (parity doc
 * §7.3's literal "Program Area" — generalized here to `planarea`'s "Planning Area" (D17's other
 * possible unit) and to any future unit via its own `boot.units[0].label`, singularized). */
const UNIT_SINGULAR: Readonly<Record<string, string>> = {
  programarea: "Program Area",
  planarea: "Planning Area",
};

export function unitSingularLabel(unit: string, unitLabel: string | null): string {
  return UNIT_SINGULAR[unit] ?? (unitLabel ? unitLabel.replace(/s$/, "") : unit);
}

export interface SpeciesContext {
  selection: ScoresSelection;
  /** the zone's display name, when `selection.kind === "zone"`. */
  zoneName?: string;
  /** the release's one drawable unit's type (`"programarea"`/`"planarea"`/…). */
  unit: string;
  unitLabel: string | null;
  zoneAllKey: string;
  /** the clicked cell's own centre (`cellRing()`), when `selection.kind === "cell"` — `ScoresSelection`
   * itself carries only the bare cell id, so the caller (`TablePanel.svelte`) passes the SAME
   * `cellCoords` `FlowerPanel` already receives, so `formatSubject()` below can print the cell's
   * coordinates (UI-4) rather than the id alone. `undefined` degrades to the id-only form — a
   * caller that has not wired coords through yet still gets a correct, if shorter, subject. */
  cellCoords?: { lon: number; lat: number };
}

/** `spp_tbl_hdr` (parity doc §7.3) — UI-4's fix: "Species in {subject}" for EVERY state (a clicked
 * cell, a clicked zone, or nothing selected), where `{subject}` is the SAME `formatSubject()` line
 * the map popup and the flower panel print, so the SAME cell can never read three different ways
 * across the three panels again. Replaces the old three bespoke spellings ("Species for Cell ID:
 * …", "Species for Program Area: …", "Species in Full study area"). */
export function speciesHeader(ctx: SpeciesContext): string {
  if (ctx.selection?.kind === "cell") {
    const subject = ctx.cellCoords
      ? formatSubject({ kind: "cell", cellId: ctx.selection.cellId, ...ctx.cellCoords })
      : `Cell ${ctx.selection.cellId}`;
    return `Species in ${subject}`;
  }
  if (ctx.selection?.kind === "zone") {
    return `Species in ${ctx.zoneName ?? ctx.selection.key}`;
  }
  return "Species in All US waters";
}

/** R3-W8 item 5: "the Table's subject line uses the same rule and says so" -- when a non-empty
 * EXPLICIT Places list governs (`reportSubjects()`, `src/lib/state/subjects.ts`), the species
 * table's own header names the LIST, not a single cell/zone ("Species for 2 places" rather than
 * whichever place happens to be last clicked). Pulled out as its own pure function (CLAUDE.md:
 * "keep core logic in an exported function... callable from a test") rather than an inline
 * template string in `TablePanel.svelte`. */
export function placesSubjectHeader(placeCount: number): string {
  return `Species for ${placeCount} place${placeCount === 1 ? "" : "s"}`;
}

/**
 * The CSV/download filename STEM (parity doc §7.3). The zone stem's "lowercased name with first
 * space -> '-'" rule is reproduced literally (only the FIRST space, not every space — pinned by
 * `tests/lens/scores/species.test.ts` so a future "clean this up" edit shows up as a diff).
 */
export function speciesFilenameStem(ctx: SpeciesContext): string {
  if (ctx.selection?.kind === "cell") return `species_cellid-${ctx.selection.cellId}`;
  if (ctx.selection?.kind === "zone") {
    const name = (ctx.zoneName ?? ctx.selection.key).toLowerCase();
    const i = name.indexOf(" ");
    const slug = i === -1 ? name : `${name.slice(0, i)}-${name.slice(i + 1)}`;
    return `species_${ctx.selection.unit}-${slug}`;
  }
  return `species_${ctx.zoneAllKey}`;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * D3(b) (Opus 5.5 eyes-on, 2026-09-24): the Table panel's own empty-state copy, the species-table
 * counterpart of `flower.ts#flowerEmptyText` — see that function's header for the shared rationale.
 * The owner's report: a land click's popup gave "no value" and the Table panel THEN read "The
 * species table could not be loaded", a wording that reads as a bug even for a click that never
 * landed on a scored cell at all. `state.svelte.ts`'s D3(a) fix means a plain no-value click no
 * longer changes the selection, so this text is reached only by a genuinely empty/failed load for
 * whatever selection IS active — `errorMessage` set (a real thrown error from `loadSpeciesRows`,
 * `TablePanel.svelte`'s own `reload()`) keeps that condition textually distinct from "nothing
 * scored is selected".
 */
export function speciesTableEmptyText(errorMessage?: string | null): string {
  if (errorMessage) return `The species table could not be loaded: ${errorMessage}`;
  return "Click a scored cell on the map to see its species.";
}

/** `"{stem}_{YYYY-MM-DD}.csv"` (parity doc §8). */
export function csvFilename(stem: string, now: Date = new Date()): string {
  return `${stem}_${isoDate(now)}.csv`;
}

// --- display formats (parity doc §7.4/§7.5) -----------------------------------------------------

function isNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/** `er_score`: 0 dp percent (a 0-1 fraction, e.g. 0.5 -> "50%"). P3/W3 coordinator reversal
 * (2026-09-24): a same-round fix briefly rendered this as the release's own plain 1-100 number
 * (`formatErScore`) -- reverted to keep parity with the reference R Shiny app
 * (`apps/scores/app.R`'s `formatPercentage(c("er_score"), 0)`, the SAME internal 0-1 fraction
 * this query computes, `sql/species_for_cells.sql`'s own `t.er_score / 100.0`). */
export function formatPercent0(v: unknown): string {
  return isNum(v) ? `${Math.round(v * 100)}%` : "";
}

/** `avg_suit`/`pct_cat`: 2 dp percent. */
export function formatPercent2(v: unknown): string {
  return isNum(v) ? `${(v * 100).toFixed(2)}%` : "";
}

/** `area_km2`: 4 significant figures, comma-grouped (`toLocaleString`, en-US — matches
 * `DataTable`'s other numeric formatting convention, `dataTableCore.ts`'s `formatRowCountAnnouncement`). */
export function formatAreaKm2(v: unknown): string {
  if (!isNum(v)) return "";
  if (v === 0) return "0";
  const rounded = signif3(v, 4);
  const magnitude = Math.floor(Math.log10(Math.abs(rounded)));
  const decimals = Math.max(0, 3 - magnitude);
  return rounded.toLocaleString("en-US", {
    maximumFractionDigits: decimals,
    minimumFractionDigits: decimals,
  });
}

// --- links (parity doc §7.4) ---------------------------------------------------------------------

/** `taxon_authority === "botw"` -> BirdLife/BOTW; everything else -> WoRMS `aphia.php`. */
export function taxonUrl(
  taxonAuthority: string | null | undefined,
  taxonId: string | null | undefined,
): string {
  if ((taxonAuthority ?? "").toLowerCase() === "botw") return "https://birdsoftheworld.org";
  return `https://www.marinespecies.org/aphia.php?p=taxdetails&id=${encodeURIComponent(taxonId ?? "")}`;
}

/** the `Sel` patch a `model` link applies — same place (`area`/`map`) and camera, only the lens and
 * species key change (parity doc §7.4: "switches to the Species lens IN PLACE"). `out` is reset to
 * the SPECIES lens' own default (Shell.svelte's `onLensChange` makes the identical call for the
 * topbar's lens switch): left alone, the scores lens' `out=programarea` would otherwise leak into
 * a species view as if the user had chosen it there on purpose (state/types.ts's `defaultOut`). */
export function modelSelPatch(mdlKey: string): Partial<Sel> {
  return { lens: "species", sp: mdlKey, in: "merged", out: defaultOut("species") };
}

/**
 * The `model` link's `href`, for a real `<a>` element: an ordinary click is intercepted by the
 * table (which calls `selStore.set(modelSelPatch(...))` instead, so the switch is IN PLACE — no
 * reload), but the `href` itself must still resolve to the SAME view, so a modifier-click
 * (cmd/ctrl/middle-click), a right-click "open in new tab", or a screen reader's "open link" all
 * land correctly — the browser's own default action for those, which nothing here suppresses.
 */
export function modelHref(current: Sel, mdlKey: string): string {
  const next: Sel = { ...current, ...modelSelPatch(mdlKey) };
  const { search, hash } = formatSel(next);
  return `${search}${hash}` || "?";
}

// --- CSV export (parity doc §8) -------------------------------------------------------------------

/** RFC 4180 field quoting: quote (doubling embedded quotes) whenever a field contains the
 * delimiter, a quote or a line break — the three characters that would otherwise corrupt the row
 * boundary a naive `join(",")` assumes. */
function csvField(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * The species CSV — the UNFORMATTED frame (parity doc §8: `write_csv(rx$spp_tbl, file)` writes
 * `fmt_spp_tbl()`'s raw numbers, e.g. `0.5`, never the display string `"50%"`), `\r\n` line
 * endings (RFC 4180 / Excel's own convention, matching `readr::write_csv()`'s default).
 */
export function toCsv<T>(
  rows: readonly T[],
  columns: readonly { key: string; value: (r: T) => unknown }[],
): string {
  const header = columns.map((c) => csvField(c.key)).join(",");
  const lines = rows.map((r) => columns.map((c) => csvField(c.value(r))).join(","));
  return [header, ...lines].join("\r\n") + "\r\n";
}
