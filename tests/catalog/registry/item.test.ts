import { describe, expect, it } from "vitest";
import {
  bboxOfRow,
  resolveRegistryKey,
  rowFromRecord,
  rowOfV7Key,
  rowsFromRecords,
} from "../../../src/lib/catalog/registry/rows";
import {
  aquamapsUrl,
  effectiveRep,
  registryFacts,
  registryItem,
} from "../../../src/lib/catalog/registry/item";
import { itemTemplateOf } from "../../../src/lib/catalog/registry/ref";
import { rasterAssetOf } from "../../../src/lib/catalog/assets";
import { collectionMapInputs } from "../../../src/lens/collection/mapInputs";
import { itemSourceBounds } from "../../../src/lib/raster/bounds";
import type { CollectionEntry } from "../../../src/lib/catalog/load";
import { LEATHERBACK_RECORD, UNMATCHED_RECORD, nativeCollection, row } from "./support";

const template = itemTemplateOf(nativeCollection());
const build = (rec: Record<string, unknown>, rep?: string) =>
  registryItem(row(rec), "aquamaps_native", template, { rep });

describe("registry rows", () => {
  it("a record becomes a row; BigInt ids become numbers, blanks become null", () => {
    const r = row({ ...LEATHERBACK_RECORD, common_name: "  " });
    expect(r).toMatchObject({
      key: "Rep-3437",
      mdlKey: "am|Rep-3437",
      aphiaId: 137209,
      botwId: null,
      commonName: null,
      group: "turtle",
      redlistCode: "VU",
      bboxNative: [-180, -78.5, 180, 70.5],
      bbox005: [-180, -78.5, 180, 71],
      spKeyV7: "Rep-3437",
    });
  });
  it("a record with no key or no native COG is not a row (nothing to draw)", () => {
    expect(rowFromRecord({ ...LEATHERBACK_RECORD, sp_key: null })).toBeNull();
    expect(rowFromRecord({ ...LEATHERBACK_RECORD, cog_url: "" })).toBeNull();
    expect(rowsFromRecords([LEATHERBACK_RECORD, UNMATCHED_RECORD, { sp_key: "x" }]).size).toBe(2);
  });
  it("a bbox is four finite numbers with west < east and south < north, else none", () => {
    expect(bboxOfRow([-10, -5, 10, 5])).toEqual([-10, -5, 10, 5]);
    expect(bboxOfRow(new Float64Array([-10, -5, 10, 5]))).toEqual([-10, -5, 10, 5]);
    expect(bboxOfRow([10, -5, -10, 5])).toBeNull();
    expect(bboxOfRow([-10, -5, 10])).toBeNull();
    expect(bboxOfRow([-10, "a", 10, 5])).toBeNull();
    expect(bboxOfRow(null)).toBeNull();
  });
});

describe("old v7 keys (?sp=Fis-49220 of a v7-era link) resolve through sp_key_v7", () => {
  const rows = rowsFromRecords([
    LEATHERBACK_RECORD,
    UNMATCHED_RECORD,
    { ...LEATHERBACK_RECORD, sp_key: "Fis-49220", sp_key_v7: null },
  ]);
  it("a key the registry has is itself, even when another row lists it as its v7 key", () => {
    expect(resolveRegistryKey(rows, "Rep-3437")).toBe("Rep-3437");
    expect(resolveRegistryKey(rows, "Fis-49220")).toBe("Fis-49220");
  });
  it("a v7 key that differs from the v8 one maps to the v8 row", () => {
    expect(resolveRegistryKey(rows, "SLB-64971")).toBe(UNMATCHED_RECORD.sp_key);
    expect(rowOfV7Key(rows, "SLB-64971")?.scientificName).toBe("Abylopsis eschscholtzi");
  });
  it("an unknown key stays as it is (the lens then says it is not in the registry)", () => {
    expect(resolveRegistryKey(rows, "Nope-1")).toBe("Nope-1");
    expect(rowOfV7Key(rows, "Nope-1")).toBeNull();
  });
});

describe("registryItem: one Item per row, by the collection's template", () => {
  const item = build(LEATHERBACK_RECORD);

  it("id, collection, datetime, and the title with the common name", () => {
    expect(item).toMatchObject({
      type: "Feature",
      id: "Rep-3437",
      collection: "aquamaps_native",
      properties: { title: "Dermochelys coriacea (Leatherback Turtle)", datetime: null },
    });
  });
  it("bbox from the row's native box, geometry is that box as a polygon", () => {
    expect(item.bbox).toEqual([-180, -78.5, 180, 70.5]);
    expect(item.geometry).toMatchObject({ type: "Polygon" });
    const ring = (item.geometry as { coordinates: number[][][] }).coordinates[0];
    expect(ring[0]).toEqual([-180, -78.5]);
    expect(ring[2]).toEqual([180, 70.5]);
    expect(ring[4]).toEqual(ring[0]);
  });
  it("a row with no usable bbox gets no bbox at all (the lens then reads the footprint)", () => {
    const no = build({ ...LEATHERBACK_RECORD, bbox_native: [1, 1, 1, 1] });
    expect(no.bbox).toBeUndefined();
    expect(no.geometry).toBeUndefined();
  });
  it("the COG asset: rescale [1, 100], no-data 0, the template's colormap, band 1", () => {
    const cog = item.assets.cog;
    expect(cog.href).toMatch(/aaaa\.tif$/);
    expect(cog["atlas:rescale"]).toEqual([1, 100]);
    expect(cog["atlas:colormap"]).toBe("spectral_r");
    expect(cog["atlas:bidx"]).toBe(1);
    expect(cog.bands).toEqual([
      { name: "suitability", data_type: "uint8", nodata: 0, unit: "percent" },
    ]);
    expect(item.properties["atlas:value_range"]).toEqual([1, 100]);
  });
  it("the template's rescale and colormap, not a constant, drive the asset", () => {
    const t = { ...template, rescale: [0, 50] as [number, number], colormap: "viridis" as const };
    const it2 = registryItem(row(LEATHERBACK_RECORD), "aquamaps_native", t);
    expect(it2.assets.cog["atlas:rescale"]).toEqual([0, 50]);
    expect(it2.assets.cog["atlas:colormap"]).toBe("viridis");
  });
  it("sdm:taxon: names, group, WoRMS id as authorities, Red List code", () => {
    expect(item.properties["sdm:taxon"]).toEqual({
      scientific_name: "Dermochelys coriacea",
      common_name: "Leatherback Turtle",
      group: "turtle",
      authorities: { worms: "137209" },
      redlist_code: "VU",
    });
  });
  it("the one bird has a BOTW id, not a WoRMS one", () => {
    const bird = build({ ...LEATHERBACK_RECORD, aphia_id: null, botw_id: 22698 });
    expect((bird.properties["sdm:taxon"] as { authorities: unknown }).authorities).toEqual({
      botw: "22698",
    });
  });
  it("unmatched row: group is `other`, no ids, no common name, nothing written as null", () => {
    const u = build(UNMATCHED_RECORD);
    expect(u.properties.title).toBe("Abylopsis eschscholtzi");
    expect(u.properties["sdm:taxon"]).toEqual({
      scientific_name: "Abylopsis eschscholtzi",
      group: "other",
    });
    expect(JSON.stringify(u.properties["sdm:taxon"])).not.toContain("null");
  });
});

describe("the native vs downscaled switch (rep=native|005)", () => {
  it("both COGs are listed for a row with a 0.05 surface; native plays `data` by default", () => {
    const item = build(LEATHERBACK_RECORD);
    expect(Object.keys(item.assets)).toEqual(["cog", "cog_005"]);
    expect(item.properties["atlas:representation"]).toBe("native");
    expect(rasterAssetOf(item)!.url).toMatch(/aaaa\.tif$/);
  });
  it("rep=005 makes the 0.05 degree COG the drawn one, same rescale and colormap", () => {
    const item = build(LEATHERBACK_RECORD, "005");
    expect(item.properties["atlas:representation"]).toBe("005");
    const drawn = rasterAssetOf(item)!;
    expect(drawn.url).toMatch(/3b65e8ff84b8cf75\.tif$/);
    expect(drawn).toMatchObject({ rescale: [1, 100], colormap: "spectral_r" });
  });
  it("rep=005 on a row with no cog_url_005 falls back to native", () => {
    expect(effectiveRep(row(UNMATCHED_RECORD), "005")).toBe("native");
    const item = build(UNMATCHED_RECORD, "005");
    expect(Object.keys(item.assets)).toEqual(["cog"]);
    expect(item.properties["atlas:representation"]).toBe("native");
    expect(rasterAssetOf(item)!.url).toMatch(/bbbb\.tif$/);
  });
  it("effectiveRep: 005 only when asked for AND present; anything else is native", () => {
    const r = row(LEATHERBACK_RECORD);
    expect(effectiveRep(r, "005")).toBe("005");
    expect(effectiveRep(r, "native")).toBe("native");
    expect(effectiveRep(r, "model")).toBe("native");
    expect(effectiveRep(r, undefined)).toBe("native");
    expect(effectiveRep(null, "005")).toBe("native");
  });
  it("each surface carries its own bbox: native the native box, 005 the 0.05 degree one (no /cog/info)", () => {
    expect(build(LEATHERBACK_RECORD, "native").bbox).toEqual([-180, -78.5, 180, 70.5]);
    const d = build(LEATHERBACK_RECORD, "005");
    expect(d.bbox).toEqual([-180, -78.5, 180, 71]);
    expect((d.geometry as { coordinates: number[][][] }).coordinates[0][2]).toEqual([180, 71]);
  });
  it("a 0.05 box that is missing or malformed leaves the Item with no bbox (never the native one)", () => {
    expect(build({ ...LEATHERBACK_RECORD, bbox_005: null }, "005").bbox).toBeUndefined();
    expect(build({ ...LEATHERBACK_RECORD, bbox_005: [5, 5, 1, 1] }, "005").bbox).toBeUndefined();
  });
  it("the downscaled asset is named for what it is: global, release v8", () => {
    expect(build(LEATHERBACK_RECORD).assets.cog_005.title).toMatch(/0\.05 degree, global.*v8/);
  });
});

describe("drawn through the existing titiler raster path, source bounds from the row's bbox", () => {
  const entry: CollectionEntry = {
    id: "aquamaps_native",
    title: "AquaMaps habitat suitability (native 0.5° and global 0.05°)",
    href: "https://x.test/aquamaps_native/collection.json",
    group: "oceanmetrics",
    external: false,
    status: "ok",
    collection: nativeCollection(),
    error: null,
  };
  it("native: tile URL of the native COG at rescale 1-100, bounds = the row's box (no /cog/info)", () => {
    const item = build(LEATHERBACK_RECORD);
    const out = collectionMapInputs({
      entry,
      item,
      style: null,
      values: null,
      marker: null,
      cogBounds: itemSourceBounds(item),
    });
    expect(out.raster?.tiles[0]).toContain("colormap_name=spectral_r&rescale=1,100");
    expect(decodeURIComponent(out.raster!.tiles[0])).toContain("/native/am/aaaa.tif");
    expect(out.raster?.bounds).toEqual([-180, -78.5, 180, 70.5]);
    expect(out.legend?.unit).toBe("percent");
    expect(out.legend?.stops[0].value).toBe(1);
    expect(out.legend?.stops.at(-1)?.value).toBe(100);
  });
  it("005: tile URL of the global 0.05 COG, bounds = the row's 0.05 box (no /cog/info either)", () => {
    const item = build(LEATHERBACK_RECORD, "005");
    expect(itemSourceBounds(item)).toEqual([-180, -78.5, 180, 71]);
    const out = collectionMapInputs({
      entry,
      item,
      style: null,
      values: null,
      marker: null,
      cogBounds: itemSourceBounds(item),
    });
    expect(decodeURIComponent(out.raster!.tiles[0])).toContain(
      "/cog/global05/3b65e8ff84b8cf75.tif",
    );
    expect(out.raster?.bounds).toEqual([-180, -78.5, 180, 71]);
    expect(out.cogUrl).toMatch(/3b65e8ff84b8cf75\.tif$/);
  });
  it("itemSourceBounds clamps to the mercator range and ignores a bad box", () => {
    expect(itemSourceBounds({ bbox: [-180, -90, 180, 90] })).toEqual([
      -180, -85.0511, 180, 85.0511,
    ]);
    expect(itemSourceBounds({ bbox: [5, 5, 1, 1] })).toBeNull();
    expect(itemSourceBounds({})).toBeNull();
    expect(itemSourceBounds(null)).toBeNull();
  });
});

describe("Details: identifiers and the AquaMaps page", () => {
  it("lists names, category, WoRMS (linked), Red List and the AquaMaps key (linked)", () => {
    const facts = registryFacts(build(LEATHERBACK_RECORD));
    const by = (label: string) => facts.find((f) => f.label === label);
    expect(by("Scientific name")?.value).toBe("Dermochelys coriacea");
    expect(by("Category")?.value).toBe("turtle");
    expect(by("WoRMS AphiaID")).toEqual({
      label: "WoRMS AphiaID",
      value: "137209",
      href: "https://www.marinespecies.org/aphia.php?p=taxdetails&id=137209",
    });
    expect(by("IUCN Red List")?.value).toBe("VU");
    expect(by("AquaMaps key")).toMatchObject({ value: "Rep-3437", href: aquamapsUrl("Rep-3437") });
  });
  it("the AquaMaps URL opens the species map page (preMap.php), with the key encoded", () => {
    expect(aquamapsUrl("Rep-3437")).toBe(
      "https://www.aquamaps.org/preMap.php?cache=1&SpecID=Rep-3437&from=premap&map=cached&type_of_map=regular",
    );
    expect(aquamapsUrl("a b")).toContain("SpecID=a%20b&");
  });
  it("an unmatched taxon has no WoRMS row, and says `other`", () => {
    const facts = registryFacts(build(UNMATCHED_RECORD));
    expect(facts.some((f) => f.label === "WoRMS AphiaID")).toBe(false);
    expect(facts.find((f) => f.label === "Category")?.value).toBe("other");
  });
});

describe("readRegistryRows: a real registry Parquet (3-row sample, same columns and types)", () => {
  it("reads every row into the Map by key: list<double> bbox, nulls, int32 ids", async () => {
    const { readFileSync } = await import("node:fs");
    const { readRegistryRows } = await import("../../../src/lib/catalog/registry/rows");
    const buf = readFileSync(
      new URL("../../fixtures/registry/registry_sample.parquet", import.meta.url),
    );
    const res = await readRegistryRows(
      buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer,
    );
    if (!res.ok) throw new Error(res.error.message);
    const CHN = "Chn-0a1b2c3d-0000-4000-8000-000000000004";
    expect([...res.value.keys()]).toEqual(["Rep-3437", CHN, "Fis-1"]);
    expect(res.value.get("Rep-3437")).toMatchObject({
      aphiaId: 137209,
      group: "turtle",
      bboxNative: [-180, -78.5, 180, 70.5],
      bbox005: [-180, -78.5, 180, 70.5],
      cogUrl005: "https://x.test/c/bbbb.tif",
      spKeyV7: "Rep-3437",
    });
    expect(res.value.get(CHN)).toMatchObject({
      group: null,
      aphiaId: null,
      spKeyV7: "SLB-64971",
    });
    expect(res.value.get("Fis-1")).toMatchObject({
      bboxNative: null,
      bbox005: null,
      spKeyV7: null,
    });
    // the unmatched row becomes an `other` Item, a row with no bbox an Item with none (either surface)
    expect(registryItem(res.value.get(CHN)!, "c").properties["sdm:taxon"]).toMatchObject({
      group: "other",
    });
    expect(registryItem(res.value.get("Fis-1")!, "c").bbox).toBeUndefined();
    expect(
      registryItem(res.value.get("Fis-1")!, "c", undefined, { rep: "005" }).bbox,
    ).toBeUndefined();
    expect(resolveRegistryKey(res.value, "SLB-64971")).toBe(CHN);
  });
  it("garbage is an error result, never a throw", async () => {
    const { readRegistryRows } = await import("../../../src/lib/catalog/registry/rows");
    const res = await readRegistryRows(new ArrayBuffer(8));
    expect(res.ok).toBe(false);
  });
});
