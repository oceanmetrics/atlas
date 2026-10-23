import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import { instanceDir, instanceId } from "../../../scripts/instance.mjs";

const root = fileURLToPath(new URL(".", import.meta.url));
const repo = fileURLToPath(new URL("../../../", import.meta.url));

// atlas-2 Step 3 (Sonnet half): standalone config (this fixture is not part of the app's own
// build). Boots the REAL src/lib/engine/{engine,bundles,sql,smoke}.ts against a real browser and a
// real self-hosted DuckDB-WASM worker+wasm, which tests/engine/*.test.ts (Node/Vitest, dependency-
// injected) cannot exercise on their own. `publicDir` points at the app's own `public/` so this
// fixture serves the SAME DuckDB extension mirror (`scripts/fetch-duckdb-extensions.mjs`) the real
// app would -- one fetch, one source of truth, not a second copy living under this fixture.
export default defineConfig({
  root,
  base: "/",
  publicDir: fileURLToPath(new URL("../../../public", import.meta.url)),
  // the app's `@instance` alias (vite.config.ts): src/lib/release/dataBase.ts reads the release
  // registry from catalog/base.ts, which reads the instance (brand/instance.ts).
  resolve: { alias: { "@instance": `${repo}${instanceDir(instanceId())}` } },
  optimizeDeps: {
    // same reason as the root vite.config.ts: @duckdb/duckdb-wasm ships its own worker+wasm and the
    // dep optimizer breaks it (atlas-refs/"calcofi explore review.md" §1).
    exclude: ["@duckdb/duckdb-wasm"],
  },
  build: {
    target: "es2022",
  },
  server: {
    port: 4391,
    strictPort: true,
  },
  preview: {
    port: 4391,
    strictPort: true,
  },
});
