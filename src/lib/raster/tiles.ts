// Stock titiler tile URLs (plan D4: "rasters are displayed through the existing stock titiler;
// numbers never come from it"). Byte-for-byte contract with titiler-v8, verified against
// atlas-refs/"parity scores app.md" §6.3 (`msens::cog_tile_url()`, viz.R:400-429) and
// atlas-refs/"parity species app.md" §2.4:
//
//   {host}/cog/tiles/WebMercatorQuad/{z}/{x}/{y}.png?url=<enc>&colormap_name=<c>&rescale=<min>,<max>
//
// `host` is CONFIGURATION — this module's one named constant — never a literal repeated at call
// sites (module contract). Score/metric values, cell ids and zonal statistics never flow through
// here; only the PNG tiles this renders. See point.ts for the one sanctioned `/cog/point` exception
// (species click values only) and ramps.ts for the color ramps `colormap_name` names.
import { encodeUrlReserved } from "./urlEncode";

/** the titiler deployment every release's `/cog` tiles and `/cog/point` are served from — hardcoded
 * for every release version (atlas-refs/"parity scores app.md": `tile_base_url <-
 * "https://titiler-v8.marinesensitivity.org"`, "hardcoded for every version"). This constant is the
 * one place that literal lives; everything else reads `TitilerConfig.host`. */
export const DEFAULT_TITILER_HOST = "https://titiler-v8.marinesensitivity.org";

export interface TitilerConfig {
  /** titiler origin, no trailing slash. */
  host: string;
}

export const DEFAULT_TITILER_CONFIG: TitilerConfig = { host: DEFAULT_TITILER_HOST };

export interface RasterTileParams {
  /** absolute https URL of the source COG (manifest's `metrics[...].cog` / `native_asset.asset_url`). */
  url: string;
  /** one of ramps.ts's `PaletteName`s — kept as a bare `string` here so this module never has to
   * import ramps.ts's palette/value logic, only pass through whatever name it is given. */
  colormapName: string;
  rescaleMin: number;
  rescaleMax: number;
  /** the 1-based band to draw from a multi-band COG (`&bidx=N`, appended AFTER `rescale` so a
   * single-band URL stays byte-identical to the cached ones). Omitted = titiler's default (band 1,
   * no `bidx` in the URL). The MST nc density COGs carry n, cv and ci90 as bands 1-3. */
  bidx?: number;
}

/** an EXPLICIT value → RGBA colormap instead of a named ramp — `msens::cog_tile_url(color = ...)`
 * (viz.R:412-420), used only by a binary mask overlay such as `_outside_pra`
 * (`{"1":[34,34,34,255]}`). Such a URL carries no `colormap_name` and no `rescale` at all, which is
 * why it is a separate parameter shape rather than a field on {@link RasterTileParams}. */
export interface RasterMaskTileParams {
  url: string;
  /** e.g. `{ "1": [34, 34, 34, 255] }`; serialized with `JSON.stringify`, then fully escaped. */
  colormap: Record<string, readonly [number, number, number, number]>;
}

/** the seam a future client-side COG renderer (plan D4, spike S3, deferred) swaps in behind: every
 * caller asks a `RasterSource` for a tile URL, never `titilerTileUrl` directly, so that swap touches
 * one factory, not every call site. */
export interface RasterSource {
  tileUrl(z: number, x: number, y: number, params: RasterTileParams): string;
}

/**
 * The stock titiler `/cog/tiles` URL, byte-for-byte. Parameter NAMES, ORDER and ENCODING are all
 * load-bearing (titiler/Varnish key their cache on the literal query string —
 * atlas-refs/"parity scores app.md" §11 "Varnish/`titilecache` keys on the full tile URL"): `url` is
 * percent-encoded with every RFC 3986 reserved character escaped (R's `URLencode(cog_url, reserved =
 * TRUE)` — see urlEncode.ts, NOT a bare `encodeURIComponent`); `colormap_name` and `rescale` are
 * written literally, unencoded — `rescale`'s comma is never `%2C`, matching the R-generated URLs
 * already warm in that cache.
 */
export function titilerTileUrl(
  config: TitilerConfig,
  z: number | string,
  x: number | string,
  y: number | string,
  params: RasterTileParams,
): string {
  return (
    `${config.host}/cog/tiles/WebMercatorQuad/${z}/${x}/${y}.png` +
    `?url=${encodeUrlReserved(params.url)}` +
    `&colormap_name=${params.colormapName}` +
    `&rescale=${params.rescaleMin},${params.rescaleMax}` +
    (params.bidx === undefined ? "" : `&bidx=${params.bidx}`)
  );
}

/**
 * The same `/cog/tiles` URL with an EXPLICIT colormap (`msens::cog_tile_url(color = ...)`,
 * viz.R:412-420): `?url={enc}&colormap={enc(json)}` — no `colormap_name`, no `rescale`. `z`/`x`/`y`
 * take `number | string` for the same reason {@link titilerTileUrl} does (see `map/layers/titiler.ts`:
 * MapLibre wants ONE template string carrying literal `{z}/{x}/{y}`, so the template and the
 * concrete URL must come out of the same formatter or they drift).
 */
export function titilerMaskTileUrl(
  config: TitilerConfig,
  z: number | string,
  x: number | string,
  y: number | string,
  params: RasterMaskTileParams,
): string {
  return (
    `${config.host}/cog/tiles/WebMercatorQuad/${z}/${x}/${y}.png` +
    `?url=${encodeUrlReserved(params.url)}` +
    `&colormap=${encodeUrlReserved(JSON.stringify(params.colormap))}`
  );
}

/** the default, stock-titiler-backed `RasterSource`. */
export function createTitilerRasterSource(
  config: TitilerConfig = DEFAULT_TITILER_CONFIG,
): RasterSource {
  return {
    tileUrl: (z, x, y, params) => titilerTileUrl(config, z, x, y, params),
  };
}
