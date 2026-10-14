// Seeded faults for the map module's three gates (atlas-map). Each is a COMMITTED red fixture: the
// gate's own test asserts that the checker rejects it, so "this check can actually fail" is proved
// on every run rather than argued for in a comment (CLAUDE.md: a check that cannot fail is not a
// check).
//
// These are never imported by src/ — tests/fixtures/** is outside vitest's `include` and outside
// index.html's build graph.
import type { LayerSpecification } from "maplibre-gl";

/**
 * FAULT 1 — a layer order that would cascade.
 *
 * A layer tagged with a role the declared `LAYER_ORDER` does not name. If `orderLayers()` appended
 * it blindly instead of throwing, the layer would land at an arbitrary depth and the next person to
 * add one would reach for a `before` id — which is exactly the `before_id` chain that left v1 as "a
 * map with nothing but labels" (atlas-4 §2.4).
 */
export const UNORDERED_ROLED_LAYER = {
  role: "bathymetry" as never,
  layer: {
    id: "bathymetry",
    type: "line",
    source: "bathy",
    paint: { "line-color": "#ffffff" },
  } as LayerSpecification,
};

/**
 * FAULT 2 — a tile URL that leaks a study-area key.
 *
 * "The study area is a camera, never a filter" (plan apps#13/#14): the raster is always the `FULL`
 * COG. A URL like this one would mean the server filtered by study area, silently changing what
 * every number on the page means.
 */
export const LEAKY_TILE_URL =
  "https://titiler-v8.marinesensitivity.org/cog/tiles/WebMercatorQuad/{z}/{x}/{y}.png" +
  "?url=https%3A%2F%2Fexample%2Ecom%2Fa.tif&area=AK&colormap_name=spectral_r&rescale=0,90";

/** the same URL with the study area expressed as a value rather than a parameter name. */
export const LEAKY_TILE_URL_BY_VALUE =
  "https://titiler-v8.marinesensitivity.org/cog/tiles/WebMercatorQuad/{z}/{x}/{y}.png" +
  "?url=https%3A%2F%2Fexample%2Ecom%2Fa.tif&subregion_key=GA&colormap_name=spectral_r";

/**
 * FAULT 3 — a merged basemap layer tagged with the WRONG role (as if `composeStyle()`'s CARTO
 * merge loop pushed a layer with `role: "selection-line"` instead of a basemap sub-role).
 * `orderLayers()` sorts purely by role, so this sorts the layer AFTER a real data layer instead of
 * keeping it with the rest of the basemap block underneath everything — exactly the "CARTO layers
 * placed after the data layers" regression `tests/map/style.test.ts` proves is catchable.
 */
export const MISTAGGED_BASEMAP_LAYER = {
  role: "selection-line" as never, // should have been a basemap sub-role
  layer: {
    id: "basemap-water",
    type: "fill",
    source: "basemap-carto",
    "source-layer": "water",
    paint: { "fill-color": "#224466" },
  } as LayerSpecification,
};

/**
 * FAULT 4 — CARTO's raster basemap literals reinstated in `src/lib/map` (the exact regression that
 * shipped the "API KEY REQUIRED" watermark, 2026-09-23: CARTO's raster endpoint now requires a
 * key). `tests/map/no-raster-basemap.test.ts` scans `src/lib/map` for these; this fixture is under
 * `tests/fixtures/map/raster-basemap-fault/` so the SAME scan run against it is proved to fail.
 */
export const RASTER_BASEMAP_FAULT_DIR = "tests/fixtures/map/raster-basemap-fault";

/**
 * FAULT 5 — R3's layer stack (round-2 plan §5 U4): a layer already correctly classified into a
 * basemap SUB-role, but by a name the declared stack order does not recognize — as if
 * `classifyBasemapLayer` (or a future caller building its own custom order) produced a plausible-
 * looking group id that was never added to `layerStack.ts#BASEMAP_GROUPS`/`GROUP_ROLES`. Mirrors
 * FAULT 1 one level down: if `orderLayers` swallowed an unrecognized role instead of throwing, this
 * layer would silently vanish from the composed style (never rendered, never explained) rather than
 * failing loudly at build/test time — the property `tests/map/style.test.ts`'s R3 section asserts.
 */
export const UNGROUPED_BASEMAP_LAYER = {
  role: "basemap-seafloor-relief" as never, // reads like a real sub-role; is not declared anywhere
  layer: {
    id: "basemap-seafloor-relief",
    type: "fill",
    source: "basemap-carto",
    paint: { "fill-color": "#335577" },
  } as LayerSpecification,
};
