// The credits strip of a collection: citation, license, PIs, funders and the methods link, read from
// the collection's own STAC fields (`sci:citation`, `license`, `contacts`, `atlas:funders`,
// `describedby`). Pure and total: every field is optional and a collection that publishes none of
// them yields an empty block, never an error. Contact e-mail addresses are NEVER carried (the
// strip shows names and organisations only).
import { assetUrl } from "./load";
import type { StacCollection, StacContact } from "./types";

export interface PersonCredit {
  name: string;
  organization?: string;
}

export interface Credits {
  citation: string | null;
  /** `https://doi.org/...` when `sci:doi` is present. */
  doiUrl: string | null;
  license: string | null;
  /** the `license` link's own URL, else the SPDX page for a known id. */
  licenseUrl: string | null;
  /** contacts whose role is a principal investigator. */
  pis: PersonCredit[];
  /** the remaining contacts (authors, data managers, ...), when no PI is named they are shown instead. */
  contacts: PersonCredit[];
  funders: string[];
  /** the collection's `describedby` README (methods + field dictionary), absolute. */
  methodsUrl: string | null;
}

function isPi(c: StacContact): boolean {
  return (c.roles ?? []).some((r) => /principal|^pi$/i.test(r));
}

function toCredit(c: StacContact): PersonCredit | null {
  const name = (c.name ?? "").trim();
  if (!name) return null;
  const organization = (c.organization ?? "").trim();
  return organization ? { name, organization } : { name };
}

/** an SPDX-style license id -> its page, or null when the string is not a plain id. */
function spdxUrl(id: string): string | null {
  return /^[A-Za-z0-9.+-]+$/.test(id) && id !== "proprietary" && id !== "various"
    ? `https://spdx.org/licenses/${id}.html`
    : null;
}

export function creditsOf(collection: StacCollection | null): Credits {
  if (!collection) {
    return {
      citation: null,
      doiUrl: null,
      license: null,
      licenseUrl: null,
      pis: [],
      contacts: [],
      funders: [],
      methodsUrl: null,
    };
  }
  const contacts = Array.isArray(collection.contacts) ? collection.contacts : [];
  const pis = contacts
    .filter(isPi)
    .map(toCredit)
    .filter((c): c is PersonCredit => c !== null);
  const others = contacts
    .filter((c) => !isPi(c))
    .map(toCredit)
    .filter((c): c is PersonCredit => c !== null);
  const doi = (collection["sci:doi"] ?? "").trim();
  const license = (collection.license ?? "").trim();
  const licenseLink = collection.links.find((l) => l.rel === "license");
  const methods = collection.links.find((l) => l.rel === "describedby");
  return {
    citation: (collection["sci:citation"] ?? "").trim() || null,
    doiUrl: doi ? (/^https?:\/\//.test(doi) ? doi : `https://doi.org/${doi}`) : null,
    license: license || null,
    licenseUrl:
      (licenseLink ? assetUrl(collection, licenseLink) : null) ??
      (license ? spdxUrl(license) : null),
    pis,
    contacts: others,
    funders: Array.isArray(collection["atlas:funders"])
      ? collection["atlas:funders"].filter(
          (f): f is string => typeof f === "string" && f.trim() !== "",
        )
      : [],
    methodsUrl: methods ? assetUrl(collection, methods) : null,
  };
}
