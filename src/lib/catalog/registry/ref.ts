// A registry-backed taxon collection (WP7): the collection carries `atlas:taxa_registry` (which asset
// holds one row per taxon, which column keys it, the compact search index) and `atlas:item_template`
// (how a row becomes an Item). No per-taxon Item file exists; the app builds the Item client-side from
// the row (`item.ts`). This module is the pure reading of those two collection fields.
import { assetUrl } from "../load";
import type { StacCollection } from "../types";
import { PALETTES, type Palette } from "../../state/types";

/** where a registry collection's taxa live. Every URL is absolute (resolved against the collection). */
export interface RegistryRef {
  collectionId: string;
  /** the registry Parquet (one row per taxon). */
  registryUrl: string;
  /** the compact `[key, scientific, common, group]` JSON for the search box; `null` when none is published
   * (the registry is then small enough to search directly). */
  indexUrl: string | null;
  keyColumn: string;
  groupColumn: string | null;
  searchColumns: string[];
  /** how many taxa the registry says it has (for the catalog card); `null` when it does not say. */
  rowCount: number | null;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/** the registry of a collection, or `null` when it is not a registry-backed taxon collection (no
 * `atlas:taxa_registry`, or it names an asset the collection does not list). */
export function registryRefOf(collection: StacCollection | null | undefined): RegistryRef | null {
  if (!collection) return null;
  const spec = collection["atlas:taxa_registry"];
  if (!isRecord(spec)) return null;
  const assetName = typeof spec.asset === "string" ? spec.asset : "registry";
  const asset = collection.assets?.[assetName];
  if (!asset) return null;
  const registryUrl = assetUrl(collection, asset);
  if (!registryUrl) return null;
  const indexAsset =
    typeof spec.index_asset === "string" ? collection.assets?.[spec.index_asset] : undefined;
  const indexUrl = indexAsset ? assetUrl(collection, indexAsset) : null;
  const searchColumns = Array.isArray(spec.search_columns)
    ? spec.search_columns.filter((c): c is string => typeof c === "string")
    : ["scientific_name", "common_name"];
  return {
    collectionId: collection.id,
    registryUrl,
    indexUrl,
    keyColumn: typeof spec.key_column === "string" && spec.key_column ? spec.key_column : "sp_key",
    groupColumn:
      typeof spec.group_column === "string" && spec.group_column ? spec.group_column : null,
    searchColumns,
    rowCount:
      typeof spec.row_count === "number" && Number.isFinite(spec.row_count) ? spec.row_count : null,
  };
}

/** the draw parameters an Item built from a row carries; every one has a default so a collection that
 * omits (or garbles) part of its template still draws. */
export interface ItemTemplate {
  /** the COG's display rescale; AquaMaps suitability is 1-100 percent. */
  rescale: [number, number];
  /** a named titiler colormap; the app's Spectral-reversed ramp when the template names none. */
  colormap: Palette;
  /** the legend / colour domain (`atlas:value_range`). */
  valueRange: [number, number];
  /** the COG's no-data value (AquaMaps: 0 = no data, so 1 is the lowest suitability drawn). */
  nodata: number;
  unit: string | null;
  /** the band the COG draws (`atlas:bidx`). */
  bidx: number;
  /** the title of the data asset. */
  title: string | null;
}

export const DEFAULT_ITEM_TEMPLATE: ItemTemplate = {
  rescale: [1, 100],
  colormap: "spectral_r",
  valueRange: [1, 100],
  nodata: 0,
  unit: "percent",
  bidx: 1,
  title: null,
};

function pair(v: unknown): [number, number] | null {
  return Array.isArray(v) &&
    v.length === 2 &&
    typeof v[0] === "number" &&
    typeof v[1] === "number" &&
    Number.isFinite(v[0]) &&
    Number.isFinite(v[1]) &&
    v[0] < v[1]
    ? [v[0], v[1]]
    : null;
}

/** the item template of a collection, with defaults for whatever it does not state. */
export function itemTemplateOf(collection: StacCollection | null | undefined): ItemTemplate {
  const t = collection?.["atlas:item_template"];
  const tpl = isRecord(t) ? t : {};
  const assets = isRecord(tpl.assets) ? tpl.assets : {};
  const cog = isRecord(assets.cog) ? assets.cog : {};
  const props = isRecord(tpl.properties) ? tpl.properties : {};
  const band = Array.isArray(cog.bands) && isRecord(cog.bands[0]) ? cog.bands[0] : {};
  const rescale = pair(cog["atlas:rescale"]) ?? DEFAULT_ITEM_TEMPLATE.rescale;
  const colormap = PALETTES.includes(cog["atlas:colormap"] as Palette)
    ? (cog["atlas:colormap"] as Palette)
    : DEFAULT_ITEM_TEMPLATE.colormap;
  const bidx = cog["atlas:bidx"];
  return {
    rescale,
    colormap,
    valueRange: pair(props["atlas:value_range"]) ?? rescale,
    nodata: typeof band.nodata === "number" ? band.nodata : DEFAULT_ITEM_TEMPLATE.nodata,
    unit: typeof band.unit === "string" ? band.unit : DEFAULT_ITEM_TEMPLATE.unit,
    bidx: typeof bidx === "number" && Number.isInteger(bidx) && bidx >= 1 ? bidx : 1,
    title: typeof cog.title === "string" && cog.title.trim() ? cog.title.trim() : null,
  };
}
