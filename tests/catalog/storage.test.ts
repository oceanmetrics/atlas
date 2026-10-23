// The storage rule in the app (src/lib/catalog/storage.ts over @oceanmetrics/catalog/storage): the release tables
// the Species lens reads name COGs on the S3 host; each is moved onto the build's storage host at read (decision D7:
// rebased at read, never rewritten), every other host untouched. The build's host is chosen by VITE_OM_STORAGE, so
// the cases run under the default (the storage host since catalog 0.6.0) and under path-style S3 (the rollback), a
// fresh module each.
import { afterEach, describe, expect, it, vi } from "vitest";

const S3 = "https://s3.us-east-1.amazonaws.com/oceanmetrics.io-public";
const S3_VIRTUAL = "https://oceanmetrics.io-public.s3.amazonaws.com";
const STORAGE_HOST = "https://storage.oceanmetrics.io";
const KEY = "marine-atlas/v8/cog/am/abcd.tif";
const TITILER = "https://titiler.marinesensitivity.org/cog/tiles/WebMercatorQuad/{z}/{x}/{y}?url=x";
const MARINE_REGIONS = "https://www.marineregions.org/rest/getGazetteerRecordByMRGID.json/8430/";
const MST_FILE = "https://file.marinesensitivity.org/stac/v8/nc/atlantic.tif";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function load(setting?: string) {
  vi.resetModules();
  if (setting !== undefined) vi.stubEnv("VITE_OM_STORAGE", setting);
  const storage = await import("../../src/lib/catalog/storage");
  const rows = await import("../../src/lib/catalog/registry/rows");
  const manifest = await import("../../src/lib/catalog/mst/manifest");
  return { ...storage, ...rows, ...manifest };
}

describe("onStorage: a url on a storage host moves onto the build's storage host", () => {
  it("default build: both S3 forms read the storage host (catalog 0.6.0, the cutover of 2026-10-23)", async () => {
    const { STORAGE, onStorage } = await load();
    expect(STORAGE).toBe(STORAGE_HOST);
    expect(onStorage(`${S3}/${KEY}`)).toBe(`${STORAGE_HOST}/${KEY}`);
    expect(onStorage(`${S3_VIRTUAL}/${KEY}`)).toBe(`${STORAGE_HOST}/${KEY}`);
    expect(onStorage(`${STORAGE_HOST}/${KEY}`)).toBe(`${STORAGE_HOST}/${KEY}`);
  });

  it("VITE_OM_STORAGE=s3 (the rollback): the storage host and the virtual-hosted form read path-style S3", async () => {
    const { STORAGE, onStorage } = await load("s3");
    expect(STORAGE).toBe(S3);
    expect(onStorage(`${STORAGE_HOST}/${KEY}`)).toBe(`${S3}/${KEY}`);
    expect(onStorage(`${S3_VIRTUAL}/${KEY}`)).toBe(`${S3}/${KEY}`);
  });

  it("VITE_OM_STORAGE=storage: a path-style S3 url reads storage.oceanmetrics.io, path and query kept", async () => {
    const { STORAGE, onStorage } = await load("storage");
    expect(STORAGE).toBe(STORAGE_HOST);
    expect(onStorage(`${S3}/${KEY}?x=1`)).toBe(`${STORAGE_HOST}/${KEY}?x=1`);
  });

  it("REGRESSION: a titiler, MST file or Marine Regions url is never touched, on either host", async () => {
    for (const setting of [undefined, "storage"]) {
      const { onStorage } = await load(setting);
      for (const other of [TITILER, MARINE_REGIONS, MST_FILE]) expect(onStorage(other)).toBe(other);
    }
  });

  it("a host that only begins with a storage host's name stays", async () => {
    const { onStorage } = await load("storage");
    const lookalike = `${STORAGE_HOST}.example.org/${KEY}`;
    expect(onStorage(lookalike)).toBe(lookalike);
  });
});

describe("the species lens's release COG table (registry rows): cog_url and cog_url_005 go through onStorage", () => {
  const rec = (cog_url: string, cog_url_005: string | null) => ({
    sp_key: "Rep-1",
    scientific_name: "Dermochelys coriacea",
    cog_url,
    cog_url_005,
  });

  it("an S3 cog_url becomes the chosen store's url, the 0.05 one too", async () => {
    const { rowFromRecord } = await load("storage");
    const row = rowFromRecord(rec(`${S3}/${KEY}`, `${S3}/marine-atlas/v8/cog005/abcd.tif`));
    expect(row?.cogUrl).toBe(`${STORAGE_HOST}/${KEY}`);
    expect(row?.cogUrl005).toBe(`${STORAGE_HOST}/marine-atlas/v8/cog005/abcd.tif`);
  });

  it("a titiler or Marine Regions cog_url is read as written", async () => {
    const { rowFromRecord } = await load("storage");
    expect(rowFromRecord(rec(TITILER, MARINE_REGIONS))).toMatchObject({
      cogUrl: TITILER,
      cogUrl005: MARINE_REGIONS,
    });
  });

  it("an empty cog_url_005 stays null and an empty cog_url still drops the row", async () => {
    const { rowFromRecord } = await load("storage");
    expect(rowFromRecord(rec(`${S3}/${KEY}`, "  "))?.cogUrl005).toBeNull();
    expect(rowFromRecord(rec("", null))).toBeNull();
  });
});

describe("the MST gm/nc manifests: a model's cog url goes through onStorage", () => {
  it("an S3 url reads the chosen store; a file.marinesensitivity.org url stays", async () => {
    const { manifestItems } = await load("storage");
    const m = {
      schema: 1,
      collection: "msens-v8-gm",
      generated: "2026-10-14",
      taxon_dim: "species",
      dims: [{ key: "species", title: "Species", values: [{ value: "A", label: "A" }] }],
      taxa: { A: {} },
      unit: "n",
      models: [
        ["A", `${S3}/${KEY}`, 1],
        ["A", MST_FILE, 2],
      ],
    };
    const items = manifestItems(m as never);
    const hrefs = items.map((i) => Object.values(i.assets)[0].href);
    expect(hrefs).toEqual([`${STORAGE_HOST}/${KEY}`, MST_FILE]);
  });
});
