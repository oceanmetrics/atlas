import { describe, expect, it } from "vitest";
import {
  cellRing,
  formatCellToken,
  formatZoneToken,
  parseScoresSelection,
} from "../../../src/lens/scores/selection";
import type { GridSpec } from "../../../src/lib/grid/grid";

const GRID: GridSpec = {
  gridId: "usa05",
  nc: 3103,
  nr: 2006,
  xmin: 141.1,
  ymax: 82.6,
  resx: 0.05,
  resy: 0.05,
  lon360: true,
  tileSize: 50,
};

describe("parseScoresSelection", () => {
  it("undefined: null", () => {
    expect(parseScoresSelection(undefined)).toBeNull();
  });

  it("cell:<id>", () => {
    expect(parseScoresSelection("cell:12345")).toEqual({ kind: "cell", cellId: 12345 });
  });

  it("zone:<unit>:<key>", () => {
    expect(parseScoresSelection("zone:programarea:GAA")).toEqual({
      kind: "zone",
      unit: "programarea",
      key: "GAA",
    });
  });

  it("a malformed cell id: null, never a throw", () => {
    expect(parseScoresSelection("cell:notanumber")).toBeNull();
  });

  it("round-trips through the formatters", () => {
    expect(parseScoresSelection(formatCellToken(42))).toEqual({ kind: "cell", cellId: 42 });
    expect(parseScoresSelection(formatZoneToken("programarea", "GAA"))).toEqual({
      kind: "zone",
      unit: "programarea",
      key: "GAA",
    });
  });
});

describe("cellRing", () => {
  it("centres on the cell, half-extents from the grid resolution", () => {
    const ring = cellRing(1, GRID);
    expect(ring.halfW).toBeCloseTo(0.025);
    expect(ring.halfH).toBeCloseTo(0.025);
    // cell 1 is row 1, col 1 -> lon = xmin + 0.5*resx (unwrapped into -180..180 since xmin=141.1
    // is already < 180 for col 1)
    expect(ring.lon).toBeCloseTo(141.125);
    expect(ring.lat).toBeCloseTo(82.575);
  });
});
