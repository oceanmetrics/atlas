// Area statistics of a COG through stock titiler: `POST {host}/cog/statistics?url=<enc>` with the
// place as a GeoJSON Feature. The ONE sanctioned numbers-from-titiler path besides `/cog/point`
// (CLAUDE.md: "titiler is for display, plus `/cog/point` and `/cog/statistics` behind interfaces"),
// and what it returns are DISPLAY-GRID statistics: pixels of the raster the map draws, selected by
// pixel centre inside the polygon, resampled as titiler resamples. They are not zonal statistics of
// the model surface and the UI says so wherever it shows them.
//
// Behind `StatisticsSource` like `ValueSource` (point.ts): the HTTP call is injected, so tests never
// touch the network and a future client-side COG reader can replace it.
//
// KNOWN LIMIT (checked 2026-10-14): titiler-v8 answers the CORS preflight of a JSON POST with 400
// (`access-control-allow-methods: GET`), so a browser cannot call this from oceanmetrics.io until
// the tile server allows POST. `statistics()` then resolves `{ok: false, error.kind: "network"}`
// and the UI shows an explanation, never a number. The request itself is correct: curl returns the
// statistics (verified against a marine-atlas COG).
import type { Feature } from "geojson";
import type { Loaded } from "../catalog/load";
import { polygonsOf, type AreaGeometry, type Position, type Ring } from "../geo/types";
import { encodeUrlReserved } from "./urlEncode";
import { DEFAULT_TITILER_CONFIG, type TitilerConfig } from "./tiles";

export interface RasterStats {
  /** pixels with a value inside the polygon. */
  count: number;
  min: number | null;
  max: number | null;
  mean: number | null;
  /** share of the polygon's pixels with no value, 0..1; `null` when the polygon covers no pixel. */
  noValueShare: number | null;
}

export function titilerStatisticsUrl(config: TitilerConfig, cogUrl: string): string {
  return `${config.host}/cog/statistics?url=${encodeUrlReserved(cogUrl)}`;
}

// --- the geometry titiler is sent: longitudes in [-180, 180] --------------------------------------

/** clip a ring to one side of x = 180 (Sutherland-Hodgman against a vertical half-plane). */
function clipRing(ring: Ring, keepWest: boolean): Ring {
  const inside = (p: Position) => (keepWest ? p[0] <= 180 : p[0] >= 180);
  const cut = (a: Position, b: Position): Position => {
    const t = (180 - a[0]) / (b[0] - a[0]);
    return [180, a[1] + t * (b[1] - a[1])];
  };
  const out: Ring = [];
  for (let i = 0; i < ring.length; i++) {
    const cur = ring[i];
    const prev = ring[(i + ring.length - 1) % ring.length];
    if (inside(cur)) {
      if (!inside(prev)) out.push(cut(prev, cur));
      out.push(cur);
    } else if (inside(prev)) out.push(cut(prev, cur));
  }
  return out;
}

const shiftRing = (ring: Ring, dx: number): Ring => ring.map(([x, y]) => [x + dx, y] as Position);
const usable = (ring: Ring) => ring.length >= 3;

/**
 * A place's geometry with every longitude inside [-180, 180], as titiler needs: the atlas keeps a
 * place UNWRAPPED (a Bering polygon runs 170..190), so the part east of 180 is shifted back by -360
 * and a polygon crossing 180 is cut there into two parts. Geometry already inside the range is
 * returned unchanged (same polygons, a MultiPolygon wrapper aside).
 */
export function wrapForRaster(geometry: AreaGeometry): AreaGeometry {
  const parts: Ring[][] = [];
  for (const rings of polygonsOf(geometry)) {
    const xs = rings[0].map((p) => p[0]);
    const lo = Math.min(...xs);
    const hi = Math.max(...xs);
    if (hi <= 180 && lo >= -180) {
      parts.push(rings);
    } else if (lo >= 180) {
      parts.push(rings.map((r) => shiftRing(r, -360)));
    } else if (hi <= -180) {
      parts.push(rings.map((r) => shiftRing(r, 360)));
    } else if (hi > 180 && lo < 180) {
      const west = rings.map((r) => clipRing(r, true)).filter(usable);
      const east = rings.map((r) => shiftRing(clipRing(r, false), -360)).filter(usable);
      if (usable(west[0] ?? [])) parts.push(west);
      if (usable(east[0] ?? [])) parts.push(east);
    } else {
      // crosses -180: shift the whole polygon east by 360 first, then cut at 180 like above
      return wrapForRaster({
        type: "MultiPolygon",
        coordinates: [rings.map((r) => shiftRing(r, 360))],
      });
    }
  }
  return parts.length === 1
    ? { type: "Polygon", coordinates: parts[0] }
    : { type: "MultiPolygon", coordinates: parts };
}

// --- the response ---------------------------------------------------------------------------------

function finite(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** titiler's answer (a GeoJSON Feature, `properties.statistics.b1`) -> {@link RasterStats}; `null`
 * when it is not that shape. */
export function parseStatistics(json: unknown): RasterStats | null {
  const stats = (json as { properties?: { statistics?: Record<string, unknown> } } | null)
    ?.properties?.statistics;
  if (!stats || typeof stats !== "object") return null;
  const band = (stats.b1 ?? Object.values(stats)[0]) as Record<string, unknown> | undefined;
  if (!band || typeof band !== "object") return null;
  const valid = finite(band.valid_pixels) ?? finite(band.count) ?? 0;
  const masked = finite(band.masked_pixels) ?? 0;
  const total = valid + masked;
  return {
    count: finite(band.count) ?? valid,
    min: finite(band.min),
    max: finite(band.max),
    mean: finite(band.mean),
    noValueShare: total > 0 ? masked / total : null,
  };
}

// --- the source -----------------------------------------------------------------------------------

export interface StatisticsRequest {
  /** absolute https URL of the COG. */
  cogUrl: string;
  geometry: AreaGeometry;
}

export interface StatisticsSource {
  statistics(req: StatisticsRequest): Promise<Loaded<RasterStats>>;
}

/** the injected transport: POST `body` as JSON to `url`, resolve the parsed JSON (or throw). */
export type PostJson = (url: string, body: unknown) => Promise<unknown>;

export function createTitilerStatisticsSource(
  postJson: PostJson,
  config: TitilerConfig = DEFAULT_TITILER_CONFIG,
): StatisticsSource {
  return {
    async statistics(req) {
      const url = titilerStatisticsUrl(config, req.cogUrl);
      const body: Feature = {
        type: "Feature",
        properties: {},
        geometry: wrapForRaster(req.geometry),
      };
      let raw: unknown;
      try {
        raw = await postJson(url, body);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        return { ok: false, error: { kind: "network", url, message } };
      }
      const value = parseStatistics(raw);
      return value
        ? { ok: true, value }
        : {
            ok: false,
            error: { kind: "parse", url, message: "titiler's answer carried no statistics" },
          };
    },
  };
}

/** the browser transport: `fetch` POST with a JSON body; a non-2xx answer throws `HTTP <status>`. */
export const fetchPostJson: PostJson = async (url, body) => {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
};
