// THE ONLY place a color ramp is defined (atlas-2 `raster/` contract). The 11 stops per palette are
// NOT hardcoded here — R writes them into `boot.palettes` at publish time
// (`colorRampPalette(space = "Lab")(11)`, msens) and this module only operates on whatever boot.json
// hands it, so a brand or ramp change is a DATA change, never a code change. Ramp colors are data
// colors, not brand tokens: they must never be added to instances/<id>/tokens.css (that file's rule
// is enforced by scripts/check-hex-literals.mjs, a separate gate from this one).
//
// Every legend, click popup, zone choropleth and report gradient key must import from here —
// tests/raster/ramps.wiring.test.ts is the seeded-fault gate that scans src/ and fails if a second
// ramp or palette array is ever planted outside this file.
import { roundHalfEven } from "../geo/round";
import type { Palette } from "../state/types";

/** re-exported under this module's own name so callers of raster/ don't have to know the palette
 * name lives in state/types.ts too (plan D8's `pal` query key uses the exact same four names — this
 * alias, not a duplicate list, is what keeps them from drifting apart). */
export type PaletteName = Palette;

/** `boot.palettes[name]` — exactly 11 hex stops per the atlas-1 data contract
 * (`palettes{name:[11 hex]}`, `colorRampPalette(space = "Lab")(11)`). Nothing here validates the
 * *count*: callers pass whatever boot.json contains, and a wrong count is a publish-time (atlas-1)
 * data bug, not something this module should silently paper over by resampling. */
export type PaletteStops = readonly string[];

/**
 * Reads `boot.palettes[name]` with a runtime guard. `boot.json`'s real JSON Schema has not landed
 * yet (see src/lib/release/boot.ts's TODO), so this file cannot assume the key exists or is
 * well-formed — a missing/malformed `palettes` object resolves to `null`, never a throw, matching
 * this repo's "fail closed, never fail open" convention for not-yet-schema'd release data.
 */
export function paletteStopsFromBoot(
  boot: { palettes?: unknown } | null | undefined,
  name: PaletteName,
): PaletteStops | null {
  const palettes = boot?.palettes;
  if (!palettes || typeof palettes !== "object") return null;
  const stops = (palettes as Record<string, unknown>)[name];
  if (!Array.isArray(stops) || stops.length === 0 || !stops.every((s) => typeof s === "string")) {
    return null;
  }
  return stops as PaletteStops;
}

/** R3 (round-3 plan, W1 "actual color ramps visualized for given options" -- CalCOFI explore's own
 * `rampCss()`, `atlas-refs/"calcofi explore review.md"`): a flat CSS `linear-gradient` string over
 * `stops`, left to right -- the ramp-picker's strip preview (`lens/scores/LayersPanel.svelte`) and
 * ANY future caller needing the same "just show me this palette" strip. Pure string composition,
 * no new colors defined here -- `stops` still comes from `paletteStopsFromBoot`/
 * `paletteStopsWithFallback` above, never a second array. */
export function rampCss(stops: PaletteStops): string {
  return `linear-gradient(to right, ${stops.join(", ")})`;
}

export interface LegendStop {
  /** the hex color at this stop, straight from `boot.palettes` — never recomputed. */
  color: string;
  /** the data value this stop represents, linearly spaced across `[min, max]`. */
  value: number;
}

/**
 * The legend stops for `stops`, each paired with the data value it represents (evenly spaced across
 * `[min, max]`) — what the map legend and the report's gradient key render (plan: "values =
 * signif(meta$rescale, 3)" plus the 11 palette colors, ported from `app.R:2149-2150`).
 */
export function legendStops(stops: PaletteStops, min: number, max: number): LegendStop[] {
  const n = stops.length;
  return stops.map((color, i) => ({
    color,
    value: n <= 1 ? min : min + (i / (n - 1)) * (max - min),
  }));
}

/**
 * The stops `Legend.svelte` actually LABELS, out of the full gradient's `stops` — spec.md's
 * continuous-ramp rule: show the two ENDPOINTS (and optionally a midpoint), never one label per
 * palette stop (atlas-4/5 fix: a species legend used to print all 11, e.g. "1.00 10.90 20.80 ...
 * 100.00"). `ticks` defaults to 2 (both endpoints); 3 adds the exact midpoint; `ticks >=
 * stops.length` returns every stop unchanged (never MORE than what was handed in). The gradient
 * itself is unaffected — it always paints every color in `stops`, via `Legend.svelte`'s own
 * `linear-gradient` over the full array, never this reduced one.
 */
export function legendTicks<T>(stops: readonly T[], ticks = 2): T[] {
  if (stops.length === 0) return [];
  if (ticks <= 1 || stops.length === 1) return [stops[0]];
  if (ticks >= stops.length) return [...stops];
  const out: T[] = [];
  for (let i = 0; i < ticks; i++) {
    const idx = Math.round((i / (ticks - 1)) * (stops.length - 1));
    out.push(stops[idx]);
  }
  return out;
}

// half-even (banker's) rounding to the nearest integer — R's `round()` default, and the exact
// behavior the choropleth bin formula requires (a drawn rectangle produces exact `.5` fractions, and
// `Math.round` always rounds `.5` UP, silently shifting every exact-half cell into the next bin — the
// seeded fault this gate exists to catch). It comes from `geo/round.ts`, the ONE copy of R's
// `round()` in this repo (the private duplicate that lived here until geo/ landed on main is gone).

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

/**
 * The choropleth bin, 1..11, for `value` —
 * `clamp(roundHalfEven((v-min)/max(max-min,1e-6)*10)+1, 1, 11)`, byte-identical to the plan's
 * `raster/` contract and to R's `round()` semantics. Distinct from `colorForValue`'s continuous
 * blend: this SNAPS a value into one of the 11 discrete stops, for a zone choropleth fill.
 */
export function choroplethBin(value: number, min: number, max: number): number {
  const denom = Math.max(max - min, 1e-6);
  return clamp(roundHalfEven(((value - min) / denom) * 10) + 1, 1, 11);
}

/** the discrete stop color for `value`'s choropleth bin. */
export function binColor(stops: PaletteStops, value: number, min: number, max: number): string {
  const bin = choroplethBin(value, min, max); // 1..11
  return stops[clamp(bin - 1, 0, stops.length - 1)];
}

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex);
  if (!m) throw new Error(`raster/ramps.ts: not a 6-digit hex color: ${JSON.stringify(hex)}`);
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex([r, g, b]: readonly [number, number, number]): string {
  const c = (v: number) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

/**
 * The continuous color for `value` — linear RGB interpolation between the two nearest of the 11
 * stops (distinct from `choroplethBin`/`binColor`'s discrete 1-of-11 snap). Used for the click popup
 * and any other "the exact value's color" surface.
 *
 * Interpolating in sRGB rather than re-deriving Lab space is a deliberate simplification: the 11
 * stops were already built in Lab space by `colorRampPalette(space = "Lab")`, so this only blends
 * BETWEEN two already-Lab-spaced neighboring stops, where sRGB and Lab interpolation are visually
 * indistinguishable over that short a span.
 */
export function colorForValue(
  stops: PaletteStops,
  value: number,
  min: number,
  max: number,
): string {
  if (stops.length === 0)
    throw new Error("raster/ramps.ts: colorForValue requires at least one stop");
  if (stops.length === 1) return stops[0];
  const denom = Math.max(max - min, 1e-6);
  const t = clamp((value - min) / denom, 0, 1) * (stops.length - 1);
  const lo = Math.floor(t);
  const hi = Math.min(lo + 1, stops.length - 1);
  const frac = t - lo;
  const a = hexToRgb(stops[lo]);
  const b = hexToRgb(stops[hi]);
  const mixed: [number, number, number] = [
    a[0] + (b[0] - a[0]) * frac,
    a[1] + (b[1] - a[1]) * frac,
    a[2] + (b[2] - a[2]) * frac,
  ];
  return rgbToHex(mixed);
}

// --- swatch text contrast: shared by every value-popup swatch (round-3 review, Ben's "colour
// coding" ask) --------------------------------------------------------------------------------
//
// Moved here from `lens/species/popup.ts` (which now re-exports both, unchanged, for its own
// existing tests/callers) so `lens/scores/popup.ts` can compute the SAME contrast rule for its own
// swatch without importing across lenses — a ramp-adjacent color utility belongs beside the ramp.

/** relative luminance, R's own weights (species-lens parity reference §6.5 step 5:
 * `0.299R + 0.587G + 0.114B`, NOT the WCAG formula) — kept byte-for-byte rather than "improved" to
 * sRGB-linear luminance, which would pick a different color on some swatches. */
export function luminance(hex: string): number {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex);
  if (!m) return 1; // an unreadable color reads as "light" -> black text, the safer default
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

/** black on a light swatch, white on a dark one — the exact 0.5 threshold (species-lens parity
 * reference §6.5 step 5). CSS named colors, not hex, matching the R source's own literal
 * `"black"`/`"white"`. */
export function textColorFor(hexBg: string): "black" | "white" {
  return luminance(hexBg) > 0.5 ? "black" : "white";
}

// --- M2 fix: a fallback ramp for a palette the release has not published stops for ---------------
//
// docs/usability.md M2: every release today publishes `boot.palettes` for `spectral_r` ONLY
// (zoneFill.ts's own comment). Picking Viridis/Cividis/Magma painted every Program Area flat grey
// (`zoneChoropleth()`'s `!stopsColors` branch) and replaced BOTH the zone and raster legends with
// "This release has not published a legend ramp for this palette yet" — the viewer lost the scale
// on a palette the PICKER itself offered as a live choice.
//
// These are the standard, widely-published anchor colors for each colormap family (matplotlib's
// perceptually-uniform Viridis/Cividis/Magma), resampled to 11 stops with THIS module's own
// `colorForValue()` interpolation — never a second ramp/interpolation algorithm, and this stays the
// one file `tests/raster/ramps.wiring.test.ts` polices for that. `spectral_r` is every release's published ramp, but a collection with no
// boot bundle at all (the catalog-driven lens) falls back to the entry below.
const FALLBACK_RAMP_ANCHORS: Partial<Record<PaletteName, PaletteStops>> = {
  // ColorBrewer Spectral, reversed (low = purple-blue, high = dark red): the default ramp for a
  // catalog collection that publishes no style of its own (there is no `boot.palettes` there).
  spectral_r: [
    "#5e4fa2",
    "#3288bd",
    "#66c2a5",
    "#abdda4",
    "#e6f598",
    "#ffffbf",
    "#fee08b",
    "#fdae61",
    "#f46d43",
    "#d53e4f",
    "#9e0142",
  ],
  viridis: ["#440154", "#414487", "#2a788e", "#22a884", "#7ad151", "#fde725"],
  cividis: ["#00204d", "#414d6b", "#7c7b78", "#b9a468", "#ffea46"],
  magma: ["#000004", "#3b0f70", "#8c2981", "#de4968", "#fe9f6d", "#fcfdbf"],
};

/** 11 evenly-spaced stops resampled from `anchors`, via `colorForValue()` — the same interpolation
 * every click-popup/legend color already runs through, just fed a fixed anchor set instead of a
 * release's own 11 published stops. */
function resampleTo11(anchors: PaletteStops): PaletteStops {
  return Array.from({ length: 11 }, (_, i) => colorForValue(anchors, i, 0, 10));
}

/**
 * `paletteStopsFromBoot()`, falling back to a FIXED, client-side ramp (never derived from release
 * data — `FALLBACK_RAMP_ANCHORS` above) when the release publishes none for `name` (M2). `null`
 * only for a palette this module has neither published-data NOR a fallback for, which cannot
 * happen for any `PaletteName` today (every entry in `PALETTES` either is always published
 * (`spectral_r`) or has a fallback here) — kept so a caller need not special-case that
 * impossibility separately from "boot hasn't loaded yet".
 */
export function paletteStopsWithFallback(
  boot: { palettes?: unknown } | null | undefined,
  name: PaletteName,
): PaletteStops | null {
  const published = paletteStopsFromBoot(boot, name);
  if (published) return published;
  const anchors = FALLBACK_RAMP_ANCHORS[name];
  return anchors ? resampleTo11(anchors) : null;
}
