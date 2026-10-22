import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { instanceDir, instanceId } from "./scripts/instance.mjs";

// two projects: the pure-logic one (node, no Svelte compiler: almost every test), and `*.svelte.test.ts`,
// which runs the real runes-based lens state (`lens/collection/state.svelte.ts`) under the Svelte compiler
// as client code (effects do not run in svelte's server build). Both still run under `npm test`.
// `@instance` resolves to the instance VITE_INSTANCE selects, the same alias vite.config.ts sets
const instanceAlias = {
  find: "@instance",
  replacement: fileURLToPath(new URL(`./${instanceDir(instanceId())}`, import.meta.url)),
};

const exclude = ["tests/fixtures/**", "node_modules/**", "spikes/**", ".claude/**"];

export default defineConfig({
  test: {
    projects: [
      {
        extends: false,
        resolve: { alias: [instanceAlias] },
        test: {
          name: "logic",
          environment: "node", // pure logic only (version/session resolution, size-budget, dist checks) — no DOM
          include: ["tests/**/*.test.ts"],
          // "include" is already a strict allowlist under tests/, so spikes/** and the parallel
          // spike-agent worktrees under .claude/ can't match — excluded explicitly anyway, defensively.
          exclude: [...exclude, "tests/**/*.svelte.test.ts"],
          // @oceanmetrics/places 0.5.1's dist/ imports its own modules without extensions
          // (`from './client'`), which Node's ESM loader refuses; Vite resolves them, so the package
          // goes through Vite here as it does in the build. Drop this once the package ships `.js`.
          server: { deps: { inline: ["@oceanmetrics/places"] } },
        },
      },
      {
        extends: false,
        plugins: [svelte({ dynamicCompileOptions: () => ({ generate: "client" }) })],
        // the compiler is told to emit client code (`dynamicCompileOptions`), and `import "svelte"` must be the
        // client build too (its server build makes `flushSync`, `tick` and `$effect.root` no-ops)
        resolve: {
          alias: [
            instanceAlias,
            {
              find: /^svelte$/,
              replacement: fileURLToPath(
                new URL("./node_modules/svelte/src/index-client.js", import.meta.url),
              ),
            },
          ],
        },
        test: {
          name: "runes",
          environment: "node",
          include: ["tests/**/*.svelte.test.ts"],
          exclude,
          // svelte goes through vite too, so the alias above applies to it as well
          server: { deps: { inline: [/node_modules\/svelte\//] } },
        },
      },
    ],
  },
});
