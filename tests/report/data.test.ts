import { describe, expect, it } from "vitest";
import { sqlRunFor, tablesReadFor } from "../../src/report/data";
import type { DataEngineContext } from "../../src/places/dataEngine";
import type { PlaceStub } from "../../src/lib/report/model";

const ZONE_STUB: PlaceStub = {
  place: { kind: "zone", set: "pa", keys: ["GAA"] },
  zoneKey: "GAA",
  unit: "programarea",
  name: "GAA",
  token: "z.pa.GAA",
};

const GEOM_STUB: PlaceStub = {
  place: {
    kind: "geom",
    name: "box",
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 0],
        ],
      ],
    },
  },
  name: "box",
  token: "g1.box.x",
};

describe("tablesReadFor", () => {
  it("empty when the engine never booted (e.g. a zone-only report before any species query)", () => {
    expect(tablesReadFor({}, [ZONE_STUB], false)).toEqual([]);
  });

  it("the core three once booted, plus model on a mdl_key release", () => {
    expect(tablesReadFor({ id_field: "mdl_key" }, [ZONE_STUB], true)).toEqual([
      "taxon",
      "zone_taxon",
      "taxonomy",
      "model",
    ]);
  });

  it("adds cell only when a custom (geom) place is present", () => {
    expect(tablesReadFor({}, [ZONE_STUB], true)).toEqual(["taxon", "zone_taxon", "taxonomy"]);
    expect(tablesReadFor({}, [GEOM_STUB], true)).toEqual([
      "taxon",
      "zone_taxon",
      "taxonomy",
      "cell",
    ]);
  });
});

function fakeCtx(): DataEngineContext {
  return {
    sources: {
      templates: {
        cells_in_study_area: "-- csa",
        scores_for_cells: "-- sfc",
        species_for_cells: "-- spc",
        species_for_zone: "-- spz",
        species_shares: "-- shares",
        cell_components: "",
        composition: "",
        cell_model_key: "",
        cell_model_seq: "",
      },
    },
  } as unknown as DataEngineContext;
}

describe("sqlRunFor", () => {
  it("empty when there is no engine at all", () => {
    expect(sqlRunFor(null, [ZONE_STUB])).toEqual([]);
  });

  it("zone-only report runs species_for_zone and species_shares, never the cell-path twins", () => {
    const names = sqlRunFor(fakeCtx(), [ZONE_STUB]).map((r) => r.name);
    expect(names).toEqual(["species_for_zone", "species_shares"]);
  });

  it("custom-place report runs the study-area clip, scores and species twins, plus shares", () => {
    const names = sqlRunFor(fakeCtx(), [GEOM_STUB]).map((r) => r.name);
    expect(names).toEqual([
      "cells_in_study_area",
      "scores_for_cells",
      "species_for_cells",
      "species_shares",
    ]);
  });

  it("a mixed report runs both paths' twins, exactly once each", () => {
    const names = sqlRunFor(fakeCtx(), [ZONE_STUB, GEOM_STUB]).map((r) => r.name);
    expect(names).toEqual([
      "cells_in_study_area",
      "scores_for_cells",
      "species_for_cells",
      "species_for_zone",
      "species_shares",
    ]);
  });
});
