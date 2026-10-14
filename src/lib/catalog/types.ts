// The STAC subset the atlas reads (CLAUDE.md "Catalog contract"): a Catalog, Collections carrying
// `stac-sdm` / `scientific` / `contacts` / `providers` / `datacube` fields, and Items carrying
// `atlas:dims`. Everything is optional beyond `id`/`links`/`type`, and every extra STAC key a
// producer adds is carried through untouched (`[key: string]: unknown`); the loader validates only
// the structure the app depends on (load.ts), never the whole spec.

export interface StacLink {
  rel: string;
  href: string;
  type?: string;
  title?: string;
  [key: string]: unknown;
}

/** `table:columns` (STAC table extension). */
export interface TableColumn {
  name: string;
  type?: string;
  description?: string;
  [key: string]: unknown;
}

export interface StacAsset {
  href: string;
  /** media type, e.g. `application/vnd.pmtiles`, `application/vnd.apache.parquet`,
   * `image/tiff; application=geotiff; profile=cloud-optimized`. */
  type?: string;
  title?: string;
  description?: string;
  roles?: string[];
  "table:columns"?: TableColumn[];
  "table:row_count"?: number;
  /** the join key column of a values/crosswalk table (`FID`, or `h3`). */
  "atlas:key_column"?: string;
  /** the column of a (wide) values table holding THIS item's values. */
  "atlas:value_column"?: string;
  /** the PMTiles layer names. */
  "pmtiles:layers"?: string[];
  /** the feature id property of a PMTiles grid (`FID`), the key `promoteId` promotes. */
  "atlas:id_field"?: string;
  "sdm:h3_resolution"?: number;
  /** a multi-band COG: the 1-based band to draw (`bidx`). Omitted = band 1. */
  "atlas:bidx"?: number;
  /** a COG's display rescale: `[min, max]`, or `"auto"` = read it from titiler `/cog/statistics`. */
  "atlas:rescale"?: [number, number] | "auto";
  /** a named titiler colormap (`spectral_r`, ...); omitted = the default ramp. */
  "atlas:colormap"?: string;
  [key: string]: unknown;
}

export interface StacContact {
  name?: string;
  organization?: string;
  position?: string;
  emails?: { value: string; roles?: string[] }[];
  roles?: string[];
  [key: string]: unknown;
}

export interface StacProvider {
  name: string;
  description?: string;
  roles?: string[];
  url?: string;
}

/**
 * One `cube:dimensions` entry (STAC datacube extension, plus atlas conventions). Spatial and
 * geometry dimensions are the grid itself; every other dimension (`other`, `temporal`, ...) with
 * `values` is a selector. A value may be a bare string/number or `{value, label}`; labels may also
 * come from `atlas:labels`.
 */
export interface CubeDimension {
  type?: string;
  title?: string;
  description?: string;
  values?: (string | number | { value: string | number; label?: string })[];
  unit?: string;
  axis?: string;
  extent?: unknown[];
  /** `{value: label}`, an atlas convention for human labels of `values`. */
  "atlas:labels"?: Record<string, string>;
  [key: string]: unknown;
}

interface StacBase {
  stac_version?: string;
  stac_extensions?: string[];
  id: string;
  title?: string;
  description?: string;
  links: StacLink[];
  /** the absolute URL this object was loaded from -- recorded by the loader (load.ts), never part of
   * a producer's JSON; relative hrefs inside the object resolve against it. */
  "atlas:url"?: string;
  [key: string]: unknown;
}

export interface StacCatalog extends StacBase {
  type: "Catalog";
}

export interface StacCollection extends StacBase {
  type: "Collection";
  license?: string;
  version?: string;
  providers?: StacProvider[];
  contacts?: StacContact[];
  "sci:citation"?: string;
  "sci:doi"?: string;
  /** funders (BOEM, MBON, ...) until a standard field exists. */
  "atlas:funders"?: string[];
  "atlas:status"?: string;
  "atlas:access"?: string;
  "cube:dimensions"?: Record<string, CubeDimension>;
  "sdm:response_type"?: string;
  "sdm:method"?: string;
  "sdm:source_authority"?: string;
  "sdm:value_unit"?: string;
  "sdm:value_range"?: [number, number];
  extent?: { spatial?: { bbox?: number[][] }; temporal?: { interval?: unknown } };
  assets?: Record<string, StacAsset>;
}

export interface StacItemProperties {
  title?: string;
  description?: string;
  datetime?: string | null;
  /** one value per dimension: which cell of the cube this item is. */
  "atlas:dims"?: Record<string, string>;
  /** `richness` / `uncertainty` ... where `sdm:response_type` is `mixed`. */
  "atlas:metric"?: string;
  /** the observed [min, max] of this item's values: drives the legend and the colour domain. */
  "atlas:value_range"?: [number, number];
  "sdm:value_unit"?: string;
  "sdm:value_range"?: [number, number];
  "sdm:response_type"?: string;
  [key: string]: unknown;
}

export interface StacItem {
  type: "Feature";
  stac_version?: string;
  id: string;
  collection?: string;
  properties: StacItemProperties;
  assets: Record<string, StacAsset>;
  links: StacLink[];
  bbox?: number[];
  geometry?: unknown;
  /** see StacBase["atlas:url"]. */
  "atlas:url"?: string;
  [key: string]: unknown;
}
