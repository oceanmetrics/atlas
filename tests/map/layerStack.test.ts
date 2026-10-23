// R3 layer stack model (round-2 plan §5 U4/§10, `docs/usability.md` §7 R3). Pure logic, no DOM/
// MapLibre — CLAUDE.md "Testing pyramid": one fixture per rule, not one broad end-to-end check.
import { describe, expect, it } from "vitest";
import { BATHYMETRY_DEFAULT_ON } from "../../src/lib/brand/instance";
import { rankForStack } from "../../src/lib/map/style";
import {
  ALL_LAYER_GROUPS,
  applyLayerGroupStyling,
  canMoveLayerStackEntry,
  canMoveLayerStackEntryVisible,
  classifyBasemapLayer,
  DEFAULT_LAYER_STACK,
  defaultLayerStackEntries,
  formatLayerStack,
  isDefaultLayerStack,
  isLayerGroupId,
  LAYER_GROUP_ENABLED,
  LAYER_GROUP_IN_PANEL,
  moveLayerStackEntry,
  moveLayerStackEntryVisible,
  normalizeLayerStack,
  parseLayerStack,
  scaleOpacity,
  type LayerStackEntry,
  type StyleLikeLayer,
} from "../../src/lib/map/layerStack";

// B1 (blocker, Opus 5.5 review): `applyLayerGroupStyling` used to REPLACE a layer's existing
// opacity paint value with the stack's own opacity, instead of scaling it -- painting every zone's
// invisible `fill-opacity: 0` query fill (B3, 0.10.26) visible at any dimmed opacity, collapsing a
// per-cell `["get","opacity"]` selection expression to one flat number, and making the raster
// non-monotonic (0.6 at 100% opacity, but 0.95 at a 95% SLIDER value). One fixture per shape
// `scaleOpacity` must handle, per the review's own enumeration.
describe("scaleOpacity (B1 fix)", () => {
  it("k=1 is a pure no-op — returns the SAME reference, not just an equal value", () => {
    const expr = ["interpolate", ["linear"], ["zoom"], 0, 0.2, 10, 0.8];
    expect(scaleOpacity(undefined, 1)).toBeUndefined();
    expect(scaleOpacity(0.6, 1)).toBe(0.6);
    expect(scaleOpacity(expr, 1)).toBe(expr); // reference-equal
  });

  it("undefined (no existing opacity key) scales to exactly k — MapLibre's own default is 1", () => {
    expect(scaleOpacity(undefined, 0.5)).toBe(0.5);
    expect(scaleOpacity(undefined, 0.25)).toBe(0.25);
  });

  it("a plain number multiplies", () => {
    expect(scaleOpacity(0.6, 0.25)).toBeCloseTo(0.15);
    expect(scaleOpacity(0.9, 0.3)).toBeCloseTo(0.27);
    expect(scaleOpacity(0, 0.5)).toBe(0); // B1's own query-fill regression: 0 x k stays 0
  });

  it("a {stops} legacy style function scales every stop's value, keeping the zoom breakpoints", () => {
    expect(
      scaleOpacity(
        {
          stops: [
            [0, 0.2],
            [10, 1],
          ],
        },
        0.5,
      ),
    ).toEqual({
      stops: [
        [0, 0.1],
        [10, 0.5],
      ],
    });
  });

  it("an interpolate expression scales every OUTPUT, leaving the interpolation/input/stops alone", () => {
    const expr = ["interpolate", ["linear"], ["zoom"], 0, 0.2, 10, 0.8];
    expect(scaleOpacity(expr, 0.5)).toEqual(["interpolate", ["linear"], ["zoom"], 0, 0.1, 10, 0.4]);
  });

  it("a step expression scales every output INCLUDING the base (output0), leaving stops alone", () => {
    const expr = ["step", ["zoom"], 0.2, 5, 0.6, 10, 1];
    expect(scaleOpacity(expr, 0.5)).toEqual(["step", ["zoom"], 0.1, 5, 0.3, 10, 0.5]);
  });

  it('any other expression is wrapped as ["*", existing, k] — MapLibre\'s own runtime multiply', () => {
    expect(scaleOpacity(["get", "opacity"], 0.5)).toEqual(["*", ["get", "opacity"], 0.5]);
    expect(scaleOpacity(["case", ["==", ["get", "x"], 1], 0.8, 0.2], 0.4)).toEqual([
      "*",
      ["case", ["==", ["get", "x"], 1], 0.8, 0.2],
      0.4,
    ]);
  });
});

describe("defaultLayerStackEntries / isDefaultLayerStack", () => {
  it("every group appears exactly once at full opacity, visible but for the Bathymetry row, which follows the instance", () => {
    const entries = defaultLayerStackEntries();
    expect(entries.map((e) => e.id)).toEqual([...DEFAULT_LAYER_STACK]);
    expect(entries.every((e) => e.opacity === 1)).toBe(true);
    expect(entries.filter((e) => e.id !== "basemap-bathymetry").every((e) => e.visible)).toBe(true);
    // oceanmetrics: the GEBCO sea floor on every map (Ben 2026-10-22, instance defaults.bathymetry on)
    expect(entries.find((e) => e.id === "basemap-bathymetry")?.visible).toBe(true);
    expect(BATHYMETRY_DEFAULT_ON).toBe(true);
    expect(
      defaultLayerStackEntries(false, false).find((e) => e.id === "basemap-bathymetry")?.visible,
    ).toBe(false);
    expect(new Set(entries.map((e) => e.id)).size).toBe(ALL_LAYER_GROUPS.length);
  });

  it("the default stack equals ALL_LAYER_GROUPS as a set (no group left out of the draw order)", () => {
    expect(new Set(DEFAULT_LAYER_STACK)).toEqual(new Set(ALL_LAYER_GROUPS));
  });

  it("basemap sub-roles sit contiguously before every data group (today's rendering, unchanged)", () => {
    const order = DEFAULT_LAYER_STACK;
    const lastBasemap = Math.max(
      ...order.map((id, i) => (id.startsWith("basemap-") ? i : -1)).filter((i) => i >= 0),
    );
    const firstData = order.findIndex((id) => id.startsWith("data-"));
    expect(lastBasemap).toBeLessThan(firstData);
  });

  it("isDefaultLayerStack: true for the default, false for any single deviation", () => {
    const def = defaultLayerStackEntries();
    expect(isDefaultLayerStack(def)).toBe(true);
    expect(isDefaultLayerStack(def.map((e, i) => (i === 0 ? { ...e, visible: false } : e)))).toBe(
      false,
    );
    expect(isDefaultLayerStack(def.map((e, i) => (i === 3 ? { ...e, opacity: 0.5 } : e)))).toBe(
      false,
    );
    expect(isDefaultLayerStack([def[1], def[0], ...def.slice(2)])).toBe(false); // reordered
  });
});

// R3 (round-3 plan, W1: "clean up the Layers pane... drop [Roads & buildings, Boundaries, Land &
// water]"): LAYER_GROUP_IN_PANEL only says whether the PANEL lists a row -- it must never shrink
// the model (DEFAULT_LAYER_STACK/ALL_LAYER_GROUPS), the classifier, or the layers= codec, which is
// exactly the property a hidden basemap group's own URL token still needs.
describe("LAYER_GROUP_IN_PANEL (R3: hidden basemap rows stay full model citizens)", () => {
  it("every group has an entry, and the four hidden basemap groups are false", () => {
    for (const id of ALL_LAYER_GROUPS) expect(LAYER_GROUP_IN_PANEL[id]).toBeTypeOf("boolean");
    expect(LAYER_GROUP_IN_PANEL["basemap-land"]).toBe(false);
    expect(LAYER_GROUP_IN_PANEL["basemap-boundaries"]).toBe(false);
    expect(LAYER_GROUP_IN_PANEL["basemap-roads"]).toBe(false);
    // the Bathymetry row was a hidden stub (Opus UI review of main, 2026-09-25) until the GEBCO tiers existed:
    // since 2026-10-23 it is listed and enabled in both instances (on or off by the instance's default)
    expect(LAYER_GROUP_IN_PANEL["basemap-bathymetry"]).toBe(true);
    expect(LAYER_GROUP_ENABLED["basemap-bathymetry"]).toBe(true);
  });

  it("Place labels stays listed (Ben did not name it)", () => {
    expect(LAYER_GROUP_IN_PANEL["basemap-labels"]).toBe(true);
  });

  it("every data group (Selection, Data) stays listed", () => {
    expect(LAYER_GROUP_IN_PANEL["data-raster"]).toBe(true);
    expect(LAYER_GROUP_IN_PANEL["data-places"]).toBe(true);
  });

  it("a hidden group still parses/formats/resets — the panel filter never touches the model", () => {
    const parsed = parseLayerStack("basemap-roads:h,data-raster:o50");
    expect(parsed).not.toBeNull();
    expect(parsed!.map((e) => e.id)).toEqual([...DEFAULT_LAYER_STACK]); // every group present
    const roads = parsed!.find((e) => e.id === "basemap-roads")!;
    expect(roads.visible).toBe(false);
    expect(defaultLayerStackEntries().map((e) => e.id)).toContain("basemap-roads");
  });
});

// m10 (review round 1): `style.ts#composeStyle` takes `layerStack` directly, not only through
// `parseLayerStack`'s own repair of a URL string -- a hand-built, incomplete array used to make
// `orderLayers` throw ("has a role ... which is not in the declared stack order") the moment a
// layer in the missing group's roles was composed.
describe("normalizeLayerStack", () => {
  it("a complete stack passes through UNCHANGED (same array reference)", () => {
    const def = defaultLayerStackEntries();
    expect(normalizeLayerStack(def)).toBe(def);
  });

  it("a stack missing ONE group gets it appended, default visible/opacity, at the END", () => {
    const partial = defaultLayerStackEntries().filter((e) => e.id !== "data-places");
    const out = normalizeLayerStack(partial);
    expect(out.map((e) => e.id)).toEqual([...partial.map((e) => e.id), "data-places"]);
    expect(out.at(-1)).toEqual({ id: "data-places", visible: true, opacity: 1 });
  });

  // review round 2: this used to bare-APPEND every missing group at the array's end regardless of
  // where it belongs -- `basemap-bathymetry` (removed here alongside `data-places`) would have
  // landed AFTER `data-places` at the very end, not right after `basemap-land` where it actually
  // sits in DEFAULT_LAYER_STACK. Fixed via the SAME insert-at-default-position algorithm
  // `parseLayerStack`'s M2 fix uses (`insertMissingAtDefaultPosition`) -- since both removed groups
  // reconstruct exactly where they started, the result here is the full default order verbatim.
  it("a stack missing SEVERAL groups gets each one inserted at its OWN default position, not appended at the end", () => {
    const partial = defaultLayerStackEntries().filter(
      (e) => e.id !== "data-places" && e.id !== "basemap-bathymetry",
    );
    const out = normalizeLayerStack(partial);
    expect(out.map((e) => e.id)).toEqual([...DEFAULT_LAYER_STACK]);
    // a group put back takes its own default visibility (the instance's for the Bathymetry row), never "visible"
    expect(out.find((e) => e.id === "basemap-bathymetry")).toEqual({
      id: "basemap-bathymetry",
      visible: true,
      opacity: 1,
    });
  });

  // a case the "several groups" test above cannot distinguish from a coincidence (removing
  // bathymetry + places happens to reconstruct the full default order either way): remove a group
  // whose default position is NOT at the end, and confirm it lands in the MIDDLE, not appended
  // after data-places (which STAYS present here -- a buggy bare-append would put basemap-roads
  // AFTER it, at the very top of the map).
  it("a single interior group missing lands in the MIDDLE at its default position, never after data-places", () => {
    const partial = defaultLayerStackEntries().filter((e) => e.id !== "basemap-roads");
    const out = normalizeLayerStack(partial);
    expect(out.map((e) => e.id)).toEqual([...DEFAULT_LAYER_STACK]);
    expect(out.at(-1)?.id).toBe("data-places"); // NOT basemap-roads
  });

  it("an empty stack normalises to exactly the default stack", () => {
    expect(normalizeLayerStack([])).toEqual(defaultLayerStackEntries());
  });

  it("a REORDERED-among-BASEMAP-groups but complete stack is left alone (normalising is about missing groups and DATA order, not basemap order)", () => {
    const def = defaultLayerStackEntries();
    const reordered = [def[1], def[0], ...def.slice(2)]; // swaps two basemap groups only
    expect(normalizeLayerStack(reordered)).toBe(reordered);
  });

  // review round 2 (re-check of M7): the OTHER finding -- a hand-built `layerStack` (or a
  // `layers=` URL, via `parseLayerStack` below) that names every group but violates
  // `data-raster < data-zones < data-places` used to sail through unenforced; `composeStyle`
  // would then rank `data-places` BELOW the raster, painting Selection under everything else.
  it("a complete stack with data-places NOT last is repaired -- moved to the very end", () => {
    const def = defaultLayerStackEntries();
    const violating = [def[7], ...def.slice(0, 7)]; // data-places moved to the FRONT
    const out = normalizeLayerStack(violating);
    expect(out.map((e) => e.id)).toEqual([...DEFAULT_LAYER_STACK]);
  });
});

describe("isLayerGroupId", () => {
  it("accepts every real group and rejects garbage", () => {
    for (const id of ALL_LAYER_GROUPS) expect(isLayerGroupId(id)).toBe(true);
    expect(isLayerGroupId("basemap-seafloor-mystery")).toBe(false);
    expect(isLayerGroupId("")).toBe(false);
  });
});

describe("classifyBasemapLayer", () => {
  // a representative sample of CARTO basemap-styles' well-known layer ids (the openmaptiles
  // schema every CARTO GL style — dark-matter and positron alike — is built from), one per bucket,
  // covering the property under test: EVERY layer classifies into exactly one group, never throws,
  // never falls through unassigned.
  const CASES: Array<[{ id: string; type: string }, ReturnType<typeof classifyBasemapLayer>]> = [
    [{ id: "background", type: "background" }, "basemap-land"],
    [{ id: "water", type: "fill" }, "basemap-land"],
    [{ id: "waterway", type: "line" }, "basemap-land"],
    [{ id: "landuse", type: "fill" }, "basemap-land"],
    [{ id: "landcover", type: "fill" }, "basemap-land"],
    [{ id: "park", type: "fill" }, "basemap-land"],
    [{ id: "boundary_country_outline", type: "line" }, "basemap-boundaries"],
    [{ id: "boundary_state", type: "line" }, "basemap-boundaries"],
    [{ id: "boundary_county", type: "line" }, "basemap-boundaries"],
    [{ id: "road_major", type: "line" }, "basemap-roads"],
    [{ id: "road_minor", type: "line" }, "basemap-roads"],
    [{ id: "bridge_major", type: "line" }, "basemap-roads"],
    [{ id: "tunnel_minor", type: "line" }, "basemap-roads"],
    [{ id: "building", type: "fill" }, "basemap-roads"],
    [{ id: "railway", type: "line" }, "basemap-roads"],
    [{ id: "aeroway_line", type: "line" }, "basemap-roads"],
    [{ id: "place_label", type: "symbol" }, "basemap-labels"],
    [{ id: "water_label", type: "symbol" }, "basemap-labels"],
    [{ id: "road_major_label", type: "symbol" }, "basemap-labels"], // symbol wins over the "road" keyword
    [{ id: "poi_label", type: "symbol" }, "basemap-labels"],
    [{ id: "housenum_label", type: "symbol" }, "basemap-labels"],
    [{ id: "hillshade", type: "fill" }, "basemap-bathymetry"],
    [{ id: "contour", type: "line" }, "basemap-bathymetry"],
    [{ id: "some-future-layer-nobody-has-seen-yet", type: "fill" }, "basemap-land"], // unknown -> land
  ];

  it.each(CASES)("%o -> %s", (layer, expected) => {
    expect(classifyBasemapLayer(layer)).toBe(expected);
  });

  it("is TOTAL — never throws, for any id/type pair", () => {
    expect(() => classifyBasemapLayer({ id: "", type: "" })).not.toThrow();
    expect(() => classifyBasemapLayer({ id: "🤷", type: "circle" })).not.toThrow();
  });
});

describe("applyLayerGroupStyling", () => {
  // a bare `{ type }` literal infers a TYPE with no `layout`/`paint` KEY at all, so a later
  // `.layout`/`.paint` read on the (generic, type-preserving) return value would not type-check —
  // this factory just gives every fixture the full `StyleLikeLayer` shape up front.
  const layer = (type: string, extra: Partial<StyleLikeLayer> = {}): StyleLikeLayer => ({
    type,
    ...extra,
  });

  it("opacity 1, visible true: no-op (never touches paint/layout — a CARTO zoom expression survives)", () => {
    const l = layer("fill", { paint: { "fill-color": ["interpolate", ["linear"], ["zoom"]] } });
    const out = applyLayerGroupStyling(l, { visible: true, opacity: 1 });
    expect(out).toEqual(l);
    expect(out.paint).toBe(l.paint); // reference-equal: untouched
  });

  it("visible: false sets layout.visibility=none regardless of type", () => {
    for (const type of ["fill", "line", "symbol", "raster", "background", "circle"]) {
      const out = applyLayerGroupStyling(layer(type), { visible: true, opacity: 1 });
      expect(out.layout).toBeUndefined();
      const hidden = applyLayerGroupStyling(layer(type), { visible: false, opacity: 1 });
      expect(hidden.layout).toEqual({ visibility: "none" });
    }
  });

  it("opacity override sets the right paint key per type", () => {
    expect(applyLayerGroupStyling(layer("raster"), { visible: true, opacity: 0.5 }).paint).toEqual({
      "raster-opacity": 0.5,
    });
    expect(applyLayerGroupStyling(layer("fill"), { visible: true, opacity: 0.5 }).paint).toEqual({
      "fill-opacity": 0.5,
    });
    expect(applyLayerGroupStyling(layer("line"), { visible: true, opacity: 0.25 }).paint).toEqual({
      "line-opacity": 0.25,
    });
    expect(
      applyLayerGroupStyling(layer("background"), { visible: true, opacity: 0.9 }).paint,
    ).toEqual({ "background-opacity": 0.9 });
    expect(applyLayerGroupStyling(layer("circle"), { visible: true, opacity: 0.4 }).paint).toEqual({
      "circle-opacity": 0.4,
    });
    // symbol: BOTH icon and text opacity are set (a label-only or icon-only layer just ignores
    // whichever key it doesn't use — costs nothing, see the module's own header).
    expect(applyLayerGroupStyling(layer("symbol"), { visible: true, opacity: 0.6 }).paint).toEqual({
      "icon-opacity": 0.6,
      "text-opacity": 0.6,
    });
  });

  // B1 fix (Opus 5.5 review): the group opacity SCALES the layer's own existing opacity key, it
  // never REPLACES it — 0.9 (existing) x 0.3 (stack) = 0.27, never the bare 0.3 the old (replacing)
  // behaviour produced. `fill-color` (a non-opacity key) survives untouched either way.
  it("existing paint keys survive an opacity override, and the opacity key is SCALED, not replaced (0.9 x 0.3 = 0.27)", () => {
    const out = applyLayerGroupStyling(
      layer("fill", { paint: { "fill-color": "#112233", "fill-opacity": 0.9 } }),
      { visible: true, opacity: 0.3 },
    );
    expect(out.paint).toEqual({ "fill-color": "#112233", "fill-opacity": 0.27 });
  });

  it("hidden AND dimmed: both applied together", () => {
    const out = applyLayerGroupStyling(layer("line"), { visible: false, opacity: 0.2 });
    expect(out.layout).toEqual({ visibility: "none" });
    expect(out.paint).toEqual({ "line-opacity": 0.2 });
  });

  it("a type this table does not name is left untouched by opacity, never throws", () => {
    expect(() =>
      applyLayerGroupStyling(layer("heatmap"), { visible: true, opacity: 0.5 }),
    ).not.toThrow();
    expect(
      applyLayerGroupStyling(layer("heatmap"), { visible: true, opacity: 0.5 }).paint,
    ).toBeUndefined();
  });

  it("is pure: never mutates the input layer", () => {
    const l = layer("fill", { paint: { "fill-opacity": 1 } });
    const frozen = JSON.parse(JSON.stringify(l));
    applyLayerGroupStyling(l, { visible: false, opacity: 0.3 });
    expect(l).toEqual(frozen);
  });
});

describe("parseLayerStack / formatLayerStack (layers= round trip)", () => {
  it("null/empty -> null (the default stack)", () => {
    expect(parseLayerStack(null)).toBeNull();
    expect(parseLayerStack("")).toBeNull();
    expect(parseLayerStack("   ")).toBeNull();
  });

  it("formatLayerStack omits the key for null/undefined/the exact default", () => {
    expect(formatLayerStack(null)).toBeNull();
    expect(formatLayerStack(undefined)).toBeNull();
    expect(formatLayerStack(defaultLayerStackEntries())).toBeNull();
  });

  it("a hidden group round-trips", () => {
    const entries = defaultLayerStackEntries().map((e) =>
      e.id === "basemap-labels" ? { ...e, visible: false } : e,
    );
    const token = formatLayerStack(entries);
    expect(token).toContain("basemap-labels:h");
    expect(parseLayerStack(token)).toEqual(entries);
  });

  it("an opacity round-trips at 2-digit percent precision", () => {
    const entries = defaultLayerStackEntries().map((e) =>
      e.id === "data-raster" ? { ...e, opacity: 0.6 } : e,
    );
    const token = formatLayerStack(entries);
    expect(token).toContain("data-raster:o60");
    expect(parseLayerStack(token)).toEqual(entries);
  });

  it("hidden AND dimmed on the same group writes both flags, order-stable", () => {
    const entries = defaultLayerStackEntries().map((e) =>
      e.id === "basemap-roads" ? { ...e, visible: false, opacity: 0.4 } : e,
    );
    const token = formatLayerStack(entries)!;
    expect(token).toContain("basemap-roads:h:o40");
    expect(parseLayerStack(token)).toEqual(entries);
  });

  it("a reordered stack round-trips (order is draw order, bottom to top)", () => {
    const entries = moveLayerStackEntry(defaultLayerStackEntries(), 4, 5); // basemap-labels above data-raster
    expect(entries.map((e) => e.id)).toEqual([
      "basemap-land",
      "basemap-bathymetry",
      "basemap-boundaries",
      "basemap-roads",
      "data-raster",
      "basemap-labels",
      "data-overlays",
      "data-places",
    ]);
    const token = formatLayerStack(entries)!;
    expect(parseLayerStack(token)).toEqual(entries);
  });

  it("an unknown group id in the token is dropped, never thrown", () => {
    expect(() => parseLayerStack("bogus-group,data-raster:o50")).not.toThrow();
    const parsed = parseLayerStack("bogus-group,data-raster:o50")!;
    expect(parsed.find((e) => (e.id as string) === "bogus-group")).toBeUndefined();
    expect(parsed.find((e) => e.id === "data-raster")?.opacity).toBe(0.5);
  });

  // M2 fix (Opus 5.5 review): a partial token used to bury its own named group at the very BOTTOM
  // of the stack (array index 0), with every OTHER group appended ABOVE it -- so naming only
  // `data-raster` put it UNDER every basemap group, including the opaque land fill, making the
  // raster invisible. The fix inserts each missing id right after its own nearest earlier DEFAULT
  // predecessor, so a partial token reconstructs the FULL default order around the one entry it
  // customizes -- `data-raster` keeps its OWN default position (after all five basemap groups),
  // not the front of the array.
  it("a KNOWN group missing from the token is inserted at its OWN default relative position, not appended at the array's end", () => {
    const parsed = parseLayerStack("data-raster:o50")!;
    expect(parsed.map((e) => e.id)).toEqual(DEFAULT_LAYER_STACK);
    expect(parsed.find((e) => e.id === "data-raster")).toEqual({
      id: "data-raster",
      visible: true,
      opacity: 0.5,
    });
  });

  it("a partial token naming a LATE group still reconstructs every earlier default id in order", () => {
    // only "data-places" is named -- every basemap group AND data-raster must land
    // BEFORE it, in their own default order, not all piled after it.
    const parsed = parseLayerStack("data-places:h")!;
    expect(parsed.map((e) => e.id)).toEqual(DEFAULT_LAYER_STACK);
    expect(parsed.find((e) => e.id === "data-places")?.visible).toBe(false);
  });

  it("two non-adjacent named groups: the ones between them still land in default order", () => {
    // basemap-land and basemap-roads named, in DEFAULT order already -- everything else (bathymetry,
    // boundaries, labels, data-raster, data-places) must reconstruct around them correctly.
    const parsed = parseLayerStack("basemap-land:o80,basemap-roads:h")!;
    expect(parsed.map((e) => e.id)).toEqual(DEFAULT_LAYER_STACK);
    expect(parsed.find((e) => e.id === "basemap-land")?.opacity).toBe(0.8);
    expect(parsed.find((e) => e.id === "basemap-roads")?.visible).toBe(false);
  });

  // review round 2 (re-check of M7): the live bug the re-check found -- a crafted URL naming the
  // three data groups in a REVERSED, order-violating sequence used to be accepted verbatim by
  // parseLayerStack (it only ever repaired MISSING ids, never checked the ones actually present),
  // so composeStyle would rank data-places BELOW the raster: Selection painted under the score
  // raster, and only "Reset layers" (which discards the whole token) repaired it.
  it("a crafted URL naming data-places, data-raster (reversed) is repaired to the correct data order", () => {
    // this token names only the 2 data groups (reversed); the other 5 (basemap) are MISSING and
    // get inserted at their own default positions too (M2) -- repairing BOTH defects at once lands
    // on exactly DEFAULT_LAYER_STACK, which parseLayerStack's own contract reports as `null` ("no
    // deviation from default"), not a returned array that happens to equal it token-for-token.
    expect(parseLayerStack("data-places,data-raster")).toBeNull();
    // proved directly, bypassing the null-collapse, by keeping one real deviation (an explicit
    // opacity) so the repaired result is NOT the bare default and its order is inspectable.
    const parsed = parseLayerStack("data-places,data-raster:o50")!;
    expect(parsed.map((e) => e.id)).toEqual(DEFAULT_LAYER_STACK);
    expect(parsed.find((e) => e.id === "data-raster")?.opacity).toBe(0.5);
  });

  it("a garbage opacity flag is ignored (falls back to 1), never thrown", () => {
    const parsed = parseLayerStack("data-raster:o150,basemap-land:oxx")!;
    expect(parsed.find((e) => e.id === "data-raster")?.opacity).toBe(1);
    expect(parsed.find((e) => e.id === "basemap-land")?.opacity).toBe(1);
  });

  it("a duplicated id in the token keeps only the first occurrence", () => {
    const parsed = parseLayerStack("data-raster:h,data-raster:o50")!;
    expect(parsed.filter((e) => e.id === "data-raster")).toHaveLength(1);
    expect(parsed.find((e) => e.id === "data-raster")).toEqual({
      id: "data-raster",
      visible: false,
      opacity: 1,
    });
  });

  it("a token that parses to exactly the default (e.g. every flag redundant) formats back to null", () => {
    expect(parseLayerStack("basemap-land,basemap-bathymetry,basemap-boundaries")).toBeNull();
  });

  it("the Bathymetry row off is a deviation (oceanmetrics draws it by default): written as :h, read back hidden", () => {
    const off = defaultLayerStackEntries().map((e) =>
      e.id === "basemap-bathymetry" ? { ...e, visible: false } : e,
    );
    const token = formatLayerStack(off);
    expect(token).toContain("basemap-bathymetry:h");
    expect(parseLayerStack(token!)?.find((e) => e.id === "basemap-bathymetry")?.visible).toBe(
      false,
    );
  });
});

describe("moveLayerStackEntry", () => {
  const ids = (e: readonly LayerStackEntry[]) => e.map((x) => x.id);

  it("moves one (non-data-places) entry, leaving the rest in relative order", () => {
    const entries = defaultLayerStackEntries();
    const moved = moveLayerStackEntry(entries, 0, 4); // basemap-land above basemap-labels
    expect(ids(moved)).toEqual([
      "basemap-bathymetry",
      "basemap-boundaries",
      "basemap-roads",
      "basemap-labels",
      "basemap-land",
      "data-raster",
      "data-overlays",
      "data-places",
    ]);
  });

  it("clamps an out-of-range destination instead of throwing", () => {
    const entries = defaultLayerStackEntries();
    expect(() => moveLayerStackEntry(entries, 0, 999)).not.toThrow();
    expect(() => moveLayerStackEntry(entries, 0, -50)).not.toThrow();
    expect(ids(moveLayerStackEntry(entries, 0, -50))[0]).toBe("basemap-land");
  });

  it("an out-of-range `from` returns a copy, unchanged", () => {
    const entries = defaultLayerStackEntries();
    expect(moveLayerStackEntry(entries, 99, 0)).toEqual(entries);
  });

  // --- M7 fix (Opus 5.5 review): data-places pinned ----

  it("data-places can never be moved — any attempt to move IT returns entries unchanged", () => {
    const entries = defaultLayerStackEntries();
    const placesIdx = entries.findIndex((e) => e.id === "data-places");
    expect(moveLayerStackEntry(entries, placesIdx, 0)).toEqual(entries);
    expect(moveLayerStackEntry(entries, placesIdx, 3)).toEqual(entries);
  });

  it("nothing else can move TO OR PAST data-places' own position — it stays topmost", () => {
    const entries = defaultLayerStackEntries();
    // try to move basemap-land (index 0) all the way to the top (past data-places) --
    // clamped to just BELOW data-places, never past it.
    const moved = moveLayerStackEntry(entries, 0, 999);
    expect(ids(moved)[ids(moved).length - 1]).toBe("data-places");
    expect(ids(moved)[ids(moved).length - 2]).toBe("basemap-land");
  });

  it("basemap groups can still move freely relative to data-raster (only data-places is pinned)", () => {
    const entries = defaultLayerStackEntries();
    // basemap-labels (index 4) above data-raster (index 5) -- Ben's own example move, still legal.
    const moved = moveLayerStackEntry(entries, 4, 5);
    expect(ids(moved)).toEqual([
      "basemap-land",
      "basemap-bathymetry",
      "basemap-boundaries",
      "basemap-roads",
      "data-raster",
      "basemap-labels",
      "data-overlays",
      "data-places",
    ]);
  });
});

// review round 2 (re-check of M7): the PANEL never disabled a rejected move -- the ▲/▼ buttons
// only ever checked the array BOUNDARY (arrIndex 0 / length-1), blind to the pin/fixed-order rules
// above, so e.g. Selection's own DOWN button (never at the boundary -- it sits at the TOP) stayed
// enabled and firing it announced a phantom "moved to position N" for a move that changed nothing.
// `LayersPanel.svelte` now disables a button exactly when this returns false, instead of
// re-deriving the boundary check itself.
describe("canMoveLayerStackEntry", () => {
  it("a genuine move (still within bounds, no constraint violated) returns true", () => {
    const entries = defaultLayerStackEntries();
    expect(canMoveLayerStackEntry(entries, 0, 4)).toBe(true); // basemap-land up past labels
  });

  it("data-places' own move (either direction) always returns false -- it is pinned", () => {
    const entries = defaultLayerStackEntries();
    const placesIdx = entries.findIndex((e) => e.id === "data-places");
    expect(canMoveLayerStackEntry(entries, placesIdx, placesIdx - 1)).toBe(false); // "down"
    expect(canMoveLayerStackEntry(entries, placesIdx, placesIdx + 1)).toBe(false); // "up" (n/a, still false)
  });

  it("the entry directly below data-places cannot move any further up -- clamps to a no-op at the boundary", () => {
    const entries = defaultLayerStackEntries();
    const overlaysIdx = entries.findIndex((e) => e.id === "data-overlays"); // directly below data-places
    const placesIdx = entries.findIndex((e) => e.id === "data-places");
    expect(canMoveLayerStackEntry(entries, overlaysIdx, placesIdx)).toBe(false);
  });

  it("moving to the SAME position (from === to, after clamping) returns false", () => {
    const entries = defaultLayerStackEntries();
    expect(canMoveLayerStackEntry(entries, 2, 2)).toBe(false);
  });
});

// fix round (Opus 5.5 eyes-on review of main, D2): "Place labels ↓" swapped with the HIDDEN
// basemap-roads row -- the panel's own visible order never changed, yet the button stayed
// enabled (`canMoveLayerStackEntry` is blind to visibility, only the underlying array's own
// boundary/pin rules). `moveLayerStackEntryVisible`/`canMoveLayerStackEntryVisible` are the fix:
// hop over any number of hidden entries to reach the nearest VISIBLE neighbour, and disable the
// button outright when there is none in that direction.
describe("moveLayerStackEntryVisible / canMoveLayerStackEntryVisible (D2 fix)", () => {
  it("regression: basemap-labels (Place labels) 'down' skips the hidden rows and swaps with its listed neighbour, Bathymetry (listed since 2026-10-23)", () => {
    const entries = defaultLayerStackEntries();
    const next = moveLayerStackEntryVisible(
      entries,
      "basemap-labels",
      "down",
      LAYER_GROUP_IN_PANEL,
    );
    // never a swap with the hidden Boundaries or Roads rows: labels land right under Bathymetry
    expect(next.map((e) => e.id).slice(0, 5)).toEqual([
      "basemap-land",
      "basemap-labels",
      "basemap-bathymetry",
      "basemap-boundaries",
      "basemap-roads",
    ]);
    expect(
      canMoveLayerStackEntryVisible(entries, "basemap-labels", "down", LAYER_GROUP_IN_PANEL),
    ).toBe(true);
    // two basemap rows side by side share one rank (M1): the move changes no pixel; Bathymetry moves only past a data row
    expect(rankForStack(next.map((e) => e.id)).get("basemap-labels")).toBe(
      rankForStack(next.map((e) => e.id)).get("basemap-bathymetry"),
    );
  });

  it("basemap-labels (Place labels) 'up' swaps with its real visible neighbour, data-raster (Data)", () => {
    const entries = defaultLayerStackEntries();
    const next = moveLayerStackEntryVisible(entries, "basemap-labels", "up", LAYER_GROUP_IN_PANEL);
    const labelsIdx = next.findIndex((e) => e.id === "basemap-labels");
    const rasterIdx = next.findIndex((e) => e.id === "data-raster");
    expect(labelsIdx).toBeGreaterThan(rasterIdx); // labels now draws ABOVE the raster
    expect(
      canMoveLayerStackEntryVisible(entries, "basemap-labels", "up", LAYER_GROUP_IN_PANEL),
    ).toBe(true);
  });

  it("hops over MULTIPLE hidden entries at once, leaving them in their own relative order", () => {
    // a synthetic in-panel map: only basemap-land and basemap-roads are visible basemap rows
    // (bathymetry/boundaries hidden between them) -- proves the hop is not hard-coded to "exactly
    // one hidden row," the real shape between Place labels and the three dropped basemap rows.
    const inPanel = {
      ...LAYER_GROUP_IN_PANEL,
      "basemap-land": true,
      "basemap-bathymetry": false,
      "basemap-boundaries": false,
      "basemap-roads": true,
    };
    const entries = defaultLayerStackEntries(); // land, bathymetry, boundaries, roads, labels, raster, places
    const next = moveLayerStackEntryVisible(entries, "basemap-roads", "down", inPanel);
    const ids = next.map((e) => e.id);
    // roads hopped down past both hidden rows to sit directly below land (its nearest VISIBLE
    // neighbour); bathymetry/boundaries kept their own relative order, just shifted up one.
    expect(ids.indexOf("basemap-roads")).toBeLessThan(ids.indexOf("basemap-land"));
    expect(ids.indexOf("basemap-bathymetry")).toBeLessThan(ids.indexOf("basemap-boundaries"));
    expect(canMoveLayerStackEntryVisible(entries, "basemap-roads", "down", inPanel)).toBe(true);
  });

  it("the pin rule still applies through the hop -- Place layers cannot move up past the pinned Selection", () => {
    const entries = defaultLayerStackEntries();
    // up: its only visible neighbour above is data-places, which is pinned (never a valid target).
    expect(
      canMoveLayerStackEntryVisible(entries, "data-overlays", "up", LAYER_GROUP_IN_PANEL),
    ).toBe(false);
    // Data CAN move up past Place layers (the overlays then draw under the data)
    expect(canMoveLayerStackEntryVisible(entries, "data-raster", "up", LAYER_GROUP_IN_PANEL)).toBe(
      true,
    );
  });

  it("an id not present in entries is a no-op, never throws", () => {
    const entries = defaultLayerStackEntries().filter((e) => e.id !== "basemap-roads");
    expect(() =>
      moveLayerStackEntryVisible(entries, "basemap-roads", "up", LAYER_GROUP_IN_PANEL),
    ).not.toThrow();
    expect(
      moveLayerStackEntryVisible(entries, "basemap-roads", "up", LAYER_GROUP_IN_PANEL),
    ).toEqual(entries);
    expect(
      canMoveLayerStackEntryVisible(entries, "basemap-roads", "up", LAYER_GROUP_IN_PANEL),
    ).toBe(false);
  });
});
