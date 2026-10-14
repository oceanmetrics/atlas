// The hex centroid table of a collection (`hex_centroids` asset: Parquet `FID`, `lon`, `lat`, one row
// per hex of the grid; 27,841 rows, ~0.6 MB for BioTrack). The hex PMTiles are tiled and partial, so
// "which cells lie inside this place" cannot be answered from what the map has loaded; it is answered
// from this table, in the browser, by `lib/geo/pip.ts`. hyparquet is a DYNAMIC import (the size
// budget forbids it in the static graph), so this module is safe to import for its types and the
// pure parts.
import { assetUrl, type Loaded } from "./load";
import type { StacCollection } from "./types";

export interface Centroids {
  fids: Int32Array;
  lon: Float64Array;
  lat: Float64Array;
}

export interface CentroidsAsset {
  url: string;
  keyColumn: string;
}

/** the collection's `hex_centroids` asset; `null` when it lists none (no summaries then). */
export function centroidsAssetOf(collection: StacCollection | null): CentroidsAsset | null {
  const asset = collection?.assets?.hex_centroids;
  if (!collection || !asset) return null;
  const url = assetUrl(collection, asset);
  return url ? { url, keyColumn: asset["atlas:key_column"] ?? "FID" } : null;
}

function num(v: unknown): number {
  if (v === null || v === undefined) return Number.NaN; // Number(null) is 0: a null key is not cell 0
  return typeof v === "bigint" ? Number(v) : typeof v === "number" ? v : Number(v);
}

/** Parquet rows -> typed arrays; a row with a non-finite key or coordinate is dropped. */
export function centroidsFromRows(
  rows: readonly Record<string, unknown>[],
  keyColumn = "FID",
): Centroids {
  const fids: number[] = [];
  const lon: number[] = [];
  const lat: number[] = [];
  for (const r of rows) {
    const f = num(r[keyColumn]);
    const x = num(r.lon);
    const y = num(r.lat);
    if (!Number.isFinite(f) || !Number.isFinite(x) || !Number.isFinite(y)) continue;
    fids.push(f);
    lon.push(x);
    lat.push(y);
  }
  return {
    fids: Int32Array.from(fids),
    lon: Float64Array.from(lon),
    lat: Float64Array.from(lat),
  };
}

/** Read the centroid table (an absolute URL, read by range; or an in-memory buffer for tests).
 * Never throws: a failure is a `network`/`parse`/`schema` error. */
export async function readCentroids(
  source: string | ArrayBuffer,
  keyColumn = "FID",
): Promise<Loaded<Centroids>> {
  const url = typeof source === "string" ? source : "(buffer)";
  try {
    const [{ asyncBufferFromUrl, parquetReadObjects }, { compressors }] = await Promise.all([
      import("hyparquet"),
      import("hyparquet-compressors"),
    ]);
    const file = typeof source === "string" ? await asyncBufferFromUrl({ url: source }) : source;
    const rows = (await parquetReadObjects({
      file,
      columns: [keyColumn, "lon", "lat"],
      compressors,
    })) as Record<string, unknown>[];
    return { ok: true, value: centroidsFromRows(rows, keyColumn) };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const kind =
      /column/i.test(message) && /not found/i.test(message)
        ? "schema"
        : /fetch|http|network/i.test(message)
          ? "network"
          : "parse";
    return { ok: false, error: { kind, url, message } };
  }
}
