// A dry run of a new release through `?catalog=` (obis-hex `?data=<base>`, rows 92 and 119 of its parity list): a
// staging catalog whose `catalog.json` links a staging obis-h3 `collection.json` opens that release, every template,
// the legend, the search asset and `release.json` resolved against the staging collection's own url, nothing against
// the stable one. No h3t counterpart (`?h3t=`): the atlas names no subtree service.
import { describe, expect, it } from "vitest";
import { loadCatalog } from "../../src/lib/catalog/load";
import { parseH3 } from "../../src/lib/catalog/h3";
import { parseSel } from "../../src/lib/state/codec";
import { resolveCatalogBase } from "../../src/lib/catalog/base";
import { collection } from "./support";

const STAGING = "https://staging.example.org/atlas/";

/** the published collection made relative (a staging copy of release v20990101 under `obis-h3/`) */
function stagingCollection(): Record<string, unknown> {
  const text = JSON.stringify(collection()).replaceAll(
    "https://s3.us-east-1.amazonaws.com/oceanmetrics.io-public/obis-h3/v20261012/",
    "v20990101/",
  );
  const c = JSON.parse(text) as Record<string, unknown>;
  delete c["atlas:url"];
  c.links = [{ rel: "related", href: "v20990101/release.json", type: "application/json" }];
  c["obis:release"] = "v20990101";
  return c;
}

describe("?catalog= (a release's dry run)", () => {
  it("survives a release change with ?catalog=: the staging collection's templates, legend and release.json", async () => {
    const sel = parseSel({ search: `?c=obis_h3&catalog=${encodeURIComponent(STAGING)}`, hash: "" });
    expect(sel.catalog).toBe(STAGING);
    const base = resolveCatalogBase(sel.catalog);
    expect(base).toBe(STAGING);
    const fetched: string[] = [];
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      fetched.push(url);
      if (url === `${STAGING}catalog.json`)
        return Response.json({
          type: "Catalog",
          id: "atlas",
          stac_version: "1.1.0",
          description: "staging",
          links: [{ rel: "child", href: "obis-h3/collection.json", "atlas:group": "obis" }],
        });
      if (url === `${STAGING}obis-h3/collection.json`) return Response.json(stagingCollection());
      return new Response("", { status: 404 });
    }) as typeof fetch;
    const got = await loadCatalog({ base, fetchImpl, cache: new Map() });
    expect(got.ok).toBe(true);
    const entry = got.ok ? got.value.entries.find((e) => e.id === "obis_h3") : null;
    expect(entry?.status).toBe("ok");
    const spec = parseH3(entry!.collection!)!;
    const REL = `${STAGING}obis-h3/v20990101/`;
    expect(spec.layout.template).toBe(`${REL}all/res={res}/data_0.parquet`);
    expect(spec.stats).toBe(`${REL}stats.parquet`);
    expect(spec.taxonGroups).toBe(`${REL}taxon_groups.parquet`);
    expect(spec.releaseMeta).toBe(`${REL}release.json`);
    expect(spec.release).toBe("v20990101");
    expect(fetched.some((u) => u.includes("oceanmetrics.io-public/obis-h3/"))).toBe(false);
  });
  it("catalog override: a malformed or http value is ignored, the stable catalog stays", () => {
    for (const v of ["http://staging.example.org/atlas/", "not a url", "https://u:p@x.org/"]) {
      const s = parseSel({ search: `?catalog=${encodeURIComponent(v)}`, hash: "" });
      expect(s.catalog).toBeUndefined();
    }
  });
});
