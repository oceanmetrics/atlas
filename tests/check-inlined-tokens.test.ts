// atlas-3 step 3 review checklist: "the token VALUES may be inlined only by a build step that
// copies them from tokens.css, never typed by hand." index.html's inline critical CSS `@import`s
// src/shell/shell.css, which `@import`s instances/<id>/tokens.css -- Vite's own CSS pipeline (not
// anything this repo wrote) resolves and inlines both at dev/build time. This is the mechanical
// proof that the copy stays faithful, run against synthetic fixtures here (the fast, pure-function
// tier) and against a REAL `vite build`'s dist/index.html by `node scripts/check-inlined-tokens.mjs
// dist` (wired the same way check-relative-assets.mjs/check-dist-session.mjs are, in CI and by hand
// after `npm run build`).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { instanceTokensCss } from "../scripts/instance.mjs";
import {
  extractInlineStyleCss,
  findInlinedTokenDrift,
  normalizeCssValue,
  parseTokenBlocks,
} from "../scripts/check-inlined-tokens-core.mjs";

const REAL_TOKENS_CSS = readFileSync(instanceTokensCss(), "utf8");

function htmlWithStyle(css: string): string {
  return `<!doctype html><html><head><style>${css}</style></head><body></body></html>`;
}

describe("normalizeCssValue: build-time minification never reads as drift", () => {
  it("treats a redundant leading zero as identical to its stripped form", () => {
    expect(normalizeCssValue("0.1")).toBe(normalizeCssValue(".1"));
  });

  it("treats a bare time value across seconds/milliseconds as identical", () => {
    expect(normalizeCssValue("150ms")).toBe(normalizeCssValue(".15s"));
    expect(normalizeCssValue("0ms")).toBe(normalizeCssValue("0s"));
  });

  it("treats a hex triplet shorthand as identical to its expanded form", () => {
    expect(normalizeCssValue("#ffffff")).toBe(normalizeCssValue("#fff"));
    expect(normalizeCssValue("#FFFFFF")).toBe(normalizeCssValue("#fff"));
  });

  it("treats comma-space differences in a function's argument list as identical", () => {
    expect(normalizeCssValue("cubic-bezier(0.2, 0.8, 0.2, 1)")).toBe(
      normalizeCssValue("cubic-bezier(.2,.8,.2,1)"),
    );
  });

  it("still distinguishes an actually different value (the normalizer cannot be vacuous)", () => {
    expect(normalizeCssValue("#e8c24a")).not.toBe(normalizeCssValue("#173d6d"));
    expect(normalizeCssValue("150ms")).not.toBe(normalizeCssValue("200ms"));
  });
});

describe("parseTokenBlocks: survives what a minifier does to tokens.css's shape", () => {
  it("captures a rule's LAST declaration even with no trailing semicolon (minified)", () => {
    const blocks = parseTokenBlocks(":root{--a:1px;--b:2px}");
    expect(blocks.base.get("--b")).toBe("2px");
  });

  it("does not let a nested @media block's declarations leak into the base bucket", () => {
    const css = `:root{--motion-panel:200ms}@media (prefers-reduced-motion: reduce){:root{--motion-panel:0ms}}`;
    const blocks = parseTokenBlocks(css);
    expect(blocks.base.get("--motion-panel")).toBe("200ms");
  });

  it("buckets a selector naming navy/paper separately from the shared base", () => {
    const css = `:root{--x:1px}:root,:root[data-theme=navy]{--x:navy-val}:root[data-theme=paper]{--x:paper-val}`;
    const blocks = parseTokenBlocks(css);
    expect(blocks.base.get("--x")).toBe("1px");
    expect(blocks.navy.get("--x")).toBe("navy-val");
    expect(blocks.paper.get("--x")).toBe("paper-val");
  });
});

describe("extractInlineStyleCss", () => {
  it("pulls the <style> tag's content out of a full HTML document", () => {
    expect(extractInlineStyleCss(htmlWithStyle(":root{--a:1px}"))).toContain("--a:1px");
  });
});

describe("findInlinedTokenDrift: the inlined copy must equal tokens.css", () => {
  it("is empty when the inlined CSS is copied verbatim from tokens.css", () => {
    const html = htmlWithStyle(REAL_TOKENS_CSS);
    expect(findInlinedTokenDrift(REAL_TOKENS_CSS, html)).toEqual([]);
  });

  it(
    "is empty when the inlined copy is minified (leading zeros stripped, hex shortened, the " +
      "reduced-motion override's semicolon dropped) -- exactly what a real build produces",
    () => {
      const minified =
        ":root{--motif-hex-opacity:.1;--ease-out:cubic-bezier(.2, .8, .2, 1)}" +
        "@media (prefers-reduced-motion: reduce){:root{--motif-hex-opacity:.1}}" +
        ":root,:root[data-theme=navy]{--text-primary:#fff}" +
        ":root[data-theme=paper]{--surface-panel:#fff}";
      const source =
        ":root { --motif-hex-opacity: 0.1; --ease-out: cubic-bezier(0.2, 0.8, 0.2, 1); }" +
        ':root, :root[data-theme="navy"] { --text-primary: #ffffff; }' +
        ':root[data-theme="paper"] { --surface-panel: #ffffff; }';
      expect(findInlinedTokenDrift(source, htmlWithStyle(minified))).toEqual([]);
    },
  );

  it("holds for the real, committed tokens.css and a verbatim copy of it", () => {
    expect(findInlinedTokenDrift(REAL_TOKENS_CSS, htmlWithStyle(REAL_TOKENS_CSS))).toEqual([]);
  });

  // the seeded fault this gate exists to catch: a hand-typed value in index.html's inlined CSS
  // that drifts from tokens.css (docs/design/spec.md's review checklist, "no hex literal outside
  // tokens.css" extended to "no VALUE outside tokens.css either").
  it("reports a hand-typed value that drifts from tokens.css, by theme and token name", () => {
    const source =
      ':root { --mma-gold: #e8c24a; } :root[data-theme="paper"] { --fill-accent: #173d6d; }';
    const handTyped = htmlWithStyle(
      ":root{--mma-gold:#e8c24a}:root[data-theme=paper]{--fill-accent:#000000}", // drifted!
    );
    const drift = findInlinedTokenDrift(source, handTyped);
    expect(drift).toEqual([
      { theme: "paper", token: "--fill-accent", expected: "#173d6d", actual: "#000000" },
    ]);
  });

  it("reports a token missing from the inlined copy altogether", () => {
    const source = ":root { --a: 1px; --b: 2px; }";
    const missing = htmlWithStyle(":root{--a:1px}");
    expect(findInlinedTokenDrift(source, missing)).toEqual([
      { theme: "base", token: "--b", expected: "2px", actual: null },
    ]);
  });

  it("holds for the real dist build's shape when the copy is faithful in every theme", () => {
    // a minimal stand-in for what Vite's html-inline-proxy actually emits: the base block, then
    // the navy/paper overrides, each missing their last declaration's semicolon (as a real
    // minifier does) -- proving the gate is not fooled by that shape either way.
    const html = htmlWithStyle(REAL_TOKENS_CSS.replace(/;\s*}/g, "}"));
    expect(findInlinedTokenDrift(REAL_TOKENS_CSS, html)).toEqual([]);
  });
});
