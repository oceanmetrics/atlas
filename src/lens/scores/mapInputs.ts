// atlas-4 step 1/2 — the scores lens' contribution to the ONE composed style (docs/map.md): given
// the release + the current `Sel`, produce the `zones`/`raster`/`overlays`/`selection` fields of
// `ComposeStyleInput`. Shell.svelte merges this with its own `theme`/`projection`/base `zones` and
// calls `composeStyle()` + `applyStyle()` — this module never touches MapLibre or calls either.
import { zoneUnitsFromBoot, zoneLabelsFromBoot } from "../../lib/map/layers/zones";
import { rasterBoundsForGrid } from "../../lib/map/layers/raster";
import type { RasterLayerSpec, SelectionSpec, ZoneUnitSpec } from "../../lib/map/types";
import { SELECTION_COLOR } from "../../lib/map/colors";
import { gridFromBoot } from "../../lib/grid/grid";
import { layerByKey, metricKeyLabel, zoneRows, type BootLayerRow } from "./boot";
import {
  outsidePraOverlaySpec,
  rasterLegend,
  scoreRasterSpec,
  type ManifestOverlayRow,
} from "./raster";
import { zoneChoropleth, zoneLegendStops, zoneValuesFor } from "./zoneFill";
import type { LegendStop, PaletteName } from "../../lib/raster/ramps";
import type { Histogram } from "../../lib/map/density";
import { valueListDistribution } from "../../lib/map/distribution";

/**
 * The scores lens' floating legend (atlas-4 defect fix: the scores lens had NO floating legend at
 * all, unlike species' `SpeciesLegend.svelte`) — one of the two mutually-exclusive branches
 * (`raster`: `signif(rescale,3)` endpoints; `zone`: `round(range,1)` endpoints, parity doc
 * §6.2/§6.4), or a reason there is nothing to show (`unavailable`: no published palette stops;
 * `empty`: the zone-choropleth Inf/-Inf guard — no zone carries a value). `null` only before a
 * layer has resolved at all (no boot yet).
 */
export type ScoresLegend =
  | {
      kind: "raster";
      title: string;
      stops: LegendStop[];
      histogram?: Histogram | null;
      marker?: number | null;
    }
  | {
      kind: "zone";
      title: string;
      stops: LegendStop[];
      histogram?: Histogram | null;
      marker?: number | null;
    }
  | { kind: "unavailable"; title: string }
  | { kind: "empty"; title: string }
  | null;

/** `ScoresLegend`'s `formatValue` (`ScoresLegend.svelte`) — both branches' endpoints are ALREADY
 * rounded upstream (`signif3` / `round(range,1)`, this module below); reformatting them here (e.g.
 * `toLocaleString`'s implicit 3-fraction-digit cap) would re-round a 4-significant-digit value like
 * 0.0123 down to "0.012" — the exact defect this function exists to avoid. A plain stringify prints
 * exactly what was already computed. Exported (not inline in the component) so it is unit-testable
 * without a DOM, per CLAUDE.md. */
export function formatScoresLegendValue(value: number): string {
  return String(value);
}

export interface ScoresMapInputs {
  zones: ZoneUnitSpec[];
  raster: RasterLayerSpec | null;
  overlays: RasterLayerSpec[];
  selection: SelectionSpec | null;
  legend: ScoresLegend;
}

export interface ScoresMapState {
  boot: unknown;
  overlays: readonly ManifestOverlayRow[] | null | undefined;
  unit: string; // "cell" or the release's one drawable unit's type
  lyr: string | null; // resolved metric_key (never undefined at call time — the caller defaults it)
  palette: PaletteName;
  showOutsidePra: boolean;
  /** R4-A: the Raster-cells layer's WHOLE-layer histogram (`/cog/statistics`, resolved async by the
   * lens state and cached by (ver, lens, layer) -- never per click); `null`/absent -> ramp alone. */
  rasterHistogram?: Histogram | null;
  /** R4-A: the last clicked element's value, for the legend's marker line (the cell's value comes
   * from Parquet, a Program area's from the boot bundle). `null`/absent -> no marker. */
  marker?: number | null;
  /** a cell ring (lon/lat centre + half-cell size) or a zone key to outline, or null. */
  selection:
    | { kind: "cell"; lon: number; lat: number; halfW: number; halfH: number }
    | { kind: "zone"; unit: string; key: string }
    | null;
  /** R3 orchestrator audit item 3: `metric_key` -> the manifest's own SHORT label
   * (`boot.ts#metricLabelsFromManifest`) — `boot.layers[].label` is the LONG description
   * ("Primary productivity: Oregon State Vertically Generalized Production Model (VGPM)..."), not
   * a short name, so the legend title prefers this when the manifest has one. `undefined`/`{}`
   * (manifest not loaded yet) falls back to the pre-fix behaviour (`layer?.label`, i.e. the long
   * text) — never a blank title. */
  metricLabels?: Record<string, string>;
}

/** the currently-selected zone's boundary as a `SelectionSpec`, resolved from the vector tile the
 * map already has loaded — the lens does not refetch geometry for a highlight, it filters the
 * existing zone layer via `map/style.ts`'s selection-line role over a synthetic point placeholder.
 * A cell ring is drawn directly (a tiny square polygon), which this module CAN build without the
 * map, since it is pure arithmetic on the grid. */
function cellRingSelection(
  sel: NonNullable<ScoresMapState["selection"]> & { kind: "cell" },
): SelectionSpec {
  const { lon, lat, halfW, halfH } = sel;
  const ring = [
    [lon - halfW, lat - halfH],
    [lon + halfW, lat - halfH],
    [lon + halfW, lat + halfH],
    [lon - halfW, lat + halfH],
    [lon - halfW, lat - halfH],
  ];
  return {
    features: {
      type: "FeatureCollection",
      features: [
        { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [ring] } },
      ],
    },
    color: SELECTION_COLOR,
  };
}

/** attaches `bounds` to a raster/overlay spec, or passes `null`/`undefined` through untouched —
 * a tiny helper so `scoresMapInputs` reads as one thought instead of two near-identical `? {...,
 * bounds} : null` ternaries (one per spec). */
function withBounds(
  spec: RasterLayerSpec | null,
  bounds: [number, number, number, number] | undefined,
): RasterLayerSpec | null {
  if (!spec || !bounds) return spec;
  return { ...spec, bounds };
}

/**
 * Build this lens' `composeStyle` contribution. `zoneUnits` are always outline-only from
 * `zoneUnitsFromBoot` UNLESS `unit` (the current spatial-unit selection) matches, in which case the
 * unit's `fill` is filled in from the current layer's values (the choropleth branch). The raster +
 * overlay are populated only on the `cell` branch (parity doc §6.4: the two branches are mutually
 * exclusive — a zone choropleth clears the raster, and vice versa).
 */
export function scoresMapInputs(state: ScoresMapState): ScoresMapInputs {
  const layer: BootLayerRow | null = layerByKey(state.boot, state.lyr);
  const baseUnits = zoneUnitsFromBoot(state.boot).map((u) => ({
    ...u,
    labels: zoneLabelsFromBoot(state.boot, u.unit) ?? undefined,
  }));

  const isCellBranch = state.unit === "cell";
  // captured from the SAME zoneChoropleth() call the fill above already makes, rather than a
  // second one just for the legend (zoneValuesFor/zoneChoropleth are pure but not free, and the
  // release's real zone counts run into the hundreds).
  let zoneLegend: ReturnType<typeof zoneChoropleth>["legend"] = null;
  let zoneEmpty = false;
  let zoneHistogram: Histogram | null = null; // R4-A: every zone's value, binned
  const zones: ZoneUnitSpec[] = baseUnits.map((u) => {
    let out = u;
    if (!isCellBranch && u.unit === state.unit) {
      const values = zoneValuesFor(zoneRows(state.boot, u.unit), state.lyr ?? "");
      const choro = zoneChoropleth(
        u.unit,
        values,
        state.boot as { palettes?: unknown } | null | undefined,
        state.palette,
      );
      if (choro.fill) out = { ...out, fill: choro.fill };
      zoneLegend = choro.legend;
      zoneHistogram = valueListDistribution(values.map((v) => v.value));
      zoneEmpty = choro.empty;
    }
    if (state.selection?.kind === "zone" && state.selection.unit === u.unit) {
      out = { ...out, highlightKey: state.selection.key };
    }
    return out;
  });

  // 0.10.21 fix 2: restrict tile REQUESTS to the release's own grid extent (`rasterBoundsForGrid`'s
  // own header explains why `usa05`'s antimeridian-crossing span becomes the full [-180,180] box
  // rather than a narrower, wraparound one MapLibre cannot express). `null` (no `boot.grid` yet,
  // Tier 0 hasn't loaded) leaves the raster/overlay unbounded, same as before this fix.
  let bounds: [number, number, number, number] | undefined;
  try {
    bounds = rasterBoundsForGrid(gridFromBoot(state.boot));
  } catch {
    bounds = undefined;
  }
  const raster = isCellBranch ? withBounds(scoreRasterSpec(layer, state.palette), bounds) : null;
  const overlay = isCellBranch
    ? withBounds(outsidePraOverlaySpec(state.overlays, state.showOutsidePra), bounds)
    : null;

  const selection: SelectionSpec | null =
    state.selection?.kind === "cell" ? cellRingSelection(state.selection) : null;

  // atlas-4 defect fix: the floating legend for whichever branch is on screen -- title is the
  // layer's own label (falling back to its metric key, then "Score", matching the removed
  // in-panel copy's own fallback so this is not a behaviour change, only a relocation).
  //
  // R3 orchestrator audit item 3: the manifest's SHORT label wins when published (`state.lyr` keys
  // `state.metricLabels`, built from `manifest.metrics[]`) -- `layer?.label` (boot.json's LONG
  // description) is now only the fallback for a manifest that has not loaded yet or omits this
  // key, never the first choice.
  //
  // R3-B1: the LAST resort used to be the raw `state.lyr` string verbatim -- a release whose
  // composite row really is `metric_key: "score"` with no label anywhere painted the lowercase raw
  // key into this legend's `<h2>` (and, via the SAME `legend.title`, `LegendChip.svelte`'s phone
  // chip text) instead of "Score". `metricKeyLabel()` is the ONE title-casing fallback the Layer
  // `<select>` (`ScoresLens.svelte`'s `metricLabel()`) uses too, so all three surfaces agree.
  //
  // Fix round (orchestrator, 2026-09-25): the WHOLE `metricLabels ?? layer.label` chain now routes
  // through `metricKeyLabel()` as its `label` argument -- a curated label that is itself just the
  // bare key ("score") is caught there too, not only an absent one (see that function's own
  // header). `state.lyr` still gets the hardcoded "Score" fallback when it is null/undefined
  // (nothing to even title-case), unchanged.
  const title = state.lyr
    ? metricKeyLabel(state.lyr, (state.metricLabels ?? {})[state.lyr] ?? layer?.label)
    : "Score";
  const legend: ScoresLegend = isCellBranch
    ? (() => {
        const rl = rasterLegend(
          state.boot as { palettes?: unknown } | null | undefined,
          layer,
          state.palette,
        );
        return rl.unavailable
          ? { kind: "unavailable", title }
          : {
              kind: "raster",
              title,
              stops: rl.stops,
              histogram: state.rasterHistogram ?? null,
              marker: state.marker ?? null,
            };
      })()
    : zoneEmpty
      ? { kind: "empty", title }
      : zoneLegend
        ? {
            kind: "zone",
            title,
            stops: zoneLegendStops(zoneLegend),
            histogram: zoneHistogram,
            marker: state.marker ?? null,
          }
        : { kind: "unavailable", title };

  return { zones, raster, overlays: overlay ? [overlay] : [], selection, legend };
}
