// atlas-3 step 2: exports the custom properties in the instance's tokens.css
// (instances/<VITE_INSTANCE>/tokens.css, scripts/instance.mjs), resolved per theme, as a
// deterministic tokens.json beside it. Downstream consumers that cannot read CSS custom
// properties directly (a Node script, a design tool) read this instead of the source of truth.
//
// `exportTokens()` is a PURE function: given the tokens.css text, it returns the resolved object.
// Importing this module writes nothing; only `main()`, guarded at the bottom, touches the
// filesystem, and only when the script is run directly — the same rule build-icon-paths.mjs follows,
// so `vitest run` can regenerate tokens.json in memory and compare it to the committed file without
// ever shelling out (a token change without re-export must fail that comparison).
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { instanceTokensCss, instanceTokensJson } from "./instance.mjs";

export const TOKENS_CSS_FILE = instanceTokensCss();
export const OUTPUT_FILE = instanceTokensJson();

/** Pull the custom properties out of one `{ ... }` block matched by `selectorRegex`. */
function parseBlock(css, selectorRegex) {
  const m = css.match(new RegExp(selectorRegex + "\\s*\\{([^}]*)", "s"));
  const props = new Map();
  if (!m) return props;
  const re = /(--[\w-]+)\s*:\s*([^;]*?)\s*;/g;
  for (let hit; (hit = re.exec(m[1]));) props.set(hit[1], hit[2].trim());
  return props;
}

/** Resolve `var(--x)` / `var(--x, fallback)` references against a theme's own property map. */
function resolveValue(value, props, seen = new Set()) {
  return value.replace(/var\((--[\w-]+)(?:\s*,\s*([^)]*))?\)/g, (whole, name, fallback) => {
    if (seen.has(name)) return whole; // guard against a cyclic var() reference
    const raw = props.get(name);
    if (raw === undefined) return fallback !== undefined ? fallback.trim() : whole;
    return resolveValue(raw, props, new Set(seen).add(name));
  });
}

function sortedResolved(props) {
  const out = {};
  for (const name of [...props.keys()].sort()) out[name] = resolveValue(props.get(name), props);
  return out;
}

/**
 * PURE: resolve every custom property in both themes from the tokens.css source text.
 * @param {string} css the contents of the instance's tokens.css
 * @returns {{ navy: Record<string,string>, paper: Record<string,string> }}
 */
export function exportTokens(css) {
  const shared = parseBlock(css, ":root(?!\\[)");
  const navyOverride = parseBlock(css, ':root,\\s*:root\\[data-theme="navy"\\]');
  const paperOverride = parseBlock(css, ':root\\[data-theme="paper"\\]');
  const navy = new Map([...shared, ...navyOverride]);
  const paper = new Map([...shared, ...paperOverride]);
  return { navy: sortedResolved(navy), paper: sortedResolved(paper) };
}

/**
 * PURE: render the deterministic tokens.json text (sorted keys, 2-space indent, trailing newline —
 * the same shape `prettier --write` leaves a plain JSON file in, so no extra formatting pass and no
 * separate byte-identity check are needed for this file's own style).
 * @param {string} css
 * @returns {string}
 */
export function renderTokensJson(css) {
  return JSON.stringify(exportTokens(css), null, 2) + "\n";
}

function main() {
  const css = readFileSync(TOKENS_CSS_FILE, "utf8");
  writeFileSync(OUTPUT_FILE, renderTokensJson(css));
  process.stdout.write(`export-tokens: wrote ${OUTPUT_FILE}\n`);
}

// run only when executed directly, never on import (see build-icon-paths.mjs for why this matters)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
