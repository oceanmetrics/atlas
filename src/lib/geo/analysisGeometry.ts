// geo/analysisGeometry.ts -- the geometry every place-derived number runs on (plan D8).
//
// No engine, no network, no DOM: geometry in, geometry out. Moved here from the retired
// `lib/analysis/place.ts` (the MarineSensitivity scores analysis); the rule itself is a g1-codec
// rule, so a place a shared link reproduces and the place this app holds are the same geometry.
import { roundTrip } from "./placeCodec";
import { normalizeForAnalysis } from "./unwrap";
import type { AreaGeometry } from "./types";

/**
 * `normalizeForAnalysis()` FIRST, then `decode(encode(...))` -- that order is not interchangeable.
 * `encodeGeometry()` REFUSES a ring that is still wrapped (reject code `wrapped`), so encoding an
 * un-normalized Bering polygon throws instead of producing a token; and unwrapping AFTER the round
 * trip would analyse a geometry the link cannot carry.
 *
 * The round trip is not a formality. A link carries quantized coordinates (10^-3 deg, or 10^-4 for
 * a place under half a degree), so the sender and the recipient only compute the same summary if
 * the SENDER also analysed the quantized geometry.
 */
export function analysisGeometry(geom: AreaGeometry): AreaGeometry {
  return roundTrip(normalizeForAnalysis(geom));
}
