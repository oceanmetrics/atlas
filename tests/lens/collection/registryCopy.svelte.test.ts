// The registry source (`lens/collection/registry.svelte.ts`) with registry v2 rows: the Item of a row with a
// `cog_3857_url` is drawn from the copy once the shared side table's row for the original's content hash has been
// read (pending -> nothing drawn, never titiler), a row without the column asks the table nothing and stays on
// titiler, and a slow answer for a taxon the user has left is dropped. The real runes state, a stub table reader.
import { flushSync } from "svelte";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import {
  createRegistrySource,
  type RegistrySource,
} from "../../../src/lens/collection/registry.svelte";
import { rowsFromRecords } from "../../../src/lib/catalog/registry/rows";
import { rasterChoiceOf } from "../../../src/lib/raster/cog";
import type { CollectionEntry } from "../../../src/lib/catalog/load";
import { rowFromRecord as sideRow, type Cog3857Row } from "../../../src/lib/release/cog3857";
import {
  LEATHERBACK_RECORD,
  UNMATCHED_RECORD,
  nativeCollection,
} from "../../catalog/registry/support";

const { createSelStore } = await import("../../../src/lib/state/sel.svelte");

const S3 = "https://s3.us-east-1.amazonaws.com/oceanmetrics.io-public/marine-atlas/";
const HASH = "40ff91f6bd61a934";
const COPY = {
  ...LEATHERBACK_RECORD,
  cog_url: `${S3}native/am/${HASH}.tif`,
  cog_3857_url: `${S3}v7/cog_3857/native/am/${HASH}_3857.tif`,
};
const PLAIN = { ...UNMATCHED_RECORD, cog_3857_url: null };
const SIDE: Cog3857Row = sideRow({
  content_hash: HASH,
  cog_3857_key: `marine-atlas/v7/cog_3857/native/am/${HASH}_3857.tif`,
  zoom_min: 0,
  zoom_max: 2,
  bands: 1,
  data_type: ["uint8"],
  nodata: [0],
  statistics: [{ minimum: 1, maximum: 100 }],
  histogram: [
    { count: 32, min: 1, max: 100, buckets: Array.from({ length: 32 }, (_, i) => i + 1) },
  ],
})!;

const entry: CollectionEntry = {
  id: "aquamaps_native",
  title: "AquaMaps",
  href: "https://x.test/aquamaps_native/collection.json",
  group: "oceanmetrics",
  external: false,
  status: "ok",
  collection: nativeCollection(),
  error: null,
};

let src: RegistrySource;
let selStore: ReturnType<typeof createSelStore>;
let stop: () => void;
let answers: Map<string, (r: Cog3857Row | null) => void>;
let readSide: Mock<(contentHash: string) => Promise<Cog3857Row | null>>;

const settle = (check: () => void) =>
  vi.waitFor(() => {
    flushSync();
    check();
  });
const drawnAsset = () => src.items[0]?.assets.cog_3857;

beforeEach(async () => {
  vi.stubGlobal("history", { state: null, replaceState: () => undefined });
  answers = new Map();
  readSide = vi.fn(
    (hash: string) => new Promise<Cog3857Row | null>((res) => answers.set(hash, res)),
  );
  selStore = createSelStore({
    search: `?c=aquamaps_native&sp=${COPY.sp_key}`,
    hash: "",
    pathname: "/",
  });
  stop = $effect.root(() => {
    src = createRegistrySource({
      selStore,
      entry: () => entry,
      readRows: async () => ({ ok: true, value: rowsFromRecords([COPY, PLAIN]) }),
      readSide,
      fetchJson: async () => null,
      whenIdle: () => undefined,
    });
  });
  await settle(() => expect(src.items.length).toBe(1));
});
afterEach(() => {
  stop();
  vi.unstubAllGlobals();
});

describe("a registry v2 row's copy numbers", () => {
  it("are read by the original's content hash; until then the copy is pending (browser-drawn, nothing drawn)", () => {
    expect(readSide).toHaveBeenCalledTimes(1);
    expect(readSide).toHaveBeenCalledWith(HASH);
    expect(drawnAsset()?.["atlas:stats_pending"]).toBe(true);
    expect(rasterChoiceOf(src.items[0]).kind).toBe("cog");
  });
  it("settle the Item: statistics, histogram and zoom on the copy, the pending marker gone", async () => {
    answers.get(HASH)!(SIDE);
    await settle(() => expect(drawnAsset()?.["atlas:stats_pending"]).toBeUndefined());
    expect(drawnAsset()).toMatchObject({ "atlas:zoom": [0, 2] });
    expect((drawnAsset()?.bands as object[])[0]).toMatchObject({
      statistics: { minimum: 1, maximum: 100 },
    });
  });
  it("a table with no row settles the Item too (drawn from the copy, no numbers)", async () => {
    answers.get(HASH)!(null);
    await settle(() => expect(drawnAsset()?.["atlas:stats_pending"]).toBeUndefined());
    expect((drawnAsset()?.bands as { histogram?: unknown }[])[0].histogram).toBeUndefined();
  });
  it("a reader that rejects settles it as well (never stuck pending)", async () => {
    stop();
    readSide.mockImplementation(async () => {
      throw new Error("offline");
    });
    stop = $effect.root(() => {
      src = createRegistrySource({
        selStore,
        entry: () => entry,
        readRows: async () => ({ ok: true, value: rowsFromRecords([COPY, PLAIN]) }),
        readSide,
        fetchJson: async () => null,
        whenIdle: () => undefined,
      });
    });
    await settle(() => expect(src.items.length).toBe(1));
    await settle(() => expect(drawnAsset()?.["atlas:stats_pending"]).toBeUndefined());
    expect(rasterChoiceOf(src.items[0]).kind).toBe("cog");
  });
  it("regression: a slow answer for the taxon the user left does not settle the next one", async () => {
    selStore.set({ sp: PLAIN.sp_key });
    await settle(() => expect(src.taxonKey).toBe(PLAIN.sp_key));
    answers.get(HASH)!(SIDE); // the first taxon's late answer
    await Promise.resolve();
    flushSync();
    expect(src.items[0].assets.cog_3857).toBeUndefined();
    expect(rasterChoiceOf(src.items[0]).kind).toBe("titiler");
  });
  it("a row without the column asks the table nothing and stays on titiler", async () => {
    readSide.mockClear();
    selStore.set({ sp: PLAIN.sp_key });
    await settle(() => expect(src.taxonKey).toBe(PLAIN.sp_key));
    expect(readSide).not.toHaveBeenCalled();
    expect(rasterChoiceOf(src.items[0]).kind).toBe("titiler");
  });
});
