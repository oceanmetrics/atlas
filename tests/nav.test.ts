// The Ocean Metrics bar (@oceanmetrics/nav) is per instance: `nav` in instance.json is `false` or the
// bar's settings, `NAV` (src/lib/brand/instance.ts) is `null` or those settings, and the shell
// renders the element only for the second, through a dynamic import so an instance without the bar
// carries none of it (the dist check, tests/instance-modules.test.ts, proves that on a build).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readInstance } from "../scripts/instance.mjs";
import { instanceFlags } from "../scripts/instance-modules.mjs";
import { INSTANCE, NAV, navOf, type Instance } from "../src/lib/brand/instance";

const OM = readInstance("oceanmetrics") as Instance;
const MST = readInstance("marinesensitivity") as Instance;
const SHELL = readFileSync("src/shell/Shell.svelte", "utf8");
const CSS = readFileSync("src/shell/shell.css", "utf8");

describe("NAV", () => {
  it("oceanmetrics marks the atlas; marinesensitivity has no bar (null)", () => {
    expect(navOf(OM)).toEqual({ current: "atlas" });
    expect(navOf(MST)).toBeNull();
  });

  it("the built instance's NAV is its own instance.json's", () => {
    expect(NAV).toEqual(navOf(readInstance(INSTANCE.id) as Instance));
    expect(instanceFlags(INSTANCE).__NAV__).toBe(NAV !== null);
  });

  it("an object with only `current` is a bar; `false` is none", () => {
    expect(navOf({ nav: { current: "x" } })).toEqual({ current: "x" });
    expect(navOf({ nav: false })).toBeNull();
  });
});

describe("the shell", () => {
  it("renders the bar above the top bar, only behind the build flag", () => {
    const bar = SHELL.indexOf("<om-nav");
    expect(bar).toBeGreaterThan(0);
    expect(bar).toBeLessThan(SHELL.indexOf('<header class="topbar"'));
    expect(SHELL).toMatch(/\{#if __NAV__ && NAV\}\s*<!--[^>]*-->\s*<om-nav/);
  });

  it("registers the element by a dynamic import behind the flag, never statically", () => {
    expect(SHELL).toMatch(/if \(__NAV__ && NAV\) void import\("@oceanmetrics\/nav\/define"\)/);
    expect(SHELL).not.toMatch(/^\s*import\s[^;]*@oceanmetrics\/nav/m);
  });

  it("hands GA4 to the bar on an instance with it (data-ga from gaLegs), the module's leg only without it", () => {
    const bar = SHELL.slice(SHELL.indexOf("<om-nav"), SHELL.indexOf("</om-nav>"));
    expect(bar).toMatch(/data-ga=\{GA\.bar \|\| undefined\}/);
    expect(SHELL).toMatch(/const GA = gaLegs\(analyticsGaId\(\), __NAV__ && NAV !== null\);/);
    expect(SHELL).toMatch(/measurementId: GA\.module,/);
    expect(SHELL).not.toMatch(/measurementId: analyticsGaId\(\)/);
  });

  it("leaves the place search to the bar's default (no search-href)", () => {
    expect(SHELL.slice(SHELL.indexOf("<om-nav"), SHELL.indexOf("</om-nav>"))).not.toContain(
      "search-href",
    );
  });

  it("the grid has a row for the bar and an undefined bar reserves 48 px", () => {
    expect(CSS).toMatch(
      /\.app:has\(> om-nav\)\s*\{[^}]*grid-template-rows:\s*auto var\(--size-topbar\) 1fr/,
    );
    expect(CSS).toMatch(/om-nav:not\(:defined\)\s*\{[^}]*display:\s*block;[^}]*min-height:\s*48px/);
  });
});
