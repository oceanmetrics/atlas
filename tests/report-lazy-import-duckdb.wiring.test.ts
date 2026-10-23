// Wiring gate: `@duckdb/duckdb-wasm` and `docx` never enter the STATIC import graph of EITHER
// entry (`src/main.ts` for index.html, `src/report-main.ts` for report.html).
//
// This is a TRANSITIVE, entry-relative scan (same technique as tests/report-lazy-import.wiring.
// test.ts's `staticGraph`), not a blanket "no file under src/ imports this package" scan: a
// dynamically-imported module (`src/lib/engine/bundles.ts`, `src/report/exportDocx.ts`) is fully
// entitled to use an ordinary, value-level `import ... from "@duckdb/duckdb-wasm"`/`"docx"`
// INSIDE itself — that import only ever executes once the dynamic `import()` that reached the
// module resolves, so it never touches either entry's OWN static critical path. A blanket scan
// would (and, when first written, did) flag exactly those legitimate lazy modules as false
// positives.
//
// Why this exists ALONGSIDE scripts/size-budget-core.mjs's build-output content scan: that scan
// can be — and, for report.html, IS — narrowed with `--allow-marker` for a marker whose text
// legitimately appears as PROSE (report.html's provenance section narrates "DuckDB-WASM 1.32.0";
// its Word-export button says "Word document", never spelling ".docx"). This source-level scan is
// what still proves the REAL package/module is never statically bundled, independent of any
// `--allow-marker` narrowing (size-budget.mjs's own header points here).
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

/** every `from "..."` on an ORDINARY (value-level) import/export -- `import type .../export type
 * ...` is excluded on purpose: verbatimModuleSyntax (tsconfig.json) guarantees those are erased
 * before a single byte of the named package is ever bundled, so they carry none of the risk this
 * gate exists to catch. */
const STATIC_VALUE_IMPORT_RE =
  /(?:^|\n)\s*(?:import(?!\s+type\b)|export(?!\s+type\b))\b[^;\n]*?\bfrom\s+["']([^"']+)["']/g;

function resolveSpecifier(fromFile: string, spec: string): string | null {
  if (!spec.startsWith(".")) return null; // a bare package -- exactly what this gate inspects, not follows
  const base = resolve(dirname(fromFile), spec);
  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.svelte`,
    `${base}.js`,
    `${base}/index.ts`,
  ]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/** the transitive STATIC (never `dynamicImports`) closure of `entry`, and every bare package
 * `from` specifier found anywhere in it. */
function staticGraphPackages(entry: string): {
  files: Set<string>;
  packages: Map<string, string[]>;
} {
  const files = new Set<string>();
  const packages = new Map<string, string[]>(); // package -> file paths that statically import it
  const queue = [resolve(REPO_ROOT, entry)];
  while (queue.length) {
    const file = queue.pop()!;
    if (files.has(file)) continue;
    if (!/\.(ts|svelte|js)$/.test(file)) continue;
    files.add(file);
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(STATIC_VALUE_IMPORT_RE)) {
      const spec = m[1];
      const next = resolveSpecifier(file, spec);
      if (next) {
        queue.push(next);
      } else if (!spec.startsWith(".")) {
        const list = packages.get(spec) ?? [];
        list.push(file);
        packages.set(spec, list);
      }
    }
  }
  return { files, packages };
}

describe.each([
  ["index.html", "src/main.ts"],
  ["report.html", "src/report-main.ts"],
])("%s's static graph never statically bundles duckdb-wasm or docx", (_label, entry) => {
  const { files, packages } = staticGraphPackages(entry);

  it("is not a vacuous walk", () => {
    expect(files.size).toBeGreaterThan(5);
  });

  it("never statically imports @duckdb/duckdb-wasm", () => {
    expect(packages.get("@duckdb/duckdb-wasm")).toBeUndefined();
  });

  it("never statically imports docx", () => {
    expect(packages.get("docx")).toBeUndefined();
  });
});

describe("the walk actually follows real code (not vacuously green)", () => {
  it("report.html's graph reaches the report model", () => {
    const { files } = staticGraphPackages("src/report-main.ts");
    expect([...files].some((f) => f.endsWith("src/lib/report/model.ts"))).toBe(true);
  });

  it("a type-only import of docx does NOT count as a static bundle (verbatimModuleSyntax erases it)", () => {
    expect(readFileSync(resolve(REPO_ROOT, "src/report/exportDocx.ts"), "utf8")).toMatch(
      /import type \{[^}]*\} from "docx"/,
    );
    const { packages } = staticGraphPackages("src/report-main.ts");
    expect(packages.get("docx")).toBeUndefined();
  });
});
