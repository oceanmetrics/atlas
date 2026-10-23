// atlas-3 step 3: the tool rail's data (spec.md §5.1), extracted out of Shell.svelte into a plain,
// exported module so the rail's own order is callable from a test (CLAUDE.md: "keep core logic in
// an exported function under src/lib/ [or here, src/shell/]... a component only calls it").
// Shell.svelte imports this; nothing here imports svelte. `RailItem` itself is NOT imported from
// src/lib/ui/Rail.svelte here: a plain `tsc` (not svelte-aware) cannot see a `.svelte` file's
// `<script module>` named exports the way svelte-check can, so `ToolRailItem` is a plain,
// structurally-matching local type instead.
//
// The rail is the SPINE -- it changes the SURFACE, and it has FOUR entries, in this order, in both
// lenses and on every viewport: Layers - Details - Table - Places. "Details" holds the species
// information (Species lens) and the clicked-cell detail (Collection lens); neither lens needs its
// own entry. Every tool is active in both lenses, so `buildRailItems` needs no lens argument or
// inactive/inactiveReason concept.
import { INSTANCE } from "../lib/brand/instance";
import type { IconName } from "../lib/ui/icon-paths";

/** every rail tool this codebase can build. `report` is the Places flow plus the report actions
 * (ReportPane.svelte), the rail entry of an instance whose `tools` name it; `places` is the same flow
 * without them. An instance names one or the other. */
export type ToolName = "layers" | "details" | "table" | "places" | "report";

/** every tool this build has, the run-time twin of {@link ToolName}; an instance enables a subset. */
export const ALL_TOOLS: readonly ToolName[] = ["layers", "details", "table", "places", "report"];

/** structurally identical to src/lib/ui/Rail.svelte's exported `RailItem` -- Svelte's prop typing
 * accepts this by shape, not by declaration identity. */
export interface ToolRailItem {
  name: ToolName;
  icon: IconName;
  label: string;
}

/** spec.md §5.1 / control-grammar.md: the spine is the SAME controls, in the SAME order, on every
 * viewport and every lens: the instance's `tools` (instances/<id>/instance.json), the members of
 * {@link ToolName} only. This array's order IS that order -- `buildRailItems` below never reorders it. */
export const TOOL_ORDER: readonly ToolName[] = INSTANCE.tools.filter((t): t is ToolName =>
  (ALL_TOOLS as readonly string[]).includes(t),
);

export const TOOL_LABEL: Record<ToolName, string> = {
  layers: "Layers",
  details: "Details",
  table: "Table",
  places: "Places",
  report: "Report",
};

/** one icon per tool, the same in both lenses. Only `layers`/`table`/`places` share their tool's
 * own name as the icon name. */
export const TOOL_ICON: Record<ToolName, IconName> = {
  layers: "layers",
  details: "info",
  table: "table",
  places: "places",
  report: "report",
};

// This exact sentence, for "layers" only, is duplicated in index.html's static skeleton body (a
// plain string there, since the skeleton predates any bundle) -- tests/shell/tools.test.ts asserts
// the two stay equal, and the CLS gate (e2e/shell.cls.spec.ts) is what proves that equal text also
// means equal painted height.
export const TOOL_BODY: Record<ToolName, string> = {
  layers: "Layers and options arrive in a later phase.",
  details: "Select a cell or an area on the map to see its details.",
  table: "The tables arrive in a later phase.",
  places: "Draw, upload or pick a place.",
  report: "Draw, upload or pick a place, then open its report.",
};

/** every tool is always active, in both lenses, on every viewport. */
export function buildRailItems(): ToolRailItem[] {
  return TOOL_ORDER.map((name) => ({
    name,
    icon: TOOL_ICON[name],
    label: TOOL_LABEL[name],
  }));
}

/** R4-B: whether a tool takes the whole stage ("Layers, Details and Places
 * open as a side panel; Table takes the whole stage"). One rule, one place -- Shell.svelte hands
 * the result to Panel.svelte's `fullStage`. */
export function toolTakesFullStage(tool: ToolName): boolean {
  return tool === "table";
}

/** R4-B: the panel header names what is being SHOWN, not the spine entry beside it
 * (control-grammar rule 6). Every input is a plain string (or null while unknown) computed by
 * the shell from its own state; the fallbacks are the tool's own label so a header is never
 * blank. */
export interface PanelContext {
  /** Layers: the active layer's name and its unit, e.g. "Richness" / "Hex cells". */
  layer: string | null;
  unit: string | null;
  /** Details: the clicked subject's label (Collection) or the species' name (Species). */
  subject: string | null;
  /** Table: its subject line. */
  tableSubject: string | null;
  /** Places: how many places are listed (0 = none), and the last clicked place's label. */
  placeCount: number;
  lastClicked: string | null;
}

export function panelHeaderTitle(tool: ToolName, ctx: PanelContext): string {
  switch (tool) {
    case "layers":
      return ctx.layer && ctx.unit
        ? `${ctx.layer} · ${ctx.unit}`
        : (ctx.layer ?? TOOL_LABEL.layers);
    case "details":
      return ctx.subject ?? TOOL_LABEL.details;
    case "table":
      return ctx.tableSubject ?? TOOL_LABEL.table;
    case "places":
    case "report":
      if (ctx.placeCount > 0) return ctx.placeCount === 1 ? "1 place" : `${ctx.placeCount} places`;
      return ctx.lastClicked ? "Last clicked place" : TOOL_LABEL[tool];
  }
}
