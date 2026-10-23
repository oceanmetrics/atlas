// U6 (round 2): "Report" does the obvious thing with what is currently selected, instead of the
// placeholder `activeTool = "report"` the top-bar button and the rail tool used to both be
// (docs/usability.md M1). Pure logic only -- no DOM, no svelte -- so it is callable from a test
// (CLAUDE.md: "keep core logic in an exported function... a component only calls it"); Shell.svelte
// and ReportTool.svelte both call `reportAction()` and never re-derive its rule.
//
// Reuses the SAME encoders the rest of the report flow already settled on: `reportHash()`
// (src/places/model.ts, the B2 fix -- one layer of percent-encoding, matching report.html's
// `URLSearchParams` decode) for a place LIST already in `sel.pl`, and `hashFromPlaces()` +
// `zoneSetForUnit()` (the same pair `TablePanel.svelte`'s "Report on selected" and
// `Places.svelte`'s own zone-place add already use) for a single zone selected via `sel=zone:…`.
// Nothing here invents a third encoding.
import { hashFromPlaces, reportHash, zoneSetForUnit } from "../places/model";
import { parseScoresSelection } from "../lens/scores/selection";
import type { Sel } from "../lib/state/types";

export type ReportAction = { kind: "open"; href: string; label: string } | { kind: "chooser" };

/** `./report.html?ver=…#pl=…` (or no `?ver=` when `ver` is unknown) -- the SAME shape
 * `Places.svelte#onReport`/`TablePanel.svelte#onReportSelected` already build, so a link built
 * here is byte-identical to one built from either of those panels for the same input. */
function reportHref(hash: string, ver: string | null): string {
  const query = ver ? `?ver=${encodeURIComponent(ver)}` : "";
  return `./report.html${query}${hash}`;
}

/** `TablePanel.svelte#onReportSelected`'s own encoding, factored out: one zone place, one key --
 * `hashFromPlaces()` returns only `#pl=`'s VALUE (never the `#pl=` key itself, model.ts's own
 * contract), so every caller here wraps it the same way that file's `window.open()` call does. */
function zoneReportHash(unit: string, key: string): string | null {
  const set = zoneSetForUnit(unit);
  if (!set) return null;
  const hash = hashFromPlaces([{ kind: "zone", set, keys: [key] }]);
  return hash ? `#pl=${hash}` : "";
}

/**
 * What "Report" should do RIGHT NOW, given the current view:
 *
 * 1. A place list is already in `#pl=` (drawn/typed/uploaded/zone-added, one or many) -- report on
 *    every place in it, in its own order (the SAME link the Places panel's own footer "Report"
 *    button opens for `sel.pl`).
 * 2. Otherwise, a single Program Area is selected on the map/table (`sel=zone:<unit>:<key>`) --
 *    report on that one zone, encoded the SAME `z.<set>.<key>` way "Report on selected" does.
 * 3. Otherwise, a single cell is selected (`sel=cell:<id>`) and the caller has already encoded it
 *    as a place (`lastClickedPl`, the `g1` token of `placeFromLastClicked()`'s `Cell <id>` square --
 *    the SAME place "Add to places" appends): report on that one cell. #10 (2026-10-16): the footer
 *    said "Reporting on the last clicked place" while Open report stayed disabled for a cell. The
 *    token is passed in because building it needs the place codec, which loads lazily; until it
 *    resolves the cell falls through to the chooser.
 * 4. Otherwise, nothing to report on: the caller shows the chooser (pick a Program Area, or draw/
 *    upload) instead of a dead button (docs/usability.md M1's proposed fix, "Ben's items").
 */
export function reportAction(
  sel: Pick<Sel, "pl" | "t" | "sel">,
  ver: string | null,
  lastClickedPl: string | null = null,
): ReportAction {
  if (sel.pl) {
    return {
      kind: "open",
      href: reportHref(reportHash(sel.pl, sel.t), ver),
      label: "the current place list",
    };
  }
  const selection = parseScoresSelection(sel.sel);
  if (selection?.kind === "zone") {
    const hash = zoneReportHash(selection.unit, selection.key);
    if (hash !== null) {
      return {
        kind: "open",
        href: reportHref(hash, ver),
        label: `the selected Program Area (${selection.key})`,
      };
    }
  }
  if (selection?.kind === "cell" && lastClickedPl) {
    return {
      kind: "open",
      href: reportHref(reportHash(lastClickedPl, sel.t), ver),
      label: `the last clicked cell (${selection.cellId})`,
    };
  }
  return { kind: "chooser" };
}

/** R4-D: the pinned "Open report" button is enabled exactly when `reportAction()` has somewhere to
 * go -- a place list, a selected Program Area, or (#10) a clicked cell. With nothing selected it stays disabled (the
 * footer sentence says "Add a place to open a report."), never a live button that does nothing. */
export function reportOpenEnabled(action: ReportAction): boolean {
  return action.kind === "open";
}

/** a single zone -> a report href, for the chooser's own "pick a Program Area" list -- the exact
 * same encoding `reportAction()`'s zone branch above uses, exposed separately so the chooser can
 * build a link for a zone that is not (yet) the current `sel=`. */
export function zoneReportHref(unit: string, key: string, ver: string | null): string | null {
  const hash = zoneReportHash(unit, key);
  return hash === null ? null : reportHref(hash, ver);
}

/** Session-only memory of reports opened THIS visit (chrome, never the URL -- the rail tool's own
 * "last reports opened this session" list, docs/usability.md/round-2 plan §5 U6). Capped small; a
 * private-mode / storage-disabled browser degrades to "no recent list" rather than throwing. */
export interface RecentReport {
  href: string;
  label: string;
  openedAt: number;
}

const RECENTS_KEY = "atlas.report.recent";
const RECENTS_MAX = 5;

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function isRecentReport(v: unknown): v is RecentReport {
  return (
    !!v &&
    typeof v === "object" &&
    typeof (v as RecentReport).href === "string" &&
    typeof (v as RecentReport).label === "string" &&
    typeof (v as RecentReport).openedAt === "number"
  );
}

export function loadRecentReports(storage: StorageLike | null): RecentReport[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(RECENTS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isRecentReport) : [];
  } catch {
    return []; // malformed/quota/private-mode storage: chrome, not correctness
  }
}

/** prepends `entry`, dedupes by `href` (a re-opened report moves to the front, not a second row),
 * and caps at {@link RECENTS_MAX}. Returns the new list so the caller can render it immediately
 * without a second read. */
export function recordRecentReport(
  storage: StorageLike | null,
  entry: Omit<RecentReport, "openedAt">,
  now: () => number = Date.now,
): RecentReport[] {
  const next: RecentReport[] = [
    { ...entry, openedAt: now() },
    ...loadRecentReports(storage).filter((r) => r.href !== entry.href),
  ].slice(0, RECENTS_MAX);
  try {
    storage?.setItem(RECENTS_KEY, JSON.stringify(next));
  } catch {
    /* private mode / storage disabled -- chrome, not correctness */
  }
  return next;
}
