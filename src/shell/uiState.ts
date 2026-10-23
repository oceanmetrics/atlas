// R3-W8 item 3 (Ben, 2026-09-25): "when clicking Share, the link should include all the same UI
// elements in their arrangement." Most of that is already URL state (`Sel`'s own keys); this module
// covers only the remaining CHROME pieces `panelGeometry.ts`'s U1 rule ("layout is chrome, never the
// URL") keeps out of `Sel`/`history.replaceState`: which tool is open, the desktop panel's side+size
// (or the phone sheet's detent), the Layers pane's expanded row.
//
// This is a SEPARATE token (`ui=`), written ONLY when Share builds its link (Shell.svelte's
// `onShare`) and read ONLY once, at boot -- never through `formatSel`/`parseSel`/
// `history.replaceState`. Versioned like the places codec (`g1`, plan D8):
// `ui=4.<tool>.<side>.<size>.<detent>.<expandedRow>`. Unknown/malformed input (wrong
// version, wrong field count, an out-of-range value, an unrecognized code) is ignored ENTIRELY --
// never a partial apply, matching `codec.ts`'s "clamp to absent, never throw" rule.
//
// R4-B (2026-09-30) -- version 4: the rail is the spine, four tabs Layers/Details/Table/Report
// (`tool` code `d` = details); the panel is docked left or right only (no bottom, no maximized --
// Table takes the full stage by itself, so it needs no field); the Layers pane's own `tab` field is
// gone (its second tab became the Details tool). Versions 1-3 still parse, read-only, with these
// forward mappings (`tab=info` -> tool `details`; dock `bottom` -> side `left`, the new default
// side, since a bottom dock no longer exists; everything else as before):
//   v3: `3.<tool>.<dock>.<size>.<detent>.<row>.<tab>.<reportTab>` (8 fields)
//   v2: `2.<tool>.<dock>.<size>.<detent>.<row>.<tab>` (7 fields; tool `p` = places -> report)
//   v1: `1.<tool>.<dock>.<size>.<detent>.<row>` (6 fields; tool `f` = flower -> details, `p` -> report)
// R4-D: the Report tool lost its sub-tabs, so the trailing `reportTab` field is retired. Tokens
// written by 0.10.81 (v4, 7 fields) and every v3 token still parse; the field is read and ignored,
// and `formatUi` no longer writes it (a v4 token is now 6 fields).
// A pre-v4 token whose tool is `layers` and whose `tab` is `info` opens Details; whose tool is
// something else keeps that tool (the tab is moot there).
//
// Plain, Node-testable module (no svelte, no DOM).
import type { Dock } from "../lib/ui/panelGeometry";
import { PANEL_SIZE_MAX, PANEL_SIZE_MIN, clampPanelSize } from "../lib/ui/panelGeometry";
import type { SheetDetent } from "../lib/ui/sheetGeometry";
import { PLACES_FLOW_TOOL } from "../lib/state/legacy";
import { RELEASE_KEYS } from "../lib/state/types";
import type { ToolName } from "./tools";

export const UI_TOKEN_VERSION = "4";

/** the Layers pane's own two expandable rows (`LayersPanel.svelte`'s `DATA_ROW_ID`/`ZONES_ROW_ID`
 * string literals, duplicated here rather than imported -- importing a `.svelte` file's module
 * script from a plain `.ts` file is the same friction `shell/tools.ts`'s own header documents).
 * `null` = neither row expanded. */
export type UiExpandedRow = "data-raster" | "data-zones" | null;

export interface UiState {
  tool: ToolName;
  /** R4-B: the panel's side -- `left` (the default) or `right`. Named `dock` for continuity with
   * `PanelGeometry`. */
  dock: Dock;
  /** desktop panel size, in px (`PANEL_SIZE_MIN`..`PANEL_SIZE_MAX`) -- carried even when the viewer
   * shares from the phone, so a recipient who opens the link on desktop still gets a real size. */
  size: number;
  /** phone sheet detent -- carried even when the viewer shares from desktop, for the same reason. */
  detent: SheetDetent;
  expandedRow: UiExpandedRow;
}

const TOOL_CODE: Record<ToolName, string> = {
  layers: "l",
  details: "d",
  table: "t",
  places: "p",
  report: "r",
};
// `p` and `r` both name the Places flow: each reads as the one this instance's rail carries (the
// Report tool on an instance whose `tools` name it, else Places), so a link shared from one atlas
// opens the same flow on the other
const CODE_TOOL: Partial<Record<string, ToolName>> = {
  ...Object.fromEntries(Object.entries(TOOL_CODE).map(([tool, code]) => [code, tool as ToolName])),
  p: PLACES_FLOW_TOOL,
  r: PLACES_FLOW_TOOL,
};

const DOCK_CODE: Record<Dock, string> = { left: "l", right: "r" };
const CODE_DOCK: Partial<Record<string, Dock>> = { l: "left", r: "right" };
/** pre-v4 tokens could name a bottom dock; it no longer exists, so it reads as the default side. */
const LEGACY_CODE_DOCK: Partial<Record<string, Dock>> = { ...CODE_DOCK, b: "left" };

const DETENT_CODE: Record<SheetDetent, string> = { peek: "p", half: "h", full: "f" };
const CODE_DETENT: Partial<Record<string, SheetDetent>> = { p: "peek", h: "half", f: "full" };

const ROW_CODE: Record<Exclude<UiExpandedRow, null>, string> = {
  "data-raster": "d",
  "data-zones": "z",
};
const CODE_ROW: Partial<Record<string, UiExpandedRow>> = {
  d: "data-raster",
  // the Outlines row exists only where the release draws zones; elsewhere it reads as "nothing expanded"
  z: RELEASE_KEYS ? "data-zones" : null,
  n: null,
};

/** the retired Layers-pane tab codes (v2/v3 `tab` field): `i` = the info tab, which is now the
 * Details tool. */
const LEGACY_TAB_CODES = new Set(["l", "i"]);

const INT_RE = /^\d+$/;

function parsePanelSize(sizeStr: string): number | null {
  if (!INT_RE.test(sizeStr)) return null;
  const size = Number(sizeStr);
  return size < PANEL_SIZE_MIN || size > PANEL_SIZE_MAX ? null : size;
}

/** Serialize a `UiState` to the `ui=` token's own value (no leading `ui=`, no `?`/`&`). Every
 * field is a fixed-position code -- there is no "omit the default" rule: the token is only ever
 * built once, at Share time, from the FULL live state. Always writes the CURRENT version (4). */
export function formatUi(ui: UiState): string {
  const size = clampPanelSize(ui.size);
  const row = ui.expandedRow ? ROW_CODE[ui.expandedRow] : "n";
  return [
    UI_TOKEN_VERSION,
    TOOL_CODE[ui.tool],
    DOCK_CODE[ui.dock],
    size,
    DETENT_CODE[ui.detent],
    row,
  ].join(".");
}

/** version-4 decode: 6 fields (7 for a pre-R4-D token, whose last field is ignored). */
function parseUiV4(parts: string[]): UiState | null {
  if (parts.length !== 6 && parts.length !== 7) return null;
  const [, toolCode, dockCode, sizeStr, detentCode, rowCode] = parts;
  const tool = CODE_TOOL[toolCode];
  const dock = CODE_DOCK[dockCode];
  const detent = CODE_DETENT[detentCode];
  if (!tool || !dock || !detent) return null;
  if (!(rowCode in CODE_ROW)) return null;
  const size = parsePanelSize(sizeStr);
  if (size === null) return null;
  return { tool, dock, size, detent, expandedRow: CODE_ROW[rowCode] ?? null };
}

/** the pre-v4 tool codes, forward-mapped: `f` (flower, retired v1->v2) and `p` (places) as before;
 * `l` with the retired `info` tab -> `details`. `tabCode` is undefined for v1 (no tab field). */
function legacyTool(toolCode: string, tabCode: string | undefined): ToolName | null {
  if (toolCode === "f") return "details";
  if (toolCode === "p" || toolCode === "r") return PLACES_FLOW_TOOL;
  const tool = CODE_TOOL[toolCode];
  if (!tool) return null;
  return tool === "layers" && tabCode === "i" ? "details" : tool;
}

/** version-3 decode (retired by R4-B, read-only): 8 fields; the trailing report-tab field is ignored. */
function parseUiV3(parts: string[]): UiState | null {
  if (parts.length !== 8) return null;
  const [, toolCode, dockCode, sizeStr, detentCode, rowCode, tabCode] = parts;
  const dock = LEGACY_CODE_DOCK[dockCode];
  const detent = CODE_DETENT[detentCode];
  if (!dock || !detent || !LEGACY_TAB_CODES.has(tabCode)) return null;
  if (!(rowCode in CODE_ROW)) return null;
  const size = parsePanelSize(sizeStr);
  const tool = legacyTool(toolCode, tabCode);
  if (size === null || !tool) return null;
  return { tool, dock, size, detent, expandedRow: CODE_ROW[rowCode] ?? null };
}

/** version-2 decode (retired, read-only): 7 fields, no report tab. */
function parseUiV2(parts: string[]): UiState | null {
  if (parts.length !== 7) return null;
  const [, toolCode, dockCode, sizeStr, detentCode, rowCode, tabCode] = parts;
  const dock = LEGACY_CODE_DOCK[dockCode];
  const detent = CODE_DETENT[detentCode];
  if (!dock || !detent || !LEGACY_TAB_CODES.has(tabCode)) return null;
  if (!(rowCode in CODE_ROW)) return null;
  const size = parsePanelSize(sizeStr);
  const tool = legacyTool(toolCode, tabCode);
  if (size === null || !tool) return null;
  return { tool, dock, size, detent, expandedRow: CODE_ROW[rowCode] ?? null };
}

/** version-1 decode (retired, read-only): 6 fields, no tab fields at all. */
function parseUiV1(parts: string[]): UiState | null {
  if (parts.length !== 6) return null;
  const [, toolCode, dockCode, sizeStr, detentCode, rowCode] = parts;
  const dock = LEGACY_CODE_DOCK[dockCode];
  const detent = CODE_DETENT[detentCode];
  if (!dock || !detent) return null;
  if (!(rowCode in CODE_ROW)) return null;
  const size = parsePanelSize(sizeStr);
  const tool = legacyTool(toolCode, undefined);
  if (size === null || !tool) return null;
  return { tool, dock, size, detent, expandedRow: CODE_ROW[rowCode] ?? null };
}

/** Parse a `ui=` value. `null` (never a partial `UiState`) on ANY malformed input -- wrong version,
 * wrong field count, an unrecognized code, an out-of-range size -- so a caller never has to guess
 * which fields are trustworthy; it is all or nothing. */
export function parseUi(v: string | null | undefined): UiState | null {
  if (v === null || v === undefined) return null;
  const parts = v.split(".");
  const version = parts[0];
  if (version === UI_TOKEN_VERSION) return parseUiV4(parts);
  if (version === "3") return parseUiV3(parts);
  if (version === "2") return parseUiV2(parts);
  if (version === "1") return parseUiV1(parts);
  return null;
}
