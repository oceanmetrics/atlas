// What the Collections lens hands `composeStyle` and the legend, as a PURE function of the active
// entry, item, the collection's style document and the loaded value column (the Svelte wiring that
// loads those lives in state.svelte.ts). A hex item (a PMTiles grid + a Parquet column) becomes a
// `HexLayerSpec`; a cloud-optimized GeoTIFF item becomes a `RasterLayerSpec`, drawn in the browser
// (`cog://`, `raster/cog.ts`) when the item has an EPSG:3857 COG asset and by titiler otherwise (the
// fallback, chosen per item by `rasterChoiceOf`); either way the legend spans the item's own
// `atlas:value_range` (`catalog/ramp.ts#valueDomain`), the same domain the colours use, so the legend
// and the painted map always agree. A browser-drawn item's legend is its STAC asset's (`legendFromStac`:
// the ramp it is painted with, the published band histogram), never a tile-server read.
import { hexAssetOf, rangeAssetOf, rasterAssetOf, valuesAssetOf } from "../../lib/catalog/assets";
import type { CollectionEntry } from "../../lib/catalog/load";
import { collectionRamp, rampStops, valueDomain } from "../../lib/catalog/ramp";
import type { StacCollection, StacItem } from "../../lib/catalog/types";
import type { ValueColumn } from "../../lib/catalog/values";
import type { HexLayerSpec } from "../../lib/map/layers/hex";
import { titilerTileTemplate } from "../../lib/map/layers/titiler";
import { cogRasterSource, rasterChoiceOf, stacHistogram } from "../../lib/raster/cog";
import type { RasterBackend } from "../../lib/raster/tiles";
import { binValues, type Histogram } from "../../lib/map/density";
import { legendTitle } from "../../lib/map/legendTitle";
import { RANGE_FILL_COLOR, RANGE_FILL_OPACITY } from "../../lib/map/layers/ranges";
import type {
  H3LayerSpec,
  HighlightSpec,
  RangeLayerSpec,
  RasterLayerSpec,
} from "../../lib/map/types";
import { cellOf, type CellGrid } from "../../lib/catalog/cellSpecies";
import { wrapLon } from "../../lib/raster/pointRead";
import { PALETTES } from "../../lib/state/types";
import type { Palette } from "../../lib/state/types";
import { paletteStopsWithFallback, type LegendStop } from "../../lib/raster/ramps";
import { unitLabel } from "../../lib/raster/pointRead";

export interface CollectionLegend {
  /** `continuous`: a ramp over the item's value range. `presence`: a vector range (one swatch, "range
   * (presence)"; `stops` is empty). */
  kind: "continuous" | "presence";
  title: string;
  subtitle: string | null;
  stops: LegendStop[];
  /** the swatch of a `presence` legend. */
  swatch?: string;
  /** what the values are (`sdm:value_unit`); "" when the item says nothing. */
  unit: string;
  /** the density of the item's values across the whole layer: binned from the Parquet column (hex
   * items) or read once from the tile server (raster items, `/cog/statistics`); `null` while it is
   * loading, when it failed, or for a vector range. */
  histogram: Histogram | null;
  /** the clicked cell's value (a vertical line on the histogram + ramp); `null` for none. */
  marker: number | null;
  /** how many stops get a label under the ramp (`Legend`'s `ticks`); default the two ends. */
  ticks?: number;
}

export interface CollectionMapInputs {
  hex: HexLayerSpec | null;
  /** an `h3` collection's hexagons (the lazy H3 layer, `./h3/layer.svelte.ts`); `null` for any other. */
  h3: H3LayerSpec | null;
  raster: RasterLayerSpec | null;
  /** a vector range item (a v7 model that publishes PMTiles only): drawn as a presence fill. */
  range: RangeLayerSpec | null;
  legend: CollectionLegend | null;
  /** the COG a download of "the data layer" would fetch; `null` for a hex item. */
  cogUrl: string | null;
  /** the band of that COG the map draws (`atlas:bidx`), `null` = band 1. */
  cogBidx: number | null;
  /** who draws the raster: the browser (`cog`) or titiler; `null` for a hex or vector item. */
  rasterBackend: RasterBackend | null;
  /** the clicked raster position (a ring, plus the cell's square when the grid is known); `null` for none. */
  highlight: HighlightSpec | null;
}

export const EMPTY_COLLECTION_INPUTS: CollectionMapInputs = {
  hex: null,
  h3: null,
  raster: null,
  range: null,
  legend: null,
  cogUrl: null,
  cogBidx: null,
  rasterBackend: null,
  highlight: null,
};

/** the id of the collection raster's source and layer. */
export const COLLECTION_RASTER_ID = "collection_raster";
export const COLLECTION_RASTER_OPACITY = 0.8;
/** the id of the vector range's source and layer. */
export const COLLECTION_RANGE_ID = "collection_range";

/** an item's display label: its own title, else its id. */
export function itemLabel(item: StacItem): string {
  const t = item.properties?.title;
  return typeof t === "string" && t.trim() ? t.trim() : item.id;
}

/** three significant figures, no trailing zeros ("0.42", "12.3", "1500"): a legend/hover value. */
export function formatCollectionValue(v: number): string {
  if (!Number.isFinite(v)) return "";
  if (v === 0) return "0";
  const s = Number(v.toPrecision(3));
  return Math.abs(s) >= 1e6 || Math.abs(s) < 1e-3 ? s.toExponential(2) : String(s);
}

/** a cell's value for the hover and the cell panel: two decimals ("0.42"), except where two decimals
 * would hide it (a value of 100 or more, or a non-zero value under 0.01): then the legend's three
 * significant figures. */
export function formatCellValue(v: number): string {
  if (!Number.isFinite(v)) return "";
  const a = Math.abs(v);
  if (a >= 100 || (a !== 0 && a < 0.01)) return formatCollectionValue(v);
  return v.toFixed(2);
}

/** a raster item's value read at a point (`/cog/point`) as text: the number to three significant
 * figures with the item's unit ("87%", "0.00072 n/km²"), "no data" for a nodata pixel or a failed read. */
export function formatRasterValue(v: number | null | undefined, unit: string): string {
  if (typeof v !== "number" || !Number.isFinite(v)) return "no data";
  const n = formatCollectionValue(v);
  const u = unitLabel(unit);
  return !u ? n : u === "%" ? `${n}%` : `${n} ${u}`;
}

function unitOf(item: StacItem, entry: CollectionEntry): string {
  const u = item.properties?.["sdm:value_unit"] ?? entry.collection?.["sdm:value_unit"];
  return typeof u === "string" && u !== "unitless" ? u : "";
}

/** the `[min, max]` a raster item's colours and legend span: the asset's own rescale unless the item
 * states a value range (a rescale read from the tile server lands there); `null` for an asset that
 * asks for `rescale: "auto"` and has not been read yet. The legend histogram is asked for exactly
 * this range, so the bars line up with the ramp. */
export function rasterDomainOf(
  item: StacItem | null,
  collection: StacCollection | null,
): [number, number] | null {
  const cog = rasterAssetOf(item);
  if (!item || !cog) return null;
  const hasOwnRange = Array.isArray(item.properties?.["atlas:value_range"]);
  if (cog.rescale === "auto" && !hasOwnRange) return null;
  const rescale = Array.isArray(cog.rescale) ? cog.rescale : null;
  return rescale && !hasOwnRange ? rescale : valueDomain(item, collection);
}

/**
 * The highlight of a clicked raster position: the point (longitude wrapped) and, when the layer's cell grid is
 * known, the closed ring of the cell it falls in. A position outside the grid keeps the ring alone.
 */
export function highlightOf(
  lngLat: readonly [number, number],
  grid: CellGrid | null,
): HighlightSpec | null {
  const [lon, lat] = lngLat;
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  const point: [number, number] = [lon >= -180 && lon < 180 ? lon : wrapLon(lon), lat];
  const c = grid ? cellOf(point[0], point[1], grid) : null;
  if (!grid || !c) return { lngLat: point, cell: null };
  const w = grid.x0 + c.col * grid.res;
  const e = w + grid.res;
  const n = grid.y0 - c.row * grid.res;
  const s = n - grid.res;
  return {
    lngLat: point,
    cell: [
      [w, n],
      [e, n],
      [e, s],
      [w, s],
      [w, n],
    ],
  };
}

export function collectionMapInputs(args: {
  entry: CollectionEntry | null;
  item: StacItem | null;
  /** the collection's `styles/default.json`, or null (none published, or not loaded yet). */
  style: unknown | null;
  /** the item's value column once loaded, else null (the legend then has no histogram). */
  values: ValueColumn | null;
  /** the clicked cell's value for THIS item, else null. */
  marker: number | null;
  /** a raster item's whole-layer histogram once read (`/cog/statistics`), else null. */
  histogram?: Histogram | null;
  /** a raster item's COG footprint (`/cog/info`), which restricts the tiles MapLibre requests to it;
   * absent/`null` = unknown (draw unbounded, as before). */
  cogBounds?: [number, number, number, number] | null;
  /** the clicked raster position of THIS item, with the cell grid when the layer has one; absent = none. */
  point?: { lngLat: [number, number]; grid: CellGrid | null } | null;
}): CollectionMapInputs {
  const { entry, item, style, values, marker, cogBounds, histogram, point } = args;
  if (!entry?.collection || !item) return EMPTY_COLLECTION_INPUTS;
  const highlight = point ? highlightOf(point.lngLat, point.grid) : null;
  const collection = entry.collection;
  const domain = valueDomain(item, collection);
  const lt = legendTitle({
    lens: "collection",
    itemLabel: itemLabel(item),
    collectionTitle: entry.title,
    valueUnit: unitOf(item, entry) || undefined,
  });

  const cog = rasterAssetOf(item);
  const hexAsset = hexAssetOf(item, collection);
  const hasValues = valuesAssetOf(item) !== null;

  if (hasValues && hexAsset) {
    const colors = collectionRamp(style);
    const finite = (values?.values ?? []).filter((v): v is number => typeof v === "number");
    return {
      h3: null,
      hex: {
        pmtiles: hexAsset.url,
        sourceLayer: hexAsset.layer,
        idField: hexAsset.idField,
        colors,
        domain,
      },
      raster: null,
      range: null,
      cogUrl: null,
      cogBidx: null,
      rasterBackend: null,
      highlight,
      legend: {
        kind: "continuous",
        title: lt.title,
        subtitle: lt.subtitle,
        stops: rampStops(colors, domain),
        unit: unitOf(item, entry),
        histogram: finite.length > 0 ? binValues(finite) : null,
        marker: marker !== null && Number.isFinite(marker) ? marker : null,
      },
    };
  }

  const choice = cog ? rasterChoiceOf(item) : null;
  if (cog && choice?.kind === "cog") {
    // a registry copy whose side-table numbers are still being read: nothing is drawn yet (not titiler either);
    // the lens re-derives the Item when the read settles (`lib/catalog/registry/item.ts`)
    if (choice.draw.asset["atlas:stats_pending"] === true) return EMPTY_COLLECTION_INPUTS;
    // drawn in the browser: the 3857 asset through cogSlot, coloured by its `atlas:colormap` over the lens's
    // domain (the item's value range, else the asset's rescale, else the band's STAC statistics), the legend
    // and its histogram from STAC
    const src = cogRasterSource(item, choice.draw.asset, {
      domain: rasterDomainOf(item, collection),
      opacity: COLLECTION_RASTER_OPACITY,
      title: lt.title,
    });
    const lg = src.legend();
    if (!lg.ramp) return EMPTY_COLLECTION_INPUTS;
    return {
      h3: null,
      hex: null,
      highlight,
      cogUrl: cog.url,
      cogBidx: cog.bidx ?? null,
      rasterBackend: "cog",
      range: null,
      raster: {
        id: COLLECTION_RASTER_ID,
        tiles: [src.template],
        opacity: src.opacity,
        ...(src.maxzoom === null ? {} : { maxzoom: src.maxzoom }),
        ...(cogBounds ? { bounds: cogBounds } : {}),
      },
      legend: {
        kind: "continuous",
        title: lt.title,
        subtitle: lt.subtitle,
        stops: rampStops(lg.ramp.colors, [lg.ramp.min, lg.ramp.max]),
        unit: unitOf(item, entry),
        histogram: stacHistogram(lg),
        marker: marker !== null && Number.isFinite(marker) ? marker : null,
      },
    };
  }

  if (cog) {
    // an asset that asks for `rescale: "auto"` draws once the range has been read (the lens puts it
    // in `atlas:value_range`); until then there is nothing honest to paint or to put in the legend
    const rasterDomain = rasterDomainOf(item, collection);
    if (!rasterDomain) return EMPTY_COLLECTION_INPUTS;
    // titiler colours by a NAMED colormap, so a raster item uses the asset's own (when it is one of
    // the app's four ramps) else the default; a collection style is a MapLibre expression titiler
    // cannot take
    const colormap: Palette = PALETTES.includes(cog.colormap as Palette)
      ? (cog.colormap as Palette)
      : "spectral_r";
    const colors = [...(paletteStopsWithFallback(null, colormap) ?? [])];
    return {
      h3: null,
      hex: null,
      highlight,
      cogUrl: cog.url,
      cogBidx: cog.bidx ?? null,
      rasterBackend: "titiler",
      range: null,
      raster: {
        id: COLLECTION_RASTER_ID,
        tiles: [
          titilerTileTemplate({
            url: cog.url,
            colormapName: colormap,
            rescaleMin: rasterDomain[0],
            rescaleMax: rasterDomain[1],
            ...(cog.bidx === undefined ? {} : { bidx: cog.bidx }),
          }),
        ],
        opacity: COLLECTION_RASTER_OPACITY,
        ...(cogBounds ? { bounds: cogBounds } : {}),
      },
      legend: {
        kind: "continuous",
        title: lt.title,
        subtitle: lt.subtitle,
        stops: rampStops(colors, rasterDomain),
        unit: unitOf(item, entry),
        histogram: histogram ?? null,
        marker: marker !== null && Number.isFinite(marker) ? marker : null,
      },
    };
  }

  const vector = rangeAssetOf(item);
  if (vector) {
    // a vector-only model: presence, no value to colour by (the shard carries none)
    return {
      h3: null,
      hex: null,
      raster: null,
      range: {
        id: COLLECTION_RANGE_ID,
        pmtiles: vector.url,
        sourceLayer: vector.layer,
        keyProperty: vector.keyProperty,
        key: vector.key,
        fillColor: RANGE_FILL_COLOR,
        opacity: RANGE_FILL_OPACITY,
      },
      cogUrl: null,
      cogBidx: null,
      rasterBackend: null,
      highlight,
      legend: {
        kind: "presence",
        title: lt.title,
        subtitle: lt.subtitle,
        stops: [],
        swatch: RANGE_FILL_COLOR,
        unit: "",
        histogram: null,
        marker: null,
      },
    };
  }

  return EMPTY_COLLECTION_INPUTS; // an item with neither a hex+values pair nor a COG: nothing to draw
}
