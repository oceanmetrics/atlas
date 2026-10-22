// The catalog page's view model (src/catalog/model.ts): each printing rule has its own small fixture
// asserting the exact output -- DOI link, license label and link, contact line, asset size, temporal
// label, dimension summary, extent sketch, the unavailable card, and the grouping order.
import { describe, expect, it } from "vitest";
import {
  assetTypeLabel,
  assetViews,
  bboxOf,
  buildCard,
  contactViews,
  dimViews,
  doiUrl,
  firstParagraph,
  formatBytes,
  formatContact,
  groupCards,
  licenseView,
  providerViews,
  sketchRect,
  spdxUrl,
  temporalLabel,
} from "../../src/catalog/model";
import { WORLD_PATH } from "../../src/catalog/world";
import {
  ABOUT_LINKS,
  BRAND_CREDIT,
  CATALOG_PAGE_HREF,
  SUPPORTERS,
  openInMapHref,
} from "../../src/lib/brand/instance";
import { loadCatalog, type CatalogCache, type CollectionEntry } from "../../src/lib/catalog/load";
import type { StacCollection } from "../../src/lib/catalog/types";
import { FIXTURE_BASE, fakeFetch } from "./support";

const URL_OF = "https://atlas.test/atlas/c/collection.json";
const coll = (extra: Partial<StacCollection> = {}): StacCollection =>
  ({ type: "Collection", id: "c", links: [], "atlas:url": URL_OF, ...extra }) as StacCollection;

describe("doiUrl", () => {
  it("makes a bare DOI resolvable", () => {
    expect(doiUrl("10.1234/abcd")).toBe("https://doi.org/10.1234/abcd");
  });
  it("accepts a doi: prefix and keeps an https URL as is", () => {
    expect(doiUrl("doi: 10.1/x")).toBe("https://doi.org/10.1/x");
    expect(doiUrl("https://doi.org/10.1/x")).toBe("https://doi.org/10.1/x");
  });
  it("is null for nothing", () => {
    expect(doiUrl(undefined)).toBeNull();
    expect(doiUrl("  ")).toBeNull();
  });
});

describe("license label and link", () => {
  it("links a plain SPDX id to its page", () => {
    expect(licenseView(coll({ license: "CC-BY-4.0" }))).toEqual({
      label: "CC-BY-4.0",
      url: "https://spdx.org/licenses/CC-BY-4.0.html",
    });
  });
  it("prefers the collection's own license link, resolved against the collection", () => {
    expect(
      licenseView(
        coll({ license: "CC-BY-4.0", links: [{ rel: "license", href: "../LICENSE.txt" }] }),
      ),
    ).toEqual({ label: "CC-BY-4.0", url: "https://atlas.test/atlas/LICENSE.txt" });
  });
  it("has no link for proprietary, various or free text, and is null without a license", () => {
    expect(spdxUrl("proprietary")).toBeNull();
    expect(spdxUrl("various")).toBeNull();
    expect(licenseView(coll({ license: "see terms of use" }))?.url).toBeNull();
    expect(licenseView(coll())).toBeNull();
  });
});

describe("formatBytes", () => {
  it("prints decimal units with one decimal", () => {
    expect(formatBytes(956)).toBe("956 B");
    expect(formatBytes(1000)).toBe("1.0 kB");
    expect(formatBytes(11_620_162)).toBe("11.6 MB");
    expect(formatBytes(69_731_705)).toBe("69.7 MB");
    expect(formatBytes(2_500_000_000)).toBe("2.5 GB");
  });
  it("rolls 999.96 kB over to 1.0 MB instead of printing 1000.0 kB", () => {
    expect(formatBytes(999_960)).toBe("1.0 MB");
  });
  it("is null for a missing or invalid size", () => {
    expect(formatBytes(undefined)).toBeNull();
    expect(formatBytes("12")).toBeNull();
    expect(formatBytes(-1)).toBeNull();
    expect(formatBytes(Number.NaN)).toBeNull();
  });
});

describe("contacts and providers", () => {
  it("formats a contact with position, organization and e-mail as text", () => {
    const v = formatContact({
      name: "Neil Hammerschlag",
      organization: "Shark Research Foundation",
      position: "Principal investigator",
      emails: [{ value: "nh@example.org" }],
      roles: ["principal investigator"],
    });
    expect(v).toMatchObject({
      name: "Neil Hammerschlag",
      emails: ["nh@example.org"],
      roles: ["principal investigator"],
      line: "Neil Hammerschlag, Principal investigator, Shark Research Foundation <nh@example.org>",
    });
  });
  it("accepts an organization-only contact and drops one with neither name nor organization", () => {
    expect(formatContact({ organization: "NOAA SEFSC" })?.line).toBe("NOAA SEFSC");
    expect(formatContact({ position: "x" })).toBeNull();
  });
  it("lists principal investigators before everyone else, each group in source order", () => {
    const names = contactViews(
      coll({
        contacts: [
          { name: "Author One", roles: ["author"] },
          { name: "PI Two", roles: ["principal investigator"] },
          { name: "Author Three", roles: ["author"] },
          { name: "PI Four", roles: ["PI"] },
        ],
      }),
    ).map((c) => c.name);
    expect(names).toEqual(["PI Two", "PI Four", "Author One", "Author Three"]);
  });
  it("keeps provider roles and only a real http(s) url", () => {
    expect(
      providerViews(
        coll({
          providers: [
            { name: "MBON BioTrack", roles: ["producer"], url: "https://marinebon.org/" },
            { name: "Local", roles: ["host"], url: "javascript:alert(1)" },
            { name: " " },
          ],
        }),
      ),
    ).toEqual([
      { name: "MBON BioTrack", roles: ["producer"], url: "https://marinebon.org/" },
      { name: "Local", roles: ["host"], url: null },
    ]);
  });
});

describe("assets", () => {
  it("labels the media type, prints the size, resolves the href and puts data first", () => {
    const rows = assetViews(
      coll({
        assets: {
          style: {
            href: "./style.json",
            type: "application/vnd.mapbox.style+json",
            "file:size": 956,
          } as never,
          hex: {
            href: "./hex.pmtiles",
            type: "application/vnd.pmtiles",
            roles: ["data"],
            title: "10 km hexagon grid",
            "file:size": 11_620_162,
          } as never,
        },
      }),
    );
    expect(rows).toEqual([
      {
        key: "hex",
        title: "10 km hexagon grid",
        type: "PMTiles",
        size: "11.6 MB",
        href: "https://atlas.test/atlas/c/hex.pmtiles",
      },
      {
        key: "style",
        title: "style",
        type: "map style (JSON)",
        size: "956 B",
        href: "https://atlas.test/atlas/c/style.json",
      },
    ]);
  });
  it("falls back to item_assets (one per item) when the collection has no assets", () => {
    const rows = assetViews(
      coll({
        item_assets: {
          data: {
            type: "application/vnd.apache.parquet",
            roles: ["data"],
            title: "Per-taxon surfaces",
          },
        },
      } as never),
    );
    expect(rows).toEqual([
      {
        key: "data",
        title: "Per-taxon surfaces (one per item)",
        type: "Parquet",
        size: null,
        href: null,
      },
    ]);
  });
  it("names the COG media type and passes an unknown one through", () => {
    expect(assetTypeLabel("image/tiff; application=geotiff; profile=cloud-optimized")).toBe(
      "GeoTIFF (COG)",
    );
    expect(assetTypeLabel("application/x-thing")).toBe("application/x-thing");
    expect(assetTypeLabel(undefined)).toBe("file");
  });
});

describe("dimensions, time and extent", () => {
  it("summarizes cube:dimensions values, using atlas:labels and {value,label} entries", () => {
    expect(
      dimViews(
        coll({
          "cube:dimensions": {
            season: { type: "other", values: ["summer", "winter"] },
            group: {
              type: "other",
              title: "Group",
              values: [{ value: "all", label: "All species" }, "fish"],
            },
            x: { type: "spatial" },
            m: { values: ["r"], "atlas:labels": { r: "Richness" } },
          },
        }),
      ),
    ).toEqual([
      { label: "season", values: ["summer", "winter"], more: 0 },
      { label: "Group", values: ["All species", "fish"], more: 0 },
      { label: "m", values: ["Richness"], more: 0 },
    ]);
  });
  it("caps a long list at 12 values and counts the rest", () => {
    const values = Array.from({ length: 30 }, (_, i) => `t${i}`);
    const [d] = dimViews(coll({ "cube:dimensions": { taxon: { values } } }));
    expect(d.values).toHaveLength(12);
    expect(d.more).toBe(18);
  });
  it("falls back to summaries arrays without a datacube, skipping sdm:* keys", () => {
    expect(
      dimViews(
        coll({
          summaries: { season: ["summer"], "sdm:response_type": ["mixed"], range: { min: 0 } },
        } as never),
      ),
    ).toEqual([{ label: "season", values: ["summer"], more: 0 }]);
  });

  const withTime = (interval: unknown, extra: Partial<StacCollection> = {}) =>
    coll({ extent: { temporal: { interval } }, ...extra });
  it("prints a closed range, an open range, a single year and the step", () => {
    expect(temporalLabel(withTime([["2000-01-01T00:00:00Z", "2023-12-31T23:59:59Z"]]))).toBe(
      "2000–2023",
    );
    expect(temporalLabel(withTime([["2019-01-01T00:00:00Z", null]]))).toBe("2019–present");
    expect(temporalLabel(withTime([["2025-01-01T00:00:00Z", "2025-12-31T00:00:00Z"]]))).toBe(
      "2025",
    );
    expect(
      temporalLabel(
        withTime([["2000-01-01T00:00:00Z", "2023-12-31T00:00:00Z"]], {
          "sdm:temporal_interval": "seasonal",
        }),
      ),
    ).toBe("2000–2023 (seasonal)");
    expect(temporalLabel(coll())).toBeNull();
  });

  it("reads the first bbox (2D or 3D) and rejects malformed ones", () => {
    expect(bboxOf(coll({ extent: { spatial: { bbox: [[-98, 12, -44, 56]] } } }))).toEqual([
      -98, 12, -44, 56,
    ]);
    expect(bboxOf(coll({ extent: { spatial: { bbox: [[-98, 12, 0, -44, 56, 10]] } } }))).toEqual([
      -98, 12, -44, 56,
    ]);
    expect(bboxOf(coll({ extent: { spatial: { bbox: [[1, 2, 3]] } } }))).toBeNull();
    expect(
      bboxOf(coll({ extent: { spatial: { bbox: [["a", 2, 3, 4]] as unknown as number[][] } } })),
    ).toBeNull();
    expect(bboxOf(coll())).toBeNull();
  });
  it("maps a bbox into the 360 x 180 sketch (x = lon + 180, y = 90 - lat)", () => {
    expect(sketchRect([-180, -90, 180, 90])).toEqual({ x: 0, y: 0, width: 360, height: 180 });
    expect(sketchRect([-98, 12, -44, 56])).toEqual({ x: 82, y: 34, width: 54, height: 44 });
  });
  it("clamps to the world, widens a sliver and draws an antimeridian box full width", () => {
    expect(sketchRect([-200, -100, 200, 100])).toEqual({ x: 0, y: 0, width: 360, height: 180 });
    expect(sketchRect([10, 10, 10, 10])).toMatchObject({ width: 2, height: 2 });
    expect(sketchRect([170, 0, -170, 10])).toMatchObject({ x: 0, width: 360 });
  });
  it("ships a world outline path in the same space", () => {
    expect(WORLD_PATH.startsWith("M")).toBe(true);
    expect(WORLD_PATH).toMatch(/Z$/);
  });
});

describe("firstParagraph", () => {
  it("returns the first blank-line-separated paragraph, whitespace collapsed", () => {
    expect(firstParagraph("One  line\nsplit.\n\nSecond paragraph.")).toBe("One line split.");
    expect(firstParagraph(undefined)).toBe("");
  });
});

describe("buildCard", () => {
  const entry = (
    c: StacCollection | null,
    extra: Partial<CollectionEntry> = {},
  ): CollectionEntry => ({
    id: "c",
    title: "A collection",
    href: URL_OF,
    group: "oceanmetrics",
    external: false,
    status: c ? "ok" : "unavailable",
    collection: c,
    error: c ? null : { kind: "http", url: URL_OF, message: "HTTP 404", status: 404 },
    ...extra,
  });

  it("assembles every block from one collection", () => {
    const card = buildCard(
      entry(
        coll({
          description: "First paragraph.\n\nSecond.",
          "sdm:response_type": "mixed",
          "sdm:method": "derived_merge",
          "sci:citation": "Couto et al. (in prep).",
          "sci:doi": "10.1/x",
          "sdm:source_authority": "MBON BioTrack",
          license: "CC-BY-4.0",
          version: "2025.05",
          "atlas:funders": ["BOEM", "NOAA IOOS MBON"],
          links: [
            { rel: "describedby", href: "./README.md" },
            { rel: "item", href: "./items/a.json" },
            { rel: "item", href: "./items/b.json" },
          ],
        }),
      ),
    );
    expect(card).toMatchObject({
      status: "ok",
      description: "First paragraph.",
      responseType: "mixed",
      method: "derived merge",
      itemCount: 2,
      openInMap: "./index.html?c=c",
    });
    expect(card.credits).toMatchObject({
      citation: "Couto et al. (in prep).",
      doiUrl: "https://doi.org/10.1/x",
      sourceAuthority: "MBON BioTrack",
      funders: ["BOEM", "NOAA IOOS MBON"],
      version: "2025.05",
    });
    expect(card.links).toEqual([
      { label: "Methods", href: "https://atlas.test/atlas/c/README.md" },
      { label: "collection.json (STAC)", href: URL_OF },
    ]);
  });

  it("adds a README link only when it differs from the methods link", () => {
    const card = buildCard(
      entry(
        coll({
          links: [
            { rel: "describedby", href: "./methods.html" },
            { rel: "describedby", href: "./README.md", title: "README" },
          ],
        }),
      ),
    );
    expect(card.links.map((l) => l.label)).toEqual(["Methods", "README", "collection.json (STAC)"]);
  });

  it("renders an unavailable external collection as a card that says so", () => {
    const card = buildCard(entry(null, { group: "mst-v8", external: true }));
    expect(card).toMatchObject({
      status: "unavailable",
      unavailableReason: "HTTP 404",
      credits: null,
      openInMap: null,
      itemCount: 0,
    });
    expect(card.links).toEqual([{ label: "collection.json (STAC)", href: URL_OF }]);
  });

  it("never throws on a bare collection", () => {
    const card = buildCard(entry(coll()));
    expect(card.credits).toMatchObject({
      citation: null,
      license: null,
      contacts: [],
      funders: [],
    });
    expect(card.dims).toEqual([]);
    expect(card.temporal).toBeNull();
  });
});

describe("groupCards", () => {
  it("groups the loaded fixture catalog OceanMetrics / v7 / v8, in catalog order, dropping empty groups", async () => {
    const f = fakeFetch();
    const cache: CatalogCache = new Map();
    const res = await loadCatalog({ base: FIXTURE_BASE, fetchImpl: f.fetch, cache });
    if (!res.ok) throw new Error("catalog failed");
    const groups = groupCards(res.value.entries);
    expect(groups.map((g) => [g.group, g.label, g.cards.map((c) => c.id)])).toEqual([
      ["oceanmetrics", "OceanMetrics", ["aquamaps_eov", "biotrack_indicators"]],
      ["mst-v7", "MarineSensitivity v7", ["am_0.05", "rng_iucn"]],
      ["mst-v8", "MarineSensitivity v8", ["gm", "nc"]],
    ]);
  });
  it("lists an unavailable external collection inside its own group", async () => {
    const f = fakeFetch((url) =>
      url.includes("/v8/nc/") ? new Response("", { status: 503 }) : undefined,
    );
    const res = await loadCatalog({ base: FIXTURE_BASE, fetchImpl: f.fetch, cache: new Map() });
    if (!res.ok) throw new Error("catalog failed");
    const v8 = groupCards(res.value.entries).find((g) => g.group === "mst-v8");
    expect(v8?.cards.map((c) => [c.id, c.status])).toEqual([
      ["gm", "ok"],
      ["nc", "unavailable"],
    ]);
  });
});

describe("brand strings", () => {
  it("carries the credit line and the supporter links the map, About and footer share", () => {
    expect(BRAND_CREDIT).toBe("OceanMetrics Atlas · supported by MMA and MBON");
    expect(SUPPORTERS.map((s) => [s.label, s.href])).toEqual([
      ["MMA", "https://marinesensitivity.org"],
      ["MBON", "https://marinebon.org"],
    ]);
    expect(SUPPORTERS.every((s) => s.logo.startsWith("./logos/"))).toBe(true);
    expect(ABOUT_LINKS.map((l) => l.href)).toEqual([
      "https://marinebon.org/data-products/",
      "https://marinebon.org/biotrack/",
      "https://secoora.org",
      "https://oceanmetrics.io/places/",
      "https://github.com/oceanmetrics/atlas",
    ]);
    expect(CATALOG_PAGE_HREF).toBe("./catalog.html");
  });
  it("builds the open-in-map link with an encoded collection id", () => {
    expect(openInMapHref("biotrack_indicators")).toBe("./index.html?c=biotrack_indicators");
    expect(openInMapHref("am_0.05")).toBe("./index.html?c=am_0.05");
    expect(openInMapHref("a b&c")).toBe("./index.html?c=a%20b%26c");
  });
});
