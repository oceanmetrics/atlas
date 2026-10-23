// The point read of a browser-drawn COG (build week 2 step 3): the `ValueSource` (`point.ts`) for an Item that
// `cog.ts#rasterChoiceOf` draws in the browser. It reads the pixel under [lon, lat] from the Item's 4326 ORIGINAL
// with geotiff.js over HTTP Range (@oceanmetrics/map `pointValue`, spike 3 condition 2: never the 3857 copy, whose
// nearest warp moved pixels by up to 0.37 px), every band in ONE window read: a flower click costs one read however
// many petals there are, as the `/cog/point` it replaces did. A titiler-drawn Item keeps `/cog/point`.
//
// The same rule as `point.ts`: only species and collection-raster values (`assertSpeciesValueRequest`); scores still
// come from Parquet.
import { pointValue as readPixel } from "@oceanmetrics/map";
import {
  assertSpeciesValueRequest,
  type PointValues,
  type ValueRequest,
  type ValueSource,
} from "./point";

/** the read the source makes: every band of the full-resolution pixel (NaN for nodata), null outside the file. */
export type PixelReader = (cogUrl: string, lngLat: [number, number]) => Promise<number[] | null>;

const finite = (v: number | undefined): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

/** the geotiff.js-backed `ValueSource`; `read` is injected only by a test. A failed read, an aborted one, or a
 * position outside the file answers null, as titiler's did. */
export function createCogValueSource(read: PixelReader = readPixel): ValueSource {
  const pixel = async (req: ValueRequest): Promise<(number | null)[] | null> => {
    assertSpeciesValueRequest(req);
    if (req.signal?.aborted) return null;
    let v: number[] | null;
    try {
      v = await read(req.cogUrl, [req.lon, req.lat]);
    } catch {
      return null;
    }
    if (!v || req.signal?.aborted) return null;
    return v.map(finite);
  };
  return {
    async pointValue(req) {
      const v = await pixel(req);
      return v ? (v[(req.bidx ?? 1) - 1] ?? null) : null;
    },
    async pointValues(req): Promise<PointValues | null> {
      const v = await pixel(req);
      return v ? { values: v } : null;
    },
  };
}
