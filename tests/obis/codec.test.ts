// The OBIS layer's keys in the atlas codec (build week 4, step 5): `dim.<key>`, `res`, `taxon`, `cell`. Every atlas
// URL the shared case table (tests/fixtures/obis_redirect_cases.json) produces is read by the atlas's own parseSel
// here, key by key, and survives a formatSel round trip; tests/obis/view.test.ts then turns the same Sel into the
// layer view the OBIS lens draws.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { formatSel, parseSel } from "../../src/lib/state/codec";
import { DEFAULT_SEL, QUERY_KEYS, QUERY_KEY_PREFIXES } from "../../src/lib/state/types";

interface Case {
  name: string;
  atlas: string;
}
const TABLE = JSON.parse(readFileSync("tests/fixtures/obis_redirect_cases.json", "utf8")) as {
  origin: string;
  cases: Case[];
};
const atlasCases = TABLE.cases.filter((c) => c.atlas.startsWith(`${TABLE.origin}/atlas/`));
const sel = (search: string, hash = "") => parseSel({ search, hash });

describe("every atlas URL of the case table opens through parseSel", () => {
  it("the table has atlas cases", () => expect(atlasCases.length).toBeGreaterThanOrEqual(10));

  it.each(atlasCases.map((c) => [c.name, c] as const))("%s", (_, c) => {
    const u = new URL(c.atlas);
    const s = parseSel({ search: u.search, hash: u.hash });
    const q = u.searchParams;
    expect(s.c).toBe("obis_h3");
    expect(s.i).toBe(q.get("i"));
    expect(s.dim).toEqual({ indicator: q.get("dim.indicator"), period: q.get("dim.period") });
    const res = q.get("res");
    expect(s.res).toBe(res === "auto" ? undefined : Number(res));
    expect(s.taxon).toBe(q.get("taxon") ?? undefined);
    expect(s.proj).toBe(q.get("proj"));
    // the round trip: what the atlas writes back opens the same view
    const out = formatSel(s);
    expect(parseSel(out)).toEqual(s);
  });
});

describe("dim.<key>", () => {
  it("dim.indicator for the five", () => {
    for (const ind of ["es", "sp", "shannon", "simpson", "n"])
      expect(sel(`?c=obis_h3&dim.indicator=${ind}`).dim).toEqual({ indicator: ind });
  });
  it("dim.period all and a decade", () => {
    expect(sel("?dim.period=all").dim).toEqual({ period: "all" });
    expect(sel("?dim.period=1990s").dim).toEqual({ period: "1990s" });
  });
  it("dim.period year", () => {
    expect(sel("?dim.period=2015").dim).toEqual({ period: "2015" });
    expect(formatSel({ ...DEFAULT_SEL, dim: { period: "2015" } }).search).toBe("?dim.period=2015");
  });
  it("is written sorted by key, and an empty set writes nothing", () => {
    expect(formatSel({ ...DEFAULT_SEL, dim: { period: "1990s", indicator: "n" } }).search).toBe(
      "?dim.indicator=n&dim.period=1990s",
    );
    expect(formatSel({ ...DEFAULT_SEL, dim: {} }).search).toBe("");
    expect(sel("?x=1").dim).toBeUndefined();
  });
  it("ignores a malformed key or value, never throws", () => {
    expect(sel("?dim.=1&dim.A=b&dim.indicator=%3Cscript%3E&dim.period=1990s").dim).toEqual({
      period: "1990s",
    });
    expect(sel(`?dim.indicator=${"x".repeat(65)}`).dim).toBeUndefined();
  });
  it("the prefix is declared beside the exact key list", () => {
    expect(QUERY_KEY_PREFIXES).toEqual(["dim."]);
    expect((QUERY_KEYS as readonly string[]).filter((k) => k.startsWith("dim."))).toEqual([]);
  });
});

describe("res", () => {
  it("res auto and 1..7", () => {
    expect(sel("?res=auto").res).toBeUndefined();
    expect(sel("").res).toBeUndefined();
    for (const r of [1, 2, 3, 4, 5, 6, 7]) expect(sel(`?res=${r}`).res).toBe(r);
  });
  it("out of range or junk is auto", () => {
    for (const r of ["0", "16", "-1", "3.5", "x", "07x"])
      expect(sel(`?res=${r}`).res).toBeUndefined();
  });
  it("auto is never written, a pin is", () => {
    expect(formatSel({ ...DEFAULT_SEL, res: undefined }).search).toBe("");
    expect(formatSel({ ...DEFAULT_SEL, res: 4 }).search).toBe("?res=4");
  });
});

describe("taxon", () => {
  it("rank:name with a space, and a name holding a colon", () => {
    expect(sel("?taxon=family:Incertae+sedis").taxon).toBe("family:Incertae sedis");
    expect(sel("?taxon=genus:Foo%3Abar").taxon).toBe("genus:Foo:bar");
  });
  it("aphia:<id>", () => {
    expect(sel("?taxon=aphia:2688").taxon).toBe("aphia:2688");
    expect(sel("?taxon=aphia:0").taxon).toBeUndefined();
    expect(sel("?taxon=aphia:12x").taxon).toBeUndefined(); // `aphia` is never a rank
  });
  it("junk is dropped", () => {
    for (const t of ["Aves", ":Aves", "class:", "CLASS:Aves", "class: Aves"])
      expect(sel(`?taxon=${encodeURIComponent(t)}`).taxon).toBeUndefined();
  });
  it("round-trips a name with a space and a colon", () => {
    const s = { ...DEFAULT_SEL, c: "obis_h3", taxon: "family:Incertae sedis:x" };
    expect(parseSel(formatSel(s)).taxon).toBe("family:Incertae sedis:x");
  });
});

describe("cell", () => {
  it("15 hex digits, lowercased", () => {
    expect(sel("?cell=81197FFFFFFFFFF").cell).toBe("81197ffffffffff");
    expect(sel("?cell=81197ffffffffff").cell).toBe("81197ffffffffff");
    expect(sel("?cell=81197fffffffff").cell).toBeUndefined();
    expect(sel("?cell=zz197ffffffffff").cell).toBeUndefined();
  });
  it("round-trips", () => {
    const s = { ...DEFAULT_SEL, c: "obis_h3", cell: "8348c0fffffffff" };
    expect(formatSel(s).search).toContain("cell=8348c0fffffffff");
    expect(parseSel(formatSel(s)).cell).toBe("8348c0fffffffff");
  });
});

describe("the other OBIS keys the table carries", () => {
  it("map round-trips and ranges", () => {
    const s = sel("?map=-122.1,36.75,9");
    expect(s.map).toEqual({ lon: -122.1, lat: 36.75, zoom: 9 });
    expect(sel("?map=a,b,c").map).toBeUndefined();
  });
  it("proj", () => {
    expect(sel("?proj=globe").proj).toBe("globe");
    expect(sel("?proj=mercator").proj).toBe("mercator");
  });
  it("item all round-trips", () => {
    const s = sel("?c=obis_h3&i=all");
    expect(s.i).toBe("all");
    expect(parseSel(formatSel(s)).i).toBe("all");
  });
});

describe("dom", () => {
  it("dom=view round-trips (the loaded hexagons' colour range); anything else is the release's, never written", () => {
    expect(sel("?c=obis_h3&dom=view").dom).toBe("view");
    expect(formatSel({ ...DEFAULT_SEL, c: "obis_h3", dom: "view" }).search).toBe(
      "?c=obis_h3&dom=view",
    );
    for (const v of ["", "release", "VIEW", "x"]) expect(sel(`?dom=${v}`).dom).toBeUndefined();
    expect(formatSel({ ...DEFAULT_SEL, c: "obis_h3" }).search).toBe("?c=obis_h3");
    expect(QUERY_KEYS).toContain("dom");
  });
  it("the place filter is the atlas's own filter=places over the hash's places", () => {
    const s = sel("?c=obis_h3&filter=places", "#pl=p.NMS%253ACINMS.Channel%2520Islands");
    expect(s.filter).toBe("places");
    expect(s.pl).toBe("p.NMS%3ACINMS.Channel%20Islands");
    expect(formatSel(s).search).toBe("?c=obis_h3&filter=places");
  });
});
