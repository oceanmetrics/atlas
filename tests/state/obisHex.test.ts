// The OBIS URL grammar (build week 4, step 1): tests/fixtures/obis_redirect_cases.json drives obisHexToAtlas here,
// and obis-hex copies the same table into its tests/redirect.test.ts for redirectFor. One table, both sides.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { decodePlaces } from "../../src/lib/geo/placeCodec";
import { parseSel } from "../../src/lib/state/codec";
import {
  OBIS_COLLECTION,
  obisHexRedirect,
  obisHexToAtlas,
  zoomToRes,
} from "../../src/lib/state/obisHex";

interface Case {
  name: string;
  obis_hex: string;
  atlas: string;
  exact: boolean;
  dropped: string[];
}
const TABLE = JSON.parse(readFileSync("tests/fixtures/obis_redirect_cases.json", "utf8")) as {
  origin: string;
  keys: Record<string, { to?: string; rule?: string; drop?: string; otherwise?: string }>;
  cases: Case[];
};

// every key obis-hex writes (src/lib/state/url.ts) and every query switch it reads
const OBIS_HEX_KEYS = [
  "i",
  "l",
  "p",
  "r",
  "o",
  "t",
  "d",
  "g",
  "c",
  "k",
  "cc",
  "tc",
  "x",
  "xo",
  "b",
  "pl",
  "pc",
  "f",
  "v",
];
const OBIS_HEX_SWITCHES = ["?tour", "?modal", "?theme", "?data", "?h3t", "?legacy"];

describe("the obis-hex -> atlas case table", () => {
  it.each(TABLE.cases.map((c) => [c.name, c] as const))("%s", (_, c) => {
    const r = obisHexRedirect(c.obis_hex);
    expect(r.url).toBe(c.atlas);
    expect(obisHexToAtlas(c.obis_hex)).toBe(c.atlas);
    expect(r.exact).toBe(c.exact);
    expect(r.dropped).toEqual([...c.dropped].sort());
    if (!c.exact) expect(r.notes.length).toBeGreaterThan(0);
  });

  it("names every obis-hex key and switch, each carried (to, rule) or dropped with a reason", () => {
    expect(Object.keys(TABLE.keys).sort()).toEqual([...OBIS_HEX_KEYS, ...OBIS_HEX_SWITCHES].sort());
    for (const [k, v] of Object.entries(TABLE.keys)) {
      const carried = typeof v.to === "string" && typeof v.rule === "string";
      const dropped = typeof v.drop === "string" && v.drop.length > 0;
      expect(carried !== dropped, k).toBe(true);
      // a carried key may say what happens to its other values (d: view is carried, release is not)
      if (v.otherwise !== undefined) expect(carried, k).toBe(true);
    }
  });

  it("has a case for every key and switch (?legacy is obis-hex's legacyToState, before the table)", () => {
    const seen = new Set<string>();
    for (const c of TABLE.cases) {
      const [before, hash = ""] = c.obis_hex.split("#");
      for (const kv of hash.split("&")) if (kv.includes("=")) seen.add(kv.split("=")[0]);
      const q = before.split("?")[1] ?? "";
      for (const k of new URLSearchParams(q).keys()) seen.add(`?${k}`);
    }
    const missing = Object.keys(TABLE.keys).filter((k) => !seen.has(k) && k !== "?legacy");
    expect(missing).toEqual([]);
  });

  it("every dropped key of a case is a key the table drops, or a carried key the Place page does not need", () => {
    for (const c of TABLE.cases) {
      const toPlaces = c.atlas.startsWith(`${TABLE.origin}/places/p/`);
      for (const k of c.dropped) {
        if (toPlaces) expect(TABLE.keys[k], `${c.name}: ${k}`).toBeDefined();
        else
          expect(TABLE.keys[k]?.drop ?? TABLE.keys[k]?.otherwise, `${c.name}: ${k}`).toBeDefined();
      }
    }
  });
});

describe("the atlas reads what the table writes", () => {
  const atlasCases = TABLE.cases.filter((c) => c.atlas.startsWith(`${TABLE.origin}/atlas/`));

  it.each(atlasCases.map((c) => [c.name, c] as const))("%s", (_, c) => {
    const u = new URL(c.atlas);
    const sel = parseSel({ search: u.search, hash: u.hash });
    expect(sel.c).toBe(OBIS_COLLECTION);
    expect(sel.i).toBe(u.searchParams.get("i"));
    const [lon, lat, zoom] = u.searchParams.get("map")!.split(",").map(Number);
    expect(sel.map).toEqual({ lon, lat, zoom });
    expect(sel.proj).toBe(u.searchParams.get("proj"));
    // the keys the OBIS layer of step 5 reads
    expect(u.searchParams.get("dim.indicator")).toMatch(/^(es|sp|shannon|simpson|n)$/);
    expect(u.searchParams.get("dim.period")).toMatch(/^(all|\d{4}s|\d{4})$/);
    expect(u.searchParams.get("res")).toMatch(/^(auto|[1-7])$/);
    const taxon = u.searchParams.get("taxon");
    if (taxon !== null) expect(taxon).toMatch(/^[a-z]+:.+$/);
  });

  it("a carried place decodes through the atlas place codec to its gazetteer id", () => {
    const withPlace = atlasCases.filter((c) => c.atlas.includes("#pl="));
    expect(withPlace.length).toBeGreaterThanOrEqual(2);
    for (const c of withPlace) {
      const u = new URL(c.atlas);
      const sel = parseSel({ search: u.search, hash: u.hash });
      const places = decodePlaces(sel.pl!);
      expect(places).toHaveLength(1);
      expect(places[0].kind).toBe("gaz");
      const pl = new URLSearchParams(new URL(c.obis_hex).hash.slice(1)).get("pl");
      expect(places[0].kind === "gaz" && places[0].id).toBe(pl);
    }
  });

  it("a taxon name splits on its first colon only", () => {
    const u = new URL(TABLE.cases.find((c) => c.atlas.includes("taxon=genus:Foo:bar"))!.atlas);
    const t = u.searchParams.get("taxon")!;
    expect([t.slice(0, t.indexOf(":")), t.slice(t.indexOf(":") + 1)]).toEqual(["genus", "Foo:bar"]);
    expect(
      new URL(TABLE.cases.find((c) => c.atlas.includes("Incertae"))!.atlas).searchParams.get(
        "taxon",
      ),
    ).toBe("family:Incertae sedis");
  });
});

describe("obisHexRedirect beyond the table", () => {
  it("takes a bare hash, a query and hash, or a whole URL alike", () => {
    const h = "#i=sp&l=eov:fish&p=1990&r=3&c=-20,5,1.4";
    const want = obisHexToAtlas(`https://oceanmetrics.io/obis-hex/${h}`);
    expect(obisHexToAtlas(h)).toBe(want);
    expect(obisHexToAtlas(`https://marinebon.github.io/obis-hex/${h}`)).toBe(want);
  });
  it("never throws on junk", () => {
    for (const s of [
      "",
      "#",
      "#=&=&",
      "#l=taxon:class:%E0%A4%A",
      "#pl=%ZZ",
      "?tour=%#c=a,b,c",
      null as unknown as string,
    ])
      expect(() => obisHexRedirect(s)).not.toThrow();
  });
  it("drops a place id outside the gazetteer alphabet", () => {
    expect(obisHexToAtlas("#pl=%3Cscript%3E&r=3")).not.toContain("#pl=");
  });
  it("d=view is the atlas's dom=view; d=release and any other d stay dropped (row 109)", () => {
    const base = "#i=es&l=all&p=all&r=auto&c=0,0,1";
    const view = obisHexRedirect(`${base}&d=view`);
    expect(new URL(view.url).searchParams.get("dom")).toBe("view");
    expect(view.dropped).not.toContain("d");
    expect(view.exact).toBe(true);
    for (const d of ["release", "x", "", "VIEW"]) {
      const r = obisHexRedirect(`${base}&d=${d}`);
      expect(new URL(r.url).searchParams.has("dom"), d).toBe(false);
      expect(r.dropped, d).toContain("d");
    }
    // no d at all: nothing to carry or drop
    expect(obisHexRedirect(base).dropped).toEqual([]);
  });
  it("f=<collection> is the atlas's filter=coll:<slug>; f with ids, a bad slug and v=places stay dropped (row 47)", () => {
    const base = "#i=es&l=all&p=all&r=auto&c=0,0,1";
    const ok = obisHexRedirect(`${base}&f=noaa_sanctuaries`);
    expect(new URL(ok.url).searchParams.get("filter")).toBe("coll:noaa_sanctuaries");
    expect(ok.dropped).not.toContain("f");
    expect(ok.exact).toBe(true);
    for (const f of [
      "noaa_sanctuaries|NMS:CINMS",
      "places|NMS:CINMS,NMS:MBNMS",
      "Bad",
      "a-b",
      "1abc",
      "a b",
      `x${"y".repeat(64)}`,
    ]) {
      const r = obisHexRedirect(`${base}&f=${encodeURIComponent(f)}`);
      expect(new URL(r.url).searchParams.has("filter"), f).toBe(false);
      expect(r.dropped, f).toContain("f");
      expect(r.exact, f).toBe(false);
    }
  });
  it("ports obis-hex's zoomToRes", () => {
    expect([0, 2.2, 3.4, 4, 8.2, 9, 22].map(zoomToRes)).toEqual([1, 2, 3, 3, 7, 7, 10]);
  });
});
