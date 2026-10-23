// The OBIS layer's place filter (src/lens/collection/h3/placeFilter.ts, src/lib/gazetteer/resolve.ts
// `placeMembership`; obis-hex `places/membership.ts`): `?filter=places` keeps the hexagons of the hash's gazetteer
// places by the gazetteer's place x H3 membership. Fixture: tests/fixtures/obis_h3/membership/ (the `places`
// collection's membership.json trimmed to res 2, 5 and three res-6 parents; the res-2, res-5 and two res-6 files as
// published, 2026-10-23).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  FILTER_MAX_CELLS,
  membershipFiles,
  parseMembership,
  placeFilterExpr,
  placeFilterNote,
  readMembershipCells,
} from "../../src/lens/collection/h3/placeFilter";
import { placeMembership, type GazetteerClient } from "../../src/lib/gazetteer/resolve";
import { buffer, FIX } from "./support";

const URL0 =
  "https://s3.us-east-1.amazonaws.com/oceanmetrics.io-public/gazetteer/places/h3/membership.json";
const man = parseMembership(
  JSON.parse(readFileSync(`${FIX}membership/membership.json`, "utf8")),
  URL0,
)!;
const local = (u: string) =>
  buffer(`membership/${u.replace(URL0.replace("h3/membership.json", ""), "")}`);

describe("the membership manifest", () => {
  it("membership files per res and parent; notes", () => {
    expect(man.minShare).toBe(0.01);
    expect(man.parentRes).toEqual({ "6": 2, "7": 3 });
    expect(membershipFiles(man, 5).map((f) => f.url)).toEqual([
      // REGRESSION: the paths are under the collection's folder, not the manifest's (`places/h3/h3/...` was a 403)
      "https://s3.us-east-1.amazonaws.com/oceanmetrics.io-public/gazetteer/places/h3/res=5/membership.parquet",
    ]);
    // a split resolution reads the files of the given parents only, none without parents
    expect(membershipFiles(man, 6)).toEqual([]);
    expect(
      membershipFiles(man, 6, new Set(["822917fffffffff", "8229a7fffffffff"])).map((f) => f.parent),
    ).toEqual(["822917fffffffff", "8229a7fffffffff"]);
    expect(membershipFiles(man, 3)).toEqual([]);
    expect(parseMembership({ nope: 1 }, URL0)).toBeNull();
  });
  it("the place's hexagons, every row of it (a cell that holds 1% of the place counts, whatever its share)", async () => {
    const r2 = await readMembershipCells(local(membershipFiles(man, 2)[0].url), ["NMS:CINMS"]);
    expect(r2).toEqual(["822917fffffffff", "8229a7fffffffff"]);
    const r5 = await readMembershipCells(local(membershipFiles(man, 5)[0].url), ["NMS:CINMS"]);
    expect(r5).toHaveLength(28);
    expect(r5.every((h) => h[1] === "5")).toBe(true);
    // res 6: the parents are the place's own res-2 hexagons
    const files = membershipFiles(man, 6, new Set(r2));
    const r6 = (
      await Promise.all(files.map((f) => readMembershipCells(local(f.url), ["NMS:CINMS"])))
    ).flat();
    expect(r6).toHaveLength(138);
    expect(await readMembershipCells(local(membershipFiles(man, 5)[0].url), ["NMS:NOPE"])).toEqual(
      [],
    );
  });
});

describe("the filter on the map", () => {
  it("filtered partition feeds coverage and ramp: the fill keeps the layer's own filter and the place's hexagons", () => {
    const base = ["has", "es"] as never;
    expect(placeFilterExpr(base, ["85283473fffffff"])).toEqual([
      "all",
      ["has", "es"],
      ["in", ["get", "h3"], ["literal", ["85283473fffffff"]]],
    ]);
    // while the membership loads nothing is drawn (an empty list), never the unfiltered view
    expect(placeFilterExpr(base, [])).toEqual([
      "all",
      ["has", "es"],
      ["in", ["get", "h3"], ["literal", []]],
    ]);
    expect(FILTER_MAX_CELLS).toBe(60000);
  });
  it("the filter says statistics of the hexagons, and what it is waiting for", () => {
    const o = {
      phase: "ready" as const,
      places: 1,
      without: [],
      cells: 28,
      res: 5,
      minShare: 0.01,
    };
    expect(placeFilterNote(o)).toBe(
      "28 res-5 hexagons of the place (the gazetteer's H3 membership: at least 1% of the hexagon inside, or 1% of the place in it). The legend and the coverage line are statistics of the hexagons, not the place's own values: the Place page has those.",
    );
    expect(placeFilterNote({ ...o, places: 0 })).toBe(
      "Add a place from the gazetteer to keep only its hexagons.",
    );
    expect(placeFilterNote({ ...o, phase: "loading" })).toBe("Reading the places' H3 membership…");
    expect(placeFilterNote({ ...o, phase: "error", error: "HTTP 403" })).toBe(
      "The places' H3 membership could not be read (HTTP 403).",
    );
    expect(placeFilterNote({ ...o, without: ["CalCOFI line 90"], cells: 0 })).toMatch(
      /^CalCOFI line 90: no H3 membership in the gazetteer \(a point, a line or no build\), so no hexagons\. 0 res-5/,
    );
    expect(placeFilterNote({ ...o, tooMany: true })).toBe(
      "Too many hexagons at res 5 for this filter: zoom out or pin a coarser hexagon size.",
    );
  });
});

describe("where a place's membership is", () => {
  const layers = [
    {
      slug: "places",
      collection: "places",
      title: "Places",
      citation: "NOAA ONMS …",
      license: "CC-PDDC",
      h3: "https://storage.oceanmetrics.io/gazetteer/places/h3/membership.json",
    },
    { slug: "calcofi_lines", collection: "calcofi_lines", title: "CalCOFI lines", h3: null },
  ];
  const stub = (collection: string | null): GazetteerClient => ({
    getPlace: async () => (collection ? ({ collection } as never) : null),
    listLayers: async () => layers as never,
    creditsFor: async () => "",
  });
  it("credits and citation for a collection; the membership url on the data base (the storage host's 302 has no CORS)", async () => {
    expect(await placeMembership("NMS:CINMS", stub(null))).toEqual({
      id: "NMS:CINMS",
      slug: "places",
      title: "Places",
      citation: "NOAA ONMS …",
      license: "CC-PDDC",
      membership:
        "https://s3.us-east-1.amazonaws.com/oceanmetrics.io-public/gazetteer/places/h3/membership.json",
    });
  });
  it("a line collection has no membership; an unreachable gazetteer is no membership, never a throw", async () => {
    expect((await placeMembership("CALCOFI:090", stub("calcofi_lines"))).membership).toBeNull();
    const down: GazetteerClient = {
      getPlace: async () => {
        throw new Error("down");
      },
      listLayers: async () => [],
      creditsFor: async () => "",
    };
    expect(await placeMembership("BOEM:X", down)).toMatchObject({ slug: null, membership: null });
  });
});

describe("seas and oceans", () => {
  it("a sea clears the place and flies: 13 cameras, the places, their filter and the hexagon cleared", async () => {
    const { SEAS, seaPatch } = await import("../../src/lens/collection/h3/placeFilter");
    expect(SEAS.map((s) => s.label)).toEqual([
      "Whole world",
      "Pacific Ocean",
      "Atlantic Ocean",
      "Indian Ocean",
      "Southern Ocean",
      "Arctic Ocean",
      "Caribbean Sea",
      "Gulf of Maine",
      "North Sea",
      "Mediterranean Sea",
      "Great Barrier Reef",
      "Coral Triangle",
      "Benguela Current",
    ]);
    expect(seaPatch("gulf-maine")).toEqual({
      camera: { key: "gulf-maine", label: "Gulf of Maine", lon: -68.5, lat: 42.8, zoom: 6.2 },
      sel: {
        map: { lon: -68.5, lat: 42.8, zoom: 6.2 },
        pl: undefined,
        filter: undefined,
        cell: undefined,
      },
    });
    expect(seaPatch("atlantis")).toBeNull();
  });
});
