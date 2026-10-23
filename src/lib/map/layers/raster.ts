// The raster source + layer pair, `msens::add_cell_tiles()`'s shape (viz.R:294-312, atlas-4 §6.2
// step 4): `add_raster_source(id, tiles, tileSize = 256)` + `add_raster_layer(raster_resampling =
// "nearest")`. Pure: given a `RasterLayerSpec` it returns plain specs, no MapLibre instance needed.
//
// `raster-resampling: "nearest"` is not cosmetic — the COGs are categorical-ish score surfaces on a
// 0.05° grid and MapLibre's default `linear` blends neighbouring cells, so a pixel probed at a
// lon/lat would not equal the cell's own value (atlas-4's "legend, painted pixel and popup swatch
// agree at three probe values per palette" gate).
import { gridSpansGlobe, type GridSpec } from "../../grid/grid";
import type { LayerSpecification, RasterLayerSpec, SourceSpecification } from "../types";

/** the score raster's opacity (`raster_opacity = 0.6`, app.R:2115). */
export const SCORE_RASTER_OPACITY = 0.6;
/** the "cells outside Program Areas" overlay's opacity (`raster_opacity = 0.55`, app.R:2124). */
export const OVERLAY_RASTER_OPACITY = 0.55;
/** every titiler `/cog/tiles/WebMercatorQuad` tile is 256 px. */
export const RASTER_TILE_SIZE = 256;

export function rasterSourceId(spec: RasterLayerSpec): string {
  return spec.id;
}

export function rasterSource(spec: RasterLayerSpec): SourceSpecification {
  return {
    type: "raster",
    tiles: [...spec.tiles],
    tileSize: spec.tileSize ?? RASTER_TILE_SIZE,
    ...(spec.bounds ? { bounds: spec.bounds } : {}),
    ...(spec.maxzoom === undefined ? {} : { maxzoom: spec.maxzoom }),
  };
}

/**
 * `RasterLayerSpec.bounds` for a release's grid — 0.10.21 fix 2 (the owner's report: titiler 404s
 * z3 x∈{0,1,7} on the phone view; those tiles simply lie south of the COG's real latitude extent,
 * and MapLibre requests every world tile at a low zoom regardless when a raster source carries no
 * `bounds` at all).
 *
 * `usa05` (v1-v7) stores its own longitudes 0-360 from `xmin` 141.10°E (`lon360: true`) and its
 * real span runs 141.10°E eastward, THROUGH the antimeridian, to -63.75°E (`xmin + nc*resx - 360`)
 * — a box that WRAPS. MapLibre's own tile-bounds check (`TileBounds.contains()`, dist/
 * tile_bounds.ts) has no wraparound handling: it takes `mercatorXfromLng(west)` and
 * `mercatorXfromLng(east)` and requires `tileX >= minX && tileX < maxX`. Handed a WRAPPED box
 * (`west` numerically greater than `east`, e.g. `[141.1, ..., -63.75, ...]`) that comparison is
 * `minX > maxX`, which is never true for ANY tile — every tile would silently fail `hasTile()` and
 * the raster would never paint at all, trading a console 404 for a fully blank layer. So a grid
 * whose longitude span crosses the antimeridian gets the full `[-180, 180]` longitude range here
 * (the widest box that is still CORRECT — it never excludes a real tile) and only the LATITUDE
 * bound is tightened to the grid's own extent. `global05` (v8+) already spans the whole globe
 * (`gridSpansGlobe`), so it gets the same shape for the same reason: there is no narrower box that
 * is both correct and worth expressing.
 */
export function rasterBoundsForGrid(grid: GridSpec): [number, number, number, number] {
  const south = grid.ymax - grid.nr * grid.resy;
  const north = grid.ymax;
  if (gridSpansGlobe(grid)) return [-180, south, 180, north];
  const east360 = grid.xmin + grid.nc * grid.resx;
  const west = grid.lon360 && grid.xmin > 180 ? grid.xmin - 360 : grid.xmin;
  const east = grid.lon360 && east360 > 180 ? east360 - 360 : east360;
  const crossesAntimeridian = grid.lon360 && east < west;
  if (crossesAntimeridian) return [-180, south, 180, north];
  return [west, south, east, north];
}

export function rasterLayer(spec: RasterLayerSpec): LayerSpecification {
  return {
    id: spec.id,
    type: "raster",
    source: rasterSourceId(spec),
    layout: { visibility: spec.visible === false ? "none" : "visible" },
    paint: {
      "raster-opacity": spec.opacity,
      "raster-resampling": "nearest",
    },
  };
}
