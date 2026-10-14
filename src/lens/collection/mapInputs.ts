// What the Collections lens hands `composeStyle` and the legend, as a PURE function of the active
// entry, item, the collection's style document and the loaded value column (the Svelte wiring that
// loads those lives in state.svelte.ts). A hex item (a PMTiles grid + a Parquet column) becomes a
// `HexLayerSpec`; a cloud-optimized GeoTIFF item becomes a titiler `RasterLayerSpec`; either way the
// legend spans the item's own `atlas:value_range` (`catalog/ramp.ts#valueDomain`), the same domain
// the colours use, so the legend and the painted map always agree.
import { hexAssetOf, rasterAssetOf, valuesAssetOf } from "../../lib/catalog/assets";
import type { CollectionEntry } from "../../lib/catalog/load";
import { collectionRamp, rampStops, valueDomain } from "../../lib/catalog/ramp";
import type { StacItem } from "../../lib/catalog/types";
import type { ValueColumn } from "../../lib/catalog/values";
import type { HexLayerSpec } from "../../lib/map/layers/hex";
import { titilerTileTemplate } from "../../lib/map/layers/titiler";
import { binValues, type Histogram } from "../../lib/map/density";
import { legendTitle } from "../../lib/map/legendTitle";
import type { RasterLayerSpec } from "../../lib/map/types";
import { paletteStopsWithFallback, type LegendStop } from "../../lib/raster/ramps";

export interface CollectionLegend {
  kind: "continuous";
  title: string;
  subtitle: string | null;
  stops: LegendStop[];
  /** what the values are (`sdm:value_unit`); "" when the item says nothing. */
  unit: string;
  /** the density of the item's values across the whole layer (hex items); `null` for a raster. */
  histogram: Histogram | null;
  /** the clicked cell's value (a vertical line on the histogram + ramp); `null` for none. */
  marker: number | null;
}

export interface CollectionMapInputs {
  hex: HexLayerSpec | null;
  raster: RasterLayerSpec | null;
  legend: CollectionLegend | null;
  /** the COG a download of "the data layer" would fetch; `null` for a hex item. */
  cogUrl: string | null;
}

export const EMPTY_COLLECTION_INPUTS: CollectionMapInputs = {
  hex: null,
  raster: null,
  legend: null,
  cogUrl: null,
};

/** the id of the collection raster's source and layer. */
export const COLLECTION_RASTER_ID = "collection_raster";
export const COLLECTION_RASTER_OPACITY = 0.8;

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

function unitOf(item: StacItem, entry: CollectionEntry): string {
  const u = item.properties?.["sdm:value_unit"] ?? entry.collection?.["sdm:value_unit"];
  return typeof u === "string" && u !== "unitless" ? u : "";
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
}): CollectionMapInputs {
  const { entry, item, style, values, marker } = args;
  if (!entry?.collection || !item) return EMPTY_COLLECTION_INPUTS;
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
      hex: {
        pmtiles: hexAsset.url,
        sourceLayer: hexAsset.layer,
        idField: hexAsset.idField,
        colors,
        domain,
      },
      raster: null,
      cogUrl: null,
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

  if (cog) {
    // titiler colours by a NAMED colormap, so a raster item always uses the default ramp (a
    // collection style is a MapLibre expression titiler cannot take)
    const colors = [...(paletteStopsWithFallback(null, "spectral_r") ?? [])];
    return {
      hex: null,
      cogUrl: cog.url,
      raster: {
        id: COLLECTION_RASTER_ID,
        tiles: [
          titilerTileTemplate({
            url: cog.url,
            colormapName: "spectral_r",
            rescaleMin: domain[0],
            rescaleMax: domain[1],
          }),
        ],
        opacity: COLLECTION_RASTER_OPACITY,
      },
      legend: {
        kind: "continuous",
        title: lt.title,
        subtitle: lt.subtitle,
        stops: rampStops(colors, domain),
        unit: unitOf(item, entry),
        histogram: null,
        marker: marker !== null && Number.isFinite(marker) ? marker : null,
      },
    };
  }

  return EMPTY_COLLECTION_INPUTS; // an item with neither a hex+values pair nor a COG: nothing to draw
}
