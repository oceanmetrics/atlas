// The species lens' UI half, part 1: `composeStyle()` inputs, as data (atlas-5 step 1/2).
//
// This is the ONE place the species lens turns a `LayerBar` (data/layerBar.ts) + a representation
// into what `src/lib/map/style.ts`'s `composeStyle()` takes — a `RasterLayerSpec` for the COG
// branch or a `RangeLayerSpec` for the PMTiles branch, never both at once, and never a hand-rolled
// tile URL (that lives in `map/layers/titiler.ts`, the one place a titiler URL is built).
//
// Nothing here touches MapLibre. Nothing here calls `fetch`. A component reads the return value
// and hands `raster`/`range` straight to `composeStyle()` — the same contract as the rest of this
// app's lenses (CLAUDE.md "keep core logic in an exported function... a component only calls it").
import { RANGE_FILL_COLOR, RANGE_FILL_OPACITY } from "../../lib/map/layers/ranges";
import { titilerTileTemplate } from "../../lib/map/layers/titiler";
import { legendTitle } from "../../lib/map/legendTitle";
import type { RangeLayerSpec, RasterLayerSpec } from "../../lib/map/types";
import {
  legendStops,
  paletteStopsFromBoot,
  type LegendStop,
  type PaletteName,
} from "../../lib/raster/ramps";
import type { Histogram } from "../../lib/map/density";
import type { ReleaseCogChoice } from "../../lib/raster/releaseCog";
import type { Representation } from "../../lib/state/types";
import { noSurfaceNotice } from "./data/card";
import type { LayerBar, LayerPill } from "./data/layerBar";
import type { TaxonAsset } from "./data/shards";

/** style ids for the two species surfaces — always exactly one of them is on screen at a time. */
export const SPECIES_RASTER_ID = "species-raster";
export const SPECIES_RANGE_ID = "species-range";

/** `msens::add_cell_tiles(..., raster_opacity = 0.8)` (`atlas-refs/"parity species app.md"` §6.2
 * step 8) — distinct from the SCORES raster's 0.6 (`map/layers/raster.ts`'s `SCORE_RASTER_OPACITY`). */
export const SPECIES_RASTER_OPACITY = 0.8;

/** the property every range's vector tile carries the model id under (§6.2's PMTiles branch). */
export const RANGE_KEY_PROPERTY = "mdl_key";

/** the `mdl_key` value to filter a range tile's features on: the asset's `source_key` when the
 * release keys the input differently from its tile (v7 backfill), else the input's own key (v8/v9). */
export function rangeFeatureKey(
  asset: { sourceKey: string | null },
  pill: { mdlKey: string },
): string {
  return asset.sourceKey ? asset.sourceKey : pill.mdlKey;
}

/** used only when an asset's own `colormap` is null (every real fixture sets one) — the app's own
 * default ramp (`cols_r`, §6.2 step 3: reversed Spectral, the same ramp `pal: "spectral_r"` names). */
export const DEFAULT_SPECIES_COLORMAP: PaletteName = "spectral_r";

/**
 * The asset to draw for `rep` — `msens::pick_asset()`'s native-first fallback (§6.2 step 7,
 * app.R:557-570): the asset matching `rep` exactly, else `"native"`, else whatever is first. `null`
 * for an input with no published assets at all (the struck-through-pill state).
 */
export function pickAsset(assets: readonly TaxonAsset[], rep: Representation): TaxonAsset | null {
  if (assets.length === 0) return null;
  return assets.find((a) => a.rep === rep) ?? assets.find((a) => a.rep === "native") ?? assets[0];
}

/** the layer bar's active pill — always exactly one (the merged pill, or one input pill). */
export function activePill(bar: LayerBar): LayerPill | undefined {
  return bar.pills.find((p) => p.active);
}

export type SpeciesLegend =
  | {
      kind: "continuous";
      title: string;
      subtitle: string | null;
      unit: string;
      stops: LegendStop[];
      /** R4-A: the whole-layer histogram + the last click's value, both filled in by the lens
       * state (`state.svelte.ts`) around this pure builder; absent -> the ramp alone. */
      histogram?: Histogram | null;
      marker?: number | null;
    }
  | { kind: "categorical"; title: string; subtitle: string | null; label: string; color: string }
  | null;

/** the species legend's `formatValue` (`SpeciesLegend.svelte`) — species surfaces are always
 * integers (1..100, or AquaX "Delivered"'s 0..1000, §6.2 step 3), never `signif`/`round(_,1)`
 * like the scores lens — `Legend.svelte`'s own default (`toFixed(2)`) prints e.g. "1.00" for this
 * ramp's endpoints, which is the defect this function exists to fix (spec.md: species labels read
 * "1" and "100"). A plain rounding stringify, kept here (not inline in the component) so it is
 * unit-testable without a DOM, per CLAUDE.md. */
export function formatSpeciesLegendValue(value: number): string {
  return String(Math.round(value));
}

export interface SpeciesMapInputsOptions {
  rep: Representation;
  /** `boot.palettes` — `null`/absent legend gracefully (the raster still draws; titiler colors it
   * server-side regardless of whether this app can also draw a legend). */
  boot?: { palettes?: unknown } | null;
  ver: string;
  /** the card's own scientific name — always present once a card resolves; the legend/downloads
   * title falls back to it alone when there is no common name (`legendTitle()`'s own fallback). */
  scientificName: string;
  /** the card's common name, when the taxon has one — folded into `legendTitle()`'s "{common}
   * ({sci})" title form (Ben's UI-L2 ask). `null`/omitted degrades to the bare scientific name. */
  commonName?: string | null;
  /** build week 6 step 5: who draws a COG asset, as the lens state resolved it from the release's side table
   * (`raster/releaseCog.ts` `releaseCogDraw`): `cog`, its 3857 copy in the browser; `titiler`, the fallback;
   * `"pending"`, not resolved yet (nothing is drawn, so no titiler tile is asked for a COG the browser will draw).
   * Absent = titiler (a caller with no release, the tests of the titiler path). */
  cog?: ReleaseCogChoice | "pending";
}

export interface SpeciesMapInputs {
  raster: RasterLayerSpec | null;
  range: RangeLayerSpec | null;
  legend: SpeciesLegend;
  /** §7.4's two render-time notices: "no surface published" (merged is null) and "no native surface
   * available for this input" (an input selected with zero assets — normally unreachable through the
   * UI, since that pill is struck-through and disabled, but kept here so the render path fails the
   * same way the old app did rather than silently drawing nothing unexplained). */
  notice: string | null;
  /** the asset actually drawn — what Share/"Download this layer" and the click `ValueSource` need. */
  asset: TaxonAsset | null;
}

/** §7.4, notification 3 (app.R:2035) — an input picked with no drawable asset. */
export function noNativeSurfaceNotice(): string {
  return "No native surface available for this input";
}

const EMPTY: SpeciesMapInputs = {
  raster: null,
  range: null,
  legend: null,
  notice: null,
  asset: null,
};

/**
 * The whole `composeStyle()` contribution for the layer currently on screen. `bar.pills` already
 * carries VERBATIM assets (data/layerBar.ts) — this function's only job is to pick one (by `rep`)
 * and turn it into map-module data, never re-deriving anything the data layer already computed.
 */
export function speciesMapInputs(bar: LayerBar, opts: SpeciesMapInputsOptions): SpeciesMapInputs {
  const pill = activePill(bar);
  if (!pill) return EMPTY;
  if (!pill.hasSurface) {
    return {
      ...EMPTY,
      notice: bar.variant === "merged" ? noSurfaceNotice(opts.ver) : noNativeSurfaceNotice(),
    };
  }

  const asset = pickAsset(pill.assets, opts.rep);
  if (!asset) return { ...EMPTY, notice: noNativeSurfaceNotice() };

  if (asset.type === "cog") {
    // never default a rescale (CLAUDE.md-adjacent rule already in data/shards.ts): no rescale means
    // no honest way to color the raster, so skip drawing it rather than guess a range.
    if (!asset.rescale) return { ...EMPTY, notice: noNativeSurfaceNotice(), asset };
    const colormapName = asset.colormap ?? DEFAULT_SPECIES_COLORMAP;
    const [min, max] = asset.rescale;
    const cog = opts.cog;
    // the browser draws the 3857 copy (the source's own template and maxzoom); titiler only when unresolved
    const raster: RasterLayerSpec | null =
      cog === "pending"
        ? null
        : cog?.kind === "cog"
          ? {
              id: SPECIES_RASTER_ID,
              tiles: [cog.source.template],
              opacity: cog.source.opacity,
              ...(cog.source.maxzoom === null ? {} : { maxzoom: cog.source.maxzoom }),
            }
          : {
              id: SPECIES_RASTER_ID,
              tiles: [
                titilerTileTemplate({
                  url: asset.url,
                  colormapName,
                  rescaleMin: min,
                  rescaleMax: max,
                }),
              ],
              opacity: SPECIES_RASTER_OPACITY,
            };
    const stops = paletteStopsFromBoot(opts.boot ?? null, colormapName as PaletteName);
    const lt = legendTitle({
      lens: "species",
      commonName: opts.commonName ?? undefined,
      scientificName: opts.scientificName,
      inputLabel: pill.label,
      valueSemantics: rasterValueSemantics(pill, asset.rep),
    });
    const legend: SpeciesLegend = stops
      ? {
          kind: "continuous",
          title: lt.title,
          subtitle: lt.subtitle,
          unit: "score",
          stops: legendStops(stops, min, max),
          // the side table's histogram (from the full-resolution original) when the browser draws it; else
          // the lens fills titiler's `/cog/statistics` in later
          ...(cog && cog !== "pending" && cog.kind === "cog" ? { histogram: cog.histogram } : {}),
        }
      : null;
    return { raster, range: null, legend, notice: null, asset };
  }

  // pmtiles: the ranges branch (§6.2's PMTiles branch) — presence only, no rescale/colormap to read.
  if (!asset.sourceLayer) return { ...EMPTY, notice: noNativeSurfaceNotice(), asset };
  const range: RangeLayerSpec = {
    id: SPECIES_RANGE_ID,
    pmtiles: asset.url,
    sourceLayer: asset.sourceLayer,
    keyProperty: RANGE_KEY_PROPERTY,
    key: rangeFeatureKey(asset, pill),
    fillColor: RANGE_FILL_COLOR,
    opacity: RANGE_FILL_OPACITY,
  };
  const rangeLt = legendTitle({
    lens: "species",
    commonName: opts.commonName ?? undefined,
    scientificName: opts.scientificName,
    inputLabel: pill.label,
    valueSemantics: "presence",
  });
  const legend: SpeciesLegend = {
    kind: "categorical",
    title: rangeLt.title,
    subtitle: rangeLt.subtitle,
    label: "range (presence)",
    color: RANGE_FILL_COLOR,
  };
  return { raster: null, range, legend, notice: null, asset };
}

/** the caption that replaces "as delivered" for a single-representation COG input labelled
 * `rep: "native"` (R5-2): the one layer such an input publishes is its GRIDDED surface (v1-v7 inputs
 * carry exactly one COG on the 0.05 deg scoring grid, labelled `rep: "native"` by the legacy
 * adapter), so "as delivered" misdescribed it -- there is no other
 * layer for it to be "as delivered" against. Names what the layer is, like the Interpolated tooltip
 * ("resampled to the 0.05 deg scoring grid") does. */
export const SINGLE_LAYER_CAPTION = "on the 0.05° scoring grid";

/** an input publishes ONE representation when every asset it carries has the same `rep` (the
 * representation switch is only offered for two, `layerBar.ts`). */
function hasSingleRepresentation(pill: LayerPill): boolean {
  return new Set(pill.assets.map((a) => a.rep)).size === 1;
}

/** Ben's UI-L2 ask, species form: the legend subtitle's value-semantics clause -- "habitat
 * suitability 1-100" for the merged model (always rescaled 0/1-100, the merge's whole point) or an
 * input pill whose picked asset is already on the ingest/model rescale (`rep === "model"`,
 * `REPRESENTATION_LABELS`'s "As ingested"/"Interpolated" row); "as delivered" for an input pill
 * whose picked asset is its own raw, undelivered band (`rep === "native"`, that table's "Delivered"/
 * "Original" row) -- matches the brief's own two examples verbatim ("Merged model · habitat
 * suitability 1–100", "AquaMaps · as delivered"). R5-2: an input with only ONE representation has
 * nothing to be "as delivered" against, so a lone `rep: "native"` COG is captioned for what it is
 * ({@link SINGLE_LAYER_CAPTION}); a lone `rep: "model"` COG keeps "habitat suitability 1-100" (what
 * the values mean), and a lone PMTiles original never reaches here ("presence"). */
function rasterValueSemantics(pill: LayerPill, assetRep: string): string {
  if (pill.key === "merged") return "habitat suitability 1-100";
  if (assetRep !== "native") return "habitat suitability 1-100";
  return hasSingleRepresentation(pill) ? SINGLE_LAYER_CAPTION : "as delivered";
}
