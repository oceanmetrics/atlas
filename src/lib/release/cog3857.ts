// The EPSG:3857 copies of a MarineSensitivity release's COGs, read from the release's side table (build week 6
// step 5, decisions D7 and D8: titiler's retirement).
//
// MST's published releases are immutable, so their tables keep naming the 4326 originals (`cog_url`, path-style)
// and nothing in them points at a copy. The atlas pipeline's `build.py cog-3857-batch` writes the copies beside the
// release and one side table, `{base}{ver}/tables/cog_3857.parquet`, keyed by the ORIGINAL's `content_hash` (the
// store key, which is the original's file stem): the copy's key, its zoom range and, per band, `data_type`,
// `nodata`, `statistics` and the 32-bucket `histogram` read from the full-resolution 4326 original.
//
// Hrefs: the copy is its key under `dataBase(ver)` (on the build's storage host), the original is `onStorage(cogUrl)`
// (`catalog/storage.ts`, D7's rebase at read).
//
// `resolveCog3857(ver, cogUrl)` is the one door: it answers the same `RasterChoice` as `raster/cog.ts`
// `rasterChoiceOf` does for a STAC Item, so a lens draws the copy with `cogRasterSource` and reads values from the
// original with `cogPoint.ts`, or, when the release has no side table, no row for that COG, or the URL is not a
// store key, it answers `{ kind: "titiler" }` and the lens keeps its titiler path (until titiler retires). It
// never throws: a side table that cannot be read is the same as none.
//
// The shared pool (D8 part 2): the copies are content addressed (the original's hash is its file stem, shared
// across releases), so one table at the registry root, `{PUBLIC_DATA_BASE}tables/cog_3857.parquet`, covers every
// release after v7 (v7b, v7c) and the OM aquamaps_native registry: its own copies at `marine-atlas/cog_3857/<hash>_3857.tif`
// and v7's rows as they are (their keys under `marine-atlas/v7/cog_3857/`). `resolveCog3857` reads it FIRST (its
// footer once per page, whatever the release) and the release's own table only for a hash it lacks.
//
// The table is sorted by `content_hash` in row groups of 512, so a read of one hash (hyparquet's `filter`) skips
// the other groups by their statistics; the Parquet reader is a dynamic import (scripts/size-budget-core.mjs keeps
// hyparquet out of the static graph).
import type { CogAsset } from "@oceanmetrics/map";
import type { RasterChoice } from "../raster/cog";
import { onStorage } from "../catalog/storage";
import { PUBLIC_DATA_BASE, dataBase, dataUrl, registryUrl, type SessionLike } from "./dataBase";

/** the side table's path inside a release, and the shared table's under the registry root. */
export const COG_3857_TABLE = "tables/cog_3857.parquet";
/** the asset keys the choice carries, as a published Item's (`cog` the original, `cog_3857` its copy). */
export const ORIGINAL_KEY = "cog";
export const COPY_KEY = "cog_3857";
const ROOT = "marine-atlas/";
const COG_T = "image/tiff; application=geotiff; profile=cloud-optimized";

export interface BandStatistics {
  minimum: number;
  maximum: number;
  mean?: number;
  stddev?: number;
  valid_percent?: number;
}

export interface BandHistogram {
  count: number;
  min: number;
  max: number;
  buckets: number[];
}

/** one side-table row, as the app uses it. */
export interface Cog3857Row {
  contentHash: string;
  /** the original as the release tables name it. */
  url: string;
  /** the copy's bucket key, `marine-atlas/<ver>/cog_3857/<path>_3857.tif`. */
  key: string;
  zoom: [number, number] | null;
  bands: {
    data_type: string | null;
    nodata: number | null;
    statistics: BandStatistics | null;
    histogram: BandHistogram | null;
  }[];
}

/** the draw hints a lens has for the COG (the release tables' `rescale_min/max`, `colormap`, the band). */
export type CogHints = Pick<CogAsset, "atlas:bidx" | "atlas:rescale" | "atlas:colormap" | "title">;

/** the store key of an original COG URL (its file stem: MST names every stored object `<content_hash>.tif`), or
 * null when the URL is not a `.tif` with a hex stem. */
export function contentHashOf(url: string): string | null {
  const m = /\/([0-9a-f]{8,64})\.tif(?:[?#].*)?$/.exec(url);
  return m ? m[1] : null;
}

/** the copy's absolute URL: the key under the data base (`dataBase(ver)` ends in `marine-atlas/`, the key starts
 * with it); null for a key outside `marine-atlas/`. */
export function copyHref(key: string, base: string): string | null {
  if (!key.startsWith(ROOT)) return null;
  return `${base.endsWith("/") ? base : `${base}/`}${key.slice(ROOT.length)}`;
}

/** the side table's URL for `ver` (on a preview session's data prefix when it offers one). */
export function sideTableUrl(ver: string, session?: SessionLike | null): string {
  return dataUrl(ver, COG_3857_TABLE, session);
}

/** the shared table's URL: one for every release, on the public registry root (its copies' keys are public). */
export function sharedTableUrl(): string {
  return registryUrl(COG_3857_TABLE);
}

function num(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "bigint") return Number(v);
  if (typeof v === "number") return v; // NaN kept: a NaN nodata is a nodata
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function list<T>(v: unknown): (T | null)[] {
  return v === null || v === undefined ? [] : Array.from(v as ArrayLike<T | null>);
}

/** a Parquet record -> a row; null for a record without a hash or a key. */
export function rowFromRecord(rec: Record<string, unknown>): Cog3857Row | null {
  const contentHash = typeof rec.content_hash === "string" ? rec.content_hash : null;
  const key = typeof rec.cog_3857_key === "string" ? rec.cog_3857_key : null;
  if (!contentHash || !key) return null;
  const n = Number(num(rec.bands) ?? 0);
  const types = list<string>(rec.data_type);
  const nodata = list<unknown>(rec.nodata);
  const stats = list<Record<string, unknown>>(rec.statistics);
  const hist = list<Record<string, unknown>>(rec.histogram);
  const zmin = num(rec.zoom_min);
  const zmax = num(rec.zoom_max);
  return {
    contentHash,
    url: String(rec.url ?? ""),
    key,
    zoom: zmin !== null && zmax !== null ? [zmin, zmax] : null,
    bands: Array.from({ length: n }, (_, i) => {
      const s = stats[i];
      const h = hist[i];
      return {
        data_type: types[i] ?? null,
        nodata: num(nodata[i]),
        statistics: s ? (Object.fromEntries(
          Object.entries(s).filter(([, v]) => v !== null).map(([k, v]) => [k, Number(v)]),
        ) as unknown as BandStatistics) : null,
        histogram: h ? {
          count: Number(h.count),
          min: Number(h.min),
          max: Number(h.max),
          buckets: Array.from(h.buckets as ArrayLike<number | bigint>, Number),
        } : null,
      };
    }),
  };
}

/** STAC nodata spelling of a number (NaN -> "nan"). */
function stacNodata(v: number | null): number | string | null {
  if (v === null) return null;
  if (Number.isNaN(v)) return "nan";
  if (v === Infinity) return "inf";
  if (v === -Infinity) return "-inf";
  return v;
}

/** the row as the `cog` choice `rasterChoiceOf` gives for a published Item: `draw` the 3857 copy (roles data +
 * visual, `atlas:zoom`), `values` the 4326 original, both with the same bands and the lens's hints. */
export function choiceOfRow(row: Cog3857Row, base: string, originalUrl: string, hints: CogHints = {}): RasterChoice {
  const href = copyHref(row.key, base);
  if (!href) return { kind: "titiler" };
  const bands = row.bands.map((b) => ({
    ...(b.data_type ? { data_type: b.data_type } : {}),
    nodata: stacNodata(b.nodata),
    ...(b.statistics ? { statistics: b.statistics } : {}),
    ...(b.histogram ? { histogram: b.histogram } : {}),
  }));
  const common = { type: COG_T, bands, ...hints } as Omit<CogAsset, "href">;
  // the original as the release names it, moved onto this build's storage host (D7: rebased at read, never rewritten)
  const values: CogAsset = { ...common, href: onStorage(originalUrl), roles: ["data"], "proj:code": "EPSG:4326" };
  const draw: CogAsset = {
    ...common,
    href,
    roles: ["data", "visual"],
    "proj:code": "EPSG:3857",
    ...(row.zoom ? { "atlas:zoom": row.zoom } : {}),
  };
  return { kind: "cog", draw: { key: COPY_KEY, asset: draw }, values: { key: ORIGINAL_KEY, asset: values } };
}

// ---- the reader ----

type Opened = { file: unknown; metadata: unknown } | null;
const opened = new Map<string, Promise<Opened>>();
const rows = new Map<string, Promise<Cog3857Row | null>>();

export function clearCog3857Cache(): void {
  opened.clear();
  rows.clear();
}

async function hyparquet() {
  const [h, { compressors }] = await Promise.all([import("hyparquet"), import("hyparquet-compressors")]);
  return { ...h, compressors };
}

/** the side table opened once per source (its footer read); null when it is absent or unreadable. */
function open(source: string | ArrayBuffer): Promise<Opened> {
  const id = typeof source === "string" ? source : null;
  const hit = id ? opened.get(id) : undefined;
  if (hit) return hit;
  const p = (async (): Promise<Opened> => {
    try {
      const { asyncBufferFromUrl, parquetMetadataAsync } = await hyparquet();
      const file = typeof source === "string" ? await asyncBufferFromUrl({ url: source }) : source;
      return { file, metadata: await parquetMetadataAsync(file) };
    } catch {
      return null; // no side table (403/404 on the bucket), or not Parquet: every COG stays on titiler
    }
  })();
  if (id) opened.set(id, p);
  return p;
}

/** the side-table row of `contentHash`, or null (no table, no row, an unreadable table). */
export function readCog3857Row(source: string | ArrayBuffer, contentHash: string): Promise<Cog3857Row | null> {
  const id = typeof source === "string" ? `${source}#${contentHash}` : null;
  const hit = id ? rows.get(id) : undefined;
  if (hit) return hit;
  const p = (async (): Promise<Cog3857Row | null> => {
    const t = await open(source);
    if (!t) return null;
    try {
      const { parquetReadObjects, compressors } = await hyparquet();
      const recs = (await parquetReadObjects({
        file: t.file as never,
        metadata: t.metadata as never,
        compressors,
        filter: { content_hash: { $eq: contentHash } },
      })) as Record<string, unknown>[];
      return recs.length ? rowFromRecord(recs[0]) : null;
    } catch {
      return null;
    }
  })();
  if (id) rows.set(id, p);
  return p;
}

export interface ResolveOptions {
  session?: SessionLike | null;
  /** the release's side table itself (tests), instead of `sideTableUrl(ver)`. */
  source?: string | ArrayBuffer;
  /** the shared table itself (tests), instead of `sharedTableUrl()`; `null` skips it. */
  sharedSource?: string | ArrayBuffer | null;
}

/** how release `ver` draws the COG at `cogUrl`: its 3857 copy from the shared table when it has the hash, else
 * from the release's side table (a `cog` choice), else titiler. Never throws. */
export async function resolveCog3857(
  ver: string,
  cogUrl: string,
  hints: CogHints = {},
  opts: ResolveOptions = {},
): Promise<RasterChoice> {
  const hash = contentHashOf(cogUrl);
  if (!hash) return { kind: "titiler" };
  const shared = opts.sharedSource === undefined ? sharedTableUrl() : opts.sharedSource;
  if (shared !== null) {
    const row = await readCog3857Row(shared, hash);
    // the shared table's keys (its own and v7's) are on the public root, whatever the session
    if (row && row.contentHash === hash) return choiceOfRow(row, PUBLIC_DATA_BASE, cogUrl, hints);
  }
  const row = await readCog3857Row(opts.source ?? sideTableUrl(ver, opts.session), hash);
  if (!row || row.contentHash !== hash) return { kind: "titiler" };
  return choiceOfRow(row, dataBase(ver, opts.session), cogUrl, hints);
}
