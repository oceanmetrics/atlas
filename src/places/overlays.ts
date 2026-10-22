// places/overlays.ts -- the pure model behind the Layers panel's "Place layers" group: gazetteer
// collections from `index/layers.json` as toggleable overlays. Which are listed (every public collection;
// an unlisted one only while a link has it on),
// how they are grouped (by theme, from the manifest's `place_type`), what each draws (colours from
// the collection's published paint), and which credits the ones that are ON contribute.
//
// No map, no network, no runes: overlays.svelte.ts wires this to the URL (`?ov=`) and the manifest.
import { GAZETTEER_COLOR } from "../lib/map/colors";
import { joinCredits } from "../lib/gazetteer/config";
import type { Layer } from "@oceanmetrics/places";
import type { TiledLayer } from "../lib/gazetteer/manifest";
import type { PlaceOverlaySpec } from "../lib/map/types";

export type OverlayKind = PlaceOverlaySpec["kind"];

/** one collection, ready to list: the manifest row trimmed to what the panel and the map use. */
export interface OverlayLayer {
  slug: string;
  /** "title (status_label)" when the collection carries a status (e.g. rescinded planning areas). */
  label: string;
  /** number of features, `null` when the manifest has none. */
  n: number | null;
  kind: OverlayKind;
  placeType: string | null;
  theme: OverlayTheme;
  pmtiles: string;
  sourceLayer: string;
  fillColor: string;
  lineColor: string;
  lineWidth: number;
  attribution: string;
  license: string | null;
  /** false for an `access: "unlisted"` collection: drawn from a link, left out of the list. */
  listed: boolean;
}

// --- themes ---------------------------------------------------------------------------------------

export const OVERLAY_THEMES = [
  "protection",
  "habitat",
  "energy",
  "aquaculture",
  "boundaries",
  "navigation",
  "monitoring",
  "features",
  "other",
] as const;
export type OverlayTheme = (typeof OVERLAY_THEMES)[number];

export const OVERLAY_THEME_LABEL: Record<OverlayTheme, string> = {
  protection: "Protection",
  habitat: "Habitat",
  energy: "Energy",
  aquaculture: "Aquaculture",
  boundaries: "Boundaries",
  navigation: "Navigation and infrastructure",
  monitoring: "Monitoring",
  features: "Features",
  other: "Other",
};

/** the manifest's `place_type` -> theme; an unknown or missing type is "other". */
const THEME_OF_TYPE: Record<string, OverlayTheme> = {
  protected_area: "protection",
  mpa: "protection",
  habitat: "habitat",
  lease: "energy",
  planning_area: "energy",
  aoa: "aquaculture",
  jurisdiction: "boundaries",
  maritime_limit: "boundaries",
  navigation_measure: "navigation",
  restricted_area: "navigation",
  infrastructure: "navigation",
  transect: "monitoring",
  station: "monitoring",
  undersea_feature: "features",
};

export function themeOf(placeType: string | null | undefined): OverlayTheme {
  return (placeType && THEME_OF_TYPE[placeType]) || "other";
}

export function kindOf(geomType: string | null | undefined): OverlayKind {
  const g = (geomType ?? "").toLowerCase();
  if (g.includes("polygon")) return "polygon";
  if (g.includes("line")) return "line";
  if (g.includes("point")) return "point";
  return "polygon";
}

// --- manifest rows -> overlay layers -----------------------------------------------------------------

const asString = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

/** the colour a published paint names, e.g. `paint.line["line-color"]`; `null` when it names none. */
function paintColor(l: Layer, kind: "fill" | "line" | "circle", key: string): string | null {
  return asString((l.paint?.[kind] as Record<string, unknown> | undefined)?.[key]);
}

export function overlayLayerOf(l: TiledLayer): OverlayLayer {
  const kind = kindOf(l.geom_type);
  const lineColor =
    paintColor(l, "line", "line-color") ??
    paintColor(l, "circle", "circle-color") ??
    paintColor(l, "fill", "fill-color") ??
    GAZETTEER_COLOR;
  const fillColor =
    paintColor(l, "fill", "fill-color") ?? paintColor(l, "circle", "circle-color") ?? lineColor;
  const width = Number((l.paint?.line as Record<string, unknown> | undefined)?.["line-width"]);
  const status = (l as { status_label?: string | null }).status_label;
  const title = l.title || l.slug;
  return {
    slug: l.slug,
    label: status ? `${title} (${status})` : title,
    n: typeof l.n === "number" ? l.n : null,
    kind,
    placeType: l.place_type ?? null,
    theme: themeOf(l.place_type),
    pmtiles: l.pmtiles,
    sourceLayer: l.source_layer || l.slug,
    fillColor,
    lineColor,
    lineWidth: Number.isFinite(width) && width > 0 ? width : 1,
    attribution: l.attribution || "",
    license: l.license ?? null,
    // a manifest from before @oceanmetrics/places 0.5.1 has no `access`: public
    listed: l.access !== "unlisted",
  };
}

export function overlayLayersFrom(layers: readonly TiledLayer[]): OverlayLayer[] {
  return layers.map(overlayLayerOf);
}

/** what the list shows: the listed collections, plus an unlisted one while it is ON (a link named it,
 * so its switch must be there to turn it off). Hidden from the list, not from a link. */
export function listedOverlays(
  layers: readonly OverlayLayer[],
  on: readonly string[],
): OverlayLayer[] {
  return layers.filter((l) => l.listed || on.includes(l.slug));
}

export interface OverlayGroup {
  theme: OverlayTheme;
  label: string;
  layers: OverlayLayer[];
}

/**
 * The list the panel shows: layers grouped by theme (themes in {@link OVERLAY_THEMES} order, empty
 * ones left out), alphabetical by label inside each group. When the manifest carries no `place_type`
 * at all, the list is one flat alphabetical group (`theme: "other"` without a heading to show).
 */
export function groupOverlays(layers: readonly OverlayLayer[]): OverlayGroup[] {
  const byLabel = (a: OverlayLayer, b: OverlayLayer) =>
    a.label.localeCompare(b.label, "en", { sensitivity: "base" });
  const hasThemes = layers.some((l) => l.theme !== "other");
  if (!hasThemes) {
    return layers.length ? [{ theme: "other", label: "", layers: [...layers].sort(byLabel) }] : [];
  }
  return OVERLAY_THEMES.map((theme) => ({
    theme,
    label: OVERLAY_THEME_LABEL[theme],
    layers: layers.filter((l) => l.theme === theme).sort(byLabel),
  })).filter((g) => g.layers.length > 0);
}

// --- what the map draws -------------------------------------------------------------------------------

/** the composeStyle inputs for the layers that are ON (and listed): unknown slugs are skipped, order
 * follows `on` (so a link's order is the draw order), duplicates once. */
export function overlaySpecs(
  layers: readonly OverlayLayer[],
  on: readonly string[],
): PlaceOverlaySpec[] {
  const bySlug = new Map(layers.map((l) => [l.slug, l]));
  const out: PlaceOverlaySpec[] = [];
  const seen = new Set<string>();
  for (const slug of on) {
    const l = bySlug.get(slug);
    if (!l || seen.has(slug)) continue;
    seen.add(slug);
    out.push({
      slug: l.slug,
      title: l.label,
      pmtiles: l.pmtiles,
      sourceLayer: l.sourceLayer,
      kind: l.kind,
      fillColor: l.fillColor,
      lineColor: l.lineColor,
      lineWidth: l.lineWidth,
      attribution: l.attribution,
    });
  }
  return out;
}

// --- credits ------------------------------------------------------------------------------------------

export interface OverlayCredit {
  slug: string;
  title: string;
  /** the collection's attribution line, as the manifest publishes it. */
  attribution: string;
  license: string | null;
}

/** one credit per overlay that is ON (listed, with an attribution), in `on` order. */
export function overlayCreditsFor(
  layers: readonly OverlayLayer[],
  on: readonly string[],
): OverlayCredit[] {
  return overlaySpecs(layers, on)
    .map((s) => ({ s, l: layers.find((x) => x.slug === s.slug)! }))
    .filter(({ l }) => l.attribution)
    .map(({ s, l }) => ({
      slug: s.slug,
      title: s.title,
      attribution: l.attribution,
      license: l.license,
    }));
}

/** the map-attribution line of the overlays that are ON: deduplicated, "Processed by Ocean Metrics."
 * said once (`joinCredits`). "" when none. */
export function overlayCreditLine(credits: readonly OverlayCredit[]): string {
  return joinCredits(credits.map((c) => c.attribution));
}

// --- the swatch ----------------------------------------------------------------------------------------

/** the colour a list row's swatch shows (the line colour: what is always drawn, whatever the kind). */
export function swatchColor(l: Pick<OverlayLayer, "lineColor" | "fillColor">): string {
  return l.lineColor || l.fillColor;
}
