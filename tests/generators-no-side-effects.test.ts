// atlas-3 step 2: both generators (icon-paths, tokens.json) write a tracked file when run as a
// CLI, and MUST NOT when merely imported for their pure functions — otherwise `vitest run`
// importing them (as tests/icon-paths.test.ts and tests/tokens-json.test.ts do) would itself
// rewrite the committed files and leave `git status` dirty after a clean test run. A previous
// attempt's regeneration test shelled out to the generator and hit exactly this bug.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { instanceTokensJson } from "../scripts/instance.mjs";

const WATCHED = ["src/lib/ui/icon-paths.ts", instanceTokensJson()];

function fingerprint() {
  return WATCHED.map((p) => {
    const s = statSync(p);
    const hash = createHash("sha256").update(readFileSync(p)).digest("hex");
    return { path: p, mtimeMs: s.mtimeMs, hash };
  });
}

describe("importing a generator writes nothing", () => {
  it("import.meta.url guard: importing build-icon-paths.mjs does not touch icon-paths.ts", async () => {
    const before = fingerprint();
    await import("../scripts/build-icon-paths.mjs");
    expect(fingerprint()).toEqual(before);
  });

  it("import.meta.url guard: importing export-tokens.mjs does not touch tokens.json", async () => {
    const before = fingerprint();
    await import("../scripts/export-tokens.mjs");
    expect(fingerprint()).toEqual(before);
  });

  it("`vitest run` (this very run) leaves the two generated files untouched on disk", () => {
    // a fresh child process re-checks git status against the two generated files specifically —
    // proof this test file itself did not just paper over a write with an in-memory fingerprint
    const out = execFileSync("git", ["status", "--porcelain", "--", ...WATCHED], {
      encoding: "utf8",
      cwd: process.cwd(),
    });
    expect(out.trim()).toBe("");
  });
});
