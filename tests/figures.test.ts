// The paper's three app figures (obis-hex parity rows 124 to 127): each obis-hex URL of scripts/figures.mjs goes
// through the atlas codec (obisHexRedirect) and its atlas URL decodes, through the atlas's own parseSel, to the state
// the paper describes. The script cannot drift from the grammar: a renamed key or a changed default fails here.
import { describe, expect, it } from "vitest";
import {
  ATLAS_ORIGIN,
  FIGURES,
  OBIS_COLLECTION_URL,
  figureUrl,
  withObisLinked,
} from "../scripts/figures.mjs";
import { obisHexRedirect } from "../src/lib/state/obisHex";
import { parseSel } from "../src/lib/state/codec";

const decode = (name: string, base = ATLAS_ORIGIN) => {
  const fig = FIGURES.find((f: { file: string }) => f.file.includes(name));
  if (!fig) throw new Error(`no figure ${name}`);
  const url = figureUrl(fig, obisHexRedirect, base);
  const u = new URL(url);
  return { fig, url, u, sel: parseSel({ search: u.search, hash: u.hash }) };
};

describe("the paper's figure URLs", () => {
  it("lists three figures, with the files the parity rows name", () => {
    expect(FIGURES.map((f: { file: string }) => f.file)).toEqual([
      "figA_atlas_global_es_2020s.png",
      "figA_atlas_seagrasses_globe.png",
      "figA_atlas_caribbean_cell_res4.png",
    ]);
  });

  it("global ES(50) of the 2020s: all taxa, res 1, the globe, dark", () => {
    const { sel, u } = decode("global_es_2020s");
    expect(u.origin + u.pathname).toBe(ATLAS_ORIGIN);
    expect(sel.c).toBe("obis_h3");
    expect(sel.i).toBe("all");
    expect(sel.dim).toEqual({ indicator: "es", period: "2020s" });
    expect(sel.res).toBe(1);
    expect(sel.map).toMatchObject({ lon: -30, lat: 15, zoom: 1.5 });
    expect(sel.proj).toBe("globe");
    expect(sel.theme).toBe("dark");
    expect(sel.tour).toBe("off");
    expect(sel.cell).toBeUndefined();
  });

  it("seagrasses EOV on the globe: ES(50), all years, res 1, the same camera, light", () => {
    const { sel } = decode("seagrasses_globe");
    expect(sel.c).toBe("obis_h3");
    expect(sel.i).toBe("seagrasses");
    expect(sel.dim).toEqual({ indicator: "es", period: "all" });
    expect(sel.res).toBe(1);
    expect(sel.map).toMatchObject({ lon: -30, lat: 15, zoom: 1.5 });
    expect(sel.proj).toBe("globe");
    expect(sel.theme).toBe("light");
    expect(sel.cell).toBeUndefined();
  });

  it("a Caribbean res-4 seagrasses cell: flat, the cell selected (written by hand, the redirect drops x)", () => {
    const { fig, sel } = decode("caribbean_cell_res4");
    expect(sel.c).toBe("obis_h3");
    expect(sel.i).toBe("seagrasses");
    expect(sel.dim).toEqual({ indicator: "es", period: "all" });
    expect(sel.res).toBe(4);
    expect(sel.proj).toBe("mercator");
    expect(sel.theme).toBe("light");
    expect(sel.cell).toBe("8467365ffffffff");
    // the cell is a res-4 cell (H3 index digit 2 is the resolution) inside the Caribbean's camera
    expect(sel.cell![1]).toBe("4");
    expect(sel.map!.lat).toBeGreaterThan(10);
    expect(sel.map!.lat).toBeLessThan(25);
    expect(sel.map!.lon).toBeGreaterThan(-90);
    expect(sel.map!.lon).toBeLessThan(-60);
    // the redirect really does not carry the cell: the hand-written `cell` is what selects it
    expect(obisHexRedirect(fig.obisHex).url).not.toContain("cell=");
    expect(obisHexRedirect(fig.obisHex).dropped).toContain("x");
  });

  it("the redirect drops the hash theme `t`: each figure's theme is written by hand", () => {
    for (const fig of FIGURES as { obisHex: string; extra: { theme: string } }[]) {
      expect(obisHexRedirect(fig.obisHex).url).not.toContain("theme=");
      expect(obisHexRedirect(fig.obisHex).dropped).toContain("t");
      expect(fig.obisHex).toContain(`t=${fig.extra.theme}`);
    }
  });

  it("opens against a preview base, with the same query", () => {
    const live = decode("global_es_2020s");
    const local = decode("global_es_2020s", "http://localhost:4399/");
    expect(local.url.startsWith("http://localhost:4399/?c=obis_h3&")).toBe(true);
    expect(local.u.search).toBe(live.u.search);
  });
});

describe("the live catalog with the OBIS layer", () => {
  const catalog = { links: [{ rel: "child", href: "./aquamaps_eov/collection.json" }] };

  it("links the obis-h3 collection in the group obis when the catalog does not", () => {
    const out = withObisLinked(catalog);
    expect(out.links.at(-1)).toMatchObject({
      rel: "child",
      href: OBIS_COLLECTION_URL,
      "atlas:group": "obis",
    });
    expect(out.links).toHaveLength(2);
  });

  it("leaves a catalog that already links it alone", () => {
    const linked = withObisLinked(catalog);
    expect(withObisLinked(linked)).toBe(linked);
  });
});
