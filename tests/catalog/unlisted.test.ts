// WP11 item 6: `?collection=<https url of a collection.json>` loads ONE extra collection into the picker
// as "unlisted" (a restricted collection previewed through a private link before it is public).
import { describe, expect, it } from "vitest";
import {
  GROUP_LABEL,
  GROUP_ORDER,
  loadCatalog,
  loadItems,
  unlistedEntryId,
  type CatalogCache,
} from "../../src/lib/catalog/load";
import { validateCollectionUrl } from "../../src/lib/catalog/base";
import { formatSel, parseSel } from "../../src/lib/state/codec";
import { DEFAULT_SEL } from "../../src/lib/state/types";
import { buildPageLocation } from "../../src/lib/analytics/pageLocation";
import { FIXTURE_BASE, fakeFetch, jsonResponse } from "./support";

const PRIVATE = "https://private.example/biotrack/species/collection.json";
const collection = {
  type: "Collection",
  stac_version: "1.1.0",
  id: "biotrack_species_preview",
  title: "BioTrack per-species (preview)",
  description: "x",
  license: "proprietary",
  extent: {
    spatial: { bbox: [[-100, 20, -60, 50]] },
    temporal: { interval: [[null, null]] },
  },
  links: [
    { rel: "item", href: "./items/a.json" },
    { rel: "item", href: "./items/b.json" },
  ],
};
const item = (id: string) => ({
  type: "Feature",
  stac_version: "1.1.0",
  id,
  geometry: null,
  properties: { datetime: null, title: id },
  assets: { values: { href: "../values.parquet" } },
  links: [],
});
const PRIVATE_FILES: Record<string, unknown> = {
  [PRIVATE]: collection,
  "https://private.example/biotrack/species/items/a.json": item("a"),
  "https://private.example/biotrack/species/items/b.json": item("b"),
};
const serve = (url: string) => {
  const hit = PRIVATE_FILES[url];
  return hit ? jsonResponse(hit) : undefined;
};
const load = (extra?: readonly string[], serveFn = serve) => {
  const f = fakeFetch(serveFn);
  const cache: CatalogCache = new Map();
  return {
    f,
    p: loadCatalog({
      base: FIXTURE_BASE,
      fetchImpl: f.fetch,
      cache,
      ...(extra ? { extraCollections: extra } : {}),
    }),
    cache,
  };
};

describe("an unlisted collection is in the picker only when the param is present", () => {
  it("without `?collection=` the catalog is exactly its own listing", async () => {
    const res = await load().p;
    if (!res.ok) throw new Error("catalog failed");
    expect(res.value.entries.some((e) => e.group === "unlisted")).toBe(false);
    expect(unlistedEntryId(res.value.entries)).toBeNull();
  });
  it("with it, the collection is an extra entry marked unlisted, after the catalog's own", async () => {
    const res = await load([PRIVATE]).p;
    if (!res.ok) throw new Error("catalog failed");
    const e = res.value.entries;
    expect(e.at(-1)).toMatchObject({
      id: "biotrack_species_preview",
      title: "BioTrack per-species (preview)",
      group: "unlisted",
      external: true,
      status: "ok",
      href: PRIVATE,
    });
    expect(unlistedEntryId(e)).toBe("biotrack_species_preview");
    expect(GROUP_ORDER.at(-1)).toBe("unlisted");
    expect(GROUP_LABEL.unlisted).toMatch(/Unlisted/);
  });
  it("its items load from its own `items/` links (and hex assets resolve relative to the item)", async () => {
    const { p, f, cache } = load([PRIVATE]);
    const res = await p;
    if (!res.ok) throw new Error("catalog failed");
    const entry = res.value.entries.at(-1)!;
    const items = await loadItems(entry, { fetchImpl: f.fetch, cache });
    if (!items.ok) throw new Error("items failed");
    expect(items.value.items.map((i) => i.id)).toEqual(["a", "b"]);
    expect(items.value.items[0]["atlas:url"]).toBe(
      "https://private.example/biotrack/species/items/a.json",
    );
  });
  it("one that cannot be read is an unavailable row, never a catalog failure", async () => {
    const res = await load([PRIVATE], () => undefined).p;
    if (!res.ok) throw new Error("catalog failed");
    const e = res.value.entries.at(-1)!;
    expect(e).toMatchObject({ group: "unlisted", status: "unavailable" });
    expect(res.value.entries.length).toBeGreaterThan(1);
    expect(unlistedEntryId(res.value.entries)).toBeNull(); // nothing readable to open on
  });
  it("a collection whose id the catalog already lists is not added twice (the listed one wins)", async () => {
    const dup = { ...collection, id: "biotrack_indicators" };
    const res = await load([PRIVATE], (u) => (u === PRIVATE ? jsonResponse(dup) : undefined)).p;
    if (!res.ok) throw new Error("catalog failed");
    expect(res.value.entries.filter((e) => e.id === "biotrack_indicators")).toHaveLength(1);
    expect(res.value.entries.some((e) => e.group === "unlisted")).toBe(false);
  });
});

describe("validateCollectionUrl: https only, no credentials, no fragment, a .json file", () => {
  it("accepts an https collection.json (a signed link's query is kept)", () => {
    expect(validateCollectionUrl(PRIVATE)).toBe(PRIVATE);
    const signed = `${PRIVATE}?X-Amz-Signature=abc&X-Amz-Expires=3600`;
    expect(validateCollectionUrl(signed)).toBe(signed);
  });
  it("ignores everything else: http, loopback http, credentials, fragments, non-json, relative, junk", () => {
    for (const bad of [
      "http://private.example/c/collection.json",
      "http://localhost:8080/c/collection.json",
      "https://user:pw@private.example/c/collection.json",
      `${PRIVATE}#frag`,
      "https://private.example/c/collection.html",
      "https://private.example/c/",
      "/c/collection.json",
      "javascript:alert(1)",
      "",
      "   ",
      null,
      undefined,
      42,
    ]) {
      expect(validateCollectionUrl(bad)).toBeNull();
    }
  });
});

describe("the ?collection= URL key", () => {
  it("round-trips through the codec; an invalid value is dropped (never written back)", () => {
    const loc = (search: string) => ({ search, hash: "" });
    const sel = parseSel(loc(`?collection=${encodeURIComponent(PRIVATE)}`));
    expect(sel.collection).toBe(PRIVATE);
    expect(parseSel(loc(formatSel(sel).search)).collection).toBe(PRIVATE);
    const bad = parseSel(loc("?collection=http%3A%2F%2Fx.example%2Fc.json"));
    expect(bad.collection).toBeUndefined();
    expect(formatSel(bad).search).toBe("");
    expect(formatSel({ ...DEFAULT_SEL }).search).toBe("");
  });
  it("REGRESSION: never reaches analytics page locations (a private link is not analytics data)", () => {
    const out = buildPageLocation({
      origin: "https://oceanmetrics.io",
      pathname: "/atlas/",
      search: `?c=x&collection=${encodeURIComponent(PRIVATE)}&catalog=https%3A%2F%2Fx.example%2F`,
    });
    expect(out).toContain("c=x");
    expect(out).not.toContain("collection");
    expect(out).not.toContain("private.example");
    expect(out).not.toContain("catalog");
  });
});
