// places/overlayInteraction.ts -- hover and click on the gazetteer overlays drawn by the "Place
// layers" group. Hover shows a small tooltip (name, status); a click opens a popup with the name and,
// for an area that carries a `place_id`, an "Add <name> to Places" button.
//
// The overlays are separate layers per collection and come and go with the toggles, so this listens
// on the MAP (not per layer) and asks `queryRenderedFeatures` for whichever overlay layers exist at
// that moment. The pure rules (what a feature says, which layers to ask, the button label) are
// exported and unit-tested; the MapLibre popup is the only thing that is not.
import { createPopup } from "../lib/map/popup";

/** what one tile feature of an overlay tells us. */
export interface OverlayFeatureInfo {
  name: string;
  /** the collection's own status ("active", "rescinded", ...), `null` when it carries none. */
  status: string | null;
  /** the gazetteer `place_id`, `null` when the feature has none (it cannot be added by reference). */
  placeId: string | null;
  /** only an area can be a place. */
  isArea: boolean;
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/** a tile feature -> what to say about it. `geometryType` is the feature's own (`Polygon`, `LineString`, ...). */
export function overlayFeatureInfo(
  properties: Record<string, unknown> | null | undefined,
  geometryType?: string,
): OverlayFeatureInfo {
  const placeId = str(properties?.place_id);
  return {
    name: str(properties?.name) ?? placeId ?? "Unnamed feature",
    status: str(properties?.status),
    placeId,
    isArea: /polygon/i.test(geometryType ?? "Polygon"),
  };
}

/** the hover line: "Name" or "Name (status)". */
export function overlayHoverText(info: OverlayFeatureInfo): string {
  return info.status ? `${info.name} (${info.status})` : info.name;
}

/** the popup button: "Add Name to Places". */
export const addToPlacesLabel = (name: string): string => `Add ${name} to Places`;

/** whether the popup offers the add button: an area with a place_id. */
export const canAddToPlaces = (info: OverlayFeatureInfo): boolean =>
  info.isArea && info.placeId !== null;

// --- the map side --------------------------------------------------------------------------------

export interface OverlayMapLike {
  getLayer(id: string): unknown;
  queryRenderedFeatures(
    geometry: [[number, number], [number, number]] | { x: number; y: number },
    options: { layers: string[] },
  ): readonly {
    properties?: Record<string, unknown> | null;
    geometry?: { type?: string } | null;
  }[];
  on(type: string, listener: (e: never) => void): unknown;
  off(type: string, listener: (e: never) => void): unknown;
  getCanvas(): { style: { cursor: string } };
}

/** the first overlay feature under a screen point, among the layers that exist right now. A few
 * pixels of slack so a 1-px line can be hit. */
export function overlayFeatureAt(
  map: Pick<OverlayMapLike, "getLayer" | "queryRenderedFeatures">,
  point: { x: number; y: number },
  hitLayerIds: readonly string[],
  slack = 3,
): OverlayFeatureInfo | null {
  const layers = hitLayerIds.filter((id) => map.getLayer(id));
  if (!layers.length) return null;
  let features: ReturnType<OverlayMapLike["queryRenderedFeatures"]>;
  try {
    // the exact point first (a polygon fill is hit anywhere inside it; MapLibre's box query can miss a
    // polygon that contains the whole box), then a small box for a 1-px line or a point marker. A
    // plain `{x, y}`: measured on MapLibre 6.10, an event's own `Point` instance answers 0 where the
    // same coordinates as a plain object answer the feature.
    features = map.queryRenderedFeatures({ x: point.x, y: point.y }, { layers });
    if (!features.length && slack > 0) {
      features = map.queryRenderedFeatures(
        [
          [point.x - slack, point.y - slack],
          [point.x + slack, point.y + slack],
        ],
        { layers },
      );
    }
  } catch {
    return null; // a click racing a style swap
  }
  const f = features[0];
  return f ? overlayFeatureInfo(f.properties, f.geometry?.type) : null;
}

export interface OverlayInteractionOptions {
  /** the layer ids to ask about (read on every event: the toggles change them). */
  hitLayerIds(): readonly string[];
  /** true while a place pick/draw session owns map clicks: hover and click do nothing. */
  isOwned?(): boolean;
  /** the popup's add button was pressed. */
  onAdd(place: { id: string; name: string }): void;
}

export interface OverlayInteraction {
  destroy(): void;
}

export function installOverlayInteraction(
  map: OverlayMapLike,
  opts: OverlayInteractionOptions,
): OverlayInteraction {
  const hover = createPopup({
    closeButton: false,
    closeOnClick: false,
    offset: 10,
    maxWidth: "260px",
  });
  const card = createPopup({ closeButton: true, closeOnClick: true, maxWidth: "280px" });
  let hoverShown = false;
  const hideHover = () => {
    if (hoverShown) hover.remove();
    hoverShown = false;
    map.getCanvas().style.cursor = "";
  };

  const onMove = (e: { point: { x: number; y: number }; lngLat: { lng: number; lat: number } }) => {
    if (opts.isOwned?.()) return hideHover();
    const info = overlayFeatureAt(map, e.point, opts.hitLayerIds());
    if (!info) return hideHover();
    map.getCanvas().style.cursor = "pointer";
    hover.setLngLat([e.lngLat.lng, e.lngLat.lat]).setText(overlayHoverText(info));
    if (!hoverShown) {
      hover.addTo(map as never);
      hoverShown = true;
    }
  };

  const onClick = (e: {
    point: { x: number; y: number };
    lngLat: { lng: number; lat: number };
  }) => {
    if (opts.isOwned?.()) return;
    const info = overlayFeatureAt(map, e.point, opts.hitLayerIds());
    if (!info) return;
    hideHover();
    const root = document.createElement("div");
    root.className = "overlay-popup";
    const title = document.createElement("p");
    title.className = "overlay-popup-name";
    title.textContent = overlayHoverText(info);
    root.append(title);
    if (canAddToPlaces(info)) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = addToPlacesLabel(info.name);
      btn.addEventListener("click", () => {
        card.remove();
        opts.onAdd({ id: info.placeId as string, name: info.name });
      });
      root.append(btn);
    } else if (!info.isArea) {
      const note = document.createElement("p");
      note.textContent = "Only areas can be added to Places.";
      root.append(note);
    }
    card.setLngLat([e.lngLat.lng, e.lngLat.lat]).setDOMContent(root);
    card.addTo(map as never);
  };

  map.on("mousemove", onMove as never);
  map.on("mouseout", hideHover as never);
  map.on("click", onClick as never);
  return {
    destroy() {
      map.off("mousemove", onMove as never);
      map.off("mouseout", hideHover as never);
      map.off("click", onClick as never);
      hideHover();
      card.remove();
    },
  };
}
