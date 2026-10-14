// U6 (round 2): the tour's step DATA -- driver.js-free (tourRuntime.ts owns the runtime), so this
// runs under plain Node. One assertion per rule: step counts/order match docs/usability.md §5,
// every step has a real anchor selector + non-empty copy, and each `before()` hook calls exactly
// the TourActions it should.
import { describe, expect, it } from "vitest";
import {
  COLLECTION_TOUR_STEPS,
  SPECIES_TOUR_STEPS,
  tourStepsForLens,
  type TourActions,
} from "../../src/shell/tour";

function fakeActions(currentLens: "collection" | "species" = "collection"): TourActions & {
  calls: {
    setLens: string[];
    selectTool: string[];
    snapshot: number;
    restore: number;
  };
} {
  const calls = {
    setLens: [] as string[],
    selectTool: [] as string[],
    snapshot: 0,
    restore: 0,
  };
  return {
    calls,
    getLens: () => currentLens,
    setLens: (l) => calls.setLens.push(l),
    selectTool: (t) => calls.selectTool.push(t),
    snapshot: () => calls.snapshot++,
    restore: () => calls.restore++,
  };
}

describe("COLLECTION_TOUR_STEPS: 6 steps", () => {
  it("has exactly 6 steps, unique ids, in the documented order", () => {
    expect(COLLECTION_TOUR_STEPS).toHaveLength(6);
    expect(COLLECTION_TOUR_STEPS.map((s) => s.id)).toEqual([
      "map",
      "lenses",
      "layers",
      "click",
      "table",
      "places",
    ]);
    expect(new Set(COLLECTION_TOUR_STEPS.map((s) => s.id)).size).toBe(6);
  });

  it("every step has a non-empty selector, title and description (<= 2 sentences)", () => {
    for (const step of COLLECTION_TOUR_STEPS) {
      expect(step.element.length).toBeGreaterThan(0);
      expect(step.title.length).toBeGreaterThan(0);
      expect(step.description.length).toBeGreaterThan(0);
      const sentences = step.description.split(/(?<=[.!?])\s+/).filter(Boolean);
      expect(sentences.length, `${step.id}: "${step.description}"`).toBeLessThanOrEqual(2);
    }
  });

  it("the lenses/click steps have no before() -- their anchor is always mounted", () => {
    for (const id of ["lenses", "click"]) {
      expect(COLLECTION_TOUR_STEPS.find((s) => s.id === id)?.before).toBeUndefined();
    }
  });

  it("the layers/table/places steps each open exactly their own rail tool via selectTool()", () => {
    for (const [id, tool] of [
      ["layers", "layers"],
      ["table", "table"],
      ["places", "places"],
    ] as const) {
      const a = fakeActions();
      COLLECTION_TOUR_STEPS.find((s) => s.id === id)?.before?.(a);
      expect(a.calls.selectTool).toEqual([tool]);
      expect(a.calls.setLens).toEqual([]);
    }
    expect(COLLECTION_TOUR_STEPS.find((s) => s.id === "places")?.element).toBe(
      '[data-tour="places-heading"]',
    );
  });

  it("the map step switches to the collection lens when the tour started from Species", () => {
    const a = fakeActions("species");
    COLLECTION_TOUR_STEPS[0]?.before?.(a);
    expect(a.calls.setLens).toEqual(["collection"]);
  });

  // guarded: an UNCONDITIONAL setLens() call restarted the reactive chain the lens' own data load
  // depends on for no reason.
  it("the map step does NOT call setLens() when already on the collection lens", () => {
    const a = fakeActions("collection");
    COLLECTION_TOUR_STEPS[0]?.before?.(a);
    expect(a.calls.setLens).toEqual([]);
  });
});

describe("SPECIES_TOUR_STEPS: 5 steps, docs/usability.md §5", () => {
  it("has exactly 5 steps, unique ids, in the documented order", () => {
    expect(SPECIES_TOUR_STEPS).toHaveLength(5);
    expect(SPECIES_TOUR_STEPS.map((s) => s.id)).toEqual([
      "search",
      "card",
      "map",
      "legend",
      "back",
    ]);
    expect(new Set(SPECIES_TOUR_STEPS.map((s) => s.id)).size).toBe(5);
  });

  it("every step has a non-empty selector, title and description", () => {
    for (const step of SPECIES_TOUR_STEPS) {
      expect(step.element.length).toBeGreaterThan(0);
      expect(step.title.length).toBeGreaterThan(0);
      expect(step.description.length).toBeGreaterThan(0);
    }
  });

  it("the search step switches to the species lens when the tour started from Collections", () => {
    const a = fakeActions("collection");
    SPECIES_TOUR_STEPS[0]?.before?.(a);
    expect(a.calls.setLens).toEqual(["species"]);
  });

  // guarded, the same regression the collection "map" step's identical test above covers: a real
  // `?sp=` deep link already resolves `sel.lens === "species"` before the tour ever starts, so an
  // unconditional setLens("species") here reset the species lens' own reactive load underneath
  // the walk -- reproduced directly in e2e/tour.spec.ts (the legend step's anchor never appeared).
  it("the search step does NOT call setLens() when already on the species lens", () => {
    const a = fakeActions("species");
    SPECIES_TOUR_STEPS[0]?.before?.(a);
    expect(a.calls.setLens).toEqual([]);
  });

  it("the card step opens the layers tool (species' own card lives there)", () => {
    const a = fakeActions();
    SPECIES_TOUR_STEPS.find((s) => s.id === "card")?.before?.(a);
    expect(a.calls.selectTool).toEqual(["layers"]);
  });
});

describe("tourStepsForLens", () => {
  it("returns the species list for 'species' and the collection list otherwise", () => {
    expect(tourStepsForLens("species")).toBe(SPECIES_TOUR_STEPS);
    expect(tourStepsForLens("collection")).toBe(COLLECTION_TOUR_STEPS);
  });
});

// the seeded-fault property this file (plus tourRuntime.ts's own wiring) exists to guard: every
// anchor selector this module ships is a real, distinguishable `data-tour`/`data-testid` value --
// never a bare tag/class an ordinary layout change could silently repoint at the wrong element.
describe("anchors are attribute selectors, not bare tags or classes", () => {
  it("every element selector targets a data-tour or data-testid attribute", () => {
    for (const step of [...COLLECTION_TOUR_STEPS, ...SPECIES_TOUR_STEPS]) {
      expect(step.element, step.id).toMatch(/\[data-(tour|testid)="[a-z0-9-]+"\]/);
    }
  });
});
