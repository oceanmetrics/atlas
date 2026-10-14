// Species and Collections-raster point values ONLY (plan D4 / CLAUDE.md "Numbers never come from the
// tile server"): scores, cell ids and zonal statistics always come from Parquet via engine/ + sql/ —
// `/cog/point` is the sanctioned exception, for a species click value and (WP14) for the value under the
// pointer of a COG item in the Collections lens (hex items read their values from Parquet, never here),
// behind `ValueSource` so a future client-side COG renderer (spike S3, deferred) can replace it without
// touching a caller.
//
// `assertSpeciesValueRequest` is the runtime half of that rule: `ValueRequest.domain` is typed to
// admit only `"species"` and `"collection"`, but a request built from untyped data (a lens's own JSON, a
// message from a worker) skips the compiler, so this throws instead of silently sampling a scores raster pixel.
import { encodeUrlReserved } from "./urlEncode";
import { DEFAULT_TITILER_CONFIG, type TitilerConfig } from "./tiles";

/** the only domains `/cog/point` may serve — see module header. */
export type ValueDomain = "species" | "collection";

export interface ValueRequest {
  /** `"species"` or `"collection"` — nothing else is accepted, even though the type alone cannot stop a
   * value built from untyped (e.g. `JSON.parse`d) data; see `assertSpeciesValueRequest`. */
  domain: ValueDomain;
  lon: number;
  lat: number;
  /** absolute https URL of the source COG. */
  cogUrl: string;
  /** the 1-based band of a multi-band COG (`&bidx=N`); absent = band 1, no `bidx` in the URL. */
  bidx?: number;
  /** aborts the request (a newer pointer position superseded it); an aborted read resolves `null`. */
  signal?: AbortSignal;
}

export interface ValueSource {
  pointValue(req: ValueRequest): Promise<number | null>;
}

/** throws unless `req.domain` is `species` or `collection` — the runtime guard the module header promises. Call
 * this at the top of every `ValueSource` implementation, not just the titiler one, so a future
 * client-side COG reader inherits the same rule. */
export function assertSpeciesValueRequest(req: { domain: string }): void {
  if (req.domain !== "species" && req.domain !== "collection") {
    throw new Error(
      `raster/point.ts: /cog/point may only serve species values or collection raster values, got domain "${req.domain}" — ` +
        "scores values must come from Parquet (engine/ + sql/), never a tile pixel (plan D4).",
    );
  }
}

/** `{host}/cog/point/{lon},{lat}?url=<enc>[&bidx=<n>]` — `url` encoded the same way as tiles.ts
 * (urlEncode.ts). `bidx` picks a band of a multi-band COG (the MST nc density COGs: n, cv, ci90). */
export function titilerPointUrl(
  config: TitilerConfig,
  lon: number,
  lat: number,
  cogUrl: string,
  bidx?: number,
): string {
  const b = bidx === undefined ? "" : `&bidx=${bidx}`;
  return `${config.host}/cog/point/${lon},${lat}?url=${encodeUrlReserved(cogUrl)}${b}`;
}

/** the slice of `fetch`+`.json()` this needs, injected so tests never touch the network (module
 * contract: "No network call in tests: inject the transport"). */
export type PointJsonFetcher = (url: string, signal?: AbortSignal) => Promise<unknown>;

/** the stock-titiler-backed `ValueSource`. `fetchJson` is required (no default network
 * implementation baked in here) — the caller wires a real `fetch` in the browser and a fake in tests. */
export function createTitilerValueSource(
  fetchJson: PointJsonFetcher,
  config: TitilerConfig = DEFAULT_TITILER_CONFIG,
): ValueSource {
  return {
    async pointValue(req: ValueRequest): Promise<number | null> {
      assertSpeciesValueRequest(req);
      const url = titilerPointUrl(config, req.lon, req.lat, req.cogUrl, req.bidx);
      let raw: unknown;
      try {
        raw = await fetchJson(url, req.signal);
      } catch {
        return null; // network/parse failure -> null, matching msens::cog_point_value()'s NA-on-failure contract
      }
      const values = (raw as { values?: unknown } | null)?.values;
      const first = Array.isArray(values) ? values[0] : undefined;
      return typeof first === "number" && Number.isFinite(first) ? first : null;
    },
  };
}
