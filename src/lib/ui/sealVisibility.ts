// atlas-3 spec.md §9 / plan D10: the seal appears in exactly three surfaces, always behind a build
// flag, and never below its minimum size or without an agency line. Extracted from the About
// component so "does the seal render" is one tested rule instead of a component-local `{#if}`
// nobody re-derives correctly next time.
//
// VITE_AGENCY mirrors server/branding/make_branding.py's AGENCY ("MMA" | "BOEM" | ""); the display
// name here uses the SEAL's own spelling ("Marine Minerals Administration", D10), not the guide's
// body-text spelling ("Marine Mineral Administration").
const AGENCY_NAMES: Record<string, string> = {
  MMA: "Marine Minerals Administration",
  BOEM: "Bureau of Ocean Energy Management",
};

/**
 * The full agency name the seal/About line uses, or `null` if the code names no agency at all
 * (spec.md §9: `VITE_AGENCY=""` implies no seal-eligible lockup) or is not one this app
 * recognizes. Fails closed -- an unrecognized code never falls back to guessing a name.
 */
export function agencyDisplayName(agency: string | undefined): string | null {
  if (!agency) return null;
  return AGENCY_NAMES[agency] ?? null;
}

/**
 * Whether the seal may render at all. Both conditions are required (spec.md §9, D10):
 *   - `VITE_SEAL` is exactly the string `"1"` (unset, `"0"`, or any other value fails closed);
 *   - the agency code resolves to a real name (an agency-free build is not a lockup the guide
 *     recognizes, so it never gets a seal either).
 * This is the seeded-fault gate for "the seal renders when VITE_SEAL is unset."
 */
export function shouldShowSeal(sealFlag: string | undefined, agency: string | undefined): boolean {
  return sealFlag === "1" && agencyDisplayName(agency) !== null;
}

/** spec.md §5 / tokens.css `--size-seal-min`: the seal is never smaller than this, in CSS px. This
 * is the one place that number is allowed to live outside tokens.css itself (it names a rule about
 * the seal, not a color, so it is not something check-hex-literals.mjs polices). */
export const SEAL_MIN_PX = 72;

/** the clear space the guide requires on every side: a quarter of the seal's own height (p. 4). */
export function sealClearSpacePx(sealSizePx: number): number {
  return sealSizePx / 4;
}
