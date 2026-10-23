import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { instanceDir, instanceId, listInstances, loadInstance } from "./scripts/instance.mjs";
import {
  instanceDefines,
  instanceModulesPlugin,
  instanceTestExcludes,
} from "./scripts/instance-modules.mjs";

// The pure-logic tests (node, no Svelte compiler: almost every test) run ONCE PER INSTANCE
// (`logic:oceanmetrics`, `logic:marinesensitivity`, ... one project per folder under instances/), each
// with `@instance` aliased to that instance, its `virtual:instance-modules` and build-time flags, and
// `VITE_INSTANCE` set for the scripts a test runs, the same as `VITE_INSTANCE=<id> npm run build`. So
// `npm test` covers every instance: a module only one instance builds (the Scores lens, the release
// registry) is tested under that instance, and a test of one instance's strings says which
// (`describe.runIf(INSTANCE.id === ...)` or a capability such as `INSTANCE.release`).
// `*.svelte.test.ts` runs the real runes-based lens state (`lens/collection/state.svelte.ts`) under the
// Svelte compiler as client code (effects do not run in svelte's server build), for the instance
// VITE_INSTANCE selects (default oceanmetrics). `npx vitest run --project logic:<id>` runs one instance.
const ROOT = fileURLToPath(new URL(".", import.meta.url));

/** what one instance's projects share: the `@instance` alias, the module table and the defines. */
function instanceSetup(id: string) {
  return {
    alias: {
      find: "@instance",
      replacement: fileURLToPath(new URL(`./${instanceDir(id)}`, import.meta.url)),
    },
    modules: () => instanceModulesPlugin(id, ROOT),
    // the instance's build-time flags and the app constants vite.config.ts defines
    define: {
      ...instanceDefines(loadInstance(id, ROOT)),
      __APP_VERSION__: JSON.stringify("test"),
      __APP_SHA__: JSON.stringify("test"),
      __APP_SOURCE__: JSON.stringify("oceanmetrics/atlas"),
    },
  };
}

const exclude = ["tests/fixtures/**", "node_modules/**", "spikes/**", ".claude/**"];

const logicProjects = listInstances(ROOT).map((id: string) => {
  const setup = instanceSetup(id);
  return {
    extends: false as const,
    define: setup.define,
    plugins: [setup.modules()],
    resolve: { alias: [setup.alias] },
    test: {
      name: `logic:${id}`,
      environment: "node", // pure logic only (version/session resolution, size-budget, dist checks) — no DOM
      include: ["tests/**/*.test.ts"],
      // "include" is already a strict allowlist under tests/, so spikes/** and the parallel
      // spike-agent worktrees under .claude/ can't match — excluded explicitly anyway, defensively.
      // The tests of a module this instance does not build run in another instance's project
      // (scripts/instance-modules.mjs `tests`).
      exclude: [
        ...exclude,
        "tests/**/*.svelte.test.ts",
        ...instanceTestExcludes(loadInstance(id, ROOT)),
      ],
      // the scripts a test runs (contrast.mjs, export-tokens.mjs, ...) read the same instance
      env: { VITE_INSTANCE: id },
      // @oceanmetrics/map loads the cog:// protocol with a dynamic import() when a COG slot mounts
      // (tests/raster/cog.test.ts), and @geomatico/maplibre-cog-protocol's ESM build imports its own
      // modules without extensions, which Node cannot resolve: both go through vite here, as in the app
      server: { deps: { inline: ["@oceanmetrics/map", "@geomatico/maplibre-cog-protocol"] } },
    },
  };
});

const runes = instanceSetup(instanceId());

export default defineConfig({
  test: {
    projects: [
      ...logicProjects,
      {
        extends: false,
        define: runes.define,
        plugins: [
          svelte({ dynamicCompileOptions: () => ({ generate: "client" }) }),
          runes.modules(),
        ],
        // the compiler is told to emit client code (`dynamicCompileOptions`), and `import "svelte"` must be the
        // client build too (its server build makes `flushSync`, `tick` and `$effect.root` no-ops)
        resolve: {
          alias: [
            runes.alias,
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
