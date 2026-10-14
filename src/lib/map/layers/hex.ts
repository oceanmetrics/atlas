// The hex-grid layer of a catalog collection: ONE PMTiles archive of geometry + `FID` only, painted
// by MapLibre FEATURE STATE from a Parquet value column (the D9 design: the old 61 MB archive carried
// ~40 attribute columns per feature and chunked at low zoom; this one carries nothing but the id).
//
// Three parts, from pure to wired:
//   1. specs      `hexSource`/`hexFillLayer`/`hexSelectedLayer`: plain style objects `composeStyle`
//                 folds into the ONE style (never `addLayer`). `promoteId` makes `feature.id` the
//                 `FID` property, which is what `setFeatureState({id})` keys on. The fill colour reads
//                 `["feature-state","value"]` through the collection's ramp; a cell with no state
//                 value draws transparent (never a wrong colour).
//   2. states     `hexFeatureStates`: the pure map from a value column to `{id, state}` pairs.
//   3. painter    `createHexPainter`: applies those states to a live map. Switching items re-applies
//                 states ONLY (the source, hence the geometry, is untouched: the style diff sees the
//                 same source); a source MapLibre re-created (a collection switch) is detected by
//                 identity and repainted from the last column.
//   4. interaction `installHexInteraction`: hover shows the value, click reports `{fid, value}`.
import type { ExpressionSpecification } from "maplibre-gl";
import type { ValueColumn } from "../../catalog/values";
import { SELECTION_COLOR } from "../colors";
import { overlayAt, registerCellLine } from "../clickInfo";
import { createPopup } from "../popup";
import type { LayerSpecification, SourceSpecification } from "../types";

export const HEX_SOURCE_ID = "hex";
export const HEX_FILL_ID = "hex-fill";
export const HEX_SELECTED_ID = "hex-selected";
export const HEX_FILL_OPACITY = 0.85;
/** WP4 "Only inside places": a cell whose `inside` state is exactly `false` draws at this opacity. */
export const HEX_OUTSIDE_OPACITY = 0.15;
/** the outline of the clicked cell. */
export const HEX_SELECTED_WIDTH = 3;

export interface HexLayerSpec {
  /** absolute https URL of the PMTiles archive. */
  pmtiles: string;
  /** the vector layer inside the archive. */
  sourceLayer: string;
  /** the feature id property (`FID`), promoted to the feature id. */
  idField: string;
  /** the ramp colours, low to high. */
  colors: readonly string[];
  /** the values the ramp spans: `[min, max]`, `max > min`. */
  domain: readonly [number, number];
  opacity?: number;
}

/**
 * The fill colour: the value's colour on the ramp (stops evenly spaced over `domain`), or
 * transparent when the cell has no numeric `value` state. Needs at least two ramp colours and a
 * `domain` with `max > min` (MapLibre requires strictly ascending stops); anything else yields a
 * single flat colour so a malformed ramp degrades instead of breaking the whole style.
 */
export function hexColorExpression(
  colors: readonly string[],
  domain: readonly [number, number],
): ExpressionSpecification {
  const none = "rgba(0,0,0,0)";
  const [lo, hi] = domain;
  if (colors.length < 2 || !(hi > lo))
    return [
      "case",
      ["==", ["typeof", ["feature-state", "value"]], "number"],
      colors[0] ?? none,
      none,
    ];
  const stops: (number | string)[] = [];
  colors.forEach((color, i) => {
    stops.push(lo + (i / (colors.length - 1)) * (hi - lo), color);
  });
  return [
    "case",
    ["==", ["typeof", ["feature-state", "value"]], "number"],
    ["interpolate", ["linear"], ["feature-state", "value"], ...stops],
    none,
  ] as ExpressionSpecification;
}

export function hexSource(spec: HexLayerSpec): SourceSpecification {
  return { type: "vector", url: `pmtiles://${spec.pmtiles}`, promoteId: spec.idField };
}

export function hexFillLayer(spec: HexLayerSpec): LayerSpecification {
  return {
    id: HEX_FILL_ID,
    type: "fill",
    source: HEX_SOURCE_ID,
    "source-layer": spec.sourceLayer,
    paint: {
      "fill-color": hexColorExpression(spec.colors, spec.domain),
      // a cell whose `inside` feature state is `false` (the "Only inside places" filter, `setInside`
      // below) is dimmed; no state, or `true`, is the normal opacity -- so the filter off is a no-op
      "fill-opacity": [
        "case",
        ["==", ["feature-state", "inside"], false],
        HEX_OUTSIDE_OPACITY,
        spec.opacity ?? HEX_FILL_OPACITY,
      ] as ExpressionSpecification,
      "fill-antialias": false,
    },
  };
}

/** the clicked cell's outline: a line layer whose width is 0 unless the cell's `selected` state. */
export function hexSelectedLayer(spec: HexLayerSpec): LayerSpecification {
  return {
    id: HEX_SELECTED_ID,
    type: "line",
    source: HEX_SOURCE_ID,
    "source-layer": spec.sourceLayer,
    paint: {
      "line-color": SELECTION_COLOR,
      "line-width": [
        "case",
        ["boolean", ["feature-state", "selected"], false],
        HEX_SELECTED_WIDTH,
        0,
      ] as ExpressionSpecification,
    },
  };
}

// --- states -------------------------------------------------------------------------------------

export interface FeatureStatePair {
  id: number;
  state: { value: number | null };
}

/** the `{id, state}` pairs `setFeatureState` is called with, one per row of the value column. A
 * non-finite FID cannot key a feature and is skipped; a missing value is `null` (drawn transparent). */
export function hexFeatureStates(column: ValueColumn): FeatureStatePair[] {
  const out: FeatureStatePair[] = [];
  const n = Math.min(column.fids.length, column.values.length);
  for (let i = 0; i < n; i++) {
    const id = column.fids[i];
    if (!Number.isFinite(id)) continue;
    const v = column.values[i];
    out.push({ id, state: { value: typeof v === "number" && Number.isFinite(v) ? v : null } });
  }
  return out;
}

// --- painter ------------------------------------------------------------------------------------

/** the slice of a MapLibre map the painter needs (a two-line fake satisfies it in a test). */
export interface HexPaintMap {
  getSource(id: string): unknown;
  setFeatureState(
    feature: { source: string; sourceLayer: string; id: number },
    state: Record<string, unknown>,
  ): void;
  on(type: "styledata", listener: () => void): unknown;
  off(type: "styledata", listener: () => void): unknown;
}

export interface HexPainter {
  /** paint `column` (`null` clears the painted values); safe to call before the source exists. */
  apply(column: ValueColumn | null): void;
  /** outline one cell (`null` clears it). */
  setSelected(fid: number | null): void;
  /** the "Only inside places" filter: the FIDs inside a place stay at full opacity, every other
   * painted cell is dimmed (`inside: false` feature state); `null` clears the filter. */
  setInside(fids: ReadonlySet<number> | null): void;
  destroy(): void;
}

export function createHexPainter(map: HexPaintMap, sourceLayer: string): HexPainter {
  let current: ValueColumn | null = null;
  let appliedSource: unknown = null;
  let appliedColumn: ValueColumn | null = null;
  let appliedIds = new Set<number>();
  let selected: number | null = null;
  let selectedApplied: number | null = null;
  let inside: ReadonlySet<number> | null = null;
  let insideApplied: ReadonlySet<number> | null = null;
  let insideTouched = new Set<number>();

  const feature = (id: number) => ({ source: HEX_SOURCE_ID, sourceLayer, id });

  function flush(): void {
    const source = map.getSource(HEX_SOURCE_ID);
    if (!source) return; // not in the style yet; the `styledata` listener retries
    if (appliedSource !== source) {
      // a source MapLibre (re)created starts with no states at all
      appliedSource = source;
      appliedColumn = null;
      appliedIds = new Set();
      selectedApplied = null;
      insideApplied = null;
      insideTouched = new Set();
    }
    let columnChanged = false;
    if (appliedColumn !== current) {
      columnChanged = true;
      const next = current ? hexFeatureStates(current) : [];
      const nextIds = new Set(next.map((p) => p.id));
      for (const { id, state } of next) map.setFeatureState(feature(id), state);
      // an FID the previous column had and this one lacks no longer has a value
      for (const id of appliedIds) {
        if (!nextIds.has(id)) map.setFeatureState(feature(id), { value: null });
      }
      appliedIds = nextIds;
      appliedColumn = current;
    }
    if (insideApplied !== inside || (columnChanged && inside)) {
      // flag every painted cell (in the place or not) while the filter is on; clear what was flagged
      // when it goes off. `inside: null` is "no state": the paint expression reads it as normal.
      if (inside) {
        for (const id of appliedIds) map.setFeatureState(feature(id), { inside: inside.has(id) });
        for (const id of insideTouched) {
          if (!appliedIds.has(id)) map.setFeatureState(feature(id), { inside: null });
        }
        insideTouched = new Set(appliedIds);
      } else {
        for (const id of insideTouched) map.setFeatureState(feature(id), { inside: null });
        insideTouched = new Set();
      }
      insideApplied = inside;
    }
    if (selectedApplied !== selected) {
      if (selectedApplied !== null)
        map.setFeatureState(feature(selectedApplied), { selected: false });
      if (selected !== null) map.setFeatureState(feature(selected), { selected: true });
      selectedApplied = selected;
    }
  }

  map.on("styledata", flush);
  return {
    apply(column) {
      current = column;
      flush();
    },
    setSelected(fid) {
      selected = fid;
      flush();
    },
    setInside(fids) {
      inside = fids;
      flush();
    },
    destroy() {
      map.off("styledata", flush);
    },
  };
}

// --- interaction ----------------------------------------------------------------------------------

/** "Cell 1234: 0.42" -- the hover text; `null` value reads "no value". An `extra` (e.g. "12 likely
 * species") is appended after a middle dot. Pure. */
export function hexHoverText(
  fid: number,
  value: number | null | undefined,
  format: (v: number) => string = (v) => String(v),
  extra?: string | null,
): string {
  const base = `Cell ${fid}: ${typeof value === "number" ? format(value) : "no value"}`;
  return extra ? `${base} · ${extra}` : base;
}

/** the FID of the first feature of a `queryRenderedFeatures`/event answer that carries one. */
export function fidOfFeatures(
  features: readonly { id?: string | number | null }[] | undefined,
): number | null {
  for (const f of features ?? []) {
    const n = typeof f.id === "number" ? f.id : typeof f.id === "string" ? Number(f.id) : NaN;
    if (Number.isFinite(n)) return n;
  }
  return null;
}

export interface HexMouseEvent {
  features?: { id?: string | number | null }[];
  lngLat: { lng: number; lat: number };
  point?: { x: number; y: number };
}

/** the slice of a MapLibre map the interaction needs. */
export interface HexInteractionMap {
  on(
    type: "mousemove" | "mouseleave" | "click",
    layerId: string,
    listener: (e: never) => void,
  ): unknown;
  off(
    type: "mousemove" | "mouseleave" | "click",
    layerId: string,
    listener: (e: never) => void,
  ): unknown;
  getCanvas(): { style: { cursor: string } };
  /** lets the cell's data line be offered to an overlay popup that sits over the same point. */
  queryRenderedFeatures?(
    geometry: { x: number; y: number },
    options: { layers: string[] },
  ): readonly { id?: string | number | null }[];
}

export interface HexInteractionOptions {
  /** the item's value in cell `fid` (from the column already in memory). */
  valueOf(fid: number): number | null | undefined;
  /** formats a value for the hover text. */
  format?: (v: number) => string;
  /** a second hover fact from data already in memory ("12 likely species"); `null`/absent for none.
   * Called on every mousemove, so it must be a lookup, never a fetch. */
  extra?(fid: number): string | null | undefined;
  /** called with the clicked cell. */
  onClick(cell: { fid: number; value: number | null; lngLat: [number, number] }): void;
  /** while true (a place pick/draw session owns map clicks) hover and click do nothing. */
  isOwned?(): boolean;
}

export interface HexInteraction {
  destroy(): void;
}

/** hover shows the value in a small popup that follows the cursor; click reports the cell. */
export function installHexInteraction(
  map: HexInteractionMap,
  opts: HexInteractionOptions,
): HexInteraction {
  const popup = createPopup({
    closeButton: false,
    closeOnClick: false,
    offset: 10,
    maxWidth: "240px",
  });
  let shown = false;
  const hide = () => {
    if (shown) popup.remove();
    shown = false;
    map.getCanvas().style.cursor = "";
  };
  const onMove = (e: HexMouseEvent) => {
    if (opts.isOwned?.()) return hide();
    const fid = fidOfFeatures(e.features);
    if (fid === null) return hide();
    // a gazetteer overlay feature over the cell: ITS hover popup carries this cell's line too, so
    // this one stays away (one popup, never two)
    if (e.point && overlayAt(e.point)) {
      if (shown) popup.remove(); // (the overlay's own handler owns the cursor)
      shown = false;
      return;
    }
    map.getCanvas().style.cursor = "pointer";
    popup
      .setLngLat([e.lngLat.lng, e.lngLat.lat])
      .setText(hexHoverText(fid, opts.valueOf(fid), opts.format, opts.extra?.(fid)));
    if (!shown) {
      popup.addTo(map as never); // the real MapLibre map is what the shell passes in
      shown = true;
    }
  };
  const onClick = (e: HexMouseEvent) => {
    if (opts.isOwned?.()) return;
    const fid = fidOfFeatures(e.features);
    if (fid === null) return;
    const v = opts.valueOf(fid);
    opts.onClick({
      fid,
      value: typeof v === "number" ? v : null,
      lngLat: [e.lngLat.lng, e.lngLat.lat],
    });
  };
  // the cell's data line, for an overlay popup over the same point (the hover text, so the two agree)
  const unregister = registerCellLine((point) => {
    if (opts.isOwned?.() || !map.queryRenderedFeatures) return null;
    const fid = fidOfFeatures(map.queryRenderedFeatures(point, { layers: [HEX_FILL_ID] }));
    return fid === null
      ? null
      : hexHoverText(fid, opts.valueOf(fid), opts.format, opts.extra?.(fid));
  });
  map.on("mousemove", HEX_FILL_ID, onMove as never);
  map.on("mouseleave", HEX_FILL_ID, hide as never);
  map.on("click", HEX_FILL_ID, onClick as never);
  return {
    destroy() {
      unregister();
      map.off("mousemove", HEX_FILL_ID, onMove as never);
      map.off("mouseleave", HEX_FILL_ID, hide as never);
      map.off("click", HEX_FILL_ID, onClick as never);
      hide();
    },
  };
}
