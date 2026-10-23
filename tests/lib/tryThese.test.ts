// Help -> "Try these": the five atlas views are codec urls, and each reads back as the view it names. One assertion per
// rule: the list (ids, order), the round trip through parseSel/formatSel, the fields that make each view what its label
// says, and that the gate is the instance's (`tryThese` in instance.json, the module table's capability).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readInstance } from "../../scripts/instance.mjs";
import { instanceFlags, selectedEntries } from "../../scripts/instance-modules.mjs";
import { formatSel, parseSel } from "../../src/lib/state/codec";
import { DEFAULT_SEL } from "../../src/lib/state/types";
import { TRY_THESE, tryHref, tryUrl } from "../../src/lib/tryThese";

const BASE = "https://oceanmetrics.io/atlas/";
const view = (id: string) => TRY_THESE.find((t) => t.id === id)!;
const read = (id: string) => {
  const u = new URL(tryUrl(view(id), BASE));
  return parseSel({ search: u.search, hash: u.hash });
};

describe("the list", () => {
  it("five views, in the order Help shows them, each with a label", () => {
    expect(TRY_THESE.map((t) => t.id)).toEqual([
      "obis-richness",
      "obis-es-2020s",
      "fish-monterey",
      "cetacea",
      "eov-risk",
    ]);
    for (const t of TRY_THESE) expect(t.label.length).toBeGreaterThan(10);
  });

  it("every link round-trips: parseSel then formatSel writes the same url", () => {
    for (const t of TRY_THESE) {
      const href = tryHref(t);
      const u = new URL(href, BASE);
      const sel = parseSel({ search: u.search, hash: u.hash });
      const again = formatSel(sel);
      expect(`${again.search || "?"}${again.hash}`, t.id).toBe(href);
      // and what was asked is what was read
      expect(sel, t.id).toMatchObject(t.sel);
    }
  });

  it("every link is distinct", () => {
    expect(new Set(TRY_THESE.map(tryHref)).size).toBe(TRY_THESE.length);
  });
});

describe("each view is what its label says", () => {
  it("OBIS species richness on the globe: the all-taxa item, indicator sp, all years; the globe is the codec's default projection, so no proj key", () => {
    expect(tryUrl(view("obis-richness"), BASE)).toBe(
      `${BASE}?c=obis_h3&i=all&dim.indicator=sp&dim.period=all`,
    );
    expect(read("obis-richness").proj).toBe("globe");
  });

  it("ES(50) in the 2020s", () => {
    expect(read("obis-es-2020s").dim).toEqual({ indicator: "es", period: "2020s" });
  });

  it("the fish EOV at Monterey: the fish item over Monterey Bay, zoomed in", () => {
    const s = read("fish-monterey");
    expect(s.i).toBe("fish");
    expect(s.map!.lon).toBeCloseTo(-122.1, 1);
    expect(s.map!.lat).toBeCloseTo(36.75, 1);
    expect(s.map!.zoom).toBeGreaterThanOrEqual(8);
  });

  it("the WoRMS subtree is Cetacea, resolved from the name, at a pinned resolution", () => {
    const s = read("cetacea");
    expect(s.taxon).toBe("infraorder:Cetacea");
    expect(s.res).toBe(3);
  });

  it("the EOV risk COG: the composite risk item of the AquaMaps EOV share (the flower's collection)", () => {
    const s = read("eov-risk");
    expect(s.c).toBe("aquamaps_eov");
    expect(s.i).toBe("all_risk");
  });

  it("the default view is not one of them (a link must change the map)", () => {
    for (const t of TRY_THESE) expect(tryHref(t), t.id).not.toBe("?");
    expect(formatSel(DEFAULT_SEL).search).toBe("");
  });
});

describe("the gate is the instance's", () => {
  const entries = (id: string) =>
    selectedEntries(readInstance(id)).map((e: unknown[]) => `${e[0]}.${e[1]}`);

  it("oceanmetrics has it; marinesensitivity does not", () => {
    expect(instanceFlags(readInstance("oceanmetrics")).__TRY_THESE__).toBe(true);
    expect(instanceFlags(readInstance("marinesensitivity")).__TRY_THESE__).toBe(false);
    expect(entries("oceanmetrics")).toContain("capabilities.tryThese");
    expect(entries("marinesensitivity")).not.toContain("capabilities.tryThese");
  });

  it("Help and About mount it only behind the build flag, as a dynamic import", () => {
    const shell = readFileSync("src/shell/Shell.svelte", "utf8");
    const about = readFileSync("src/shell/About.svelte", "utf8");
    expect(shell).toMatch(/__TRY_THESE__ && TryTheseList/);
    expect(about).toMatch(/__TRY_THESE__ && TryTheseList/);
    for (const src of [shell, about]) {
      expect(src).toMatch(/import\("\.\/TryThese\.svelte"\)/);
      expect(src).not.toMatch(/^\s*import .* from "\.\/TryThese\.svelte"/m);
      expect(src).not.toMatch(/lib\/tryThese"/);
    }
  });
});
