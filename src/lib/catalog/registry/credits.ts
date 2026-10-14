// Credits for a registry collection's two representations, and the map attribution while it is drawn.
//
//   native      the collection's own credits (`creditsOf(collection)`), unchanged;
//   downscaled  the MarineSensitivity v7 `am_0.05` collection's citation and license, because that is
//               whose surface is on the map when `rep=005`.
//
// KNOWN DEFECT UPSTREAM (om_TODO: "msens: fix msens-v7-am_0.05 STAC license (CC-BY-4.0 vs CC-BY-NC 3.0
// citation)"): that collection's `license` field says CC-BY-4.0 while its own `sci:citation` says
// "Creative Commons Attribution-NonCommercial 3.0". AquaMaps' terms are the NonCommercial ones, so we
// show those for BOTH representations: when the citation says NonCommercial the license is overridden to
// CC-BY-NC-3.0 here. Delete `withCitedLicense` once msens fixes the STAC.
import type { StacCollection, StacLink } from "../types";

/** the MarineSensitivity v7 collection the 0.05 degree surfaces belong to. */
export const AM005_COLLECTION_ID = "msens-v7-am_0.05";
export const AM005_COLLECTION_URL =
  "https://file.marinesensitivity.org/stac/v7/am_0.05/collection.json";
export const CC_BY_NC_3_URL = "https://creativecommons.org/licenses/by-nc/3.0/";

/** what the downscaled surface is called in the legend and the credits. */
export const DOWNSCALED_TITLE =
  "AquaMaps habitat suitability, downscaled 0.05 degree (MarineSensitivity v7)";

/** the line the map attribution carries while an AquaMaps surface is on the map. */
export const AQUAMAPS_ATTRIBUTION = "AquaMaps (Kaschner et al. 2019), CC BY-NC 3.0";

/** the attribution of the layer on screen: AquaMaps' while a registry raster is drawn, else `null`. */
export function registryAttribution(drawing: boolean): string | null {
  return drawing ? AQUAMAPS_ATTRIBUTION : null;
}

const NON_COMMERCIAL_CITATION = /non-?\s?commercial|\bby-nc\b|\bnc 3\.0/i;

/** `collection` with its license set to what its own citation says, when the citation says
 * NonCommercial and the `license` field disagrees (see the header). Any other collection is returned
 * as it is. */
export function withCitedLicense(collection: StacCollection): StacCollection {
  const citation = typeof collection["sci:citation"] === "string" ? collection["sci:citation"] : "";
  if (!NON_COMMERCIAL_CITATION.test(citation)) return collection;
  if (/^CC-BY-NC/i.test((collection.license ?? "").trim())) return collection;
  const links: StacLink[] = [
    ...collection.links.filter((l) => l.rel !== "license"),
    {
      rel: "license",
      href: CC_BY_NC_3_URL,
      type: "text/html",
      title: "CC BY-NC 3.0 Unported (as cited by AquaMaps)",
    },
  ];
  return { ...collection, license: "CC-BY-NC-3.0", links };
}

/**
 * The collection whose credits are shown for the 0.05 degree surface: MarineSensitivity's `am_0.05`
 * with the cited license, titled for what it is, carrying the native collection's note (the same
 * AquaMaps terms apply) and, when it has no citation of its own, the native collection's.
 */
export function downscaledCredits(
  am005: StacCollection,
  native: StacCollection | null,
): StacCollection {
  const cited = withCitedLicense(am005);
  const note = native?.["atlas:note"];
  const ownCitation = typeof cited["sci:citation"] === "string" && cited["sci:citation"].trim();
  return {
    ...cited,
    title: DOWNSCALED_TITLE,
    ...(typeof note === "string" && note.trim() ? { "atlas:note": note } : {}),
    ...(!ownCitation && native?.["sci:citation"] ? { "sci:citation": native["sci:citation"] } : {}),
  };
}
