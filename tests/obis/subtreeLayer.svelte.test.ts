// The WoRMS subtree wired in the real runes-based H3 layer (src/lens/collection/h3/layer.svelte.ts; obis-hex parity
// rows 7, 10, 11): `taxon=aphia:<id>` that is no head (and a `<rank>:<name>` with no layer) asks WoRMS for the
// record, runs the subtree (a stubbed runner here: what it computes is subtree.test.ts's) and draws its cells, with
// the sentence chip, the line, the legend of the computed cells, the coverage, the refusal and the status. The map
// package's worker setup and maplibre-gl are stubbed (no WebGL in Node).
import { readFileSync } from "node:fs";
import { flushSync } from "svelte";
import { describe, expect, it, vi } from "vitest";

vi.mock("maplibre-gl", () => ({
  addProtocol: () => undefined,
  importScriptInWorkers: () => undefined,
  setWorkerUrl: () => undefined,
}));
vi.mock("maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url", () => ({ default: "worker.mjs" }));
vi.mock("@oceanmetrics/map/h3-worker?worker&url", () => ({ default: "h3worker.mjs" }));
vi.mock("@oceanmetrics/map", async (orig) => ({
  ...(await orig<typeof import("@oceanmetrics/map")>()),
  setupMapLibre: async () => undefined,
}));

const { createH3Layer } = await import("../../src/lens/collection/h3/layer.svelte");
const { createSelStore } = await import("../../src/lib/state/sel.svelte");
const { collection, item, spec } = await import("./support");
import type { SubtreeOutcome, SubtreeRequest } from "../../src/lens/collection/h3/subtreeRun";

const fx = (f: string) => readFileSync(`tests/fixtures/obis_h3/subtree/${f}`, "utf8");
const HEADS = {
  heads: [
    {
      aphiaid: 2,
      name: "Animalia",
      rank: "Kingdom",
      served_by: "head",
      layer: "taxon/rank=kingdom/taxon=Animalia",
    },
  ],
};
const TAXA = [
  {
    kind: "taxon",
    rank: "class",
    taxon: "Aves",
    label: "Aves",
    n: 27e6,
    urlPath: "taxon/rank=class/taxon=Aves",
  },
  {
    kind: "taxon",
    rank: "kingdom",
    taxon: "Animalia",
    label: "Animalia",
    n: 1e8,
    urlPath: "taxon/rank=kingdom/taxon=Animalia",
  },
];
const READY: SubtreeOutcome = {
  kind: "ready",
  href: "blob:test/cells",
  parquetBytes: 1000,
  cells: 714,
  domains: {
    es: { p02: 1, p98: 13, min: 1, max: 20, cells: 459 },
    sp: { p02: 1, p98: 30, min: 1, max: 60, cells: 714 },
    shannon: { p02: 0, p98: 2.5, min: 0, max: 3, cells: 714 },
    simpson: { p02: 0.1, p98: 1, min: 0.05, max: 1, cells: 714 },
    n: { p02: 1, p98: 50000, min: 1, max: 90000, cells: 714 },
  },
  read: {
    bytes: 276067,
    filesBytes: 276067,
    files: 1,
    lookupBytes: 4086019,
    requests: 3,
    ms: 1487,
  },
  taxa: new Set([137092]),
  records: 2339779,
  classes: ["Mammalia"],
  sql: "SELECT 1",
};

function layerAt(search: string, runner: (r: SubtreeRequest) => Promise<SubtreeOutcome>) {
  vi.stubGlobal("history", { state: null, replaceState: () => undefined });
  vi.stubGlobal("document", {
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    querySelector: () => null,
  });
  const selStore = createSelStore({ search, hash: "", pathname: "/" });
  const coll = collection();
  const asked: string[] = [];
  const layer = createH3Layer({
    selStore,
    mapHandle: () => undefined,
    entry: () => ({
      id: "obis_h3",
      title: "OBIS",
      href: "x",
      group: "obis" as never,
      external: true,
      status: "ok",
      collection: coll,
      error: null,
    }),
    item: () => item("all"),
    items: () => [item("all")],
    spec: () => spec(),
    readTaxa: async () => TAXA,
    fetchJson: async (u) => (u.endsWith("heads.json") ? HEADS : {}),
    wormsFetch: async (u) => {
      asked.push(u);
      if (u.includes("AphiaRecordByAphiaID/2688"))
        return new Response(fx("worms_record_2688.json"));
      if (u.includes("AphiaRecordsByName/Cetacea"))
        return new Response(fx("worms_name_cetacea.json"));
      return new Response(null, { status: 204 });
    },
    runSubtree: runner,
    app: "Atlas test",
  });
  return { layer, selStore, asked };
}

const settle = async () => {
  for (let i = 0; i < 8; i++) {
    flushSync();
    await new Promise((r) => setTimeout(r, 0));
  }
  flushSync();
};

describe("taxon=aphia:<id> that is no head opens the subtree (the case table's aphia cases no longer say 'heads only')", () => {
  it("WoRMS's record, the runner asked at the zoom's resolution (the map at zoom 2: res 1, rolled up from res 3), the cells drawn with their own legend and words", async () => {
    const asks: SubtreeRequest[] = [];
    const { layer, asked } = layerAt(
      "?c=obis_h3&i=all&dim.indicator=es&map=-150,30,2&taxon=aphia:2688",
      async (r) => {
        asks.push(r);
        return READY;
      },
    );
    await settle();
    expect(asked[0]).toContain("AphiaRecordByAphiaID/2688");
    expect(asks).toHaveLength(1);
    expect(asks[0]).toMatchObject({
      aphiaid: 2688,
      name: "Cetacea",
      res: 1,
      tableRes: 3,
      decade: null,
      ranges: null,
    });
    expect(layer.taxonNote).toBeNull();
    expect(layer.target?.kind).toBe("subtree");
    expect(layer.target?.collection["h3:layout"].template).toBe("blob:test/cells");
    expect(layer.parts?.taxon).toEqual({
      label: "Whales and dolphins",
      qual: "(infraorder Cetacea, WoRMS)",
      control: "taxon",
    });
    expect(layer.subtree).toMatchObject({
      phase: "ready",
      aphiaid: 2688,
      name: "Cetacea",
      line: "subtree of Cetacea (computed in the browser from the species table, res ≤ 5)",
      taxonLine: "Cetacea Brisson, 1762 · infraorder · accepted · 2,339,779 records",
      wormsUrl: "https://www.marinespecies.org/aphia.php?p=taxdetails&id=2688",
      message: null,
    });
    expect(layer.subtree?.readLine).toContain("Read 0.26 MB of the species table (1 file)");
    expect(layer.coverage).toBe("459 of 714 hexagons of the subtree have ≥ 50 records");
    expect(layer.legend?.subtitle).toContain("subtree p02–p98");
    expect(layer.legend?.stops[0].value).toBe(1);
    expect(layer.legend?.stops.at(-1)?.value).toBe(13);
    expect(layer.status).toBeNull();
    expect(layer.reproduce).toContain("SELECT 1");
    layer.destroy();
  });

  it("a rank:name with no layer is resolved by WoRMS to its AphiaID", async () => {
    const asks: SubtreeRequest[] = [];
    const { layer } = layerAt(
      "?c=obis_h3&i=all&dim.indicator=sp&res=3&map=-150,30,4&taxon=infraorder:Cetacea",
      async (r) => {
        asks.push(r);
        return READY;
      },
    );
    await settle();
    expect(asks[0]).toMatchObject({ aphiaid: 2688, res: 3, tableRes: 3 });
    expect(layer.subtree?.name).toBe("Cetacea");
    layer.destroy();
  });

  it("a head stays the release's layer: no WoRMS, no runner", async () => {
    const runner = vi.fn(async () => READY);
    const { layer, asked } = layerAt("?c=obis_h3&i=all&taxon=aphia:2", runner);
    await settle();
    expect(runner).not.toHaveBeenCalled();
    expect(asked).toEqual([]);
    expect(layer.subtree).toBeNull();
    expect(layer.taxon?.taxon).toBe("Animalia");
    layer.destroy();
  });

  it("a pin past the cap is res 5 with its note; a decade is computed from the decade table at res 4 at most", async () => {
    const asks: SubtreeRequest[] = [];
    const { layer } = layerAt(
      "?c=obis_h3&i=all&res=7&map=-122,36.8,9&taxon=aphia:2688",
      async (r) => {
        asks.push(r);
        return READY;
      },
    );
    await settle();
    expect(asks[0]).toMatchObject({ res: 5, tableRes: 5 });
    expect(layer.notes.join(" ")).toContain("res 7 is shown as res 5");
    layer.destroy();
    const asks2: SubtreeRequest[] = [];
    const l2 = layerAt(
      "?c=obis_h3&i=all&res=5&dim.period=1990s&map=-70,40,4&taxon=aphia:2688",
      async (r) => {
        asks2.push(r);
        return READY;
      },
    );
    await settle();
    expect(asks2[0]).toMatchObject({ res: 4, tableRes: 4, decade: "1990" });
    l2.layer.destroy();
  });

  it("over the cap: nothing is drawn, the status and the subtree say the byte estimate", async () => {
    const line =
      "The subtree of Cetacea at res 5 would read 30.0 MB of the species table (2 files), over the 25.0 MB the page reads at once: pin res 4 (12.00 MB) or coarser.";
    const { layer } = layerAt("?c=obis_h3&i=all&res=3&taxon=aphia:2688", async () => ({
      kind: "refused",
      line,
      bytes: 30 * 1024 * 1024,
      read: { bytes: 0, filesBytes: 0, files: 2, lookupBytes: 0, requests: 2, ms: 10 },
    }));
    await settle();
    expect(layer.target).toBeNull();
    expect(layer.status).toBe(line);
    expect(layer.subtree?.phase).toBe("refused");
    expect(layer.subtree?.message).toBe(line);
    layer.destroy();
  });

  it("while it computes the status says so; a failure says why", async () => {
    let fail!: (e: Error) => void;
    const { layer } = layerAt(
      "?c=obis_h3&i=all&res=3&taxon=aphia:2688",
      () => new Promise((_, rej) => (fail = rej)),
    );
    await settle();
    expect(layer.status).toBe("Computing the subtree of Cetacea in the browser…");
    fail(new Error("data engine unavailable: boom"));
    await settle();
    expect(layer.status).toBe("The subtree could not be computed: data engine unavailable: boom");
    layer.destroy();
  });

  it("setAphia: a pick of the WoRMS search writes taxon=aphia:<id> on the all-taxa item, a decade kept, a year dropped", async () => {
    const { layer, selStore } = layerAt("?c=obis_h3&i=fish&dim.period=2015", async () => READY);
    await settle();
    layer.setAphia(137092);
    expect(selStore.sel.taxon).toBe("aphia:137092");
    expect(selStore.sel.i).toBe("all");
    expect(selStore.sel.dim?.period).toBeUndefined();
    selStore.set({ dim: { period: "1990s" } });
    layer.setAphia(2688);
    expect(selStore.sel.dim?.period).toBe("1990s");
    layer.destroy();
  });
});
