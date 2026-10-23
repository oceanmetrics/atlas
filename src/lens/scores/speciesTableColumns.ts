// P3 fix (owner-reported, 2026-09-24): "Table is an absurdity of unintelligible ellipses" -- 12
// columns squeezed into a 390px phone panel gave every header/cell ~2 characters ("Cat… Taxo…
// Scie…"). Fix (decided, docs/usability.md M6): on phone widths the species table opens with a
// CURATED six-column default, reachable/expandable through a "Columns" control; desktop always
// shows every column. Pure so the rule is provable without mounting SpeciesTable.svelte -- the
// component only calls it (CLAUDE.md).
import { viewportBucket } from "../../lib/ui/panelGeometry";

/** the six columns shown by default on a phone-width table -- everything else is one tap away
 * behind the "Columns" control. Order matches `SpeciesTable.svelte`'s own `columns` array. */
export const SPECIES_PHONE_DEFAULT_COLUMNS: readonly string[] = [
  "cat",
  "scientific",
  "common",
  "er_code",
  "er_score",
  "area_km2",
];

/**
 * The species table's visible column KEYS, in `allKeys`' own order.
 * - desktop (`panelGeometry.ts#viewportBucket(widthPx) === "desktop"`, i.e. >= 900px): every
 *   column, regardless of `chosen` -- the phone picker never applies there.
 * - phone, no user choice yet (`chosen === null`): the curated {@link SPECIES_PHONE_DEFAULT_COLUMNS}.
 * - phone, the user opened "Columns" and picked some: exactly `chosen`, in `allKeys`' order (an
 *   empty set is the user's own choice, not a bug -- the caller renders "no columns selected"
 *   rather than silently reverting to the default).
 */
export function visibleSpeciesColumnKeys(
  allKeys: readonly string[],
  widthPx: number,
  chosen: ReadonlySet<string> | null,
): string[] {
  if (viewportBucket(widthPx) === "desktop") return [...allKeys];
  const wanted = chosen ?? new Set(SPECIES_PHONE_DEFAULT_COLUMNS);
  return allKeys.filter((k) => wanted.has(k));
}
