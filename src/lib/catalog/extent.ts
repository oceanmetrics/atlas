// A collection's spatial extent (`extent.spatial.bbox`) as a camera frame: the default view when the
// URL has no `map=`. Plain TypeScript; the fit math itself is `lib/map/camera.ts#boundsToCameraView`
// (never MapLibre's own bounds fitting: tests/map/no-fitbounds.test.ts), this only validates and
// re-expresses the box.
import type { CameraBoundsInput } from "../map/camera";
import type { StacCollection } from "./types";

/**
 * `[[west, south], [east, north]]` of the collection's first (overall) bbox, or `null` when it has none
 * or it is unusable (non-finite, inverted latitudes, or a zero-area point). A bbox may carry 6 numbers
 * (with elevation): the horizontal four are picked. A box that crosses the antimeridian (`east < west`)
 * is re-expressed with `east + 360`, the continuous-degrees frame `boundsToCameraView` expects. Latitudes
 * are clamped to Web Mercator's range.
 */
export function extentBounds(collection: StacCollection | null): CameraBoundsInput | null {
  const box = collection?.extent?.spatial?.bbox?.[0];
  if (!Array.isArray(box) || box.length < 4) return null;
  const nums = box.map(Number);
  if (!nums.every(Number.isFinite)) return null;
  const [west, south, east, north] =
    nums.length >= 6 ? [nums[0], nums[1], nums[3], nums[4]] : [nums[0], nums[1], nums[2], nums[3]];
  if (!(north > south)) return null;
  const e = east < west ? east + 360 : east;
  if (!(e > west)) return null;
  return [
    [west, Math.max(-85, south)],
    [e, Math.min(85, north)],
  ];
}
