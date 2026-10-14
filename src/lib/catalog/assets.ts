// Which asset of an Item/Collection plays which role in the lens: the hex-grid PMTiles, the Parquet
// values column, a cloud-optimized GeoTIFF, the collection's MapLibre style. Pure lookups over the
// STAC objects; every URL is resolved against the document that lists the asset (`assetUrl`).
import { assetUrl } from "./load";
import type { StacAsset, StacCollection, StacItem } from "./types";

export const PMTILES_TYPE = "application/vnd.pmtiles";
export const PARQUET_TYPE = "application/vnd.apache.parquet";
/** `image/tiff; application=geotiff; profile=cloud-optimized` (parameter order/spacing varies). */
const COG_TYPE_RE = /^image\/tiff\b.*cloud-optimized/i;

export function isCogAsset(asset: StacAsset): boolean {
  return typeof asset.type === "string" && COG_TYPE_RE.test(asset.type);
}

export interface HexAsset {
  url: string;
  /** the vector layer inside the archive. */
  layer: string;
  /** the feature id property `promoteId` promotes (`FID`). */
  idField: string;
}

/** the PMTiles hex grid: the item's own `hex` asset, else the collection's (a collection-level
 * asset shared by every item). `null` when neither lists one. */
export function hexAssetOf(
  item: StacItem | null,
  collection: StacCollection | null,
): HexAsset | null {
  const candidates: [StacAsset | undefined, StacItem | StacCollection | null][] = [
    [item?.assets?.hex, item],
    [collection?.assets?.hex, collection],
  ];
  for (const [asset, owner] of candidates) {
    if (!asset || !owner) continue;
    const url = assetUrl(owner, asset);
    if (!url) continue;
    return {
      url,
      layer: asset["pmtiles:layers"]?.[0] ?? "hex",
      idField: asset["atlas:id_field"] ?? "FID",
    };
  }
  return null;
}

export interface ValuesAsset {
  url: string;
  /** the join key column (`FID`). */
  keyColumn: string;
  /** the column of the (wide) table holding this item's values. */
  valueColumn: string;
}

/** the Parquet `values` asset of an item: `FID` + the item's own value column. `null` when the item
 * lists none or names no value column. */
export function valuesAssetOf(item: StacItem | null): ValuesAsset | null {
  const asset = item?.assets?.values;
  if (!item || !asset) return null;
  const url = assetUrl(item, asset);
  const valueColumn = asset["atlas:value_column"];
  if (!url || typeof valueColumn !== "string" || valueColumn.length === 0) return null;
  return { url, keyColumn: asset["atlas:key_column"] ?? "FID", valueColumn };
}

export interface RasterAsset {
  url: string;
  /** the 1-based band of a multi-band COG (`atlas:bidx`); absent = band 1. */
  bidx?: number;
  /** a named titiler colormap (`atlas:colormap`); absent = the default ramp. */
  colormap?: string;
  /** `[min, max]` or `"auto"` (`atlas:rescale`); absent = the item's own value range. */
  rescale?: [number, number] | "auto";
}

function rescaleOf(v: unknown): [number, number] | "auto" | undefined {
  if (v === "auto") return "auto";
  if (
    Array.isArray(v) &&
    v.length === 2 &&
    typeof v[0] === "number" &&
    typeof v[1] === "number" &&
    Number.isFinite(v[0]) &&
    Number.isFinite(v[1])
  ) {
    return [v[0], v[1]];
  }
  return undefined;
}

/** the item's cloud-optimized GeoTIFF (preferring a `data`-role asset), rendered through titiler,
 * with the band / colormap / rescale the asset names (`atlas:bidx|colormap|rescale`). */
export function rasterAssetOf(item: StacItem | null): RasterAsset | null {
  if (!item) return null;
  const cogs = Object.values(item.assets ?? {}).filter(isCogAsset);
  const asset = cogs.find((a) => a.roles?.includes("data")) ?? cogs[0];
  if (!asset) return null;
  const url = assetUrl(item, asset);
  if (!url) return null;
  const bidx = asset["atlas:bidx"];
  const colormap = asset["atlas:colormap"];
  const rescale = rescaleOf(asset["atlas:rescale"]);
  return {
    url,
    ...(typeof bidx === "number" && Number.isInteger(bidx) && bidx >= 1 ? { bidx } : {}),
    ...(typeof colormap === "string" && colormap ? { colormap } : {}),
    ...(rescale ? { rescale } : {}),
  };
}

/** the collection's MapLibre style document (`styles/default.json`): the `style` asset, else a link
 * `rel: "style"`. `null` when it publishes none. */
export function styleUrlOf(collection: StacCollection | null): string | null {
  if (!collection) return null;
  const asset = collection.assets?.style;
  if (asset) return assetUrl(collection, asset);
  const link = collection.links.find((l) => l.rel === "style");
  return link ? assetUrl(collection, link) : null;
}
