// which views are RESTRICTED: a collection under review that must never reach a public place (a
// GitHub issue, a screenshot committed to the repo, the zero-backend "new issue" link).
//
// A collection is restricted when it is
//   - in the "unlisted" picker group: it was loaded through a `?collection=<url>` share link
//     (`load.ts`), whose URL is the only thing that keeps it private (the unlisted prefix), or
//   - declares `atlas:access: "restricted"` (the pipeline's restricted builders write it), however it
//     was reached (a `?catalog=` override pointed at a restricted prefix, a future listed copy).
// A VIEW is restricted when its URL carries either data-origin override (`?collection=`, `?catalog=`:
// a private share link or a staging folder, the same two keys analytics never sends,
// `analytics/pageLocation.ts`) or the Collections lens is showing a restricted collection.
//
// Regression (0.3.4): Shell.svelte passed no `access` to the feedback dialog, so a report sent from
// an unlisted collection was filed as a public GitHub issue with a screenshot of it.
// tests/feedback/restrictedCollection.test.ts; seeded fault
// tests/faults/feedback-unlisted-not-restricted.patch.
import type { CatalogGroup } from "./load";
import type { StacCollection } from "./types";

export type ViewAccess = "public" | "restricted";

/** the part of a `CollectionEntry` the rule reads. */
export interface AccessEntry {
  group: CatalogGroup;
  collection: Pick<StacCollection, "atlas:access"> | null;
}

/** `"restricted"` for an unlisted (shared-by-link) collection or one declaring
 * `atlas:access: "restricted"`; `"public"` otherwise, including no entry at all. */
export function collectionAccess(entry: AccessEntry | null | undefined): ViewAccess {
  if (!entry) return "public";
  if (entry.group === "unlisted") return "restricted";
  if (entry.collection?.["atlas:access"] === "restricted") return "restricted";
  return "public";
}

export interface ViewAccessInput {
  lens: string;
  /** `sel.collection`: the validated `?collection=` share link, if any. */
  collectionParam?: string | null;
  /** `sel.catalog`: the validated `?catalog=` override, if any. */
  catalogParam?: string | null;
  /** the Collections lens' active entry (ignored in any other lens). */
  entry?: AccessEntry | null;
}

/** the access of what the page shows and links to right now -- see the module header. */
export function viewAccess(input: ViewAccessInput): ViewAccess {
  if (input.collectionParam) return "restricted";
  if (input.catalogParam) return "restricted";
  if (input.lens === "collection") return collectionAccess(input.entry);
  return "public";
}

/** the query keys a restricted view's page link never carries outside the device (the share link and
 * the catalog override) -- the same two `analytics/pageLocation.ts` leaves out. */
export const PRIVATE_QUERY_KEYS = ["collection", "catalog"] as const;

/** `search` without {@link PRIVATE_QUERY_KEYS} when `access` is restricted; unchanged otherwise.
 * Accepts and returns a leading `?` (or none, when nothing is left). */
export function searchForAccess(search: string, access: ViewAccess): string {
  if (access !== "restricted") return search;
  const params = new URLSearchParams(search);
  for (const k of PRIVATE_QUERY_KEYS) params.delete(k);
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}
