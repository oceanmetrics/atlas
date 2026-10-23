// WP11 item 10: the info dialog of a place layer. The view model is built from the manifest row and the
// collection's own `collection.json` (the published `gebco_undersea` shape, and the status-carrying
// `boem_wind_planning_rescinded`); a collection that cannot be read leaves the manifest's own fields.
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import {
  clearLayerCollectionCache,
  collectionJsonUrls,
  layerInfoModel,
  loadLayerCollection,
  placesLayerPage,
} from "../../src/lib/gazetteer/layerInfo";
import { GAZETTEER_BUCKET_BASE, GAZETTEER_ROOT } from "../../src/lib/gazetteer/config";
import type { Layer } from "@oceanmetrics/places";

const fixture = (name: string): Record<string, unknown> =>
  JSON.parse(readFileSync(new URL(`../fixtures/gazetteer/${name}`, import.meta.url), "utf8"));
const GEBCO = fixture("gebco_undersea.collection.json");
const RESCINDED = fixture("boem_wind_planning_rescinded.collection.json");

const manifestRow = (over: Partial<Layer> = {}): Layer =>
  ({
    slug: "gebco_undersea",
    title: "GEBCO undersea features (manifest)",
    collection: "gebco_undersea",
    pmtiles: `${GAZETTEER_ROOT}gebco_undersea/places.pmtiles`,
    source_layer: "gebco_undersea",
    geom_type: "MultiPolygon",
    n: 5412,
    updated: "2026-10-08",
    version: "1.0.1",
    paint: {},
    authority: "GEBCO",
    place_type: "undersea_feature",
    bbox: null,
    attribution: "GEBCO credit (manifest). Processed by Ocean Metrics.",
    attribution_html: "",
    license: "CC-BY-4.0",
    license_url: "https://creativecommons.org/licenses/by/4.0/",
    citation: "",
    access: "public",
    ...over,
  }) as Layer;

const fromCanonical = {
  json: GEBCO,
  url: `${GAZETTEER_ROOT}gebco_undersea/collection.json`,
};

// a build whose data base is another host (VITE_OM_STORAGE=s3, the rollback): path-style S3
const S3_GAZETTEER = "https://s3.us-east-1.amazonaws.com/oceanmetrics.io-public/gazetteer/";

describe("collectionJsonUrls: the canonical host first, the data base after it when it differs", () => {
  it("one by default (the data base is the storage host since catalog 0.6.0); both, in that order, on another data base", () => {
    expect(GAZETTEER_BUCKET_BASE).toBe(GAZETTEER_ROOT);
    expect(collectionJsonUrls("gebco_undersea")).toEqual([
      `${GAZETTEER_ROOT}gebco_undersea/collection.json`,
    ]);
    expect(collectionJsonUrls("gebco_undersea", S3_GAZETTEER)).toEqual([
      `${GAZETTEER_ROOT}gebco_undersea/collection.json`,
      `${S3_GAZETTEER}gebco_undersea/collection.json`,
    ]);
    expect(collectionJsonUrls("x", GAZETTEER_ROOT)).toEqual([`${GAZETTEER_ROOT}x/collection.json`]);
  });
});

describe("layerInfoModel from the published gebco_undersea collection", () => {
  const m = layerInfoModel({
    slug: "gebco_undersea",
    manifest: manifestRow(),
    collection: fromCanonical,
  });
  it("title, description, count, place type, version and updated come from the collection", () => {
    expect(m).toMatchObject({
      slug: "gebco_undersea",
      title: "GEBCO Gazetteer of Undersea Feature Names",
      partial: false,
      featureCount: 5412,
      placeType: "undersea_feature",
      version: "1.0.1",
      updated: "2026-10-08T17:36:01Z",
      status: null,
    });
    expect(m.description).toMatch(/^Names, generic feature types and geometries of seafloor/);
  });
  it("license: the id with its wording and the collection's own license link", () => {
    expect(m.license).toMatchObject({
      id: "CC-BY-4.0",
      name: "Creative Commons Attribution 4.0 International",
      known: true,
    });
    expect(m.license?.links).toEqual([
      expect.objectContaining({
        href: "https://www.gebco.net/data-products/undersea-feature-names",
      }),
    ]);
  });
  it("the attribution is the collection's `gazetteer:attribution`", () => {
    expect(m.attribution).toMatch(/^IHO-IOC GEBCO Gazetteer of Undersea Feature Names/);
    expect(m.attribution).toMatch(/Processed by Ocean Metrics\.$/);
  });
  it("providers (name, roles, link) and the `via` links (upstream publisher, source layers)", () => {
    expect(m.providers.map((p) => p.name)).toEqual([
      "IHO-IOC GEBCO Sub-Committee on Undersea Feature Names (SCUFN)",
      "IHO Data Centre for Digital Bathymetry (NOAA NCEI)",
      "Ocean Metrics LLC",
    ]);
    expect(m.providers[0]).toMatchObject({ roles: ["producer", "licensor"] });
    expect(m.via.map((l) => l.label)).toEqual([
      "Upstream publisher page",
      "Source layer (polygon)",
      "Source layer (line)",
      "Source layer (point)",
    ]);
  });
  it("the README resolves against the collection's own URL; the links name the places page and the data files", () => {
    expect(m.readmeUrl).toBe(`${GAZETTEER_ROOT}gebco_undersea/README.md`);
    expect(m.links).toEqual([
      {
        label: "Layer page on oceanmetrics.io/places",
        href: "https://oceanmetrics.io/places/l/gebco_undersea",
      },
      { label: "places.parquet", href: `${GAZETTEER_ROOT}gebco_undersea/places.parquet` },
      { label: "places.pmtiles", href: `${GAZETTEER_ROOT}gebco_undersea/places.pmtiles` },
    ]);
    expect(placesLayerPage("a b")).toBe("https://oceanmetrics.io/places/l/a%20b");
  });
  it("a collection read from the bucket URL still links the CANONICAL data files", () => {
    const viaBucket = layerInfoModel({
      slug: "gebco_undersea",
      manifest: null,
      collection: { json: GEBCO, url: `${GAZETTEER_BUCKET_BASE}gebco_undersea/collection.json` },
    });
    expect(viaBucket.readmeUrl).toBe(`${GAZETTEER_BUCKET_BASE}gebco_undersea/README.md`); // fetchable
    expect(viaBucket.links[1].href).toBe(`${GAZETTEER_ROOT}gebco_undersea/places.parquet`); // public
  });
});

describe("status", () => {
  it("`gazetteer:status` of a collection: value, date, source and note", () => {
    const m = layerInfoModel({
      slug: "boem_wind_planning_rescinded",
      manifest: null,
      collection: {
        json: RESCINDED,
        url: `${GAZETTEER_ROOT}boem_wind_planning_rescinded/collection.json`,
      },
    });
    expect(m.status).toMatchObject({
      value: "rescinded",
      date: "2025-07-30",
      source: expect.stringContaining("boem.gov"),
    });
    expect(m.license).toMatchObject({ id: "CC-PDDC", known: true });
    expect(m.version).toBe("1.1.0"); // `gazetteer:provenance.version`
  });
  it("without the collection, the manifest's own status (underscores read as spaces)", () => {
    const m = layerInfoModel({
      slug: "x",
      manifest: manifestRow({
        status: { value: "draft_proposed", date: "2025-11-20", source: "https://s.test/" },
      }),
      collection: null,
    });
    expect(m.status).toEqual({
      value: "draft proposed",
      date: "2025-11-20",
      source: "https://s.test/",
      note: null,
    });
  });
});

describe("a collection that could not be loaded: the manifest's own fields, said to be partial", () => {
  const m = layerInfoModel({ slug: "gebco_undersea", manifest: manifestRow(), collection: null });
  it("title, feature count, place type, version, updated, license and attribution from layers.json", () => {
    expect(m).toMatchObject({
      partial: true,
      title: "GEBCO undersea features (manifest)",
      description: null,
      featureCount: 5412,
      placeType: "undersea_feature",
      version: "1.0.1",
      updated: "2026-10-08",
      attribution: "GEBCO credit (manifest). Processed by Ocean Metrics.",
      readmeUrl: null,
      providers: [],
      via: [],
    });
    expect(m.license).toMatchObject({ id: "CC-BY-4.0" });
    expect(m.license?.links).toEqual([
      {
        label: "https://creativecommons.org/licenses/by/4.0/",
        href: "https://creativecommons.org/licenses/by/4.0/",
      },
    ]);
  });
  it("the places page and the conventional data files are still linked", () => {
    expect(m.links.map((l) => l.href)).toEqual([
      "https://oceanmetrics.io/places/l/gebco_undersea",
      `${GAZETTEER_ROOT}gebco_undersea/places.parquet`,
      `${GAZETTEER_ROOT}gebco_undersea/places.pmtiles`,
    ]);
  });
  it("no manifest row and no collection: just the slug, never a throw", () => {
    const bare = layerInfoModel({ slug: "zzz", manifest: null, collection: null });
    expect(bare).toMatchObject({ title: "zzz", partial: true, license: null, featureCount: null });
  });
});

describe("loadLayerCollection: fall back from the canonical host to the bucket URL, once per slug", () => {
  beforeEach(() => clearLayerCollectionCache());
  const okJson = (j: unknown) => new Response(JSON.stringify(j), { status: 200 });
  const canonical = `${GAZETTEER_ROOT}gebco_undersea/collection.json`;
  const bucket = `${S3_GAZETTEER}gebco_undersea/collection.json`;

  it("the canonical URL answering is used, and cached per slug", async () => {
    const urls: string[] = [];
    const f = (async (u: RequestInfo | URL) => {
      urls.push(String(u));
      return okJson(GEBCO);
    }) as typeof fetch;
    const a = await loadLayerCollection("gebco_undersea", f);
    expect(a?.url).toBe(canonical);
    await loadLayerCollection("gebco_undersea", f);
    expect(urls).toEqual([canonical]);
  });
  it("a canonical host that fails (a network error) falls back to a data base on another host", async () => {
    const urls: string[] = [];
    const f = (async (u: RequestInfo | URL) => {
      urls.push(String(u));
      if (String(u) === canonical) throw new TypeError("Failed to fetch");
      return okJson(GEBCO);
    }) as typeof fetch;
    const got = await loadLayerCollection("gebco_undersea", f, S3_GAZETTEER);
    expect(got?.url).toBe(bucket);
    expect(urls).toEqual([canonical, bucket]);
  });
  it("neither answering (or not a Collection): null, and a retry asks again", async () => {
    let calls = 0;
    const f = (async () => {
      calls++;
      return new Response("nope", { status: 404 });
    }) as typeof fetch;
    expect(await loadLayerCollection("gebco_undersea", f, S3_GAZETTEER)).toBeNull();
    expect(calls).toBe(2);
    expect(await loadLayerCollection("gebco_undersea", f, S3_GAZETTEER)).toBeNull();
    expect(calls).toBe(4);
    const notStac = (async () => okJson({ hello: 1 })) as typeof fetch;
    expect(await loadLayerCollection("other", notStac)).toBeNull();
  });
});
