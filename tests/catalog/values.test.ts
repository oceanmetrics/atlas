// Reading one value column of the Parquet `values` asset (tests/fixtures/catalog/biotrack_indicators/
// values.parquet: 3 FIDs x the 8 item columns, snappy, one NULL).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { columnFromRows, readValueColumn } from "../../src/lib/catalog/values";

const FILE = join(__dirname, "../fixtures/catalog/biotrack_indicators/values.parquet");
function buffer(): ArrayBuffer {
  const b = readFileSync(FILE);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
}

describe("columnFromRows: parquet rows -> parallel fid/value arrays", () => {
  it("BigInt FIDs become numbers; values stay numbers", () => {
    expect(
      columnFromRows(
        [
          { FID: 1n, v: 0.5 },
          { FID: 2n, v: 1 },
        ],
        "FID",
        "v",
      ),
    ).toEqual({ fids: [1, 2], values: [0.5, 1] });
  });

  it("a missing or non-finite value stays in the column as null (no data is not zero)", () => {
    expect(
      columnFromRows(
        [{ FID: 1, v: null }, { FID: 2 }, { FID: 3, v: Number.NaN }, { FID: 4, v: Infinity }],
        "FID",
        "v",
      ).values,
    ).toEqual([null, null, null, null]);
  });

  it("a row whose key is not a finite number is dropped (it cannot be joined to a hex)", () => {
    const col = columnFromRows(
      [
        { FID: "x", v: 1 },
        { FID: null, v: 2 },
        { FID: 7, v: 3 },
      ],
      "FID",
      "v",
    );
    expect(col).toEqual({ fids: [7], values: [3] });
  });

  it("an empty table is an empty column", () => {
    expect(columnFromRows([], "FID", "v")).toEqual({ fids: [], values: [] });
  });
});

describe("readValueColumn: only the FID and the item's value column", () => {
  it("reads the 3 FIDs and an item's column; the NULL cell is null", async () => {
    const res = await readValueColumn(buffer(), {
      keyColumn: "FID",
      valueColumn: "all_summer_uncertainty",
    });
    expect(res).toEqual({ ok: true, value: { fids: [101, 102, 103], values: [0.2, null, 0.25] } });
  });

  it("each item's column is its own (switching items re-reads a column, nothing else)", async () => {
    const a = await readValueColumn(buffer(), {
      keyColumn: "FID",
      valueColumn: "all_summer_richness",
    });
    const b = await readValueColumn(buffer(), {
      keyColumn: "FID",
      valueColumn: "shark_winter_uncertainty",
    });
    expect(a.ok && a.value.values).toEqual([0.1, 0.2, 0.9]);
    expect(b.ok && b.value.values).toEqual([0.8, 0.85, 0.88]);
  });

  it("a column the file does not have is a schema error naming it", async () => {
    const res = await readValueColumn(buffer(), {
      keyColumn: "FID",
      valueColumn: "no_such_column",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.kind).toBe("schema");
  });

  it("garbage bytes are a parse error, never a throw", async () => {
    const res = await readValueColumn(
      new TextEncoder().encode("not a parquet file").buffer as ArrayBuffer,
      {
        keyColumn: "FID",
        valueColumn: "x",
      },
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.kind).toBe("parse");
  });
});
