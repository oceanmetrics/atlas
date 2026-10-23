// atlas-3 spec.md §5.5: the species card shows one chip per statute, ALWAYS both, so absence is
// never ambiguous (Ben, 2026-09-21: "Showing 'MMPA' does not make sense for a Leatherback Turtle
// card, unless it says 'not applicable' like the MBTA"). Extracted so the rule -- which statute
// governs which sp_cat, and the exact floor each one asserts -- has one tested home instead of
// living inline in a card component where a future edit could silently drop the Leatherback case.
export type Statute = "MMPA" | "MBTA";

/** the extinction-risk floor msens::compute_er_score() applies for each statute (spec.md §5.5) */
const FLOOR: Record<Statute, number> = { MMPA: 20, MBTA: 10 };

/** the one msens `sp_cat` each statute governs */
const GOVERNS: Record<Statute, string> = { MMPA: "mammal", MBTA: "bird" };

/**
 * The exact label a protection chip renders for one statute against one species' `sp_cat`. A
 * statute never invents a floor for a category it does not cover -- that is the bug this function
 * exists to make permanently unrepeatable (a Leatherback Turtle, `sp_cat === "turtle"`, must never
 * read "MMPA · floor 20").
 */
export function protectionChipLabel(statute: Statute, spCat: string): string {
  return spCat === GOVERNS[statute]
    ? `${statute} · floor ${FLOOR[statute]}`
    : `${statute} · not applicable`;
}
