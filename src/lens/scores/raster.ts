// atlas-4 step 1 — the score raster, the "cells outside Program Areas" overlay, and their legend,
// as pure builders over a `BootLayerRow` (boot.ts) and the release's `manifest.overlays`. Every
// number here is read verbatim from the release (D4: "numbers never come from the tile server" —
// this module builds DISPLAY tiles only; scores/values still come from Parquet elsewhere), never
// recomputed: the rescale is the manifest's own, the colormap is titiler's own ramp name.
import { signif3 } from "../../lib/geo/round";
import { titilerMaskTileTemplate, OUTSIDE_PRA_COLORMAP } from "../../lib/map/layers/titiler";
import { createTitilerRasterSource, type RasterSource } from "../../lib/raster/tiles";
import type { CogRasterSource } from "../../lib/raster/cog";
import { SCORE_RASTER_OPACITY, OVERLAY_RASTER_OPACITY } from "../../lib/map/layers/raster";
import {
  legendStops,
  paletteStopsWithFallback,
  type LegendStop,
  type PaletteName,
} from "../../lib/raster/ramps";
import type { RasterLayerSpec } from "../../lib/map/types";
import { fullSubregion, type BootLayerRow } from "./boot";

export const SCORE_RASTER_ID = "r_lyr";
export const OUTSIDE_PRA_OVERLAY_ID = "outside_pra_lyr";

/** the score rasters' fallback renderer behind the `RasterSource` seam (`lib/raster/tiles.ts`): the
 * stock titiler, for a score COG the release's side table has no EPSG:3857 copy of. Since build week 6
 * step 5 the lens resolves each score COG first (`lib/raster/releaseCog.ts` `releaseCogDraw`) and hands
 * a resolved COG's `cogRasterSource` (`lib/raster/cog.ts`) in as `source`, so the browser draws it. */
const SCORE_RASTER_SOURCE: RasterSource = createTitilerRasterSource();

/**
 * The score/metric raster for `layer` — always the `FULL` COG (D7: the study area is a camera,
 * never a filter), the manifest's `rescale` verbatim, the chosen palette as titiler's
 * `colormap_name`, opacity 0.6, nearest resampling (`layers/raster.ts`). `null` when the release
 * publishes no `FULL` COG for this layer (never a throw — an unknown `?lyr=` must fall back).
 */
export function scoreRasterSpec(
  layer: BootLayerRow | null,
  palette: PaletteName,
  source: RasterSource = SCORE_RASTER_SOURCE,
): RasterLayerSpec | null {
  if (!layer) return null;
  const full = fullSubregion(layer);
  if (!full?.cog || !full.rescale) return null;
  // the template MapLibre fills: the renderer's own tile URL with literal `{z}/{x}/{y}`
  const tiles = [
    source.tileUrl("{z}", "{x}", "{y}", {
      url: full.cog,
      colormapName: palette,
      rescaleMin: full.rescale[0],
      rescaleMax: full.rescale[1],
    }),
  ];
  // a browser source is built for its asset (the palette's stops over the rescale) and knows the copy's own
  // full-resolution zoom: MapLibre overzooms above it rather than asking for tiles finer than the file
  const maxzoom = isCogSource(source) && source.maxzoom !== null ? { maxzoom: source.maxzoom } : {};
  return { id: SCORE_RASTER_ID, tiles, opacity: SCORE_RASTER_OPACITY, ...maxzoom };
}

function isCogSource(s: RasterSource): s is CogRasterSource {
  return s.kind === "cog" && "maxzoom" in s;
}

/** one row of `manifest.overlays` (parity doc §6.2 step 5 / §6.3). */
export interface ManifestOverlayRow {
  overlay_key?: unknown;
  subregion_key?: unknown;
  cog?: unknown;
  colormap?: unknown;
}

/**
 * `manifest.overlays[_outside_pra]`'s `FULL` row, the binary-mask overlay: an explicit
 * `{"1":[34,34,34,255]}` colormap (never a named ramp), opacity 0.55, OFF by default (the caller's
 * `visible` — the layers control's switch, unchecked at first paint per parity doc §6.2). `null`
 * when the release publishes no such overlay (v1-v6 predate it, or a boot with no manifest yet).
 */
export function outsidePraOverlaySpec(
  overlays: readonly ManifestOverlayRow[] | null | undefined,
  visible: boolean,
  source?: CogRasterSource | null,
): RasterLayerSpec | null {
  const cog = outsidePraCog(overlays);
  if (!cog) return null;
  if (source) {
    // build week 6 step 5: the mask's own 3857 copy, painted in the browser with the same explicit table
    // titiler's colormap template used (`OUTSIDE_PRA_CLASSES`: 1 -> the mask grey, every other value clear)
    return {
      id: OUTSIDE_PRA_OVERLAY_ID,
      tiles: [source.template],
      opacity: OVERLAY_RASTER_OPACITY,
      visible,
      ...(source.maxzoom === null ? {} : { maxzoom: source.maxzoom }),
    };
  }
  const tiles = [titilerMaskTileTemplate({ url: cog, colormap: OUTSIDE_PRA_COLORMAP })];
  return { id: OUTSIDE_PRA_OVERLAY_ID, tiles, opacity: OVERLAY_RASTER_OPACITY, visible };
}

/** the `_outside_pra` overlay's `FULL` COG, or null when the release publishes none. */
export function outsidePraCog(
  overlays: readonly ManifestOverlayRow[] | null | undefined,
): string | null {
  const row = (overlays ?? []).find(
    (o) => o.overlay_key === "_outside_pra" && o.subregion_key === "FULL",
  );
  return row && typeof row.cog === "string" ? row.cog : null;
}

/** titiler's explicit mask colormap (`OUTSIDE_PRA_COLORMAP`, `{"1": [34,34,34,255]}`) as the browser paint's
 * value -> colour table: the same value, the same colour, every other value transparent (titiler leaves a value
 * its explicit colormap does not list transparent). */
export const OUTSIDE_PRA_CLASSES: Readonly<
  Record<number, readonly [number, number, number, number]>
> = Object.fromEntries(Object.entries(OUTSIDE_PRA_COLORMAP).map(([k, c]) => [Number(k), c]));

export interface RasterLegend {
  stops: LegendStop[];
  /** `true` only when the release has published no stops for this palette AND `ramps.ts` has no
   * fallback for it either (cannot happen for a real `PaletteName` today, M2 fix) — the legend then
   * shows a "not available" notice rather than guessing a ramp with no basis at all. */
  unavailable: boolean;
}

/**
 * The raster legend for `layer`/`palette`: endpoints `signif(rescale, 3)` (parity doc §6.2 step 6),
 * 11 stops from `boot.palettes[palette]` when the release published them, else `ramps.ts`'s own
 * fixed fallback ramp (M2: docs/usability.md — Viridis/Cividis/Magma used to lose the raster
 * legend's scale too, on tiles that titiler was already painting correctly server-side).
 * `unavailable: true` (empty `stops`) only when NEITHER exists.
 */
export function rasterLegend(
  boot: { palettes?: unknown } | null | undefined,
  layer: BootLayerRow | null,
  palette: PaletteName,
): RasterLegend {
  const full = layer ? fullSubregion(layer) : null;
  const stopsColors = paletteStopsWithFallback(boot, palette);
  if (!full?.rescale || !stopsColors) return { stops: [], unavailable: !stopsColors };
  const [min, max] = full.rescale;
  return { stops: legendStops(stopsColors, signif3(min), signif3(max)), unavailable: false };
}
