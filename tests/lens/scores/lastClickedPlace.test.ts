// R3-W8 item 5 fix round: `placeFromLastClicked` -- the `Place` the Places tab's "Add to places"
// button appends. See lastClickedPlace.ts's own header for why this is its own module, reached only
// via a dynamic `import()` from Shell.svelte (never statically -- it pulls in the place codec's
// heavier encode/decode/simplify pipeline).
import { describe, expect, it } from "vitest";
import { placeFromLastClicked } from "../../../src/lens/scores/lastClickedPlace";
import { cellSquare } from "../../../src/places/cellSquares";
import { BOOT_V7 } from "./fixtures";

describe("placeFromLastClicked", () => {
  it("null selection: null", () => {
    expect(placeFromLastClicked(null, BOOT_V7)).toBeNull();
  });

  it("boot not resolved yet: null, never a throw", () => {
    expect(
      placeFromLastClicked({ kind: "zone", unit: "programarea", key: "GAA" }, null),
    ).toBeNull();
  });

  it("a clicked zone: a ZonePlace, the SAME shape addZonePlace() builds", () => {
    expect(
      placeFromLastClicked({ kind: "zone", unit: "programarea", key: "GAA" }, BOOT_V7),
    ).toEqual({
      kind: "zone",
      set: "pa",
      keys: ["GAA"],
    });
  });

  it("a clicked cell: a GeomPlace over the cell's own square (cellSquare())", () => {
    const place = placeFromLastClicked({ kind: "cell", cellId: 1 }, BOOT_V7);
    expect(place?.kind).toBe("geom");
    if (place?.kind !== "geom") throw new Error("expected a geom place");
    expect(place.name).toBe("Cell 1");
    // analysisGeometry() (geomPlaceFrom's own decode(encode(...)) step) may re-simplify/re-round
    // the ring, so this checks the ENCODED geometry's bbox matches the raw square's, not a literal
    // coordinate-for-coordinate match.
    const raw = cellSquare(1, {
      gridId: "usa05",
      nc: 3103,
      nr: 2006,
      xmin: 141.1,
      ymax: 82.6,
      resx: 0.05,
      resy: 0.05,
      lon360: true,
      tileSize: 50,
    });
    const rawLons: number[] = raw.coordinates[0]!.map((p) => p[0]!);
    const rawLats: number[] = raw.coordinates[0]!.map((p) => p[1]!);
    if (place.geometry.type !== "Polygon") throw new Error("expected a Polygon geometry");
    const ring = place.geometry.coordinates[0]!;
    const placeLons = ring.map((p) => p[0]);
    const placeLats = ring.map((p) => p[1]);
    expect(Math.min(...placeLons)).toBeCloseTo(Math.min(...rawLons), 2);
    expect(Math.max(...placeLons)).toBeCloseTo(Math.max(...rawLons), 2);
    expect(Math.min(...placeLats)).toBeCloseTo(Math.min(...rawLats), 2);
    expect(Math.max(...placeLats)).toBeCloseTo(Math.max(...rawLats), 2);
  });

  it("a zone unit with no codec ZoneSet mapping: null (defensive, structurally unreachable)", () => {
    expect(placeFromLastClicked({ kind: "zone", unit: "bogus", key: "X" }, BOOT_V7)).toBeNull();
  });
});
