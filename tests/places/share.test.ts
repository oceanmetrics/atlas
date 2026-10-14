import { describe, expect, it } from "vitest";
import {
  describeShareSummary,
  diffSimplification,
  shareUrl,
  summarizeShare,
} from "../../src/places/share";
import { DEFAULT_SEL, type Sel } from "../../src/lib/state/types";
import { formatSel } from "../../src/lib/state/codec";
import {
  decodePlaces,
  encodePlaces,
  fitPlacesToUrl,
  URL_LONG_MAX,
  URL_SILENT_MAX,
  type GeomPlace,
  type Place,
} from "../../src/lib/geo/placeCodec";
import { closeRing } from "../../src/lib/geo/types";
import type { GridSpec } from "../../src/lib/grid/grid";

const GRID: GridSpec = {
  gridId: "global05",
  nc: 7200,
  nr: 3600,
  xmin: -180,
  ymax: 90,
  resx: 0.05,
  resy: 0.05,
  lon360: false,
  tileSize: 50,
};

const COLLECTION: Sel = { ...DEFAULT_SEL, lens: "collection" };

describe("summarizeShare", () => {
  it("reads lens/layer/camera/n places off Sel", () => {
    const sel: Sel = { ...COLLECTION, sp: "some-key", map: { lon: -100, lat: 40, zoom: 5 } };
    expect(summarizeShare(sel, [{ kind: "gaz", id: "NMS:fknms", name: "" }])).toEqual({
      lens: "collection",
      layer: "some-key",
      hasCamera: true,
      nPlaces: 1,
    });
  });

  it("layer is the species key", () => {
    const sel: Sel = { ...DEFAULT_SEL, sp: "some-species-key", lens: "species" };
    expect(summarizeShare(sel, []).layer).toBe("some-species-key");
  });

  it("layer is null and hasCamera is false when absent", () => {
    expect(summarizeShare(DEFAULT_SEL, [])).toEqual({
      lens: "collection",
      layer: null,
      hasCamera: false,
      nPlaces: 0,
    });
  });
});

describe("describeShareSummary", () => {
  it("reads as a sentence naming every carried piece", () => {
    const text = describeShareSummary({
      lens: "collection",
      layer: "composite",
      hasCamera: true,
      nPlaces: 2,
    });
    expect(text).toBe(
      'This link carries the collection lens, layer "composite", the current map view, 2 places.',
    );
  });

  it("singularizes one place", () => {
    const text = describeShareSummary({
      lens: "species",
      layer: null,
      hasCamera: false,
      nPlaces: 1,
    });
    expect(text).toContain("1 place.");
    expect(text).not.toContain("1 places");
  });
});

describe("diffSimplification", () => {
  const before: GeomPlace = {
    kind: "geom",
    name: "Before",
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [-124, 40],
          [-124, 40.5],
          [-124, 41],
          [-123.5, 41],
          [-123, 41],
          [-123, 40],
          [-124, 40],
        ],
      ],
    },
  };
  const after: GeomPlace = {
    kind: "geom",
    name: "After",
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [-124, 40],
          [-124, 41],
          [-123, 41],
          [-123, 40],
          [-124, 40],
        ],
      ],
    },
  };

  it("reports the vertex count drop and the area change percent", () => {
    const diff = diffSimplification(before, after);
    expect(diff.beforeVertices).toBe(7);
    expect(diff.afterVertices).toBe(5);
    expect(diff.areaChangePct).toBeCloseTo(0, 5); // this simplification happens to be area-neutral
  });

  it("cells before/after are null without a grid", () => {
    const diff = diffSimplification(before, after);
    expect(diff.cellsBefore).toBeNull();
    expect(diff.cellsAfter).toBeNull();
  });

  it("cells before/after are computed when a grid IS supplied", () => {
    const diff = diffSimplification(before, after, GRID);
    expect(diff.cellsBefore).toBeGreaterThan(0);
    expect(diff.cellsAfter).toBeGreaterThan(0);
  });
});

describe("shareUrl: the link is built from `newHash`, never trusting `href`'s own #pl= to match it", () => {
  const HREF = "https://marinesensitivity.org/atlas/?lens=scores#pl=g1.Old.AAAA&t=Report";

  it("replaces exactly the existing pl value, leaving every other part of the URL untouched", () => {
    const url = shareUrl(HREF, "g1.Old.AAAA", "g1.New.BBBBBBBB");
    expect(url).toBe(
      "https://marinesensitivity.org/atlas/?lens=scores#pl=g1.New.BBBBBBBB&t=Report",
    );
  });

  it("is a no-op replacement when the new hash equals the old one", () => {
    expect(shareUrl(HREF, "g1.Old.AAAA", "g1.Old.AAAA")).toBe(HREF);
  });

  it("inserts a #pl= at the front of the hash when there is no existing one to replace", () => {
    const noHash = "https://marinesensitivity.org/atlas/?lens=scores";
    expect(shareUrl(noHash, undefined, "g1.New.BBBB")).toBe(
      "https://marinesensitivity.org/atlas/?lens=scores#pl=g1.New.BBBB",
    );
    const withTitleOnly = "https://marinesensitivity.org/atlas/#t=Report";
    expect(shareUrl(withTitleOnly, undefined, "g1.New.BBBB")).toBe(
      "https://marinesensitivity.org/atlas/#pl=g1.New.BBBB&t=Report",
    );
  });
});

// P8 item 5 (Opus docs review, app finding #6): the tests above all pass a LITERAL, unescaped
// `href` string ("#pl=g1.Old.AAAA&t=Report") -- which is not what a real address bar ever holds.
// `formatSel` (`lib/state/codec.ts`) writes the hash through `URLSearchParams`, so a REAL `href`
// percent-encodes the `~` multi-place separator (-> "%7E") and doubles a place name's own internal
// "%20" escape (`encodeName()`) into "%2520". These tests build the href the SAME way the app
// actually does (`formatSel`), reproducing exactly the shape that broke the old substring-replace.
describe("shareUrl on a REAL (percent-encoded) address-bar href -- P8 item 5", () => {
  const RECT: GeomPlace["geometry"] = {
    type: "Polygon",
    coordinates: [
      [
        [-124, 40],
        [-124, 41],
        [-123, 41],
        [-123, 40],
        [-124, 40],
      ],
    ],
  };

  it("several places (a `~`-joined pl) survive a real percent-encoded href, not just a literal test string", () => {
    const places: Place[] = [
      { kind: "zone", set: "pa", keys: ["GAA"] },
      { kind: "zone", set: "pa", keys: ["WGA"] },
    ];
    const oldPl = encodePlaces(places);
    const { hash } = formatSel({ ...DEFAULT_SEL, pl: oldPl });
    const href = `https://marinesensitivity.org/atlas/${hash}`;
    expect(href).toContain("%7E"); // sanity: the `~` separator really IS percent-encoded here
    expect(href).not.toContain(`pl=${oldPl}`); // the exact string the old implementation searched for

    const newHash = encodePlaces([{ kind: "zone", set: "pa", keys: ["GAA", "WGA"] }]);
    const copied = shareUrl(href, oldPl, newHash);
    const params = new URLSearchParams(new URL(copied).hash.slice(1));
    expect(params.get("pl")).toBe(newHash);
    // this is exactly what the old (silently no-op) substring replace would have left behind:
    expect(params.get("pl")).not.toBe(oldPl);
  });

  it("a place name containing a space survives too (encodeName's own internal '%20', doubled by formatSel)", () => {
    const oldPl = encodePlaces([{ kind: "geom", name: "Gulf box", geometry: RECT }]);
    const { hash } = formatSel({ ...DEFAULT_SEL, pl: oldPl });
    const href = `https://marinesensitivity.org/atlas/${hash}`;
    expect(href).toMatch(/%2520/); // the name's own "%20" escape, doubled
    expect(href).not.toContain(`pl=${oldPl}`);

    const newHash = encodePlaces([{ kind: "geom", name: "Gulf box (simplified)", geometry: RECT }]);
    const copied = shareUrl(href, oldPl, newHash);
    const params = new URLSearchParams(new URL(copied).hash.slice(1));
    expect(params.get("pl")).toBe(newHash);
  });

  it("t= (a title) still round-trips beside the rewritten pl=", () => {
    const oldPl = encodePlaces([{ kind: "zone", set: "pa", keys: ["GAA"] }]);
    const { hash } = formatSel({ ...DEFAULT_SEL, pl: oldPl, t: "My Report, v1" });
    const href = `https://marinesensitivity.org/atlas/${hash}`;

    const newHash = encodePlaces([{ kind: "zone", set: "pa", keys: ["GAA", "WGA"] }]);
    const copied = shareUrl(href, oldPl, newHash);
    const params = new URLSearchParams(new URL(copied).hash.slice(1));
    expect(params.get("pl")).toBe(newHash);
    expect(params.get("t")).toBe("My Report, v1");
  });
});

// Fix round 1 (Opus review): "Dead ladder, link/number divergence" -- fitPlacesToUrl can return
// status "ok" (or "long") with simplified: true (a rung of the ladder DID have to run to reach
// that length), and the OLD ShareDialog.svelte branched on `status` first, so the ladder/accept
// control could never render for that case, and copyLink() copied `location.href` (the ORIGINAL,
// unsimplified link) while the dialog showed the SIMPLIFIED length. These tests exercise the exact
// mechanism the fix relies on: fitPlacesToUrl's OWN `simplified` flag, and shareUrl()'s length
// exactness -- not the .svelte file itself (no component-test runner in this repo; see
// e2e/places.spec.ts for the browser-level equivalent).
describe("the dead-ladder fix: fitPlacesToUrl().simplified is what the dialog now branches on FIRST", () => {
  /** a 4,000-vertex rectangle ring (four edges, each subdivided into 1,000 collinear points) --
   * `douglasPeucker` collapses collinear runs almost exactly (~0% area change), so it simplifies
   * hard without ever needing the "upload" fallback, giving a deterministic "simplified: true,
   * status: ok/long" case ("a 4,000-vertex ring renders the accept control"). */
  function denseRectanglePlace(name: string): GeomPlace {
    const corners: [number, number][] = [
      [-124, 40],
      [-124, 41],
      [-123, 41],
      [-123, 40],
    ];
    const perEdge = 1000;
    const ring: [number, number][] = [];
    for (let i = 0; i < corners.length; i++) {
      const [x0, y0] = corners[i];
      const [x1, y1] = corners[(i + 1) % corners.length];
      for (let j = 0; j < perEdge; j++) {
        const t = j / perEdge;
        ring.push([x0 + (x1 - x0) * t, y0 + (y1 - y0) * t]);
      }
    }
    expect(ring).toHaveLength(4000);
    return { kind: "geom", name, geometry: { type: "Polygon", coordinates: [closeRing(ring)] } };
  }

  it("a 4,000-vertex ring: fitPlacesToUrl reports simplified: true (the dialog's accept control renders)", async () => {
    const places: Place[] = [denseRectanglePlace("Big")];
    const unsimplified = encodePlaces(places).length;
    expect(unsimplified).toBeGreaterThan(URL_LONG_MAX); // confirms this fixture NEEDS the ladder at all

    const fit = await fitPlacesToUrl(places, { baseLength: 0 });
    expect(fit.simplified).toBe(true);
    expect(fit.status).not.toBe("upload"); // the collinear ring simplifies comfortably within budget
  });

  it("copied.length === fit.length for every status this fixture can reach", async () => {
    const tiny: Place[] = [{ kind: "zone", set: "pa", keys: ["GAA"] }];
    const big: Place[] = [denseRectanglePlace("Big")];

    for (const [label, places, opts] of [
      ["ok, unsimplified", tiny, {}],
      ["ok, simplified (a rung already fit under 2,000)", big, { baseLength: 0 }],
      ["long", big, { baseLength: 0, silentMax: 1 }], // forces past "ok" into "long" territory
      ["upload", big, { baseLength: 0, silentMax: 1, longMax: 1 }], // nothing can fit at all
    ] as const) {
      const fit = await fitPlacesToUrl([...places], opts);
      const href = `https://marinesensitivity.org/atlas/#pl=${encodePlaces(places)}`;
      const copied = shareUrl(href, encodePlaces(places), fit.hash);
      const copiedHashLength = new URL(copied).hash.length - 1 - "pl=".length; // strip "#" and "pl="
      expect(copiedHashLength, label).toBe(fit.hash.length);
      // the dialog's OWN `baseLength: 0` fixtures above make this exact, not merely close:
      expect(fit.length, label).toBe(fit.hash.length);
    }
  });

  it("the numbers shown after accept equal those of the decoded #pl= -- decodePlaces(fit.hash) round-trips to fit.places exactly", async () => {
    // mimic the real app: the `places` ShareDialog receives already came from
    // `placesFromHash(sel.pl)`, so they already carry whatever `decodePlace` always sets (e.g.
    // `precision`) -- round-trip once first so this test's starting point matches that, not a
    // freshly-constructed in-memory object no real caller would ever actually pass in.
    const raw: Place[] = [denseRectanglePlace("Big")];
    const places = decodePlaces(encodePlaces(raw));

    const fit = await fitPlacesToUrl(places, { baseLength: 0 });
    expect(fit.simplified).toBe(true);

    const decoded = decodePlaces(fit.hash);
    expect(decoded).toEqual(fit.places);
    // and re-encoding what was decoded reproduces the SAME hash -- the link and the analysed
    // geometry can never observably disagree once accept() has written `fit.hash` to #pl=.
    expect(encodePlaces(decoded)).toBe(fit.hash);
  });

  it('documents exactly why the old branch order was wrong: `status==="ok"` alone is true for this fixture even though it was simplified', async () => {
    const places: Place[] = [denseRectanglePlace("Big")];
    const fit = await fitPlacesToUrl(places, { baseLength: 0 });
    // the OLD (buggy) condition ShareDialog.svelte gated "Copy link" on:
    const oldCopyLinkShown = fit.status === "ok" && fit.length <= URL_SILENT_MAX;
    expect(oldCopyLinkShown).toBe(true); // -- so the old code showed "Copy link", never the ladder
    expect(fit.simplified).toBe(true); // -- even though #pl= still holds the UNSIMPLIFIED geometry
    // tests/places/invariants.test.ts's "the ladder renders before the plain copy button" source
    // scan is the permanent regression gate for the FIXED branch order this fact demands.
  });
});
