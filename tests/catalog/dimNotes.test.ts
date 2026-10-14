// WP14 item 6: why a selector value is unavailable, which taxa a selector lists, and the notice after a
// selector change moved the taxon (the nc cube: 82 species, 11 in both regions).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  dimsOf,
  itemDims,
  selectDim,
  selectorOptions,
  switchedNotice,
  unavailableNote,
  viewOf,
} from "../../src/lib/catalog/dims";
import {
  manifestCube,
  manifestItems,
  parseManifest,
  type MstManifest,
} from "../../src/lib/catalog/mst/manifest";
import type { StacCollection, StacItem } from "../../src/lib/catalog/types";

// a small cube: region x species x season x variable; Murre is Pacific-only, Tern Atlantic-only, Loon both;
// ci90 exists for the Atlantic only
const cube = {
  region: { type: "other", title: "Region", values: ["atlantic", "pacific"] },
  species: {
    type: "other",
    title: "Species or group",
    "atlas:taxon_dim": true,
    values: ["LOON", "MURR", "TERN"],
    "atlas:labels": { LOON: "Common Loon", MURR: "Common Murre", TERN: "Arctic Tern" },
  },
  season: { type: "other", title: "Season", values: ["summer", "winter"] },
  variable: { type: "other", title: "Variable", values: ["n", "ci90"] },
};
const collection = {
  type: "Collection",
  id: "nc",
  links: [],
  "cube:dimensions": cube,
} as unknown as StacCollection;
const mk = (region: string, species: string, season: string, variable: string) =>
  ({
    type: "Feature",
    id: [region, species, season, variable].join("."),
    properties: { "atlas:dims": { region, species, season, variable } },
    assets: {},
    links: [],
  }) as unknown as StacItem;
const items: StacItem[] = [
  ...["summer", "winter"].flatMap((s) => [
    mk("atlantic", "LOON", s, "n"),
    mk("atlantic", "TERN", s, "n"),
    mk("pacific", "LOON", s, "n"),
    mk("pacific", "MURR", s, "n"),
  ]),
  mk("atlantic", "LOON", "summer", "ci90"),
  mk("atlantic", "TERN", "summer", "ci90"),
];
const dims = dimsOf(collection, items);
const region = dims.find((d) => d.key === "region")!;
const species = dims.find((d) => d.key === "species")!;
const variable = dims.find((d) => d.key === "variable")!;
const season = dims.find((d) => d.key === "season")!;
const pacificMurre = { region: "pacific", species: "MURR", season: "summer", variable: "n" };

describe("the taxon dimension is marked by the cube", () => {
  it("dimsOf carries `atlas:taxon_dim` as `taxon`", () => {
    expect(species.taxon).toBe(true);
    expect(region.taxon).toBeUndefined();
  });
  it("the nc manifest marks its `taxon_dim` (species)", () => {
    const parsed = parseManifest(
      JSON.parse(readFileSync(new URL("../../public/mst/nc_models.json", import.meta.url), "utf8")),
    ) as MstManifest;
    const c = manifestCube(parsed);
    expect(c.species["atlas:taxon_dim"]).toBe(true);
    expect(c.region["atlas:taxon_dim"]).toBeUndefined();
    expect(manifestItems(parsed).length).toBeGreaterThan(0);
  });
});

describe("unavailableNote: what blocks the value", () => {
  const note = (dim: typeof region, value: string, selected = pacificMurre) =>
    unavailableNote({ dim, value, dims, items, selected });
  it("a taxon-like sibling blocks: '(no <species> model)'", () => {
    expect(note(region, "atlantic")).toBe("(no Common Murre model)");
  });
  it("another sibling blocks: '(not with the current <dimension>)'", () => {
    // ci90 exists for the Atlantic only; the Pacific region (not the species, not the season) is the blocker
    expect(note(variable, "ci90", { ...pacificMurre, species: "LOON" })).toBe(
      "(not with the current region)",
    );
  });
  it("several siblings together: '(not with the current selection)'", () => {
    // Atlantic ci90 has no winter item and no Murre: no single selection is to blame
    expect(
      note(region, "atlantic", {
        region: "pacific",
        species: "MURR",
        season: "winter",
        variable: "ci90",
      }),
    ).toBe("(not with the current selection)");
  });
  it("an available value, and the current one, have no note", () => {
    expect(note(region, "pacific")).toBe("");
    expect(note(species, "LOON")).toBe("");
  });
  it("the old wording is gone", () => {
    const labels = selectorOptions({ dim: region, dims, items, selected: pacificMurre }).options;
    expect(labels.map((o) => o.label)).toEqual(["Atlantic (no Common Murre model)", "Pacific"]);
    expect(labels.some((o) => o.label.includes("not available here"))).toBe(false);
  });
});

describe("selectorOptions: a taxon-like selector lists what exists for the current selection", () => {
  it("filters to the region (and the season / variable that narrow it), reports what it hides", () => {
    const f = selectorOptions({ dim: species, dims, items, selected: pacificMurre });
    expect(f.options.map((o) => o.value)).toEqual(["LOON", "MURR"]);
    expect(f.hidden).toBe(1);
    const ci = selectorOptions({
      dim: species,
      dims,
      items,
      selected: { region: "atlantic", species: "LOON", season: "summer", variable: "ci90" },
    });
    expect(ci.options.map((o) => o.value)).toEqual(["LOON", "TERN"]);
  });
  it("'show all' lists every taxon, the unavailable ones with their reason", () => {
    const all = selectorOptions({
      dim: species,
      dims,
      items,
      selected: pacificMurre,
      showAll: true,
    });
    expect(all.hidden).toBe(0);
    expect(all.options.map((o) => o.label)).toEqual([
      "Common Loon",
      "Common Murre",
      "Arctic Tern (not with the current region)",
    ]);
  });
  it("the other selectors always list every value", () => {
    expect(
      selectorOptions({ dim: season, dims, items, selected: pacificMurre }).options,
    ).toHaveLength(2);
    expect(selectorOptions({ dim: variable, dims, items, selected: pacificMurre }).hidden).toBe(0);
  });
  it("the current taxon is always listed", () => {
    const f = selectorOptions({
      dim: species,
      dims,
      items,
      selected: { ...pacificMurre, species: "TERN" },
    });
    expect(f.options.map((o) => o.value)).toContain("TERN");
  });
});

describe("picking a region where the species has no model", () => {
  it("snaps the species to the first available one, keeping the season and variable", () => {
    const next = selectDim(items, pacificMurre, "region", "atlantic")!;
    expect(itemDims(next)).toEqual({
      region: "atlantic",
      species: "LOON",
      season: "summer",
      variable: "n",
    });
    const winter = selectDim(items, { ...pacificMurre, season: "winter" }, "region", "atlantic")!;
    expect(itemDims(winter).season).toBe("winter");
  });
  it("snaps the others too when they do not exist there (ci90 has no Pacific item)", () => {
    const next = selectDim(
      items,
      { region: "atlantic", species: "TERN", season: "summer", variable: "ci90" },
      "region",
      "pacific",
    )!;
    expect(itemDims(next).region).toBe("pacific");
    expect(itemDims(next).variable).toBe("n");
  });
  it("is announced: 'Switched to <species>: <old species> has no Atlantic model.'", () => {
    const next = selectDim(items, pacificMurre, "region", "atlantic")!;
    expect(
      switchedNotice({ dims, before: pacificMurre, after: itemDims(next), changed: "region" }),
    ).toBe("Switched to Common Loon: Common Murre has no Atlantic model.");
  });
  it("no notice when the species stays, when the species itself was changed, or with no taxon dimension", () => {
    const loon = { ...pacificMurre, species: "LOON" };
    expect(
      switchedNotice({
        dims,
        before: loon,
        after: { ...loon, region: "atlantic" },
        changed: "region",
      }),
    ).toBeNull();
    expect(
      switchedNotice({
        dims,
        before: pacificMurre,
        after: { ...pacificMurre, species: "LOON" },
        changed: "species",
      }),
    ).toBeNull();
    const plain = dims.filter((d) => !d.taxon);
    expect(
      switchedNotice({
        dims: plain,
        before: pacificMurre,
        after: { ...pacificMurre, species: "LOON" },
        changed: "region",
      }),
    ).toBeNull();
  });
});

describe("the real nc cube", () => {
  const parsed = parseManifest(
    JSON.parse(readFileSync(new URL("../../public/mst/nc_models.json", import.meta.url), "utf8")),
  ) as MstManifest;
  const ncItems = manifestItems(parsed);
  const ncCollection = {
    type: "Collection",
    id: "nc",
    links: [],
    "cube:dimensions": manifestCube(parsed),
  } as unknown as StacCollection;
  it("with Pacific and a Pacific-only species, the species list is the Pacific's and Atlantic says why", () => {
    const view = viewOf(ncCollection, ncItems, "pacific.COMU.summer.n_per_km2");
    const sp = view.dims.find((d) => d.key === "species")!;
    const rg = view.dims.find((d) => d.key === "region")!;
    const f = selectorOptions({
      dim: sp,
      dims: view.dims,
      items: ncItems,
      selected: view.selected,
    });
    expect(f.hidden).toBeGreaterThan(0);
    expect(f.options.length + f.hidden).toBe(sp.values.length);
    const r = selectorOptions({
      dim: rg,
      dims: view.dims,
      items: ncItems,
      selected: view.selected,
    });
    expect(r.options.map((o) => o.label)).toEqual(["Atlantic (no Common Murre model)", "Pacific"]);
  });
});
