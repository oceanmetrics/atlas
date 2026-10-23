// The H3 layer's paint, legend and words (build week 4, step 5): pure functions of the release's own legend rows
// (stats.parquet, `StatsRow`: p02, p98, min, max, n_cells per resolution and indicator), never of the cells
// loaded for the view. Node-tested (tests/obis/legend.test.ts, coverage.test.ts).
//
// - The colours are viridis over [p02, p98] of the layer, period, resolution and indicator (`releaseDomains`).
// - Records (`n`) span five orders of magnitude (1 to 6.9 million at res 2), so a linear ramp paints almost every
//   hexagon the bottom colour: `n` is drawn on a log scale (`ln n` over [ln p02, ln p98]) and its legend says so.
// - A cell without the indicator (ES(50) under 50 records) is not drawn: the slot's filter is `['has', indicator]`.
import {
  interpolateColors,
  pickRes,
  rampStops,
  releaseDomains,
  releaseMaxzoom,
  type H3ReleaseLayer,
  type StatsRow,
} from "@oceanmetrics/map";
import type { ExpressionSpecification } from "maplibre-gl";
import type { LegendStop } from "../../../lib/raster/ramps";
import { commonName } from "./taxa";

export const H3_RAMP = "viridis";
/** the stops of the fill ramp (and the legend's gradient) */
export const RAMP_STOPS = 9;
/** the indicators drawn on a log scale */
export const LOG_INDICATORS: ReadonlySet<string> = new Set(["n"]);

export const scaleOf = (indicator: string): "log" | "linear" =>
  LOG_INDICATORS.has(indicator) ? "log" : "linear";

/** the domain of one resolution, from the legend rows: [p02, p98], or [min, max] when they meet. A log domain
 * starts at 1 (a count). null when no row has a value at that resolution. */
export function domainAt(
  rows: readonly StatsRow[] | null,
  indicator: string,
  res: number,
): [number, number] | null {
  const d = releaseDomains(rows ?? [], indicator).get(res) ?? null;
  if (!d) return null;
  return scaleOf(indicator) === "log" ? [Math.max(1, d[0]), Math.max(1, d[1])] : d;
}

/** the value expression the ramp is applied to: the column, or its natural log for a log indicator. */
function valueExpr(indicator: string): ExpressionSpecification {
  return scaleOf(indicator) === "log"
    ? ["ln", ["max", ["to-number", ["get", indicator]], 1]]
    : ["to-number", ["get", indicator]];
}

const toScale = (indicator: string, d: [number, number]): [number, number] =>
  scaleOf(indicator) === "log" ? [Math.log(d[0]), Math.log(d[1])] : d;

/** the ramp over one domain (a log indicator on ln) */
export function rampOn(indicator: string, d: [number, number]): ExpressionSpecification {
  const [lo, hi] = toScale(indicator, d);
  return [
    "interpolate",
    ["linear"],
    valueExpr(indicator),
    ...(rampStops(lo, hi > lo ? hi : lo + 1e-9, H3_RAMP, RAMP_STOPS) as (number | string)[]),
  ] as ExpressionSpecification;
}

/**
 * The fill colour of the layer: the ramp over the domain of the resolution a tile draws. Pinned (or one resolution
 * in reach), one ramp; auto, a step on the zoom at each zoom where the resolution changes (the map package's
 * `releaseFillColor` rule, with the log scale for records). A resolution without a domain takes the nearest one
 * that has one; none at all gives [0, 1] (or [1, 10] on a log scale) until the legend rows arrive.
 */
export function h3FillColor(
  l: H3ReleaseLayer,
  indicator: string,
  rows: readonly StatsRow[] | null,
): ExpressionSpecification {
  const fallback: [number, number] = scaleOf(indicator) === "log" ? [1, 10] : [0, 1];
  const all = new Map<number, [number, number]>();
  for (const r of new Set([...l.ladder, ...(l.pin === null ? [] : [l.pin])])) {
    const d = domainAt(rows, indicator, r);
    if (d) all.set(r, d);
  }
  const domainOf = (res: number): [number, number] => {
    if (all.has(res)) return all.get(res)!;
    const near = [...all.keys()].sort((a, b) => Math.abs(a - res) - Math.abs(b - res) || a - b)[0];
    return near === undefined ? fallback : all.get(near)!;
  };
  const maxzoom = releaseMaxzoom(l);
  const steps: [number, number][] = [];
  for (let z = 0; z <= maxzoom; z++) {
    const r = pickRes(z, l.ladder, l.pin);
    if (!steps.length || steps[steps.length - 1][1] !== r) steps.push([z, r]);
  }
  if (steps.length === 1) return rampOn(indicator, domainOf(steps[0][1]));
  const out: unknown[] = ["step", ["zoom"], rampOn(indicator, domainOf(steps[0][1]))];
  for (const [z, r] of steps.slice(1)) out.push(z, rampOn(indicator, domainOf(r)));
  return out as ExpressionSpecification;
}

/** the resolution the map draws at `zoom` (the tile zoom MapLibre asks: floor of the view zoom, capped at the
 * source maxzoom; past it the last resolution, overzoomed). */
export const resAtZoom = (l: H3ReleaseLayer, zoom: number) =>
  pickRes(Math.min(Math.max(0, zoom), releaseMaxzoom(l)), l.ladder, l.pin);

/** the legend's stops at one resolution: `RAMP_STOPS` values evenly spaced on the drawn scale (geometric for a
 * log indicator), coloured as the map is. */
export function legendStops(domain: [number, number], indicator: string): LegendStop[] {
  const colors = interpolateColors(RAMP_STOPS, H3_RAMP);
  const [lo, hi] = toScale(indicator, domain);
  return colors.map((color, i) => {
    const t = lo + ((hi - lo) * i) / (colors.length - 1);
    return { value: scaleOf(indicator) === "log" ? Math.exp(t) : t, color };
  });
}

// ---- words ---------------------------------------------------------------------------------------------------

/** the average area of an H3 cell, km², res 0 to 15 (h3 `getHexagonAreaAvg(res, "km2")`, so h3-js stays out of
 * the bundle) */
export const HEX_AREA_KM2 = [
  4357449.416078383, 609788.4417941332, 86801.7803989972, 12393.43465508816, 1770.347654491307,
  252.9038581819449, 36.12906216441245, 5.161293359717191, 0.7373275975944177, 0.1053325134272067,
  0.01504750190766435, 0.002149643129451879, 0.000307091875631606, 0.00004387026794728296,
  0.000006267181135324313, 8.95311590760579e-7,
];

/** "~12,400 km²": three significant digits from 1,000 km², whole km² below (obis-hex `hexAreaLabel`) */
export function hexAreaLabel(res: number): string {
  const a = HEX_AREA_KM2[res] ?? NaN;
  if (!Number.isFinite(a)) return "";
  const r = a >= 1000 ? Number(a.toPrecision(3)) : Math.max(1, Math.round(a));
  return `~${r.toLocaleString("en-US")} km²`;
}

/** the footer note of the resolution: "res 3 (auto)" or "res 3 (fixed)" */
export const resNote = (res: number, auto: boolean) => `res ${res} (${auto ? "auto" : "fixed"})`;

const fmt = (n: number) => Math.round(n).toLocaleString("en-US");

/**
 * The coverage line (`atlas:coverage`, obis-hex `coverageText`), from the legend rows of the drawn resolution:
 * for ES(50), how many hexagons have a value (n ≥ 50) of how many have records: "9,196 of 26,361 hexagons have
 * ≥ 50 records"; for another indicator "x of y hexagons have a value" when some lack it, else "N hexagons". Of the
 * whole layer (the release's count), not of the view. "" before the rows arrive.
 */
export function coverageText(
  rows: readonly StatsRow[] | null,
  indicator: string,
  res: number,
  esn = 50,
): string {
  if (!rows) return "";
  const cellsOf = (v: string) =>
    rows.find((r) => r.res === res && r.variable === v)?.n_cells ?? null;
  const cells = cellsOf("n");
  const valued = cellsOf(indicator);
  if (cells === null || valued === null) return "";
  if (indicator === "es") return `${fmt(valued)} of ${fmt(cells)} hexagons have ≥ ${esn} records`;
  if (valued !== cells) return `${fmt(valued)} of ${fmt(cells)} hexagons have a value`;
  return `${fmt(cells)} hexagons`;
}

/** the legend's second line: the period, which domain it is, the resolution, and the scale
 * ("All years · release p02–p98 · res 3 (auto) · log scale"). */
export function legendSubtitle(o: {
  period: string;
  res: number;
  auto: boolean;
  indicator: string;
  /** the loaded hexagons' p02 to p98 (`dom=view`) instead of the release's */
  domain?: "release" | "view";
}): string {
  const dom = o.domain === "view" ? "loaded hexagons p02–p98" : "release p02–p98";
  return `${o.period} · ${dom} · ${resNote(o.res, o.auto)}${scaleOf(o.indicator) === "log" ? " · log scale" : ""}`;
}

// ---- the title sentence ----------------------------------------------------------------------------------------

/** one chip of the title sentence: the bold, clickable words, the plain qualifier after them, and the control the chip
 * opens (the same field as in the panel). */
export interface SentencePart {
  label: string;
  qual: string;
  control: "taxon" | "period" | "place" | "scale" | "indicator";
}
export type SentenceParts = Record<SentencePart["control"], SentencePart>;

const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

/** the taxon chip (obis-hex `taxonPart`): "All taxa"; an EOV's title + "(EOV)"; a taxon layer by its common name
 * first ("Birds" (class Aves)), else its name and rank. */
export function taxonPart(o: {
  label: string;
  kind: string;
  rank?: string;
  taxon?: string;
}): SentencePart {
  if (o.kind === "taxon") {
    const name = o.taxon || o.label;
    const cn = commonName(name);
    const rank = o.rank ?? "taxon";
    return cn
      ? { label: cap(cn), qual: `(${rank} ${name})`, control: "taxon" }
      : { label: name, qual: `(${rank})`, control: "taxon" };
  }
  if (o.kind === "eov") return { label: o.label, qual: "(EOV)", control: "taxon" };
  return { label: o.label, qual: "", control: "taxon" };
}

/** the place chip: "worldwide" when the drawn resolution is one whole file per layer, "in view" when the map reads
 * the files of the parents under its tiles (a split resolution, `h3:layout.parent_res`); a place filter's words
 * replace both. */
export function placePart(split: { parentRes: number } | null): SentencePart {
  return split
    ? {
        label: "in view",
        qual: `(the res-${split.parentRes} parent files under the map)`,
        control: "place",
      }
    : { label: "worldwide", qual: "", control: "place" };
}

/** the place filter's words (obis-hex `withinPart`): "in Channel Islands" (one place), "in 3 places" */
export function withinPart(names: readonly string[]): SentencePart {
  return names.length === 1
    ? { label: `in ${names[0]}`, qual: "(statistics of its hexagons)", control: "place" }
    : {
        label: `in ${names.length.toLocaleString("en-US")} places`,
        qual: "(statistics of their hexagons)",
        control: "place",
      };
}

/** the coverage line of a filtered view, counted over the filter's own loaded hexagons (the release's counts are
 * worldwide): "124 of 138 hexagons in the place have ≥ 50 records", or in a collection "in NOAA National Marine
 * Sanctuaries"; `valued` of `n` hexagons carry the indicator */
export function filteredCoverage(o: {
  indicator: string;
  valued: number;
  n: number;
  esn: number;
  /** "the place" (the default) or the collection's title */
  where?: string;
}): string {
  const fmt = (x: number) => x.toLocaleString("en-US");
  const where = o.where ?? "the place";
  return o.indicator === "es"
    ? `${fmt(o.valued)} of ${fmt(o.n)} hexagons in ${where} have ≥ ${o.esn} records`
    : `${fmt(o.n)} hexagons in ${where}`;
}

/** the five chips (obis-hex `sentenceParts`): taxon, period, place, hexagon size, indicator. */
export function sentenceParts(o: {
  label: string;
  kind: string;
  rank?: string;
  taxon?: string;
  period: string;
  res: number;
  indicator: string;
  indicatorLabel: string;
  place?: SentencePart | null;
}): SentenceParts {
  return {
    taxon: taxonPart(o),
    period: {
      label: o.period.toLowerCase() === "all years" ? "all years" : o.period,
      qual: "",
      control: "period",
    },
    place: o.place ?? placePart(null),
    scale: { label: `${hexAreaLabel(o.res)} hexagons`, qual: "", control: "scale" },
    indicator: { label: shortLabel(o.indicator, o.indicatorLabel), qual: "", control: "indicator" },
  };
}

const joinPart = (p: SentencePart) => (p.qual ? `${p.label} ${p.qual}` : p.label);

/** the title sentence as text (obis-hex `sentenceText`): "Seabirds (class Aves) (EOV), 1990s, worldwide, ~12,400 km²
 * hexagons: ES(50)". The release snapshot and the resolution are the legend's and the footer's, not the sentence's. */
export function sentenceText(o: Parameters<typeof sentenceParts>[0] | SentenceParts): string {
  const s =
    "taxon" in o && typeof o.taxon === "object"
      ? (o as SentenceParts)
      : sentenceParts(o as Parameters<typeof sentenceParts>[0]);
  return `${joinPart(s.taxon)}, ${joinPart(s.period)}, ${joinPart(s.place)}, ${joinPart(s.scale)}: ${joinPart(s.indicator)}`;
}

/** the layer's status line (obis-hex `message`, `noDataReason`, `loadError`): what the map is waiting for, or why it
 * shows nothing. null when the hexagons are drawn. */
export function statusLine(o: {
  /** the h3 module failed to join MapLibre's worker, or the legend rows failed */
  error?: string | null;
  /** the worker or the legend rows are not there yet */
  loading: boolean;
  /** hexagons drawn in the loaded tiles once the map is idle; null before the first count */
  cells: number | null;
  label: string;
  /** the period token when one is chosen ("1990s", "2015"), else null */
  period: string | null;
  /** a place filter is on (true), or a collection filter: the collection's title */
  filtered?: boolean | string;
}): string | null {
  if (o.error) return `The release could not be read: ${o.error}`;
  if (o.loading) return "Loading the release…";
  if (o.cells === null || o.cells > 0) return null;
  const where =
    typeof o.filtered === "string"
      ? `in ${o.filtered}`
      : o.filtered
        ? "in the place"
        : "in this view";
  return o.period
    ? `No OBIS records for ${o.label} in the ${o.period} ${where}.`
    : `No hexagons ${where}.`;
}

/** the hover's text: the hexagon's id and all five indicators, the chosen one first. */
export function hoverLines(
  h3: string,
  props: Record<string, unknown>,
  indicators: readonly { value: string; label: string }[],
  chosen: string,
): string[] {
  const order = [...indicators].sort((a, b) => +(b.value === chosen) - +(a.value === chosen));
  return [
    `Hexagon ${h3}`,
    ...order.map(
      (i) =>
        `${i.value === chosen ? "▸ " : ""}${shortLabel(i.value, i.label)}: ${formatIndicator(i.value, props[i.value])}`,
    ),
  ];
}

/** the short names of the five (obis-hex `INDICATORS.short`) */
const SHORT: Record<string, string> = {
  es: "ES(50)",
  sp: "Species",
  shannon: "Shannon H′",
  simpson: "Simpson Σp²",
  n: "Records",
};
export const shortLabel = (value: string, label: string) => SHORT[value] ?? label;

/** an indicator's value as text: counts whole with separators, indices to 2 decimals (simpson 3), "–" for none */
export function formatIndicator(indicator: string, v: unknown): string {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  if (!Number.isFinite(n)) return "–";
  if (indicator === "n" || indicator === "sp") return fmt(n);
  if (indicator === "simpson") return n.toFixed(3);
  return n.toFixed(2);
}
