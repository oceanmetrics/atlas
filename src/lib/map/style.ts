// ONE composed style, applied with ONE `setStyle(style, { diff: true })` (CLAUDE.md; plan lesson 3
// from `atlas-refs/"calcofi explore review.md"` §5). Nothing in this app ever calls `addLayer()`
// after load: a layer added that way silently vanishes across the next style swap, and the Shiny
// app's own `before_id` chain is exactly how v1 ended up as "a map with nothing but labels"
// (atlas-4 §2.4: "MapLibre rejects an add whose `before_id` doesn't exist and the failure
// cascades").
//
// The fix is a DECLARED order. Every layer this module builds is tagged with a `LayerRole`, and the
// final array is those roles' fixed order, filtered to the layers that actually exist. A missing
// layer therefore removes exactly itself — there is no `before` id left to dangle, so nothing can
// cascade. `orderLayers()` throws on a role outside the table, so a new layer kind cannot be added
// without deciding where it sits (tests/map/style.test.ts seeds exactly that fault).
import {
  basemapForTheme,
  getCachedBasemapStyle,
  GLYPHS_URL,
  MAP_BACKGROUND_BY_THEME,
  type CartoStyleLike,
} from "./layers/basemap";
import { SELECTION_COLOR } from "./colors";
import { rasterLayer, rasterSource } from "./layers/raster";
import { rangeLayer, rangeSource } from "./layers/ranges";
import {
  HEX_SOURCE_ID,
  hexFillLayer,
  hexSelectedLayer,
  hexSource,
  type HexLayerSpec,
} from "./layers/hex";
import {
  GAZETTEER_SOURCE_ID,
  gazetteerFillLayer,
  gazetteerLineLayer,
  gazetteerSource,
} from "./layers/gazetteer";
import { HIGHLIGHT_SOURCE_ID, highlightLayers, highlightSource } from "./layers/highlight";
import { overlayLayers, overlaySource, overlaySourceId } from "./layers/overlays";
// R3 layer stack model (round-2 plan §5 U4, docs/usability.md §7 R3): the user-reorderable/
// dimmable GROUPS a merged CARTO layer or a data layer belongs to. `layerStack.ts` is the pure
// model (classify/apply/codec); this file only CONSUMES it — composeStyle still returns ONE style
// object, applied with ONE `setStyle(diff:true)` (this file's own header).
import {
  applyLayerGroupStyling,
  classifyBasemapLayer,
  DEFAULT_LAYER_STACK,
  defaultLayerStackEntries,
  normalizeLayerStack,
  type LayerGroupId,
  type LayerStackEntry,
} from "./layerStack";
import type {
  BasemapSpec,
  GazetteerLayerSpec,
  HighlightSpec,
  PlaceOverlaySpec,
  LayerSpecification,
  Projection,
  RangeLayerSpec,
  RasterLayerSpec,
  ResolvedTheme,
  SelectionSpec,
  SourceSpecification,
  StyleSpecification,
} from "./types";

/** every merged CARTO source/layer id gets this prefix — CARTO's own style.json literally has a
 * layer id `"background"` (a `type: "background"` layer painting land colour), which collides with
 * this module's OWN synthetic `background` role/id (the theme's flat fallback colour, used when the
 * CARTO fetch fails). Prefixing avoids that collision unconditionally, and is also how
 * `composeStyle`'s own basemap loop below strips it back off before classifying a CARTO layer into
 * one of the five basemap sub-roles (`classifyBasemapLayer`). */
export const BASEMAP_LAYER_PREFIX = "basemap-";

/**
 * Merges a fetched (or injected-for-a-test) CARTO GL style into the `sources` map `composeStyle()`
 * is building — namespacing every source id with {@link BASEMAP_LAYER_PREFIX} (looping on a
 * collision, however unlikely) and rewriting each returned layer's `id`/`source` to match, so this
 * can never collide with an app id or with another already-merged basemap layer. Pure and exported
 * so `tests/map/style.test.ts` can assert the rename directly, without a network fetch.
 */
export function mergeCartoStyle(
  carto: CartoStyleLike,
  sources: Record<string, SourceSpecification>,
): { layers: LayerSpecification[]; sprite?: string; glyphs?: string } {
  const rename = new Map<string, string>();
  for (const [srcId, srcSpec] of Object.entries(carto.sources ?? {})) {
    let finalId = `${BASEMAP_LAYER_PREFIX}${srcId}`;
    while (finalId in sources) finalId = `${finalId}-x`;
    rename.set(srcId, finalId);
    sources[finalId] = srcSpec as SourceSpecification;
  }
  const layers = (carto.layers ?? []).map((raw) => {
    const layer = { ...raw } as Record<string, unknown> & { id: string; source?: string };
    layer.id = `${BASEMAP_LAYER_PREFIX}${layer.id}`;
    if (typeof layer.source === "string" && rename.has(layer.source)) {
      layer.source = rename.get(layer.source);
    }
    return layer as unknown as LayerSpecification;
  });
  return { layers: anglicizeSymbolLabels(layers), sprite: carto.sprite, glyphs: carto.glyphs };
}

/** UI-21 (round-3 review, Ben's ask): CARTO's stock style.json labels every place in the tile's own
 * locale field (a bare `["get","name"]`, or the legacy Mapbox token string `"{name}"` — the tile's
 * local-language spelling), and this app has no locale switcher, so every viewer should see English
 * names. Rewrites ONLY a symbol layer's plain "name" `text-field` to prefer `name_en`, falling back
 * to the local `name` when a tile has no English variant:
 * `["coalesce", ["get","name_en"], ["get","name"]]` — never touches a DIFFERENT field
 * (`water_name`, an already-`name:en`-aware or otherwise-coalesced expression, ...), so CARTO's own
 * water-body labels are left exactly as published. Pure, exported so `tests/map/style.test.ts` can
 * assert it directly without a network fetch. */
export function anglicizeSymbolLabels(layers: LayerSpecification[]): LayerSpecification[] {
  return layers.map((raw) => {
    const layer = raw as unknown as Record<string, unknown> & {
      type?: string;
      layout?: Record<string, unknown>;
    };
    if (layer.type !== "symbol" || !layer.layout) return raw;
    if (!isPlainNameField(layer.layout["text-field"])) return raw;
    return {
      ...layer,
      layout: {
        ...layer.layout,
        "text-field": ["coalesce", ["get", "name_en"], ["get", "name"]],
      },
    } as unknown as LayerSpecification;
  });
}

/** true only for a `text-field` that names the plain `"name"` field and nothing else — a bare GL
 * expression `["get","name"]` or the legacy Mapbox token string `"{name}"` — never a field this
 * app must leave alone (`water_name`, `name:en`, an already-coalesced/localized expression). */
function isPlainNameField(field: unknown): boolean {
  if (field === "{name}") return true;
  return Array.isArray(field) && field[0] === "get" && field[1] === "name" && field.length === 2;
}

/** does the fetched CARTO style itself carry a symbol layer (its own place/road labels)?
 * `composeStyle()` fetches glyphs when it does, since CARTO's own style needs its own font range the
 * moment it draws at all. */
export function cartoStyleHasSymbolLayer(carto: CartoStyleLike): boolean {
  return (carto.layers ?? []).some((l) => l.type === "symbol");
}

/**
 * The declared paint order, bottom to top. Read it as the answer to "what is on top of what":
 * the basemap under the score raster, the raster under the zone fills, every outline above every
 * fill, labels above outlines, and the selection above everything so a selection ring is never
 * hidden by the layer it selects.
 *
 * R3 (round-2 plan §5 U4): the single "basemap" bucket used to hold EVERY merged CARTO layer, all of
 * it under the raster — so CARTO's own place/road labels painted invisibly, under an opaque score
 * raster, and there was no way to change that. It is now five sub-roles
 * (`layerStack.ts#BasemapGroupId`, `classifyBasemapLayer`), each a `LayerGroupId` a user can move —
 * `basemap-labels` above `raster` is the new capability (Ben's example: "names above a
 * semi-transparent raster"). This constant is still the DEFAULT flat order (`rankForStack()` below,
 * called with no argument) — the five sub-roles sit exactly where the old "basemap" bucket sat, so
 * every existing composeStyle call (no `layerStack` input) renders byte-identical output.
 */
export const LAYER_ORDER = [
  "background",
  "basemap-land",
  "basemap-bathymetry",
  "basemap-boundaries",
  "basemap-roads",
  "basemap-labels",
  "hex",
  "hex-selected",
  "raster",
  "range",
  "overlay",
  // WP4: the gazetteer collections toggled in the Layers panel's "Place layers" group (fill under line
  // under circle), above the data and under the picker + the selection highlight.
  "place-overlay-fill",
  "place-overlay-line",
  "place-overlay-circle",
  // gazetteer-places: the "Pick from gazetteer" tile polygons sit just under the selection
  // highlight, in the same `data-places` group (the Layers panel's "Selection" row), so the picked
  // place's pink outline always draws over them.
  "gazetteer-fill",
  "gazetteer-line",
  "selection-fill",
  "selection-line",
  // the Collections lens' clicked raster cell (its square, then the ring at the point): above everything
  "highlight-line",
  "highlight-ring",
] as const;

export type LayerRole = (typeof LAYER_ORDER)[number];

export interface RoledLayer {
  role: LayerRole;
  layer: LayerSpecification;
}

/** which stack GROUP each fine `LayerRole` belongs to — `undefined` (background only) means "never
 * part of the user-facing stack; always bottom." `hex`/`raster`/`range`/`overlay` fold into ONE group
 * (`data-raster`, "the lens's data"), matching `layerStack.ts`'s own doc comment on why `data-places` folds "places" and "selection" together. */
const ROLE_GROUP: Partial<Record<LayerRole, LayerGroupId>> = {
  "basemap-land": "basemap-land",
  "basemap-bathymetry": "basemap-bathymetry",
  "basemap-boundaries": "basemap-boundaries",
  "basemap-roads": "basemap-roads",
  "basemap-labels": "basemap-labels",
  raster: "data-raster",
  range: "data-raster",
  overlay: "data-raster",
  hex: "data-raster",
  "hex-selected": "data-raster",
  "place-overlay-fill": "data-overlays",
  "place-overlay-line": "data-overlays",
  "place-overlay-circle": "data-overlays",
  "gazetteer-fill": "data-places",
  "gazetteer-line": "data-places",
  "selection-fill": "data-places",
  "selection-line": "data-places",
  "highlight-line": "data-places",
  "highlight-ring": "data-places",
};

/** each group's constituent fine roles, in their OWN fixed sub-order (never user-reorderable —
 * moving the whole `data-zones` group above `data-raster` is a stack decision; whether a zone's
 * FILL sits under its own LINE is not). */
const GROUP_ROLES: Record<LayerGroupId, readonly LayerRole[]> = {
  "basemap-land": ["basemap-land"],
  "basemap-bathymetry": ["basemap-bathymetry"],
  "basemap-boundaries": ["basemap-boundaries"],
  "basemap-roads": ["basemap-roads"],
  "basemap-labels": ["basemap-labels"],
  "data-raster": ["hex", "hex-selected", "raster", "range", "overlay"],
  "data-overlays": ["place-overlay-fill", "place-overlay-line", "place-overlay-circle"],
  "data-places": [
    "gazetteer-fill",
    "gazetteer-line",
    "selection-fill",
    "selection-line",
    "highlight-line",
    "highlight-ring",
  ],
};

/**
 * Expands a group-level stack order into the `LayerRole` -> rank map `orderLayers()` sorts against.
 * `"background"` is always rank 0, unconditionally (it is not part of the user-facing stack: the
 * theme's flat fallback colour must always be the bottom of everything, stack or no stack).
 *
 * **M1 fix (Opus 5.5 review)**: a contiguous RUN of adjacent basemap groups shares ONE rank, not
 * one rank per group. Before this fix, every CARTO layer classified as "basemap-land" sorted
 * before every layer classified "basemap-boundaries" — full stop — even though CARTO's OWN
 * dark-matter/positron style.json interleaves them (`water`/`water_shadow` UNDER
 * `boundary_county`/`boundary_state`, country boundaries under roads/buildings; verified live
 * against both real styles). A stable sort by (rank, ORIGINAL CARTO INDEX) inside one shared-rank
 * run reproduces CARTO's own order regardless of which of the 5 sub-roles each layer classified
 * into — `composeStyle()`'s merge loop pushes CARTO layers in their own style.json order, so
 * "same rank" IS "sort by original index only" for every layer in that run.
 *
 * This has a documented, DELIBERATE consequence: **basemap rows only move relative to a DATA
 * row.** Moving one basemap group past another basemap group that stays adjacent to it (e.g.
 * "Roads" above "Land & water," both still under "Data") is a no-op — they still share one run and
 * still resolve to CARTO's own order. A basemap group only visibly moves when a DATA row is
 * interposed on one side or the other of it, splitting the run (Ben's own example — "Place labels"
 * above "Data" — does exactly this: it separates "Place labels" from the other four basemap groups,
 * so it gets its OWN rank instead of sharing theirs).
 */
export function rankForStack(
  stack: readonly LayerGroupId[] = DEFAULT_LAYER_STACK,
): Map<LayerRole, number> {
  const rank = new Map<LayerRole, number>();
  rank.set("background", 0);
  let next = 1;
  let i = 0;
  while (i < stack.length) {
    if (stack[i].startsWith("basemap-")) {
      const runRank = next++;
      while (i < stack.length && stack[i].startsWith("basemap-")) {
        for (const role of GROUP_ROLES[stack[i]] ?? []) rank.set(role, runRank);
        i++;
      }
    } else {
      for (const role of GROUP_ROLES[stack[i]] ?? []) rank.set(role, next++);
      i++;
    }
  }
  return rank;
}

/** the selection highlight's colour (atlas-4 §6.6/§7.1-7.3), from the module's one colour file. */
export { SELECTION_COLOR };
export const SELECTION_LINE_WIDTH = 4;
export const SELECTION_SOURCE_ID = "selection";

export interface ComposeStyleInput {
  theme: ResolvedTheme;
  /** defaults to `basemapForTheme(theme)`; pass `null` for no basemap at all (print/report). */
  basemap?: BasemapSpec | null;
  /** `globe` (the shipped default) or `mercator`; travels IN the style, so a projection change is
   * one more `setStyle(diff)` rather than a second imperative API the lenses have to remember. */
  projection?: Projection;
  /** a catalog collection's hex grid, painted by feature state (`layers/hex.ts`). */
  hex?: HexLayerSpec | null;
  /** a species COG surface (atlas-5) or a collection's cloud-optimized GeoTIFF. */
  raster?: RasterLayerSpec | null;
  /** a species PMTiles range/presence fill (atlas-5's ranges branch) — `null` for none. */
  range?: RangeLayerSpec | null;
  /** extra rasters above the main one, e.g. "cells outside Program Areas". */
  overlays?: readonly RasterLayerSpec[];
  selection?: SelectionSpec | null;
  /** the clicked raster position and its cell (Collections lens), above every other layer. */
  highlight?: HighlightSpec | null;
  /** the gazetteer collections toggled on in the "Place layers" group (WP4) -- absent for none. */
  placeOverlays?: readonly PlaceOverlaySpec[];
  /** the gazetteer collection shown for "Pick from gazetteer" -- `null`/absent for none. */
  gazetteer?: GazetteerLayerSpec | null;
  /** override only in a test: the glyph endpoint used when a label layer exists. */
  glyphs?: string;
  /** override only in a test: skips `loadBasemapStyle()`'s network fetch entirely and merges this
   * pre-built CARTO style instead — `basemapForTheme(theme)`'s URL is never touched. */
  basemapStyle?: CartoStyleLike;
  /** R3 (round-2 plan §5 U4): the user's layer stack — order (`.map(e => e.id)`) AND each group's
   * `visible`/`opacity`. `undefined` (every existing caller) is `defaultLayerStackEntries()`, which
   * is a no-op on both counts — draw order unchanged, `applyLayerGroupStyling` never touches a
   * layer's own paint at opacity 1 — so this input is purely additive. */
  layerStack?: readonly LayerStackEntry[];
}

/**
 * Sort tagged layers into `rank` (default: {@link rankForStack} of the default stack), stably
 * within a rank (so two units' outlines keep boot's own order: Program Areas first, then finest
 * first — and so a shared-rank basemap RUN, M1, sorts by original CARTO index).
 *
 * @throws if a layer carries a role `rank` does not name — the seeded fault for "a layer order
 * that would cascade" (originally about the fixed `LAYER_ORDER` table; R3 generalizes it to any
 * rank a `layerStack` input expands to, via {@link rankForStack} — a group id that is not a real
 * `LayerGroupId` expands to nothing, so a layer tagged with the role that WOULD have named it still
 * throws here, never silently vanishing). Silently appending an unknown role would reintroduce
 * exactly the failure this table exists to prevent.
 */
export function orderLayers(
  roled: readonly RoledLayer[],
  rank: ReadonlyMap<LayerRole, number> = rankForStack(),
): LayerSpecification[] {
  for (const { role, layer } of roled) {
    if (!rank.has(role)) {
      throw new Error(
        `map/style: layer "${layer.id}" has role "${role}", which is not in the declared stack ` +
          `order (${[...rank.keys()].join(", ")}) — add it to LAYER_ORDER/layerStack.ts, never ` +
          `append it blindly`,
      );
    }
  }
  return roled
    .map((r, i) => ({ r, i }))
    .sort((a, b) => rank.get(a.r.role)! - rank.get(b.r.role)! || a.i - b.i)
    .map(({ r }) => r.layer);
}

/** atlas-6 Deliverable 2: 0.15 for an ordinary highlight; each feature's own `opacity` property
 * when `cellOpacity` is set (`places/cellSquares.ts` writes `pct / 100` there). */
export const SELECTION_FILL_OPACITY_DEFAULT = 0.15;

function selectionLayers(sel: SelectionSpec): RoledLayer[] {
  const color = sel.color ?? SELECTION_COLOR;
  const fillOpacity = sel.cellOpacity
    ? (["get", "opacity"] as const)
    : SELECTION_FILL_OPACITY_DEFAULT;
  return [
    {
      role: "selection-fill",
      layer: {
        id: "selection-fill",
        type: "fill",
        source: SELECTION_SOURCE_ID,
        filter: ["==", ["geometry-type"], "Polygon"],
        paint: { "fill-color": color, "fill-opacity": fillOpacity as never },
      },
    },
    {
      role: "selection-line",
      layer: {
        id: "selection-line",
        type: "line",
        source: SELECTION_SOURCE_ID,
        paint: { "line-color": color, "line-width": SELECTION_LINE_WIDTH },
      },
    },
  ];
}

/**
 * Compose the whole style: background ⊕ basemap ⊕ raster ⊕ overlays ⊕ selection.
 *
 * This is the ONE entry point a lens uses to change what the map shows. A lens never touches
 * MapLibre: it recomputes its inputs, calls this, and hands the result to {@link applyStyle}.
 *
 * DELIBERATELY SYNCHRONOUS (fix for the CARTO raster basemap's "API KEY REQUIRED" watermark,
 * 2026-09-23): the real basemap is now CARTO's vector GL style.json, a network fetch — but
 * `composeStyle()` never awaits it inline. It reads whatever `layers/basemap.ts#loadBasemapStyle()`
 * has ALREADY cached for the theme (`getCachedBasemapStyle()`, synchronous), falling back to
 * {@link EMPTY_BASEMAP_STYLE} (just the plain background colour) until that resolves. An earlier
 * version made this function `async` and awaited the fetch here; measured regression: on a slow
 * load it pushed a REACTIVE recompose past the map's first `"idle"`, handing MapLibre two
 * back-to-back `setStyle(diff:true)` calls with no queue between them (`styleQueue.ts` only queues
 * while `!map.isStyleLoaded()`) — a real MapLibre-level race, not a bug in the caller
 * (`e2e/species.smoke.spec.ts`'s "switching species twice before the map's first idle" regression
 * test went red ~40% of the time). The caller warms the cache once, ahead of time, and recomposes
 * when it resolves (`Shell.svelte`, `Report.svelte`) — see `getCachedBasemapStyle()`'s own header.
 */
export function composeStyle(input: ComposeStyleInput): StyleSpecification {
  const basemap = input.basemap === undefined ? basemapForTheme(input.theme) : input.basemap;
  const overlays = input.overlays ?? [];

  const sources: Record<string, SourceSpecification> = {};
  const roled: RoledLayer[] = [
    {
      role: "background",
      layer: {
        id: "background",
        type: "background",
        paint: { "background-color": MAP_BACKGROUND_BY_THEME[input.theme] },
      },
    },
  ];

  // merged in whole (sources/sprite/glyphs/layers), FIRST in the "basemap" role slot — never a
  // single raster source/layer any more (CARTO's raster endpoint now requires a key; see
  // layers/basemap.ts's header). `EMPTY_BASEMAP_STYLE` (no sources, no layers) is what an unwarmed
  // or failed fetch resolves to, so the block below is simply a no-op and the synthetic
  // `background` layer above is all that paints — the app never blanks.
  let cartoSprite: string | undefined;
  let cartoGlyphs: string | undefined;
  let cartoHasSymbolLayer = false;
  if (basemap) {
    const carto = input.basemapStyle ?? getCachedBasemapStyle(input.theme);
    const merged = mergeCartoStyle(carto, sources);
    // R3: each CARTO layer classifies into ONE of five basemap sub-roles (land/bathymetry/
    // boundaries/roads/labels) instead of one flat "basemap" bucket — `classifyBasemapLayer` reads
    // the UN-prefixed id (the prefix is app-added namespacing, not part of CARTO's own semantics).
    for (const layer of merged.layers) {
      const unprefixed = layer.id.startsWith(BASEMAP_LAYER_PREFIX)
        ? layer.id.slice(BASEMAP_LAYER_PREFIX.length)
        : layer.id;
      const role = classifyBasemapLayer({ id: unprefixed, type: layer.type });
      roled.push({ role, layer });
    }
    cartoSprite = merged.sprite;
    cartoGlyphs = merged.glyphs;
    cartoHasSymbolLayer = cartoStyleHasSymbolLayer(carto);
  }

  if (input.hex) {
    sources[HEX_SOURCE_ID] = hexSource(input.hex);
    roled.push({ role: "hex", layer: hexFillLayer(input.hex) });
    roled.push({ role: "hex-selected", layer: hexSelectedLayer(input.hex) });
  }
  if (input.raster) {
    sources[input.raster.id] = rasterSource(input.raster);
    roled.push({ role: "raster", layer: rasterLayer(input.raster) });
  }
  if (input.range) {
    sources[input.range.id] = rangeSource(input.range);
    roled.push({ role: "range", layer: rangeLayer(input.range) });
  }
  for (const overlay of overlays) {
    sources[overlay.id] = rasterSource(overlay);
    roled.push({ role: "overlay", layer: rasterLayer(overlay) });
  }

  for (const spec of input.placeOverlays ?? []) {
    sources[overlaySourceId(spec.slug)] = overlaySource(spec);
    roled.push(...overlayLayers(spec));
  }

  if (input.gazetteer) {
    sources[GAZETTEER_SOURCE_ID] = gazetteerSource(input.gazetteer);
    roled.push({ role: "gazetteer-fill", layer: gazetteerFillLayer(input.gazetteer) });
    roled.push({ role: "gazetteer-line", layer: gazetteerLineLayer(input.gazetteer) });
  }

  if (input.selection) {
    sources[SELECTION_SOURCE_ID] = { type: "geojson", data: input.selection.features };
    roled.push(...selectionLayers(input.selection));
  }

  if (input.highlight) {
    sources[HIGHLIGHT_SOURCE_ID] = highlightSource(input.highlight);
    const h = highlightLayers();
    for (const layer of h.line) roled.push({ role: "highlight-line", layer });
    for (const layer of h.ring) roled.push({ role: "highlight-ring", layer });
  }

  // R3: the user's layer stack decides BOTH the final draw order (via `rankForStack`, which
  // `orderLayers` sorts against below) AND each group's visible/opacity (`applyLayerGroupStyling`,
  // applied uniformly to every layer regardless of whether it came from the basemap merge above or
  // from a data spec — one mechanism, not a raster-specific and a zone-specific and a selection-
  // specific one). `defaultLayerStackEntries()` is a no-op on both counts, so an existing caller
  // that never passes `layerStack` sees byte-identical output to before this input existed.
  //
  // m10 (review round 1): `normalizeLayerStack` appends any group a caller's `layerStack` omits
  // entirely (default visible/opacity) — a complete stack (the common case: `parseLayerStack`'s
  // own output, or the default) passes through untouched; only a hand-built, PARTIAL array (a
  // caller bypassing the URL layer) gets repaired here, before `orderLayers` below would otherwise
  // throw on the missing group's roles.
  const stackEntries = normalizeLayerStack(input.layerStack ?? defaultLayerStackEntries());
  const groupById = new Map(stackEntries.map((e) => [e.id, e]));
  const styledRoled: RoledLayer[] = roled.map(({ role, layer }) => {
    const group = ROLE_GROUP[role];
    const entry = group ? groupById.get(group) : undefined;
    if (!entry) return { role, layer };
    return { role, layer: applyLayerGroupStyling(layer, entry) };
  });

  const style: StyleSpecification = {
    version: 8,
    projection: { type: input.projection ?? "globe" },
    sources,
    layers: orderLayers(styledRoled, rankForStack(stackEntries.map((e) => e.id))),
  };
  // CARTO's own icon layers (POI markers, etc.) read this — carried over verbatim from the fetched
  // style; absent when the fetch failed (EMPTY_BASEMAP_STYLE has no sprite).
  if (cartoSprite) style.sprite = cartoSprite;
  // a symbol layer exists whenever CARTO's OWN style contributed one (its place/road labels — true
  // any time the fetch succeeded); an unused `glyphs` key costs nothing, but keeping it conditional
  // makes "a style with no labels at all fetches no font range" (a failed fetch) an assertable
  // property.
  if (cartoHasSymbolLayer) {
    style.glyphs = input.glyphs ?? cartoGlyphs ?? GLYPHS_URL;
  }
  return style;
}

/** the narrow slice of MapLibre's `Map` this module needs — so `applyStyle` is unit-testable with
 * a two-line fake and `style.ts` never imports maplibre-gl at runtime. `getStyle` is OPTIONAL: a
 * fake that omits it (every existing test) gets the old behaviour byte-for-byte — see
 * `preserveDrawLayers`'s own header for why a REAL map needs it. */
export interface StyleTarget {
  setStyle(style: StyleSpecification, options: { diff: boolean }): unknown;
  getStyle?(): StyleSpecification | undefined;
}

/** terra-draw-maplibre-gl-adapter's own default `prefixId` ("td", `draw.ts` never overrides it) --
 * every source/layer id it `addSource`/`addLayer`s directly onto the live map starts with this. */
export const DRAW_LAYER_PREFIX = "td-";

/**
 * 0.10.46 fix (P7 — "drawn places vanish from the map after the second draw"): terra-draw manages
 * its OWN sources/layers on the live map, calling `addSource`/`addLayer` directly (`draw.ts`'s own
 * header: "the one sanctioned exception to 'a lens never touches MapLibre directly'"), on the
 * assumption that this app's own `setStyle(diff:true)` cycle would leave them alone. It does not:
 * `composeStyle()`'s own style object never mentions terra-draw's ids, so MapLibre's diff — which
 * removes anything present in the CURRENT style but absent from the NEW one — silently deleted
 * terra-draw's `td-*` sources/layers on the very first recompose after a draw finished (finishing a
 * shape calls `writePlaces()`, which changes `sel.pl`/`sel.sel`, which is exactly what triggers
 * Shell.svelte's `composeStyle` effect). Terra-draw has no idea: its next internal render — showing
 * the just-finished shape's edit handles, or the next shape's live preview — calls
 * `map.getSource("td-point").setData(...)`, the source is gone, and `.setData` on `undefined`
 * throws (`TypeError: Cannot read properties of undefined (reading 'setData')`, uncaught, inside
 * terra-draw's own vendor chunk) — measured: a SECOND drawn shape after this never got its own
 * edit-mode chrome, and the crash repeats on every subsequent pointer move.
 *
 * The fix: `applyStyle()` reads whatever the map's CURRENT style already has (`getStyle()`) and
 * copies any `td-`-prefixed source/layer that `next` doesn't already carry back into what actually
 * gets applied — so MapLibre's diff sees them as unchanged and never touches them. Preserved layers
 * are APPENDED (terra-draw always adds without a `before` id, so they already paint on top of
 * everything composeStyle declares) — this never reorders anything `orderLayers()` decided.
 */
export function preserveDrawLayers(
  current: StyleSpecification | undefined,
  next: StyleSpecification,
): StyleSpecification {
  const extraSources = Object.entries(current?.sources ?? {}).filter(
    ([id]) => id.startsWith(DRAW_LAYER_PREFIX) && !(id in next.sources),
  );
  const nextLayerIds = new Set(next.layers.map((l) => l.id));
  const extraLayers = (current?.layers ?? []).filter(
    (l) => l.id.startsWith(DRAW_LAYER_PREFIX) && !nextLayerIds.has(l.id),
  );
  if (!extraSources.length && !extraLayers.length) return next;
  return {
    ...next,
    sources: { ...next.sources, ...Object.fromEntries(extraSources) },
    layers: [...next.layers, ...extraLayers],
  };
}

/**
 * Apply a composed style. This is the ONLY `setStyle` in the app, and it does nothing else beyond
 * preserving terra-draw's own live layers (`preserveDrawLayers`, above): no `addLayer`, no
 * `addSource`, no `moveLayer`, no `before` id (CLAUDE.md).
 */
export function applyStyle(map: StyleTarget, style: StyleSpecification): void {
  map.setStyle(preserveDrawLayers(map.getStyle?.(), style), { diff: true });
}
