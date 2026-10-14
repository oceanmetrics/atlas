// atlas-3 review checklist, rule 1: "No hex literal outside tokens.css."
//
// Component CSS and motif assets read custom properties only — that is what makes two
// themes, a contrast gate and a future brand revision one-file changes. This checker makes the rule
// mechanical over the surfaces atlas-3 owns. Two deliberate carve-outs, both narrow:
//   1. src/lib/brand/tokens.css — the single place a color literal is allowed to exist.
//   2. src/lib/brand/vendor/** — brand marks copied from another repo, unmodified except for the
//      provenance comment. Each must carry a "vendored verbatim from" line naming its source, or it
//      is reported as a failure too: a carve-out nobody can use by accident.
// Markdown is not scanned: docs/design/spec.md documents the palette, quoting hex on purpose.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

// atlas-3 step 1 surfaces, plus step 2's component library. Step 3 adds "index.html"
// (the shell's inlined critical CSS) and "src/shell/shell.css" (the file that CSS is `@import`ed
// from, and the one src/shell/Shell.svelte imports too) now that the shell's critical CSS lands.
// A SCAN_ROOTS entry may name a single FILE, not only a directory -- see `walk()` below.
export const SCAN_ROOTS = ["src/lib/brand", "src/lib/ui", "index.html", "src/shell/shell.css", "src/catalog", "catalog.html"];
const SCANNED_EXTENSIONS = new Set([
  ".css",
  ".html",
  ".svg",
  ".ts",
  ".svelte",
  ".mjs",
  ".js",
  ".json",
]);
export const TOKENS_FILE = join("src", "lib", "brand", "tokens.css");
// tokens.json is a generated, deterministic RE-EXPORT of tokens.css (scripts/export-tokens.mjs):
// every hex literal in it already went through the one allowed source above, so it gets the same
// narrow carve-out as tokens.css itself — nothing else may skip this gate by pattern-matching a
// filename, only this one generated file.
export const TOKENS_JSON_FILE = join("src", "lib", "brand", "tokens.json");
export const VENDOR_DIR = join("src", "lib", "brand", "vendor") + sep;
const PROVENANCE_RE = /vendored verbatim from/i;

// #rgb | #rgba | #rrggbb | #rrggbbaa, as it would appear in a style value
const HEX_LITERAL_RE = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})\b/g;

function walk(dir) {
  const out = [];
  let st;
  try {
    st = statSync(dir);
  } catch {
    return out; // a root that does not exist yet is not a failure
  }
  if (st.isFile()) return [dir]; // a SCAN_ROOTS entry may name one file, e.g. "index.html"
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

/**
 * @param {string} rootDir repo root to scan from
 * @param {(p: string) => string} readFile injected for testability
 * @returns {{ path: string, line: number, match: string, reason: string }[]}
 */
export function findHexLiterals(rootDir = ".", readFile = (p) => readFileSync(p, "utf8")) {
  const hits = [];
  for (const scanRoot of SCAN_ROOTS) {
    for (const file of walk(join(rootDir, scanRoot))) {
      const rel = relative(rootDir, file);
      const ext = file.slice(file.lastIndexOf("."));
      if (!SCANNED_EXTENSIONS.has(ext)) continue;
      if (rel === TOKENS_FILE || rel === TOKENS_JSON_FILE) continue;
      const content = readFile(file);
      if (rel.startsWith(VENDOR_DIR)) {
        // vendored assets keep their own colors, but only if they say where they came from
        if (!PROVENANCE_RE.test(content)) {
          hits.push({
            path: rel,
            line: 1,
            match: "",
            reason: `vendored asset without a "vendored verbatim from <source>" provenance comment`,
          });
        }
        continue;
      }
      content.split("\n").forEach((text, i) => {
        for (const m of text.matchAll(HEX_LITERAL_RE)) {
          hits.push({
            path: rel,
            line: i + 1,
            match: m[0],
            reason: `hex color literal outside ${TOKENS_FILE} — use a custom property`,
          });
        }
      });
    }
  }
  return hits;
}
