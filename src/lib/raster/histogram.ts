// The legend histogram's tile-server read (round 4 R4-A, owner decision D4). Plan D4's "numbers
// never come from the tile server" keeps two display-only exceptions: the species click value via
// `/cog/point` (`raster/point.ts`) and this one, `/cog/statistics` -- the SHAPE of a layer's whole
// distribution, drawn in the legend above the colour ramp (`lib/ui/Legend.svelte`). It serves the
// species lens, the scores lens' Raster-cells layer and (WP14) the Collections lens' COG items (each
// layer's own COG and band; a hex item bins its Parquet column instead). It never supplies a
// score, a cell id, a zonal statistic or the clicked value: those still come from Parquet (the
// click's `cell_value` path) or the boot bundle. Callers pass `range` (the legend ramp's own
// rescale min/max) as `histogram_range` so the bins line up with the ramp underneath.
import type { Histogram } from "../map/density";
import { encodeUrlReserved } from "./urlEncode";
import { DEFAULT_TITILER_CONFIG, type TitilerConfig } from "./tiles";

/** the only domains `/cog/statistics` may serve — see module header. `scores` is the Raster-cells
 * layer's own COG, display-only (R4-A); Program-area zones never use a tile endpoint. */
export type HistogramDomain = "species" | "scores" | "collection";

export interface HistogramRequest {
  domain: HistogramDomain;
  /** absolute https URL of the source COG. */
  cogUrl: string;
  /** the histogram bin count titiler is asked for; `binValues()` may re-bin client-side if the
   * caller wants a different count than titiler returns, so this is a hint, not a contract. */
  bins?: number;
  /** the legend ramp's `[min, max]` (the layer's rescale), sent as `histogram_range` so the bins
   * span exactly the ramp; omitted, titiler bins over the band's own min..max. */
  range?: readonly [number, number];
  /** the 1-based band of a multi-band COG (`&bidx=N`); absent = band 1, no `bidx` in the URL. */
  bidx?: number;
}

export interface HistogramSource {
  histogram(req: HistogramRequest): Promise<Histogram | null>;
}

/** throws unless `req.domain` is `species`, `scores` or `collection` — the runtime guard `point.ts#
 * assertSpeciesValueRequest` documents; the type alone cannot stop a value built from untyped
 * (e.g. `JSON.parse`d) data. */
export function assertHistogramRequest(req: { domain: string }): void {
  if (req.domain !== "species" && req.domain !== "scores" && req.domain !== "collection") {
    throw new Error(
      `raster/histogram.ts: /cog/statistics may only serve species, scores or collection legend histograms, ` +
        `got domain "${req.domain}" — Program-area distributions come from the bundle's own ` +
        "zone_metric values, never a tile endpoint (plan D4).",
    );
  }
}

/** `{host}/cog/statistics?url=<enc>&histogram_bins=<n>[&histogram_range=<min>,<max>][&bidx=<n>]` —
 * same `url` encoding as `point.ts`/`tiles.ts`. */
export function titilerStatisticsUrl(
  config: TitilerConfig,
  cogUrl: string,
  bins: number,
  range?: readonly [number, number],
  bidx?: number,
): string {
  const r =
    range && Number.isFinite(range[0]) && Number.isFinite(range[1])
      ? `&histogram_range=${range[0]},${range[1]}`
      : "";
  const b = bidx === undefined ? "" : `&bidx=${bidx}`;
  return `${config.host}/cog/statistics?url=${encodeUrlReserved(cogUrl)}&histogram_bins=${bins}${r}${b}`;
}

/** the slice of `fetch`+`.json()` this needs, injected so tests never touch the network — same
 * contract as `point.ts#PointJsonFetcher`. */
export type HistogramJsonFetcher = (url: string) => Promise<unknown>;

/** titiler's `/cog/statistics` response, the one shape this module reads: `{"b1": {min, max,
 * histogram: [[counts...], [bin_edges...]]}}` (rasterio/rio-tiler's own `raster_statistics()`
 * shape) — every other field (percentiles, mean, std, valid_percent, …) is ignored. `null` for
 * anything that does not match (a differently-shaped error body, a band key other than "b1", a
 * malformed histogram pair) rather than throwing — the legend degrades to the ramp alone, never an
 * error. */
export function parseTitilerStatistics(raw: unknown): Histogram | null {
  if (!raw || typeof raw !== "object") return null;
  const bands = raw as Record<string, unknown>;
  const key = Object.keys(bands).find((k) => bands[k] && typeof bands[k] === "object");
  if (!key) return null;
  const band = bands[key] as Record<string, unknown>;
  const min = band.min;
  const max = band.max;
  const hist = band.histogram;
  if (
    typeof min !== "number" ||
    typeof max !== "number" ||
    !Number.isFinite(min) ||
    !Number.isFinite(max)
  ) {
    return null;
  }
  if (!Array.isArray(hist) || hist.length < 1 || !Array.isArray(hist[0])) return null;
  const counts = (hist[0] as unknown[]).filter(
    (v): v is number => typeof v === "number" && Number.isFinite(v),
  );
  // no counted pixel at all (every pixel outside the range, or nodata): nothing to draw
  if (counts.length === 0 || counts.every((c) => c <= 0)) return null;
  // with `histogram_range` the bin edges (`hist[1]`, n+1 of them) span the REQUESTED range, not the
  // band's own min/max -- the edges are what line the bars up with the ramp, so they win.
  const edges = Array.isArray(hist[1])
    ? (hist[1] as unknown[]).filter((v): v is number => typeof v === "number" && Number.isFinite(v))
    : [];
  if (edges.length === counts.length + 1 && edges[edges.length - 1] > edges[0]) {
    return { binCount: counts.length, counts, min: edges[0], max: edges[edges.length - 1] };
  }
  return { binCount: counts.length, counts, min, max };
}

/** the stock-titiler-backed `HistogramSource`. `fetchJson` is required (no default network
 * implementation baked in here), same convention as `point.ts#createTitilerValueSource`. Any
 * failure (network, non-JSON, an unexpected shape) resolves to `null`, never a throw — the caller
 * (`lib/map/distribution.ts`) treats `null` as "no histogram for this legend", not an error state. */
export function createTitilerHistogramSource(
  fetchJson: HistogramJsonFetcher,
  config: TitilerConfig = DEFAULT_TITILER_CONFIG,
): HistogramSource {
  return {
    async histogram(req: HistogramRequest): Promise<Histogram | null> {
      assertHistogramRequest(req);
      const bins = req.bins ?? 20;
      const url = titilerStatisticsUrl(config, req.cogUrl, bins, req.range, req.bidx);
      let raw: unknown;
      try {
        raw = await fetchJson(url);
      } catch {
        return null;
      }
      return parseTitilerStatistics(raw);
    },
  };
}

// --- the whole-layer cache (WP14: Collections raster items) ----------------------------------------

/** the cache key of a raster item's histogram: the COG and its band (the layer's identity), plus the
 * range and bin count the bars are drawn for. Never the clicked position. */
export function rasterHistogramKey(
  cogUrl: string,
  bidx: number | null | undefined,
  range: readonly [number, number],
  bins: number,
): string {
  return `${cogUrl}#${bidx ?? 1}#${range[0]},${range[1]}#${bins}`;
}

export interface HistogramCache {
  /** the whole-layer histogram of a COG band over `range`, `bins` bars; `null` when it cannot be read. */
  get(req: {
    cogUrl: string;
    bidx?: number | null;
    range: readonly [number, number];
    bins: number;
  }): Promise<Histogram | null>;
  /** how many histograms are cached (successes only). */
  readonly size: number;
  clear(): void;
}

/** One `/cog/statistics` read per (COG, band, range, bins), shared between two callers while in flight.
 * Successes only are kept: a failure (network, tiler down) is retried the next time the layer is asked
 * for, and never throws. */
export function createHistogramCache(source: HistogramSource): HistogramCache {
  const done = new Map<string, Histogram>();
  const inflight = new Map<string, Promise<Histogram | null>>();
  return {
    get({ cogUrl, bidx, range, bins }) {
      const key = rasterHistogramKey(cogUrl, bidx, range, bins);
      const hit = done.get(key);
      if (hit) return Promise.resolve(hit);
      const pending = inflight.get(key);
      if (pending) return pending;
      const p = (async (): Promise<Histogram | null> => {
        let h: Histogram | null;
        try {
          h = await source.histogram({
            domain: "collection",
            cogUrl,
            bins,
            range,
            ...(bidx ? { bidx } : {}),
          });
        } catch {
          return null;
        }
        if (h) done.set(key, h);
        return h;
      })().finally(() => inflight.delete(key));
      inflight.set(key, p);
      return p;
    },
    get size() {
      return done.size;
    },
    clear() {
      done.clear();
      inflight.clear();
    },
  };
}
