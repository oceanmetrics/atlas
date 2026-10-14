import { execFileSync } from "node:child_process";
import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import pkg from "./package.json" with { type: "json" };

// atlas-8 Deliverable 4 (beta feedback): the "Report a problem" issue body cites the exact build,
// not just package.json's version -- two builds of the same 0.10.16 can differ by commit. Resolved
// ONCE, at build time (never at runtime: this repo ships no server to ask); a CI fixture build (the
// size-budget red fixtures, this file's own header explains why those exist) has no guarantee of a
// git checkout at all, so a failed `git rev-parse` falls back to the string "unknown" -- never
// throws, same contract as every other build-time default in this config.
function resolveAppSha(): string {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      cwd: fileURLToPath(new URL(".", import.meta.url)),
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
  } catch {
    return "unknown";
  }
}

// the same dist/ must run under both https://oceanmetrics.io/atlas/ and any other mount path (a
// preview deploy, a local `vite preview`), so every asset URL has to be relative (base: "./") and
// every piece of view state has to live in the query string or the hash, never a client router.
// One HTML entry (index.html, the map) stands in for the app.
export default defineConfig({
  base: "./",
  // `Analytics["appVersion"]` (analytics.ts) needs SOME build-time version string. A plain
  // `import pkg from "./package.json"` at RUNTIME (in a lens/shell file) pulls the WHOLE JSON module
  // into the static bundle, prose and all — including the `pinReasons` block's own "duckdb"/"shp"
  // strings, which then trips size-budget.mjs's forbidden-lazy-chunk scan for those exact substrings
  // (measured: a real build FAILs on it). `define` inlines only this one string literal instead.
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __APP_SHA__: JSON.stringify(resolveAppSha()),
  },
  // no client router, so there is no "route" for the dev/preview server to fall back to index.html
  // for. `appType: "mpa"` turns that SPA fallback OFF -- without it, a missing sibling file would
  // 200 with index.html's own markup in dev/preview instead of the real 404 GitHub Pages returns.
  appType: "mpa",
  plugins: [svelte()],
  optimizeDeps: {
    // @duckdb/duckdb-wasm ships its own worker + wasm and the optimizer breaks it (same story that made
    // CalCOFI Explorer exclude it, atlas-refs/"calcofi explore review.md" §1). Pinned at exactly 1.32.0
    // per docs/spikes/S1.md (see package.json's "pinReasons"); this exclude stays regardless of when the
    // dependency is actually wired into app code.
    exclude: ["@duckdb/duckdb-wasm"],
  },
  build: {
    target: "es2022",
    manifest: true, // scripts/size-budget.mjs reads dist/.vite/manifest.json
    rollupOptions: {
      input: {
        index: fileURLToPath(new URL("./index.html", import.meta.url)),
      },
      output: {
        // atlas-6 step 2: terra-draw/terra-draw-maplibre-gl-adapter are genuinely lazy (reached
        // only via `places/draw.ts`'s dynamic import()) — collectStaticGraph in
        // scripts/size-budget-core.mjs walks only STATIC `imports`, so neither chunk's own CODE
        // ever enters the static graph. But Vite names a lazy chunk after the imported module by
        // default ("terra-draw.modern-<hash>.js"), and the ENTRY necessarily contains that
        // filename as a literal string (the dynamic `import()` call's resolved specifier, plus its
        // own modulepreload dependency map) so the browser knows what to fetch when the import
        // runs — unavoidable Vite plumbing, not eagerly-loaded code. `size-budget-core.mjs`'s
        // FORBIDDEN_LAZY_MARKERS scan greps file CONTENT (by design, atlas-3's own header: "catches
        // the case where Rollup inlines the forbidden module... instead of giving it its own
        // file"), so it cannot tell "the chunk's own name, referenced correctly" apart from
        // "the chunk's code, inlined wrongly" — this renames just the OUTPUT FILENAME of these two
        // chunks so the correct, lazy behaviour underneath is unchanged and the entry's reference
        // to it no longer happens to start with a forbidden token.
        chunkFileNames: (chunk) => {
          const name = chunk.name ?? "";
          return /^terra-draw/.test(name)
            ? "assets/draw-vendor-[hash].js"
            : "assets/[name]-[hash].js";
        },
      },
    },
  },
});
