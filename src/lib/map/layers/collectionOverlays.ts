// A collection's own vector overlays (`atlas:overlays`, `lib/catalog/overlays.ts`): sightings, effort
// tracklines, survey hexagons, each a PMTiles archive the collection lists as an asset. Pure, like
// `layers/overlays.ts` (the gazetteer's place layers): specs in, plain sources and roled layers out, which
// `composeStyle` folds into the ONE style (never `addLayer`). The `pmtiles://` protocol is map.ts's.
//
//   draw order   the collection's array order, FIRST entry ON TOP: the layers are emitted bottom first (the
//                last overlay first), all under the one role "collection-overlay", whose stable sort in
//                `style.ts#orderLayers` keeps this order. The role sits at the top of the `data-raster`
//                group: above the Item (hex, raster), below the place layers and the selection highlight.
//   geometry     point: a circle in the overlay's colour with a white ring (both by zoom); line: 1.5 px;
//                polygon: an outline in the colour over a very faint fill (the Item under it stays
//                readable), and the fill is what a click hits.
//   filter       "Only features matching the selected layer": an overlay whose `filter_field` is the Item's
//                `atlas:overlay_filter.field` keeps the features whose `|`-delimited property holds
//                `|<token>|` (the delimiters are part of the needle, so `rice` never matches `rices_whale`).
//                The feature filters (`atlas:overlay_filters`: species, month, year) that list an overlay are
//                ANDed with it: one `["all", ...]` filter per layer, or the single one, or none.
import type { ExpressionSpecification, FilterSpecification } from "maplibre-gl";
import type { CollectionOverlaySpec, OverlayFilter } from "../../catalog/overlays";
import { COLLECTION_OVERLAY_HALO } from "../colors";
import type { CollectionOverlayParts, LayerSpecification } from "../types";

export const COLLECTION_OVERLAY_ROLE = "collection-overlay";
/** a point's radius and ring by zoom: ~4-5 px at survey zooms, smaller when a whole sea is in view, where
 * thousands of white rings would otherwise merge into one white cloud. */
export const COV_CIRCLE_RADIUS = ["interpolate", ["linear"], ["zoom"], 3, 2, 7, 4, 10, 5];
export const COV_CIRCLE_STROKE_WIDTH = [
  "interpolate",
  ["linear"],
  ["zoom"],
  3,
  0.25,
  7,
  1,
  10,
  1.25,
];
export const COV_LINE_WIDTH = 1.5;
/** a whisper of fill: the outline carries the shape, the fill only takes the click. */
export const COV_FILL_OPACITY = 0.06;
export const COV_OUTLINE_WIDTH = 1;

/** one source per ASSET, so two overlays that are layers of one archive share it. */
export const covSourceId = (asset: string): string => `cov-src-${asset}`;
export type CovPart = "circle" | "line" | "fill" | "outline";
export const covLayerId = (id: string, part: CovPart): string => `cov-${id}-${part}`;

/** the layer a hover or click is hit on: the circle of a point, the line of a line, the fill of a polygon. */
export function covHitLayerId(spec: Pick<CollectionOverlaySpec, "id" | "geometry">): string {
  return covLayerId(
    spec.id,
    spec.geometry === "point" ? "circle" : spec.geometry === "line" ? "line" : "fill",
  );
}

/** keep a feature whose `field` (a `|`-delimited string, e.g. `|pantropical_spotted_dolphin|stenella_spp|`)
 * holds `|token|`. A missing or non-string property is the empty string, which never matches. */
export function overlayTokenFilter(field: string, token: string): FilterSpecification {
  return [
    ">=",
    ["index-of", `|${token}|`, ["to-string", ["coalesce", ["get", field], ""]]],
    0,
  ] as unknown as FilterSpecification;
}

/** an overlay's whole filter: the token filter (when its `filter_field` matches) AND every feature filter
 * listing it; `null` for none. */
export function composedFilter(
  spec: CollectionOverlaySpec,
  filter: OverlayFilter | null,
  extra: readonly FilterSpecification[] = [],
): FilterSpecification | null {
  const parts: FilterSpecification[] = [
    ...(filter && spec.filterField === filter.field
      ? [overlayTokenFilter(filter.field, filter.token)]
      : []),
    ...extra,
  ];
  if (parts.length === 0) return null;
  return parts.length === 1 ? parts[0] : (["all", ...parts] as unknown as FilterSpecification);
}

/** the layers of one overlay, bottom first (a polygon's fill under its outline). */
export function overlayLayersOf(
  spec: CollectionOverlaySpec,
  filter: OverlayFilter | null = null,
  extra: readonly FilterSpecification[] = [],
): LayerSpecification[] {
  const composed = composedFilter(spec, filter, extra);
  const base = {
    source: covSourceId(spec.asset),
    "source-layer": spec.sourceLayer,
    ...(composed ? { filter: composed } : {}),
  };
  if (spec.geometry === "point") {
    return [
      {
        id: covLayerId(spec.id, "circle"),
        type: "circle",
        ...base,
        paint: {
          "circle-color": spec.color,
          "circle-radius": COV_CIRCLE_RADIUS as ExpressionSpecification,
          "circle-stroke-color": COLLECTION_OVERLAY_HALO,
          "circle-stroke-width": COV_CIRCLE_STROKE_WIDTH as ExpressionSpecification,
        },
      },
    ];
  }
  if (spec.geometry === "line") {
    return [
      {
        id: covLayerId(spec.id, "line"),
        type: "line",
        ...base,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": spec.color, "line-width": COV_LINE_WIDTH },
      },
    ];
  }
  return [
    {
      id: covLayerId(spec.id, "fill"),
      type: "fill",
      ...base,
      paint: { "fill-color": spec.color, "fill-opacity": COV_FILL_OPACITY },
    },
    {
      id: covLayerId(spec.id, "outline"),
      type: "line",
      ...base,
      paint: { "line-color": spec.color, "line-width": COV_OUTLINE_WIDTH },
    },
  ];
}

/**
 * The style parts of the overlays that are on (`visibleIds`), or null when none is: one vector source per
 * asset, and the layers in draw order bottom first (the collection's LAST overlay first), so the first
 * entry of `atlas:overlays` is drawn on top. `filter` (the Item's, when "Only features matching" is on)
 * applies to the overlays whose `filter_field` matches it; the rest are untouched.
 */
export function collectionOverlayStyle(
  specs: readonly CollectionOverlaySpec[],
  visibleIds: readonly string[],
  filter: OverlayFilter | null = null,
  featureFilters: ReadonlyMap<string, readonly FilterSpecification[]> = new Map(),
): CollectionOverlayParts | null {
  const on = specs.filter((s) => visibleIds.includes(s.id));
  if (on.length === 0) return null;
  const sources: CollectionOverlayParts["sources"] = {};
  const layers: { role: "collection-overlay"; layer: LayerSpecification }[] = [];
  for (const spec of [...on].reverse()) {
    sources[covSourceId(spec.asset)] = { type: "vector", url: `pmtiles://${spec.url}` };
    for (const layer of overlayLayersOf(spec, filter, featureFilters.get(spec.id) ?? [])) {
      layers.push({ role: COLLECTION_OVERLAY_ROLE, layer });
    }
  }
  return { sources, layers };
}

/** the hit layers of the overlays that are on, TOP first (the collection's own order). */
export function covHitLayerIds(
  specs: readonly CollectionOverlaySpec[],
  visibleIds: readonly string[],
): string[] {
  return specs.filter((s) => visibleIds.includes(s.id)).map(covHitLayerId);
}
