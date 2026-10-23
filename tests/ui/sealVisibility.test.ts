// atlas-3 spec.md §9 / D10 seeded fault: "the seal renders when VITE_SEAL is unset" must turn a
// test red. This is that test, at the logic level (tests/e2e/gallery.spec.ts repeats it against
// the real rendered About component).
import { describe, expect, it } from "vitest";
import {
  agencyDisplayName,
  sealClearSpacePx,
  SEAL_MIN_PX,
  shouldShowSeal,
} from "../../src/lib/ui/sealVisibility";

describe("agencyDisplayName", () => {
  it("MMA resolves to the seal's own spelling, 'Marine Minerals Administration'", () => {
    expect(agencyDisplayName("MMA")).toBe("Marine Minerals Administration");
  });

  it("BOEM resolves to its full name", () => {
    expect(agencyDisplayName("BOEM")).toBe("Bureau of Ocean Energy Management");
  });

  it("an empty agency resolves to null (no lockup the guide recognizes)", () => {
    expect(agencyDisplayName("")).toBeNull();
  });

  it("undefined and an unrecognized code both resolve to null, never a guess", () => {
    expect(agencyDisplayName(undefined)).toBeNull();
    expect(agencyDisplayName("SOME_FUTURE_AGENCY")).toBeNull();
  });
});

describe("shouldShowSeal (the seeded fault: never render when VITE_SEAL is unset)", () => {
  it('shows the seal only when VITE_SEAL is exactly "1" AND the agency resolves', () => {
    expect(shouldShowSeal("1", "MMA")).toBe(true);
  });

  it("VITE_SEAL unset (undefined) never shows the seal -- the seeded fault, red by default", () => {
    expect(shouldShowSeal(undefined, "MMA")).toBe(false);
  });

  it("VITE_SEAL='0' never shows the seal", () => {
    expect(shouldShowSeal("0", "MMA")).toBe(false);
  });

  it("any other VITE_SEAL value fails closed", () => {
    expect(shouldShowSeal("true", "MMA")).toBe(false);
    expect(shouldShowSeal("yes", "MMA")).toBe(false);
  });

  it("VITE_SEAL='1' with an empty or unrecognized agency still shows no seal", () => {
    expect(shouldShowSeal("1", "")).toBe(false);
    expect(shouldShowSeal("1", undefined)).toBe(false);
    expect(shouldShowSeal("1", "NOT_A_REAL_AGENCY")).toBe(false);
  });
});

describe("the seal's minimum size and clear space (spec.md §5/§9, guide p. 4)", () => {
  it("SEAL_MIN_PX is 72, matching tokens.css's --size-seal-min", () => {
    expect(SEAL_MIN_PX).toBe(72);
  });

  it("clear space is a quarter of the seal's own height", () => {
    expect(sealClearSpacePx(72)).toBe(18);
    expect(sealClearSpacePx(SEAL_MIN_PX)).toBe(18);
  });
});
