// atlas-3 step 3: index.html's inlined critical CSS `@import`s src/shell/shell.css, which itself
// `@import`s @instance/tokens.css (instances/<id>/tokens.css) -- Vite's html/CSS pipeline resolves both at dev/build time
// and inlines the resolved (and, in a real build, minified) declarations directly into the page's
// `<style>` tag. That is the "build step" the review checklist requires: nobody hand-types a token
// value into index.html. This module is the mechanical proof that the copy is faithful: it re-parses
// a built dist/index.html's inlined `<style>` and confirms every custom property tokens.css declares
// still resolves to the SAME value there, in every theme block.
//
// Values are compared through `normalizeCssValue`, not by byte equality, because a production build
// minifies the inlined CSS (lightningcss): "0.1" is rewritten to ".1", "150ms" to ".15s",
// "#ffffff" to "#fff", and comma-separated function args lose their surrounding whitespace. None
// of that is drift -- it is the same value, differently serialized -- so both sides are normalized
// (case, whitespace, hex shorthand, a redundant leading zero, and a bare time unit) before
// comparing. A REAL value change (a hand-typed override that disagrees with tokens.css) still shows
// up as a normalized mismatch.
//
// This module parses CSS itself rather than reusing scripts/contrast-core.mjs's `parseThemes`,
// because that parser is only ever driven against hand-authored, semicolon-terminated tokens.css --
// it has never had to survive a minifier, which (a) drops the semicolon before a rule's closing
// `}` (so a naive `/(--[\w-]+):([^;]+);/` misses exactly the LAST declaration of every rule) and
// (b) leaves `@media (prefers-reduced-motion: reduce) { :root { ... } }` nested, which that
// parser's single-level brace scan reads as a second, unguarded top-level `:root` block. Both are
// harmless to `contrast.mjs` (neither affects a token in its contrast pairs) but would silently
// corrupt THIS check, so `parseTokenBlocks` below fixes both, independently of that file.

/** Removes every `@media (...) { ... }` block (one level of nested braces), so its declarations
 * never leak into the base/theme buckets below -- tokens.css's only such block is the
 * `prefers-reduced-motion` override, which is not part of any theme's resting value. */
function stripMediaBlocks(css) {
  return css.replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, "");
}

/**
 * Parse every custom property declared in each selector block, bucketed by theme the same way
 * `contrast-core.mjs`'s `parseThemes` does (a selector naming "navy" or "paper" overrides the
 * shared "base" bucket for that theme) -- but tolerant of a minifier's dropped final semicolon.
 * @param {string} css
 * @returns {{ base: Map<string,string>, navy: Map<string,string>, paper: Map<string,string> }}
 */
export function parseTokenBlocks(css) {
  const stripped = stripMediaBlocks(css.replace(/\/\*[\s\S]*?\*\//g, ""));
  const base = new Map();
  const navy = new Map();
  const paper = new Map();
  for (const m of stripped.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = m[1].trim();
    if (selector.startsWith("@")) continue;
    const target = selector.includes("paper") ? paper : selector.includes("navy") ? navy : base;
    // `[^;}]+` (not just `[^;]+`) plus an OPTIONAL trailing `;` -- a minifier drops the semicolon
    // before a rule's closing brace, which would otherwise silently drop that last declaration.
    for (const d of m[2].matchAll(/(--[\w-]+)\s*:\s*([^;}]+);?/g)) {
      target.set(d[1], d[2].trim());
    }
  }
  return { base, navy, paper };
}

/**
 * Canonicalize one CSS declaration value so build-time minification never reads as drift.
 * @param {string} raw
 * @returns {string}
 */
export function normalizeCssValue(raw) {
  let v = raw.trim().toLowerCase().replace(/\s+/g, " ").replace(/,\s+/g, ",");
  // "#ffffff" -> "#fff": a minifier shortens hex triplets, so expand a 3-digit hex back to 6 for
  // comparison rather than trying to guess when a 6-digit one COULD have been shortened.
  const hex3 = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(v);
  if (hex3) v = `#${hex3[1]}${hex3[1]}${hex3[2]}${hex3[2]}${hex3[3]}${hex3[3]}`;
  // "150ms" / "0.15s" / ".15s" -> "150ms": a bare time value, canonicalized to milliseconds.
  const time = /^(-?\d*\.?\d+)(ms|s)$/.exec(v);
  if (time) {
    const n = parseFloat(time[1]) * (time[2] === "s" ? 1000 : 1);
    return `${n}ms`;
  }
  // a redundant leading zero before a decimal point, wherever a number can start (after "(", ",",
  // a space, or at the very start): "0.1" -> ".1", "cubic-bezier(0.2, 0.8, 0.2, 1)" -> "cubic-
  // bezier(.2,.8,.2,1)" (the comma/space collapse above already ran).
  v = v.replace(/(^|[\s(,])0(\.\d)/g, "$1$2");
  return v;
}

/**
 * Extract the first inlined `<style>` block's text from an HTML document (dist/index.html after a
 * real build). Concatenates every `<style>` tag found, in case a build ever splits into more than
 * one (today there is exactly one).
 * @param {string} html
 * @returns {string}
 */
export function extractInlineStyleCss(html) {
  return [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join("\n");
}

/**
 * @typedef {{ theme: "base" | "navy" | "paper", token: string, expected: string, actual: string | null }} TokenDrift
 */

/**
 * Every token tokens.css declares (per theme) that dist's inlined CSS either lacks or disagrees
 * with, once both sides are normalized. Empty = the inlined copy is faithful.
 * @param {string} tokensCss the source text of the instance's tokens.css
 * @param {string} indexHtml a built dist/index.html's full text
 * @returns {TokenDrift[]}
 */
export function findInlinedTokenDrift(tokensCss, indexHtml) {
  const source = parseTokenBlocks(tokensCss);
  const inlined = parseTokenBlocks(extractInlineStyleCss(indexHtml));
  const drift = [];
  for (const theme of ["base", "navy", "paper"]) {
    for (const [token, expected] of source[theme]) {
      const actual = inlined[theme].get(token) ?? null;
      if (actual === null || normalizeCssValue(actual) !== normalizeCssValue(expected)) {
        drift.push({ theme, token, expected, actual });
      }
    }
  }
  return drift;
}
