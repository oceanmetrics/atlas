// places/zoneOutline.ts -- the picked/selected zone keys' outline, built from whatever is
// CURRENTLY RENDERED on the map (Deliverable 2's pick-mode highlight). `queryRenderedFeatures`
// with no point argument returns every feature of the given layers within the viewport -- the
// standard MapLibre "highlight the selected features" pattern (the alternative, holding a full
// copy of the zone vector tiles' geometry client-side, would duplicate what the PMTiles archive
// already serves). The one accepted limitation: a key whose zone is entirely outside the current
// viewport contributes no outline until it (or a re-pick) scrolls into view -- acceptable for an
// interactive, click-driven pick session.
import type { Feature, FeatureCollection, Geometry } from "geojson";
import { zoneFillId, zoneKeyProperty, zoneLineId } from "../lib/map/layers/zones";
import { queryLayerFeatures, type LayerQueryMap } from "../lib/map/queryLayers";

export interface RenderedFeatureLike {
  properties?: Record<string, unknown> | null;
  geometry?: Geometry;
}

/** `queryRenderedFeatures` alone is enough for a caller that never needs the globe fallback (the
 * unit tests' fake); a real MapLibre `Map` also carries the rest of `LayerQueryMap`, which
 * `renderedZoneOutline` uses when the viewport query comes back empty on the globe (R4-ci). */
export type RenderedFeatureMap = {
  queryRenderedFeatures(options?: { layers?: string[] }): RenderedFeatureLike[];
} & Partial<Omit<LayerQueryMap, "queryRenderedFeatures">>;

export const EMPTY_FEATURE_COLLECTION: FeatureCollection = {
  type: "FeatureCollection",
  features: [],
};

/** the outline of every picked key of `unit` that is currently rendered, deduplicated by
 * (key, geometry) -- a fill layer and a line layer over the same source report the same feature
 * twice at every zoom. */
export function renderedZoneOutline(
  map: RenderedFeatureMap,
  unit: string,
  keys: readonly string[],
): FeatureCollection {
  if (!keys.length) return EMPTY_FEATURE_COLLECTION;
  const wanted = new Set(keys.map(String));
  const keyProp = zoneKeyProperty(unit);
  const seen = new Set<string>();
  const features: Feature[] = [];
  const layers = [zoneFillId(unit), zoneLineId(unit)];
  const found: readonly RenderedFeatureLike[] = isLayerQueryMap(map)
    ? queryLayerFeatures(map, layers)
    : map.queryRenderedFeatures({ layers });
  for (const f of found) {
    const key = f.properties?.[keyProp];
    if (typeof key !== "string" && typeof key !== "number") continue;
    if (!wanted.has(String(key))) continue;
    if (!f.geometry) continue;
    const dedupeKey = `${key}:${JSON.stringify(f.geometry)}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    features.push({ type: "Feature", geometry: f.geometry, properties: { ...f.properties } });
  }
  return { type: "FeatureCollection", features };
}

function isLayerQueryMap(map: RenderedFeatureMap): map is RenderedFeatureMap & LayerQueryMap {
  return (
    typeof map.getLayer === "function" &&
    typeof map.getLayoutProperty === "function" &&
    typeof map.getZoom === "function" &&
    typeof map.querySourceFeatures === "function"
  );
}
