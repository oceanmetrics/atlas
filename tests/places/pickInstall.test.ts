import { describe, expect, it, vi } from "vitest";
import { installPickMode, type PickMapLike } from "../../src/places/pickInstall";
import { zoneFillId, zoneKeyProperty, zoneNameProperty } from "../../src/lib/map/layers/zones";
import type { ZoneUnitSpec } from "../../src/lib/map/types";
import type { PickState } from "../../src/places/pick";

const UNIT: ZoneUnitSpec = {
  unit: "programarea",
  pmtiles: "https://s3.example/zones/programarea/zones.pmtiles",
  sourceLayer: "programarea",
};

/** a minimal fake map: every query returns ONE feature for whichever key `nextKey()` currently
 * names (defaults to always the same key) -- this test is about the click/long-press/modifier
 * WIRING, not hit resolution (covered by tests/map/interaction.test.ts and
 * tests/places/pick.test.ts). */
function fakeMap(nextKey: () => string) {
  const listeners = new Map<string, Set<(e: unknown) => void>>();
  const map: PickMapLike = {
    on(type, listener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(listener);
    },
    off(type, listener) {
      listeners.get(type)?.delete(listener);
    },
    queryRenderedFeatures() {
      const key = nextKey();
      return [
        {
          layer: { id: zoneFillId(UNIT.unit) },
          properties: { [zoneKeyProperty(UNIT.unit)]: key, [zoneNameProperty(UNIT.unit)]: key },
        },
      ];
    },
    project: () => ({ x: 0, y: 0 }),
  };
  const fire = (type: string, e: unknown = { point: { x: 1, y: 1 } }) => {
    for (const l of listeners.get(type) ?? []) l(e);
  };
  return { map, fire };
}

/** the fixed-key convenience most tests below want. */
function fakeMapOf(key: string) {
  return fakeMap(() => key);
}

describe("installPickMode", () => {
  it("a plain click resolves and reports a single-key pick", () => {
    const { map, fire } = fakeMapOf("GAA");
    const changes: PickState[] = [];
    installPickMode(map, [UNIT], (s) => changes.push(s));
    fire("click");
    expect(changes).toEqual([{ unit: "programarea", keys: ["GAA"] }]);
  });

  it("a ctrl-click on a DIFFERENT zone is a multi-select add", () => {
    const keys = ["GAA", "WGA"];
    const { map, fire } = fakeMap(() => keys.shift()!);
    const changes: PickState[] = [];
    installPickMode(map, [UNIT], (s) => changes.push(s));
    fire("click");
    fire("click", { point: { x: 1, y: 1 }, originalEvent: { ctrlKey: true } });
    expect(changes[changes.length - 1]).toEqual({ unit: "programarea", keys: ["GAA", "WGA"] });
  });

  it("a ctrl-click on the SAME already-picked zone toggles it back off (pick.ts's own rule)", () => {
    const { map, fire } = fakeMapOf("GAA");
    const changes: PickState[] = [];
    installPickMode(map, [UNIT], (s) => changes.push(s));
    fire("click");
    fire("click", { point: { x: 1, y: 1 }, originalEvent: { ctrlKey: true } });
    expect(changes[changes.length - 1]).toEqual({ unit: "programarea", keys: [] });
  });

  it("a long-press (touchstart held past the threshold) adds, and the FOLLOWING click is swallowed", () => {
    vi.useFakeTimers();
    try {
      const { map, fire } = fakeMapOf("WGA");
      const changes: PickState[] = [];
      installPickMode(map, [UNIT], (s) => changes.push(s));
      fire("touchstart");
      vi.advanceTimersByTime(600);
      expect(changes).toEqual([{ unit: "programarea", keys: ["WGA"] }]);
      fire("click"); // the browser's own synthesized click after a touch -- must not double-apply
      expect(changes).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("touchend before the threshold cancels the long-press timer", () => {
    vi.useFakeTimers();
    try {
      const { map, fire } = fakeMapOf("WGA");
      const changes: PickState[] = [];
      installPickMode(map, [UNIT], (s) => changes.push(s));
      fire("touchstart");
      vi.advanceTimersByTime(100);
      fire("touchend");
      vi.advanceTimersByTime(600);
      expect(changes).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("uninstall stops every listener (a subsequent click reports nothing)", () => {
    const { map, fire } = fakeMapOf("GAA");
    const changes: PickState[] = [];
    const handle = installPickMode(map, [UNIT], (s) => changes.push(s));
    handle.uninstall();
    fire("click");
    expect(changes).toEqual([]);
  });

  it("uninstall is safe to call twice", () => {
    const { map } = fakeMapOf("GAA");
    const handle = installPickMode(map, [UNIT], () => {});
    handle.uninstall();
    expect(() => handle.uninstall()).not.toThrow();
  });
});

// B3 (docs/usability.md): "Pick mode cannot pick a Program Area (only the 1-px outline is
// queried)". The tests above use a fake `queryRenderedFeatures` that IGNORES `options.layers` and
// always returns a fill-tagged feature, which is why they could not have caught this bug -- a real
// MapLibre map only returns features from layers actually named in `options.layers` AND actually
// present in the composed style. This fake respects both: it only answers for a layer id in the
// query's `layers` list AND in `renderedLayerIds` (the layers the CURRENT style actually contains),
// mirroring `zoneUnitsFromBoot`'s fix -- outline-only units render (and can therefore only be
// queried through) their `_ln` layer; a unit whose `fill` is set (queryFillFor's invisible
// placeholder, post-fix) also renders (and can be queried through) its `_fill` layer.
function fakeQueryMap(renderedLayerIds: readonly string[], key: string): PickMapLike {
  const listeners = new Map<string, Set<(e: unknown) => void>>();
  const map: PickMapLike = {
    on(type, listener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(listener);
    },
    off(type, listener) {
      listeners.get(type)?.delete(listener);
    },
    queryRenderedFeatures(_point, options) {
      const requested = options?.layers ?? [];
      // an interior click never touches the 1-px `_ln` layer -- only a real fill layer's polygon
      // area does. This fake stands in for that geometric fact: it "hits" a layer only when BOTH
      // the query asked for it AND the style actually rendered it AND it is a `_fill` id (never
      // `_ln` -- the whole point of an interior click).
      const hit = requested.find((id) => id.endsWith("_fill") && renderedLayerIds.includes(id));
      if (!hit) return [];
      return [
        {
          layer: { id: hit },
          properties: { [zoneKeyProperty(UNIT.unit)]: key, [zoneNameProperty(UNIT.unit)]: key },
        },
      ];
    },
    project: () => ({ x: 0, y: 0 }),
  };
  const fire = (type: string, e: unknown = { point: { x: 40, y: 40 } }) => {
    for (const l of listeners.get(type) ?? []) l(e);
  };
  (map as unknown as { fire: typeof fire }).fire = fire;
  return map;
}

describe("installPickMode — B3 interior-click regression", () => {
  it("an OUTLINE-ONLY unit (pre-fix `zoneUnitsFromBoot` shape) cannot be picked from its interior", () => {
    // the style only rendered `programarea_ln` (no fill layer at all) -- the pre-fix world.
    const map = fakeQueryMap(["programarea_ln"], "WGA");
    const fire = (map as unknown as { fire: (t: string, e?: unknown) => void }).fire;
    const changes: PickState[] = [];
    installPickMode(map, [UNIT], (s) => changes.push(s)); // UNIT carries no `fill`
    fire("click");
    expect(changes).toEqual([]); // "Add to places" stays disabled -- the exact bug
  });

  it("B3 fix: a unit carrying queryFillFor's invisible fill CAN be picked from its interior", () => {
    // the style now also rendered `programarea_fill` (zoneUnitsFromBoot's B3 fix).
    const map = fakeQueryMap(["programarea_ln", "programarea_fill"], "WGA");
    const fire = (map as unknown as { fire: (t: string, e?: unknown) => void }).fire;
    const withQueryFill: ZoneUnitSpec = {
      ...UNIT,
      fill: {
        keyProperty: zoneKeyProperty(UNIT.unit),
        stops: [],
        defaultColor: "#000000",
        opacity: 0,
        outlineColor: "#000000",
      },
    };
    const changes: PickState[] = [];
    installPickMode(map, [withQueryFill], (s) => changes.push(s));
    fire("click");
    expect(changes).toEqual([{ unit: "programarea", keys: ["WGA"] }]);
  });
});
