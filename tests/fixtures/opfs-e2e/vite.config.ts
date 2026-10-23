import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import { instanceDir, instanceId } from "../../../scripts/instance.mjs";

const root = fileURLToPath(new URL(".", import.meta.url));
const repo = fileURLToPath(new URL("../../../", import.meta.url));

// atlas-2 Step 4: standalone config for the OPFS gate's harness (not part of the app's build).
// `publicDir` points at the app's own `public/` so this fixture serves the SAME self-hosted DuckDB
// extension mirror (`npm run duckdb:fetch-ext`) the real app would -- which is what lets every spec
// here run with `extensions.duckdb.org` blocked throughout. Port 4451 (this task's assigned range).
export default defineConfig({
  root,
  base: "/",
  publicDir: fileURLToPath(new URL("../../../public", import.meta.url)),
  // the app's `@instance` alias (vite.config.ts): src/lib/release/dataBase.ts reads the release
  // registry from catalog/base.ts, which reads the instance (brand/instance.ts).
  resolve: { alias: { "@instance": `${repo}${instanceDir(instanceId())}` } },
  optimizeDeps: {
    // same reason as the root vite.config.ts: @duckdb/duckdb-wasm ships its own worker+wasm and the
    // dep optimizer breaks it.
    exclude: ["@duckdb/duckdb-wasm"],
  },
  build: { target: "es2022" },
  server: { port: 4451, strictPort: true },
  preview: { port: 4451, strictPort: true },
});
