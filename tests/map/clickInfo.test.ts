// WP11 item 3: ONE popup when an overlay feature and a hex cell share the pointer. The rules: the hex
// layer stays quiet where an overlay is, and offers its cell line to the overlay's card; the card lists
// the place first, the cell value under it; the cell selection (the hex layer's own click) still fires.
import { afterEach, describe, expect, it } from "vitest";
import {
  cellLineAt,
  overlayAt,
  registerCellLine,
  registerOverlayProbe,
} from "../../src/lib/map/clickInfo";
import {
  HEX_FILL_ID,
  installHexInteraction,
  type HexInteractionMap,
} from "../../src/lib/map/layers/hex";
import { overlayCardLines, overlayFeatureInfo } from "../../src/places/overlayInteraction";

const cleanups: (() => void)[] = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

describe("the registry", () => {
  it("answers false / null when nothing is registered, and what the registrant says otherwise", () => {
    expect(overlayAt({ x: 1, y: 1 })).toBe(false);
    expect(cellLineAt({ x: 1, y: 1 })).toBeNull();
    cleanups.push(registerOverlayProbe((p) => p.x === 5));
    cleanups.push(registerCellLine((p) => (p.x === 5 ? "Cell 7: 0.42" : null)));
    expect(overlayAt({ x: 5, y: 0 })).toBe(true);
    expect(overlayAt({ x: 6, y: 0 })).toBe(false);
    expect(cellLineAt({ x: 5, y: 0 })).toBe("Cell 7: 0.42");
  });
  it("a stale unregister never removes a newer registration", () => {
    const off1 = registerCellLine(() => "old");
    const off2 = registerCellLine(() => "new");
    cleanups.push(off2);
    off1();
    expect(cellLineAt({ x: 0, y: 0 })).toBe("new");
  });
  it("a probe that throws (a click racing a style swap) is a miss", () => {
    cleanups.push(
      registerOverlayProbe(() => {
        throw new Error("style swap");
      }),
    );
    expect(overlayAt({ x: 0, y: 0 })).toBe(false);
  });
});

describe("the overlay card: the place on top, the cell value line under it", () => {
  const sanctuary = overlayFeatureInfo(
    { place_id: "NMS:SBNMS", name: "Stellwagen Bank", status: "active" },
    "MultiPolygon",
  );
  it("name and status, the Add button, then the cell line", () => {
    expect(overlayCardLines(sanctuary, "Cell 12: 0.42")).toEqual([
      { kind: "name", text: "Stellwagen Bank (active)" },
      {
        kind: "add",
        text: "Add Stellwagen Bank to Places",
        placeId: "NMS:SBNMS",
        name: "Stellwagen Bank",
      },
      { kind: "cell", text: "Cell 12: 0.42" },
    ]);
  });
  it("no cell under the point: no cell line (the card is what it was)", () => {
    expect(overlayCardLines(sanctuary, null).map((l) => l.kind)).toEqual(["name", "add"]);
  });
  it("a line feature says only areas can be added, and still carries the cell line", () => {
    const line = overlayFeatureInfo({ place_id: "L:1", name: "Cable" }, "LineString");
    expect(overlayCardLines(line, "Cell 3: no value").map((l) => l.kind)).toEqual([
      "name",
      "note",
      "cell",
    ]);
  });
});

// a fake map: records listeners, answers queryRenderedFeatures with the cell under the point
function fakeMap(fid: number | null) {
  const listeners = new Map<string, (e: never) => void>();
  const map: HexInteractionMap = {
    on: (type, _layer, l) => void listeners.set(type, l),
    off: (type) => void listeners.delete(type),
    getCanvas: () => ({ style: { cursor: "" } }),
    queryRenderedFeatures: (_g, o) =>
      o.layers[0] === HEX_FILL_ID && fid !== null ? [{ id: fid }] : [],
  };
  return { map, listeners };
}

describe("the hex layer beside an overlay", () => {
  it("offers its cell line (the hover text) to the overlay card, and withdraws it on destroy", () => {
    const { map } = fakeMap(12);
    const hex = installHexInteraction(map, {
      valueOf: () => 0.42,
      format: (v) => v.toFixed(2),
      extra: () => "9 likely species",
      onClick: () => {},
    });
    expect(cellLineAt({ x: 1, y: 1 })).toBe("Cell 12: 0.42 · 9 likely species");
    hex.destroy();
    expect(cellLineAt({ x: 1, y: 1 })).toBeNull();
  });
  it("no cell under the point: no line; a place pick session owns the click: no line", () => {
    let owned = false;
    const none = fakeMap(null);
    const h1 = installHexInteraction(none.map, { valueOf: () => 1, onClick: () => {} });
    expect(cellLineAt({ x: 1, y: 1 })).toBeNull();
    h1.destroy();
    const some = fakeMap(3);
    const h2 = installHexInteraction(some.map, {
      valueOf: () => 1,
      isOwned: () => owned,
      onClick: () => {},
    });
    expect(cellLineAt({ x: 1, y: 1 })).toBe("Cell 3: 1");
    owned = true;
    expect(cellLineAt({ x: 1, y: 1 })).toBeNull();
    h2.destroy();
  });
  it("hovering where an overlay is: the hex popup stays away (the overlay's carries the cell)", () => {
    const { map, listeners } = fakeMap(12);
    cleanups.push(registerOverlayProbe(() => true));
    const hex = installHexInteraction(map, { valueOf: () => 0.42, onClick: () => {} });
    // no document in the node environment: a hex popup would throw on setText, so reaching the end
    // of the handler without a throw is the proof that none was built
    listeners.get("mousemove")?.({
      features: [{ id: 12 }],
      lngLat: { lng: 0, lat: 0 },
      point: { x: 1, y: 1 },
    } as never);
    hex.destroy();
  });
  it("clicking where an overlay is still selects the cell (the panel selection updates)", () => {
    const { map, listeners } = fakeMap(12);
    cleanups.push(registerOverlayProbe(() => true));
    const clicks: unknown[] = [];
    const hex = installHexInteraction(map, {
      valueOf: () => 0.42,
      onClick: (c) => clicks.push(c),
    });
    listeners.get("click")?.({
      features: [{ id: 12 }],
      lngLat: { lng: -70, lat: 42 },
      point: { x: 1, y: 1 },
    } as never);
    expect(clicks).toEqual([{ fid: 12, value: 0.42, lngLat: [-70, 42] }]);
    hex.destroy();
  });
});
