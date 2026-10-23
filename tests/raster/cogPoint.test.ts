// The browser point read (`raster/cogPoint.ts`): a tiny real COG (tests/fixtures/cog/tiny_eov_4326.tif, made by
// make_tiny_cog.py: 9 uint8 bands, nodata 255, EPSG:4326) served by a local static server that answers HTTP Range
// with 206, read through @oceanmetrics/map `pointValue` (geotiff.js), the read the lens makes on a click.
import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { flowerPetalsFor } from "../../src/lib/catalog/flower";
import { loadCatalog, loadItems, type CollectionEntry } from "../../src/lib/catalog/load";
import type { StacItem } from "../../src/lib/catalog/types";
import { createCogValueSource } from "../../src/lib/raster/cogPoint";
import { FIXTURE_BASE, fakeFetch } from "../catalog/support";

const TIF = readFileSync(join(__dirname, "../fixtures/cog/tiny_eov_4326.tif"));

let server: Server;
let base = "";
const log: { range: string | null; status: number }[] = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    const m = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? "");
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Content-Type", "image/tiff");
    if (!m) {
      log.push({ range: null, status: 200 });
      res.writeHead(200, { "Content-Length": TIF.length });
      res.end(TIF);
      return;
    }
    const start = Number(m[1]);
    const end = Math.min(m[2] ? Number(m[2]) : TIF.length - 1, TIF.length - 1);
    log.push({ range: req.headers.range ?? null, status: 206 });
    res.writeHead(206, {
      "Content-Range": `bytes ${start}-${end}/${TIF.length}`,
      "Content-Length": end - start + 1,
    });
    res.end(TIF.subarray(start, end + 1));
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((ok) => server.close(() => ok())));

const req = (file: string, lon: number, lat: number, bidx?: number) => ({
  domain: "collection" as const,
  lon,
  lat,
  cogUrl: `${base}/${file}`,
  ...(bidx === undefined ? {} : { bidx }),
});

describe("createCogValueSource: the pixel from the 4326 original over HTTP Range", () => {
  it("reads every band of the pixel in one call, nodata as null, with Range requests answered 206", async () => {
    log.length = 0;
    const pv = await createCogValueSource().pointValues(req("a.tif", 0.75, 1.25));
    expect(pv).toEqual({ values: [50, 80, 60, 40, 20, null, null, 50, 5] });
    expect(log.length).toBeGreaterThan(0);
    expect(log.every((r) => r.status === 206 && r.range?.startsWith("bytes="))).toBe(true);
  });

  it("pointValue answers the asked band (1-based), band 1 by default", async () => {
    const vs = createCogValueSource();
    // pixel (col 3, row 2): band b holds b * 10 + 3
    expect(await vs.pointValue(req("b.tif", 1.75, 0.75))).toBe(13);
    expect(await vs.pointValue(req("b.tif", 1.75, 0.75, 4))).toBe(43);
  });

  it("outside the file, a failed read and an aborted read all answer null", async () => {
    const vs = createCogValueSource();
    expect(await vs.pointValues(req("c.tif", 10, 10))).toBeNull();
    const failing = createCogValueSource(() => Promise.reject(new Error("network")));
    expect(await failing.pointValues(req("d.tif", 0.75, 1.25))).toBeNull();
    const ctrl = new AbortController();
    ctrl.abort();
    expect(await vs.pointValues({ ...req("e.tif", 0.75, 1.25), signal: ctrl.signal })).toBeNull();
  });

  it("keeps point.ts's rule: only species and collection values", async () => {
    const bad = { ...req("f.tif", 0.75, 1.25), domain: "scores" } as unknown as Parameters<
      ReturnType<typeof createCogValueSource>["pointValues"]
    >[0];
    await expect(createCogValueSource().pointValues(bad)).rejects.toThrow(/Parquet/);
  });
});

describe("the flower from one browser read", () => {
  let entry: CollectionEntry;
  let items: StacItem[];
  beforeAll(async () => {
    const o = { base: FIXTURE_BASE, fetchImpl: fakeFetch().fetch, cache: new Map() };
    const cat = await loadCatalog(o);
    if (!cat.ok) throw new Error("catalog fixture");
    entry = cat.value.entries.find((e) => e.id === "aquamaps_eov")!;
    const res = await loadItems(entry, o);
    if (!res.ok) throw new Error("items fixture");
    items = res.value.items;
  });

  it("all 9 bands in ONE pointValues call give every petal and the centre", async () => {
    let calls = 0;
    const vs = createCogValueSource(async (url, ll) => {
      calls++;
      const { pointValue } = await import("@oceanmetrics/map");
      return pointValue(url, ll);
    });
    const pv = await vs.pointValues(req("g.tif", 0.75, 1.25));
    expect(calls).toBe(1);
    const v = flowerPetalsFor(entry, items, { eov: "all", metric: "risk" }, pv)!;
    expect(v.center).toBe(50);
    expect(Object.fromEntries(v.components.map((c) => [c.key, c.score]))).toEqual({
      fish: 80,
      hardCorals: 60,
      mangroves: 40,
      marineMammals: 20,
      seabirds: null,
      seagrasses: null,
      seaTurtles: 50,
    });
  });
});
