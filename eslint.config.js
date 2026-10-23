// flat config (ESLint 10 / typescript-eslint 8 / eslint-plugin-svelte 3); formatting itself is
// prettier's job (see .prettierrc.json) so this stays about correctness, not style.
import js from "@eslint/js";
import ts from "typescript-eslint";
import svelte from "eslint-plugin-svelte";
import svelteParser from "svelte-eslint-parser";
import prettier from "eslint-config-prettier";
import globals from "globals";

export default ts.config(
  {
    ignores: [
      "dist",
      "dist-fixture",
      "coverage",
      "playwright-report",
      "test-results",
      "node_modules",
      "pipeline/.venv", // uv creates it on `uv run`; third-party JS inside
      "pipeline/cache",
      "tests/fixtures/**/dist", // built fixture output, not source
      "e2e/fixtures/**/dist", // same — e2e/fixtures/analytics-privacy/'s built output
      ".tmp", // sandbox-only TMPDIR override, gitignored
      "spikes", // S1-S4 spike harnesses (each its own package.json); root config must not lint them
      ".claude/worktrees", // parallel spike-agent worktrees, each a full checkout with own node_modules
      // R3-B16: a local Quarto render of docs/status.md (or any other docs/*.md) leaves
      // docs/<name>_files/ next to it -- Quarto's own asset dir for a rendered page, already
      // gitignored, but `npm run lint` still WALKS it when it exists on disk, and it is full of
      // bundled third-party JS (jquery, bootstrap, ...) that is not this repo's source and was
      // never meant to pass this config's rules (724 errors, observed). `docs/status_files` is
      // named explicitly too so the glob's own shape is provably right even for the one render
      // most likely to exist locally, not just the general pattern.
      "docs/*_files/",
      "docs/status_files",
    ],
  },
  js.configs.recommended,
  ...ts.configs.recommended,
  ...svelte.configs.recommended,
  prettier,
  {
    // browser app code: src/, and the e2e/fixture pages that stand in for it. `__APP_VERSION__` is
    // `vite.config.ts`'s `define` (atlas-5: Analytics["appVersion"], inlined at build time — see
    // that file's own comment for why not a runtime `import` of package.json). `__APP_SHA__` is the
    // same file's atlas-8 Deliverable 4 addition (git SHA, for the "Report a problem" issue body).
    // `__APP_SOURCE__` (the code's repository) and the instance's build-time flags (`__LENS_SCORES__`,
    // ..., scripts/instance-modules.mjs `instanceFlags`) are the same `define` (build week 4).
    files: ["src/**/*.ts", "src/**/*.svelte", "tests/fixtures/**/*.ts"],
    languageOptions: {
      globals: {
        ...globals.browser,
        __APP_VERSION__: "readonly",
        __APP_SHA__: "readonly",
        __APP_SOURCE__: "readonly",
        __LENS_SCORES__: "readonly",
        __LENS_COLLECTION__: "readonly",
        __TOOL_REPORT__: "readonly",
        __RELEASE__: "readonly",
        __SEAL__: "readonly",
      },
    },
  },
  {
    // the inline early-fetch script (written into the pages' <head> before any bundle parses): plain
    // ES5 in the browser, its error bindings kept for the old-engine `catch (e)` syntax
    files: ["src/lib/release/earlyFetch.inline.js"],
    languageOptions: { globals: { ...globals.browser } },
    rules: { "@typescript-eslint/no-unused-vars": ["error", { caughtErrors: "none" }] },
  },
  {
    // Node-run tooling: build scripts and *.config.ts files. scripts/verify.mjs also drives
    // Playwright `page.evaluate()` callbacks that run IN the browser, hence both global sets.
    files: ["scripts/**/*.mjs", "*.config.ts", "tests/fixtures/**/*.config.ts"],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  {
    // tests run under vitest/playwright's Node process, but assert against browser-shaped fakes
    files: ["tests/**/*.ts", "e2e/**/*.ts"],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  {
    files: ["**/*.svelte"],
    languageOptions: {
      parser: svelteParser,
      parserOptions: { parser: ts.parser },
    },
  },
  {
    languageOptions: {
      parserOptions: { extraFileExtensions: [".svelte"] },
    },
  },
  {
    // eslint-plugin-svelte's own base config also claims **/*.svelte.ts / **/*.svelte.js (Svelte 5's
    // "universal reactivity" files, e.g. src/lib/state/sel.svelte.ts) and hands them to
    // svelte-eslint-parser with no `parserOptions.parser` delegate — which parses Svelte SFC `<script>`
    // content, not a bare TypeScript module, and fails on ordinary TS (`interface`, `import type`, ...).
    // These files have no <script> tag at all: runes ($state, ...) are plain function calls
    // syntactically, so typescript-eslint's own parser handles them with no special support needed.
    // Placed AFTER the svelte configs (`ts.config()` applies later entries' `languageOptions` on top of
    // earlier ones for the same file) so it overrides the parser choice for this one glob only.
    files: ["**/*.svelte.ts", "**/*.svelte.js"],
    languageOptions: {
      parser: ts.parser,
    },
  },
);
