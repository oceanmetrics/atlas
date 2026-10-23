// R3 (2026-09-24, Ben's decision, `docs/usability.md` §7 R3 / round-2 plan §5 U4/§10): "one Layers
// panel that IS the stack, the data row expanding into today's controls — PLUS the ability to
// change the stacking of data layers (Program Areas, the score raster) relative to map layers
// (place names, bathymetry): some map layers belong on top of, some underneath, a semi-transparent
// data layer."
//
// This module is the pure, unit-tested stack MODEL — no MapLibre, no Svelte, no DOM. `style.ts`
// consumes it (composeStyle still returns ONE style object, one `setStyle(diff:true)` — CLAUDE.md's
// "one MapLibre style" rule; this is a REORDER/opacity input to that one call, never a second style
// or a second `setLayoutProperty` after the fact). `state/codec.ts` consumes its parse/format pair
// for the `layers=` URL key (plan D8/U4 Deliverable 2 — "deviations from the default stack live in
// the query"). `src/lib/ui/LayersPanel.svelte` (both lenses) renders it.
//
// Borrows CalCOFI explore's shape (`src/layers.tsx`/`src/state.ts`'s `LayerStyle[]`/`layers=`) —
// see `atlas-refs/"calcofi explore review.md"` and the round-2 plan §10 — adapted to this app's
// CARTO-merged-whole-style basemap (`style.ts#mergeCartoStyle`) instead of CalCOFI's own
// per-dataset PMTiles registry: there is no per-basemap-FEATURE registry here, only five coarse
// ROLES a merged CARTO layer is classified into (`classifyBasemapLayer`, below).

import { RELEASE_KEYS } from "../state/types";

/** the Outlines row (`data-zones`) exists only where the release draws zone units (an instance with
 * `release`); elsewhere it is not a group at all: not in the default stack, the panel or a parsed
 * `layers=` token. */
const ZONES_GROUP = RELEASE_KEYS;

/** the basemap's five roles, bottom-to-top as CARTO's OWN style.json already draws them (land under
 * water under boundaries under roads under labels — every real vector basemap style is already
 * ordered this way; this module only gives that existing order NAMES a user can move relative to
 * the data). `basemap-bathymetry` has no CARTO layer today (CARTO ships no relief/depth/contour
 * layer) — the group exists, EMPTY and disabled (`LAYER_GROUP_ENABLED`), ready for a GEBCO PMTiles
 * source later (round-2 plan §5 U4's own words) without a second stack-model change. */
export const BASEMAP_GROUPS = [
  "basemap-land",
  "basemap-bathymetry",
  "basemap-boundaries",
  "basemap-roads",
  "basemap-labels",
] as const;
export type BasemapGroupId = (typeof BASEMAP_GROUPS)[number];

/** the lens's data, in draw order today: the score/species raster (+ its species range fill —
 * folded into ONE row, "the lens's data", per the deliverable's own "raster (score or species)"
 * wording), the Program-Area choropleth/outlines, and the places/selection highlight. `data-places`
 * folds in what the deliverable lists separately as "places (outline, cells, pick highlight)" AND
 * "selection": both draw through the SAME `selection-fill`/`selection-line` pair in `style.ts`
 * (one GeoJSON source, `SELECTION_SOURCE_ID`) — there is no second source/layer pair to split them
 * across two independently-orderable rows without a deeper refactor of `places/` and the click/pick
 * wiring, which is out of R3's scope. Flagged for the Opus review, per this task's own instructions. */
export const DATA_GROUPS = ["data-raster", "data-zones", "data-overlays", "data-places"] as const;
export type DataGroupId = (typeof DATA_GROUPS)[number];

export type LayerGroupId = BasemapGroupId | DataGroupId;

/** every group id, in the STACK's own canonical listing order (not draw order — `DEFAULT_LAYER_STACK`
 * is the draw order). Used to validate a parsed `layers=` token names only real groups. */
export const ALL_LAYER_GROUPS: readonly LayerGroupId[] = [...BASEMAP_GROUPS, ...DATA_GROUPS].filter(
  (id) => id !== "data-zones" || ZONES_GROUP,
);

export function isLayerGroupId(v: string): v is LayerGroupId {
  return (ALL_LAYER_GROUPS as readonly string[]).includes(v);
}

/** the panel's row label for each group — plain title case, hand-written per GROUP, not derived
 * from a real composed layer id: the STACK is chrome the app defines, not data the release
 * publishes (review round 1's m7 deleted the old `style.ts#layersControlItems`/`layersControlLabel`
 * — a per-layer-id label derived from `style.layers` — as dead code with no caller since R3 built
 * this coarser, GROUP-level panel instead). */
export const LAYER_GROUP_LABEL: Record<LayerGroupId, string> = {
  "basemap-land": "Land & water",
  "basemap-bathymetry": "Bathymetry",
  "basemap-boundaries": "Boundaries",
  "basemap-roads": "Roads & buildings",
  "basemap-labels": "Place labels",
  "data-raster": "Data",
  // "Outlines," not "Program Areas" (M5 fix, Opus 5.5 review): a REAL choropleth (computed
  // values) now classifies as role "choropleth" -> group `data-raster` (`style.ts`'s own M5
  // comment) — this group only ever holds the OUTLINE (`zone-line`) + the invisible B3 query-fill
  // placeholder + the zone name labels, never the visible data itself, so a label naming the one
  // release-specific unit ("Program Areas") would be wrong the moment a release publishes a
  // DIFFERENT outline-only unit. Orchestrator hand-off (Opus UI review of main, 2026-09-25): "the
  // word 'zone' must not leak into the UI" -- was "Zone outlines"; the model's own id (`data-zones`)
  // is unaffected, this is display text only.
  "data-zones": "Outlines",
  // WP4: the gazetteer collections toggled in the "Places" list under this row (sanctuaries, wind
  // leases, ...). "Place layers", not "Places": the rail has a button named exactly "Places" (see the
  // note below on why a row label must not contain that word).
  "data-overlays": "Place layers",
  // "Selection", never a label containing the word "Places" -- the tool rail already has a
  // button named exactly "Places" (`src/shell/tools.ts`), and this row's own move buttons carry
  // its label INSIDE their aria-label ("Move {label} up/down…"); a label containing "Places" made
  // `getByRole("button", {name: "Places"})` (an existing e2e locator, substring-matched by
  // default) resolve to three buttons instead of one (measured:
  // e2e/scores.collapsed-panel.spec.ts went red the moment this row existed).
  "data-places": "Selection",
};

/** `basemap-bathymetry` renders nothing today (no GEBCO source yet) — the panel shows it disabled
 * rather than hiding it, so the row's PRESENCE documents "this is coming," per the deliverable. */
export const LAYER_GROUP_ENABLED: Record<LayerGroupId, boolean> = {
  "basemap-land": true,
  "basemap-bathymetry": false,
  "basemap-boundaries": true,
  "basemap-roads": true,
  "basemap-labels": true,
  "data-raster": true,
  "data-zones": true,
  "data-overlays": true,
  "data-places": true,
};

/**
 * R3 (Ben, live-review 2026-09-25): "clean up the Layers pane... drop [Roads & buildings,
 * Boundaries, Land & water] that are fine to leave on as default basemap without worrying about
 * layer ordering." These three groups stay FULL model citizens — present in
 * {@link DEFAULT_LAYER_STACK}, still classified by {@link classifyBasemapLayer}, still round-trip
 * through the `layers=` codec ({@link parseLayerStack}/{@link formatLayerStack}), still restored by
 * "Reset layers" — this table ONLY says whether `src/lib/ui/LayersPanel.svelte` lists the group as
 * a row. A `layers=` link naming a hidden group (e.g. `basemap-roads:h`) still parses and still
 * applies; the viewer just has no panel row to change it from again short of Reset or a new link.
 *
 * `basemap-bathymetry` ALSO hidden (orchestrator hand-off, Opus UI review of main, 2026-09-25):
 * "do NOT ship the 'Bathymetry — coming soon' stub row to reviewers." An unbuilt, permanently
 * disabled row with no working control is not a feature to preview — same "keep it in the model,
 * not in front of a reviewer" rule the three basemap rows above already follow, just for a
 * different reason (unbuilt vs. "fine as a fixed default"). Still full model citizen; still
 * classified disabled via {@link LAYER_GROUP_ENABLED}, so nothing about the STACK changes, only
 * what the panel lists.
 */
export const LAYER_GROUP_IN_PANEL: Record<LayerGroupId, boolean> = {
  "basemap-land": false,
  "basemap-bathymetry": false,
  "basemap-boundaries": false,
  "basemap-roads": false,
  "basemap-labels": true,
  "data-raster": true,
  "data-zones": ZONES_GROUP,
  "data-overlays": true,
  "data-places": true,
};

/**
 * The default stack, bottom (index 0) to top (last) — draw order, the same convention
 * `style.ts#LAYER_ORDER` already used. This is EXACTLY today's rendering (every basemap sub-role
 * sits where the old single "basemap" role sat, all of it under the raster): moving `basemap-labels`
 * above `data-raster` is a NEW capability this stack adds, not a change to what a fresh page shows.
 */
export const DEFAULT_LAYER_STACK: readonly LayerGroupId[] = [
  "basemap-land",
  "basemap-bathymetry",
  "basemap-boundaries",
  "basemap-roads",
  "basemap-labels",
  "data-raster",
  "data-zones",
  "data-overlays",
  "data-places",
].filter((id) => id !== "data-zones" || ZONES_GROUP) as LayerGroupId[];

export interface LayerStackEntry {
  id: LayerGroupId;
  visible: boolean;
  /** 0..1. `1` is the no-op default — `style.ts` never touches a layer's own paint when a group's
   * opacity is exactly 1, so a release's zoom-dependent CARTO paint expression is only overridden
   * once the viewer actually moves the slider (this module's own `applyLayerGroupStyling`). */
  opacity: number;
}

/**
 * The default stack of a layer whose hexagons are opaque and large (the OBIS h3 layer, `docs/obis-layer.md`):
 * `basemap-labels` sits just ABOVE `data-raster`, so place names read over the hexagons (the stock stack draws
 * them under the data, and a res-1 to 3 hexagon hides them). A per-layer default, not a global change: every other
 * layer keeps {@link DEFAULT_LAYER_STACK}, and a viewer who moves the labels back down writes a `layers=` token,
 * since it then differs from this layer's default.
 */
export const LABELS_ABOVE_DATA_STACK: readonly LayerGroupId[] = (() => {
  const out: LayerGroupId[] = DEFAULT_LAYER_STACK.filter((id) => id !== "basemap-labels");
  out.splice(out.indexOf("data-raster") + 1, 0, "basemap-labels");
  return out;
})();

/** the stack a fresh page of a layer shows: `labelsAboveData` is the h3 layer's ({@link LABELS_ABOVE_DATA_STACK}). */
export function defaultLayerStackEntries(labelsAboveData = false): LayerStackEntry[] {
  return (labelsAboveData ? LABELS_ABOVE_DATA_STACK : DEFAULT_LAYER_STACK).map((id) => ({
    id,
    visible: true,
    opacity: 1,
  }));
}

/** shared by {@link parseLayerStack} (M2, review round 1) and {@link normalizeLayerStack} below:
 * inserts every {@link DEFAULT_LAYER_STACK} id NOT already in `out` right after its own nearest
 * EARLIER default predecessor that IS present — never appended at the array's end/top, which used
 * to bury a partial token's own data under an opaque land fill (`parseLayerStack`'s own header has
 * the full story). Mutates and returns `out` in place; both callers already own a throwaway array
 * by the time they call this. */
function insertMissingAtDefaultPosition(out: LayerStackEntry[]): LayerStackEntry[] {
  const seen = new Set(out.map((e) => e.id));
  for (const id of DEFAULT_LAYER_STACK) {
    if (seen.has(id)) continue;
    const defaultIdx = DEFAULT_LAYER_STACK.indexOf(id);
    let insertAt = 0;
    for (let i = defaultIdx - 1; i >= 0; i--) {
      const pos = out.findIndex((e) => e.id === DEFAULT_LAYER_STACK[i]);
      if (pos !== -1) {
        insertAt = pos + 1;
        break;
      }
    }
    out.splice(insertAt, 0, { id, visible: true, opacity: 1 });
    seen.add(id);
  }
  return out;
}

/**
 * review round 2 (re-check of M7): `moveLayerStackEntry` rejects any SINGLE move that would
 * invert `data-raster`/`data-zones`/`data-places`' relative order or pass `data-places`' own
 * position — but a `layers=` URL can name every group explicitly, in ANY order, bypassing that
 * incremental check entirely (`?layers=data-places,data-zones,data-raster` put Selection at the
 * very BOTTOM, under the raster, and only "Reset layers" repaired it — the live bug the re-check
 * found). This is the one place that GUARANTEES the final order regardless of how `entries`
 * arrived: `data-places` is pinned to the very end (moved there if it is not already); if
 * `data-raster`/`data-zones` are both present and inverted, their two array SLOTS are swapped (not
 * the whole array reordered), so a token that only gets the data order wrong keeps every basemap
 * row exactly where it named it. Returns the SAME reference when the order was already correct.
 * `DATA_RELATIVE_ORDER` is declared further down this file, near `moveLayerStackEntry` -- fine to
 * reference here (a `const`, but by the time this function is actually CALLED the whole module has
 * finished evaluating top to bottom). */
function enforceDataOrder(entries: readonly LayerStackEntry[]): readonly LayerStackEntry[] {
  let out = entries;
  const placesIdx = out.findIndex((e) => e.id === "data-places");
  if (placesIdx !== -1 && placesIdx !== out.length - 1) {
    const copy = [...out];
    const [places] = copy.splice(placesIdx, 1);
    copy.push(places);
    out = copy;
  }
  const rasterIdx = out.findIndex((e) => e.id === "data-raster");
  const zonesIdx = out.findIndex((e) => e.id === "data-zones");
  if (rasterIdx !== -1 && zonesIdx !== -1 && rasterIdx > zonesIdx) {
    const copy = [...out];
    [copy[rasterIdx], copy[zonesIdx]] = [copy[zonesIdx], copy[rasterIdx]];
    out = copy;
  }
  return out;
}

/**
 * m10 (review round 1): `style.ts#composeStyle` takes `layerStack` directly (not only through
 * {@link parseLayerStack}'s own URL-string normalisation) -- a caller that hands it a hand-built,
 * incomplete array (missing a group entirely, e.g. `data-places`) used to make `orderLayers` throw
 * ("has a role ... which is not in the declared stack order"), because a role with no rank at all
 * is exactly the "a layer order that would cascade" failure that function's `@throws` exists to
 * catch. `parseLayerStack` already repairs a well-formed but PARTIAL `layers=` token; this handles
 * anything shorter of that, including a caller that bypasses the URL layer entirely. Any group
 * `entries` omits is inserted at its own default relative position (review round 2 fix — this used
 * to bare-APPEND every missing group at the array's end regardless of where it belongs, which
 * `docs/map.md` incorrectly already claimed was "its default position"; now it actually is, via
 * the SAME {@link insertMissingAtDefaultPosition} algorithm `parseLayerStack` uses). Also enforces
 * the data-group order ({@link enforceDataOrder}) — the round-2 re-check's OTHER finding, so a
 * hand-built `layerStack` bypassing `parseLayerStack` entirely gets the same guarantee. A complete,
 * correctly-ordered stack round-trips unchanged (same array reference, even).
 */
export function normalizeLayerStack(
  entries: readonly LayerStackEntry[],
): readonly LayerStackEntry[] {
  const present = new Set(entries.map((e) => e.id));
  const missing = DEFAULT_LAYER_STACK.filter((id) => !present.has(id));
  const filled = missing.length === 0 ? entries : insertMissingAtDefaultPosition([...entries]);
  return enforceDataOrder(filled);
}

/** the stack a view draws: the URL's deviation (`sel.layers`) or the shown layer's default. */
export function resolveLayerStack(
  fromUrl: readonly LayerStackEntry[] | undefined,
  labelsAboveData = false,
): readonly LayerStackEntry[] {
  return fromUrl ?? defaultLayerStackEntries(labelsAboveData);
}

/** what the URL keeps after a change in the panel: nothing when `next` is the shown layer's default, else `next`
 * (so labels moved back UNDER the hexagons are a deviation on the h3 layer and are written to `layers=`). */
export function layerStackForUrl(
  next: readonly LayerStackEntry[],
  labelsAboveData = false,
): readonly LayerStackEntry[] | undefined {
  return isDefaultLayerStack(next, labelsAboveData) ? undefined : next;
}

/** true iff `entries` is draw-order-and-value identical to `defaultLayerStackEntries()` — the
 * "is this a default?" comparison `state/codec.ts#formatSel` needs (mirrors every other field's own
 * `!== DEFAULT_SEL.x` check) and what "Reset layers" restores. */
export function isDefaultLayerStack(
  entries: readonly LayerStackEntry[],
  labelsAboveData = false,
): boolean {
  const def = defaultLayerStackEntries(labelsAboveData);
  return (
    entries.length === def.length &&
    entries.every(
      (e, i) => e.id === def[i].id && e.visible === def[i].visible && e.opacity === def[i].opacity,
    )
  );
}

// --- classifying a merged CARTO layer into one of the five basemap roles -----------------------

/** the slice of a (post-`mergeCartoStyle` prefixed) layer this needs to classify it — deliberately
 * NOT the real `LayerSpecification` union, so this stays a plain function `tests/map/layerStack.test.ts`
 * can call with a two-field object, no `maplibre-gl` import needed. */
export interface ClassifiableLayer {
  id: string;
  type: string;
}

const BOUNDARY_RE = /boundary/i;
const ROADS_RE = /road|street|bridge|tunnel|building|railway|rail|aeroway|path|ferry/i;
const BATHYMETRY_RE = /bathy|hillshade|relief|contour|depth/i;

/**
 * Which of the five basemap roles a real CARTO layer belongs in — a TOTAL function (never throws,
 * never returns "none of these"): every layer this app has ever merged from CARTO's dark-matter/
 * positron style.json lands in exactly one bucket, which is the property
 * `tests/map/layerStack.test.ts` asserts over a representative sample of CARTO's real
 * (openmaptiles-schema) layer ids covering every bucket, plus an arbitrary unknown id (falls to
 * `basemap-land`, the "everything else" bucket — water/landuse/landcover/park/background, same as
 * today's undifferentiated "basemap" role).
 *
 * Order matters: a symbol layer is ALWAYS a label (CARTO's road-shield and POI-icon symbol layers
 * carry text too, and text is exactly the thing a viewer wants to promote above a semi-transparent
 * raster — Ben's example), checked before the id-keyword rules so a symbol layer named e.g.
 * "road_major_label" is not miscaught by the roads pattern first.
 */
export function classifyBasemapLayer(layer: ClassifiableLayer): BasemapGroupId {
  if (layer.type === "symbol") return "basemap-labels";
  if (BOUNDARY_RE.test(layer.id)) return "basemap-boundaries";
  if (ROADS_RE.test(layer.id)) return "basemap-roads";
  if (BATHYMETRY_RE.test(layer.id)) return "basemap-bathymetry";
  return "basemap-land";
}

// --- applying a group's visible/opacity onto one composed layer ---------------------------------

/** the paint propert(y/ies) each MapLibre layer TYPE uses for "how opaque" — which key(s)
 * `applyLayerGroupStyling` below passes through {@link scaleOpacity} (B1 fix, review round 1: it
 * SCALES whatever the layer already had, never replaces it outright — CARTO's own paint can be a
 * zoom-dependent `interpolate`/`step` expression, and `scaleOpacity` folds a flat opacity into
 * every shape that appears in practice rather than discarding it) whenever a group's opacity is
 * not the default `1`. A `symbol` layer may carry an icon, text, or both — both keys are set;
 * MapLibre ignores a paint property a layer's `layout` never uses (e.g. `icon-opacity` on a
 * text-only symbol layer costs nothing). */
const OPACITY_PAINT_KEYS: Record<string, readonly string[]> = {
  background: ["background-opacity"],
  raster: ["raster-opacity"],
  fill: ["fill-opacity"],
  line: ["line-opacity"],
  circle: ["circle-opacity"],
  symbol: ["icon-opacity", "text-opacity"],
};

/** `layout`/`paint` are typed `unknown` here, deliberately looser than `Record<string, unknown>`:
 * MapLibre's real per-layer-type `LayerSpecification.layout`/`.paint` interfaces (no index
 * signature) are NOT assignable to `Record<string, unknown>` in TypeScript ("index signature is
 * missing"), so a stricter field type here would reject every real caller (`style.ts` passes a real
 * `LayerSpecification`). `unknown` accepts anything on the way IN; the function's own body narrows
 * with a cast before spreading, and the generic `<L extends StyleLikeLayer>` preserves the caller's
 * EXACT concrete type on the way OUT (so `style.ts` gets back the same `LayerSpecification` variant
 * it passed in, not this loose shape). */
export interface StyleLikeLayer {
  type: string;
  layout?: unknown;
  paint?: unknown;
}

/** a legacy MapLibre/Mapbox "stops" style FUNCTION: `{stops: [[zoom, value], ...], base?}`. */
interface StopsFunction {
  stops: Array<[number, unknown]>;
  [key: string]: unknown;
}

function isStopsFunction(v: unknown): v is StopsFunction {
  return (
    !!v && typeof v === "object" && !Array.isArray(v) && Array.isArray((v as StopsFunction).stops)
  );
}

function isExpression(v: unknown): v is [string, ...unknown[]] {
  return Array.isArray(v) && v.length > 0 && typeof v[0] === "string";
}

/**
 * Multiplies an existing opacity-like paint value by `k` — **B1 fix (Opus 5.5 review)**: the
 * group's opacity slider SCALES whatever the layer already had, it never REPLACES it. Before this
 * fix, dimming "Program Areas" to k painted every Program Area a near-black `QUERY_FILL_COLOR` at
 * opacity k (every zone unit carries an invisible query fill at `fill-opacity: 0`, B3 0.10.26 —
 * replacing 0 with k makes it visible); the score raster read 0.6 at 100% opacity but 0.95 (its
 * OWN default) at a 95%-opacity slider, non-monotonic; the selection ring's per-cell `["get","opacity"]` expression
 * (places/cellSquares.ts) was overwritten outright; every CARTO zoom-`interpolate` opacity was
 * flattened to a constant. `k=1` is a pure no-op: returns `existing` UNCHANGED (not even a
 * same-value copy), so `applyLayerGroupStyling`'s own "opacity 1 never touches paint" guarantee
 * survives calling this directly too.
 *
 * - `existing === undefined` -> `k` (a paint property with no entry defaults to MapLibre's own 1,
 *   so "no existing opacity key" scales to exactly `k`).
 * - a plain `number` -> `existing * k`.
 * - a `{stops: [[zoom, value], ...]}` legacy style FUNCTION -> every stop's value ×k (recursively,
 *   so a stop value that is itself an expression is still handled), `base`/other keys kept as-is.
 * - a zoom `interpolate`/`step` EXPRESSION -> every OUTPUT value ×k, the stops/input untouched.
 * - anything else (`["get", ...]`, `["case", ...]`, `["match", ...]`, …) -> wrapped as
 *   `["*", existing, k]`, MapLibre's own runtime multiplication — never guessed apart.
 */
export function scaleOpacity(existing: unknown, k: number): unknown {
  if (k === 1) return existing;
  if (existing === undefined) return k;
  if (typeof existing === "number") return existing * k;
  if (isStopsFunction(existing)) {
    return {
      ...existing,
      stops: existing.stops.map(
        ([zoom, value]) => [zoom, scaleOpacity(value, k)] as [number, unknown],
      ),
    };
  }
  if (isExpression(existing)) {
    const [op, ...args] = existing;
    if (op === "interpolate" && args.length >= 2) {
      // ["interpolate", interpolation, input, stop1, output1, stop2, output2, ...]
      const [interpolation, input, ...pairs] = args;
      const scaledPairs: unknown[] = [];
      for (let i = 0; i < pairs.length; i += 2) {
        scaledPairs.push(pairs[i], scaleOpacity(pairs[i + 1], k));
      }
      return ["interpolate", interpolation, input, ...scaledPairs];
    }
    if (op === "step" && args.length >= 1) {
      // ["step", input, output0, stop1, output1, stop2, output2, ...]
      const [input, output0, ...pairs] = args;
      const scaledPairs: unknown[] = [scaleOpacity(output0, k)];
      for (let i = 0; i < pairs.length; i += 2) {
        scaledPairs.push(pairs[i], scaleOpacity(pairs[i + 1], k));
      }
      return ["step", input, ...scaledPairs];
    }
    return ["*", existing, k];
  }
  // an unrecognized shape (should not happen for a real opacity paint value) -- wrap defensively,
  // the same fallback every other expression case uses, rather than silently dropping the scale.
  return ["*", existing, k];
}

/**
 * Applies one stack entry's `visible`/`opacity` onto one already-built layer — never by removing it
 * or by calling `setLayoutProperty` after the fact (CLAUDE.md: "one composed style"; the SAME
 * technique `layers/zones.ts#zoneUnitsWithOutline` already uses for `out=`'s line visibility). Pure:
 * returns a new object, never mutates `layer`.
 *
 * `entry.visible === false` sets `layout.visibility: "none"` regardless of type (every MapLibre
 * layer type honours it). `entry.opacity !== 1` SCALES (`scaleOpacity`, B1 fix — never replaces)
 * that type's opacity paint key(s) — a type this table does not name (there is none among what this
 * app composes today) is left untouched rather than throwing: an opacity slider that silently does
 * nothing for a layer type nobody has added yet is a smaller failure than a group row that crashes
 * the map.
 */
export function applyLayerGroupStyling<L extends StyleLikeLayer>(
  layer: L,
  entry: Pick<LayerStackEntry, "visible" | "opacity">,
): L {
  let out: StyleLikeLayer = layer;
  if (!entry.visible) {
    out = {
      ...out,
      layout: { ...(out.layout as Record<string, unknown> | undefined), visibility: "none" },
    };
  }
  if (entry.opacity !== 1) {
    const keys = OPACITY_PAINT_KEYS[out.type];
    if (keys && keys.length > 0) {
      const paint: Record<string, unknown> = {
        ...(out.paint as Record<string, unknown> | undefined),
      };
      for (const k of keys) paint[k] = scaleOpacity(paint[k], entry.opacity);
      out = { ...out, paint };
    }
  }
  return out as L;
}

// --- URL codec: `layers=` -------------------------------------------------------------------------
//
// Grammar (documented again, verbatim, in `docs/map.md`):
//   layers=<id>[:h][:oNN],<id>[:h][:oNN],...
//   order = draw order, bottom to top; a KNOWN group missing from the token is appended at its
//   default relative position (forward-compat: a release that adds a group later never orphans an
//   old link); an unknown id is ignored; `:h` = hidden (visible=false); `:oNN` = opacity NN percent,
//   01-99 (100/opacity 1 is the default and is never written); omitted key = the default stack.

const OPACITY_TOKEN_RE = /^o([0-9]{2})$/;

function parseOneToken(token: string): { id: string; visible: boolean; opacity: number } | null {
  const parts = token.split(":");
  const id = parts[0];
  if (!id) return null;
  let visible = true;
  let opacity = 1;
  for (const flag of parts.slice(1)) {
    if (flag === "h") {
      visible = false;
      continue;
    }
    const m = OPACITY_TOKEN_RE.exec(flag);
    if (m) {
      const pct = Number(m[1]);
      if (pct >= 1 && pct <= 99) opacity = pct / 100;
    }
    // an unrecognized flag is ignored, never thrown (codec.ts's "never throws" convention).
  }
  return { id, visible, opacity };
}

/**
 * `layers=` -> `LayerStackEntry[]`, or `null` (the default stack) for an absent/empty/fully-default
 * value. Never throws: an unknown group id is dropped, and a garbage flag is ignored on that one
 * entry rather than failing the whole parse.
 *
 * **M2 fix (Opus 5.5 review)**: a KNOWN group missing from the token is inserted right after the
 * NEAREST EARLIER `DEFAULT_LAYER_STACK` id that IS present in the token — never appended at the
 * array's end (the TOP of the stack), which used to bury a partial token's own data under an opaque
 * land fill: `?layers=data-raster:o50` named only the raster, and every OTHER group (including
 * every basemap one) landed ABOVE it, making the raster invisible. Walking `DEFAULT_LAYER_STACK` in
 * order and inserting each missing id right after whichever of its own default PREDECESSORS already
 * landed in `out` reconstructs the token's intended position for it — a link naming only one group
 * still gets every other group in ITS OWN default relative position, forward-compatible with a
 * future group the same way (an id later than everything named still lands at the default's own
 * tail, exactly as before).
 */
export function parseLayerStack(
  v: string | null,
  opts: { keepDefault?: boolean } = {},
): LayerStackEntry[] | null {
  if (v === null || v.trim() === "") return null;
  const seen = new Set<LayerGroupId>();
  const out: LayerStackEntry[] = [];
  for (const token of v.split(",")) {
    const parsed = parseOneToken(token.trim());
    if (!parsed || !isLayerGroupId(parsed.id) || seen.has(parsed.id)) continue;
    seen.add(parsed.id);
    out.push({ id: parsed.id, visible: parsed.visible, opacity: parsed.opacity });
  }
  insertMissingAtDefaultPosition(out);
  // review round 2: a token can name every group explicitly, in an order that violates
  // data-raster < data-zones < data-places (`moveLayerStackEntry`'s own incremental rejection
  // never sees a URL-supplied token at all) -- enforce it here too, the same guarantee
  // `normalizeLayerStack` gives a hand-built `layerStack` that bypasses this parser entirely.
  const ordered = [...enforceDataOrder(out)];
  if (ordered.length === 0) return null;
  // `keepDefault` (the URL codec): a token that names at least one group and lands on the stock stack is kept, since
  // on the h3 layer the stock stack (labels under the data) is the DEVIATION from that layer's default
  // ({@link LABELS_ABOVE_DATA_STACK}) and must survive a reload; the default is `null`, as every other caller expects.
  if (isDefaultLayerStack(ordered)) return opts.keepDefault && seen.size > 0 ? ordered : null;
  return ordered;
}

function formatOneToken(e: LayerStackEntry): string {
  const flags: string[] = [];
  if (!e.visible) flags.push("h");
  if (e.opacity !== 1) {
    const pct = Math.min(99, Math.max(1, Math.round(e.opacity * 100)));
    flags.push(`o${String(pct).padStart(2, "0")}`);
  }
  return flags.length > 0 ? `${e.id}:${flags.join(":")}` : e.id;
}

/** `LayerStackEntry[]` -> `layers=`'s value, or `null` (omit the key) when `entries` is `null`/
 * `undefined`/exactly the default stack — the same "write only a deviation" rule every other `Sel`
 * field follows (`state/codec.ts#formatSel`). */
export function formatLayerStack(
  entries: readonly LayerStackEntry[] | null | undefined,
  opts: { keepDefault?: boolean } = {},
): string | null {
  if (!entries || entries.length === 0) return null;
  if (isDefaultLayerStack(entries) && !opts.keepDefault) return null;
  return entries.map(formatOneToken).join(",");
}

// --- reordering (the panel's ▲▼ / drag) -----------------------------------------------------------

/** the three DATA groups' own fixed relative order — see `moveLayerStackEntry`'s header (M7). */
const DATA_RELATIVE_ORDER: readonly DataGroupId[] = ["data-raster", "data-zones", "data-places"];

/** move the entry at `from` to `to` (clamped), returning a NEW array — the panel's ▲/▼ buttons and
 * drag-reorder both funnel through this one function, so there is exactly one reorder rule to test.
 *
 * **M7 fix (Opus 5.5 review)**: the three DATA groups keep a FIXED relative order
 * (`data-raster < data-zones < data-places`) no matter what `from`/`to` asks for — before this fix,
 * "Selection" (`data-places`) could end up BELOW a basemap group (e.g. "Land & water"), breaking
 * the exact property R3 exists to guarantee: "the selection ring is never hidden by the layer it
 * selects" (`style.ts#LAYER_ORDER`'s own header). `data-places` is additionally PINNED: it can
 * never be `from` (an attempt to move IT returns `entries` unchanged) and nothing else can move to
 * or past its own position (so it stays the topmost entry structurally, not merely by convention).
 * Basemap groups, and `data-raster`/`data-zones` relative to basemap groups, still move freely —
 * only the DATA-vs-DATA relative order is fixed. An attempted move that would invert
 * `data-raster`/`data-zones` anyway (both still strictly below `data-places`) is rejected outright
 * (returns `entries` unchanged) rather than silently clamped to some other position — a caller
 * (the panel) is expected to disable the button that would produce it in the first place.
 */
export function moveLayerStackEntry(
  entries: readonly LayerStackEntry[],
  from: number,
  to: number,
): LayerStackEntry[] {
  if (from < 0 || from >= entries.length) return [...entries];
  if (entries[from].id === "data-places") return [...entries]; // pinned — never moves
  const placesIdx = entries.findIndex((e) => e.id === "data-places");
  // never move AT OR PAST data-places' own position -- it stays the topmost entry.
  const maxTo = placesIdx === -1 ? entries.length - 1 : placesIdx - 1;
  const clampedTo = Math.min(Math.max(to, 0), Math.min(entries.length - 1, maxTo));
  const out = [...entries];
  const [moved] = out.splice(from, 1);
  out.splice(clampedTo, 0, moved);
  // reject a move that inverts data-raster/data-zones' own relative order (the one pair the
  // data-places pin above does not already rule out).
  const wantOrder = DATA_RELATIVE_ORDER.filter((id) => out.some((e) => e.id === id));
  const gotOrder = out
    .map((e) => e.id)
    .filter((id): id is DataGroupId => (DATA_RELATIVE_ORDER as readonly string[]).includes(id));
  if (gotOrder.join(",") !== wantOrder.join(",")) return [...entries];
  return out;
}

/**
 * review round 2 (re-check of M7): the panel's ▲/▼ buttons used to disable ONLY at the array
 * boundary (`arrIndex === 0`/`stack.length - 1`) — blind to the pin/fixed-order rules above, so
 * "Selection"'s own DOWN button (never at the boundary; it sits at the TOP) stayed enabled and a
 * click through it fired a phantom `aria-live` "moved to position N" announcement for a move
 * `moveLayerStackEntry` silently rejected. `LayersPanel.svelte` calls this instead of re-deriving
 * the boundary itself, so there is exactly one definition of "would this move do anything."
 */
export function canMoveLayerStackEntry(
  entries: readonly LayerStackEntry[],
  from: number,
  to: number,
): boolean {
  const result = moveLayerStackEntry(entries, from, to);
  if (result.length !== entries.length) return true;
  return result.some((e, i) => e.id !== entries[i].id);
}

/**
 * fix round (Opus 5.5 eyes-on review of main, D2): the panel's ▲/▼ used to move an entry exactly
 * ONE step in the underlying array via {@link moveLayerStackEntry} -- which may be a HIDDEN
 * basemap row (`LAYER_GROUP_IN_PANEL`'s own header). "Place labels ↓" swapped with the hidden
 * `basemap-roads` row: the visible panel order never changed, yet the button stayed enabled
 * (`canMoveLayerStackEntry` only checks the underlying array's own boundary/pin rules, blind to
 * visibility) -- a click that visibly does nothing.
 *
 * This is the panel's REAL move: find the nearest entry in the requested direction that IS a
 * panel row (`inPanel`), hopping over any number of hidden entries to get there, and swap with
 * THAT via {@link moveLayerStackEntry} (still the one function enforcing the data-group
 * pin/fixed-order rules -- unchanged). Passing the neighbour's OWN pre-removal index as `to`
 * (never `from ± 1`) is what makes the hop work: `moveLayerStackEntry`'s splice-then-insert
 * lands `from` immediately adjacent to that neighbour, and every hidden entry that sat between
 * them keeps its own relative position, undisturbed. A row with no visible neighbour in that
 * direction (Place labels' own "down" today -- every basemap row below it is hidden) returns
 * `entries` unchanged: a real no-op, not a swap with something invisible -- the caller is
 * expected to disable the button in that case ({@link canMoveLayerStackEntryVisible}).
 */
export function moveLayerStackEntryVisible(
  entries: readonly LayerStackEntry[],
  id: LayerGroupId,
  dir: "up" | "down",
  inPanel: Readonly<Record<LayerGroupId, boolean>>,
): LayerStackEntry[] {
  const from = entries.findIndex((e) => e.id === id);
  if (from === -1) return [...entries];
  const step = dir === "up" ? 1 : -1;
  let neighborIdx = -1;
  for (let i = from + step; i >= 0 && i < entries.length; i += step) {
    if (inPanel[entries[i].id]) {
      neighborIdx = i;
      break;
    }
  }
  if (neighborIdx === -1) return [...entries];
  return moveLayerStackEntry(entries, from, neighborIdx);
}

/** the visible-aware sibling of {@link canMoveLayerStackEntry} -- see
 * {@link moveLayerStackEntryVisible}'s own header for why this is the check the panel's ▲/▼
 * `disabled` attribute must use instead. */
export function canMoveLayerStackEntryVisible(
  entries: readonly LayerStackEntry[],
  id: LayerGroupId,
  dir: "up" | "down",
  inPanel: Readonly<Record<LayerGroupId, boolean>>,
): boolean {
  const result = moveLayerStackEntryVisible(entries, id, dir, inPanel);
  if (result.length !== entries.length) return true;
  return result.some((e, i) => e.id !== entries[i].id);
}
