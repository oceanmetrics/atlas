#!/usr/bin/env node
// CLI wrapper around size-budget-core.mjs. Usage:
//   node scripts/size-budget.mjs [--dist dist] [--entry index.html] [--budget-kb 450]
//     [--worker-budget-kb 150] [--allow-marker duckdb,docx]
//
// --allow-marker drops the named FORBIDDEN_LAZY_MARKERS entries for THIS invocation only (see
// size-budget-core.mjs's findForbiddenMarkers doc comment) -- atlas-7's
// `node scripts/size-budget.mjs --entry report.html --allow-marker duckdb` is why this exists:
// report.html's provenance section narrates the DuckDB-WASM engine's VERSION as prose, which is not
// the same fact as "the package is statically bundled" (that fact is asserted separately, by
// tests/report-lazy-import-duckdb.wiring.test.ts). index.html's own invocation never passes this.
//
// Run against a real `vite build` output it should be green; run against either committed red fixture
// it must be red:
//   - tests/fixtures/size-budget-static-duckdb/ (`npm run build:fixture:size-budget`) statically imports
//     a stub module named like the real duckdb-wasm chunk — the pin is now in package.json (S1.md), so
//     this fixture is a deliberate, permanent regression case, not a stand-in for a missing dependency.
//   - tests/fixtures/size-budget-worker/ (`npm run build:fixture:size-budget-worker`) statically imports
//     a `?worker&url` worker padded past RUNTIME_WORKER_BUDGET_BYTES (atlas-0 review fix F3).
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { loadInstance } from "./instance.mjs";
import {
  evaluateBudget,
  CRITICAL_BUDGET_BYTES,
  RUNTIME_WORKER_BUDGET_BYTES,
  FORBIDDEN_LAZY_MARKERS,
} from "./size-budget-core.mjs";

// the defaults are the selected instance's `budget` (instances/<id>/instance.json, VITE_INSTANCE; schema 1.1);
// the core constants are the oceanmetrics instance's, which tests/instances.test.ts keeps equal to them
const INSTANCE_BUDGET = loadInstance().budget ?? {
  static_kb: CRITICAL_BUDGET_BYTES / 1024,
  worker_kb: RUNTIME_WORKER_BUDGET_BYTES / 1024,
};

function parseArgs(argv) {
  const args = {
    dist: "dist",
    entry: "index.html",
    budgetKb: INSTANCE_BUDGET.static_kb,
    workerBudgetKb: INSTANCE_BUDGET.worker_kb,
    allowMarkers: [],
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dist") args.dist = argv[++i];
    else if (a === "--entry") args.entry = argv[++i];
    else if (a === "--budget-kb") args.budgetKb = Number(argv[++i]);
    else if (a === "--worker-budget-kb") args.workerBudgetKb = Number(argv[++i]);
    else if (a === "--allow-marker") {
      args.allowMarkers = argv[++i]
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    } else {
      process.stderr.write(`unknown argument: ${a}\n`);
      process.exit(2);
    }
  }
  return args;
}

function loadManifest(distDir) {
  // Vite 5+ writes build.manifest:true to <outDir>/.vite/manifest.json; older Vite wrote it at the
  // outDir root. Accept either so this survives a Vite bump without a config change.
  for (const rel of [".vite/manifest.json", "manifest.json"]) {
    const p = join(distDir, rel);
    if (existsSync(p)) return JSON.parse(readFileSync(p, "utf8"));
  }
  return null;
}

// N1: every file the build actually emitted, dist-relative with forward slashes (matching the
// manifest's own path style) — the ground truth `findWorkerAssets`'s basename fallback searches when a
// worker reference doesn't resolve where its own text naively says it should.
function listEmittedFiles(dir, base = dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listEmittedFiles(full, base));
    else out.push(relative(base, full).split(sep).join("/"));
  }
  return out;
}

const { dist, entry, budgetKb, workerBudgetKb, allowMarkers } = parseArgs(process.argv.slice(2));
const manifest = loadManifest(dist);

if (!manifest) {
  process.stderr.write(
    `size-budget: no manifest.json found under "${dist}" — did you run \`vite build\` (with build.manifest: true) first?\n`,
  );
  process.exit(1);
}

if (allowMarkers.length) {
  process.stdout.write(`size-budget: --allow-marker dropped: ${allowMarkers.join(", ")}\n`);
}
const forbiddenMarkers = FORBIDDEN_LAZY_MARKERS.filter((m) => !allowMarkers.includes(m));

const result = evaluateBudget({
  manifest,
  entryKey: entry,
  readFile: (relPath) => readFileSync(join(dist, relPath)),
  budgetBytes: budgetKb * 1024,
  forbiddenMarkers,
  workerBudgetBytes: workerBudgetKb * 1024,
  emittedFiles: listEmittedFiles(dist),
});

const kb = (n) => (n / 1024).toFixed(1);
process.stdout.write(
  `size-budget: entry "${entry}" in "${dist}": ${result.files.length} static file(s), ${kb(result.totalGzipBytes)} KB gzip (budget ${kb(budgetKb * 1024)} KB)\n`,
);
for (const f of result.files) process.stdout.write(`  - ${f}\n`);

// F3: runtime workers (a `?worker&url` asset referenced from the static graph) are printed and budgeted
// separately — they are not part of the static <script> critical path, but they download at construction
// time, before first interaction, so they count against the total the user waits on.
process.stdout.write(
  `size-budget: ${result.workerFiles.length} runtime worker(s), ${kb(result.workerGzipBytes)} KB gzip (budget ${kb(workerBudgetKb * 1024)} KB)\n`,
);
for (const f of result.workerFiles) process.stdout.write(`  - ${f}\n`);

const combined = result.totalGzipBytes + result.workerGzipBytes;
const combinedBudget = budgetKb * 1024 + workerBudgetKb * 1024;
process.stdout.write(
  `size-budget: combined static + runtime-worker, "before first interaction": ${kb(combined)} KB gzip (budget ${kb(combinedBudget)} KB)\n`,
);

if (!result.ok) {
  process.stderr.write("size-budget: FAIL\n");
  for (const reason of result.reasons) process.stderr.write(`  ✗ ${reason}\n`);
  process.exit(1);
}

process.stdout.write("size-budget: PASS\n");
