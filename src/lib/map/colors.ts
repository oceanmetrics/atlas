// THE ONLY place the map module writes a colour literal.
//
import type { ResolvedTheme } from "../state/types";

// These are DATA colours, and they are not a ramp: they are the `zone_style` table msens publishes
// (`zone_line_args()` / `zone_label_args()`, zone_style.R:22-55), the selection highlight
// (atlas-4 §6.6), the binary-mask overlay's RGBA (`cog_tile_url(color = "#222222")`,
// viz.R:412-420), and the `--surface-map`/`--stroke-outline` values a WebGL background/line layer
// needs but cannot read from CSS. Every one of them is fixed by a parity reference or a design
// token, none of them encodes a value, and none may move into `instances/<id>/tokens.css` — that
// file's rule is that a token is CHROME (spec.md §2: "brand colors are chrome; data colors are
// data"). `--stroke-outline` (R9, 2026-09-24) is the one deliberate exception alongside
// `--surface-map`: msens's own `zone_line_args()` table picks white for the programarea/planarea/
// default rows on the assumption of a dark basemap, which is a rendering/legibility choice, not a
// value the line encodes -- exactly what makes it CHROME, not data, once a light theme exists.
//
// Two gates meet here. `scripts/check-hex-literals.mjs` does not scan this directory at all
// (tokens are a brand rule). `tests/raster/ramps.wiring.test.ts` — "ramps.ts is the only ramp or
// palette definition under src/" — DOES, and it names this one file as its single map-side
// exception, with a companion assertion that nothing ramp-shaped (five or more stops) is ever
// defined here. Put a new map colour in this file or nowhere.

/** `--surface-map` per theme, as a plain hex. `tests/map/basemap.test.ts` asserts these equal
 * `instances/<id>/tokens.json`'s value in both themes, so the map background cannot drift from the
 * page background the shell paints behind it. */
export const MAP_BACKGROUND_NAVY = "#0b1635";
export const MAP_BACKGROUND_PAPER = "#eaeef3";

// --- the zone_style table's colours ------------------------------------------------------------

/** programarea / planarea outlines, and the "anything else" fallback row. */
export const ZONE_LINE_WHITE = "#ffffff";
/** ecoregion outlines. */
export const ZONE_LINE_BLACK = "#000000";

/** R9 (owner, 2026-09-24): the RENDERED colour for a `ZONE_LINE_WHITE` stroke (programarea /
 * planarea / the default row), by theme -- mirrors `instances/<id>/tokens.css`'s `--stroke-outline`
 * (a MapLibre style is not CSS and cannot read a custom property, so the value is duplicated by
 * necessity, exactly the way `MAP_BACKGROUND_NAVY`/`MAP_BACKGROUND_PAPER` above already mirror
 * `--surface-map`). `tests/map/zoneOutline.test.ts` pins them equal. Navy is unchanged from
 * `ZONE_LINE_WHITE` itself (msens's own `zone_line_args()` value, still verbatim for parity); paper
 * substitutes brand navy ink, since white is near-invisible on that theme's light basemap
 * (`ZONE_LINE_BLACK`/`ZONE_LINE_GREY` — ecoregion/subregion — are untouched by this: they were
 * never the near-white/near-basemap case). Applied in `layers/zones.ts#zoneLineLayer`, never in
 * the parity-tested `ZONE_LINE_STYLE` table itself. */
export const ZONE_OUTLINE_STROKE_BY_THEME: Record<ResolvedTheme, string> = {
  navy: ZONE_LINE_WHITE,
  paper: "#001a57",
};
/** subregion outlines (dashed). */
export const ZONE_LINE_GREY = "#d9d9d9";

/** programarea / planarea labels: white glyph on a dark halo. */
export const ZONE_LABEL_WHITE = "#ffffff";
export const ZONE_LABEL_HALO_DARK = "rgba(0,0,0,0.75)";
/** ecoregion labels: black glyph on a light halo. */
export const ZONE_LABEL_BLACK = "#000000";
export const ZONE_LABEL_HALO_LIGHT = "rgba(255,255,255,0.85)";

// --- selection and overlays ---------------------------------------------------------------------

/** the selection highlight — a cell ring, a zone outline, a drawn place (atlas-4 §6.6/§7.1-7.3). */
export const SELECTION_COLOR = "#ff00aa";

/** the clicked raster cell's marker (a ring and the cell's square): white over a dark halo, so it reads on any ramp. */
export const HIGHLIGHT_COLOR = "#ffffff";
export const HIGHLIGHT_HALO_COLOR = "#0b1020";

/** `manifest.overlays._outside_pra`'s explicit colormap, `{"1":[34,34,34,255]}` (atlas-4 §6.3). */
export const OUTSIDE_PRA_RGBA: readonly [number, number, number, number] = [34, 34, 34, 255];

/** B3 fix (`docs/usability.md`): pick mode's invisible query fill, `zoneUnitsFromBoot`
 * (`layers/zones.ts`) — its own `opacity: 0` already makes the actual colour irrelevant on
 * screen, but `zoneFillLayer` still needs SOME `fill-color`/`fill-outline-color` string, and this
 * is the one place the map module is allowed to write one (this file's own header). */
export const QUERY_FILL_COLOR = "#000000";

/** atlas-5's species "range" fill (`msens::add_fill_layer(fill_color = "#3388ff")`,
 * `atlas-refs/"parity species app.md"` §6.2's PMTiles branch) — a fixed data color, not a ramp
 * (one swatch, not 11 stops) and not brand chrome, so it lives here rather than in `ramps.ts` or
 * `instances/<id>/tokens.css`. Also the categorical legend swatch and the click-popup swatch for a
 * "presence only" click (`map/layers/ranges.ts`, `src/lens/species/popup.ts`). */
export const RANGE_FILL_COLOR = "#3388ff";

/** the gazetteer picker's polygons (`layers/gazetteer.ts`): the colour erddap-places paints its own
 * gazetteer layer with (#3388ff, its published style `places-fill`), here a fainter fill under a
 * solid outline so the basemap stays readable while a person hunts for a polygon to click. */
export const GAZETTEER_COLOR = "#3388ff";
