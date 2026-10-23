// The instance module table (build week 4): which module implements each lens, tool, page and
// capability an instance may name in its instance.json, and how the shell reaches it. One table, the
// way `src/lib/catalog/hooks.ts` is the one place that names hook -> module.
//
// `vite.config.ts` and `vitest.config.ts` serve it to the app as `virtual:instance-modules`
// (`instanceModulesPlugin`): for the selected instance every export the table names is either the
// real thing (an `eager` export re-exported from its module, or a `lazy` loader that dynamic-imports
// it) or `null`. A module the instance does not name is never referenced, so the bundler never
// emits it: the oceanmetrics build carries no Scores lens, Report tool or release registry, and the
// marinesensitivity build no Collections lens (`tests/instance-modules.test.ts` builds both and
// greps their `dist/`).
//
// - `eager` exports are static re-exports: they sit on the shell's static path, for state that must
//   exist before any panel mounts (the Collections lens' map inputs, the place summaries).
// - `lazy` exports are `() => import(...)`: the shell calls them once the lens, tool or capability is
//   in play, so their bytes stay out of the size budget's static path.
// - a key with no exports (`species`, `layers`, ...) is built into the shell for every instance.
// - `owns` are the source paths only this entry brings (prefixes), and `markers` string literals of
//   its modules that survive minification: `scripts/check-instance-dist.mjs` requires every selected
//   entry's markers in the built dist/ and forbids every unselected entry's, and forbids an
//   unselected entry's sources among the dist's chunks (`.vite/manifest.json`).
// - `tests` are the test files of the modules an entry brings: `vitest.config.ts` runs them in the
//   project of every instance that selects the entry and leaves them out of the others, so a module
//   is tested under an instance that builds it (`instanceTestExcludes`).
//
// `src/instance-modules.d.ts` declares the same export names with their types (a test keeps the two
// in step). Pure data plus a code generator; nothing here reads or writes files except the plugin's
// own existence check.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { loadInstance } from "./instance.mjs";

export const VIRTUAL_ID = "virtual:instance-modules";

export const MODULE_TABLE = {
  lenses: {
    collection: {
      eager: {
        createCollectionLens: "src/lens/collection/state.svelte.ts",
        createPlaceSummaries: "src/places/summary.svelte.ts",
      },
      lazy: { loadCollection: "src/lens/collection/shell.ts" },
      owns: [
        "src/lens/collection/",
        "src/places/summary.svelte.ts",
        "src/places/PlaceSummaryTable.svelte",
      ],
      markers: [`data-testid="collection-details"`],
      // with the shared modules' tests written for an instance with this lens and no zones (their
      // MarineSensitivity twins are the `*.mst.test.ts` files under the Scores lens)
      tests: [
        "tests/lens/collection/**",
        "tests/catalog/**",
        "tests/places/summary.test.ts",
        "tests/state/registryUrl.test.ts",
        "tests/state/{codec,roundtrip.property}.test.ts",
        "tests/shell/{uiState,tools}.test.ts",
        "tests/map/{layerStack,interaction,style}.test.ts",
      ],
    },
    scores: {
      lazy: { loadScores: "src/lens/scores/shell.ts" },
      owns: ["src/lens/scores/", "src/lib/analysis/", "src/places/ResultsPanel.svelte"],
      markers: [`data-testid="scores-legend"`],
      tests: [
        "tests/lens/scores/**",
        // the shared modules' tests as MarineSensitivity/atlas 0.10.93 wrote them (zones, `out`, the
        // scores keys, the Report rail), adapted where the shared code moved on
        "tests/**/*.mst.test.ts",
        "tests/analysis/**",
        "tests/places/{cellSquares,dataEngine,fetchPlan,pick,pickInstall,results,studyArea,zoneOutline,zoneStats,zoneDownload}.test.ts",
        "tests/ui/{treemapLayout,protectionChip}.test.ts",
        "tests/treemap-lazy-import.wiring.test.ts",
      ],
    },
    species: {},
  },
  tools: {
    layers: {},
    details: {},
    table: {},
    places: {},
    report: {
      lazy: { loadReport: "src/shell/reportTool.ts" },
      owns: [
        "src/report/",
        "src/lib/report/",
        "src/shell/reportTool.ts",
        "src/shell/ReportPane.svelte",
        "src/places/ReportPlaces.svelte",
        "report.html",
      ],
      markers: [`data-testid="report-subject-sentence"`],
      tests: [
        "tests/lib/report/**",
        "tests/report/**",
        "tests/shell/report.test.ts",
        "tests/state/subjects.test.ts",
        "tests/report-lazy-import.wiring.test.ts",
        "tests/report-lazy-import-duckdb.wiring.test.ts",
      ],
    },
  },
  // the HTML entries (`pages` in instance.json); each is a Vite input of its own
  pages: { index: "index.html", catalog: "catalog.html", report: "report.html" },
  // capabilities an instance turns on by declaring the block (`release`, `seal`)
  capabilities: {
    release: {
      lazy: { loadRelease: "src/lib/release/shell.ts" },
      owns: ["src/lib/release/shell.ts", "src/lib/ui/VersionBadge.svelte"],
      markers: ["versions.json"],
      tests: [
        "tests/release/{access,cite,docsUrl,inline-early-fetch,manifest,preview,previewLink,resolveVer,session,version}.test.ts",
        "tests/release/pagesEnvVars.wiring.test.ts",
        "tests/check-dist-session.test.ts",
        "tests/map/{zones,zoneHighlight,queryLayers}.test.ts",
      ],
    },
    seal: { markers: ["Prepared for the"], tests: ["tests/ui/sealVisibility.test.ts"] },
  },
};

/** every export name the table can produce, sorted (the d.ts declares exactly these). */
export function allExportNames(table = MODULE_TABLE) {
  const names = [];
  for (const group of [table.lenses, table.tools, table.capabilities]) {
    for (const entry of Object.values(group)) {
      names.push(...Object.keys(entry.eager ?? {}), ...Object.keys(entry.lazy ?? {}));
    }
  }
  return names.sort();
}

/** the table entries an instance turns on: its lenses, tools, and the capability blocks it declares. */
export function selectedEntries(instance, table = MODULE_TABLE) {
  const out = [];
  for (const l of instance.lenses ?? []) out.push(["lenses", l, table.lenses[l]]);
  for (const t of instance.tools ?? []) out.push(["tools", t, table.tools[t]]);
  for (const c of Object.keys(table.capabilities)) {
    if (instance[c] !== undefined) out.push(["capabilities", c, table.capabilities[c]]);
  }
  return out;
}

/** problems with an instance against the table: a lens, tool or page it names that has no entry. */
export function tableProblems(instance, table = MODULE_TABLE) {
  const errs = [];
  for (const [group, key, entry] of selectedEntries(instance, table)) {
    if (!entry) errs.push(`${group}: "${key}" has no module in the instance module table`);
  }
  for (const p of instance.pages ?? []) {
    if (!table.pages[p]) errs.push(`pages: "${p}" has no entry in the instance module table`);
  }
  return errs;
}

/** the files the instance's selected entries point at (repo-relative), for the existence check. */
export function selectedFiles(instance, table = MODULE_TABLE) {
  const files = [];
  for (const [, , entry] of selectedEntries(instance, table)) {
    if (!entry) continue;
    files.push(...Object.values(entry.eager ?? {}), ...Object.values(entry.lazy ?? {}));
  }
  return files;
}

/**
 * The source of `virtual:instance-modules` for `instance`: every export name of the table, either
 * from the module (eager: a static re-export; lazy: a loader) or `null`, plus the instance's own
 * lens, tool and page lists. `root` makes the import paths absolute (`/abs/src/...`), so the virtual
 * module resolves them like any other import. Throws on a table problem, so a build never ships an
 * instance that names a module this codebase lacks.
 */
export function instanceModulesSource(instance, root = ".") {
  const errs = tableProblems(instance);
  if (errs.length) {
    throw new Error(`instance "${instance.id}" against the module table:\n  ${errs.join("\n  ")}`);
  }
  const abs = (rel) => JSON.stringify(join(root, rel).split("\\").join("/"));
  const lines = [
    `// virtual:instance-modules for instance "${instance.id}" (scripts/instance-modules.mjs)`,
  ];
  const given = new Set();
  for (const [, , entry] of selectedEntries(instance)) {
    for (const [name, file] of Object.entries(entry.eager ?? {})) {
      lines.push(`export { ${name} } from ${abs(file)};`);
      given.add(name);
    }
    for (const [name, file] of Object.entries(entry.lazy ?? {})) {
      lines.push(`export const ${name} = () => import(${abs(file)});`);
      given.add(name);
    }
  }
  for (const name of allExportNames()) {
    if (!given.has(name)) lines.push(`export const ${name} = null;`);
  }
  return lines.join("\n") + "\n";
}

/**
 * The instance's build-time flags (vite.config.ts `define`, the same in vitest): whether it builds the
 * Scores lens, the Collections lens and the Report tool, and whether it has a release registry. The
 * shell guards each instance-only template branch with one, so the minifier drops the branch (and
 * the code only it reaches) from a build that does not have it, on top of the module table's `null`
 * modules never being bundled.
 */
export function instanceFlags(instance) {
  return {
    __LENS_SCORES__: (instance.lenses ?? []).includes("scores"),
    __LENS_COLLECTION__: (instance.lenses ?? []).includes("collection"),
    __TOOL_REPORT__: (instance.tools ?? []).includes("report"),
    __RELEASE__: instance.release !== undefined,
    __SEAL__: instance.seal !== undefined,
  };
}

/** `instanceFlags` as Vite `define` entries (JSON literals). */
export function instanceDefines(instance) {
  return Object.fromEntries(
    Object.entries(instanceFlags(instance)).map(([k, v]) => [k, JSON.stringify(v)]),
  );
}

/** the test files of the table entries `instance` does NOT select (globs), for vitest's `exclude`. */
export function instanceTestExcludes(instance, table = MODULE_TABLE) {
  const on = new Set(selectedEntries(instance, table).map(([g, k]) => `${g}.${k}`));
  const out = [];
  for (const group of ["lenses", "tools", "capabilities"]) {
    for (const [key, entry] of Object.entries(table[group])) {
      if (!on.has(`${group}.${key}`)) out.push(...(entry.tests ?? []));
    }
  }
  return out;
}

/** the table entries `instance` selects and does not, each `[group, key, entry]`. */
export function splitEntries(instance, table = MODULE_TABLE) {
  const on = new Set(selectedEntries(instance, table).map(([g, k]) => `${g}.${k}`));
  const selected = [];
  const unselected = [];
  for (const group of ["lenses", "tools", "capabilities"]) {
    for (const [key, entry] of Object.entries(table[group])) {
      (on.has(`${group}.${key}`) ? selected : unselected).push([group, key, entry]);
    }
  }
  return { selected, unselected };
}

/** the Vite inputs of the instance's pages: `{ index: "/abs/index.html", report: ... }`. */
export function pageInputs(instance, root = ".") {
  return Object.fromEntries(
    (instance.pages ?? ["index"]).map((p) => [p, join(root, MODULE_TABLE.pages[p])]),
  );
}

/** the Vite plugin serving `virtual:instance-modules` for instance `id` (vite.config.ts, vitest). */
export function instanceModulesPlugin(id, root = ".") {
  const instance = loadInstance(id, root);
  const missing = selectedFiles(instance).filter((f) => !existsSync(join(root, f)));
  if (missing.length) {
    throw new Error(
      `instance "${id}": the module table names missing files: ${missing.join(", ")}`,
    );
  }
  const code = instanceModulesSource(instance, root);
  return {
    name: "atlas-instance-modules",
    resolveId(source) {
      return source === VIRTUAL_ID ? `\0${VIRTUAL_ID}` : null;
    },
    load(resolved) {
      return resolved === `\0${VIRTUAL_ID}` ? code : null;
    },
  };
}
