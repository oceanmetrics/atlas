import { describe, expect, it } from "vitest";
import { creditsOf } from "../../src/lib/catalog/credits";
import type { StacCollection } from "../../src/lib/catalog/types";

const base = (extra: Partial<StacCollection>): StacCollection =>
  ({
    type: "Collection",
    id: "c",
    links: [],
    "atlas:url": "https://atlas.test/atlas/c/collection.json",
    ...extra,
  }) as StacCollection;

describe("creditsOf: citation, license, PIs, funders, methods", () => {
  it("reads every field from the collection", () => {
    const c = creditsOf(
      base({
        "sci:citation": "  Author, A. (2025). A dataset.  ",
        "sci:doi": "10.1234/abcd",
        license: "CC-BY-4.0",
        contacts: [
          { name: "Pat Investigator", organization: "Org A", roles: ["principal investigator"] },
          { name: "Alex Author", roles: ["author"] },
        ],
        "atlas:funders": ["BOEM", "NOAA IOOS MBON"],
        links: [
          { rel: "describedby", href: "./README.md" },
          { rel: "license", href: "https://creativecommons.org/licenses/by/4.0/" },
        ],
      }),
    );
    expect(c).toEqual({
      citation: "Author, A. (2025). A dataset.",
      doiUrl: "https://doi.org/10.1234/abcd",
      license: "CC-BY-4.0",
      licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
      pis: [{ name: "Pat Investigator", organization: "Org A" }],
      contacts: [{ name: "Alex Author" }],
      funders: ["BOEM", "NOAA IOOS MBON"],
      methodsUrl: "https://atlas.test/atlas/c/README.md",
    });
  });

  it("the methods link is the describedby README resolved against the collection", () => {
    expect(
      creditsOf(base({ links: [{ rel: "describedby", href: "../README.md" }] })).methodsUrl,
    ).toBe("https://atlas.test/atlas/README.md");
  });

  it("with no license link, a plain SPDX id links to the SPDX page; 'proprietary' links nowhere", () => {
    expect(creditsOf(base({ license: "CC-BY-4.0" })).licenseUrl).toBe(
      "https://spdx.org/licenses/CC-BY-4.0.html",
    );
    expect(creditsOf(base({ license: "proprietary" })).licenseUrl).toBeNull();
    expect(creditsOf(base({ license: "see terms of use" })).licenseUrl).toBeNull();
  });

  it("an absolute DOI URL passes through", () => {
    expect(creditsOf(base({ "sci:doi": "https://doi.org/10.1/x" })).doiUrl).toBe(
      "https://doi.org/10.1/x",
    );
  });

  it("REGRESSION: contact e-mail addresses are never carried into the credits", () => {
    const c = creditsOf(
      base({
        contacts: [
          {
            name: "Pat Investigator",
            roles: ["principal investigator"],
            emails: [{ value: "pat@example.test" }],
          },
        ],
      }),
    );
    expect(JSON.stringify(c)).not.toContain("example.test");
    expect(JSON.stringify(c)).not.toContain("@");
  });

  it("a collection that publishes none of it, and a null collection, give an empty block", () => {
    const empty = {
      citation: null,
      doiUrl: null,
      license: null,
      licenseUrl: null,
      pis: [],
      contacts: [],
      funders: [],
      methodsUrl: null,
    };
    expect(creditsOf(base({}))).toEqual(empty);
    expect(creditsOf(null)).toEqual(empty);
  });

  it("nameless contacts are dropped; non-string funders ignored", () => {
    const c = creditsOf(
      base({
        contacts: [{ roles: ["principal investigator"] }, { name: " ", roles: ["author"] }],
        "atlas:funders": ["", "BOEM", 3 as unknown as string],
      }),
    );
    expect(c.pis).toEqual([]);
    expect(c.contacts).toEqual([]);
    expect(c.funders).toEqual(["BOEM"]);
  });
});
