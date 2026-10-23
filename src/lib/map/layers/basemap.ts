// The basemap, picked by theme — spec.md §3: `navy` → dark-matter, `paper` → positron.
//
// CARTO's RASTER basemaps (the two theme-named XYZ tile endpoints this file used to point at)
// started answering with an "API KEY REQUIRED" watermark tile (owner report, 2026-09-23) — CARTO
// now gates the raster endpoint behind a key. Its VECTOR GL styles do not: `.../gl/dark-matter-gl-style/
// style.json` and `.../gl/positron-gl-style/style.json` are still keyless (verified live the same
// day: 200, ~70 KB, `sources.carto` a `carto.streets` vector TileJSON, plus a sprite and a glyph
// range). That costs the extra round trips the OLD comment here warned about (style.json -> its own
// TileJSON -> vector tiles -> sprite -> glyphs) — accepted, since the raster endpoint no longer
// works at any price. `loadBasemapStyle()` fetches+caches that style.json ONCE per theme;
// `style.ts#composeStyle()` merges its `sources`/`sprite`/`glyphs`/`layers` into the ONE composed
// style (CLAUDE.md: "one MapLibre style, one setStyle(diff:true)") — never a second style object.
import { MAP_BACKGROUND_NAVY, MAP_BACKGROUND_PAPER } from "../colors";
import type { ResolvedTheme } from "../types";

/** CARTO's own vector GL style per theme (`dark-matter` = navy, `positron` = paper) — the ONE place
 * this mapping lives. No key, no raster fallback: `tests/map/no-raster-basemap.test.ts` is the
 * source-scan gate that this file (and everything else under `src/lib/map`) never reintroduces the
 * old raster tile names (see the removed `BASEMAP_BY_THEME` table, atlas-map git history). */
export const CARTO_STYLE_PATH: Record<ResolvedTheme, string> = {
  navy: "dark-matter-gl-style",
  paper: "positron-gl-style",
};

/** CARTO's style-JSON host (verified live 2026-09-23: 200, ~70 KB, keyless). */
export const CARTO_STYLE_BASE = "https://basemaps.cartocdn.com/gl";

export const BASEMAP_ATTRIBUTION = "© OpenStreetMap contributors © CARTO";

/** the basemap's credit line: CARTO's, then the sea floor's own (`gebco.ts#SEA_FLOOR_ATTRIBUTION`, GEBCO's and the
 * gazetteer's, from the lazy module, so the package's strings stay off the static path) while it draws */
export function basemapAttribution(seaFloor: Pick<SeaFloorModule, "SEA_FLOOR_ATTRIBUTION"> | null): string {
  return seaFloor ? `${BASEMAP_ATTRIBUTION}; ${seaFloor.SEA_FLOOR_ATTRIBUTION}` : BASEMAP_ATTRIBUTION;
}

/** the lazy sea-floor module (`gebco.ts`, with `@oceanmetrics/map`'s composer), loaded once, the first time the
 * Bathymetry row is on. Resolves to null (and may be asked again) when the chunk fails to load: the map keeps
 * CARTO's own style. */
export type SeaFloorModule = typeof import("./gebco");
let seaFloorLoad: Promise<SeaFloorModule | null> | null = null;
export function loadSeaFloor(
  load: () => Promise<SeaFloorModule> = () => import("./gebco"),
): Promise<SeaFloorModule | null> {
  seaFloorLoad ??= load().catch(() => {
    seaFloorLoad = null;
    return null;
  });
  return seaFloorLoad;
}

/** test-only: forgets the loaded module. */
export function resetSeaFloorForTests(): void {
  seaFloorLoad = null;
}

/** the basemap spec for a theme: just the style URL + attribution — `loadBasemapStyle()` does the
 * fetching, `composeStyle()` does the merging. Kept as its own function (rather than inlining the
 * URL template) so a theme's basemap is still ONE table, matching `layers/basemap.ts`'s original
 * contract. */
export function basemapForTheme(theme: ResolvedTheme): { url: string; attribution: string } {
  return {
    url: `${CARTO_STYLE_BASE}/${CARTO_STYLE_PATH[theme]}/style.json`,
    attribution: BASEMAP_ATTRIBUTION,
  };
}

/** the slice of a fetched CARTO GL style `composeStyle()` actually merges — plain data, so a test
 * can build one by hand instead of fetching the real 93-layer style.json. */
export interface CartoStyleLike {
  sources?: Record<string, unknown>;
  sprite?: string;
  glyphs?: string;
  layers?: Array<Record<string, unknown> & { id: string; type: string; source?: string }>;
}

/** the in-memory fallback when a fetch fails (offline, CORS, a future CARTO outage): NO sources or
 * layers, so `composeStyle()`'s own synthetic `background` layer (the theme's plain
 * `--surface-map` colour, `MAP_BACKGROUND_BY_THEME`) is all that paints — the app never blanks. */
export const EMPTY_BASEMAP_STYLE: CartoStyleLike = { sources: {}, layers: [] };

/** the slice of `Response` this needs, so tests (and this module) don't have to construct a real
 * one — the same seam `release/session.ts#resolveSession()` already uses for its own fetch. */
export type BasemapStyleResponseLike = Pick<Response, "ok" | "json">;

const cache = new Map<ResolvedTheme, CartoStyleLike>();
const pending = new Map<ResolvedTheme, Promise<CartoStyleLike>>();

/**
 * Fetch (once) and cache CARTO's GL style.json for a theme. Concurrent callers for the SAME theme
 * share one in-flight request; a resolved theme is never re-fetched. Any failure — network error,
 * a non-2xx response, unparsable JSON — resolves to {@link EMPTY_BASEMAP_STYLE} rather than
 * throwing (never fail the map open, CLAUDE.md's "never fail open" is about preview access, but the
 * same never-blank spirit applies here) and is NOT cached, so a later call may retry once the
 * network recovers.
 */
export async function loadBasemapStyle(
  theme: ResolvedTheme,
  fetchStyle: (url: string) => Promise<BasemapStyleResponseLike> = (url) => fetch(url),
): Promise<CartoStyleLike> {
  const hit = cache.get(theme);
  if (hit) return hit;
  const inflight = pending.get(theme);
  if (inflight) return inflight;

  const promise = (async (): Promise<CartoStyleLike> => {
    try {
      const res = await fetchStyle(basemapForTheme(theme).url);
      if (!res.ok) return EMPTY_BASEMAP_STYLE;
      const json = (await res.json()) as CartoStyleLike;
      cache.set(theme, json);
      return json;
    } catch {
      return EMPTY_BASEMAP_STYLE;
    } finally {
      pending.delete(theme);
    }
  })();
  pending.set(theme, promise);
  return promise;
}

/**
 * The SYNCHRONOUS read `composeStyle()` uses: whatever is cached for `theme` right now, or
 * {@link EMPTY_BASEMAP_STYLE} if `loadBasemapStyle()` has not resolved (or was never called) yet.
 *
 * `composeStyle()` deliberately never awaits the fetch itself (see its own header). Between
 * 0.10.11 and 0.10.19 nothing forced a recompose once the fetch resolved either, and the caller
 * relied on "the NEXT ordinary reactive recompose (zones/raster/selection settle within the first
 * second of any real load) picks up the by-then-warm cache". That assumption is FALSE under load,
 * and {@link warmBasemapStyles} is the fix — see its header for the measurement.
 */
export function getCachedBasemapStyle(theme: ResolvedTheme): CartoStyleLike {
  return cache.get(theme) ?? EMPTY_BASEMAP_STYLE;
}

/**
 * Warm every theme's CARTO style AND tell the caller when each one lands, so the caller can put it
 * in reactive state and recompose — the 0.10.20 fix for a basemap that silently never paints.
 *
 * MEASURED (Firefox, `e2e/scores.firstpaint.spec.ts`'s raster probe, 1 of 40 repeats at load ~11,
 * and deterministically with the CARTO style.json answered 3 s late): the composed style's ocean
 * pixel read `247,171,122` instead of `153,117,86` — the score raster at 0.6 opacity over the
 * theme's flat `--surface-map` colour rather than over the basemap. Ten seconds after the
 * style.json had arrived, `getStyle().layers` still held ZERO `basemap-` layers. The old policy
 * had no invalidation at all: when the fetch resolves after the last reactive change (which is
 * exactly what contention causes), the cache is warm and nothing ever reads it again, so the
 * basemap never appears — for the whole life of the page, not just late.
 *
 * The reason that invalidation was left out was real too: an extra `setStyle(diff:true)` landing
 * at a network-timed moment inside a burst of other style changes exposed a MapLibre-level
 * mis-ordering. That is now fixed where it belongs, in `map/styleQueue.ts`: at most one `setStyle`
 * is in flight at a time, so an extra recompose costs one more settle cycle and can no longer
 * produce a mis-ordered pair of diffs. Hence this helper, rather than another workaround. (0.10.22:
 * that cycle ends on the issued style's own `"style.load"`, not `"idle"`, and an identical recompose
 * — the other theme reporting in — is not issued at all; see `styleQueue.ts`'s header.)
 *
 * `onResolved` is called exactly once per theme, ALWAYS — `loadBasemapStyle()` resolves to
 * {@link EMPTY_BASEMAP_STYLE} rather than rejecting, and the rejection path is covered anyway, so a
 * caller can key its reactive state on "has this theme reported in" without ever hanging.
 */
export function warmBasemapStyles(
  themes: readonly ResolvedTheme[],
  onResolved: (theme: ResolvedTheme, style: CartoStyleLike) => void,
  load: (theme: ResolvedTheme) => Promise<CartoStyleLike> = (theme) => loadBasemapStyle(theme),
): void {
  for (const theme of themes) {
    void load(theme).then(
      (style) => onResolved(theme, style),
      () => onResolved(theme, EMPTY_BASEMAP_STYLE),
    );
  }
}

/** test-only: clears the module cache so each test starts cold. Never called from app code. */
export function resetBasemapStyleCacheForTests(): void {
  cache.clear();
  pending.clear();
}

/** CARTO's glyph endpoint — verbatim from the real style.json (verified 2026-09-23), and the static
 * fallback `composeStyle()` uses when a fetch failed but a symbol layer still needs one (a zone
 * label, e.g.) — see `EMPTY_BASEMAP_STYLE`'s own header. */
export const GLYPHS_URL = "https://tiles.basemaps.cartocdn.com/fonts/{fontstack}/{range}.pbf";

/** the font stack every ZONE label layer names (`layers/zones.ts`) — CARTO's own layers carry their
 * own `text-font` verbatim from the fetched style and never read this. */
export const LABEL_FONT: readonly string[] = ["Open Sans Regular"];

/**
 * The `--surface-map` token of each theme, as a plain hex the WebGL background layer can take (a
 * style is not CSS and cannot read a custom property). `tests/map/basemap.test.ts` asserts these
 * equal `instances/<id>/tokens.json`'s `--surface-map` in both themes, so the map's background can
 * never drift from the page background the shell paints behind it — and it is the colour that
 * shows when the CARTO fetch fails and {@link EMPTY_BASEMAP_STYLE} is all `composeStyle()` has.
 */
export const MAP_BACKGROUND_BY_THEME: Record<ResolvedTheme, string> = {
  navy: MAP_BACKGROUND_NAVY,
  paper: MAP_BACKGROUND_PAPER,
};
