// The browser COG renderer behind the `RasterSource` seam (build week 2 step 3): an Item whose COG has an
// EPSG:3857 copy (`cog_3857`, written at publish by `pipeline/atlas_pipeline/cog.py`) is drawn by MapLibre's
// `cog://` protocol through @oceanmetrics/map's `cogSlot`, with no tile server; every other raster Item stays on
// stock titiler (`tiles.ts`), the fallback until every published COG has a 3857 asset (titiler retires in build
// week 6). The choice is per Item, by `pickCogAssets` (`rasterChoiceOf`).
//
// The rules are platform spike 3's, kept by the package and not repeated here:
//   - the protocol draws only the 3857 asset (`cogSlot` throws a `CogProjectionError` for anything else);
//   - the legend's numbers are the STAC `statistics` and `histogram` of the band (`legendFromStac`), written at
//     publish from the full-resolution 4326 original: never computed here, never read from an overview;
//   - the point read (the hover/click value and the flower's petals) reads the 4326 original (`cogPoint.ts`).
//
// One MapLibre style (CLAUDE.md): the slot is MOUNTED on a recorder, not on the map, and what it adds (one
// raster source, one raster layer) goes into the composed style as a `RasterLayerSpec`; `setStyle(diff)` does the
// rest. Mounting also hands the protocol the slot's colour function (the band, the ramp over the range, the band's
// nodata transparent), which the protocol keys by the asset's `cogHref` (the href with the band, `?b=<atlas:bidx>`,
// since @oceanmetrics/map 0.2.2: the eight EOV Items are bands of one file, and the protocol's caches and MapLibre's
// tile cache are keyed by url): so at most ONE slot per `cogHref` is mounted at a time (`live` below).
import {
  cogHref,
  cogSlot,
  loadCogProtocol,
  pickCogAssets,
  type CogAsset,
  type CogItemLike,
  type LayerSlot,
  type LegendSpec,
} from "@oceanmetrics/map";
import type { Map as MapLibreMap } from "maplibre-gl";
import { isCogAsset } from "../catalog/assets";
import { assetUrl } from "../catalog/load";
import type { StacItem } from "../catalog/types";
import type { Histogram } from "../map/density";
import type { RasterSource } from "./tiles";

/** an asset of the Item, by its key, with its href made absolute. */
export interface KeyedCogAsset {
  key: string;
  asset: CogAsset;
}

/** how an Item's raster is drawn: in the browser (`cog`: the 3857 asset to draw, the asset to read values
 * from) or by titiler (no 3857 asset). */
export type RasterChoice =
  { kind: "cog"; draw: KeyedCogAsset; values: KeyedCogAsset } | { kind: "titiler" };

const TITILER: RasterChoice = { kind: "titiler" };

/** the Item's cloud-optimized GeoTIFF assets in the package's shape, hrefs absolute (an asset whose href does not
 * resolve is left out). */
export function cogItemOf(item: StacItem): CogItemLike {
  const assets: Record<string, CogAsset> = {};
  for (const [key, a] of Object.entries(item.assets ?? {})) {
    if (!isCogAsset(a)) continue;
    const href = assetUrl(item, a);
    if (href) assets[key] = { ...(a as unknown as CogAsset), href };
  }
  const proj = item.properties?.["proj:code"];
  return {
    id: item.id,
    properties: { "proj:code": typeof proj === "string" ? proj : null },
    assets,
  };
}

/** the renderer of an Item: `cog` when `pickCogAssets` finds a data asset in EPSG:3857, else `titiler`. */
export function rasterChoiceOf(item: StacItem | null): RasterChoice {
  if (!item) return TITILER;
  const { draw, values } = pickCogAssets(cogItemOf(item));
  return draw ? { kind: "cog", draw, values: values ?? draw } : TITILER;
}

// ---- the recorder: what cogSlot adds to a map, as style pieces ------------------------------------

interface Recorded {
  source: { type: "raster"; url?: string; tiles?: string[]; tileSize?: number };
  layer: { id: string; type: "raster"; paint?: Record<string, unknown> };
}

/** a stand-in map that keeps the one source and layer a slot adds (the slot's error listener is not wired: the
 * recorder never fires it). */
function recorder(): { map: MapLibreMap; recorded: () => Recorded } {
  let source: Recorded["source"] | null = null;
  let layer: Recorded["layer"] | null = null;
  const m = {
    addSource: (_id: string, spec: Recorded["source"]) => void (source = spec),
    addLayer: (spec: Recorded["layer"]) => void (layer = spec),
    getLayer: () => undefined,
    getSource: () => undefined,
    removeLayer: () => undefined,
    removeSource: () => undefined,
    on: () => undefined,
    off: () => undefined,
  };
  return {
    map: m as unknown as MapLibreMap,
    recorded: () => {
      if (!source?.url || !layer) throw new Error("cogSlot mounted no raster source and layer");
      return { source, layer };
    },
  };
}

// ---- the source -------------------------------------------------------------------------------------

/** a source's own colours (see `CogRasterOptions.paint`). */
export interface CogPainted {
  key: string;
  hash: string;
  colorFunction: (
    pixel: ArrayLike<number>,
    color: Uint8ClampedArray,
    metadata?: { noData?: number },
  ) => void;
}

export interface CogRasterOptions {
  /** the colour domain (`atlas:rescale` for the slot): the lens's own (the Item's `atlas:value_range`, else the
   * asset's rescale); absent = the asset's `atlas:rescale`, else its band statistics. */
  domain?: [number, number] | null;
  /** the layer opacity; default the slot's. */
  opacity?: number;
  /** the legend title. */
  title?: string;
  /** the app's own colours instead of the asset's `atlas:colormap`: the url's `#color:` hash and the protocol's
   * colour function, built by `raster/paint.ts` (`paintFor`, a lazy module's, so the colour code stays off the
   * static path); `key` tells two paints apart. */
  paint?: CogPainted;
}

export interface CogRasterSource extends RasterSource {
  readonly kind: "cog";
  /** the mounted slot (its legend, its unmount). */
  readonly slot: LayerSlot;
  /** the asset drawn, as the slot was given it. */
  readonly asset: CogAsset;
  /** the MapLibre tile template (`cog://<href>?b=<bidx>#color:.../{z}/{x}/{y}`). */
  readonly template: string;
  /** the layer opacity the slot set. */
  readonly opacity: number;
  /** the source maxzoom (`atlas:zoom[1]`, the COG's own full-resolution zoom): MapLibre overzooms above it
   * instead of asking the protocol for tiles finer than the file; null = not stated. */
  readonly maxzoom: number | null;
  /** the legend from STAC alone (`legendFromStac`). */
  legend(): LegendSpec;
}

/** the one live (mounted) source per `cogHref` (a file's band), see the module header. */
const live = new Map<string, { key: string; source: CogRasterSource }>();

/**
 * The browser-drawn `RasterSource` of `item`'s EPSG:3857 COG `asset` (`rasterChoiceOf(item).draw.asset`, href
 * absolute): `cogSlot` mounted on a recorder, its source turned into a tile template. Throws the package's
 * `CogProjectionError` for an asset that is not EPSG:3857. Idempotent: the same Item asset, domain and opacity
 * give the same source without mounting again; another range or ramp of the same band unmounts the previous one
 * first (the protocol holds one colour function per `cogHref`); another band of the file is a key of its own.
 */
export function cogRasterSource(
  item: StacItem,
  asset: CogAsset,
  opts: CogRasterOptions = {},
): CogRasterSource {
  const drawn: CogAsset = opts.domain ? { ...asset, "atlas:rescale": opts.domain } : asset;
  const proj = item.properties?.["proj:code"];
  const slot = cogSlot({ kind: "cog", id: item.id, variable: null }, drawn, {
    name: asset.title ?? asset.href,
    itemProjCode: typeof proj === "string" ? proj : null,
    ...(opts.title ? { title: opts.title } : {}),
    ...(opts.opacity === undefined ? {} : { opacity: opts.opacity }),
  });
  const zoom = drawn["atlas:zoom"];
  const maxzoom =
    Array.isArray(zoom) && typeof zoom[1] === "number" && Number.isFinite(zoom[1]) ? zoom[1] : null;
  const href = cogHref(drawn);
  const key = JSON.stringify([
    href,
    drawn["atlas:rescale"] ?? null,
    drawn["atlas:colormap"] ?? null,
    opts.opacity ?? null,
    opts.title ?? null,
    opts.paint?.key ?? null,
  ]);
  const hit = live.get(href);
  if (hit && hit.key === key) return hit.source;

  const rec = recorder();
  if (hit) hit.source.slot.unmount(rec.map);
  slot.mount(rec.map, null, null);
  const { source, layer } = rec.recorded();
  let base = source.url!;
  if (opts.paint) {
    // the slot queued its own colour function (the named ramp) on the protocol's load; this one is queued on the
    // same promise after it, so it is the one the protocol keeps for this href
    const fn = opts.paint.colorFunction;
    void loadCogProtocol().then((p) => p.setColorFunction(href, fn));
    base = `cog://${href}#${opts.paint.hash}`;
  }
  const opacity = layer.paint?.["raster-opacity"];
  const tileUrl = (z: number | string, x: number | string, y: number | string) =>
    `${base}/${z}/${x}/${y}`;
  const src: CogRasterSource = {
    kind: "cog",
    slot,
    asset: drawn,
    template: tileUrl("{z}", "{x}", "{y}"),
    opacity: typeof opacity === "number" ? opacity : 0.85,
    maxzoom,
    tileUrl,
    legend: () => slot.legend()!,
  };
  live.set(href, { key, source: src });
  return src;
}

/** unmount every live COG source (tests; the lens never needs it: the next source of a band replaces it). */
export function releaseCogSources(): void {
  const rec = recorder();
  for (const { source } of live.values()) source.slot.unmount(rec.map);
  live.clear();
}

/** the legend histogram (`lib/map/density.ts`'s shape) of a STAC legend: the band's `histogram` buckets as they
 * were published, or null when the asset carries none. */
export function stacHistogram(legend: LegendSpec): Histogram | null {
  const h = legend.histogram;
  if (!h || h.buckets.length === 0) return null;
  return { binCount: h.buckets.length, counts: [...h.buckets], min: h.min, max: h.max };
}
