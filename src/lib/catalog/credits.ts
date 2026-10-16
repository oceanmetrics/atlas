// The credits strip of a collection: citation, license, PIs, funders and the methods link, read from
// the collection's own STAC fields (`sci:citation`, `license`, `contacts`, `atlas:funders`,
// `describedby`). Pure and total: every field is optional and a collection that publishes none of
// them yields an empty block, never an error. Contact e-mail addresses are NEVER carried (the
// strip shows names and organisations only).
import { assetUrl } from "./load";
import { licenseModelOf, type LicenseModel } from "./licenses";
import { noteOf, type CollectionNote } from "./note";
import type { StacCollection, StacContact } from "./types";

export { noteOf, type CollectionNote };

export interface PersonCredit {
  name: string;
  organization?: string;
}

export interface Credits {
  /** the collection's title, for the dialogs the strip opens. */
  title: string | null;
  citation: string | null;
  /** `https://doi.org/...` when `sci:doi` is present. */
  doiUrl: string | null;
  license: string | null;
  /** the `license` link's own URL, else the SPDX page for a known id. */
  licenseUrl: string | null;
  /** what the License modal shows (id, name, summary, license links, attribution); `null` when the
   * collection states no license. */
  licenseModel: LicenseModel | null;
  /** contacts whose role is a principal investigator. */
  pis: PersonCredit[];
  /** the remaining contacts (authors, data managers, ...), when no PI is named they are shown instead. */
  contacts: PersonCredit[];
  funders: string[];
  /** the collection's `atlas:note` (shown prominently); `null` when it has none. */
  note: CollectionNote | null;
  /** the collection's `describedby` README (methods + field dictionary), absolute. */
  methodsUrl: string | null;
  /** a second `describedby` that is a rendered HTML page (the method notebook), opened in a new tab; absent
   * when the collection has none. */
  methodsPageUrl?: string;
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
      title: null,
      citation: null,
      doiUrl: null,
      license: null,
      licenseUrl: null,
      licenseModel: null,
      pis: [],
      contacts: [],
      funders: [],
      note: null,
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
  // the Methods dialog renders MARKDOWN: it takes the first `describedby` that is not an HTML page (a product
  // may describe itself by a rendered notebook AND a README, in either order); the HTML page is then its own link
  const described = collection.links.filter((l) => l.rel === "describedby");
  const isHtml = (l: { href: string; type?: string }) =>
    /html/i.test(l.type ?? "") || /\.html?(?:[?#]|$)/i.test(l.href);
  const methods = described.find((l) => !isHtml(l)) ?? described[0];
  const page = described.find((l) => l !== methods && isHtml(l));
  const pageUrl = page ? assetUrl(collection, page) : null;
  return {
    title: (collection.title ?? "").trim() || null,
    citation: (collection["sci:citation"] ?? "").trim() || null,
    doiUrl: doi ? (/^https?:\/\//.test(doi) ? doi : `https://doi.org/${doi}`) : null,
    license: license || null,
    licenseUrl:
      (licenseLink ? assetUrl(collection, licenseLink) : null) ??
      (license ? spdxUrl(license) : null),
    licenseModel: licenseModelOf(collection),
    pis,
    contacts: others,
    funders: Array.isArray(collection["atlas:funders"])
      ? collection["atlas:funders"].filter(
          (f): f is string => typeof f === "string" && f.trim() !== "",
        )
      : [],
    note: noteOf(collection),
    methodsUrl: methods ? assetUrl(collection, methods) : null,
    ...(pageUrl ? { methodsPageUrl: pageUrl } : {}),
  };
}
