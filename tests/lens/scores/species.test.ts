import { describe, expect, it } from "vitest";
import { parseSel } from "../../../src/lib/state/codec";
import { DEFAULT_SEL } from "../../../src/lib/state/types";
import {
  csvFilename,
  formatAreaKm2,
  formatPercent0,
  formatPercent2,
  modelHref,
  modelSelPatch,
  placesSubjectHeader,
  speciesFilenameStem,
  speciesHeader,
  speciesTableEmptyText,
  taxonUrl,
  toCsv,
  unitSingularLabel,
} from "../../../src/lens/scores/species";

describe("unitSingularLabel", () => {
  it("programarea / planarea: the pinned literals", () => {
    expect(unitSingularLabel("programarea", "Program areas")).toBe("Program Area");
    expect(unitSingularLabel("planarea", "Planning areas")).toBe("Planning Area");
  });

  it("an unrecognized unit: singularized from its own boot label", () => {
    expect(unitSingularLabel("ecoregion", "Ecoregions")).toBe("Ecoregion");
  });
});

// UI-4 (round-3 review): "Species in {subject}" for every state, `{subject}` the SAME
// `formatSubject()` line the map popup and flower panel print -- replaces the old three bespoke
// spellings ("Species for Cell ID: …", "Species for Program Area: …", "Species in Full study
// area").
describe("speciesHeader", () => {
  it("cell clicked, no coords wired through: the id-only fallback", () => {
    expect(
      speciesHeader({
        selection: { kind: "cell", cellId: 42 },
        unit: "cell",
        unitLabel: null,
        zoneAllKey: "USA",
      }),
    ).toBe("Species in Cell 42");
  });

  it("cell clicked, coords wired through: the shared formatSubject line", () => {
    expect(
      speciesHeader({
        selection: { kind: "cell", cellId: 3350704 },
        unit: "cell",
        unitLabel: null,
        zoneAllKey: "USA",
        cellCoords: { lon: -90.575, lat: 28.625 },
      }),
    ).toBe("Species in Cell 3350704 · 28.625° N, 90.575° W");
  });

  it("zone clicked (programarea)", () => {
    expect(
      speciesHeader({
        selection: { kind: "zone", unit: "programarea", key: "GAA" },
        zoneName: "Gulf of America, Eastern",
        unit: "programarea",
        unitLabel: "Program areas",
        zoneAllKey: "USA",
      }),
    ).toBe("Species in Gulf of America, Eastern");
  });

  it("nothing selected", () => {
    expect(
      speciesHeader({ selection: null, unit: "cell", unitLabel: null, zoneAllKey: "USA" }),
    ).toBe("Species in All US waters");
  });
});

// R3-W8 item 5: the Table's own subject line when a non-empty EXPLICIT Places list governs
// (reportSubjects(), src/lib/state/subjects.ts) -- names the LIST, not a single cell/zone.
describe("placesSubjectHeader", () => {
  it("singular for exactly one place", () => {
    expect(placesSubjectHeader(1)).toBe("Species for 1 place");
  });

  it("plural for two or more places", () => {
    expect(placesSubjectHeader(2)).toBe("Species for 2 places");
    expect(placesSubjectHeader(5)).toBe("Species for 5 places");
  });
});

describe("speciesFilenameStem", () => {
  it("cell: species_cellid-{id}", () => {
    expect(
      speciesFilenameStem({
        selection: { kind: "cell", cellId: 42 },
        unit: "cell",
        unitLabel: null,
        zoneAllKey: "USA",
      }),
    ).toBe("species_cellid-42");
  });

  it("zone: species_{unit}-{lowercased name, first space -> '-'}", () => {
    expect(
      speciesFilenameStem({
        selection: { kind: "zone", unit: "programarea", key: "GAA" },
        zoneName: "Gulf of America",
        unit: "programarea",
        unitLabel: "Program areas",
        zoneAllKey: "USA",
      }),
    ).toBe("species_programarea-gulf-of america");
  });

  it("a single-word name: no space to replace", () => {
    expect(
      speciesFilenameStem({
        selection: { kind: "zone", unit: "programarea", key: "BFT" },
        zoneName: "Beaufort",
        unit: "programarea",
        unitLabel: "Program areas",
        zoneAllKey: "USA",
      }),
    ).toBe("species_programarea-beaufort");
  });

  it("nothing selected: species_{zone_all_key}", () => {
    expect(
      speciesFilenameStem({ selection: null, unit: "cell", unitLabel: null, zoneAllKey: "USA" }),
    ).toBe("species_USA");
  });
});

describe("csvFilename", () => {
  it("stem_YYYY-MM-DD.csv", () => {
    expect(csvFilename("species_USA", new Date("2026-09-22T12:00:00Z"))).toBe(
      "species_USA_2026-09-22.csv",
    );
  });
});

describe("formatPercent0 / formatPercent2 / formatAreaKm2", () => {
  it("er_score: 0dp percent", () => {
    expect(formatPercent0(0.5)).toBe("50%");
    expect(formatPercent0(1)).toBe("100%");
    expect(formatPercent0(null)).toBe("");
  });

  it("avg_suit/pct_cat: 2dp percent", () => {
    expect(formatPercent2(0.12345)).toBe("12.35%");
  });

  it("area_km2: 4 significant figures", () => {
    expect(formatAreaKm2(382002.544334317)).toBe("382,000");
    expect(formatAreaKm2(0)).toBe("0");
    expect(formatAreaKm2(null)).toBe("");
  });
});

describe("taxonUrl", () => {
  it("BOTW authority -> birdsoftheworld.org", () => {
    expect(taxonUrl("botw", "123")).toBe("https://birdsoftheworld.org");
    expect(taxonUrl("BOTW", "123")).toBe("https://birdsoftheworld.org");
  });

  it("anything else -> WoRMS aphia.php", () => {
    expect(taxonUrl("worms", "137209")).toBe(
      "https://www.marinespecies.org/aphia.php?p=taxdetails&id=137209",
    );
  });
});

describe("model link", () => {
  it("modelSelPatch switches lens + sp + in=merged, resets out to the species default", () => {
    expect(modelSelPatch("ms_merge|WORMS:137209")).toEqual({
      lens: "species",
      sp: "ms_merge|WORMS:137209",
      in: "merged",
      out: "none",
    });
  });

  it("modelHref keeps place/camera, resolves to the species lens with the given sp", () => {
    const href = modelHref({ ...DEFAULT_SEL, area: "GA" }, "ms_merge|WORMS:137209");
    // "lens=species" need not appear literally: state/codec.ts's formatSel infers the species lens
    // as the DEFAULT once `sp` is set (defaultLens()) and omits an already-default value.
    const parsed = parseSel({ search: href, hash: "" });
    expect(parsed.lens).toBe("species");
    expect(parsed.sp).toBe("ms_merge|WORMS:137209");
    expect(parsed.area).toBe("GA");
  });
});

describe("toCsv", () => {
  it("writes the header then one row per record, CRLF-terminated", () => {
    const csv = toCsv(
      [
        { a: 1, b: "x" },
        { a: 2, b: "y" },
      ],
      [
        { key: "a", value: (r: { a: number }) => r.a },
        { key: "b", value: (r: { b: string }) => r.b },
      ],
    );
    expect(csv).toBe("a,b\r\n1,x\r\n2,y\r\n");
  });

  it("writes the UNFORMATTED value, not a display string (0.5, never '50%')", () => {
    const csv = toCsv(
      [{ er_score: 0.5 }],
      [{ key: "er_score", value: (r: { er_score: number }) => r.er_score }],
    );
    expect(csv).toBe("er_score\r\n0.5\r\n");
  });

  it("quotes a field containing a comma, quote or newline (RFC 4180)", () => {
    const csv = toCsv(
      [{ name: 'a,b"c\nd' }],
      [{ key: "name", value: (r: { name: string }) => r.name }],
    );
    expect(csv).toBe('name\r\n"a,b""c\nd"\r\n');
  });

  it("null/undefined become an empty field", () => {
    const csv = toCsv([{ x: null }], [{ key: "x", value: (r: { x: null }) => r.x }]);
    expect(csv).toBe("x\r\n\r\n");
  });
});

// D3(b) (Opus 5.5 eyes-on, 2026-09-24): "the Flower and Table panels with no scored selection say
// 'Click a scored cell on the map to see its flower / species' — and a GENUINE query failure keeps
// a distinct message that names the failure, so the two states are never confused (assert both)."
// The species-table half of the same pair `flower.test.ts`'s `flowerEmptyText` describe asserts.
describe("speciesTableEmptyText (D3(b) — assert both states, and that they are distinct)", () => {
  it("no scored selection: the hint, never reading as a failure", () => {
    expect(speciesTableEmptyText()).toBe("Click a scored cell on the map to see its species.");
    expect(speciesTableEmptyText(null)).toBe("Click a scored cell on the map to see its species.");
  });

  it("a genuine query failure: a DISTINCT message that names the failure", () => {
    const text = speciesTableEmptyText("HTTP 404");
    expect(text).toContain("HTTP 404");
    expect(text).not.toBe(speciesTableEmptyText()); // never confusable with the "nothing selected" hint
  });

  it("the two states are never conflated", () => {
    const hint = speciesTableEmptyText();
    const error = speciesTableEmptyText("engine disconnected");
    expect(error.startsWith("The species table could not be loaded:")).toBe(true);
    expect(hint.startsWith("Click a scored cell")).toBe(true);
  });
});
