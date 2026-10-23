// Clicks, hovers and the camera — the two load-bearing rules being "the cell id comes from the
// RELEASE's grid" and "a camera move is centre+zoom, never fitBounds".
import { describe, expect, it, vi } from "vitest";
import {
  FALLBACK_FULL_STUDY_AREA,
  flyToStudyArea,
  gridFromBoot,
  mapClick,
  studyAreaFromBoot,
  studyAreasFromBoot,
  type QueriedFeature,
} from "../../src/lib/map/interaction";
import { cellFromLonLat } from "../../src/lib/grid/grid";

/** usa05 (v1-v7): 3103 x 2006 from xmin 141.10 on a 0-360 frame. */
const USA05_BOOT = {
  grid_id: "usa05",
  grid: {
    nc: 3103,
    nr: 2006,
    xmin: 141.1,
    ymax: 74.75,
    resx: 0.05,
    resy: 0.05,
    lon360: true,
    tile: { size: 50 },
  },
};
/** global05 (v8+): 7200 x 3600 from -180. */
const GLOBAL05_BOOT = {
  grid_id: "global05",
  grid: { nc: 7200, nr: 3600, xmin: -180, ymax: 90, resx: 0.05, resy: 0.05, tile: { size: 50 } },
};

describe("study areas", () => {
  const boot = {
    study_areas: [
      { key: "FULL", label: "All US waters", lon: -101.304, lat: 46.9, zoom: 2.16 },
      { key: "GA", label: "Gulf of America", lon: -89.089, lat: 26.251, zoom: 3.74 },
    ],
  };

  it("reads an array of rows", () => {
    expect(studyAreasFromBoot(boot).map((a) => a.key)).toEqual(["FULL", "GA"]);
  });

  it("reads an object keyed by study area, too (atlas-1 has not frozen the shape)", () => {
    const keyed = { study_areas: { AK: { lon: -164.654, lat: 63.327, zoom: 2.35 } } };
    expect(studyAreaFromBoot(keyed, "AK")).toEqual({
      key: "AK",
      label: undefined,
      lon: -164.654,
      lat: 63.327,
      zoom: 2.35,
    });
  });

  it("an unknown ?area= clamps to FULL rather than erroring (state/codec.ts's rule)", () => {
    expect(studyAreaFromBoot(boot, "NOPE").key).toBe("FULL");
  });

  it("a release with no study_areas falls back to the baked FULL camera", () => {
    expect(studyAreaFromBoot(null, "FULL")).toEqual(FALLBACK_FULL_STUDY_AREA);
    expect(FALLBACK_FULL_STUDY_AREA).toMatchObject({ lon: -101.304, lat: 46.9, zoom: 2.16 });
  });
});

describe("flyToStudyArea", () => {
  it("is centre + zoom, marked programmatic so the URL is not rewritten mid-flight", () => {
    const flyTo = vi.fn();
    flyToStudyArea({ flyTo }, { key: "GA", lon: -89.089, lat: 26.251, zoom: 3.74 });
    expect(flyTo).toHaveBeenCalledWith(
      { center: [-89.089, 26.251], zoom: 3.74 },
      { atlasProgrammatic: true },
    );
  });
});

describe("mapClick", () => {
  const fakeMap = (features: QueriedFeature[]) => ({
    queryRenderedFeatures: vi.fn(() => features),
    project: vi.fn(() => ({ x: 10, y: 20 })),
  });

  it("computes the cell id with the RELEASE's grid — the same lon/lat differs per grid", () => {
    const map = fakeMap([]);
    const lngLat = { lng: -160.2, lat: 55.3 };
    const usa05 = mapClick(
      map,
      lngLat,
      { x: 10, y: 20 },
      { grid: gridFromBoot(USA05_BOOT), units: [] },
    );
    const global05 = mapClick(
      map,
      lngLat,
      { x: 10, y: 20 },
      { grid: gridFromBoot(GLOBAL05_BOOT), units: [] },
    );
    expect(usa05.cellId).toBe(cellFromLonLat(-160.2, 55.3, gridFromBoot(USA05_BOOT)));
    expect(global05.cellId).toBe(cellFromLonLat(-160.2, 55.3, gridFromBoot(GLOBAL05_BOOT)));
    // the regression this rule exists for: the same click is a DIFFERENT cell on the two grids.
    expect(usa05.cellId).not.toBe(global05.cellId);
  });

  it("a click outside the grid is a null cell id, never a clamped one", () => {
    const map = fakeMap([]);
    const click = mapClick(
      map,
      { lng: 10, lat: 50 },
      { x: 1, y: 1 },
      { grid: gridFromBoot(USA05_BOOT), units: [] },
    );
    expect(click.cellId).toBeNull();
  });

  it("returns the click's lngLat alongside the cell id, and never queries rendered features", () => {
    const map = fakeMap([]);
    const click = mapClick(
      map,
      { lng: -160.2, lat: 55.3 },
      { x: 10, y: 20 },
      { grid: gridFromBoot(USA05_BOOT), units: [] },
    );
    // no zone units (an instance without a release): no layer to query
    expect(map.queryRenderedFeatures).not.toHaveBeenCalled();
    expect(click.lngLat).toEqual({ lng: -160.2, lat: 55.3 });
    expect(click.cellId).not.toBeNull();
  });
});
