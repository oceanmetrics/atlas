// R3-W8 item 5: `reportSubjects(sel, places)` -- the one pure rule the Table subject line, the
// Flower tab and the Report tab all read, so a non-empty explicit Places list always wins over the
// "Last clicked" map-click slot, and an empty list falls back to it. See subjects.ts's own header
// for the full rule and why enforcing "a click never wipes the explicit list" is a property of the
// CALLERS (never cross-writing `pl` from a click handler), not of this function.
import { describe, expect, it } from "vitest";
import type { Place, ZonePlace } from "../../src/lib/geo/placeCodec";
import {
  lastClickedInPlaces,
  reportSubjectSentence,
  reportSubjects,
} from "../../src/lib/state/subjects";

const ZONE_PLACE: ZonePlace = { kind: "zone", set: "pa", keys: ["GAA"] };
const OTHER_ZONE_PLACE: ZonePlace = { kind: "zone", set: "pa", keys: ["GOA"] };

describe("reportSubjects", () => {
  it("an empty Places list falls back to the Last-clicked slot (a clicked cell)", () => {
    const result = reportSubjects({ sel: "cell:3350704" }, []);
    expect(result).toEqual({
      kind: "last-clicked",
      selection: { kind: "cell", cellId: 3350704 },
    });
  });

  it("an empty Places list falls back to the Last-clicked slot (a clicked zone)", () => {
    const result = reportSubjects({ sel: "zone:programarea:GAA" }, []);
    expect(result).toEqual({
      kind: "last-clicked",
      selection: { kind: "zone", unit: "programarea", key: "GAA" },
    });
  });

  it("an empty Places list AND nothing clicked yet: last-clicked with a null selection", () => {
    expect(reportSubjects({ sel: undefined }, [])).toEqual({
      kind: "last-clicked",
      selection: null,
    });
  });

  it("a non-empty explicit Places list wins, even with nothing clicked", () => {
    const places: Place[] = [ZONE_PLACE];
    expect(reportSubjects({ sel: undefined }, places)).toEqual({ kind: "places", items: places });
  });

  it("a non-empty explicit Places list wins over a REAL last-clicked cell/zone too (both -> list)", () => {
    const places: Place[] = [ZONE_PLACE, OTHER_ZONE_PLACE];
    expect(reportSubjects({ sel: "cell:99" }, places)).toEqual({ kind: "places", items: places });
  });

  it("explicit list untouched by a click: the SAME places list comes back regardless of sel.sel", () => {
    const places: Place[] = [ZONE_PLACE];
    const beforeClick = reportSubjects({ sel: undefined }, places);
    const afterClick = reportSubjects({ sel: "cell:12345" }, places);
    expect(afterClick).toEqual(beforeClick);
    expect(afterClick).toEqual({ kind: "places", items: places });
  });

  it("last-clicked is REPLACED on a new click (the slot itself, not accumulated)", () => {
    const first = reportSubjects({ sel: "cell:1" }, []);
    const second = reportSubjects({ sel: "cell:2" }, []);
    expect(first).toEqual({ kind: "last-clicked", selection: { kind: "cell", cellId: 1 } });
    expect(second).toEqual({ kind: "last-clicked", selection: { kind: "cell", cellId: 2 } });
  });

  it("a malformed sel token resolves to a null last-clicked selection, never a throw", () => {
    expect(reportSubjects({ sel: "not-a-real-token" }, [])).toEqual({
      kind: "last-clicked",
      selection: null,
    });
  });
});

// R3-W8 item 5 fix round: the Report tab's own one-sentence explanation, driven by the SAME
// reportSubjects() result the Places tab's "Last clicked" row and the Table's subject line read.
describe("reportSubjectSentence", () => {
  it("a last click not yet in the list: add it to keep it", () => {
    expect(
      reportSubjectSentence({ kind: "last-clicked", selection: { kind: "cell", cellId: 1 } }),
    ).toBe("Reporting on the last clicked place. Add it to keep it.");
  });

  it("nothing at all: the third sentence (Open report is disabled with it)", () => {
    expect(reportSubjectSentence({ kind: "last-clicked", selection: null })).toBe(
      "Add a place to open a report.",
    );
  });

  it("places, singular", () => {
    expect(reportSubjectSentence({ kind: "places", items: [ZONE_PLACE] })).toBe(
      "Reporting on 1 place.",
    );
  });

  it("places, plural", () => {
    expect(reportSubjectSentence({ kind: "places", items: [ZONE_PLACE, OTHER_ZONE_PLACE] })).toBe(
      "Reporting on 2 places.",
    );
  });
});

describe("lastClickedInPlaces: the Last-clicked row hides once its subject is listed", () => {
  it("a zone matches by key", () => {
    const sel = { kind: "zone", unit: "programarea", key: "GAA" } as const;
    expect(lastClickedInPlaces(sel, [ZONE_PLACE])).toBe(ZONE_PLACE.keys.includes("GAA"));
    expect(lastClickedInPlaces({ ...sel, key: "NOPE" }, [ZONE_PLACE])).toBe(false);
  });

  it("nothing clicked is never 'in the list'", () => {
    expect(lastClickedInPlaces(null, [ZONE_PLACE])).toBe(false);
  });

  it("a cell matches the Cell <id> geometry place, not a different cell", () => {
    const geom = { kind: "geom", name: "Cell 500" } as unknown as Place;
    expect(lastClickedInPlaces({ kind: "cell", cellId: 500 }, [geom])).toBe(true);
    expect(lastClickedInPlaces({ kind: "cell", cellId: 501 }, [geom])).toBe(false);
  });
});
