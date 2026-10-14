import { describe, expect, it } from "vitest";
import { csvFilename, slugStem, toCsv } from "../../src/lib/download/csv";

// the pure half of the CSV writer (`toCsv`, `slugStem`, `csvFilename`); the anchor-click download
// itself is browser-only.
describe("toCsv", () => {
  interface Row {
    name: string;
    score: number;
  }
  const columns = [
    { key: "name", value: (r: Row) => r.name },
    { key: "score", value: (r: Row) => r.score },
  ];

  it("header + one row per record, RAW values (never a formatted display string)", () => {
    const rows: Row[] = [
      { name: "gull", score: 27.842 },
      { name: "cod", score: 12 },
    ];
    expect(toCsv(rows, columns)).toBe("name,score\r\ngull,27.842\r\ncod,12\r\n");
  });

  it("quotes a field containing a comma, a quote, or a newline (RFC 4180), doubling embedded quotes", () => {
    const rows = [{ name: 'Gulf "of" America, allegedly', score: 1 }];
    expect(toCsv(rows, columns)).toBe('name,score\r\n"Gulf ""of"" America, allegedly",1\r\n');
  });

  it("null/undefined values become an empty field, not the literal string 'null'", () => {
    const rows = [{ name: "x", score: Number.NaN }];
    const cols = [
      { key: "name", value: () => null },
      { key: "score", value: () => undefined },
    ];
    expect(toCsv(rows, cols)).toBe("name,score\r\n,\r\n");
  });

  it("an empty row set is still the header line alone", () => {
    expect(toCsv([], columns)).toBe("name,score\r\n");
  });
});

describe("slugStem", () => {
  it("lowercases and hyphenates a normal place name", () => {
    expect(slugStem("My Draw 1")).toBe("my-draw-1");
  });

  it("collapses a run of non-alphanumeric characters to one hyphen, trims leading/trailing ones", () => {
    expect(slugStem("  Gulf of America / Study Box!!  ")).toBe("gulf-of-america-study-box");
  });

  it("falls back to the default for a name that yields nothing at all", () => {
    expect(slugStem("")).toBe("place");
    expect(slugStem("   ")).toBe("place");
    expect(slugStem("★★★")).toBe("place");
  });

  it("a caller-chosen fallback is honoured", () => {
    expect(slugStem("", "species")).toBe("species");
  });
});

describe("csvFilename", () => {
  it("stem_YYYY-MM-DD.csv", () => {
    expect(csvFilename("model-inputs", new Date("2026-09-22T12:00:00Z"))).toBe(
      "model-inputs_2026-09-22.csv",
    );
  });
});
