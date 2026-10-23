// scripts/check-ga-core.mjs on small dists: no gtag.js script tag in any page, and a measurement id in the build
// exactly when one was given; the bar's loader is asked of an instance with the bar only. build-instance.yml runs the
// CLI on every instance's dist.
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkGa } from "../scripts/check-ga-core.mjs";

const dist = (files: Record<string, string>) => {
  const d = mkdtempSync(join(tmpdir(), "ga-dist-"));
  for (const [f, s] of Object.entries(files)) {
    mkdirSync(join(d, f, ".."), { recursive: true });
    writeFileSync(join(d, f), s);
  }
  return d;
};
const BAR = 'const s="https://www.googletagmanager.com/gtag/js?id=";';

describe("checkGa", () => {
  it("unset: passes with no id and no script tag", () => {
    expect(checkGa(dist({ "index.html": "<div></div>", "assets/a.js": BAR }), "")).toEqual([]);
  });

  it("unset: a stray id fails", () => {
    expect(checkGa(dist({ "index.html": "", "assets/a.js": 'x("G-TEST000000")' }), "")).toEqual([
      "a measurement id that was not given: G-TEST000000",
    ]);
  });

  it("a gtag.js script tag in a page fails, set or not", () => {
    const d = dist({
      "index.html":
        '<script async src="https://www.googletagmanager.com/gtag/js?id=G-TEST000000"></script>',
      "assets/a.js": BAR,
    });
    expect(checkGa(d, "G-TEST000000")).toEqual(["index.html: a gtag.js script tag in the page"]);
  });

  it("set: passes with the id and the bar's loader in the bundle", () => {
    expect(
      checkGa(dist({ "index.html": "", "assets/a.js": `${BAR}x("G-TEST000000")` }), "G-TEST000000"),
    ).toEqual([]);
  });

  it("set: the id missing fails; the loader missing fails only for an instance with the bar", () => {
    expect(checkGa(dist({ "index.html": "", "assets/a.js": BAR }), "G-TEST000000")).toEqual([
      "the given id G-TEST000000 is not in the build",
    ]);
    const noBar = dist({ "index.html": "", "assets/a.js": 'x("G-TEST000000")' });
    expect(checkGa(noBar, "G-TEST000000")).toEqual([
      "the bar in the build has no analytics loader (@oceanmetrics/nav >= 0.2.0)",
    ]);
    expect(checkGa(noBar, "G-TEST000000", { loader: false })).toEqual([]);
  });
});
