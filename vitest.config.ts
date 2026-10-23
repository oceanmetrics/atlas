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
          // @oceanmetrics/map loads the cog:// protocol with a dynamic import() when a COG slot mounts
          // (tests/raster/cog.test.ts), and @geomatico/maplibre-cog-protocol's ESM build imports its own
          // modules without extensions, which Node cannot resolve: both go through vite here, as in the app
          server: { deps: { inline: ["@oceanmetrics/map", "@geomatico/maplibre-cog-protocol"] } },
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
