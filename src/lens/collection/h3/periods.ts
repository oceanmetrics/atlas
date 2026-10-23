// The period strip of the H3 layer (`atlas:period_strip`, build week 4, step 5; obis-hex's Time strip): one bar per
// period of the layer's period sets (`h3:periods`: decades and years), its height the release's own count of the
// hexagons with records in that period at the strip's resolution, read from stats.parquet (`n_cells` of `n`). The
// release does not carry a records total per period, so the strip counts hexagons, and says so. One read per layer
// (the row groups of the layer's period rows only); pure functions plus that reader, Node-tested
// (tests/obis/periods.test.ts).
import type { H3PeriodSet } from "../../../lib/catalog/h3";
import { periodToken } from "./view";

/** the resolution the strip counts hexagons at (one the period sets publish) */
export const STRIP_RES = 3;

export interface PeriodStatRow {
  layer: string;
  key: string;
  rank: string;
  decade: number | null;
  year: number | null;
  res: number;
  variable: string;
  n_cells: number;
}

export interface PeriodBar {
  grain: string;
  value: string;
  /** the URL token (`dim.period=`): `1990s`, `2015` */
  token: string;
  /** hexagons with records at `STRIP_RES` */
  cells: number;
  /** 0 to 1 of the largest bar of its grain */
  height: number;
}

/** the strip's bars: per set, every value it lists, the count from the rows (0 when none), oldest first. */
export function periodBars(
  rows: readonly PeriodStatRow[],
  sets: readonly H3PeriodSet[],
  item: { layer: string; key?: string; rank?: string },
  res = STRIP_RES,
): PeriodBar[] {
  const out: PeriodBar[] = [];
  for (const set of sets) {
    const layer = `${set.grain}_${item.layer}`;
    const col = set.grain === "decade" ? "decade" : "year";
    const by = new Map<number, number>();
    for (const r of rows) {
      if (r.layer !== layer || r.key !== (item.key ?? "") || r.res !== res || r.variable !== "n")
        continue;
      const v = r[col as "decade" | "year"];
      if (v !== null) by.set(v, r.n_cells);
    }
    const bars = [...set.values]
      .sort((a, b) => Number(a) - Number(b))
      .map((value) => ({
        grain: set.grain,
        value,
        token: periodToken(set.grain, value),
        cells: by.get(Number(value)) ?? 0,
        height: 0,
      }));
    const max = Math.max(1, ...bars.map((b) => b.cells));
    for (const b of bars) b.height = b.cells / max;
    out.push(...bars);
  }
  return out;
}

/** the strip's words when it has nothing to show (obis-hex `stripMessage`) */
export function stripMessage(o: { kind: string; sets: number; label: string }): string | null {
  if (o.sets > 0) return null;
  if (o.kind === "taxon")
    return `Periods: all taxa and the EOVs only. ${o.label} is shown over all years.`;
  return "This layer publishes no periods.";
}

/** k and M for a bar label (obis-hex DecadeBars) */
export function shortCount(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)}k`;
  return String(Math.round(n));
}

/** the step of ←/→ on the strip: the next or previous period of the same grain, or null at an end. */
export function stepPeriod(bars: readonly PeriodBar[], token: string, dir: 1 | -1): string | null {
  const i = bars.findIndex((b) => b.token === token);
  if (i < 0) return null;
  const j = i + dir;
  return j >= 0 && j < bars.length && bars[j].grain === bars[i].grain ? bars[j].token : null;
}

// ---- the reader ---------------------------------------------------------------------------------------------

type Stat = { min_value?: unknown; max_value?: unknown };

/** the period rows of one item (every grain, the strip's resolution, `n`) from stats.parquet: the row groups whose
 * `layer` statistics can hold the item's period layers are read, the rest skipped. */
export async function readPeriodRows(
  url: string | ArrayBuffer,
  sets: readonly H3PeriodSet[],
  item: { layer: string; key?: string },
  res = STRIP_RES,
): Promise<PeriodStatRow[]> {
  if (sets.length === 0) return [];
  const [{ asyncBufferFromUrl, parquetMetadataAsync, parquetReadObjects }, { compressors }] =
    await Promise.all([import("hyparquet"), import("hyparquet-compressors")]);
  const file = typeof url === "string" ? await asyncBufferFromUrl({ url }) : url;
  const meta = await parquetMetadataAsync(file);
  const layers = new Set(sets.map((s) => `${s.grain}_${item.layer}`));
  const names = meta.schema.slice(1).map((s) => s.name);
  const li = names.indexOf("layer");
  const out: PeriodStatRow[] = [];
  let start = 0;
  for (const rg of meta.row_groups) {
    const n = Number(rg.num_rows);
    const st = (li >= 0 ? rg.columns[li]?.meta_data?.statistics : undefined) as Stat | undefined;
    const lo = st?.min_value === undefined ? null : String(st.min_value);
    const hi = st?.max_value === undefined ? null : String(st.max_value);
    const hit = lo === null || hi === null || [...layers].some((l) => l >= lo && l <= hi);
    if (hit) {
      const rows = (await parquetReadObjects({
        file,
        rowStart: start,
        rowEnd: start + n,
        columns: ["layer", "key", "rank", "decade", "year", "res", "variable", "n_cells"].filter(
          (c) => names.includes(c),
        ),
        compressors,
      })) as Record<string, unknown>[];
      for (const r of rows) {
        if (!layers.has(String(r.layer)) || String(r.key ?? "") !== (item.key ?? "")) continue;
        if (Number(r.res) !== res || r.variable !== "n") continue;
        out.push({
          layer: String(r.layer),
          key: String(r.key ?? ""),
          rank: String(r.rank ?? ""),
          decade: r.decade === null || r.decade === undefined ? null : Number(r.decade),
          year: r.year === null || r.year === undefined ? null : Number(r.year),
          res: Number(r.res),
          variable: String(r.variable),
          n_cells: Number(r.n_cells),
        });
      }
    }
    start += n;
  }
  return out;
}
