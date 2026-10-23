// atlas-8 review round 2, item 3a (follow-up to usability B1 / 0.10.25's `exclusive()`): the
// scores lens' click popup fetches its value by building the SAME shared `cell` view
// (`AnalysisSources#cellTiles`) a place analysis builds, then reading it (`cellValue()`) -- one
// statement per `await`, on the SAME engine whenever the caller shares one (the scores lens'
// singleton, `src/lens/scores/engine.ts`). Before this fix that sequence ran OUTSIDE
// `exclusive()`, so a click racing anything else that also rebuilds `cell` on this engine (the
// Table panel's single-cell species path, `speciesLoad.ts`) could read a `cell` view some OTHER
// caller had just repointed at a different tile -- the same class of bug `exclusive.ts`'s header
// documents for places.
//
// Pulled out of `state.svelte.ts#showCellPopup` into its own plain, Node-testable function (CLAUDE
// .md: "keep core logic in an exported function... a component/lens calls it") so
// `tests/analysis/concurrentCellClick.test.ts` can drive it against a REAL engine
// (`tests/analysis/nodeEngine.ts`) alongside a real place analysis, the same proof technique
// `exclusive.ts`'s own header describes.
import { exclusive } from "../../lib/analysis/exclusive";
import { cellValue, type SqlRunner, type Templates } from "../../lib/analysis/queries";

/** the slice of `AnalysisSources` this needs -- kept narrow so a test can hand it a fixture that
 * is not a real `AnalysisSources` instance if it ever needs to. */
export interface CellClickSources {
  readonly db: SqlRunner;
  readonly templates: Templates;
  cellTiles(tiles: readonly number[]): Promise<void>;
}

export interface CellClickOptions {
  cellId: number;
  /** the tile `cellId` lives on (`tileOf(cellId, grid)`) -- computed by the caller, which already
   * has the release's grid at hand. */
  tile: number;
  metricKey: string;
}

/**
 * The click popup's value for one cell -- `AnalysisSources#cellTiles` + `cellValue()`, as ONE unit
 * on `sources.db` (usability B1's rule: build-then-read never runs outside `exclusive()`).
 */
export function fetchCellValue(
  sources: CellClickSources,
  opts: CellClickOptions,
): Promise<number | null> {
  return exclusive(sources.db, async () => {
    await sources.cellTiles([opts.tile]);
    return cellValue(sources.db, sources.templates, {
      cellId: opts.cellId,
      metricKey: opts.metricKey,
    });
  });
}
