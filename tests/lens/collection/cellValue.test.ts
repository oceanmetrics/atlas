import { describe, expect, it } from "vitest";
import { formatCellValue } from "../../../src/lens/collection/mapInputs";
import { hexHoverText } from "../../../src/lib/map/layers/hex";

describe("formatCellValue (hover and cell panel)", () => {
  it("two decimals", () => {
    expect(formatCellValue(0.4237)).toBe("0.42");
    expect(formatCellValue(1)).toBe("1.00");
    expect(formatCellValue(0)).toBe("0.00");
    expect(formatCellValue(-0.5)).toBe("-0.50");
  });
  it("falls back to three significant figures where two decimals would hide the value", () => {
    expect(formatCellValue(0.0012)).toBe("0.0012");
    expect(formatCellValue(1500.7)).toBe("1500");
    expect(formatCellValue(Number.NaN)).toBe("");
  });
});

describe("hexHoverText with the species count", () => {
  it("appends the extra after a middle dot, only when there is one", () => {
    expect(hexHoverText(7, 0.5, formatCellValue, "12 likely species")).toBe(
      "Cell 7: 0.50 · 12 likely species",
    );
    expect(hexHoverText(7, 0.5, formatCellValue, null)).toBe("Cell 7: 0.50");
    expect(hexHoverText(7, null, formatCellValue, "0 likely species")).toBe(
      "Cell 7: no value · 0 likely species",
    );
  });
});
