// atlas-4 step 1 — the zone-choropleth branch (parity doc §6.4's "zone-choropleth branch"): ALL
// zones of the unit, the 11-bin rule (raster/ramps.ts), opacity 0.7, white outline, lightgrey
// default, tooltip text, legend endpoints and the empty-values guard. Pure: every function takes
// `ZoneRow[]` (boot.ts) and returns plain data for `composeStyle`'s `ZoneFillSpec` or a table row —
// nothing here touches MapLibre.
import { roundHalfEven } from "../../lib/geo/round";
import {
  binColor,
  legendStops,
  paletteStopsWithFallback,
  type LegendStop,
  type PaletteName,
} from "../../lib/raster/ramps";
import type { ZoneFillSpec } from "../../lib/map/types";
import { zoneKeyProperty } from "../../lib/map/layers/zones";
import { ZONE_LINE_WHITE } from "../../lib/map/colors";
import { paLabel } from "../../places/zoneStats";
import type { ZoneRow } from "./boot";

/** lightgrey (`app.R:2318`) — a zone with no value for the current layer is drawn, not dropped.
 * Named, not a hex literal (`scripts/check-hex-literals.mjs`'s allow-list is CSS named colors). */
export const ZONE_FILL_DEFAULT_COLOR = "lightgrey";
export const ZONE_FILL_OPACITY = 0.7;
/** white — reads `colors.ts`'s own outline colour rather than a second hex literal
 * (`tests/raster/ramps.wiring.test.ts` scans for exactly that). */
export const ZONE_FILL_OUTLINE_COLOR = ZONE_LINE_WHITE;

export interface ZoneValue {
  key: string;
  name: string;
  value: number;
}

/** `zones` narrowed to the ones carrying a real (finite) value for `metricKey`, name from the zone
 * row (falling back to the key — parity doc §6.4: "name from `zone_pts(unit)`, else the key").
 * V4 fix (owner phone report, 2026-09-24, docs fact-check item 3): `name` now goes through
 * `paLabel()` (the SAME "Full Name (KEY)" label the Zones table/Places panel show, V1's names
 * table) -- this used to be the bundle's bare `name` verbatim, which is the key itself on every
 * real release (zoneStats.ts's own header), so the map's hover/click tooltip (`zoneTooltip` below)
 * read "GAA: 42", never "GOA Program Area A (GAA): 42". No `unit` arg, same as `zonesTable.ts`'s
 * own call -- every caller here only ever deals in Program Areas (D17: the release's one
 * selectable unit), so the PROGRAM_AREA_NAMES fallback table resolves without one. */
export function zoneValuesFor(zones: readonly ZoneRow[], metricKey: string): ZoneValue[] {
  const out: ZoneValue[] = [];
  for (const z of zones) {
    const v = z.metrics[metricKey];
    if (typeof v === "number" && Number.isFinite(v))
      out.push({ key: z.key, name: paLabel(z.key, z.name), value: v });
  }
  return out;
}

export interface ZoneChoropleth {
  fill: ZoneFillSpec | null;
  /** legend endpoints, `round(range, 1)` (parity doc §6.4) — `null` alongside `fill: null`. */
  legend: { min: number; max: number; stops: readonly string[] } | null;
  /** true when `values` was empty (the `Inf/-Inf` legend guard, parity doc §6.4: "a warning
   * notification and no draw") — the caller shows a notice instead of an empty/garbled choropleth. */
  empty: boolean;
}

/**
 * The zone choropleth for one unit/layer/palette: the 11-bin rule's colours as `ZoneFillSpec.stops`
 * (one per zone with a value), the legend's rounded range, and the empty-values guard. `unit` is
 * only used to name the tile's key property (`{unit}_key`) — the fill/line/label LAYER shapes
 * themselves are `map/layers/zones.ts`'s job; this module only supplies the DATA-derived `stops`.
 */
export function zoneChoropleth(
  unit: string,
  values: readonly ZoneValue[],
  boot: { palettes?: unknown } | null | undefined,
  palette: PaletteName,
): ZoneChoropleth {
  if (values.length === 0) return { fill: null, legend: null, empty: true };

  // M2 fix: falls back to ramps.ts's own fixed anchor ramp when the release publishes no stops for
  // `palette` (today: every release publishes ONLY spectral_r) — every palette the picker offers
  // now paints a real choropleth and has a legend, not flat grey with "not published yet".
  const stopsColors = paletteStopsWithFallback(boot, palette);
  const min = Math.min(...values.map((v) => v.value));
  const max = Math.max(...values.map((v) => v.value));
  const round1 = (x: number) => roundHalfEven(x * 10) / 10;

  if (!stopsColors) {
    // neither published NOR a known fallback (ramps.ts: cannot happen for a real PaletteName
    // today) — draw every zone as the default colour rather than guess a ramp; the legend is
    // unavailable too.
    return {
      fill: {
        keyProperty: zoneKeyProperty(unit),
        stops: values.map((v) => ({ key: v.key, color: ZONE_FILL_DEFAULT_COLOR })),
        defaultColor: ZONE_FILL_DEFAULT_COLOR,
        opacity: ZONE_FILL_OPACITY,
        outlineColor: ZONE_FILL_OUTLINE_COLOR,
      },
      legend: null,
      empty: false,
    };
  }

  const stops = values.map((v) => ({
    key: v.key,
    color: binColor(stopsColors, v.value, min, max),
  }));
  return {
    fill: {
      keyProperty: zoneKeyProperty(unit),
      stops,
      defaultColor: ZONE_FILL_DEFAULT_COLOR,
      opacity: ZONE_FILL_OPACITY,
      outlineColor: ZONE_FILL_OUTLINE_COLOR,
    },
    legend: {
      min: round1(min),
      max: round1(max),
      stops: legendStops(stopsColors, min, max).map((s) => s.color),
    },
    empty: false,
  };
}

/** the hover/click tooltip text, verbatim (parity doc §6.4: `"{name}: {round(value)}"`). */
export function zoneTooltip(v: ZoneValue): string {
  return `${v.name}: ${roundHalfEven(v.value)}`;
}

/**
 * `ZoneChoropleth.legend` reshaped into `LegendStop[]` for the shared `Legend.svelte` (atlas-4
 * defect fix: the floating scores legend, `ScoresLegend.svelte`). The two ENDPOINT values are
 * exactly `legend.min`/`legend.max` (already `round(range, 1)`, parity doc §6.4) — `legendStops`
 * interpolates between them, so its first/last entries equal them verbatim; the interior stops
 * only feed the gradient's colors, never a rendered label (`Legend.svelte`'s own `ticks` default
 * is 2 -- see ui/Legend.svelte).
 */
export function zoneLegendStops(legend: NonNullable<ZoneChoropleth["legend"]>): LegendStop[] {
  return legendStops(legend.stops, legend.min, legend.max);
}
