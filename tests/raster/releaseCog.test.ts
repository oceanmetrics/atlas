// build week 6 step 5: a MarineSensitivity release COG drawn from its EPSG:3857 copy (`raster/releaseCog.ts`), one
// rule per test, over a side-table fixture of three real v7 rows (`tests/fixtures/release/cog_3857_lenses.parquet`,
// copied from `marine-atlas/v7/tables/cog_3857.parquet` on 2026-10-23): the Marbled Murrelet's merged species COG
// (uint8, nodata 0, 25..50), the v7 composite score COG (`score_extriskspcat_..._equalweights`, 0..93) and the
// `_outside_pra` mask (float32, nodata -9999, every valid pixel 1).
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { releaseCogSources } from "../../src/lib/raster/cog";
import {
  createReleaseBoundsSource,
  createReleaseValueSource,
  headerBounds,
  releaseCogDraw,
  releaseOriginal,
} from "../../src/lib/raster/releaseCog";
import { CANDIDATE_LONS } from "../../src/lib/raster/bounds";
import { clearCog3857Cache } from "../../src/lib/release/cog3857";
import { PUBLIC_DATA_BASE } from "../../src/lib/release/dataBase";
import { OUTSIDE_PRA_CLASSES } from "../../src/lens/scores/raster";

const FIXTURE = new URL("../fixtures/release/cog_3857_lenses.parquet", import.meta.url);
const table = (): ArrayBuffer => {
  const b = readFileSync(FIXTURE);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
};
const SPECIES = "7d028c7d233f11f3";
const SCORE = "6671c14ba25ba9fa";
const MASK = "4fbd1ad662c7fbd9";
const orig = (h: string) => `${PUBLIC_DATA_BASE}cog/usa05/${h}.tif`;
const copy = (h: string) => `${PUBLIC_DATA_BASE}v7/cog_3857/cog/usa05/${h}_3857.tif`;
// the v7 boot's spectral_r stops (`app/boot.json` `palettes.spectral_r`), as the lens passes them
const SPECTRAL_R = [
  "#5E4EA1",
  "#3287BD",
  "#66C1A5",
  "#ABDDA4",
  "#E5F498",
  "#FFFFBF",
  "#FEDF8B",
  "#FDAD60",
  "#F36C43",
  "#D43E4E",
  "#9E0041",
];

beforeEach(() => clearCog3857Cache());
afterEach(() => releaseCogSources());

describe("releaseCogDraw: the side table decides who draws", () => {
  it("a species COG the table lists is drawn from its 3857 copy, in the palette's stops over the rescale", async () => {
    const c = await releaseCogDraw({
      ver: "v7",
      cogUrl: orig(SPECIES),
      domain: [1, 100],
      paint: { kind: "stops", stops: SPECTRAL_R },
      opacity: 0.8,
      table: table(),
    });
    expect(c.kind).toBe("cog");
    if (c.kind !== "cog") return;
    expect(c.drawHref).toBe(copy(SPECIES));
    expect(c.valuesHref).toBe(orig(SPECIES));
    expect(c.source.kind).toBe("cog");
    expect(c.source.template).toBe(
      `cog://${copy(SPECIES)}#color:${JSON.stringify(SPECTRAL_R.map((s) => s.toLowerCase()))},1,100,c/{z}/{x}/{y}`,
    );
    expect(c.source.opacity).toBe(0.8);
    expect(c.source.maxzoom).toBe(5); // the copy's own zoom_max: MapLibre overzooms above it
  });

  it("the legend's histogram is the side table's (32 buckets over the original's own min and max)", async () => {
    const c = await releaseCogDraw({
      ver: "v7",
      cogUrl: orig(SCORE),
      domain: [0, 93],
      paint: { kind: "stops", stops: SPECTRAL_R },
      opacity: 0.6,
      table: table(),
    });
    expect(c.kind === "cog" && c.histogram).toEqual({
      binCount: 32,
      min: 0,
      max: 93,
      counts: [
        22896, 46414, 12209, 24528, 25800, 68346, 128950, 67459, 53248, 35711, 18817, 18093, 16015,
        13664, 11847, 10932, 10984, 9841, 10541, 7157, 4982, 2139, 2527, 1959, 1603, 1350, 1034,
        452, 206, 44, 10, 13,
      ],
    });
  });

  it("the mask is its own 3857 copy painted by titiler's explicit table (1 -> the mask grey)", async () => {
    const c = await releaseCogDraw({
      ver: "v7",
      cogUrl: orig(MASK),
      domain: null,
      paint: { kind: "classes", classes: OUTSIDE_PRA_CLASSES },
      opacity: 0.55,
      table: table(),
    });
    expect(c.kind).toBe("cog");
    if (c.kind !== "cog") return;
    expect(c.drawHref).toBe(copy(MASK));
    expect(c.source.template).toBe(`cog://${copy(MASK)}#color:["#222222"],1,1,c/{z}/{x}/{y}`);
  });

  it("titiler when the table has no row, the url is not a store key, or the table is unreadable (seeded faults)", async () => {
    const req = {
      ver: "v7",
      domain: [1, 100] as [number, number],
      paint: { kind: "stops" as const, stops: SPECTRAL_R },
      opacity: 0.8,
    };
    expect(
      await releaseCogDraw({ ...req, cogUrl: orig("ffffffffffffffff"), table: table() }),
    ).toEqual({
      kind: "titiler",
    });
    expect(await releaseCogDraw({ ...req, cogUrl: "https://x.org/a.tif", table: table() })).toEqual(
      {
        kind: "titiler",
      },
    );
    const notParquet = new TextEncoder().encode("<Error>403</Error>").buffer as ArrayBuffer;
    expect(await releaseCogDraw({ ...req, cogUrl: orig(SPECIES), table: notParquet })).toEqual({
      kind: "titiler",
    });
  });
});

describe("releaseOriginal: where values and bounds are read", () => {
  it("the 4326 original when the table resolves the COG, else null (titiler's /cog/point and /cog/info)", async () => {
    expect(await releaseOriginal("v7", orig(SPECIES), { table: table() })).toBe(orig(SPECIES));
    expect(await releaseOriginal("v7", orig("ffffffffffffffff"), { table: table() })).toBeNull();
  });
});

describe("createReleaseValueSource: the point read goes to the original", () => {
  it("reads the href it is given (the 4326 original), every band, nodata as null", async () => {
    const asked: string[] = [];
    const vs = createReleaseValueSource(async (href) => {
      asked.push(href);
      return [42, NaN];
    });
    const r = { domain: "species" as const, lon: -124, lat: 45, cogUrl: orig(SPECIES) };
    expect(await vs.pointValue(r)).toBe(42);
    expect(await vs.pointValues(r)).toEqual({ values: [42, null] });
    expect(asked).toEqual([orig(SPECIES), orig(SPECIES)]);
  });
});

describe("createReleaseBoundsSource: the camera's last resort from the original", () => {
  it("the header's extent as is when it does not span the globe", async () => {
    const src = createReleaseBoundsSource(
      async () => [-126, 32.3, -117, 49.1],
      async () => null,
    );
    expect(await src.cogBounds(orig(SPECIES))).toEqual([-126, 32.3, -117, 49.1]);
  });

  it("a whole-globe-width header extent is narrowed by pixel probes, the rule titiler's /cog/point probes kept (the walrus)", async () => {
    const probed: number[] = [];
    const src = createReleaseBoundsSource(
      async () => [-180, 53.15, 180, 73.75],
      async (_href, [lon]) => {
        probed.push(lon);
        return lon === -170 ? [91] : [NaN];
      },
    );
    expect(await src.cogBounds(orig(SPECIES))).toEqual([-190, 53.15, -150, 73.75]);
    expect(probed.sort((a, b) => a - b)).toEqual([...CANDIDATE_LONS].sort((a, b) => a - b));
  });

  it("an unreadable header is no bounds (never a throw)", async () => {
    const src = createReleaseBoundsSource(async () => {
      throw new Error("403");
    });
    expect(await src.cogBounds(orig(SPECIES))).toBeNull();
  });

  it("headerBounds reads the GeoTIFF's bounding box", async () => {
    const b = await headerBounds("x", async () => ({
      getImage: async () => ({ getBoundingBox: () => [-180, 32.3, 180, 60.45] }),
    }));
    expect(b).toEqual([-180, 32.3, 180, 60.45]);
  });
});
