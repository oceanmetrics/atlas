// `analyticsGaId()` (src/lib/analytics/gaId.ts): no GA4 id ships in this repo -- it comes from the
// build-time `VITE_GA_ID` variable, and anything unset or malformed resolves to "" (GA leg off).
import { afterEach, describe, expect, it, vi } from "vitest";
import { analyticsGaId } from "../../src/lib/analytics/gaId";

describe("analyticsGaId", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('unset VITE_GA_ID -> "" (GA off)', () => {
    vi.stubEnv("VITE_GA_ID", undefined);
    expect(analyticsGaId()).toBe("");
  });

  it('the empty string an unset GitHub Actions repository variable resolves to -> ""', () => {
    vi.stubEnv("VITE_GA_ID", "");
    expect(analyticsGaId()).toBe("");
  });

  it("a well-formed G- id passes through, trimmed", () => {
    vi.stubEnv("VITE_GA_ID", "  G-ABC123DEF4 ");
    expect(analyticsGaId()).toBe("G-ABC123DEF4");
  });

  it('a malformed id fails closed to ""', () => {
    for (const bad of ["UA-12345-1", "G-", "g-abc123def4", "https://x.test", "G-AB"]) {
      vi.stubEnv("VITE_GA_ID", bad);
      expect(analyticsGaId(), bad).toBe("");
    }
  });
});
