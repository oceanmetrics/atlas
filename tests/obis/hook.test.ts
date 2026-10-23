// The `h3` hook (build week 4, step 5): a collection of the platform `h3` profile is the OBIS layer's input. The
// fixture is a trimmed copy of the published obis-h3 collection.json (v20261012, obisindicators 0.11); the
// counter-fixtures are the same document with one field broken.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { hookSpec, hooksOf, unknownHooks } from "../../src/lib/catalog/hooks";
import { isH3Collection, parseH3, periodSetsOf } from "../../src/lib/catalog/h3";
import type { StacCollection } from "../../src/lib/catalog/types";

const RAW = JSON.parse(readFileSync("tests/fixtures/obis_h3/collection.json", "utf8"));
const URL0 = "https://s3.us-east-1.amazonaws.com/oceanmetrics.io-public/obis-h3/collection.json";
const REL = "https://s3.us-east-1.amazonaws.com/oceanmetrics.io-public/obis-h3/v20261012/";
const coll = (patch: Record<string, unknown> = {}) =>
  ({ ...structuredClone(RAW), "atlas:url": URL0, ...patch }) as StacCollection;

describe("the h3 hook", () => {
  it("is registered and declared by the profile, not by an atlas:* field or the collection id", () => {
    expect(hooksOf(coll())).toEqual(["h3"]);
    expect(unknownHooks(coll())).toEqual([]);
    // the same document under another id is the same hook
    expect(hookSpec(coll({ id: "something_else" }), "h3")).toEqual(hookSpec(coll(), "h3"));
  });

  it("parses the published collection: templates, ladder, row groups", () => {
    const s = parseH3(coll())!;
    expect(s.resolutions).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(s.layout).toEqual({
      template: `${REL}all/res={res}/data_0.parquet`,
      parentTemplate: `${REL}all/res={res}/p={parent}/data_0.parquet`,
      parentRes: { 6: 2, 7: 3 },
      rowGroupRows: 12045,
    });
    expect(s.parentResByKind.taxon).toEqual({ 6: 0, 7: 0 });
    expect(s.release).toBe("v20261012");
  });

  it("two period sets (decade, year), each res 1 to 5 with its own placeholder", () => {
    const s = parseH3(coll())!;
    expect(s.periods.map((p) => [p.grain, p.placeholder, p.resolutions])).toEqual([
      ["decade", "decade", [1, 2, 3, 4, 5]],
      ["year", "year", [1, 2, 3, 4, 5]],
    ]);
    expect(s.periods[0].values).toEqual(["1960", "1970", "1980", "1990", "2000", "2010", "2020"]);
    expect(s.allPeriod).toBe("all");
    expect(s.periodLabels.all).toBe("All years");
  });

  it("the five indicators from table:columns, in the cube's order and words, default atlas:metric", () => {
    const s = parseH3(coll())!;
    expect(s.indicators.map((i) => i.value)).toEqual(["es", "sp", "shannon", "simpson", "n"]);
    expect(s.indicators[0].label).toBe("ES(50), expected species in 50 records");
    expect(s.defaultIndicator).toBe("es");
    expect(parseH3(coll({ "atlas:metric": "n" }))!.defaultIndicator).toBe("n");
    expect(parseH3(coll({ "atlas:metric": "bogus" }))!.defaultIndicator).toBe("es");
  });

  it("the view dimensions are found by what they hold, not by name", () => {
    expect(parseH3(coll())!.viewDims).toEqual({
      indicator: "indicator",
      period: "period",
      res: "res",
    });
    const cube = structuredClone(RAW["cube:dimensions"]);
    const renamed = { taxa: cube.layer, metric: cube.indicator, when: cube.period, size: cube.res };
    expect(parseH3(coll({ "cube:dimensions": renamed }))!.viewDims).toEqual({
      indicator: "metric",
      period: "when",
      res: "size",
    });
  });

  it("assets by role: stats.parquet the legend, taxon_groups.parquet the search; heads; the species tables", () => {
    const s = parseH3(coll())!;
    expect(s.stats).toBe(`${REL}stats.parquet`);
    expect(s.taxonGroups).toBe(`${REL}taxon_groups.parquet`);
    expect(s.heads).toEqual({ href: `${REL}species/heads.json`, layer: "taxon" });
    expect(s.speciesTable?.columns).toEqual({
      cell: "cell_id",
      species: "aphiaid",
      count: "n",
      nameKey: "name_key",
      yearMin: "year_min",
      yearMax: "year_max",
    });
    expect(s.speciesTable?.resolutions).toEqual([3, 4, 5]);
    expect(s.speciesTable?.lookup?.href).toBe(`${REL}species/species.parquet`);
    expect(s.speciesTable?.lookup?.rankColumns.family).toBe("family");
    expect(s.speciesFlat).toEqual({
      hrefTemplate: `${REL}species_flat/res={res}.parquet`,
      resolutions: [3],
    });
  });
  it("the release's metadata and manifest by asset key; sci:citation when the collection publishes one", () => {
    const s = parseH3(coll())!;
    expect(s.releaseMeta).toBe(`${REL}release.json`);
    expect(s.files).toBe(`${REL}files.parquet`);
    expect(s.citation).toBeNull();
    expect(parseH3(coll({ "sci:citation": "X (2026). Y." }))!.citation).toBe("X (2026). Y.");
    // no release asset: the related link to a release.json
    const noAsset = coll();
    delete (noAsset.assets as Record<string, unknown>).release;
    expect(parseH3(noAsset)!.releaseMeta).toBe(`${REL}release.json`);
  });
});

describe("counter-fixtures", () => {
  it("a collection of another profile is not h3", () => {
    expect(parseH3(coll({ stac_extensions: [], "h3:layout": undefined }))).toBeNull();
    expect(isH3Collection(null)).toBe(false);
    expect(
      hooksOf({ type: "Collection", id: "x", links: [] } as unknown as StacCollection),
    ).toEqual([]);
  });
  it("the profile's fields without the extension url still parse (a 1.0 document)", () => {
    expect(parseH3(coll({ stac_extensions: [] }))).not.toBeNull();
  });
  it("a relative template resolves against the collection's url and keeps its braces", () => {
    const s = parseH3(coll({ "h3:layout": { template: "v1/all/res={res}/data_0.parquet" } }))!;
    expect(s.layout.template).toBe(
      "https://s3.us-east-1.amazonaws.com/oceanmetrics.io-public/obis-h3/v1/all/res={res}/data_0.parquet",
    );
  });
  it("no ladder or no template: nothing to draw", () => {
    expect(parseH3(coll({ "h3:resolutions": [] }))).toBeNull();
    expect(parseH3(coll({ "h3:layout": { template: "" } }))).toBeNull();
  });
  it("no numeric column but the ids: no indicator, nothing to draw", () => {
    expect(parseH3(coll({ "table:columns": [{ name: "h3", type: "VARCHAR" }] }))).toBeNull();
  });
  it("a period set without a placeholder or values is dropped (1.1); one set alone is a list of one (1.0)", () => {
    const sets = structuredClone(RAW["h3:periods"]);
    delete sets[1].placeholder;
    expect(periodSetsOf({ "h3:periods": sets }, [1]).map((p) => p.grain)).toEqual(["decade"]);
    expect(
      periodSetsOf({ "h3:periods": { grain: "decade", values: [], placeholder: "d" } }, [1]),
    ).toEqual([]);
    expect(
      periodSetsOf(
        { "h3:periods": { grain: "decade", values: ["1990"], placeholder: "decade" } },
        [1, 2],
      ),
    ).toEqual([{ grain: "decade", values: ["1990"], placeholder: "decade", resolutions: [1, 2] }]);
  });
});
