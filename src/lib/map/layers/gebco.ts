// The GEBCO 2025 sea floor over CARTO's style (Ben 2026-10-22: "the GEBCO bathymetric basemap is global and goes
// everywhere"): `@oceanmetrics/map` `composeStyle` adds, to CARTO's style.json as fetched, the colour relief and the
// igor hillshade of the terrain tiers (far z0-5 under core z0-8 under the sanctuaries' regional tier z9-10), the
// isobaths, the GEBCO undersea feature names and the OpenStreetMap land mask, in the theme's look (the places Place
// page and the indicators Map compose the same style). `style.ts#composeStyle` runs it on the CARTO style BEFORE
// `mergeCartoStyle` prefixes the ids, so the package's ids and order hold, and `classifyBasemapLayer` puts the sea
// floor in the Layers panel's Bathymetry row (`GEBCO_SEA_FLOOR_RE`).
//
// A LAZY module (`loadGebco()` in `basemap.ts`): the package's composer is fetched only when the Bathymetry row is on,
// so an instance whose default leaves it off (marinesensitivity) carries none of it on its static path. The tiers are
// read through the storage rule (`store('basemap/')`), so they follow `DEFAULT_STORAGE_HOST` and `VITE_OM_STORAGE` like
// every other bucket url of the app.
import {
  BASEMAP_URL,
  bathyDefaultOpacity,
  composeStyle as composeSeaFloor,
  DEFAULT_TILES,
  GEBCO_ATTRIBUTION,
  NAMES_ATTRIBUTION,
  type BasemapTiles,
} from "@oceanmetrics/map";
import type { StyleSpecification } from "maplibre-gl";
import { store } from "../../catalog/storage";
import type { ResolvedTheme } from "../types";
import type { CartoStyleLike } from "./basemap";

/** every tier url under `from` moved under `to` (the regional list too); a null tier stays null */
export function tilesAt(
  tiles: Readonly<BasemapTiles> = DEFAULT_TILES,
  from: string = BASEMAP_URL,
  to: string = store("basemap/"),
): BasemapTiles {
  const move = (u: string) => (u.startsWith(from) ? to + u.slice(from.length) : u);
  const opt = (u: string | null) => (u == null ? null : move(u));
  return {
    core: move(tiles.core),
    far: move(tiles.far),
    regional: tiles.regional?.map(move),
    contours: opt(tiles.contours),
    names: opt(tiles.names),
    land: opt(tiles.land),
  };
}

/** the sea floor's credit: the terrain tiers and isobaths, then the undersea names (the package's own lines, which each
 * archive's metadata carries too). The land mask's "© OpenStreetMap contributors" is already CARTO's line. */
export const SEA_FLOOR_ATTRIBUTION = `${GEBCO_ATTRIBUTION}; ${NAMES_ATTRIBUTION}`;

/** the tiers on this build's storage host */
export const GEBCO_TILES: BasemapTiles = tilesAt();

/** the package's themes: navy is dark-matter, paper positron (`layers/basemap.ts#CARTO_STYLE_PATH`) */
export const seaFloorTheme = (theme: ResolvedTheme): "dark" | "light" => (theme === "navy" ? "dark" : "light");

/** the sea floor's share of its theme default while a data layer draws over it (a COG, the OBIS hexagons): the
 * relief, shading and isobaths step back so the data reads first (the package's one `opacity` scales all three) */
export const DATA_DIM = 0.5;

/** the sea floor's opacity: the theme default, times {@link DATA_DIM} under data */
export const seaFloorOpacity = (theme: ResolvedTheme, underData: boolean): number =>
  bathyDefaultOpacity(seaFloorTheme(theme)) * (underData ? DATA_DIM : 1);

/** the composed styles of each CARTO style object, by theme and dimming: `composeStyle` runs on every reactive change of
 * the shell, and the CARTO style it is handed stays the same object between fetches */
const composed = new WeakMap<object, Map<string, CartoStyleLike>>();

/**
 * CARTO's style with the sea floor, the isobaths, the undersea names and the land mask; an empty style (the fetch
 * failed, or has not landed) comes back as it is, so the map never waits on CARTO for the tiers.
 *
 * The shell keeps CARTO's style in Svelte `$state`, a Proxy, which the package's `structuredClone` refuses
 * ("DataCloneError: #<Object> could not be cloned", every compose, 2026-10-23): the style is plain JSON, so it is
 * copied as JSON first. The result is kept per style object (a WeakMap), so a recompose costs nothing.
 */
export function withSeaFloor(
  carto: CartoStyleLike,
  theme: ResolvedTheme,
  opts: { underData?: boolean; tiles?: BasemapTiles } = {},
): CartoStyleLike {
  if (!carto.layers?.length) return carto;
  const key = `${theme}|${opts.underData ? 1 : 0}|${opts.tiles ? JSON.stringify(opts.tiles) : ""}`;
  let byKey = composed.get(carto);
  const hit = byKey?.get(key);
  if (hit) return hit;
  const plain = JSON.parse(JSON.stringify(carto)) as StyleSpecification;
  const out = composeSeaFloor(plain, {
    theme: seaFloorTheme(theme),
    tiles: opts.tiles ?? GEBCO_TILES,
    opacity: seaFloorOpacity(theme, !!opts.underData),
  }) as unknown as CartoStyleLike;
  if (!byKey) composed.set(carto, (byKey = new Map()));
  byKey.set(key, out);
  return out;
}
