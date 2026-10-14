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
import type { AreaGeometry } from "../lib/geo/types";
import { toCsv, type CsvColumn } from "../lib/download/csv";

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
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- a plain lookup, never read by a template
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
export function fidsInsideAny(centroids: Centroids, geometries: readonly AreaGeometry[]): Set<number> {
  const areas = geometries.map(prepareArea);
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- a plain set handed to the painter
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
