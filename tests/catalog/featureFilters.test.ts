// The overlay feature filters (`atlas:overlay_filters`): the hook's parser (src/lib/catalog/featureFilters.ts),
// what each filter does with the URL's `cff=` and the selected Item (featureFilterState.ts), and the composed
// MapLibre filter of an overlay, evaluated with MapLibre's own expression engine.
import { featureFilter } from "@maplibre/maplibre-gl-style-spec";
import type { FilterSpecification } from "maplibre-gl";
import { describe, expect, it } from "vitest";
import {
  OVERLAY_FILTERS_HOOK,
  parseOverlayFilters,
  type FeatureFilterSpec,
  type RangeFilterSpec,
  type SelectFilterSpec,
} from "../../src/lib/catalog/featureFilters";
import {
  cffWith,
  filterExpression,
  filtersByOverlay,
  resolveFeatureFilters,
} from "../../src/lib/catalog/featureFilterState";
import { hookSpec, hooksOf, unknownHooks } from "../../src/lib/catalog/hooks";
import type { CollectionOverlaySpec } from "../../src/lib/catalog/overlays";
import type { StacCollection } from "../../src/lib/catalog/types";
import {
  collectionOverlayStyle,
  composedFilter,
} from "../../src/lib/map/layers/collectionOverlays";

const SIGHTINGS = ["sightings_vessel", "sightings_aerial"];
const ALL_FOUR = [...SIGHTINGS, "effort_vessel", "effort_aerial"];
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const FILTERS = [
  {
    id: "species",
    title: "Species (sightings)",
    type: "select",
    field: "aphia_id",
    overlays: SIGHTINGS,
    options: [
      {
        value: 1576133,
        label: "Rice's whale (Balaenoptera ricei)",
        count: 23,
        layers: ["rices_whale"],
      },
      {
        value: 137098,
        label: "Sperm whale (Physeter macrocephalus)",
        count: 410,
        layers: ["sperm_whale"],
      },
      { value: "unid_dolphin", label: "Unidentified dolphin" },
    ],
  },
  {
    id: "month",
    title: "Month",
    type: "select",
    field: "month",
    overlays: ALL_FOUR,
    options: MONTHS.map((label, i) => ({
      value: i + 1,
      label,
      dim_value: String(i + 1).padStart(2, "0"),
    })),
    follow_dim: "month",
  },
  {
    id: "year",
    title: "Year",
    type: "range",
    field: "year",
    overlays: ALL_FOUR,
    min: 2003,
    max: 2024,
  },
];

const collection = (filters: unknown) =>
  ({
    type: "Collection",
    id: "c",
    links: [],
    [OVERLAY_FILTERS_HOOK]: filters,
  }) as unknown as StacCollection;
const SPECS = parseOverlayFilters(collection(FILTERS))!;
const species = SPECS[0] as SelectFilterSpec;
const month = SPECS[1] as SelectFilterSpec;
const year = SPECS[2] as RangeFilterSpec;
const view = (cff?: Record<string, string>, dims: Record<string, string> = {}) =>
  resolveFeatureFilters(SPECS, cff, dims);
const keep = (filter: FilterSpecification | null, properties: Record<string, unknown>) =>
  filter === null ||
  featureFilter(filter, "layers[0].filter").filter(
    { zoom: 8 } as never,
    { type: 1, properties } as never,
  );

describe("parseOverlayFilters", () => {
  it("parses selects and a range, in order, keeping value types and the optional fields", () => {
    expect(SPECS.map((s) => [s.id, s.type])).toEqual([
      ["species", "select"],
      ["month", "select"],
      ["year", "range"],
    ]);
    expect(species.options[0]).toEqual({
      value: 1576133,
      label: "Rice's whale (Balaenoptera ricei)",
      count: 23,
      layers: ["rices_whale"],
      dimValue: null,
    });
    expect(species.options[2]).toEqual({
      value: "unid_dolphin",
      label: "Unidentified dolphin",
      count: null,
      layers: [],
      dimValue: null,
    });
    expect(species.followDim).toBeNull();
    expect(month.followDim).toBe("month");
    expect(month.options[6]).toMatchObject({ value: 7, label: "July", dimValue: "07" });
    expect(year).toEqual({
      id: "year",
      title: "Year",
      field: "year",
      overlays: ALL_FOUR,
      type: "range",
      min: 2003,
      max: 2024,
    });
  });
  it("is a registered hook (hookSpec sees it, unknownHooks does not report it)", () => {
    const c = collection(FILTERS);
    expect(hookSpec(c, "atlas:overlay_filters")?.length).toBe(3);
    expect(hooksOf(c)).toContain("atlas:overlay_filters");
    expect(unknownHooks(c)).toEqual([]);
  });
  it("drops an invalid entry: no id, a bad id, no field, no overlays, an unknown type, no usable option, a bad range", () => {
    const ok = FILTERS[2];
    const bad = [
      { ...ok, id: undefined },
      { ...ok, id: "a;b" },
      { ...ok, field: "" },
      { ...ok, overlays: [] },
      { ...ok, type: "checkbox" },
      { ...FILTERS[0], options: [{ label: "no value" }, { value: "a;b" }, { value: "all" }] },
      { ...ok, min: "2003" },
      42,
    ];
    expect(parseOverlayFilters(collection([...bad, ok]))!.map((s) => s.id)).toEqual(["year"]);
  });
  it("one option per value; a duplicate filter id once; unknown keys ignored; a reversed range swapped", () => {
    const specs = parseOverlayFilters(
      collection([
        {
          ...FILTERS[0],
          options: [
            { value: 1, label: "a" },
            { value: "1", label: "dup" },
          ],
          extra: true,
        },
        { ...FILTERS[0], title: "second" },
        { ...FILTERS[2], id: "y2", min: 2024, max: 2003 },
      ]),
    )!;
    expect(specs.map((s) => s.id)).toEqual(["species", "y2"]);
    expect((specs[0] as SelectFilterSpec).options.map((o) => o.label)).toEqual(["a"]);
    expect(specs[1]).toMatchObject({ min: 2003, max: 2024 });
  });
  it("null for a non-array, an empty list or nothing usable", () => {
    expect(parseOverlayFilters(collection({ species: FILTERS[0] }))).toBeNull();
    expect(parseOverlayFilters(collection([]))).toBeNull();
    expect(parseOverlayFilters(collection([{}]))).toBeNull();
    expect(parseOverlayFilters(null)).toBeNull();
  });
});

describe("a select: All, an option, and following the map", () => {
  it("absent: All for a plain select (no filter)", () => {
    const [s] = view();
    expect(s.choice).toEqual({ kind: "all" });
    expect(s.active).toBe(false);
    expect(filterExpression(s)).toBeNull();
  });
  it("an option: ['==', ['get', field], value], with the option's own type", () => {
    const [s] = view({ species: "1576133" });
    expect(filterExpression(s)).toEqual(["==", ["to-number", ["get", "aphia_id"]], 1576133]);
    expect(keep(filterExpression(s), { aphia_id: 1576133 })).toBe(true);
    expect(keep(filterExpression(s), { aphia_id: 137098 })).toBe(false);
    const [str] = view({ species: "unid_dolphin" });
    expect(filterExpression(str)).toEqual([
      "==",
      ["to-string", ["get", "aphia_id"]],
      "unid_dolphin",
    ]);
  });
  it("an unknown value is the default, never an error", () => {
    expect(view({ species: "999" })[0].choice).toEqual({ kind: "all" });
  });
  it("follow_dim: the default follows the Item's month to its option", () => {
    const m = view({}, { month: "07", layer: "rices_whale" })[1];
    expect(m.choice).toEqual({ kind: "follow", option: month.options[6] });
    expect(m.followLabel).toBe("Follow the map (July)");
    expect(filterExpression(m)).toEqual(["==", ["to-number", ["get", "month"]], 7]);
  });
  it("follow_dim: an Item value no option has (annual) filters nothing", () => {
    const m = view({}, { month: "annual" })[1];
    expect(m.choice).toEqual({ kind: "follow", option: null });
    expect(m.followLabel).toBe("Follow the map (all)");
    expect(m.active).toBe(false);
    expect(filterExpression(m)).toBeNull();
  });
  it("follow_dim: All and a specific option override the map", () => {
    expect(view({ month: "all" }, { month: "07" })[1].active).toBe(false);
    const m = view({ month: "3" }, { month: "07" })[1];
    expect(m.choice).toEqual({ kind: "option", option: month.options[2] });
    expect(filterExpression(m)).toEqual(["==", ["to-number", ["get", "month"]], 3]);
  });
});

describe("a range: inclusive, swapped, the whole range is no filter", () => {
  const y = (token?: string) => view(token === undefined ? {} : { year: token })[2];
  it("absent, invalid or the whole range: no filter", () => {
    for (const t of [undefined, "x", "2003", "2003-2024", "1990-2030"]) {
      expect(y(t).active, String(t)).toBe(false);
      expect(filterExpression(y(t))).toBeNull();
    }
  });
  it("both bounds are inclusive", () => {
    const f = filterExpression(y("2017-2018"));
    expect(f).toEqual([
      "all",
      ["has", "year"],
      [">=", ["to-number", ["get", "year"]], 2017],
      ["<=", ["to-number", ["get", "year"]], 2018],
    ]);
    expect(keep(f, { year: 2017 })).toBe(true);
    expect(keep(f, { year: 2018 })).toBe(true);
    expect(keep(f, { year: 2016 })).toBe(false);
    expect(keep(f, { year: 2019 })).toBe(false);
  });
  it("from > to is swapped; a bound outside [min, max] is clamped", () => {
    expect(y("2018-2017").choice).toEqual({ kind: "range", from: 2017, to: 2018 });
    expect(y("1990-2010").choice).toEqual({ kind: "range", from: 2003, to: 2010 });
  });
});

// Regression 0.7.0 (the real SEFSC tiles, 2026-11-13): `month`, `year` and `aphia_id` arrive in the tiles as
// STRINGS ("7", "2018", "1576133") while the filter options give numbers, and MapLibre's `==` never equates
// "7" with 7: every filter kept nothing. The property is compared as the option's type.
describe("regression 0.7.0: a number the tile carries as a string still matches", () => {
  it("a select option, a followed month and a range keep string-typed numbers", () => {
    const [sp, m, y] = view({ species: "1576133", year: "2017-2018" }, { month: "07" });
    expect(keep(filterExpression(sp), { aphia_id: "1576133" })).toBe(true);
    expect(keep(filterExpression(sp), { aphia_id: "137098" })).toBe(false);
    expect(keep(filterExpression(m), { month: "7" })).toBe(true);
    expect(keep(filterExpression(m), { month: "8" })).toBe(false);
    expect(keep(filterExpression(y), { year: "2018" })).toBe(true);
    expect(keep(filterExpression(y), { year: "2019" })).toBe(false);
  });
  it("a string option matches a number the tile carries as a number", () => {
    const specs = parseOverlayFilters(
      collection([{ ...FILTERS[0], options: [{ value: "42", label: "x" }] }]),
    )!;
    const [s] = resolveFeatureFilters(specs, { species: "42" }, {});
    expect(keep(filterExpression(s), { aphia_id: 42 })).toBe(true);
  });
  it("a range never keeps a feature without the property (to-number would read it as 0)", () => {
    const y = parseOverlayFilters(collection([{ ...FILTERS[2], min: -10, max: 10 }]))!;
    const [v] = resolveFeatureFilters(y, { year: "-1-1" }, {});
    expect(keep(filterExpression(v), { year: "0" })).toBe(true);
    expect(keep(filterExpression(v), {})).toBe(false);
  });
});

describe("an overlay's effective filter: every active filter listing it AND the token filter", () => {
  const overlay = (id: string, filterField: string | null = null): CollectionOverlaySpec => ({
    id,
    title: id,
    asset: id,
    url: `https://d.test/${id}.pmtiles`,
    sourceLayer: id,
    geometry: id.startsWith("effort") ? "line" : "point",
    color: "#c51b7d",
    default: true,
    labelField: null,
    fields: null,
    fieldLabels: {},
    filterField,
  });
  const views = view({ species: "1576133", year: "2017-2018" }, { month: "07" });
  const byOverlay = filtersByOverlay(views);

  it("a filter applies only to the overlays it lists", () => {
    expect(byOverlay.get("sightings_vessel")).toHaveLength(3); // species, month (followed), year
    expect(byOverlay.get("effort_vessel")).toHaveLength(2); // month, year: species lists sightings only
    expect(byOverlay.has("hexagons")).toBe(false);
  });
  it("the composed expression keeps exactly the features every part keeps", () => {
    const f = composedFilter(
      overlay("sightings_vessel", "models"),
      { field: "models", token: "rices_whale" },
      byOverlay.get("sightings_vessel"),
    );
    const rice = { aphia_id: 1576133, month: 7, year: 2017, models: "|rices_whale|" };
    expect(keep(f, rice)).toBe(true);
    expect(keep(f, { ...rice, year: 2019 })).toBe(false);
    expect(keep(f, { ...rice, month: 8 })).toBe(false);
    expect(keep(f, { ...rice, aphia_id: 137098 })).toBe(false);
    expect(keep(f, { ...rice, models: "|sperm_whale|" })).toBe(false);
    expect((f as unknown[])[0]).toBe("all");
    expect((f as unknown[]).length).toBe(5);
  });
  it("one part is that part alone; none is no filter", () => {
    const one = filtersByOverlay(view({ year: "2010-2011" }));
    expect(composedFilter(overlay("effort_vessel"), null, one.get("effort_vessel"))).toEqual(
      filterExpression(view({ year: "2010-2011" })[2]),
    );
    expect(composedFilter(overlay("effort_vessel"), null, [])).toBeNull();
  });
  it("reaches the composed style: the layers carry it", () => {
    const specs = [overlay("sightings_vessel"), overlay("effort_vessel"), overlay("hexagons")];
    const parts = collectionOverlayStyle(
      specs,
      ["sightings_vessel", "effort_vessel", "hexagons"],
      null,
      byOverlay,
    )!;
    const filterOf = (id: string) =>
      (parts.layers.find((l) => l.layer.id === id)!.layer as { filter?: unknown }).filter;
    expect(filterOf("cov-sightings_vessel-circle")).toEqual([
      "all",
      ...byOverlay.get("sightings_vessel")!,
    ]);
    expect(filterOf("cov-effort_vessel-line")).toEqual(["all", ...byOverlay.get("effort_vessel")!]);
  });
});

describe("cffWith: the Sel.cff after one change", () => {
  it("sets, replaces, removes; empty is undefined", () => {
    const a = cffWith(undefined, "species", "1576133");
    expect(a).toEqual({ species: "1576133" });
    const b = cffWith(a, "year", "2017-2018");
    expect(b).toEqual({ species: "1576133", year: "2017-2018" });
    expect(cffWith(b, "species", undefined)).toEqual({ year: "2017-2018" });
    expect(cffWith({ month: "all" }, "month", undefined)).toBeUndefined();
    expect(cffWith(undefined, "month", "a;b")).toBeUndefined();
  });
});

// the whole set is typed as FeatureFilterSpec (a compile-time check that both variants are covered)
const _typed: FeatureFilterSpec[] = SPECS;
void _typed;
