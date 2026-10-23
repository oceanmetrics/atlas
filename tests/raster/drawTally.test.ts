// build week 6 step 5: "N of M rasters drawn from the browser", the retirement day's evidence on the page
// (`raster/drawTally.ts`, recorded by Shell.svelte from the composed style, shown by About.svelte).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  rasterOriginOf,
  tallyCounts,
  tallyLine,
  tallyRasters,
} from "../../src/lib/raster/drawTally";
import { titilerMaskTileTemplate, titilerTileTemplate } from "../../src/lib/map/layers/titiler";

const COPY =
  "https://s3.us-east-1.amazonaws.com/oceanmetrics.io-public/marine-atlas/v7/cog_3857/cog/usa05/aa_3857.tif";
const ORIG =
  "https://s3.us-east-1.amazonaws.com/oceanmetrics.io-public/marine-atlas/cog/usa05/bb.tif";
const browser = (href = COPY, stops = '["#000000","#ffffff"]') => ({
  tiles: [`cog://${href}#color:${stops},1,100,c/{z}/{x}/{y}`],
});
const titiler = (url = ORIG) => ({
  tiles: [titilerTileTemplate({ url, colormapName: "spectral_r", rescaleMin: 1, rescaleMax: 100 })],
});

describe("rasterOriginOf", () => {
  it("a cog:// template is the browser, keyed by its file", () => {
    expect(rasterOriginOf(browser())).toEqual({ key: COPY, origin: "browser" });
  });
  it("a titiler /cog/tiles template (named or explicit colormap) is titiler, keyed by its decoded url", () => {
    expect(rasterOriginOf(titiler())).toEqual({ key: ORIG, origin: "titiler" });
    expect(
      rasterOriginOf({
        tiles: [titilerMaskTileTemplate({ url: ORIG, colormap: { "1": [34, 34, 34, 255] } })],
      }),
    ).toEqual({ key: ORIG, origin: "titiler" });
  });
  it("a hidden layer, no layer, and any other template are not counted", () => {
    expect(rasterOriginOf({ ...titiler(), visible: false })).toBeNull();
    expect(rasterOriginOf(null)).toBeNull();
    expect(rasterOriginOf({ tiles: ["pmtiles://x/{z}/{x}/{y}"] })).toBeNull();
  });
});

describe("tallyRasters", () => {
  it("counts each file once per visit: a new palette of the same file is not a second raster", () => {
    let seen = tallyRasters({}, [browser(), titiler()]);
    seen = tallyRasters(seen, [browser(COPY, '["#111111","#eeeeee"]')]);
    expect(tallyCounts(seen)).toEqual({ browser: 1, total: 2 });
  });
  it("returns the same object when nothing is new (the shell skips the write)", () => {
    const seen = tallyRasters({}, [browser()]);
    expect(tallyRasters(seen, [browser(), null])).toBe(seen);
  });
});

describe("tallyLine", () => {
  it("says N of M", () => {
    expect(tallyLine({ browser: 2, total: 3 })).toBe("2 of 3 rasters drawn from the browser");
    expect(tallyLine({ browser: 1, total: 1 })).toBe("1 of 1 raster drawn from the browser");
  });
});

describe("wiring: the shell records the composed rasters, About shows the line", () => {
  const src = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
  it("Shell.svelte tallies the style's raster and overlays and hands the counts to the top bar", () => {
    const shell = src("src/shell/Shell.svelte");
    expect(shell).toMatch(/tallyRasters\(prev, specs\)/);
    expect(shell).toMatch(/\[composeStyleInput\.raster, \.\.\.composeStyleInput\.overlays\]/);
    expect(shell).toMatch(/rasterTally=\{tallyCounts\(rastersSeen\)\}/);
  });
  it("TopBarActions passes it to About, which renders tallyLine under data-testid=about-rasters", () => {
    expect(src("src/shell/TopBarActions.svelte")).toMatch(/\{rasterTally\}/);
    expect(src("src/shell/About.svelte")).toMatch(
      /data-testid="about-rasters">\{tallyLine\(rasterTally\)\}/,
    );
  });
});
