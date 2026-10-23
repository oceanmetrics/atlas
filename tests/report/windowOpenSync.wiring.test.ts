// Wiring gate, fix round 1 (item 3): "an `await` before `window.open`" is the seeded fault this
// file exists to make impossible by construction. Both report entry points (ReportPane.svelte's
// "Open report", TablePanel.svelte's "Report on selected") MUST call `window.open()` as the first thing
// their click handler does -- every browser's popup blocker treats a `window.open()` reached only
// after an `await` as no longer user-initiated (this repo's own header comments on both handlers
// cite exactly this). A unit test on SOURCE TEXT, not a live browser, because the failure mode is
// about CALL ORDER within a function body, which is cheap to assert without a DOM.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

/**
 * Extracts the body of the FIRST function named `fnName` in `source` (a plain brace-matcher, not a
 * parser -- good enough for one handler per file) and returns the text from the function's opening
 * brace up to (and including) its own `window.open(` call, or `null` if the function or the call
 * were not found.
 */
export function sliceUpToWindowOpen(source: string, fnName: string): string | null {
  const fnRe = new RegExp(`function\\s+${fnName}\\s*\\([^)]*\\)\\s*\\{`);
  const m = fnRe.exec(source);
  if (!m) return null;
  const start = m.index + m[0].length;
  let depth = 1;
  let i = start;
  for (; i < source.length && depth > 0; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") depth--;
  }
  const body = source.slice(start, i);
  const openAt = body.indexOf("window.open(");
  if (openAt === -1) return null;
  return body.slice(0, openAt + "window.open(".length);
}

describe("window.open() runs synchronously (no `await` before it) in both report entry points", () => {
  it("ReportPane.svelte's openReport() (R4-D: the pinned Open report button)", () => {
    const source = readFileSync(`${ROOT}/src/shell/ReportPane.svelte`, "utf8");
    const slice = sliceUpToWindowOpen(source, "openReport");
    expect(slice, "openReport() or its window.open( call was not found").not.toBeNull();
    expect(slice).not.toMatch(/\bawait\b/);
  });

  it("TablePanel.svelte's onReportSelected()", () => {
    const source = readFileSync(`${ROOT}/src/lens/scores/TablePanel.svelte`, "utf8");
    const slice = sliceUpToWindowOpen(source, "onReportSelected");
    expect(slice, "onReportSelected() or its window.open( call was not found").not.toBeNull();
    expect(slice).not.toMatch(/\bawait\b/);
  });

  it("SEEDED FAULT: an await before window.open is caught", () => {
    const source = `function onRogue() {\n  await somethingAsync();\n  window.open("x");\n}`;
    const slice = sliceUpToWindowOpen(source, "onRogue");
    expect(slice).toMatch(/\bawait\b/);
  });
});
