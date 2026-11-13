// A collection's version facts (STAC version extension, src/lib/catalog/versionLinks.ts): "Version 2", a
// "superseded" note when deprecated, and a link per predecessor/successor/latest relation; a link to this
// app itself opens in the same tab and stays in the deployment being viewed.
import { describe, expect, it } from "vitest";
import type { StacCollection } from "../../src/lib/catalog/types";
import { versionInfoOf, type PageLocation } from "../../src/lib/catalog/versionLinks";

const SITE = "https://oceanmetrics.io/atlas/";
const HERE: PageLocation = { origin: "https://oceanmetrics.io", pathname: "/atlas/" };

function collection(extra: Record<string, unknown> = {}, links: unknown[] = []): StacCollection {
  return {
    type: "Collection",
    id: "sefsc_gomx",
    description: "x",
    links,
    "atlas:url": "https://data.test/atlas-restricted/abc/sefsc_gomx/collection.json",
    ...extra,
  } as unknown as StacCollection;
}

const PRED = {
  rel: "predecessor-version",
  href: "https://oceanmetrics.io/atlas/?c=msens-v8-gm",
  type: "text/html",
  title: "MarineSensitivity v8 density (NOAA SEFSC)",
};

describe("versionInfoOf", () => {
  it("states the version and links the predecessor, which is this app: same tab, this deployment", () => {
    const v = versionInfoOf(collection({ version: "2" }, [PRED]), HERE, SITE)!;
    expect(v.version).toBe("2");
    expect(v.deprecated).toBe(false);
    expect(v.links).toEqual([
      {
        rel: "predecessor-version",
        label: "Previous version",
        title: "MarineSensitivity v8 density (NOAA SEFSC)",
        href: "/atlas/?c=msens-v8-gm",
        sameApp: true,
      },
    ]);
  });

  it("an app link viewed from a preview or a local build stays there (its query on this page's path)", () => {
    const local: PageLocation = { origin: "http://localhost:5173", pathname: "/" };
    const v = versionInfoOf(collection({ version: "2" }, [PRED]), local, SITE)!;
    expect(v.links[0]).toMatchObject({ sameApp: true, href: "/?c=msens-v8-gm" });
  });

  it("a successor and the latest version, in that order after the predecessor; any other site opens apart", () => {
    const v = versionInfoOf(
      collection({ version: "1", deprecated: true }, [
        { rel: "latest-version", href: "https://example.org/sefsc/v3/", title: "v3" },
        { rel: "successor-version", href: "../v2/collection.json", title: "SEFSC v2" },
        PRED,
      ]),
      HERE,
      SITE,
    )!;
    expect(v.deprecated).toBe(true);
    expect(v.links.map((l) => [l.label, l.sameApp, l.href])).toEqual([
      ["Previous version", true, "/atlas/?c=msens-v8-gm"],
      ["Newer version", false, "https://data.test/atlas-restricted/abc/v2/collection.json"],
      ["Latest version", false, "https://example.org/sefsc/v3/"],
    ]);
  });

  it("an untitled link is titled by its address; a non-http(s) link is dropped", () => {
    const v = versionInfoOf(
      collection({ version: "2" }, [
        { rel: "predecessor-version", href: "javascript:alert(1)", title: "x" },
        { rel: "successor-version", href: "https://example.org/v3" },
      ]),
      HERE,
      SITE,
    )!;
    expect(v.links).toEqual([
      {
        rel: "successor-version",
        label: "Newer version",
        title: "https://example.org/v3",
        href: "https://example.org/v3",
        sameApp: false,
      },
    ]);
  });

  it("null for a collection that states no version, no deprecation and no version links", () => {
    expect(
      versionInfoOf(collection({}, [{ rel: "license", href: "https://x.test/" }]), HERE, SITE),
    ).toBeNull();
    expect(versionInfoOf(null, HERE, SITE)).toBeNull();
    expect(versionInfoOf(collection({ deprecated: true }), HERE, SITE)).toEqual({
      version: null,
      deprecated: true,
      links: [],
    });
  });
});
