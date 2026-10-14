// Reading one value column of an item's Parquet `values` asset: `FID` + the item's own column.
//
// The file is ONE wide table (one row per hex FID, one column per group x season x metric); an
// item points at its column through `atlas:value_column`. Only those two columns are read
// (hyparquet reads column chunks by range, so switching items never re-downloads the whole table,
// and the geometry -- the PMTiles grid -- is never refetched). hyparquet and its compressors are
// DYNAMIC imports: scripts/size-budget-core.mjs forbids "hyparquet" in the entry's static graph, so
// this module is safe to import statically for its types and the pure row conversion.
import type { Loaded } from "./load";

export interface ValueColumn {
  /** the join key of every row (hex FID), same order as `values`. */
  fids: number[];
  /** the item's value for that FID; `null` for a missing / non-finite value. */
  values: (number | null)[];
}

/** hyparquet returns BigInt for int64 and may return strings/Date; reduce to a finite number or null. */
function toNumber(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "bigint" ? Number(v) : typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Parquet rows -> parallel `fids`/`values` arrays. A row whose key is not a finite number is dropped
 * (it cannot be joined to a hex); a missing or non-finite value stays in the column as `null` (a
 * cell the model has no value for is "no data", not zero).
 */
export function columnFromRows(
  rows: readonly Record<string, unknown>[],
  keyColumn: string,
  valueColumn: string,
): ValueColumn {
  const fids: number[] = [];
  const values: (number | null)[] = [];
  for (const row of rows) {
    const fid = toNumber(row[keyColumn]);
    if (fid === null) continue;
    fids.push(fid);
    values.push(toNumber(row[valueColumn]));
  }
  return { fids, values };
}

export interface ValuesSpec {
  keyColumn: string;
  valueColumn: string;
}

/**
 * Read `keyColumn` + `valueColumn` of the Parquet at `source` (an absolute URL, read by range; or an
 * in-memory buffer, for tests). Never throws: an unreadable file or a missing column is a `parse`
 * (or `network`) error.
 */
export async function readValueColumn(
  source: string | ArrayBuffer,
  spec: ValuesSpec,
): Promise<Loaded<ValueColumn>> {
  const url = typeof source === "string" ? source : "(buffer)";
  try {
    const [{ asyncBufferFromUrl, parquetReadObjects }, { compressors }] = await Promise.all([
      import("hyparquet"),
      import("hyparquet-compressors"),
    ]);
    const file = typeof source === "string" ? await asyncBufferFromUrl({ url: source }) : source;
    const rows = (await parquetReadObjects({
      file,
      columns: [spec.keyColumn, spec.valueColumn],
      compressors,
    })) as Record<string, unknown>[];
    if (rows.length > 0 && !(spec.valueColumn in rows[0])) {
      return {
        ok: false,
        error: { kind: "schema", url, message: `column "${spec.valueColumn}" is not in the file` },
      };
    }
    return { ok: true, value: columnFromRows(rows, spec.keyColumn, spec.valueColumn) };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    // asyncBufferFromUrl's own failures read "fetch failed ..." / "HTTP error ..."
    // hyparquet names a missing column in its own error ("parquet columns not found: ...")
    const kind =
      /column/i.test(message) && /not found/i.test(message)
        ? "schema"
        : /fetch|http|network/i.test(message)
          ? "network"
          : "parse";
    return { ok: false, error: { kind, url, message } };
  }
}
