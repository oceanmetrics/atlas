// places/fetchPlan.ts -- Deliverable 5: "show the fetch plan (tiles, MB) with progress; ask above
// 40 tiles or 150 MB" before any `cell_model` tile is downloaded. Real sizes via HEAD -- S3 exposes
// `Content-Length` on every object this app reads (measured against the real bucket, docs/engine.md)
// -- falling back to a documented average when a HEAD fails or omits it
// (`analysis/place.ts`'s own doc comment: "p50 2.1 MB / max 23.7 MB").
export const ASK_TILE_COUNT = 40;
export const ASK_BYTES = 150 * 1024 * 1024;
export const AVERAGE_TILE_BYTES = 2.1 * 1024 * 1024;

export interface FetchPlan {
  tileCount: number;
  bytes: number;
  /** `false` when at least one tile's size had to fall back to {@link AVERAGE_TILE_BYTES} (a
   * blocked/failed HEAD, or a response with no usable `Content-Length`) -- the panel says
   * "about N MB" rather than a falsely precise figure when this is `false`. */
  measured: boolean;
}

export async function estimateFetchPlan(
  urls: readonly string[],
  fetchImpl: typeof fetch = fetch,
): Promise<FetchPlan> {
  let bytes = 0;
  let measured = true;
  await Promise.all(
    urls.map(async (url) => {
      try {
        const res = await fetchImpl(url, { method: "HEAD" });
        const len = res.ok ? Number(res.headers.get("content-length")) : NaN;
        if (Number.isFinite(len) && len > 0) {
          bytes += len;
          return;
        }
      } catch {
        /* network/CORS failure: fall through to the average, same as a missing header */
      }
      measured = false;
      bytes += AVERAGE_TILE_BYTES;
    }),
  );
  return { tileCount: urls.length, bytes, measured };
}

/** Deliverable 5's threshold: "above 40 tiles or 150 MB ask first". */
export function needsConfirmation(plan: FetchPlan): boolean {
  return plan.tileCount > ASK_TILE_COUNT || plan.bytes > ASK_BYTES;
}

export function formatMb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
