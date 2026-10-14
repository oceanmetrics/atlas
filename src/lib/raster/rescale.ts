// The display rescale of a COG band, read once from titiler's `/cog/statistics` and cached.
//
// A density surface (the MST nc seabird models, n_per_km2) is extremely right-skewed: the maximum of
// ARTE_summer is 0.81 while its 98th percentile is 0.0079, so a `[min, max]` rescale paints almost
// the whole map the lowest colour. The rescale is therefore `[min, percentile_98]` of the band's own
// valid pixels, which is what makes the surface readable and what the legend then states.
//
// This is a DISPLAY choice, in the same family as `histogram.ts`'s legend histogram (plan D4: numbers
// never come from the tile server; `/cog/statistics` is one of the two sanctioned display-only
// reads). The value only picks `rescale=` for the tile URL and the legend's end labels; no score, cell
// id or zonal statistic flows through here. The cache holds successes only (a failure is retried the
// next time the layer is asked for) and shares an in-flight request between two callers.
import { DEFAULT_TITILER_CONFIG, type TitilerConfig } from "./tiles";
import { encodeUrlReserved } from "./urlEncode";

export type Rescale = [number, number];

/** `{host}/cog/statistics?url=<enc>&bidx=<n>`: the same `url` encoding as tiles.ts / point.ts. */
export function titilerBandStatisticsUrl(
  config: TitilerConfig,
  cogUrl: string,
  bidx: number,
): string {
  return `${config.host}/cog/statistics?url=${encodeUrlReserved(cogUrl)}&bidx=${bidx}`;
}

function finite(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/**
 * `[min, percentile_98]` out of titiler's `/cog/statistics` body (`{"b1": {min, max,
 * percentile_98, ...}}`); the band key is whichever the response names. A 98th percentile at or
 * below the minimum (a near-constant band) falls back to `[min, max]`, and a still-degenerate range
 * is widened by 1 so the ramp has a span. `null` for any body that is not that shape.
 */
export function parseRescale(raw: unknown): Rescale | null {
  if (!raw || typeof raw !== "object") return null;
  const bands = raw as Record<string, unknown>;
  const key = Object.keys(bands).find((k) => bands[k] && typeof bands[k] === "object");
  if (!key) return null;
  const band = bands[key] as Record<string, unknown>;
  const { min, max } = band;
  if (!finite(min) || !finite(max)) return null;
  const p98 = band.percentile_98;
  let hi = finite(p98) && p98 > min ? p98 : max;
  if (!(hi > min)) hi = min + 1;
  return [min, hi];
}

export type RescaleFetcher = (url: string) => Promise<unknown>;

export interface RescaleCache {
  /** the display rescale of band `bidx` of `cogUrl`; `null` when it cannot be read. */
  get(cogUrl: string, bidx: number): Promise<Rescale | null>;
  /** how many bands are cached (successes only). */
  readonly size: number;
  clear(): void;
}

export function createRescaleCache(
  fetchJson: RescaleFetcher,
  config: TitilerConfig = DEFAULT_TITILER_CONFIG,
): RescaleCache {
  const done = new Map<string, Rescale>();
  const inflight = new Map<string, Promise<Rescale | null>>();
  return {
    get(cogUrl, bidx) {
      const key = `${cogUrl}#${bidx}`;
      const hit = done.get(key);
      if (hit) return Promise.resolve(hit);
      const pending = inflight.get(key);
      if (pending) return pending;
      const p = (async (): Promise<Rescale | null> => {
        let raw: unknown;
        try {
          raw = await fetchJson(titilerBandStatisticsUrl(config, cogUrl, bidx));
        } catch {
          return null;
        }
        const r = parseRescale(raw);
        if (r) done.set(key, r);
        return r;
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
