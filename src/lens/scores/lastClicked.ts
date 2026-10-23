// R3-W8 item 5 fix round (Ben, verbatim): "the last clicked element defaults to the current Report
// Place." This module turns the Scores lens' own Last-clicked slot (`ScoresSelection` -- exactly
// what `reportSubjects()`'s `selection` field carries when its `kind` is "last-clicked",
// `src/lib/state/subjects.ts`) into the label the Report pane's "Last clicked" row shows, through
// the SAME `formatSubject()`/`paLabel()` every other panel (the map popup, the flower title, the
// species table header) already uses for the identical selection -- never a second phrasing of the
// same subject.
//
// The "Add to places" mutation (the `Place` it appends) is a SEPARATE module,
// `lastClickedPlace.ts`, dynamically imported only when that button is actually pressed: it pulls
// in `places/geomPlace.ts` -> `lib/analysis/place.ts` (the encode/decode/simplify pipeline every
// drawn place already goes through), which is heavy enough that statically importing it here
// pushed `scripts/size-budget.mjs`'s 450 KB static-critical-path budget over by ~4 KB (this row's
// own label needs none of that weight -- it never touches the place codec at all).
import { formatSubject } from "../../lib/format";
import { gridFromBoot } from "../../lib/grid/grid";
import { paLabel } from "../../places/zoneStats";
import { cellRing, type ScoresSelection } from "./selection";
import { zoneRows } from "./boot";

/** the Report pane's "Last clicked" row label -- `null` when nothing has been clicked (item 5's
 * own spec: "Hide the row when nothing is clicked") or `boot` has not resolved yet (there is
 * nothing to look a zone name up in, nor a grid to place a cell in, until it has). */
export function lastClickedLabel(selection: ScoresSelection, boot: unknown): string | null {
  if (!selection || !boot || typeof boot !== "object") return null;
  if (selection.kind === "cell") {
    const { lon, lat } = cellRing(selection.cellId, gridFromBoot(boot));
    return formatSubject({ kind: "cell", cellId: selection.cellId, lon, lat });
  }
  const row = zoneRows(boot, selection.unit).find((z) => z.key === selection.key);
  return formatSubject({ kind: "zone", name: paLabel(selection.key, row?.name, selection.unit) });
}
