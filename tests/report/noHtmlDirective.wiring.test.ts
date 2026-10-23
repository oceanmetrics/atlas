// Wiring gate, fix round 1 (item 3): "a place name inserted as HTML in the document" is the seeded
// fault this file exists to make impossible by construction, not just by review. Svelte's
// `{@html ...}` is the ONE template directive that can turn a string (a place name, a report
// title -- both come straight from the URL, `#pl=`/`#t=`, and are never sanitized on the way in)
// into live markup; this report never uses it (the permalink QR is a plain `<img src={dataUrl}>`,
// per qr.ts's own header) and this test is what keeps that true.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPORT_DIR = fileURLToPath(new URL("../../src/report", import.meta.url));

function walk(dir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const entry of entries) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

export function findHtmlDirectives(rootDir: string): string[] {
  const hits: string[] = [];
  for (const file of walk(rootDir)) {
    if (!file.endsWith(".svelte")) continue;
    if (readFileSync(file, "utf8").includes("{@html")) hits.push(file);
  }
  return hits;
}

describe("src/report/**/*.svelte never uses {@html}", () => {
  it("finds nothing", () => {
    expect(findHtmlDirectives(REPORT_DIR)).toEqual([]);
  });

  it("SEEDED FAULT: a planted {@html name} is caught", () => {
    const source = "<div>{@html name}</div>";
    expect(source.includes("{@html")).toBe(true);
  });
});
