// A collection's `atlas:note`: the one sentence a collection wants seen where its credits are (AquaMaps:
// "Non-commercial use only ..."), not left in the README. Pure and total; the credits strip, the catalog
// card and the License modal all read it through here.
import type { StacCollection } from "./types";

/** a collection's `atlas:note`: a sentence the collection wants seen (AquaMaps: "Non-commercial use only
 * ..."), not buried in the license modal. */
export interface CollectionNote {
  text: string;
  /** true when the note is about non-commercial terms: the strip and the catalog card then show it as an
   * amber chip with a short label ahead of the sentence. */
  nonCommercial: boolean;
}

/** a note sentence as a note (whitespace collapsed; non-commercial flagged); `null` when blank. */
export function noteFromText(raw: unknown): CollectionNote | null {
  const text = typeof raw === "string" ? raw.replace(/\s+/g, " ").trim() : "";
  return text ? { text, nonCommercial: /non-?\s?commercial/i.test(text) } : null;
}

/** the note of a collection, or `null` when it has none (absent, not a string, or blank). */
export function noteOf(collection: StacCollection | null | undefined): CollectionNote | null {
  return noteFromText(collection?.["atlas:note"]);
}
