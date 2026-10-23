// atlas-4 fix round 3 -- the scores lens' click popup. The owner's report: "the old Shiny app
// showed cell id, lon/lat and the scores on click" and this app showed nothing. The atlas-4
// subplan's Selection checklist: "Click a cell … show cell id, lon/lat (3 dp), the displayed
// layer's value"; the reference doc's §6.4 gives the zone-click text verbatim, "{name}:
// {round(value)}" -- `zoneFill.ts`'s `zoneTooltip()` already spells that exactly, written for a
// HOVER tooltip that was never wired to anything; this module wires the same text to a CLICK.
//
// R3-W7 (round-3 review, Ben's "colour coding" ask, 2026-09-25): both branches now go
// through the SAME `lib/map/popup.ts#valuePopupHtml` template the species popup renders through
// (UI-4's `formatSubject`/`formatValueLine` for the subject/value lines and a ramp-colour swatch;
// R4-A moved the distribution histogram out of the popup and into the legend) — a scored cell
// and a Program Area popup finally look like the SAME kind of thing, which they were not before this round (the scores lens had no colour
// coding of its own at all).
//
// Pure text builders only -- `ScoresLens.svelte`/`state.svelte.ts` are the callers that touch
// MapLibre, through the shared themed popup (`src/lib/map/popup.ts`). The cell branch's VALUE
// comes from `analysis/queries.ts#cellValue()` (the wide `cell` Parquet tile, plan D4): nothing
// here, or in its caller, ever reads a rendered raster pixel --
// `tests/lens/scores/no-readpixels.test.ts` scans this whole directory for `readPixels` and fails
// if it ever appears.
import { formatLatLon, formatSubject, formatValueLine } from "../../lib/format";
import {
  valuePopupAnnounceText,
  valuePopupHtml,
  type ValuePopupContent,
} from "../../lib/map/popup";
import { colorForValue, textColorFor, type PaletteStops } from "../../lib/raster/ramps";
import { paLabel } from "../../places/zoneStats";
import type { ZoneRow } from "./boot";
import { zoneValuesFor } from "./zoneFill";

export interface CellPopupInput {
  cellId: number;
  lon: number;
  lat: number;
  /** the SHORT metric label (`boot.ts#metricLabelsFromManifest`, the manifest's own per-metric
   * name — U4/R3). D4 (Opus 5.5 eyes-on, 2026-09-24): this used to be `boot.layers[].label`, which
   * (per that reader's own doc) carries the LONG description text ("Primary productivity: Oregon
   * State Vertically Generalized Production Model (VGPM) from ... 2014 to 2023"), not a name fit
   * for a one-line popup. The caller (`state.svelte.ts#showCellPopup`) resolves the short label
   * with the manifest -> boot -> metric_key fallback chain `metricLabelsFromManifest`'s own header
   * describes; this module just renders whatever string it is handed. */
  layerLabel: string;
  /** `null` when the cell carries no row for this layer (off-grid, or unscored) -- `cellValue()`'s
   * own "no value" answer, never a guess. */
  value: number | null;
  /** R3-W7: the ramp stops + rescale range to colour the swatch against
   * (`raster/ramps.ts#paletteStopsWithFallback` + the layer's own `rescale`, resolved by the
   * caller — this module never guesses a ramp). `undefined`/`null` when no palette is available
   * yet (degrades to a grey swatch — never a guessed colour). */
  ramp?: { stops: PaletteStops; min: number; max: number } | null;
}

/** the swatch colour + text contrast for a cell popup's value, or `null` when there is nothing to
 * colour against (no value, or no ramp resolved yet). */
export function cellSwatch(
  value: number | null,
  ramp: CellPopupInput["ramp"],
): { color: string; textColor: "black" | "white" } | null {
  if (value === null || !ramp) return null;
  const color = colorForValue(ramp.stops, value, ramp.min, ramp.max);
  return { color, textColor: textColorFor(color) };
}

function cellPopupContent(input: CellPopupInput): ValuePopupContent {
  // D3 (Opus 5.5 eyes-on, 2026-09-24): a click OUTSIDE the scored area must never show a cell id
  // (a bare integer read as "the app found something here" — it did not) — the subject is the
  // coordinates ALONE for a no-value click, never `formatSubject()`'s cell-id form.
  const subject =
    input.value === null
      ? formatLatLon(input.lat, input.lon)
      : formatSubject({ kind: "cell", cellId: input.cellId, lon: input.lon, lat: input.lat });
  const swatch = cellSwatch(input.value, input.ramp);
  return {
    subject,
    valueLine:
      input.value === null ? "No scored cell here" : formatValueLine(input.layerLabel, input.value),
    swatchColor: swatch?.color ?? null,
    textColor: swatch?.textColor ?? null,
    unitLabel: input.value === null ? null : input.layerLabel,
    detailsLink: input.value !== null, // R4-B: nothing to show details for on a no-value click
  };
}

/**
 * The scores lens' cell popup, through the shared `valuePopupHtml()` template (UI-4's subject/
 * value lines, R3-W7's colour swatch). A click OUTSIDE the scored area
 * (`value === null` — off-grid, unscored, e.g. land) reads "No scored cell here" as the value
 * line, with a neutral grey swatch (D3, Opus 5.5 eyes-on, 2026-09-24: never a
 * cell id or the layer title for a click that found nothing).
 */
export function cellPopupText(input: CellPopupInput): string {
  return valuePopupHtml(cellPopupContent(input));
}

/**
 * fix list #12 (SC 4.1.3): the `announce()` counterpart of {@link cellPopupText} -- the SAME
 * text, unescaped (a live region reads text, not an SVG).
 */
export function cellPopupAnnounceText(input: CellPopupInput): string {
  return valuePopupAnnounceText(cellPopupContent(input));
}

export interface CellPopupLoadingInput {
  cellId: number;
  lon: number;
  lat: number;
}

/**
 * usability M9: "a cold cell click gives no feedback... no popup appeared within 3.5s". The popup
 * now opens AT ONCE with this line (never waiting on the engine); {@link cellPopupText}/
 * {@link cellPopupAnnounceText} replace it once the value resolves. No markup to escape here (cell
 * id and lon/lat are both plain numbers), so one function covers the HTML and the announce text.
 */
export function cellPopupLoadingText(input: CellPopupLoadingInput): string {
  const lon = input.lon.toFixed(3);
  const lat = input.lat.toFixed(3);
  return `Cell ${input.cellId} · lon ${lon}, lat ${lat} · Loading value…`;
}

export interface ZonePopupInput {
  zones: readonly ZoneRow[];
  lyr: string | null;
  zone: { key: string; name: string };
  /** R3-W7: the ramp stops to colour the swatch against — computed by the
   * caller from the SAME `zoneChoropleth()` call that already builds the fill (`mapInputs.ts`),
   * never a second ramp lookup here. `undefined`/`null` degrades to a grey swatch. */
  stops?: PaletteStops | null;
}

function zonePopupContent(input: ZonePopupInput): ValuePopupContent {
  const values = input.lyr ? zoneValuesFor(input.zones, input.lyr) : [];
  const value = values.find((v) => v.key === input.zone.key);
  const name = paLabel(input.zone.key, input.zone.name);
  if (!value) {
    return { subject: name, valueLine: "No scored cell here", swatchColor: null, textColor: null };
  }
  const min = Math.min(...values.map((v) => v.value));
  const max = Math.max(...values.map((v) => v.value));
  const swatchColor = input.stops ? colorForValue(input.stops, value.value, min, max) : null;
  return {
    subject: formatSubject({ kind: "zone", name }),
    valueLine: formatValueLine("Score", value.value),
    swatchColor,
    textColor: swatchColor ? textColorFor(swatchColor) : null,
    detailsLink: true, // R4-B
  };
}

/**
 * The scores lens' Program-Area popup, through the SAME shared template the cell popup (above) and
 * the species popup use. Replaces the old bespoke "{name}: {round(value)}" hover-tooltip text
 * (parity doc §6.4) — the wording is now UI-4's shared subject/value lines, with a ramp-colour
 * swatch matching the choropleth fill. (The distribution histogram lives in the legend since round
 * 4 R4-A, never in the popup.)
 */
export function zonePopupText(input: ZonePopupInput): string {
  return valuePopupHtml(zonePopupContent(input));
}

/** the `announce()` counterpart of {@link zonePopupText} — see {@link cellPopupAnnounceText}'s
 * header for why this is a separate, unescaped function rather than reusing the HTML string. */
export function zonePopupAnnounceText(input: ZonePopupInput): string {
  return valuePopupAnnounceText(zonePopupContent(input));
}
