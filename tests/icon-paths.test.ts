// atlas-3 step 2: the icon map is mechanical, not typed by hand (docs/design/spec.md §6). These
// prove: every spec icon exists; every MDI path equals @mdi/js's own export character for
// character; the bespoke flower glyph is read from its .svg, never retyped; regenerating the
// module in memory is byte-identical to the committed file (no shell-out — see
// scripts/build-icon-paths.mjs's header for why a shell-out test is the wrong shape here); and that
// a wrong export name or a missing glyph path fails loudly instead of drawing a wrong picture.
import { readFileSync } from "node:fs";
import * as mdi from "@mdi/js";
import { describe, expect, it } from "vitest";
import {
  FLOWER_SVG_FILE,
  generateIconPathsSource,
  glyphPathFromSvg,
  ICON_MAP_FILE,
  OUTPUT_FILE,
  resolveIconPaths,
} from "../scripts/build-icon-paths.mjs";
import { ICON_PATHS } from "../src/lib/ui/icon-paths";

const ICON_MAP = JSON.parse(readFileSync(ICON_MAP_FILE, "utf8")) as Record<string, string>;
const COMMITTED_FILE = readFileSync(OUTPUT_FILE, "utf8");
const FLOWER_PATH = glyphPathFromSvg(readFileSync(FLOWER_SVG_FILE, "utf8"));

// the icon table in docs/design/spec.md §6, minus the one bespoke row (flower)
const SPEC_ICON_NAMES = [
  "layers",
  "places",
  "flower",
  "table",
  "report",
  "help",
  "search",
  "share",
  "themeSun",
  "themeMoon",
  "version",
  "chevronDown",
  "chevronUp",
  "collapseSide",
  // R4-B: the left-docked panel's collapse chevron points at ITS edge (the default side is left).
  "collapseSideLeft",
  "collapseDown",
  // UI-19 (round 3): the phone sheet's "peek" detent -- the collapse control's own flipped
  // direction ("Expand to half") instead of a dead "Collapse to a peek" no-op there.
  "collapseUp",
  "dockRight",
  "dockBottom",
  "dockLeft",
  "expand",
  "collapseAll",
  "close",
  "info",
  "copy",
  "check",
  "alert",
  "download",
  "upload",
  "draw",
  "filter",
  "sortAsc",
  "sortDesc",
  "preview",
  "maximize",
  "restore",
  "more",
  "feedback",
  "tour",
  // R3-W2 (Download menu items): a raster PNG, an SVG wrapper, a GeoTIFF data layer, a GeoJSON
  // vector export -- distinct from "download" (the trigger button itself) and "draw" (the
  // upload/draw tool, an unrelated feature).
  "image",
  "vectorFile",
  "geoRaster",
  "geoVector",
  "opacity",
  // Layers pane R3-W1 fix round (Ben): the row expander (disclosure caret) and the reorder
  // buttons must differ by GLYPH, not only placement -- chevronRight (rotates open) for the
  // former, arrowUp/arrowDown for the latter.
  "chevronRight",
  "arrowUp",
  "arrowDown",
  // WP14: "Zoom to layer" (Layers panel's Data row, the legend card)
  "zoomToLayer",
];

// SVG path command characters and allowed symbols (see tests/glyphs.test.ts for a real parser;
// this is just a cheap sanity net over every generated path, not only the bespoke one)
const SVG_PATH_CHARS = /^[MmLlHhVvCcSsQqTtAaZz0-9.\s,\-+eE]*$/;

describe("icon-paths (atlas-3 step 2)", () => {
  it("every icon named in docs/design/spec.md §6 exists in ICON_PATHS", () => {
    for (const name of SPEC_ICON_NAMES) {
      expect(ICON_PATHS, name).toHaveProperty(name);
    }
  });

  it("scripts/icon-map.json plus the bespoke flower covers exactly the spec table", () => {
    expect(new Set([...Object.keys(ICON_MAP), "flower"])).toEqual(new Set(SPEC_ICON_NAMES));
  });

  it("every MDI icon path equals @mdi/js's own export character for character", () => {
    for (const [name, exportName] of Object.entries(ICON_MAP)) {
      const expected = (mdi as Record<string, string>)[exportName];
      expect(expected, `@mdi/js has no export "${exportName}"`).toBeTypeOf("string");
      expect(ICON_PATHS[name as keyof typeof ICON_PATHS], name).toBe(expected);
    }
  });

  it("the bespoke flower path is read from its .svg, byte-identical, never retyped", () => {
    expect(ICON_PATHS.flower).toBe(FLOWER_PATH);
  });

  it("every path starts with M and contains only valid SVG path characters", () => {
    for (const [name, d] of Object.entries(ICON_PATHS)) {
      expect(d, `path "${name}"`).toMatch(/^M/);
      expect(d, `path "${name}"`).toMatch(SVG_PATH_CHARS);
    }
  });

  it("has no duplicate path data collapsed onto a wrong shared name", () => {
    // version/chevronDown intentionally share one MDI path (spec §6); every other name is unique
    const byPath = new Map<string, string[]>();
    for (const [name, d] of Object.entries(ICON_PATHS)) {
      byPath.set(d, [...(byPath.get(d) ?? []), name]);
    }
    for (const [, names] of byPath) {
      if (names.length > 1) expect(new Set(names.map((n) => ICON_MAP[n]))).toHaveLength(1);
    }
  });

  it("does not import @mdi/js directly (paths are inlined, tree-shaken per name)", () => {
    expect(COMMITTED_FILE).not.toMatch(/from\s+["']@mdi\/js["']/);
  });

  it("regenerates icon-paths.ts byte-identical to the committed file (no shell-out)", async () => {
    const paths = resolveIconPaths(ICON_MAP, mdi as unknown as Record<string, string>, {
      flower: FLOWER_PATH,
    });
    const regenerated = await generateIconPathsSource(paths);
    expect(regenerated).toBe(COMMITTED_FILE);
  });

  it("throws loudly on a wrong @mdi/js export name, instead of drawing a wrong picture", () => {
    expect(() =>
      resolveIconPaths(
        { oops: "mdiThisExportDoesNotExist" },
        mdi as unknown as Record<string, string>,
        {},
      ),
    ).toThrow(/no export named/);
  });

  it("throws if a bespoke glyph collides with an @mdi/js-backed name", () => {
    expect(() =>
      resolveIconPaths({ layers: "mdiLayers" }, mdi as unknown as Record<string, string>, {
        layers: "M0 0",
      }),
    ).toThrow(/collides/);
  });
});
