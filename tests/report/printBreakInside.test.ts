// Wiring gate, fix round 1 (item 3): "a table row allowed to break across pages" is the seeded
// fault this file exists to make impossible by construction. report.css's `@media print` block
// must set `break-inside: avoid` on `table tr` (and `figure`, `.flower-panel`,
// `.species-section`) -- without it, Chromium's print/`page.pdf()` engine is free to split a row's
// content across a page boundary, which is exactly what the checklist's `page.pdf()` gate (the
// last-column-header-per-page assertion) exists to catch downstream. This is the SOURCE half of
// that gate: cheap, deterministic, no headless browser needed.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPORT_CSS = fileURLToPath(new URL("../../src/report/report.css", import.meta.url));

/** the print media block's own `break-inside: avoid` selector list, comma-split and trimmed. */
export function breakInsideAvoidSelectors(css: string): string[] {
  const printBlock = /@media print\s*\{([\s\S]*)\}\s*$/.exec(css)?.[1] ?? css;
  const rule = /([^{}]+)\{\s*break-inside:\s*avoid\s*;?\s*\}/.exec(printBlock);
  if (!rule) return [];
  return rule[1]
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

describe("report.css's @media print sets break-inside: avoid on table rows/figures", () => {
  const css = readFileSync(REPORT_CSS, "utf8");
  const selectors = breakInsideAvoidSelectors(css);

  it("covers table tr (the row-clipping gate)", () => {
    expect(selectors).toContain("table tr");
  });

  it("also covers figures and flower/species sections", () => {
    expect(selectors).toContain("figure");
    expect(selectors).toContain(".flower-panel");
    expect(selectors).toContain(".species-section");
  });

  it("SEEDED FAULT: a print block with no break-inside rule at all is caught", () => {
    const rogue = "@media print { table thead { display: table-header-group; } }";
    expect(breakInsideAvoidSelectors(rogue)).toEqual([]);
  });

  it("SEEDED FAULT: removing table tr from the selector list is caught", () => {
    const rogue = "@media print { figure, .flower-panel { break-inside: avoid; } }";
    expect(breakInsideAvoidSelectors(rogue)).not.toContain("table tr");
  });
});
