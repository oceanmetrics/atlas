// atlas-3 spec.md §5.5, and the regression this permanently closes (Ben, 2026-09-21): a Leatherback
// Turtle card must never read "MMPA · floor 20". One fixture per sp_cat/statute combination, not
// one broad end-to-end check, per this repo's rule that regression cases are permanent and named.
import { describe, expect, it } from "vitest";
import { protectionChipLabel } from "../../src/lib/ui/protectionChip";

describe("protectionChipLabel", () => {
  it("MMPA applies to a marine mammal", () => {
    expect(protectionChipLabel("MMPA", "mammal")).toBe("MMPA · floor 20");
  });

  it("MBTA applies to a bird", () => {
    expect(protectionChipLabel("MBTA", "bird")).toBe("MBTA · floor 10");
  });

  it("regression: a Leatherback Turtle (sp_cat 'turtle') gets 'not applicable' for MMPA, not a floor", () => {
    expect(protectionChipLabel("MMPA", "turtle")).toBe("MMPA · not applicable");
  });

  it("a turtle also gets 'not applicable' for MBTA", () => {
    expect(protectionChipLabel("MBTA", "turtle")).toBe("MBTA · not applicable");
  });

  it("MMPA does not apply to a bird", () => {
    expect(protectionChipLabel("MMPA", "bird")).toBe("MMPA · not applicable");
  });

  it("MBTA does not apply to a mammal", () => {
    expect(protectionChipLabel("MBTA", "mammal")).toBe("MBTA · not applicable");
  });

  it("neither statute applies to fish, coral, invertebrates or primary producers", () => {
    for (const spCat of ["fish", "coral", "invertebrate", "primprod", "other"]) {
      expect(protectionChipLabel("MMPA", spCat)).toBe("MMPA · not applicable");
      expect(protectionChipLabel("MBTA", spCat)).toBe("MBTA · not applicable");
    }
  });

  it("never invents a floor for a category outside FLOOR's own table (defensive: unknown category)", () => {
    expect(protectionChipLabel("MMPA", "unknown-future-category")).toBe("MMPA · not applicable");
  });
});
