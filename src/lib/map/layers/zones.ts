// Zone units: one PMTiles vector source per unit, plus its fill / line / label layers.
//
// The style values are a TABLE, not code (atlas-4 §6.2, `msens::zone_line_args()` /
// `zone_label_args()`, zone_style.R:22-55). A lens never writes a width or a colour: it names a
// unit and this table answers. Adding `planarea` back, or restyling `subregion`, is a one-line data
// change here with a unit test beside it — which is the whole point of keeping it out of the
// component.
//
// The colours themselves live in `../colors.ts` — the map module's ONE colour file, and the single
// exception `tests/raster/ramps.wiring.test.ts` grants under `src/` outside `src/lib/brand/**`.
// They are DATA colours (the zone_style table msens publishes), not brand chrome, so they must
// never move into `src/lib/brand/tokens.css` either (spec.md §2) -- EXCEPT the white stroke itself
// (R9, 2026-09-24, `colors.ts`'s own header): white reads fine against the dark-matter basemap
// this table was designed against, but is near-invisible on the paper theme's light one, so
// `zoneLineLayer` below substitutes `ZONE_OUTLINE_STROKE_BY_THEME[theme]` for a `ZONE_LINE_WHITE`
// stroke specifically -- the parity-tested `ZONE_LINE_STYLE` table itself never changes.
import type { Feature, FeatureCollection, Point } from "geojson";
import type { Outline, ResolvedTheme } from "../../state/types";
import { GLYPHS_URL, LABEL_FONT } from "./basemap";
import {
  QUERY_FILL_COLOR,
  SELECTION_COLOR,
  ZONE_LABEL_BLACK,
  ZONE_LABEL_HALO_DARK,
  ZONE_LABEL_HALO_LIGHT,
  ZONE_LABEL_WHITE,
  ZONE_LINE_BLACK,
  ZONE_LINE_GREY,
  ZONE_LINE_WHITE,
  ZONE_OUTLINE_STROKE_BY_THEME,
} from "../colors";
import type {
  LayerSpecification,
  SourceSpecification,
  ZoneFillSpec,
  ZoneLabelSpec,
  ZoneStyleParts,
  ZoneUnitSpec,
} from "../types";

export interface ZoneLineStyle {
  color: string;
  width: number;
  opacity: number;
  /** `line_dasharray`; omitted means a solid line. */
  dash?: readonly number[];
}

export interface ZoneLabelStyle {
  color: string;
  size: number;
  haloColor: string;
  haloWidth: number;
}

/** `msens::zone_line_args()` (zone_style.R:22-55), verbatim. */
export const ZONE_LINE_STYLE: Readonly<Record<string, ZoneLineStyle>> = {
  programarea: { color: ZONE_LINE_WHITE, width: 1, opacity: 1 },
  planarea: { color: ZONE_LINE_WHITE, width: 1, opacity: 1 },
  ecoregion: { color: ZONE_LINE_BLACK, width: 3, opacity: 1 },
  subregion: { color: ZONE_LINE_GREY, width: 2, opacity: 0.7, dash: [3, 3] },
};

/** the "anything else" row of the same table (white, 0.5, 0.45) — a unit a future release invents
 * still draws, faintly, instead of throwing or vanishing. */
export const ZONE_LINE_STYLE_DEFAULT: ZoneLineStyle = {
  color: ZONE_LINE_WHITE,
  width: 0.5,
  opacity: 0.45,
};

/** `msens::zone_label_args()`: programarea white 12 px on a dark halo, ecoregion black 16 px on a
 * light halo, subregion NONE (`NULL` in R ⇒ no label layer is created at all). */
export const ZONE_LABEL_STYLE: Readonly<Record<string, ZoneLabelStyle | null>> = {
  programarea: { color: ZONE_LABEL_WHITE, size: 12, haloColor: ZONE_LABEL_HALO_DARK, haloWidth: 1 },
  planarea: { color: ZONE_LABEL_WHITE, size: 12, haloColor: ZONE_LABEL_HALO_DARK, haloWidth: 1 },
  ecoregion: {
    color: ZONE_LABEL_BLACK,
    size: 16,
    haloColor: ZONE_LABEL_HALO_LIGHT,
    haloWidth: 1.5,
  },
  subregion: null,
};

export function zoneLineStyle(unit: string): ZoneLineStyle {
  return ZONE_LINE_STYLE[unit] ?? ZONE_LINE_STYLE_DEFAULT;
}

/** `null` = this unit gets no label layer (subregion, and any unit the table does not name). */
export function zoneLabelStyle(unit: string): ZoneLabelStyle | null {
  return unit in ZONE_LABEL_STYLE ? ZONE_LABEL_STYLE[unit] : null;
}

// --- ids: one naming rule, so a lens never has to guess one ------------------------------------
// The Shiny app's ids (`{type}_src`, `{type}_ln`, `{type}_lbl`, `{type}_fill`) are kept verbatim so
// the parity reference reads straight across.

export const zoneSourceId = (unit: string) => `${unit}_src`;
export const zoneLineId = (unit: string) => `${unit}_ln`;
export const zoneFillId = (unit: string) => `${unit}_fill`;
export const zoneLabelId = (unit: string) => `${unit}_lbl`;
export const zoneLabelSourceId = (unit: string) => `${unit}_lbl_src`;
export const zoneHighlightId = (unit: string) => `${unit}_highlight_ln`;

/** the clicked-zone highlight's line width — kept equal to `style.ts`'s `SELECTION_LINE_WIDTH` (a
 * literal here, not an import, to avoid a `style.ts` <-> `layers/zones.ts` import cycle; the two
 * are pinned equal by `tests/map/zoneHighlight.test.ts`). */
export const ZONE_HIGHLIGHT_LINE_WIDTH = 4;

/** every layer id that a click/hover query may hit for these units, innermost first (fills before
 * lines — a click inside a polygon should resolve to the polygon, not to whichever border is 2 px
 * away). `interaction.ts` takes this list; no caller builds it by hand. */
export function zoneQueryLayerIds(units: readonly ZoneUnitSpec[]): string[] {
  return [
    ...units.filter((u) => u.fill).map((u) => zoneFillId(u.unit)),
    ...units.map((u) => zoneLineId(u.unit)),
  ];
}

// --- the style parts composeStyle places ---------------------------------------------------------

/**
 * Every source and roled layer the zone units draw, for `style.ts#composeStyle`'s `zoneStyle` input
 * (moved from MarineSensitivity/atlas 0.10.93's `composeStyle` zone loop; composeStyle takes the parts
 * so an instance without a release carries none of this module). M5: a REAL choropleth (computed
 * values, `stops.length > 0`) is role "choropleth" (group `data-raster`, "the lens's data"); the
 * invisible B3 query-fill placeholder every unit carries (`stops: []`, pick-mode's interior hit-test)
 * stays "zone-fill" (the outline group). U5: the outline's stroke colour is theme-aware. The labels
 * draw above every outline, and a clicked zone's highlight above everything (`selection-line`).
 * `null` for no units.
 */
export function composeZoneStyle(
  zones: readonly ZoneUnitSpec[],
  theme: ResolvedTheme,
): ZoneStyleParts | null {
  if (zones.length === 0) return null;
  const layers: ZoneStyleParts["layers"][number][] = [];
  for (const u of zones) {
    const fill = zoneFillLayer(u);
    if (fill) {
      const role = (u.fill?.stops.length ?? 0) > 0 ? "choropleth" : "zone-fill";
      layers.push({ role, layer: fill });
    }
    layers.push({ role: "zone-line", layer: zoneLineLayer(u, theme) });
  }
  for (const u of zones) {
    const label = zoneLabelLayer(u);
    if (label) layers.push({ role: "zone-label", layer: label });
  }
  for (const u of zones) {
    const highlight = zoneHighlightLayer(u);
    if (highlight) layers.push({ role: "selection-line", layer: highlight });
  }
  return { sources: zoneSources(zones), layers, glyphs: zonesNeedGlyphs(zones) };
}

// --- sources -----------------------------------------------------------------------------------

/**
 * `pmtiles://` vector sources, one per unit, plus one GeoJSON point source per unit that has
 * labels. The `pmtiles://` prefix is what `map.ts`'s `addProtocol("pmtiles", ...)` registration
 * intercepts; the URL itself is the absolute one `boot.units[].pmtiles` carries (plan D2/D6: a
 * release URL is ALWAYS absolute and formed in `release/dataBase.ts`, never relative to the mount
 * point).
 */
export function zoneSources(units: readonly ZoneUnitSpec[]): Record<string, SourceSpecification> {
  const sources: Record<string, SourceSpecification> = {};
  for (const u of units) {
    sources[zoneSourceId(u.unit)] = { type: "vector", url: `pmtiles://${u.pmtiles}` };
    if (u.labels) sources[zoneLabelSourceId(u.unit)] = { type: "geojson", data: u.labels.points };
  }
  return sources;
}

/** does any unit carry labels? (`style.ts` only sets `glyphs` then — a style with no symbol layer
 * must never make the browser fetch a font range.) */
export function zonesNeedGlyphs(units: readonly ZoneUnitSpec[]): boolean {
  return units.some((u) => u.labels !== undefined && zoneLabelStyle(u.unit) !== null);
}

export { GLYPHS_URL, LABEL_FONT };

// --- layers ------------------------------------------------------------------------------------

/**
 * The choropleth fill (`app.R:2318`): a `match` expression on the unit's key property, one stop per
 * zone, `defaultColor` for a zone the lens had no value for. The stops are DATA — the lens computed
 * them from `boot.zones[unit]` with `ramps.ts`'s 11-bin rule; nothing about binning happens here.
 *
 * B3 fix: a MapLibre `match` expression needs at least ONE label/output pair before its fallback --
 * `["match", input, fallback]` is invalid (`layers[…].paint.fill-color: Expected at least 4
 * arguments, but found only 2`), a real runtime style-validation error a plain vitest fixture
 * cannot catch (only e2e/scores.palettes.spec.ts's real MapLibre instance did, and the SAME broken
 * style silently starved every other layer behind it: e2e/scores.firstpaint.spec.ts's raster probe
 * and e2e/places.pick.spec.ts's own pick query both went red from this one cause). `queryFillFor()`
 * (below) passes `stops: []` on purpose -- an invisible query fill has no per-zone colours to
 * carry -- so an EMPTY `fill.stops` now skips the `match` wrapper entirely and paints the flat
 * `defaultColor` directly, which is exactly what a zero-stop `match` was trying (and failing) to
 * express anyway.
 */
export function zoneFillLayer(u: ZoneUnitSpec): LayerSpecification | null {
  const fill = u.fill;
  if (!fill) return null;
  let fillColor: unknown;
  if (fill.stops.length === 0) {
    fillColor = fill.defaultColor;
  } else {
    const match: unknown[] = ["match", ["get", fill.keyProperty]];
    for (const stop of fill.stops) match.push(stop.key, stop.color);
    match.push(fill.defaultColor);
    fillColor = match;
  }
  return {
    id: zoneFillId(u.unit),
    type: "fill",
    source: zoneSourceId(u.unit),
    "source-layer": u.sourceLayer,
    paint: {
      "fill-color": fillColor as never,
      "fill-opacity": fill.opacity,
      "fill-outline-color": fill.outlineColor,
    },
  };
}

/**
 * R9 (owner, 2026-09-24): `theme` recolors ONLY a `ZONE_LINE_WHITE` stroke (programarea / planarea
 * / the default row) to `ZONE_OUTLINE_STROKE_BY_THEME[theme]` -- ecoregion (black) and subregion
 * (grey) are untouched, since they were never the near-invisible-on-light-basemap case. Read once
 * here, synchronously, at compose time (`style.ts#composeStyle` already resolves `theme` before
 * building any layer) -- never a live CSS read, and the parity-tested `ZONE_LINE_STYLE` table
 * itself (`zoneLineStyle()`) never changes.
 */
export function zoneLineLayer(u: ZoneUnitSpec, theme: ResolvedTheme): LayerSpecification {
  const s = zoneLineStyle(u.unit);
  const color = s.color === ZONE_LINE_WHITE ? ZONE_OUTLINE_STROKE_BY_THEME[theme] : s.color;
  const paint: Record<string, unknown> = {
    "line-color": color,
    "line-width": s.width,
    "line-opacity": s.opacity,
  };
  if (s.dash) paint["line-dasharray"] = [...s.dash];
  return {
    id: zoneLineId(u.unit),
    type: "line",
    source: zoneSourceId(u.unit),
    "source-layer": u.sourceLayer,
    layout: { visibility: u.lineVisible === false ? "none" : "visible" },
    paint: paint as never,
  };
}

/**
 * The clicked-zone highlight (atlas-4 §6.6): a line layer filtered to ONE key of the SAME vector
 * source/layer `u` already draws an outline for — no separate geometry fetch, matching the ported
 * app's `add_line_layer(filter=list("==", "{unit}_key", key))`. `null` when `u.highlightKey` is
 * unset (the common case: nothing of this unit is selected).
 */
export function zoneHighlightLayer(u: ZoneUnitSpec): LayerSpecification | null {
  if (!u.highlightKey) return null;
  return {
    id: zoneHighlightId(u.unit),
    type: "line",
    source: zoneSourceId(u.unit),
    "source-layer": u.sourceLayer,
    filter: ["==", ["get", zoneKeyProperty(u.unit)], u.highlightKey] as never,
    paint: { "line-color": SELECTION_COLOR, "line-width": ZONE_HIGHLIGHT_LINE_WIDTH },
  };
}

export function zoneLabelLayer(u: ZoneUnitSpec): LayerSpecification | null {
  const style = zoneLabelStyle(u.unit);
  if (!u.labels || !style) return null;
  return {
    id: zoneLabelId(u.unit),
    type: "symbol",
    source: zoneLabelSourceId(u.unit),
    layout: {
      "text-field": ["get", u.labels.textProperty] as never,
      "text-font": [...LABEL_FONT],
      "text-size": style.size,
      // `text_allow_overlap = TRUE` (atlas-4 §6.2 step 3): a Program Area label is the zone's
      // identity, so it is never dropped to make room for a neighbour's.
      "text-allow-overlap": true,
    },
    paint: {
      "text-color": style.color,
      "text-halo-color": style.haloColor,
      "text-halo-width": style.haloWidth,
    },
  };
}

// --- boot.json readers -------------------------------------------------------------------------

interface BootUnitRow {
  fld?: unknown;
  label?: unknown;
  pmtiles?: unknown;
  source_layer?: unknown;
  zone_set_key?: unknown;
}

/** `fld` (`programarea_key`) → the unit type (`programarea`). */
export function unitFromFld(fld: string): string {
  return fld.replace(/_key$/, "");
}

/** the key property a zone's vector tile carries for this unit — `kcol` in the Shiny app. */
export function zoneKeyProperty(unit: string): string {
  return `${unit}_key`;
}

/** the name property (`ncol`), used for hover text and the selection label. */
export function zoneNameProperty(unit: string): string {
  return `${unit}_name`;
}

/**
 * B3 fix (`docs/usability.md`): an invisible (`opacity: 0`) `ZoneFillSpec` so `zoneQueryLayerIds`
 * always has a `{unit}_fill` layer to query, and that layer always exists in the composed style
 * (every `zoneUnitsFromBoot` caller — `Shell.svelte`'s own base `zoneUnits` AND the scores lens'
 * `scoresMapInputs`, `mapInputs.ts` — starts from this function's output). Before this fix, an
 * outline-only unit's ONLY queryable layer was its 1-px `{unit}_ln` line, so pick mode
 * (`places/pickInstall.ts`) could resolve a click on a Program Area's BORDER but never its
 * interior — "Add to places" stayed disabled for every interior click, in every spatial-unit
 * mode, because `scoresMapInputs` only overwrites this placeholder with REAL colours when the
 * unit is both the selected spatial unit AND has values to show (`mapInputs.ts`'s `if (choro.fill)
 * out = {...}`); otherwise `out = u` keeps exactly this fill. `stops: []` + a `defaultColor` means
 * `zoneFillLayer`'s `match` expression falls straight through to that (invisible) default for
 * every key, so this has zero visual effect wherever nothing more specific overrides it.
 */
function queryFillFor(unit: string): ZoneFillSpec {
  return {
    keyProperty: zoneKeyProperty(unit),
    stops: [],
    defaultColor: QUERY_FILL_COLOR,
    opacity: 0,
    outlineColor: QUERY_FILL_COLOR,
  };
}

/**
 * Read `boot.units[]` (atlas-1's contract: `zone_set_key, fld, label, pmtiles, source_layer`) into
 * `ZoneUnitSpec`s, in boot's own order — Program Areas first, then finest first, which is the
 * order the publisher already sorted them into (atlas-4 §2.4). A row missing `fld`, `pmtiles` or
 * `source_layer` is SKIPPED, never defaulted: a guessed source layer renders an empty outline that
 * looks exactly like "this release has no zones". Outline-only ON SCREEN is still the default —
 * every unit gets `queryFillFor`'s invisible placeholder `fill` (B3), never a visible one; a
 * caller that wants a real choropleth (the scores lens) overwrites it explicitly.
 */
export function zoneUnitsFromBoot(boot: unknown): ZoneUnitSpec[] {
  const rows = (boot as { units?: unknown } | null | undefined)?.units;
  if (!Array.isArray(rows)) return [];
  const out: ZoneUnitSpec[] = [];
  for (const raw of rows as BootUnitRow[]) {
    if (!raw || typeof raw !== "object") continue;
    const { fld, pmtiles, source_layer: sourceLayer, label } = raw;
    if (typeof fld !== "string" || typeof pmtiles !== "string" || typeof sourceLayer !== "string")
      continue;
    if (!fld || !pmtiles || !sourceLayer) continue;
    const unit = unitFromFld(fld);
    out.push({
      unit,
      pmtiles,
      sourceLayer,
      label: typeof label === "string" ? label : undefined,
      fill: queryFillFor(unit),
    });
  }
  return out;
}

/**
 * `Sel.out`'s ONE map-side effect (G-25 fix, `docs/parity.html`): sets every unit's `lineVisible`
 * from the URL's outline choice. `Shell.svelte` calls this ONCE on whichever `zones` array is
 * about to reach `composeStyle()` — never a second, piecemeal `setLayoutProperty()` call after
 * the fact (CLAUDE.md: "one composed style, applied with one `setStyle(diff:true)`"); the line
 * layer's visibility is an INPUT to the style, exactly like every other zone paint property.
 *
 * `out === "none"` hides every unit's standalone outline line; otherwise only the unit whose TYPE
 * equals `out` keeps its line visible (a release that has not published that unit type at all —
 * e.g. `out=ecoregion` before an ecoregion PMTiles archive exists — simply has nothing to show,
 * never a thrown error). A unit's own choropleth FILL (`zoneFillLayer`'s `fill-outline-color`, a
 * separate paint property on a separate layer) is never touched here: the scores lens' selected-
 * unit choropleth keeps its own edge even when `out` hides the plain outline drawn beside it.
 *
 * Before this fix, nothing read `Sel.out` at all: `out=none` (the species lens' own DEFAULT, per
 * `defaultOut()`) still drew the Program-Area outline on every map, because `Shell.svelte` handed
 * every `boot.units[]` row straight to `composeStyle()` with no outline filtering whatsoever — a
 * URL key that round-tripped but never changed what rendered, exactly what plan D8's "URL is the
 * view" rule exists to prevent.
 */
export function zoneUnitsWithOutline(units: readonly ZoneUnitSpec[], out: Outline): ZoneUnitSpec[] {
  return units.map((u) => ({ ...u, lineVisible: out !== "none" && u.unit === out }));
}

interface BootZoneRow {
  key?: unknown;
  name?: unknown;
  label_pt?: unknown;
}

/** accepts `[lon, lat]`, `{lon, lat}` or `{lng, lat}` — atlas-1 has not frozen `label_pt`'s shape
 * yet (src/lib/release/boot.ts's TODO), and a wrong guess must be a skipped label, not a throw. */
function labelPoint(raw: unknown): [number, number] | null {
  if (Array.isArray(raw) && raw.length >= 2) {
    const [lon, lat] = raw;
    if (typeof lon === "number" && typeof lat === "number") return [lon, lat];
    return null;
  }
  if (raw && typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    const lon = typeof o.lon === "number" ? o.lon : typeof o.lng === "number" ? o.lng : null;
    const lat = typeof o.lat === "number" ? o.lat : null;
    if (lon !== null && lat !== null) return [lon, lat];
  }
  return null;
}

/**
 * `boot.zones[unit][*].label_pt` → a point FeatureCollection with `key` and `name` properties.
 *
 * The cached label longitudes are 0-360 (`st_shift_longitude`, atlas-4 §2.4 / §6.5); they are
 * brought back into -180..180 here because a GeoJSON source is RFC 7946 and MapLibre would place a
 * 187.5° label a world away. That is the ONE normalization this reader does.
 */
export function zoneLabelsFromBoot(boot: unknown, unit: string): ZoneLabelSpec | null {
  const zones = (boot as { zones?: Record<string, unknown> } | null | undefined)?.zones;
  const rows = zones && typeof zones === "object" ? zones[unit] : undefined;
  if (!Array.isArray(rows)) return null;
  const features: Feature<Point>[] = [];
  for (const raw of rows as BootZoneRow[]) {
    if (!raw || typeof raw !== "object") continue;
    const pt = labelPoint(raw.label_pt);
    if (!pt || typeof raw.key !== "string") continue;
    const lon = pt[0] > 180 ? pt[0] - 360 : pt[0];
    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [lon, pt[1]] },
      properties: { key: raw.key, name: typeof raw.name === "string" ? raw.name : raw.key },
    });
  }
  if (!features.length) return null;
  const points: FeatureCollection = { type: "FeatureCollection", features };
  return { points, textProperty: "key" };
}
