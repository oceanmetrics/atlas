// places/summary.ts -- summarise the CURRENT item over each place: which hex cells have their
// centroid inside the place (lib/geo/pip.ts over the `hex_centroids` table), then n cells, mean,
// min, max of the item's value there, plus the share of those cells with no value.
//
// Pure and Node-testable: no map, no network, no runes. The reactive wiring is summaryStore.svelte.ts;
// the Parquet reads are lib/catalog/{values,centroids}.ts.
//
// What the numbers mean (said in the UI too): cells are COUNTED by centroid, not clipped, so a
// place's edge cells count whole or not at all; a cell the item has no value for is "no value"
// (never zero) and is left out of mean/min/max but counted in n and in the no-value share.
import type { Centroids } from "../lib/catalog/centroids";
import type { ValueColumn } from "../lib/catalog/values";
import { pointInArea, prepareArea, type PreparedArea } from "../lib/geo/pip";
import { bboxOf, geometryArea, polygonsOf, type AreaGeometry } from "../lib/geo/types";
import { toCsv, type CsvColumn } from "../lib/download/csv";
import { formatCollectionValue } from "../lens/collection/mapInputs";

export interface CellStats {
  /** cells whose centroid is inside the place. */
  n: number;
  /** of those, cells with a finite value. */
  nValue: number;
  /** share of the n cells with no value, 0..1; `null` when n is 0. */
  noValueShare: number | null;
  mean: number | null;
  min: number | null;
  max: number | null;
}

export const EMPTY_STATS: CellStats = {
  n: 0,
  nValue: 0,
  noValueShare: null,
  mean: null,
  min: null,
  max: null,
};

/** n / mean / min / max / no-value share of a list of cell values (`null`/`undefined`/NaN = no value). */
export function cellStats(values: Iterable<number | null | undefined>): CellStats {
  let n = 0;
  let nValue = 0;
  let sum = 0;
  let min = Infinity;
  let max = -Infinity;
  for (const v of values) {
    n++;
    if (typeof v !== "number" || !Number.isFinite(v)) continue;
    nValue++;
    sum += v;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (n === 0) return EMPTY_STATS;
  return {
    n,
    nValue,
    noValueShare: (n - nValue) / n,
    mean: nValue ? sum / nValue : null,
    min: nValue ? min : null,
    max: nValue ? max : null,
  };
}

/** the FIDs whose centroid lies inside the area (grid order). */
export function fidsInside(centroids: Centroids, area: PreparedArea): number[] {
  const out: number[] = [];
  for (let i = 0; i < centroids.fids.length; i++) {
    if (pointInArea(area, centroids.lon[i], centroids.lat[i])) out.push(centroids.fids[i]);
  }
  return out;
}

/** FID -> value of a value column, for lookups by cell. */
export function valueIndexOf(column: ValueColumn | null): Map<number, number | null> {
  const m = new Map<number, number | null>();
  if (column) column.fids.forEach((f, i) => m.set(f, column.values[i]));
  return m;
}

export interface PlaceCellSummary {
  fids: number[];
  stats: CellStats;
}

/** the cells of `geometry` and the stats of `valueOf` over them. A cell absent from the value column
 * is "no value". */
export function summarizePlace(
  centroids: Centroids,
  geometry: AreaGeometry,
  valueOf: (fid: number) => number | null | undefined,
): PlaceCellSummary {
  const fids = fidsInside(centroids, prepareArea(geometry));
  return { fids, stats: cellStats(fids.map(valueOf)) };
}

/** the union of the cells inside any of `geometries` (for the "only inside places" filter). */
export function fidsInsideAny(
  centroids: Centroids,
  geometries: readonly AreaGeometry[],
): Set<number> {
  const areas = geometries.map(prepareArea);
  const out = new Set<number>();
  for (let i = 0; i < centroids.fids.length; i++) {
    const lon = centroids.lon[i];
    const lat = centroids.lat[i];
    if (areas.some((a) => pointInArea(a, lon, lat))) out.add(centroids.fids[i]);
  }
  return out;
}

// --- table rows + CSV ---------------------------------------------------------------------------

/** one row of the places summary (the Places pane list, the Table tool, the CSV). */
export interface SummaryRow {
  /** the place's position in the list. */
  index: number;
  name: string;
  /** `cells` for hex items (centroid in place), `pixels` for rasters (titiler display grid). */
  unit: "cells" | "pixels";
  n: number | null;
  mean: number | null;
  min: number | null;
  max: number | null;
  /** 0..1, or `null` when unknown / n = 0. */
  noValueShare: number | null;
  /** `loading` while computing, `error` with a message, `ok` otherwise. */
  status: "ok" | "loading" | "error";
  message?: string;
}

export function summaryRowOf(
  index: number,
  name: string,
  stats: CellStats | null,
  unit: SummaryRow["unit"] = "cells",
): SummaryRow {
  return {
    index,
    name,
    unit,
    n: stats ? stats.n : null,
    mean: stats?.mean ?? null,
    min: stats?.min ?? null,
    max: stats?.max ?? null,
    noValueShare: stats?.noValueShare ?? null,
    status: stats ? "ok" : "loading",
  };
}

export const SUMMARY_CSV_COLUMNS: readonly CsvColumn<SummaryRow>[] = [
  { key: "place", value: (r) => r.name },
  { key: "unit", value: (r) => r.unit },
  { key: "n", value: (r) => r.n },
  { key: "mean", value: (r) => r.mean },
  { key: "min", value: (r) => r.min },
  { key: "max", value: (r) => r.max },
  { key: "share_no_value", value: (r) => r.noValueShare },
];

/** the CSV of a summary: RAW numbers (never the display strings), one row per place, each stamped
 * with the item it summarises so a file stands on its own. */
export function summaryCsv(rows: readonly SummaryRow[], item = ""): string {
  return toCsv(rows, [{ key: "item", value: () => item }, ...SUMMARY_CSV_COLUMNS]);
}

// --- rows for a list of places ------------------------------------------------------------------

/** what the summary knows about one place of the list. */
export type PlaceInput =
  | { name: string; state: "ready"; geometry: AreaGeometry }
  /** a gazetteer place whose geometry is still being fetched. */
  | { name: string; state: "loading" }
  /** a place with no geometry in this session (an upload; a legacy zone place) or whose fetch failed. */
  | { name: string; state: "none"; reason: string };

/** a cache key for a geometry that survives re-decoding the same place (bbox, area, vertex count). */
export function geometryKey(g: AreaGeometry): string {
  let n = 0;
  for (const rings of polygonsOf(g)) for (const r of rings) n += r.length;
  return `${bboxOf(g).join(",")}|${geometryArea(g).toPrecision(12)}|${n}`;
}

/** one row per place, index-aligned with the list. `statsOf` gives a ready place's stats (or `null`
 * while they are still being computed/fetched). */
export function summaryRows(
  places: readonly PlaceInput[],
  statsOf: (p: Extract<PlaceInput, { state: "ready" }>, index: number) => CellStats | null,
  unit: SummaryRow["unit"] = "cells",
): SummaryRow[] {
  return places.map((p, index) => {
    if (p.state === "ready") return summaryRowOf(index, p.name, statsOf(p, index), unit);
    const row = summaryRowOf(index, p.name, null, unit);
    return p.state === "none" ? { ...row, status: "error", message: p.reason } : row;
  });
}

// --- display ------------------------------------------------------------------------------------

/** "12%" for a share, "<1%" for a share that rounds to 0 but is not 0. */
export function formatShare(share: number | null): string {
  if (share === null) return "";
  const pct = share * 100;
  if (pct > 0 && pct < 1) return "<1%";
  return `${Math.round(pct)}%`;
}

const plural = (n: number, unit: SummaryRow["unit"]) =>
  `${n.toLocaleString("en-US")} ${unit === "cells" ? (n === 1 ? "cell" : "cells") : n === 1 ? "pixel" : "pixels"}`;

/**
 * The one-line summary of a place under its row: "412 cells · mean 0.42 · min 0.1 · max 0.9", plus
 * "· 5% no value" when some cells have none; "no cells inside" for an empty place; the status words
 * while it is still being worked out or when it cannot be.
 */
export function summaryLine(row: SummaryRow): string {
  if (row.status === "loading") return "Summarising…";
  if (row.status === "error") return row.message ? `No summary: ${row.message}.` : "No summary.";
  const n = row.n ?? 0;
  if (n === 0)
    return row.unit === "cells" ? "No cells inside this place." : "No pixels inside this place.";
  const parts = [plural(n, row.unit)];
  if (row.mean === null) parts.push("no values");
  else {
    parts.push(`mean ${formatCollectionValue(row.mean)}`);
    if (row.min !== null) parts.push(`min ${formatCollectionValue(row.min)}`);
    if (row.max !== null) parts.push(`max ${formatCollectionValue(row.max)}`);
  }
  if (row.noValueShare !== null && row.noValueShare > 0 && row.mean !== null) {
    parts.push(`${formatShare(row.noValueShare)} no value`);
  }
  return parts.join(" · ");
}
