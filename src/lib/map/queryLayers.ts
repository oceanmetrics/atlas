// map/queryLayers.ts -- "which features of these layers are on the map", robust on the globe.
//
// R4-ci (2026-10-01): MapLibre 6's `queryRenderedFeatures({ layers })` (no geometry = the whole
// viewport) silently returns `[]` on the globe projection whenever a viewport corner lies off the
// sphere -- at the desktop default fit (zoom ~2.2) that is most camera centres, and which ones
// depends only on longitude (-120/-110/-70/-60 answered, -100/-90/-80/-140 did not, same tiles,
// same painted lines; a point or small box query answered everywhere). The round-4 left dock moved
// the fit's centre from -69 to -140 and the Program Area pick highlight + four hermetic specs went
// empty with nothing wrong on screen. So: ask the renderer first, and when it answers nothing fall
// back to the source's own loaded tiles, honouring what the renderer would have honoured
// (layer present, visible, inside its zoom range, its own filter). Exported + unit-tested; the e2e
// probes carry a copy of the same steps in-page (`e2e/map-hermetic.ts#renderedLayerCount`).
import type { Feature } from "geojson";

/** the slice of a MapLibre `Map` this needs, so a test can hand in a plain object. */
export interface LayerQueryMap {
  queryRenderedFeatures(options?: { layers?: string[] }): Feature[];
  getLayer(id: string):
    | {
        source?: string;
        sourceLayer?: string;
        minzoom?: number;
        maxzoom?: number;
        filter?: unknown;
      }
    | undefined;
  getLayoutProperty(id: string, name: string): unknown;
  getZoom(): number;
  querySourceFeatures(
    source: string,
    options?: { sourceLayer?: string; filter?: unknown },
  ): Feature[];
}

/** features of `layerIds` currently rendered; on an empty answer, the features of the loaded tiles
 * of each layer that would be drawn right now (one per layer, so a fill + line pair reports a
 * feature twice exactly as the renderer does). `[]` for a layer that is absent, hidden or outside
 * its zoom range -- the fallback never resurrects a layer the renderer would not draw. */
export function queryLayerFeatures(map: LayerQueryMap, layerIds: readonly string[]): Feature[] {
  const rendered = map.queryRenderedFeatures({ layers: [...layerIds] });
  if (rendered.length > 0) return rendered;
  const out: Feature[] = [];
  const zoom = map.getZoom();
  for (const id of layerIds) {
    const layer = map.getLayer(id);
    if (!layer?.source) continue;
    if (map.getLayoutProperty(id, "visibility") === "none") continue;
    if (typeof layer.minzoom === "number" && zoom < layer.minzoom) continue;
    if (typeof layer.maxzoom === "number" && zoom >= layer.maxzoom) continue;
    try {
      const opts: { sourceLayer?: string; filter?: unknown } = {};
      if (layer.sourceLayer) opts.sourceLayer = layer.sourceLayer;
      if (layer.filter) opts.filter = layer.filter;
      out.push(...map.querySourceFeatures(layer.source, opts));
    } catch {
      // source not added / not loaded yet: nothing to report, never a throw
    }
  }
  return out;
}
