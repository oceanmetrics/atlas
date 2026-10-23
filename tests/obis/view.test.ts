// The OBIS layer's view (build week 4, step 5): every atlas URL of the shared case table, read by the atlas's own
// parseSel, opens the layer, indicator, period and resolution it names (src/lens/collection/h3/view.ts).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseSel } from "../../src/lib/state/codec";
import { readTaxonRows } from "../../src/lens/collection/h3/taxa";
import {
  h3ViewOf,
  headRowOf,
  itemKindOf,
  periodRefOf,
  releaseTarget,
  taxonParam,
  taxonRowOf,
} from "../../src/lens/collection/h3/view";
import { buffer, item, REL, spec } from "./support";

const TABLE = JSON.parse(readFileSync("tests/fixtures/obis_redirect_cases.json", "utf8")) as {
  origin: string;
  cases: { name: string; obis_hex: string; atlas: string }[];
};
const atlasCases = TABLE.cases.filter((c) => c.atlas.startsWith(`${TABLE.origin}/atlas/`));
const S = spec();

describe("every atlas URL of the case table opens the right view", () => {
  it.each(atlasCases.map((c) => [c.name, c] as const))("%s", async (_, c) => {
    const rows = await readTaxonRows(buffer("taxon_groups.parquet"));
    const u = new URL(c.atlas);
    const sel = parseSel({ search: u.search, hash: u.hash });
    const it_ = item(sel.i ?? "all");
    const taxonP = sel.taxon;
    const row = taxonRowOf(rows, taxonP);
    const t = releaseTarget(S, "obis_h3", it_, row)!;
    const v = h3ViewOf(sel, S, t);
    const q = u.searchParams;
    expect(v.indicator).toBe(q.get("dim.indicator"));
    // the item: all or the EOV the link names (a taxon not in this fixture's rows draws its item)
    expect(t.kind).toBe(row ? "taxon" : sel.i === "all" ? "all" : "eov");
    if (!row && sel.i !== "all") expect(t.item).toEqual({ layer: "eov", key: sel.i });
    // the period: a decade token names the decade set, all is all time
    const p = q.get("dim.period")!;
    if (p === "all" || row) expect(v.periodRef).toBeNull();
    else expect(v.periodRef).toEqual({ grain: "decade", value: p.slice(0, -1) });
    // the resolution: auto, or pinned within the period's ladder
    const r = q.get("res")!;
    expect(v.res).toBe(r === "auto" ? "auto" : Number(r));
  });
});

describe("the target of an Item or a taxon", () => {
  it("item all and an EOV resolve their own folders and period sets", () => {
    const all = releaseTarget(S, "obis_h3", item("all"))!;
    expect(all.collection["h3:layout"]).toEqual({
      template: `${REL}all/res={res}/data_0.parquet`,
      parent_template: `${REL}all/res={res}/p={parent}/data_0.parquet`,
      parent_res: { 6: 2, 7: 3 },
    });
    expect(all.periods.map((p) => p.template)).toEqual([
      `${REL}decade/all/decade={decade}/res={res}/data_0.parquet`,
      `${REL}year/all/year={year}/res={res}/data_0.parquet`,
    ]);
    const fish = releaseTarget(S, "obis_h3", item("fish"))!;
    expect(fish.item).toEqual({ layer: "eov", key: "fish" });
    expect(fish.collection["h3:layout"].template).toBe(
      `${REL}eov/eov=fish/res={res}/data_0.parquet`,
    );
    expect(fish.periods[0].template).toBe(
      `${REL}decade/eov/eov=fish/decade={decade}/res={res}/data_0.parquet`,
    );
    expect(itemKindOf(item("seabirds"))).toEqual({ layer: "eov", key: "seabirds" });
  });

  it("a taxon with spaces and a percent sign finds its partition (url_path as the store holds it)", async () => {
    const rows = await readTaxonRows(buffer("taxon_groups.parquet"));
    const row = taxonRowOf(rows, "class:Apicomplexa incertae sedis")!;
    expect(row.urlPath).toBe("taxon/rank=class/taxon=Apicomplexa%2520incertae%2520sedis");
    const t = releaseTarget(S, "obis_h3", item("all"), row)!;
    expect(t.collection["h3:layout"].template).toBe(
      `${REL}taxon/rank=class/taxon=Apicomplexa%2520incertae%2520sedis/res={res}/data_0.parquet`,
    );
    // the taxon layers split by res-0 parent (obis:layers.taxon.parent_res), not the all layer's res 2 and 3
    expect(t.collection["h3:layout"].parent_res).toEqual({ 6: 0, 7: 0 });
    expect(t.item).toEqual({ layer: "taxon", key: "Apicomplexa incertae sedis", rank: "class" });
    expect(t.periods).toEqual([]);
    expect(taxonParam(row)).toBe("class:Apicomplexa incertae sedis");
  });

  it("an EOV row of the search asset is never a taxon layer", async () => {
    const rows = await readTaxonRows(buffer("taxon_groups.parquet"));
    expect(taxonRowOf(rows, "eov:fish")).toBeNull();
    expect(taxonRowOf(rows, "class:Nope")).toBeNull();
  });
});

describe("the view's clamps say what they did", () => {
  const all = () => releaseTarget(S, "obis_h3", item("all"))!;
  it("cap 5 with a period; 7 for all years", () => {
    const v = h3ViewOf({ dim: { period: "1990s" }, res: 7 }, S, all());
    expect(v.ladder).toEqual([1, 2, 3, 4, 5]);
    expect(v.res).toBe(5);
    expect(v.notes[0]).toBe("A decade layer is published up to res 5: res 7 is shown as res 5.");
    expect(h3ViewOf({ res: 7 }, S, all()).res).toBe(7);
  });
  it("dim.period year opens the year set", () => {
    const v = h3ViewOf({ dim: { period: "2015" } }, S, all());
    expect(v.periodRef).toEqual({ grain: "year", value: "2015" });
    expect(v.period).toBe("2015");
  });
  it("decade allowed for all and the EOVs; a taxon layer shows all years and says so", async () => {
    const rows = await readTaxonRows(buffer("taxon_groups.parquet"));
    const t = releaseTarget(S, "obis_h3", item("all"), taxonRowOf(rows, "class:Aves"))!;
    const v = h3ViewOf({ dim: { period: "1990s" } }, S, t);
    expect(v.periodRef).toBeNull();
    expect(v.period).toBe("all");
    expect(v.notes).toEqual(["Periods: all taxa and the EOVs only. Aves is shown over all years."]);
  });
  it("an unknown indicator or period falls back, never throws", () => {
    const v = h3ViewOf({ dim: { indicator: "bogus", period: "1850s" } }, S, all());
    expect(v.indicator).toBe("es");
    expect(v.periodRef).toBeNull();
    expect(v.notes).toEqual(["The release has no period 1850s: all years are shown."]);
  });
  it("periodRefOf: a decade is `<yyy0>s`, a year itself", () => {
    expect(periodRefOf(S.periods, "1990s")?.set.grain).toBe("decade");
    expect(periodRefOf(S.periods, "1990")?.set.grain).toBe("year");
    expect(periodRefOf(S.periods, "2015s")).toBeNull();
  });
});

describe("the heads (heads.json served_by)", () => {
  const heads = [
    { aphiaid: 1, name: "Biota", rank: "Superdomain", servedBy: "all", layer: "all" },
    {
      aphiaid: 2,
      name: "Animalia",
      rank: "Kingdom",
      servedBy: "head",
      layer: "taxon/rank=kingdom/taxon=Animalia",
    },
    {
      aphiaid: 51,
      name: "Mollusca",
      rank: "Phylum",
      servedBy: "rank_layer",
      layer: "taxon/rank=phylum/taxon=Mollusca",
    },
  ];
  it("a head is served by its taxon layer, a rank layer by its rank layer, Biota by all", async () => {
    const rows = await readTaxonRows(buffer("taxon_groups.parquet"));
    expect(headRowOf(heads, rows, "aphia:2").row?.taxon).toBe("Animalia");
    expect(headRowOf(heads, rows, "aphia:51").row?.rank).toBe("phylum");
    expect(headRowOf(heads, rows, "aphia:1")).toMatchObject({ row: null, all: true });
  });
  it("the head rule: Animalia is a taxon layer of the release, never the class files", async () => {
    const rows = await readTaxonRows(buffer("taxon_groups.parquet"));
    const t = releaseTarget(S, "obis_h3", item("all"), headRowOf(heads, rows, "aphia:2").row)!;
    expect(t.collection["h3:layout"].template).toBe(
      `${REL}taxon/rank=kingdom/taxon=Animalia/res={res}/data_0.parquet`,
    );
    expect(JSON.stringify(t.collection)).not.toContain("class=");
    expect(JSON.stringify(t.collection)).not.toContain("species/");
  });
  it("an AphiaID that is no head says why (no h3t, no in-page subtree yet)", async () => {
    const rows = await readTaxonRows(buffer("taxon_groups.parquet"));
    const r = headRowOf(heads, rows, "aphia:2688");
    expect(r.row).toBeNull();
    expect(r.reason).toContain("AphiaID 2688 is not one of the release's precomputed taxa");
  });
});
