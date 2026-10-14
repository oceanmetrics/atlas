// WP11 item 9: the License modal's content: one fixture per license id the atlas words (CC-BY-4.0,
// CC-BY-NC-3.0, CC0-1.0, public domain / US Government work) plus the "see link" fallback, the license
// links of a collection (resolved against it) and the attribution to copy.
import { describe, expect, it } from "vitest";
import {
  attributionOf,
  licenseInfo,
  licenseModelOf,
  spdxPageUrl,
} from "../../src/lib/catalog/licenses";
import { creditsOf } from "../../src/lib/catalog/credits";
import { isMarkdownLink } from "../../src/catalog/model";
import type { StacCollection } from "../../src/lib/catalog/types";

const URL_OF = "https://atlas.test/atlas/c/collection.json";
const coll = (extra: Record<string, unknown> = {}) =>
  ({ type: "Collection", id: "c", links: [], "atlas:url": URL_OF, ...extra }) as StacCollection;

describe("licenseInfo: id, full name, one-line summary", () => {
  const cases: [string, string, RegExp][] = [
    ["CC-BY-4.0", "Creative Commons Attribution 4.0 International", /credit the creators/],
    [
      "CC-BY-NC-3.0",
      "Creative Commons Attribution-NonCommercial 3.0 Unported",
      /non-commercial use with credit/,
    ],
    ["CC0-1.0", "CC0 1.0 Universal (public domain dedication)", /No rights reserved/],
    ["public domain", "Public domain (US Government work)", /US Government/],
    ["US-Gov", "Public domain (US Government work)", /free to use/],
    ["CC-PDDC", "Creative Commons Public Domain Dedication and Certification", /public domain/],
  ];
  for (const [id, name, summary] of cases) {
    it(`${id}`, () => {
      const info = licenseInfo(id)!;
      expect(info).toMatchObject({ id, name, known: true });
      expect(info.summary).toMatch(summary);
    });
  }
  it("an id is matched case-insensitively and keeps the collection's own spelling", () => {
    expect(licenseInfo("cc-by-4.0")).toMatchObject({ id: "cc-by-4.0", known: true });
  });
  it("fallback: an unknown id (or free text) says to see the link, never an error", () => {
    expect(licenseInfo("Custom-Terms-7")).toMatchObject({
      id: "Custom-Terms-7",
      name: "Custom-Terms-7",
      known: false,
      summary: "See the license link for the terms of use.",
    });
    expect(licenseInfo("see terms of use")?.known).toBe(false);
  });
  it("no license text: null", () => {
    for (const none of [null, undefined, "", "   "]) expect(licenseInfo(none)).toBeNull();
  });
  it("the SPDX page only for a plain id (not proprietary, various or free text)", () => {
    expect(spdxPageUrl("CC-BY-4.0")).toBe("https://spdx.org/licenses/CC-BY-4.0.html");
    expect(spdxPageUrl("proprietary")).toBeNull();
    expect(spdxPageUrl("various")).toBeNull();
    expect(spdxPageUrl("see terms of use")).toBeNull();
  });
});

describe("licenseModelOf: the dialog's view model", () => {
  it("id, links (title + href, resolved against the collection) and the citation to copy", () => {
    const m = licenseModelOf(
      coll({
        license: "CC-BY-4.0",
        "sci:citation": "Couto, T.B.A. et al. (in prep). Biodiversity indicators.",
        links: [
          {
            rel: "license",
            href: "https://creativecommons.org/licenses/by/4.0/",
            title: "CC BY 4.0 legal code",
          },
          { rel: "license", href: "../LICENSE.txt" },
          { rel: "describedby", href: "./README.md" },
        ],
      }),
    )!;
    expect(m.info.id).toBe("CC-BY-4.0");
    expect(m.links).toEqual([
      { title: "CC BY 4.0 legal code", href: "https://creativecommons.org/licenses/by/4.0/" },
      {
        title: "https://atlas.test/atlas/LICENSE.txt",
        href: "https://atlas.test/atlas/LICENSE.txt",
      },
    ]);
    expect(m.attribution).toBe("Couto, T.B.A. et al. (in prep). Biodiversity indicators.");
  });
  it("a collection with only a license link (no id) still has a dialog", () => {
    const m = licenseModelOf(
      coll({ links: [{ rel: "license", href: "https://example.test/terms", title: "Terms" }] }),
    )!;
    expect(m.info).toMatchObject({ id: "see link", known: false });
    expect(m.links).toEqual([{ title: "Terms", href: "https://example.test/terms" }]);
  });
  it("no license at all: null (the strip shows no License row)", () => {
    expect(licenseModelOf(coll())).toBeNull();
    expect(licenseModelOf(null)).toBeNull();
  });
  it("the credits strip carries it (and the collection's title for the dialog headings)", () => {
    const c = creditsOf(coll({ title: "BioTrack", license: "CC0-1.0" }));
    expect(c.title).toBe("BioTrack");
    expect(c.licenseModel?.info.id).toBe("CC0-1.0");
    expect(creditsOf(coll()).licenseModel).toBeNull();
  });
});

describe("attributionOf: what Copy puts on the clipboard", () => {
  it("the collection's own citation, with its DOI link appended when the citation lacks it", () => {
    expect(attributionOf(coll({ "sci:citation": "A et al. 2025.", "sci:doi": "10.1/x" }))).toBe(
      "A et al. 2025. https://doi.org/10.1/x",
    );
    expect(attributionOf(coll({ "sci:citation": "A et al. 10.1/x", "sci:doi": "10.1/x" }))).toBe(
      "A et al. 10.1/x",
    );
  });
  it("without a citation: title, producers, license and DOI", () => {
    expect(
      attributionOf(
        coll({
          title: "Seamounts",
          license: "CC-BY-4.0",
          providers: [
            { name: "NOAA NCEI", roles: ["producer"] },
            { name: "OceanMetrics", roles: ["host"] },
          ],
        }),
      ),
    ).toBe("Seamounts (NOAA NCEI). License: CC-BY-4.0.");
  });
  it("a bare collection still gives its id", () => {
    expect(attributionOf(coll())).toBe("c");
  });
});

describe("which card links open as a rendered document", () => {
  it("markdown files do; HTML pages and the STAC json do not", () => {
    expect(isMarkdownLink("https://x.test/c/README.md")).toBe(true);
    expect(isMarkdownLink("https://x.test/c/README.MD?v=2")).toBe(true);
    expect(isMarkdownLink("https://x.test/c/methods.html")).toBe(false);
    expect(isMarkdownLink("https://x.test/c/collection.json")).toBe(false);
    expect(isMarkdownLink("not a url")).toBe(false);
  });
});
