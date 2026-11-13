// Hover and click on a collection's own vector overlays (`atlas:overlays`): a lazy chunk the Collections
// lens loads once an overlay is on (`state.svelte.ts`), so a collection without overlays carries none of it.
//
//   hover   a pointer cursor over a clickable feature and a small tooltip: its `label_field` value (else the
//           overlay's title), with the Item's value line under it when a hex cell or a raster value is known.
//   click   ONE card (`lib/map/popup.ts#createPopup`, themed in both themes) listing every feature of every
//           visible overlay under the click, top overlay first (`./overlayPopup.ts`), and the Item's value
//           line under the list. Points and lines are hit within a small box (`HIT_SLACK_PX`), polygons at
//           the exact point (a box would also catch the neighbouring hexagons). Escape, the close button, or
//           a click that hits no feature closes it.
//   one popup   the overlays register a LENS probe (`lib/map/clickInfo.ts`): the hex hover and the raster
//           card stay away where a feature is, the raster's click value joins this card as a late line, and
//           the gazetteer's place layers leave the click to it.
//
// The pure parts (which features, in which order, what the card says) are exported and unit-tested; the
// MapLibre popup is the only part that is not.
import type { CollectionOverlaySpec } from "../../lib/catalog/overlays";
import { cellLineAt, registerCardLineSink, registerOverlayProbe } from "../../lib/map/clickInfo";
import { covHitLayerId } from "../../lib/map/layers/collectionOverlays";
import { createPopup } from "../../lib/map/popup";
import {
  overlayAnnounceText,
  overlayHoverText,
  overlayPopupHtml,
  type OverlayHit,
} from "./overlayPopup";
import "./overlayPopup.css";

/** how far (px) from a point or a line a click still hits it: a 4.5 px circle, a 1.5 px line. */
export const HIT_SLACK_PX = 6;

/** the card's width: never wider than a phone screen, less a gutter. */
export const CARD_MAX_WIDTH = "min(380px, calc(100vw - 32px))";

interface RenderedFeature {
  id?: string | number | null;
  layer?: { id?: string } | null;
  properties?: Record<string, unknown> | null;
}

export interface OverlayMapLike {
  getLayer(id: string): unknown;
  queryRenderedFeatures(
    geometry: [[number, number], [number, number]] | { x: number; y: number },
    options: { layers: string[] },
  ): readonly RenderedFeature[];
  on(type: string, listener: (e: never) => void): unknown;
  off(type: string, listener: (e: never) => void): unknown;
  getCanvas(): { style: { cursor: string } };
}

/**
 * Every feature of the given overlays under a screen point, grouped by overlay in `overlays` order (the
 * draw order, top first), each overlay's own features in MapLibre's order, a feature split across tiles
 * once. Overlays whose layer is not on the map right now are skipped; a query racing a style swap is none.
 */
export function overlayHitsAt(
  map: Pick<OverlayMapLike, "getLayer" | "queryRenderedFeatures">,
  point: { x: number; y: number },
  overlays: readonly CollectionOverlaySpec[],
  slack: number = HIT_SLACK_PX,
): OverlayHit[] {
  const byLayer = new Map<string, CollectionOverlaySpec>();
  for (const s of overlays) byLayer.set(covHitLayerId(s), s);
  const present = [...byLayer.keys()].filter((id) => map.getLayer(id));
  const areas = present.filter((id) => byLayer.get(id)!.geometry === "polygon");
  const thin = present.filter((id) => byLayer.get(id)!.geometry !== "polygon");
  const found: RenderedFeature[] = [];
  try {
    // a plain `{x, y}` (an event's own Point instance answers nothing on MapLibre 6.10, overlayInteraction.ts)
    if (thin.length) {
      found.push(
        ...map.queryRenderedFeatures(
          [
            [point.x - slack, point.y - slack],
            [point.x + slack, point.y + slack],
          ],
          { layers: thin },
        ),
      );
    }
    if (areas.length) {
      found.push(...map.queryRenderedFeatures({ x: point.x, y: point.y }, { layers: areas }));
    }
  } catch {
    return [];
  }
  const out: OverlayHit[] = [];
  for (const spec of overlays) {
    const layerId = covHitLayerId(spec);
    const seen = new Set<string>();
    for (const f of found) {
      if (f.layer?.id !== layerId) continue;
      const properties = f.properties ?? {};
      const key = f.id !== undefined && f.id !== null ? `#${f.id}` : JSON.stringify(properties);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ spec, properties });
    }
  }
  return out;
}

export interface CollectionOverlayInteractionOptions {
  /** the overlays that are on, in draw order, top first (read on every event: the toggles change them). */
  overlays(): readonly CollectionOverlaySpec[];
  /** a place pick/draw session owns map clicks, or another lens is showing: hover and click do nothing. */
  isOwned?(): boolean;
  /** screen-reader announcement of the card. */
  announce?(text: string): void;
  /** the document Escape is listened on (a test passes a fake); default the page's. */
  doc?: Pick<Document, "addEventListener" | "removeEventListener"> | null;
}

export interface CollectionOverlayInteraction {
  destroy(): void;
}

interface PointerEvent {
  point: { x: number; y: number };
  lngLat: { lng: number; lat: number };
}

export function installCollectionOverlayInteraction(
  map: OverlayMapLike,
  opts: CollectionOverlayInteractionOptions,
): CollectionOverlayInteraction {
  const doc =
    opts.doc === undefined ? (typeof document === "undefined" ? null : document) : opts.doc;
  const hover = createPopup({
    closeButton: false,
    closeOnClick: false,
    offset: 10,
    maxWidth: "260px",
  });
  // not `closeOnClick`: MapLibre dispatches a click to a COPY of its listeners, so the previous card's own
  // close-on-click handler would still run after this click re-opened the card and close it again; a click
  // that hits no feature closes it here instead
  const card = createPopup({
    closeButton: true,
    closeOnClick: false,
    maxWidth: CARD_MAX_WIDTH,
    className: "atlas-popup--overlays",
  });
  let hoverShown = false;
  let cursorOwned = false;
  let cardAt: [number, number] | null = null;

  const hits = (point: { x: number; y: number }) =>
    opts.isOwned?.() ? [] : overlayHitsAt(map, point, opts.overlays());

  const hideHover = () => {
    if (hoverShown) hover.remove();
    hoverShown = false;
    if (cursorOwned) map.getCanvas().style.cursor = "";
    cursorOwned = false;
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape" && card.isOpen()) card.remove();
  };
  card.on("close", () => {
    cardAt = null;
    doc?.removeEventListener("keydown", onKey as EventListener);
  });

  const onMove = (e: PointerEvent) => {
    const found = hits(e.point);
    if (!found.length) return hideHover();
    map.getCanvas().style.cursor = "pointer";
    cursorOwned = true;
    const root = document.createElement("div");
    root.className = "overlay-popup";
    const name = document.createElement("p");
    name.className = "overlay-popup-name";
    name.textContent =
      found.length > 1
        ? `${overlayHoverText(found[0])} (+${found.length - 1})`
        : overlayHoverText(found[0]);
    root.append(name);
    const cell = cellLineAt(e.point);
    if (cell) {
      const p = document.createElement("p");
      p.className = "overlay-popup-cell";
      p.textContent = cell;
      root.append(p);
    }
    hover.setLngLat([e.lngLat.lng, e.lngLat.lat]).setDOMContent(root);
    if (!hoverShown) {
      hover.addTo(map as never);
      hoverShown = true;
    }
  };

  const onClick = (e: PointerEvent) => {
    const found = hits(e.point);
    if (!found.length) {
      if (card.isOpen()) card.remove();
      return;
    }
    hideHover();
    const at: [number, number] = [e.lngLat.lng, e.lngLat.lat];
    card
      .setLngLat(at)
      .setHTML(overlayPopupHtml(found, cellLineAt(e.point)))
      .addTo(map as never);
    cardAt = at;
    doc?.addEventListener("keydown", onKey as EventListener);
    opts.announce?.(overlayAnnounceText(found));
  };

  // a raster value read after the click (`layers/rasterValue.ts`) fills the card's value line
  const unregisterSink = registerCardLineSink((lngLat, text) => {
    if (!cardAt || !card.isOpen() || cardAt[0] !== lngLat[0] || cardAt[1] !== lngLat[1]) return;
    const p = card.getElement()?.querySelector<HTMLElement>(".atlas-popup-ov-cell");
    if (!p) return;
    p.textContent = text;
    p.hidden = false;
  });
  // the probe the hex hover, the raster card and the gazetteer's place layers ask first
  const unregisterProbe = registerOverlayProbe((point) => hits(point).length > 0, { lens: true });
  map.on("mousemove", onMove as never);
  map.on("mouseout", hideHover as never);
  map.on("click", onClick as never);
  return {
    destroy() {
      unregisterProbe();
      unregisterSink();
      map.off("mousemove", onMove as never);
      map.off("mouseout", hideHover as never);
      map.off("click", onClick as never);
      hideHover();
      card.remove();
    },
  };
}
