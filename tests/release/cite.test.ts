// P3 fix (Opus eyes-on review, 2026-09-24, desktop-13/14/15 report pages): the AquaMaps `am_0.05`
// dataset's own published `citation` runs "Unported" and "License" together with no space
// ("Creative Commons Attribution-NonCommercial 3.0 UnportedLicense, please see ...") -- verified
// against the real v7-v9 `datasets.json` fixtures (`tests/fixtures/species/v7/datasets.json` etc.),
// which are left UNCHANGED here on purpose: the typo is upstream release metadata this repo does
// not generate, so the fix is display-only, applied at read time by `citations()`.
import { describe, expect, it } from "vitest";
import { citations, citedDatasets } from "../../src/lib/release/cite";

const RAW_AQUAMAPS_CITATION =
  "Kaschner, K., K. Kesner-Reyes, C. Garilao, J. Segschneider, J. Rius-Barile, T. Rees, and R. " +
  "Froese. 2019. AquaMaps: Predicted range maps for aquatic species. World wide web electronic " +
  "publication, www.aquamaps.org, Version 10/2019. Content from AquaMaps as provided in this R " +
  "package is licensed under a Creative Commons Attribution-NonCommercial 3.0 UnportedLicense, " +
  "please see http://creativecommons.org/licenses/by-nc/3.0/";

function bootWith(citation: string) {
  return {
    datasets: [
      {
        ds_key: "am_0.05",
        name_display: "AquaMaps SDM",
        citation,
        link_info: "https://www.aquamaps.org",
        sort_order: 1,
      },
    ],
  };
}

describe("citations: AquaMaps 'UnportedLicense' spacing fix", () => {
  it("inserts the missing space -- 'Unported' and 'License' are two words", () => {
    const [c] = citations(bootWith(RAW_AQUAMAPS_CITATION));
    expect(c.citation).toContain("Unported License,");
    expect(c.citation).not.toContain("UnportedLicense");
  });

  it("leaves the rest of the citation verbatim -- named exceptions, not a general rewrite", () => {
    const [c] = citations(bootWith(RAW_AQUAMAPS_CITATION));
    expect(c.citation).toBe(
      RAW_AQUAMAPS_CITATION.replace("UnportedLicense", "Unported License").replace(
        "as provided in this R package",
        "as provided in the msens R package",
      ),
    );
  });

  it("a citation that never had the typo is untouched", () => {
    const clean = "IUCN Red List of Threatened Species. Version 2025-2.";
    const [c] = citations(bootWith(clean));
    expect(c.citation).toBe(clean);
  });

  it("citedDatasets carries the same fixed text through to the Sources list", () => {
    const [c] = citedDatasets(bootWith(RAW_AQUAMAPS_CITATION));
    expect(c.citation).toContain("Unported License,");
  });
});

// R3-B8 (Opus eyes-on review, 2026-09-25, desktop-15-report-scrolled2): "as provided in this R
// package" has no antecedent for "this" once the AquaMaps package's own CITATION text is copied
// verbatim into a report that never mentions any R package elsewhere -- names the package
// (`msens`) the text is actually quoting from. DISPLAY-TIME ONLY, same convention as the
// "UnportedLicense" fix above: retire once msens's own `datasets.json` source text is corrected
// and every bundle republished with it (R3-C4, a separate workflows task).
describe("citations: AquaMaps 'this R package' -> 'the msens R package'", () => {
  it("names the package the upstream text is quoting from", () => {
    const [c] = citations(bootWith(RAW_AQUAMAPS_CITATION));
    expect(c.citation).toContain("as provided in the msens R package");
    expect(c.citation).not.toContain("as provided in this R package");
  });

  it("a citation with no such phrase is untouched", () => {
    const clean = "IUCN Red List of Threatened Species. Version 2025-2.";
    const [c] = citations(bootWith(clean));
    expect(c.citation).toBe(clean);
  });

  it("citedDatasets carries the same fixed text through to the Sources list", () => {
    const [c] = citedDatasets(bootWith(RAW_AQUAMAPS_CITATION));
    expect(c.citation).toContain("as provided in the msens R package");
  });
});
