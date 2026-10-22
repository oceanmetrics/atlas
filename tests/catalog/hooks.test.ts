// The hook registry (src/lib/catalog/hooks.ts): one synthetic collection per rule. A collection declares a
// renderer through an `atlas:*` hook; the registry is the one place that names hook -> module.
import { describe, expect, it } from "vitest";
import { CELL_SPECIES_HOOK } from "../../src/lib/catalog/cellSpecies";
import { FLOWER_HOOK } from "../../src/lib/catalog/flower";
import {
  DATA_FIELDS,
  HOOK_NAMES,
  HOOKS,
  hookSpec,
  hooksOf,
  unknownHooks,
} from "../../src/lib/catalog/hooks";
import { TAXA_REGISTRY_HOOK } from "../../src/lib/catalog/registry/ref";
import type { StacCollection } from "../../src/lib/catalog/types";

const URL_BASE = "https://data.test/atlas/x/collection.json";

function collection(extra: Record<string, unknown> = {}): StacCollection {
  return {
    type: "Collection",
    stac_version: "1.1.0",
    id: "x",
    description: "synthetic",
    license: "CC-BY-4.0",
    extent: { spatial: { bbox: [[-180, -90, 180, 90]] }, temporal: { interval: [[null, null]] } },
    links: [],
    assets: {},
    "atlas:url": URL_BASE,
    ...extra,
  } as unknown as StacCollection;
}

const flowerCollection = () =>
  collection({ "atlas:flower": { dimension: "eov", composite: "all" } });

const cellSpeciesCollection = () =>
  collection({
    assets: { species: { href: "./species.parquet", type: "application/vnd.apache.parquet" } },
    "atlas:cell_species": {
      layout: "tiles",
      tile_deg: 5,
      href_template: "cell_species/tile={tile}/data_0.parquet",
      grid: { ncol: 7200, nrow: 3600, x0: -180, y0: 90, res: 0.05 },
      key_column: "cell_id",
      species_column: "aphia_id",
      lookup_asset: "species",
      lookup_key: "aphia_id",
      value_column: "suit",
    },
  });

describe("HOOKS: the registry names hook -> module, and only there", () => {
  it("its keys are exactly the modules' own hook names, in registry order", () => {
    expect(Object.keys(HOOKS)).toEqual([FLOWER_HOOK, CELL_SPECIES_HOOK, TAXA_REGISTRY_HOOK]);
    expect(HOOK_NAMES).toEqual(["atlas:flower", "atlas:cell_species", "atlas:taxa_registry"]);
  });

  it("no registered hook is also listed as a data field", () => {
    for (const name of HOOK_NAMES) expect(DATA_FIELDS.has(name)).toBe(false);
  });
});

describe("hooksOf: the registered hooks a collection declares usably", () => {
  it("a flower collection has the flower hook", () => {
    expect(hooksOf(flowerCollection())).toEqual(["atlas:flower"]);
    expect(hookSpec(flowerCollection(), "atlas:flower")).toEqual({
      dimension: "eov",
      composite: "all",
    });
  });

  it("a cell_species collection has the cell_species hook, its spec resolved against the collection", () => {
    expect(hooksOf(cellSpeciesCollection())).toEqual(["atlas:cell_species"]);
    expect(hookSpec(cellSpeciesCollection(), "atlas:cell_species")).toMatchObject({
      tileTemplate: "https://data.test/atlas/x/cell_species/tile={tile}/data_0.parquet",
      lookupUrl: "https://data.test/atlas/x/species.parquet",
      grid: { ncol: 7200, nrow: 3600, x0: -180, y0: 90, res: 0.05 },
    });
  });

  it("a plain collection has none, and neither does no collection", () => {
    expect(hooksOf(collection())).toEqual([]);
    expect(hooksOf(null)).toEqual([]);
    expect(hookSpec(undefined, "atlas:flower")).toBeNull();
  });

  it("an unusable declaration is not counted (the parser's null), same as before the registry", () => {
    expect(hooksOf(collection({ "atlas:flower": { dimension: "eov" } }))).toEqual([]);
  });
});

describe("unknownHooks: declared atlas:* renderer hooks this build lacks", () => {
  it("reports atlas:uncertainty (the MarineSensitivity hook of build week 4)", () => {
    expect(unknownHooks(collection({ "atlas:uncertainty": { asset: "sd" } }))).toEqual([
      "atlas:uncertainty",
    ]);
  });

  it("does not report a generic data field such as atlas:value_range, nor a registered hook", () => {
    expect(unknownHooks(collection({ "atlas:value_range": [0, 1] }))).toEqual([]);
    expect(unknownHooks(flowerCollection())).toEqual([]);
    expect(unknownHooks(collection({ "atlas:item_template": {}, "atlas:funders": ["A"] }))).toEqual(
      [],
    );
  });

  it("ignores keys outside the atlas: namespace", () => {
    expect(unknownHooks(collection({ "sdm:response_type": "presence" }))).toEqual([]);
    expect(unknownHooks(null)).toEqual([]);
  });
});
