// download/csv.ts -- the ONE CSV writer: RFC 4180 quoting, the RAW value a column reports (never its
// formatted display string), `\r\n` line endings -- so every CSV this app produces reads the same
// way and names itself `{stem}_{YYYY-MM-DD}.csv`. Pure builders (Node-testable) plus one
// browser-only side effect (`downloadCsv`, an anchor click).

/** the minimal shape `toCsv` needs from a `DataTable` column -- `label`/`format`/`numeric`/
 * `sortable` (DataTableColumn's other fields) are simply ignored, so a panel's existing column
 * array can be passed straight through with no second, parallel column list to keep in sync. */
export interface CsvColumn<T> {
  key: string;
  value: (row: T) => unknown;
}

function csvField(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** header + one row per record, the RAW (unformatted) value of each column -- pure, so this half
 * is testable without a DOM. */
export function toCsv<T>(rows: readonly T[], columns: readonly CsvColumn<T>[]): string {
  const header = columns.map((c) => csvField(c.key)).join(",");
  const lines = rows.map((r) => columns.map((c) => csvField(c.value(r))).join(","));
  return [header, ...lines].join("\r\n") + "\r\n";
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** a filesystem-safe filename stem from free text (a place's own name) -- lowercase, non-alphanumeric
 * runs collapsed to one `-`, no leading/trailing `-`; `"place"` for a name that yields nothing
 * (blank, or entirely punctuation/emoji). */
export function slugStem(name: string, fallback = "place"): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || fallback;
}

/** `"{stem}_{YYYY-MM-DD}.csv"`. */
export function csvFilename(stem: string, now: Date = new Date()): string {
  return `${stem}_${isoDate(now)}.csv`;
}

/** browser-only side effect (an anchor click) -- the SAME pattern `places/download.ts#
 * downloadGeoJson` uses, kept separate from the pure builders above so they stay Node-testable. */
export function downloadCsv(csv: string, stem: string, now: Date = new Date()): void {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = csvFilename(stem, now);
    a.click();
  } finally {
    URL.revokeObjectURL(url);
  }
}
