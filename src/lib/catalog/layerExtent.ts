// Where the layer on screen is (WP14 "Zoom to layer"): the frame the button and the auto-zoom fit.
// One case per kind of item, most specific first:
//   - a hex item (a grid + a Parquet column) has no extent of its own: the collection's (`extentBounds`);
//   - a registry AquaMaps item states the box of the surface it draws (`bbox_native` / `bbox_005`, as the
//     Item's `bbox`), and so may any item that carries one (an MST shard);
//   - a COG without a box (the nc / gm density cubes) uses its footprint read once from
//     `/cog/info.geojson` (`cogBounds`, `raster/bounds.ts`) while that is known;
//   - anything else falls back to the collection's extent.
// Plain TypeScript: the camera fit itself is the shell's (`MapHandle.flyToBounds`).
import type { CameraBoundsInput } from "../map/camera";
import { rasterAssetOf } from "./assets";
import { boxToBounds, extentBounds } from "./extent";
import type { StacCollection, StacItem } from "./types";

export type LayerExtentSource = "item" | "cog" | "collection" | null;

export interface LayerExtent {
  bounds: CameraBoundsInput;
  /** which rule chose it (a test and the tooltip, never a behaviour switch). */
  source: Exclude<LayerExtentSource, null>;
}

export function layerExtent(args: {
  item: StacItem | null;
  collection: StacCollection | null;
  /** the COG's footprint `[w, s, e, n]` from `/cog/info.geojson`, once known. */
  cogBounds?: readonly number[] | null;
}): LayerExtent | null {
  const { item, collection, cogBounds } = args;
  const collectionBounds = extentBounds(collection);
  const own = boxToBounds(item?.bbox);
  if (item && rasterAssetOf(item)) {
    if (own) return { bounds: own, source: "item" };
    const cog = boxToBounds(cogBounds);
    if (cog) return { bounds: cog, source: "cog" };
    return collectionBounds ? { bounds: collectionBounds, source: "collection" } : null;
  }
  if (collectionBounds) return { bounds: collectionBounds, source: "collection" };
  return own ? { bounds: own, source: "item" } : null;
}

/** a frame this wide is the whole world: no fit centres it (on a globe the solver has nothing to settle
 * on and ends up at a pole), so the camera keeps its longitude and looks at the frame's middle latitude. */
export const WORLD_SPAN_DEG = 300;
export const WORLD_ZOOM = 1.6;

/** the camera for a world-wide frame, or `null` when the frame is an ordinary one to fit. */
export function worldView(
  bounds: CameraBoundsInput,
  currentLon: number,
): { lon: number; lat: number; zoom: number } | null {
  if (bounds[1][0] - bounds[0][0] < WORLD_SPAN_DEG) return null;
  return { lon: currentLon, lat: (bounds[0][1] + bounds[1][1]) / 2, zoom: WORLD_ZOOM };
}
