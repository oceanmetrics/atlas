// R3-W8 item 5 (Ben, 2026-09-25, verbatim): "still allow clickable selection (highlighted in pink
// as now) of either Cell or Program Area depending on Scores layer chosen, such that the last
// clicked element defaults to the current Report Place and therefore also the one applied to the
// Table tool... some care should be given to not wiping out existing selections that have been
// explicitly added to Places, but then a most recently selected slot that can be updated with
// subsequent selection."
//
// The rule, as ONE pure function so the Table subject line, the Report tab and the Places tab's
// own "Last clicked" row can never disagree about which of the two governs:
//
//   - a non-empty explicit Places list (drawn/typed/uploaded/zone-added, `sel.pl`) always wins --
//     the map click "Last clicked" slot (`sel.sel`) is never consulted while any place is listed;
//   - an EMPTY Places list falls back to the Last-clicked slot (`sel.sel`, parsed the SAME way the
//     scores lens' own click handler and popup already do -- `../../lens/scores/selection.ts`'s
//     `parseScoresSelection`, never a second parser of that token);
//   - "no clicked cell/zone either" is `{kind: "last-clicked", selection: null}` -- a caller decides
//     what to say about NOTHING being selected (the Table's empty state, the Report tab's chooser).
//
// `sel.sel` and `sel.pl` are already independent URL fields written by entirely separate code
// paths (Shell.svelte's map-click handler only ever calls `selStore.set({sel: ...})`; Places.svelte's
// add/remove/draw/upload mutations only ever call `selStore.set({pl: ...})`) -- this function does
// not need to (and cannot, being pure) enforce "a click never wipes the explicit list"; that
// invariant is a property of the CALLERS never cross-writing the other field, proven by
// tests/state/subjects.test.ts's "explicit list untouched by a click" case (same `places` in, same
// `places` out, regardless of what `sel.sel` says) and by the seeded fault
// `places-list-wiped-by-click` (a caller that regresses this by writing `pl: undefined` alongside
// `sel`, gated end-to-end by e2e/places.last-clicked.spec.ts).
import { parseScoresSelection, type ScoresSelection } from "../../lens/scores/selection";
import type { Place } from "../geo/placeCodec";
import type { Sel } from "./types";

export type ReportSubject =
  | { kind: "last-clicked"; selection: ScoresSelection }
  | { kind: "places"; items: readonly Place[] };

/**
 * What the Table subject line, the Flower tab and the Report tab all report on RIGHT NOW.
 * `places` is the ALREADY-DECODED explicit list (`placesFromHash(sel.pl)`) -- this function does no
 * decoding of its own, so every caller reads the SAME list `placesFromHash` produced, never a
 * second decode that could disagree with it.
 */
export function reportSubjects(sel: Pick<Sel, "sel">, places: readonly Place[]): ReportSubject {
  if (places.length > 0) return { kind: "places", items: places };
  return { kind: "last-clicked", selection: parseScoresSelection(sel.sel) };
}

/** R4-D: is the last-clicked cell/Program Area already an explicit place? Then the Report tool's
 * "Last clicked" row is hidden (it would offer to add what is already listed). A zone matches by key;
 * a cell matches the `Cell <id>` geometry place `placeFromLastClicked()` appends for it. */
export function lastClickedInPlaces(selection: ScoresSelection, places: readonly Place[]): boolean {
  if (!selection) return false;
  if (selection.kind === "zone") {
    return places.some((p) => p.kind === "zone" && p.keys.includes(selection.key));
  }
  return places.some((p) => p.kind === "geom" && p.name === `Cell ${selection.cellId}`);
}

/** R4-D (Ben, 2026-09-30): the Report tool's pinned footer sentence, driven by the SAME
 * `reportSubjects()` result the Last-clicked row and the Table's subject line read, so the three can
 * never disagree. Three cases: an explicit list ("Reporting on 2 places."), a last click not yet in
 * the list, and nothing at all (the Open report button is disabled, and this sentence says why). */
export function reportSubjectSentence(subject: ReportSubject): string {
  if (subject.kind === "places") {
    return `Reporting on ${subject.items.length} place${subject.items.length === 1 ? "" : "s"}.`;
  }
  return subject.selection
    ? "Reporting on the last clicked place. Add it to keep it."
    : "Add a place to open a report.";
}
