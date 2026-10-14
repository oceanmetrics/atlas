// The value of a COG item under the pointer (WP14), for the Collections lens: the counterpart of
// `installHexInteraction` (hex.ts), which reads its values from memory. A raster has no feature to query,
// so the value comes from a `/cog/point` read behind the injected `read` (the lens wires `ValueSource`).
//
//   - HOVER: debounced (`raster/pointRead.ts#createHoverReader`, 250 ms after the pointer settles, never
//     while the map moves, one read in flight, a newer move aborts it); the answer shows in a small
//     tooltip. The request budget is written down in that module's header.
//   - CLICK: one read (a newer click aborts the previous); the answer opens ONE card (subject, value,
//     coordinates, a Details link) that stays until the next click, its close button, or the pointer
//     moving away from it; `onClick` also reports the value so the lens can mark the legend and fill
//     the Details tool. Over a gazetteer overlay feature the overlay's own card owns the click, and the
//     value joins it as a card line (`clickInfo.ts`): never two popups for one click.
//   - the hover and the card never show together (`pinned`), and an overlay feature under the pointer
//     silences the hover read (the overlay's tooltip owns that spot).
import {
  createHoverReader,
  createLatestRead,
  shouldUnpin,
  type Timers,
} from "../../raster/pointRead";
import { overlayAt, pushCardLine, registerCellLine } from "../clickInfo";
import { createPopup, valuePopupAnnounceText, valuePopupHtml } from "../popup";

export interface RasterPointer {
  lngLat: { lng: number; lat: number };
  point?: { x: number; y: number };
}

export interface RasterInteractionMap {
  on(type: string, listener: (e: never) => void): unknown;
  off(type: string, listener: (e: never) => void): unknown;
  getCanvas(): { style: { cursor: string } };
  isMoving(): boolean;
}

export interface RasterInteractionOptions {
  /** the value at a position (`null` = no data); rejects or resolves null on a failure. The lens bounds-checks. */
  read(lngLat: [number, number], signal: AbortSignal): Promise<number | null>;
  /** true when a position is outside the layer's known footprint (no read, no popup). */
  outside?(lngLat: [number, number]): boolean;
  /** the value as text, unit included ("87%", "no data"). */
  format(v: number | null): string;
  /** the card's subject line (the item's label). */
  subject(): string;
  /** the ramp colour of a value for the card's swatch; `null` = grey. */
  color?(v: number): string | null;
  /** a click started: the lens marks the position and clears the previous value. */
  onClickStart(lngLat: [number, number]): void;
  /** the click's value arrived (`null` = no data). */
  onClickValue(lngLat: [number, number], value: number | null): void;
  /** a place pick/draw session owns map clicks, or another lens is showing. */
  isOwned?(): boolean;
  /** screen-reader announcement of the card's text. */
  announce?(text: string): void;
  timers?: Timers;
}

export interface RasterInteraction {
  destroy(): void;
}

const coordText = (ll: [number, number]): string => `${ll[1].toFixed(3)}, ${ll[0].toFixed(3)}`;

export function installRasterInteraction(
  map: RasterInteractionMap,
  opts: RasterInteractionOptions,
): RasterInteraction {
  const hoverPopup = createPopup({
    closeButton: false,
    closeOnClick: false,
    offset: 10,
    maxWidth: "240px",
  });
  const card = createPopup({ closeButton: true, closeOnClick: true, maxWidth: "260px" });
  card.on("close", () => {
    pinnedAt = null;
  });
  let hoverShown = false;
  let pinnedAt: { x: number; y: number } | null = null;
  // where the last hover read landed, for the overlay card's data line
  let lastHover: { point: { x: number; y: number }; text: string } | null = null;

  const hideHover = () => {
    if (hoverShown) hoverPopup.remove();
    hoverShown = false;
  };

  const hover = createHoverReader<[number, number], number | null>({
    read: (ll, signal) => opts.read(ll, signal),
    isMoving: () => map.isMoving(),
    timers: opts.timers,
    onResult: (ll, v) => {
      if (pinnedAt || opts.isOwned?.()) return;
      const text = opts.format(v);
      if (lastHover) lastHover = { point: lastHover.point, text };
      hoverPopup.setLngLat(ll).setText(text);
      if (!hoverShown) hoverPopup.addTo(map as never);
      hoverShown = true;
    },
  });
  // the pointer position the pending hover read belongs to (for the overlay line)
  const onMove = (e: RasterPointer) => {
    if (opts.isOwned?.()) {
      hover.cancel();
      return hideHover();
    }
    if (pinnedAt && e.point && !shouldUnpin(pinnedAt, e.point)) return;
    if (pinnedAt) {
      card.remove();
      pinnedAt = null;
    }
    hideHover();
    const ll: [number, number] = [e.lngLat.lng, e.lngLat.lat];
    lastHover = e.point ? { point: e.point, text: "" } : null;
    if ((e.point && overlayAt(e.point)) || opts.outside?.(ll)) return hover.cancel();
    hover.move(ll);
  };

  // a click's answer: the lens learns the value; the card opens (unless an overlay card owns this click,
  // where the value joins it as a line)
  let cardWanted = false;
  const finish = (ll: [number, number], v: number | null) => {
    opts.onClickValue(ll, v);
    const text = opts.format(v);
    if (cardWanted) {
      const body = {
        subject: opts.subject(),
        valueLine: text,
        swatchColor: v === null ? null : (opts.color?.(v) ?? null),
        textColor: null,
        unitLabel: coordText(ll),
        detailsLink: true,
      };
      card.setLngLat(ll).setHTML(valuePopupHtml(body)).addTo(map as never);
      opts.announce?.(valuePopupAnnounceText(body));
    } else pushCardLine(ll, text);
  };
  const click = createLatestRead<[number, number], number | null>(
    (ll, signal) => opts.read(ll, signal),
    finish,
  );

  const onClick = (e: RasterPointer) => {
    if (opts.isOwned?.()) return;
    const ll: [number, number] = [e.lngLat.lng, e.lngLat.lat];
    hover.cancel();
    hideHover();
    opts.onClickStart(ll);
    card.remove();
    cardWanted = !(e.point && overlayAt(e.point));
    // pin at once: the hover stays quiet while the card is on its way
    pinnedAt = cardWanted ? (e.point ?? { x: 0, y: 0 }) : null;
    if (opts.outside?.(ll)) {
      click.cancel();
      finish(ll, null);
      return;
    }
    click.run(ll);
  };

  // the overlay card's data line for a point the hover has already read (else the overlay says only the place)
  const unregister = registerCellLine((point) =>
    lastHover &&
    lastHover.text &&
    Math.hypot(lastHover.point.x - point.x, lastHover.point.y - point.y) <= 4
      ? lastHover.text
      : null,
  );
  const onMoveStart = () => {
    hover.cancel();
    hideHover();
  };
  const onMoveEnd = () => hover.idle();
  const onLeave = () => {
    hover.cancel();
    hideHover();
  };
  map.on("mousemove", onMove as never);
  map.on("mouseout", onLeave as never);
  map.on("click", onClick as never);
  map.on("movestart", onMoveStart as never);
  map.on("moveend", onMoveEnd as never);
  return {
    destroy() {
      unregister();
      hover.cancel();
      click.cancel();
      map.off("mousemove", onMove as never);
      map.off("mouseout", onLeave as never);
      map.off("click", onClick as never);
      map.off("movestart", onMoveStart as never);
      map.off("moveend", onMoveEnd as never);
      hideHover();
      card.remove();
    },
  };
}
