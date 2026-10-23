// The Place page's "Species on the map" link (build week 4, step 5): placeObisUrl writes the OBIS layer's grammar
// with the place as the `p.` token and a camera on its bbox; the atlas's own parseSel opens it.
import { describe, expect, it } from "vitest";
import { decodePlaces } from "../../src/lib/geo/placeCodec";
import { parseSel } from "../../src/lib/state/codec";
import { cameraForBbox, placeObisUrl } from "../../src/lib/state/obisPlace";

const open = (url: string) => {
  const u = new URL(url);
  return parseSel({ search: u.search, hash: u.hash });
};

describe("placeObisUrl", () => {
  it("CINMS: the OBIS layer, the place selected, the camera on its box", () => {
    const url = placeObisUrl({
      placeId: "NMS:CINMS",
      name: "Channel Islands",
      bbox: [-120.65, 33.2, -118.85, 34.25],
    });
    expect(url).toBe(
      "https://oceanmetrics.io/atlas/?c=obis_h3&i=all&dim.indicator=es&dim.period=all&res=auto&map=-119.75,33.725,8.38#pl=p.NMS%253ACINMS.Channel%2520Islands",
    );
    const s = open(url);
    expect(s.c).toBe("obis_h3");
    expect(s.i).toBe("all");
    expect(s.dim).toEqual({ indicator: "es", period: "all" });
    expect(s.res).toBeUndefined();
    expect(s.map).toEqual({ lon: -119.75, lat: 33.725, zoom: 8.38 });
    expect(decodePlaces(s.pl!)).toEqual([
      { kind: "gaz", id: "NMS:CINMS", name: "Channel Islands" },
    ]);
  });
  it("an EOV, an indicator, a period; another origin; no bbox, no camera", () => {
    const url = placeObisUrl({
      placeId: "MRGID:8432",
      item: "seabirds",
      indicator: "n",
      period: "1990s",
      origin: "https://staging.example/",
    });
    expect(
      url.startsWith(
        "https://staging.example/atlas/?c=obis_h3&i=seabirds&dim.indicator=n&dim.period=1990s&res=auto#pl=",
      ),
    ).toBe(true);
    const s = open(url);
    expect(s.map).toBeUndefined();
    expect(decodePlaces(s.pl!)[0]).toMatchObject({ kind: "gaz", id: "MRGID:8432", name: "" });
  });
  it("a refused id opens the layer without the place, never throws", () => {
    const url = placeObisUrl({ placeId: "" });
    expect(url).not.toContain("#pl=");
    expect(open(url).c).toBe("obis_h3");
  });
});

describe("cameraForBbox", () => {
  it("frames a small box close, a large one far, clamped 1..10", () => {
    expect(cameraForBbox([-1, -1, 1, 1])!.zoom).toBeCloseTo(8.23, 2);
    expect(cameraForBbox([-0.01, -0.01, 0.01, 0.01])!.zoom).toBe(10);
    expect(cameraForBbox([-180, -90, 180, 90])!.zoom).toBe(1);
  });
  it("across the antimeridian (Papahānaumokuākea, east past 180 or below west)", () => {
    const a = cameraForBbox([177.8, 18.5, 199.0, 32.0])!;
    const b = cameraForBbox([177.8, 18.5, -161.0, 32.0])!;
    expect(a).toEqual(b);
    expect(a.lon).toBeCloseTo(-171.6, 1);
  });
  it("a malformed box is null", () => {
    expect(cameraForBbox(null)).toBeNull();
    expect(cameraForBbox([0, 10, 1, 5])).toBeNull();
    expect(cameraForBbox([0, Number.NaN, 1, 5])).toBeNull();
  });
});
