import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  loadManifest,
  manifestCube,
  manifestItems,
  manifestUrl,
  parseManifest,
  type MstManifest,
} from "../../../src/lib/catalog/mst/manifest";
import { loadMstItems } from "../../../src/lib/catalog/mst/items";
import {
  availableValues,
  dimsOf,
  itemDims,
  resolveItem,
  selectDim,
  viewOf,
} from "../../../src/lib/catalog/dims";
import { rasterAssetOf } from "../../../src/lib/catalog/assets";
import type { StacCollection } from "../../../src/lib/catalog/types";
import { buildGm, buildNc, parseCsv } from "../../../scripts/mst/build-manifests.mjs";

const PUBLIC = new URL("../../../public/mst/", import.meta.url);
function readManifest(name: string): MstManifest {
  const parsed = parseManifest(JSON.parse(readFileSync(new URL(name, PUBLIC), "utf8")));
  if (typeof parsed === "string") throw new Error(`${name}: ${parsed}`);
  return parsed;
}
const coll = (m: MstManifest): StacCollection => ({
  type: "Collection",
  id: m.collection,
  links: [],
  "cube:dimensions": manifestCube(m),
});

// a tiny nc: two regions, two seasons, a species group, ci90 only for Atlantic
const NC_MODELS = `ds_key,region,sp_code,season,var,cog_url,bidx
nc_atl_birds_dens,Atlantic,ARTE,summer,n_per_km2,https://x.test/atl/ARTE_summer.tif,1
nc_atl_birds_dens,Atlantic,ARTE,summer,cv_n_per_km2,https://x.test/atl/ARTE_summer.tif,2
nc_atl_birds_dens,Atlantic,ARTE,summer,ci90_n_per_km2,https://x.test/atl/ARTE_summer.tif,3
nc_atl_birds_dens,Atlantic,ARTE,winter,n_per_km2,https://x.test/atl/ARTE_winter.tif,1
nc_pac_birds_dens,Pacific,CORM,summer,n_per_km2,https://x.test/pac/CORM_summer.tif,1
nc_pac_birds_dens,Pacific,CORM,summer,cv_n_per_km2,https://x.test/pac/CORM_summer.tif,2
`;
const NC_XW = `sp_code,sp_common,nc_scientific,gbif_id,is_guild,match_by,sisid,botw_scientific,botw_common,ms_merge_key,note
ARTE,Arctic Tern,Sterna paradisaea,GBIF:5229230,FALSE,common name,22694629,x,x,x,
CORM,Cormorant spp.,Phalacrocorax,GBIF:2481854,TRUE,,,,,,"a, quoted note"
`;

describe("nc manifest -> dimensions (synthetic table)", () => {
  const m = readSynthetic();
  function readSynthetic(): MstManifest {
    const built = buildNc(parseCsv(NC_MODELS), parseCsv(NC_XW), "2026-10-14");
    const parsed = parseManifest(built);
    if (typeof parsed === "string") throw new Error(parsed);
    return parsed;
  }
  const items = manifestItems(m);
  const dims = dimsOf(coll(m), items);

  it("derives region x species x season x variable, in that order, with labels", () => {
    expect(dims.map((d) => d.key)).toEqual(["region", "species", "season", "variable"]);
    expect(dims[0].values).toEqual([
      { value: "atlantic", label: "Atlantic" },
      { value: "pacific", label: "Pacific" },
    ]);
    expect(dims[1].values.map((v) => v.label)).toEqual(["Arctic Tern", "Cormorant spp. (group)"]);
    expect(dims[2].values.map((v) => v.value)).toEqual(["summer", "winter"]);
    expect(dims[3].values.map((v) => v.value)).toEqual([
      "n_per_km2",
      "cv_n_per_km2",
      "ci90_n_per_km2",
    ]);
  });
  it("a species group is its own row with its own identifiers", () => {
    const corm = items.find((i) => i.id === "pacific.CORM.summer.n_per_km2")!;
    expect(corm.properties["sdm:taxon"]).toMatchObject({ group: true });
    const arte = items.find((i) => i.id === "atlantic.ARTE.summer.n_per_km2")!;
    expect(arte.properties["sdm:taxon"]).toMatchObject({
      scientific_name: "Sterna paradisaea",
      ids: { gbif: "5229230", botw: "22694629" },
    });
  });
  it("each item is one band of one COG, asking for titiler's own rescale", () => {
    const cv = items.find((i) => i.id === "atlantic.ARTE.summer.cv_n_per_km2")!;
    expect(rasterAssetOf(cv)).toEqual({
      url: "https://x.test/atl/ARTE_summer.tif",
      bidx: 2,
      rescale: "auto",
    });
    expect(itemDims(cv)).toEqual({
      region: "atlantic",
      species: "ARTE",
      season: "summer",
      variable: "cv_n_per_km2",
    });
  });
  it("ci90 exists only where the table has it (Atlantic)", () => {
    expect(resolveItem(items, { region: "pacific", variable: "ci90_n_per_km2" })).toBeNull();
    expect(resolveItem(items, { region: "atlantic", variable: "ci90_n_per_km2" })).not.toBeNull();
  });
  it("switching region snaps the species to one that exists there", () => {
    const view = viewOf(coll(m), items, undefined);
    const next = selectDim(items, view.selected, "region", "pacific")!;
    expect(itemDims(next).region).toBe("pacific");
    expect(itemDims(next).species).toBe("CORM");
  });
  it("only the values still reachable are available", () => {
    const view = viewOf(coll(m), items, undefined);
    const speciesDim = dims.find((d) => d.key === "species")!;
    expect([...availableValues(speciesDim, items, view.selected)]).toEqual(["ARTE"]);
  });
  it("item ids are unique (so `i=` names exactly one model)", () => {
    expect(new Set(items.map((i) => i.id)).size).toBe(items.length);
  });
  it("the unit follows the variable", () => {
    const n = items.find((i) => i.id.endsWith("summer.n_per_km2"))!;
    const cv = items.find((i) => i.id.endsWith("summer.cv_n_per_km2"))!;
    expect(n.properties["sdm:value_unit"]).toBe("n_per_km2");
    expect(cv.properties["sdm:value_unit"]).toBe("unitless");
  });
});

describe("the committed manifests (public/mst) agree with the MST tables they were built from", () => {
  it("nc: 690 band rows, 82 species or groups, Atlantic has ci90, Pacific does not", () => {
    const m = readManifest("nc_models.json");
    const items = manifestItems(m);
    expect(items).toHaveLength(690);
    const dims = dimsOf(coll(m), items);
    expect(dims.find((d) => d.key === "species")!.values).toHaveLength(82);
    expect(dims.find((d) => d.key === "region")!.values.map((v) => v.value)).toEqual([
      "atlantic",
      "pacific",
    ]);
    expect(resolveItem(items, { region: "pacific", variable: "ci90_n_per_km2" })).toBeNull();
    expect(new Set(items.map((i) => i.id)).size).toBe(690);
    // the ARTE summer COG serves bands 1-3
    const bands = items
      .filter((i) => i.id.startsWith("atlantic.ARTE.summer."))
      .map((i) => rasterAssetOf(i)?.bidx);
    expect(bands).toEqual([1, 2, 3]);
  });
  it("gm: 17 taxa, annual only (the monthly surfaces have no COG), a fixed 1-100 index", () => {
    const m = readManifest("gm_models.json");
    const items = manifestItems(m);
    expect(items).toHaveLength(17);
    const dims = dimsOf(coll(m), items);
    expect(dims.map((d) => d.key)).toEqual(["species", "time"]);
    expect(dims[1].values).toEqual([{ value: "annual", label: "Annual" }]);
    const leatherback = items.find((i) => i.id === "WORMS:137209.annual")!;
    expect(rasterAssetOf(leatherback)).toMatchObject({ rescale: [1, 100] });
    expect(leatherback.properties["sdm:taxon"]).toMatchObject({ ids: { worms: "137209" } });
    expect(leatherback.properties["sdm:value_unit"]).toBe("relative density (0-100)");
  });
});

describe("buildGm", () => {
  it("keeps only annual surfaces that have a COG", () => {
    const m = buildGm(
      parseCsv(
        "mdl_key,interval,sp_id,scientific_name,val_cap,populations\n" +
          "gm|WORMS:1|annual,annual,WORMS:1,Aus bus,0.5,\n" +
          "gm|WORMS:1|03,03,WORMS:1,Aus bus,0.5,\n" +
          "gm|WORMS:2|annual,annual,WORMS:2,Cus dus,0.1,\n",
      ),
      parseCsv(
        "mdl_key,sp_id,scientific_name,cog,asset_url\ngm|WORMS:1,WORMS:1,Aus bus,gm_WORMS_1.tif,https://x.test/gm_WORMS_1.tif\n",
      ),
      "2026-10-14",
    );
    expect(m.models).toEqual([["WORMS:1", "annual", "https://x.test/gm_WORMS_1.tif", 1]]);
  });
});

describe("parseManifest", () => {
  const ok = {
    schema: 1,
    collection: "c",
    dims: [{ key: "a", title: "A", values: [{ value: "x", label: "X" }] }],
    models: [["x", "https://x.test/a.tif", 1]],
  };
  it("accepts a well-formed table", () => {
    expect(typeof parseManifest(ok)).toBe("object");
  });
  it("names the first violation", () => {
    expect(parseManifest({ ...ok, schema: 2 })).toBe("unsupported schema");
    expect(parseManifest({ ...ok, models: [["x", 1]] })).toBe("a model row has the wrong length");
    expect(parseManifest({ ...ok, models: [["x", "u", "1"]] })).toBe("malformed model row");
    expect(parseManifest(null)).toBe("not an object");
  });
});

describe("loading", () => {
  it("manifestUrl is relative to the base it is given", () => {
    expect(manifestUrl("nc", "https://atlas.test/atlas/")).toBe(
      "https://atlas.test/atlas/mst/nc_models.json",
    );
  });
  it("loadMstItems reads the manifest and returns the items with the cube", async () => {
    const body = readFileSync(new URL("gm_models.json", PUBLIC), "utf8");
    const urls: string[] = [];
    const fetchImpl = (async (u: string) => {
      urls.push(u);
      return new Response(body);
    }) as unknown as typeof fetch;
    const res = await loadMstItems(
      { id: "msens-v8-gm", group: "mst-v8" },
      { fetchImpl, manifestBase: "https://atlas.test/atlas/" },
    );
    expect(urls).toEqual(["https://atlas.test/atlas/mst/gm_models.json"]);
    expect(res.ok && res.value.items).toHaveLength(17);
    expect(res.ok && Object.keys(res.value.cube)).toEqual(["species", "time"]);
  });
  it("a missing manifest is a result, never a throw", async () => {
    const fetchImpl = (async () => new Response("no", { status: 404 })) as unknown as typeof fetch;
    const res = await loadMstItems(
      { id: "msens-v8-nc", group: "mst-v8" },
      { fetchImpl, manifestBase: "https://atlas.test/atlas/" },
    );
    expect(res.ok).toBe(false);
    const direct = await loadManifest("nc", { fetchImpl, base: "https://atlas.test/atlas/" });
    expect(direct).toMatchObject({ ok: false, message: "HTTP 404" });
  });
  it("a taxon collection is not loaded through the manifest", async () => {
    const res = await loadMstItems({ id: "msens-v7-bl", group: "mst-v7" });
    expect(res.ok).toBe(false);
  });
});
