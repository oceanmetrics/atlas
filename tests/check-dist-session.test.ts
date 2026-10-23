import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { distHasSessionJson, findSessionJsonFiles } from "../scripts/check-dist-session-core.mjs";

let dir: string | null = null;

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = null;
});

function makeDist(files: Record<string, string>): string {
  dir = mkdtempSync(join(tmpdir(), "atlas-dist-session-"));
  for (const [rel, content] of Object.entries(files)) {
    const p = join(dir, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, content);
  }
  return dir;
}

describe("distHasSessionJson / findSessionJsonFiles (plan D6)", () => {
  it("is green on an empty/nonexistent dist", () => {
    const d = makeDist({ "index.html": "<html></html>" });
    expect(distHasSessionJson(d)).toBe(false);
    expect(distHasSessionJson(join(d, "does-not-exist"))).toBe(false);
  });

  it("is red when session.json is seeded at dist root", () => {
    const d = makeDist({ "session.json": '{"preview":true}', "index.html": "<html></html>" });
    expect(distHasSessionJson(d)).toBe(true);
    expect(findSessionJsonFiles(d)).toEqual([join(d, "session.json")]);
  });

  it("is red when session.json is seeded in a NESTED directory, not just the root", () => {
    const d = makeDist({
      "index.html": "<html></html>",
      "sub/session.json": '{"preview":true}',
    });
    expect(distHasSessionJson(d)).toBe(true);
    expect(findSessionJsonFiles(d)).toEqual([join(d, "sub", "session.json")]);
  });

  it("does not false-positive on a file that merely contains 'session.json' in its name or path", () => {
    const d = makeDist({
      "session.json.map": "{}",
      "not-session.json": "{}",
      "session/jsonish.txt": "x",
    });
    expect(distHasSessionJson(d)).toBe(false);
  });
});
