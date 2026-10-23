// A MarineSensitivity release's COGs in the browser (build week 6 step 5, titiler's retirement precondition): the
// lazy module the species and Scores lenses load (`loadReleaseCog`, a dynamic import, so geotiff.js, hyparquet and
// the COG source stay off the static path) to draw a release COG from its EPSG:3857 copy.
//
// The rules, one per export:
//   - `releaseCogDraw`: the side table (`release/cog3857.ts` `resolveCog3857`) resolves the COG -> the copy is
//     drawn through the `RasterSource` seam (`raster/cog.ts` `cogRasterSource`, painted with the app's own palette
//     stops over the lens's rescale, or with an exact value -> colour table for a mask), and the legend's histogram
//     is the side table's (32 buckets from the full-resolution 4326 original); unresolved -> `{ kind: "titiler" }`,
//     and the lens keeps its titiler path (until titiler retires);
//   - `releaseOriginal`: the 4326 original's href when the side table resolves the COG (the point read and the
//     bounds read go there), else null (titiler's `/cog/point` and `/cog/info`);
//   - `createReleaseValueSource` (`cogPoint.ts`, every band of the full-resolution pixel of the original) and
//     `createReleaseBoundsSource` (the original's GeoTIFF header extent, narrowed by `bounds.ts`'s rule with pixel
//     reads): the two numbers titiler gave the lenses, read from the file instead.
//
// The side table carries no extent: the bounds come from the original's header (one 16 kB range read, the
// block the point read opens anyway), which is exactly what titiler's `/cog/info` answered.
import { openCog, pointValue } from "@oceanmetrics/map";
import { contentHashOf, resolveCog3857 } from "../release/cog3857";
import type { SessionLike } from "../release/dataBase";
import type { StacItem } from "../catalog/types";
import type { Histogram } from "../map/density";
import type { Bbox } from "../../lens/species/data/shards";
import { createFileBoundsSource, type BoundsSource } from "./bounds";
import { cogRasterSource, stacHistogram, type CogRasterSource } from "./cog";
import { paintFor, type CogPaint } from "./paint";
import { createCogValueSource, type PixelReader } from "./cogPoint";
import type { ValueSource } from "./point";

/** a release COG drawn in the browser: the source behind the `RasterSource` seam, the legend histogram from the
 * side table, and the two hrefs (the 3857 copy drawn, the 4326 original read). */
export interface ReleaseCogDraw {
  kind: "cog";
  source: CogRasterSource;
  histogram: Histogram | null;
  drawHref: string;
  valuesHref: string;
}

export type ReleaseCogChoice = ReleaseCogDraw | { kind: "titiler" };

const TITILER: ReleaseCogChoice = { kind: "titiler" };

export interface ReleaseCogRequest {
  ver: string;
  /** the COG as the release names it (`cog_url`, a shard asset's `url`, a manifest `cog`). */
  cogUrl: string;
  /** the colour domain (the release's `rescale`); null = the band's statistics (a mask's [1, 1]). */
  domain: [number, number] | null;
  paint: CogPaint;
  opacity: number;
  title?: string;
  session?: SessionLike | null;
  /** the side table itself (tests), instead of `{ver}/tables/cog_3857.parquet`. */
  table?: string | ArrayBuffer;
}

/** a stand-in Item for `cogRasterSource` (it reads the id and the item's `proj:code`). */
function itemOf(ver: string, cogUrl: string): StacItem {
  return {
    type: "Feature",
    id: `${ver}:${contentHashOf(cogUrl) ?? cogUrl}`,
    properties: { "proj:code": "EPSG:3857" },
    assets: {},
    links: [],
  } as unknown as StacItem;
}

/** how release `ver` draws `cogUrl`: its 3857 copy when the side table has the original's content hash, else
 * titiler. Never throws (an unreadable table, a release without a registry, a copy that is not EPSG:3857 are all
 * titiler). */
export async function releaseCogDraw(req: ReleaseCogRequest): Promise<ReleaseCogChoice> {
  try {
    const choice = await resolveCog3857(
      req.ver,
      req.cogUrl,
      {},
      { session: req.session ?? null, ...(req.table ? { source: req.table } : {}) },
    );
    if (choice.kind !== "cog") return TITILER;
    const source = cogRasterSource(itemOf(req.ver, req.cogUrl), choice.draw.asset, {
      domain: req.domain,
      opacity: req.opacity,
      paint: paintFor(req.paint, choice.draw.asset, req.domain),
      ...(req.title ? { title: req.title } : {}),
    });
    return {
      kind: "cog",
      source,
      histogram: stacHistogram(source.legend()),
      drawHref: choice.draw.asset.href,
      valuesHref: choice.values.asset.href,
    };
  } catch {
    return TITILER;
  }
}

/** the 4326 original of `cogUrl` when the side table resolves it (where values and bounds are read), else null. */
export async function releaseOriginal(
  ver: string,
  cogUrl: string,
  opts: { session?: SessionLike | null; table?: string | ArrayBuffer } = {},
): Promise<string | null> {
  try {
    const c = await resolveCog3857(
      ver,
      cogUrl,
      {},
      {
        session: opts.session ?? null,
        ...(opts.table ? { source: opts.table } : {}),
      },
    );
    return c.kind === "cog" ? c.values.asset.href : null;
  } catch {
    return null;
  }
}

/** the point read of a browser-drawn release COG (`cogPoint.ts`): `cogUrl` is the 4326 original's href. */
export function createReleaseValueSource(read: PixelReader = pointValue): ValueSource {
  return createCogValueSource(read);
}

/** the slice of a geotiff.js GeoTIFF the bounds read needs. */
export interface GeoTIFFLike {
  getImage(): Promise<{ getBoundingBox(): number[] }>;
}

/** the extent of a GeoTIFF from its header (`getBoundingBox`, the file's own CRS). */
export async function headerBounds(
  href: string,
  open: (href: string) => Promise<GeoTIFFLike> = openCog as unknown as (
    href: string,
  ) => Promise<GeoTIFFLike>,
): Promise<Bbox | null> {
  const tiff = await open(href);
  const img = await tiff.getImage();
  const b = img.getBoundingBox();
  return b.length === 4 && b.every((v) => Number.isFinite(v)) ? [b[0], b[1], b[2], b[3]] : null;
}

/** the camera's last resort read from the 4326 original (`bounds.ts` `createFileBoundsSource`): `cogBounds`
 * takes the original's href. */
export function createReleaseBoundsSource(
  bounds: (href: string) => Promise<Bbox | null> = (h) => headerBounds(h),
  read: PixelReader = pointValue,
): BoundsSource {
  return createFileBoundsSource({
    bounds,
    value: async (href, lon, lat) => {
      const v = await read(href, [lon, lat]);
      return v ? (v[0] ?? null) : null;
    },
  });
}
