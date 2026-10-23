// U6 (round 2): reportAction() decides what "Report" (top bar + rail tool) does with the CURRENT
// selection -- docs/usability.md M1. One fixture per rule, per CLAUDE.md's testing pyramid.
// `reportHash()`'s own B2 round-trip-through-report.html's-parser proof lives in
// tests/places/model.test.ts; this file only proves reportAction() BUILDS a link with that exact
// encoder, not a second hand-rolled one.
import { describe, expect, it } from "vitest";
import {
  loadRecentReports,
  recordRecentReport,
  reportAction,
  reportOpenEnabled,
  zoneReportHref,
} from "../../src/shell/report";
import { DEFAULT_SEL } from "../../src/lib/state/types";
import { hashFromPlaces } from "../../src/places/model";
import type { GeomPlace } from "../../src/lib/geo/placeCodec";

const SQUARE_GEOMETRY: GeomPlace["geometry"] = {
  type: "Polygon",
  coordinates: [
    [
      [0, 0],
      [0, 1],
      [1, 1],
      [1, 0],
      [0, 0],
    ],
  ],
};

describe("reportAction: a place list wins over a zone selection", () => {
  it("a place list present -> opens report.html for every place in it, ver included", () => {
    const pl = hashFromPlaces([{ kind: "zone", set: "pa", keys: ["GAA"] }]);
    const action = reportAction({ ...DEFAULT_SEL, pl, sel: "zone:programarea:GAA" }, "v9");
    expect(action.kind).toBe("open");
    if (action.kind !== "open") throw new Error("unreachable");
    expect(action.href).toBe(`./report.html?ver=v9#pl=${pl}`);
  });

  it("a place list with a report title carries #t= too (reportHash(), the B2 encoder)", () => {
    const pl = hashFromPlaces([{ kind: "zone", set: "pa", keys: ["GAA"] }]);
    const action = reportAction({ ...DEFAULT_SEL, pl, t: "My Report" }, "v9");
    if (action.kind !== "open") throw new Error("unreachable");
    expect(action.href).toBe(`./report.html?ver=v9#pl=${pl}&t=My+Report`);
  });

  it("a place NAME with a space builds through reportHash(), not a second hand-rolled encoder", () => {
    const pl = hashFromPlaces([{ kind: "geom", name: "Drawn place 1", geometry: SQUARE_GEOMETRY }]);
    const action = reportAction({ ...DEFAULT_SEL, pl }, null);
    if (action.kind !== "open") throw new Error("unreachable");
    // exactly reportHash(pl, undefined) -- see tests/places/model.test.ts's own B2 round-trip
    // proof for why a space in `pl` must survive this.
    const params = new URLSearchParams(action.href.split("#")[1]);
    expect(params.get("pl")).toBe(pl);
  });
});

describe("reportAction: a single zone selection, no place list", () => {
  it("sel=zone:<unit>:<key> -> a one-place zone report, no ?ver= when ver is null", () => {
    const action = reportAction(
      { ...DEFAULT_SEL, pl: undefined, sel: "zone:programarea:GAA" },
      null,
    );
    expect(action.kind).toBe("open");
    if (action.kind !== "open") throw new Error("unreachable");
    expect(action.href).toBe(
      `./report.html#pl=${hashFromPlaces([{ kind: "zone", set: "pa", keys: ["GAA"] }])}`,
    );
    expect(action.label).toContain("GAA");
  });

  it("an unrecognized unit (no ZoneSet code) falls through to the chooser, not a broken link", () => {
    const action = reportAction({ ...DEFAULT_SEL, pl: undefined, sel: "zone:notaunit:GAA" }, "v9");
    expect(action).toEqual({ kind: "chooser" });
  });

  it("a CELL selection whose place token has not resolved yet falls through to the chooser", () => {
    const action = reportAction({ ...DEFAULT_SEL, pl: undefined, sel: "cell:123" }, "v9");
    expect(action).toEqual({ kind: "chooser" });
  });

  // #10 (2026-10-16): the footer said "Reporting on the last clicked place" while Open report
  // stayed disabled for a clicked cell.
  it("a CELL selection with its encoded place reports on that one cell, enabled", () => {
    const cellPl = hashFromPlaces([{ kind: "geom", name: "Cell 123", geometry: SQUARE_GEOMETRY }])!;
    const action = reportAction({ ...DEFAULT_SEL, pl: undefined, sel: "cell:123" }, "v7", cellPl);
    expect(action.kind).toBe("open");
    if (action.kind !== "open") throw new Error("unreachable");
    expect(action.href).toBe(
      `./report.html?ver=v7#pl=${encodeURIComponent(cellPl).replace(/%20/g, "+")}`,
    );
    expect(new URLSearchParams(action.href.split("#")[1]).get("pl")).toBe(cellPl);
    expect(action.label).toBe("the last clicked cell (123)");
    expect(reportOpenEnabled(action)).toBe(true);
  });

  it("an explicit place list still wins over a clicked cell's token", () => {
    const pl = hashFromPlaces([{ kind: "zone", set: "pa", keys: ["GAA"] }]);
    const cellPl = hashFromPlaces([{ kind: "geom", name: "Cell 123", geometry: SQUARE_GEOMETRY }])!;
    const action = reportAction({ ...DEFAULT_SEL, pl, sel: "cell:123" }, "v7", cellPl);
    if (action.kind !== "open") throw new Error("unreachable");
    expect(action.label).toBe("the current place list");
  });

  it("a cell token is ignored when the selection is a zone (the zone branch reports)", () => {
    const cellPl = hashFromPlaces([{ kind: "geom", name: "Cell 123", geometry: SQUARE_GEOMETRY }])!;
    const action = reportAction(
      { ...DEFAULT_SEL, pl: undefined, sel: "zone:programarea:GAA" },
      "v7",
      cellPl,
    );
    if (action.kind !== "open") throw new Error("unreachable");
    expect(action.label).toBe("the selected Program Area (GAA)");
  });
});

describe("reportAction: nothing selected -> the chooser, never a dead link", () => {
  it("no pl, no sel", () => {
    expect(reportAction({ ...DEFAULT_SEL, pl: undefined, sel: undefined }, "v9")).toEqual({
      kind: "chooser",
    });
  });
});

// R4-D: the pinned Open report button. Seeded fault `report-open-enabled-with-nothing` flips this
// to always-true; the e2e "nothing selected" case in report.flow.spec.ts catches it in a browser.
describe("reportOpenEnabled: Open report is disabled with nothing to open", () => {
  it("a chooser action (no place, no selected zone) is disabled", () => {
    expect(reportOpenEnabled({ kind: "chooser" })).toBe(false);
  });

  it("an open action is enabled", () => {
    expect(reportOpenEnabled({ kind: "open", href: "./report.html", label: "x" })).toBe(true);
  });
});

describe("zoneReportHref: the chooser's own per-zone link", () => {
  it("builds the same href reportAction()'s zone branch would for the same zone", () => {
    const viaAction = reportAction(
      { ...DEFAULT_SEL, pl: undefined, sel: "zone:programarea:COK" },
      "v7",
    );
    if (viaAction.kind !== "open") throw new Error("unreachable");
    expect(zoneReportHref("programarea", "COK", "v7")).toBe(viaAction.href);
  });

  it("returns null for a unit with no ZoneSet code", () => {
    expect(zoneReportHref("notaunit", "GAA", "v9")).toBeNull();
  });
});

describe("recent reports (sessionStorage, capped, deduped)", () => {
  function fakeStorage() {
    const store = new Map<string, string>();
    return {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    };
  }

  it("a missing storage (null) is an empty list, never a throw", () => {
    expect(loadRecentReports(null)).toEqual([]);
  });

  it("records prepend newest-first", () => {
    const storage = fakeStorage();
    let now = 1000;
    recordRecentReport(storage, { href: "./report.html#pl=a", label: "A" }, () => now++);
    recordRecentReport(storage, { href: "./report.html#pl=b", label: "B" }, () => now++);
    expect(loadRecentReports(storage).map((r) => r.label)).toEqual(["B", "A"]);
  });

  it("re-opening an existing href moves it to the front instead of duplicating it", () => {
    const storage = fakeStorage();
    let now = 1000;
    recordRecentReport(storage, { href: "./report.html#pl=a", label: "A" }, () => now++);
    recordRecentReport(storage, { href: "./report.html#pl=b", label: "B" }, () => now++);
    recordRecentReport(storage, { href: "./report.html#pl=a", label: "A" }, () => now++);
    expect(loadRecentReports(storage).map((r) => r.href)).toEqual([
      "./report.html#pl=a",
      "./report.html#pl=b",
    ]);
  });

  it("caps at 5 entries, dropping the oldest", () => {
    const storage = fakeStorage();
    let now = 1000;
    for (let i = 0; i < 7; i++) {
      recordRecentReport(storage, { href: `./report.html#pl=${i}`, label: String(i) }, () => now++);
    }
    const recents = loadRecentReports(storage);
    expect(recents).toHaveLength(5);
    expect(recents.map((r) => r.label)).toEqual(["6", "5", "4", "3", "2"]);
  });

  it("a storage that throws on write degrades silently (chrome, not correctness)", () => {
    const throwing = {
      getItem: () => null,
      setItem: () => {
        throw new Error("quota");
      },
    };
    expect(() => recordRecentReport(throwing, { href: "x", label: "X" })).not.toThrow();
  });

  it("malformed JSON in storage reads back as an empty list, not a throw", () => {
    const storage = fakeStorage();
    storage.setItem("atlas.report.recent", "not json");
    expect(loadRecentReports(storage)).toEqual([]);
  });
});
