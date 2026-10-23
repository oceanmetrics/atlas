// The taxon field (build week 4, step 5; obis-hex's taxon picker): the release's taxon layers (taxon_groups.parquet,
// the heads above class included) searched by name, rank and common name, families only while searching.
import { describe, expect, it } from "vitest";
import {
  commonName,
  GROUP_CAP,
  headsOf,
  logBar,
  matchRank,
  readTaxonRows,
  rowLabel,
  taxonGroups,
} from "../../src/lens/collection/h3/taxa";
import type { TaxonRow } from "../../src/lens/collection/h3/view";
import { buffer } from "./support";

const rows = () => readTaxonRows(buffer("taxon_groups.parquet"));

describe("the taxon rows", () => {
  it("the 7 EOV rows and the taxon rows, url_path as the store holds it", async () => {
    const r = await rows();
    expect(
      r
        .filter((x) => x.kind === "eov")
        .map((x) => x.taxon)
        .sort(),
    ).toEqual([
      "fish",
      "hardCorals",
      "mangroves",
      "marineMammals",
      "seaTurtles",
      "seabirds",
      "seagrasses",
    ]);
    expect(r.find((x) => x.taxon === "Aves")).toMatchObject({
      rank: "class",
      urlPath: "taxon/rank=class/taxon=Aves",
    });
  });
  it("groups by rank, counts, log bar, percent-encoded name", async () => {
    const g = taxonGroups(await rows());
    // the heads above class first, then phyla, classes, orders; no families without a search
    expect(g.map((x) => x.rank)).toEqual([
      "kingdom",
      "phylum",
      "subphylum",
      "infraphylum",
      "class",
      "order",
    ]);
    const phyla = g.find((x) => x.rank === "phylum")!;
    expect(phyla.label).toBe("Phyla");
    expect(phyla.rows[0].taxon).toBe("Chordata"); // most records first
    expect(phyla.rows.map((x) => x.n)).toEqual(
      [...phyla.rows.map((x) => x.n)].sort((a, b) => b - a),
    );
    expect(phyla.rows[0].bar).toBeGreaterThan(phyla.rows[phyla.rows.length - 1].bar);
    expect(g.find((x) => x.rank === "kingdom")!.label).toBe("Kingdom (above class)");
    const apic = g
      .find((x) => x.rank === "class")!
      .rows.find((x) => x.taxon.startsWith("Apicomplexa"))!;
    expect(apic.urlPath).toContain("Apicomplexa%2520incertae%2520sedis");
  });
  it("families only while searching, the selected one stays", async () => {
    const r = await rows();
    expect(taxonGroups(r).some((x) => x.rank === "family")).toBe(false);
    expect(
      taxonGroups(r, "", "family:Delphinidae")
        .find((x) => x.rank === "family")!
        .rows.map((x) => x.taxon),
    ).toEqual(["Delphinidae"]);
    expect(
      taxonGroups(r, "bal")
        .find((x) => x.rank === "family")!
        .rows.map((x) => x.taxon),
    ).toEqual(["Balaenopteridae", "Balistidae", "Balanidae"]);
  });
  it("common name leads the label and is a search keyword", async () => {
    const r = await rows();
    expect(rowLabel({ taxon: "Aves" })).toBe("Aves — birds");
    expect(commonName("Delphinidae")).toBe("dolphins");
    const g = taxonGroups(r, "birds");
    expect(g.flatMap((x) => x.rows.map((y) => y.taxon))).toEqual(["Aves"]);
    expect(taxonGroups(r, "dolph").flatMap((x) => x.rows.map((y) => y.taxon))).toEqual([
      "Delphinidae",
    ]);
  });
  it("search aves finds Aves — birds first; exact, prefix, word prefix, substring", async () => {
    const r = await rows();
    const g = taxonGroups(r, "aves");
    expect(g[0].rows[0].label).toBe("Aves — birds");
    const row = (taxon: string, rank = "class") =>
      ({ kind: "taxon", rank, taxon, label: taxon, n: 1, urlPath: "" }) as TaxonRow;
    expect(matchRank(row("Aves"), "aves")).toBe(0);
    expect(matchRank(row("Avesta"), "aves")).toBe(1);
    expect(matchRank(row("Charadriiformes", "order"), "gulls")).toBe(1); // "gulls, terns and auks"
    expect(matchRank(row("Charadriiformes", "order"), "terns")).toBe(2);
    expect(matchRank(row("Charadriiformes", "order"), "adrii")).toBe(3);
    expect(matchRank(row("Aves"), "xyz")).toBeNull();
    expect(matchRank(row("Pecés"), "peces")).toBe(0); // accents ignored
  });
  it("a group is capped, the rest counted", () => {
    const many = Array.from({ length: GROUP_CAP + 7 }, (_, i) => ({
      kind: "taxon",
      rank: "order",
      taxon: `O${i}`,
      label: `O${i}`,
      n: i + 1,
      urlPath: `taxon/rank=order/taxon=O${i}`,
    }));
    const g = taxonGroups(many);
    expect(g[0].rows.length).toBe(GROUP_CAP);
    expect(g[0].more).toBe(7);
  });
  it("log bar", () => {
    expect(logBar(0, 100)).toBe(0);
    expect(logBar(99, 99)).toBe(1);
    expect(logBar(9, 99)).toBeCloseTo(0.5, 5);
  });
});

describe("heads.json", () => {
  it("rows with their serving layer; junk dropped", () => {
    expect(
      headsOf({
        heads: [
          {
            aphiaid: 2,
            name: "Animalia",
            rank: "Kingdom",
            served_by: "head",
            layer: "taxon/rank=kingdom/taxon=Animalia",
          },
          { aphiaid: "x", name: "bad" },
          null,
        ],
      }),
    ).toEqual([
      {
        aphiaid: 2,
        name: "Animalia",
        rank: "Kingdom",
        servedBy: "head",
        layer: "taxon/rank=kingdom/taxon=Animalia",
      },
    ]);
    expect(headsOf(null)).toEqual([]);
  });
});
