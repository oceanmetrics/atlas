// A pinned split resolution over a wide view (obis-hex `planView`'s MAX_PARENTS fallback): src/lens/collection/h3/
// share.ts `pinForView`, `boxKm2`.
import { describe, expect, it } from "vitest";
import { boxKm2, MAX_PARENTS, pinForView } from "../../src/lens/collection/h3/share";

const PR = { "6": 2, "7": 3 };

describe("a pinned resolution", () => {
  it("coarser res and the notice: res 7 over a wide view steps down until the parents fit", () => {
    // a 20° x 15° box off California, about 3.1 million km²: 248 res-3 parents (12,393 km²), 36 res-2 (86,802 km²)
    const km2 = boxKm2(-130, 25, -110, 40);
    expect(Math.round(km2 / 1e5)).toBe(31);
    expect(pinForView(7, PR, km2)).toEqual({
      res: 6,
      note: "Res 7 needs more than 64 parent files for this view: showing res 6. Zoom in for res 7.",
    });
    // the globe: down to the finest whole resolution
    expect(pinForView(7, PR, boxKm2(-180, -85, 180, 85)).res).toBe(5);
    expect(pinForView(6, PR, boxKm2(-180, -85, 180, 85)).note).toMatch(
      /^Res 6 needs more than 64 .*showing res 5\./,
    );
  });
  it("a view that needs few parents, a whole resolution and auto are never stepped", () => {
    expect(pinForView(7, PR, boxKm2(-122.5, 36.4, -121.7, 37.1))).toEqual({ res: 7, note: null });
    expect(pinForView(5, PR, boxKm2(-180, -85, 180, 85))).toEqual({ res: 5, note: null });
    expect(pinForView("auto", PR, 1e9)).toEqual({ res: "auto", note: null });
    expect(pinForView(7, null, 1e9)).toEqual({ res: 7, note: null });
    expect(MAX_PARENTS).toBe(64);
  });
});
