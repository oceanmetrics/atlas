// The OBIS layer's words (build week 4, step 5): the coverage line (`atlas:coverage`), the hexagon area, the
// resolution note, the title sentence, the hover (src/lens/collection/h3/paint.ts).
import { describe, expect, it } from "vitest";
import { readReleaseStats } from "@oceanmetrics/map";
import {
  coverageText,
  formatIndicator,
  hexAreaLabel,
  hoverLines,
  placePart,
  resNote,
  sentenceParts,
  sentenceText,
  statusLine,
  filteredCoverage,
  withinPart,
} from "../../src/lens/collection/h3/paint";
import { localFetch, REL, spec } from "./support";

describe("the coverage line", () => {
  it("the coverage line words, from the release's counts at the drawn resolution", async () => {
    const rows = await readReleaseStats(
      `${REL}stats.parquet`,
      { layer: "all", key: "", rank: "", period: null },
      { fetch: localFetch() },
    );
    const es = rows.find((r) => r.res === 3 && r.variable === "es")!.n_cells;
    const n = rows.find((r) => r.res === 3 && r.variable === "n")!.n_cells;
    expect(coverageText(rows, "es", 3)).toBe(
      `${es.toLocaleString("en-US")} of ${n.toLocaleString("en-US")} hexagons have ≥ 50 records`,
    );
    expect(coverageText(rows, "es", 1)).toBe("830 of 842 hexagons have ≥ 50 records");
    expect(coverageText(rows, "sp", 1)).toBe("842 hexagons");
    expect(coverageText(null, "es", 1)).toBe("");
    expect(coverageText(rows, "es", 12)).toBe("");
  });
  it("x of y have a value when some lack it", () => {
    const rows = [
      { res: 2, variable: "n", n_cells: 10, min: 0, p02: 0, p50: 0, p98: 0, max: 0 },
      { res: 2, variable: "shannon", n_cells: 7, min: 0, p02: 0, p50: 0, p98: 0, max: 0 },
    ];
    expect(coverageText(rows, "shannon", 2)).toBe("7 of 10 hexagons have a value");
  });
});

describe("hex area words and res note", () => {
  it("three significant digits from 1,000 km², whole km² below", () => {
    expect(hexAreaLabel(1)).toBe("~610,000 km²");
    expect(hexAreaLabel(3)).toBe("~12,400 km²");
    expect(hexAreaLabel(5)).toBe("~253 km²");
    expect(hexAreaLabel(7)).toBe("~5 km²");
    expect(hexAreaLabel(20)).toBe("");
  });
  it("res 3 (auto) or (fixed)", () => {
    expect(resNote(3, true)).toBe("res 3 (auto)");
    expect(resNote(4, false)).toBe("res 4 (fixed)");
  });
});

describe("the title sentence", () => {
  const base = { res: 3, indicator: "es", indicatorLabel: "ES(50)…" };
  it("sentence parts for all, eov, taxon: the common name first, its rank and name after", () => {
    expect(sentenceText({ ...base, label: "All taxa", kind: "all", period: "All years" })).toBe(
      "All taxa, all years, worldwide, ~12,400 km² hexagons: ES(50)",
    );
    expect(
      sentenceText({ ...base, label: "Seabirds (class Aves)", kind: "eov", period: "1990s" }),
    ).toBe("Seabirds (class Aves) (EOV), 1990s, worldwide, ~12,400 km² hexagons: ES(50)");
    expect(
      sentenceText({
        ...base,
        label: "Aves",
        kind: "taxon",
        rank: "class",
        taxon: "Aves",
        period: "All years",
        indicator: "n",
      }),
    ).toBe("Birds (class Aves), all years, worldwide, ~12,400 km² hexagons: Records");
    expect(
      sentenceText({
        ...base,
        label: "Nudibranchia",
        kind: "taxon",
        rank: "order",
        taxon: "Nudibranchia",
        period: "All years",
      }),
    ).toBe("Nudibranchia (order), all years, worldwide, ~12,400 km² hexagons: ES(50)");
  });
  it("the five chips, each naming the control it opens", () => {
    const p = sentenceParts({ ...base, label: "Fish", kind: "eov", period: "2015" });
    expect(Object.values(p).map((c) => [c.control, c.label, c.qual])).toEqual([
      ["taxon", "Fish", "(EOV)"],
      ["period", "2015", ""],
      ["place", "worldwide", ""],
      ["scale", "~12,400 km² hexagons", ""],
      ["indicator", "ES(50)", ""],
    ]);
  });
  it("worldwide and in view words: a split resolution reads the parents under the map", () => {
    expect(placePart(null)).toEqual({ label: "worldwide", qual: "", control: "place" });
    expect(placePart({ parentRes: 3 })).toEqual({
      label: "in view",
      qual: "(the res-3 parent files under the map)",
      control: "place",
    });
    expect(
      sentenceText({
        ...base,
        res: 7,
        label: "All taxa",
        kind: "all",
        period: "All years",
        place: placePart({ parentRes: 3 }),
      }),
    ).toBe(
      "All taxa, all years, in view (the res-3 parent files under the map), ~5 km² hexagons: ES(50)",
    );
  });
  it("the place filter's label: statistics of the hexagons, one place or how many", () => {
    expect(withinPart(["Channel Islands"])).toEqual({
      label: "in Channel Islands",
      qual: "(statistics of its hexagons)",
      control: "place",
    });
    expect(withinPart(["A", "B", "C"]).label).toBe("in 3 places");
    expect(withinPart(["A", "B"]).qual).toBe("(statistics of their hexagons)");
  });
});

describe("the coverage line of a filter", () => {
  it("the place's, and a collection's: 'in <collection title>'", () => {
    const o = { indicator: "es", valued: 124, n: 138, esn: 50 };
    expect(filteredCoverage(o)).toBe("124 of 138 hexagons in the place have ≥ 50 records");
    expect(filteredCoverage({ ...o, where: "NOAA National Marine Sanctuaries" })).toBe(
      "124 of 138 hexagons in NOAA National Marine Sanctuaries have ≥ 50 records",
    );
    expect(
      filteredCoverage({ ...o, indicator: "n", where: "NOAA National Marine Sanctuaries" }),
    ).toBe("138 hexagons in NOAA National Marine Sanctuaries");
    expect(withinPart(["NOAA National Marine Sanctuaries"]).label).toBe(
      "in NOAA National Marine Sanctuaries",
    );
  });
});

describe("the status line", () => {
  it("status words: loading, an error, no hexagons in view, no records for the period, drawn", () => {
    const o = { loading: false, cells: 12, label: "Seabirds", period: null };
    expect(statusLine({ ...o, loading: true })).toBe("Loading the release…");
    expect(statusLine({ ...o, error: "HTTP 403" })).toBe("The release could not be read: HTTP 403");
    expect(statusLine({ ...o, cells: 0 })).toBe("No hexagons in this view.");
    expect(statusLine({ ...o, cells: 0, period: "1960s" })).toBe(
      "No OBIS records for Seabirds in the 1960s in this view.",
    );
    expect(statusLine({ ...o, cells: 0, filtered: true })).toBe("No hexagons in the place.");
    expect(statusLine({ ...o, cells: 0, filtered: "NOAA National Marine Sanctuaries" })).toBe(
      "No hexagons in NOAA National Marine Sanctuaries.",
    );
    expect(statusLine(o)).toBeNull();
    expect(statusLine({ ...o, cells: null })).toBeNull();
  });
});

describe("the hover", () => {
  it("hover reads five indicators, the chosen one first and marked", () => {
    const lines = hoverLines(
      "831e5cfffffffff",
      { es: 31.2345, sp: 812, shannon: 4.1, simpson: 0.0312, n: 12034 },
      spec().indicators,
      "sp",
    );
    expect(lines).toEqual([
      "Hexagon 831e5cfffffffff",
      "▸ Species: 812",
      "ES(50): 31.23",
      "Shannon H′: 4.10",
      "Simpson Σp²: 0.031",
      "Records: 12,034",
    ]);
  });
  it("a missing value is a dash (ES(50) under 50 records)", () => {
    expect(formatIndicator("es", undefined)).toBe("–");
    expect(formatIndicator("es", null)).toBe("–");
    expect(formatIndicator("n", "12")).toBe("12");
  });
});
