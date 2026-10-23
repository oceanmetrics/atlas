// places/studyArea.ts -- Deliverable 4 rule 10 ("must touch the release's study area (`in_usa`
// cells)") and D7b's clip, over a normalized place. This is the "caller's check" `geo/upload/
// normalize.ts` documents (`NormalizeOptions.studyArea`) -- but that hook's own type is SYNCHRONOUS
// (`(places) => Refusal | null`), while the real answer needs a network round trip (fetching the
// release's own `cell` tiles) through the engine. So this is NOT wired as that callback: it runs as
// a separate async step AFTER `normalizeUpload()`/`parseCoordinateEntry()` already returned
// `{ok: true}`, before the resulting places are added to `#pl=` -- the panel calls both in
// sequence, and the user sees the identical shape of refusal either way (a `Refusal`, rendered the
// same). `NormalizeOptions.studyArea`'s own doc comment says this hook is optional and "the check
// simply does not run" without it; running the SAME rule just outside that parameter is what the
// synchronous/asynchronous mismatch requires.
import { placeCells, tilesForCells } from "../lib/analysis/place";
import { exclusive } from "../lib/analysis/exclusive";
import { createPlaceCells, createStudyAreaCells } from "../lib/analysis/queries";
import type { DataEngineContext } from "./dataEngine";
import type { NormalizedPlace } from "../lib/geo/upload/normalize";
import type { Refusal } from "../lib/geo/upload/types";

const R = (rule: string, what: string, why: string, fix: string): Refusal => ({
  rule,
  what,
  why,
  fix,
});

export const outsideUsWaters = (name: string): Refusal =>
  R(
    "outsideStudyArea",
    `"${name}" does not touch any cell inside this release's US study area.`,
    "Every score and species figure this app computes is clipped to the study area (the published zone method, master plan D7b) — a place entirely outside it has nothing to average, so it would otherwise show a row of zeros rather than a real absence.",
    "Draw or upload a place that overlaps US waters, or check the coordinates for a sign or units mistake (a common cause: longitude entered as positive east when the file meant west).",
  );

/**
 * `true` when at least one of `place`'s cells is inside the release's study area (D7b's
 * `cells_in_study_area.sql`, `coalesce(in_usa, TRUE)`). Fetches only the `cell` tiles this ONE
 * place touches (materialize-then-query, plan D3) — never the whole release.
 */
export async function touchesStudyArea(
  ctx: DataEngineContext,
  place: NormalizedPlace,
): Promise<boolean> {
  const cells = placeCells(place.geometry, ctx.grid);
  if (!cells.length) return false;
  // usability B1: this rewrites the same `cell`/`place_cell`/`place_cell_sa` a running place
  // analysis reads -- an upload arriving mid-analysis used to hand that place THIS place's cells
  return exclusive(ctx.sources.db, async () => {
    await ctx.sources.cellTiles(tilesForCells(cells, ctx.grid));
    await createPlaceCells(ctx.sources.db, cells);
    const n = await createStudyAreaCells(ctx.sources.db, ctx.sources.templates);
    return n > 0;
  });
}

/**
 * The panel's actual rule-10 gate: every place in `places` must touch the study area, or the WHOLE
 * batch is refused (naming the first offender) -- consistent with `normalizeParsed`'s own "one
 * refusal, not a list" rule (geo/upload/normalize.ts's header) and with never adding a place with
 * nothing to score. `null` means every place passed.
 */
export async function checkTouchesStudyArea(
  ctx: DataEngineContext,
  places: readonly NormalizedPlace[],
): Promise<Refusal | null> {
  for (const place of places) {
    if (!(await touchesStudyArea(ctx, place))) return outsideUsWaters(place.name);
  }
  return null;
}
