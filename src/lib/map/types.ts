// map/ — the shapes the three lenses (atlas-4 scores, atlas-5 species, atlas-6 places) hand to
// `composeStyle()`. Every type here is plain data: no MapLibre instance, no DOM. The only
// MapLibre things this file touches are `import type` style-spec types, which erase at compile
// time — that is what keeps `style.ts` and `layers/*` unit-testable under vitest's node
// environment (CLAUDE.md "Testing pyramid": the test asserts the function, the component calls it).
import type { FeatureCollection } from "geojson";
import type { LayerSpecification, SourceSpecification, StyleSpecification } from "maplibre-gl";
import type { MapView, Projection, ResolvedTheme } from "../state/types";

export type { LayerSpecification, SourceSpecification, StyleSpecification };
export type { MapView, Projection, ResolvedTheme };

/** the theme's CARTO vector basemap: a style.json URL `composeStyle()` fetches (via
 * `layers/basemap.ts#loadBasemapStyle()`, cached per theme) and merges whole — never a raster tile
 * template (CARTO's raster endpoint now requires a key; see `layers/basemap.ts`'s header). */
export interface BasemapSpec {
  /** absolute https URL of CARTO's GL style.json — always absolute (plan D2: never resolve
   * against the mount point). */
  url: string;
  /** shown by the on-map About card (spec.md §9), never by MapLibre's own control. */
  attribution: string;
}

/** a titiler-backed raster: the score COG, or an overlay such as `_outside_pra` (atlas-4 §6.2). */
export interface RasterLayerSpec {
  /** style source AND layer id (they share the id, as in `msens::add_cell_tiles`). */
  id: string;
  /** tile URL templates carrying literal `{z}/{x}/{y}` — build them with `layers/titiler.ts`. */
  tiles: string[];
  opacity: number;
  tileSize?: number;
  /** `false` → `visibility: "none"`; the overlay ships off by default (atlas-4 §6.2 step 5). */
  visible?: boolean;
  /** `[west, south, east, north]` — restricts which tiles MapLibre ever REQUESTS to the COG's own
   * footprint (0.10.21 fix 2: titiler 404s a WebMercatorQuad tile outside the COG's extent, and
   * MapLibre otherwise asks for every tile covering the current viewport regardless). Build it
   * with `layers/raster.ts`'s `rasterBoundsForGrid()`, never a literal — see that function's own
   * header for why a grid whose longitude wraps the antimeridian (`usa05`) gets the full
   * [-180,180] range here instead of a narrower but WRONG one. */
  bounds?: [number, number, number, number];
}

/**
 * A gazetteer collection's PMTiles polygons, shown while "Pick from gazetteer" is on (places/
 * gazPick.ts) so a click can read a feature's `place_id`. Distinct from `RangeLayerSpec` (a per-species
 * filter): this is the Ocean Metrics gazetteer's own tile source, absolute-URL and
 * release-independent.
 */
export interface GazetteerLayerSpec {
  /** collection slug, e.g. `places`, `boem_wind_leases` -- also the source id suffix. */
  slug: string;
  /** absolute https PMTiles URL (the map module registers `pmtiles://` -- map.ts). */
  pmtiles: string;
  /** the vector layer inside the archive. */
  sourceLayer: string;
  /** the credit shown in the map attribution while this source is on the map (MapLibre's own
   * `attribution` source field, so it also reaches any control that reads it). */
  attribution: string;
}

/**
 * One gazetteer collection toggled on in the Layers panel's "Place layers" group (WP4): its PMTiles
 * drawn as a line plus a faint fill (polygons), a line (lines) or circles (points). Plain data like
 * every other spec here; `places/overlays.ts` builds it from a `layers.json` row.
 */
export interface PlaceOverlaySpec {
  /** collection slug, e.g. `noaa_sanctuaries` -- the source id suffix and the vector layer name. */
  slug: string;
  title: string;
  /** absolute https PMTiles URL (the map module registers `pmtiles://` -- map.ts). */
  pmtiles: string;
  /** the vector layer inside the archive (equals the slug). */
  sourceLayer: string;
  kind: "polygon" | "line" | "point";
  /** CSS colours from the collection's published paint (any CSS colour string). */
  fillColor: string;
  lineColor: string;
  lineWidth: number;
  /** the collection's credit; also MapLibre's own `attribution` source field. */
  attribution: string;
}

/** the selection highlight (atlas-4 §6.6 / §7: a cell ring or a zone outline, in
 * `colors.ts`'s `SELECTION_COLOR`). */
export interface SelectionSpec {
  /** whatever the lens computed: a cell square, a zone boundary, a drawn place. */
  features: FeatureCollection;
  /** overridden only by a test; the lens uses the shipped constant. */
  color?: string;
  /**
   * atlas-6 Deliverable 2's "show analysis cells" toggle: when true, `fill-opacity` reads each
   * feature's own `opacity` property (0-1, `pct / 100` — `places/cellSquares.ts` sets it) instead
   * of the flat 0.15 an ordinary selection highlight uses, so a lightly-covered cell paints
   * fainter than a fully-covered one.
   */
  cellOpacity?: boolean;
}

/**
 * A PMTiles vector "presence" fill — atlas-5's ranges branch (an IUCN/BirdLife/critical-habitat
 * range polygon, `atlas-refs/"parity species app.md"` §6.2's PMTiles branch). A range is per-SPECIES-input, filtered to one `mdl_key`, and carries no outline/label.
 */
export interface RangeLayerSpec {
  /** style source AND layer id. */
  id: string;
  /** absolute https PMTiles URL (`asset.url`; the map module registers `pmtiles://` — map.ts). */
  pmtiles: string;
  /** the vector layer inside the archive (`asset.sourceLayer`). */
  sourceLayer: string;
  /** the property every feature carries the model id under (`"mdl_key"`, §6.2). */
  keyProperty: string;
  /** the value to filter to — `["==", ["get", keyProperty], key]`. */
  key: string;
  fillColor: string;
  opacity: number;
}
