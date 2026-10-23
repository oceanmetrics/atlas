// atlas-4 fix round 3 / R3-W7 (round-3 review, Ben's colour-coding + sparkline ask): the scores
// lens' click popup — UI-4's shared subject/value lines through `lib/map/popup.ts#valuePopupHtml`,
// a ramp-colour swatch, and an optional distribution sparkline.
import { describe, expect, it } from "vitest";
import {
  cellPopupAnnounceText,
  cellPopupLoadingText,
  cellPopupText,
  cellSwatch,
  zonePopupAnnounceText,
  zonePopupText,
} from "../../../src/lens/scores/popup";
import type { ZoneRow } from "../../../src/lens/scores/boot";

const STOPS = ["#000000", "#ffffff"] as const;

describe("cellPopupText", () => {
  it("the shared subject line + 'Label value' (UI-4), swatch coloured against the ramp", () => {
    const text = cellPopupText({
      cellId: 123456,
      lon: -70.123456,
      lat: 41.987654,
      layerLabel: "Overall score",
      value: 42,
      ramp: { stops: STOPS, min: 0, max: 100 },
    });
    expect(text).toContain("Cell 123456 · 41.988° N, 70.123° W");
    expect(text).toContain("Overall score 42");
    expect(text).toContain("atlas-popup-swatch");
  });

  it("the value is rounded to the nearest integer (formatValueLine, UI-4's 'Score 44' convention)", () => {
    expect(cellPopupText({ cellId: 1, lon: 0, lat: 0, layerLabel: "x", value: 17.4 })).toContain(
      "x 17",
    );
    expect(cellPopupText({ cellId: 1, lon: 0, lat: 0, layerLabel: "x", value: 17.6 })).toContain(
      "x 18",
    );
  });

  it("no ramp resolved yet: still shows the value, with a neutral swatch (never a guessed colour)", () => {
    const text = cellPopupText({ cellId: 1, lon: 0, lat: 0, layerLabel: "x", value: 42 });
    expect(text).toContain("x 42");
    expect(text).toContain("background:grey");
  });

  // D3 (Opus 5.5 eyes-on, 2026-09-24): a click outside the scored area (Utah, on the owner's
  // screenshot) used to read "Cell 2711027 · lon -113.526, lat 38.932 · {30-word layer
  // description}: no value" -- a cell id (implying the app found a scored cell — it did not) and
  // the FULL layer title, both misleading.
  it("D3: a click with NO value (off-grid / unscored) reads 'No scored cell here' — never a cell id, never the layer label", () => {
    const text = cellPopupText({
      cellId: 2711027,
      lon: -113.526,
      lat: 38.932,
      layerLabel: "Primary productivity: Oregon State Vertically Generalized Production Model",
      value: null,
      ramp: { stops: STOPS, min: 0, max: 100 },
    });
    expect(text).toContain("No scored cell here");
    expect(text).not.toContain("Primary productivity");
    expect(text).not.toContain("2711027"); // never a cell id for a no-value click
    expect(text).toContain("38.932° N, 113.526° W");
    expect(text).toContain("background:grey"); // no ramp value to colour against
  });

  it("D3: the announce() text matches, no markup, no cell id", () => {
    const text = cellPopupAnnounceText({
      cellId: 2711027,
      lon: -113.526,
      lat: 38.932,
      layerLabel: "<b>whatever</b>",
      value: null,
    });
    expect(text).toBe("38.932° N, 113.526° W: No scored cell here");
  });

  it("the layer label is escaped in the HTML (a release string is untrusted text, never markup)", () => {
    const text = cellPopupText({ cellId: 1, lon: 0, lat: 0, layerLabel: "<b>x</b>", value: 1 });
    expect(text).not.toContain("<b>x</b>");
    expect(text).toContain("&lt;b&gt;x&lt;/b&gt;");
  });

  it("R4-A: the popup carries no sparkline/histogram -- that lives in the legend now", () => {
    const html = cellPopupText({
      cellId: 1,
      lon: 0,
      lat: 0,
      layerLabel: "x",
      value: 42,
      ramp: { stops: STOPS, min: 0, max: 100 },
    });
    expect(html).not.toContain("sparkline");
    expect(html).not.toContain("<svg");
  });
});

describe("cellSwatch", () => {
  it("colours against the ramp, black/white contrast", () => {
    expect(cellSwatch(0, { stops: STOPS, min: 0, max: 100 })).toEqual({
      color: "#000000",
      textColor: "white",
    });
    expect(cellSwatch(100, { stops: STOPS, min: 0, max: 100 })).toEqual({
      color: "#ffffff",
      textColor: "black",
    });
  });

  it("null value or no ramp -> null, never a guessed colour", () => {
    expect(cellSwatch(null, { stops: STOPS, min: 0, max: 100 })).toBeNull();
    expect(cellSwatch(42, null)).toBeNull();
    expect(cellSwatch(42, undefined)).toBeNull();
  });
});

const ZONES: ZoneRow[] = [
  { key: "GAA", name: "Gulf of America, Eastern", n_taxa: 10, metrics: { score: 33.09 } },
  { key: "MDA", name: "Mid Atlantic", n_taxa: 10, metrics: {} },
  { key: "NONAME", n_taxa: 10, metrics: { score: 10 } },
];

describe("zonePopupText", () => {
  // V4 fix (owner phone report, 2026-09-24, docs fact-check item 3): both the has-value branch
  // (via `zoneValuesFor`'s own `paLabel()` fix) and the no-value branch (this module's own
  // `paLabel()` call) show "Full Name (KEY)", the same label the Zones table already shows.
  it("the shared subject line + 'Score {value}' (UI-4), swatch coloured against the ramp", () => {
    const text = zonePopupText({
      zones: ZONES,
      lyr: "score",
      zone: { key: "GAA", name: "Gulf of America, Eastern" },
      stops: STOPS,
    });
    expect(text).toContain("Gulf of America, Eastern (GAA)");
    expect(text).toContain("Score 33");
    expect(text).toContain("atlas-popup-swatch");
  });

  it("falls back to the key when the zone carries no name (and no PROGRAM_AREA_NAMES fallback)", () => {
    const text = zonePopupText({
      zones: ZONES,
      lyr: "score",
      zone: { key: "NONAME", name: "NONAME" },
    });
    expect(text).toContain("NONAME");
    expect(text).toContain("Score 10");
  });

  it("no value for this layer -> 'No scored cell here', never a throw", () => {
    const text = zonePopupText({
      zones: ZONES,
      lyr: "score",
      zone: { key: "MDA", name: "Mid Atlantic" },
    });
    expect(text).toContain("Mid Atlantic (MDA)");
    expect(text).toContain("No scored cell here");
    expect(text).toContain("background:grey");
  });

  it("lyr === null (no boot.layers yet) -> 'No scored cell here' rather than guessing a metric", () => {
    const text = zonePopupText({
      zones: ZONES,
      lyr: null,
      zone: { key: "GAA", name: "Gulf of America, Eastern" },
    });
    expect(text).toContain("No scored cell here");
  });

  it("the zone's own name is escaped too", () => {
    const text = zonePopupText({ zones: [], lyr: "score", zone: { key: "X", name: "<i>X</i>" } });
    expect(text).toContain("&lt;i&gt;X&lt;/i&gt; (X)");
    expect(text).not.toContain("<i>X</i>");
  });

  it("no stops resolved: still shows the value, with a neutral swatch", () => {
    const text = zonePopupText({
      zones: ZONES,
      lyr: "score",
      zone: { key: "GAA", name: "Gulf of America, Eastern" },
    });
    expect(text).toContain("Score 33");
    expect(text).toContain("background:grey");
  });
});

describe("zonePopupAnnounceText", () => {
  it("plain text, no markup", () => {
    expect(
      zonePopupAnnounceText({
        zones: ZONES,
        lyr: "score",
        zone: { key: "GAA", name: "Gulf of America, Eastern" },
      }),
    ).toBe("Gulf of America, Eastern (GAA): Score 33");
  });
});

// usability M9: the popup opens at once with this line, before the engine has answered.
describe("cellPopupLoadingText", () => {
  it("cell id, lon/lat at 3 dp, and a loading line -- no value yet, never a throw", () => {
    const text = cellPopupLoadingText({ cellId: 123456, lon: -70.123456, lat: 41.987654 });
    expect(text).toBe("Cell 123456 · lon -70.123, lat 41.988 · Loading value…");
  });
});

// R4-B: the click popup states the value and LINKS to Details (control-grammar.md); a click that
// found nothing has nothing to show details for.
describe("the popup's Details link (R4-B)", () => {
  const LINK = "data-atlas-open-details";

  it("a cell click with a value carries the Details link; a no-value click does not", () => {
    const withValue = cellPopupText({ cellId: 1, lon: 0, lat: 0, layerLabel: "x", value: 17 });
    expect(withValue).toContain(LINK);
    expect(withValue).toContain(">Details<");
    const noValue = cellPopupText({ cellId: 1, lon: 0, lat: 0, layerLabel: "x", value: null });
    expect(noValue).not.toContain(LINK);
  });

  it("a Program Area click with a value carries the link; one with no value does not", () => {
    const zone = { key: "GAA", name: "Gulf of America, Eastern" };
    expect(zonePopupText({ zones: ZONES, lyr: "score", zone, stops: STOPS })).toContain(LINK);
    expect(zonePopupText({ zones: ZONES, lyr: "nope", zone, stops: STOPS })).not.toContain(LINK);
  });
});
