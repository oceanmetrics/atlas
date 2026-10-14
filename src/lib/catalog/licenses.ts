// The license of a collection, for the License modal (collection credits strip and the catalog page):
// the SPDX id, its full name, a one-line plain-language summary for the ids the atlas' collections
// use, the collection's own `license` links, and the attribution text to copy. Pure and total: any
// string is accepted, an id we have no wording for says "see the license link", never an error. The
// summaries are orientation, not legal advice; the linked license text is what binds.
import { assetUrl } from "./load";
import type { StacCollection } from "./types";

export interface LicenseInfo {
  /** the id as the collection states it (`CC-BY-4.0`). */
  id: string;
  /** the full name (`Creative Commons Attribution 4.0 International`); the id itself when unknown. */
  name: string;
  /** one plain-language line; "See the license link for the terms of use." when unknown. */
  summary: string;
  /** the SPDX page for a plain id, else `null`. */
  url: string | null;
  /** whether the atlas has wording for this id. */
  known: boolean;
}

interface Known {
  name: string;
  summary: string;
}

const PUBLIC_DOMAIN: Known = {
  name: "Public domain (US Government work)",
  summary:
    "A work of the US Government or dedicated to the public domain: free to use for any purpose; please cite the source.",
};

const KNOWN: Record<string, Known> = {
  "CC-BY-4.0": {
    name: "Creative Commons Attribution 4.0 International",
    summary:
      "Free to share and adapt, including commercially, as long as you credit the creators and say if you changed it.",
  },
  "CC-BY-NC-3.0": {
    name: "Creative Commons Attribution-NonCommercial 3.0 Unported",
    summary:
      "Free to share and adapt for non-commercial use with credit; commercial use needs the owner's permission.",
  },
  "CC0-1.0": {
    name: "CC0 1.0 Universal (public domain dedication)",
    summary:
      "No rights reserved: use it for any purpose without asking; crediting the source is still good practice.",
  },
  "CC-PDDC": {
    name: "Creative Commons Public Domain Dedication and Certification",
    summary: PUBLIC_DOMAIN.summary,
  },
};

const PUBLIC_DOMAIN_ID = /^(public[ -]?domain|pd|us[ -]?gov(ernment)?([ -]work)?|usgov)$/i;

/** an SPDX-style id -> its page; `null` for `proprietary`, `various` or anything that is not a plain id. */
export function spdxPageUrl(id: string): string | null {
  return /^[A-Za-z0-9.+-]+$/.test(id) && !/^(proprietary|various)$/i.test(id)
    ? `https://spdx.org/licenses/${id}.html`
    : null;
}

/** what the atlas says about a license id; `null` for an empty one. Case-insensitive on the id. */
export function licenseInfo(id: string | null | undefined): LicenseInfo | null {
  const raw = (id ?? "").trim();
  if (!raw) return null;
  const known = KNOWN[raw.toUpperCase()] ?? (PUBLIC_DOMAIN_ID.test(raw) ? PUBLIC_DOMAIN : null);
  if (known) {
    return {
      id: raw,
      name: known.name,
      summary: known.summary,
      url: spdxPageUrl(raw),
      known: true,
    };
  }
  return {
    id: raw,
    name: raw,
    summary: "See the license link for the terms of use.",
    url: spdxPageUrl(raw),
    known: false,
  };
}

export interface LicenseLink {
  title: string;
  href: string;
}

export interface LicenseModel {
  info: LicenseInfo;
  /** the collection's `links[rel=license]`, absolute, with their titles (the href when untitled). */
  links: LicenseLink[];
  /** the attribution / citation to copy. */
  attribution: string;
}

/** the attribution to copy: the collection's own citation (with its DOI) when it has one, else a
 * line built from its title, producers and license. */
export function attributionOf(collection: StacCollection): string {
  const citation = (collection["sci:citation"] ?? "").trim();
  const doi = (collection["sci:doi"] ?? "").trim();
  const doiUrl = doi ? (/^https?:\/\//i.test(doi) ? doi : `https://doi.org/${doi}`) : "";
  if (citation) return doiUrl && !citation.includes(doi) ? `${citation} ${doiUrl}` : citation;
  const title = (collection.title ?? collection.id).trim();
  const producers = (collection.providers ?? [])
    .filter((p) => (p.roles ?? []).some((r) => /producer|licensor/i.test(r)))
    .map((p) => (p.name ?? "").trim())
    .filter(Boolean);
  const license = (collection.license ?? "").trim();
  return [
    title + (producers.length > 0 ? ` (${producers.join(", ")})` : ""),
    license ? `License: ${license}.` : "",
    doiUrl,
  ]
    .filter(Boolean)
    .join(". ")
    .replace(/\.\./g, ".");
}

/** the License modal's view model for a collection; `null` when it states no license at all. */
export function licenseModelOf(collection: StacCollection | null): LicenseModel | null {
  if (!collection) return null;
  const links: LicenseLink[] = [];
  for (const l of collection.links) {
    if (l.rel !== "license") continue;
    const href = assetUrl(collection, l);
    if (href) links.push({ title: (l.title ?? "").trim() || href, href });
  }
  const info = licenseInfo(collection.license);
  if (!info && links.length === 0) return null;
  return {
    info: info ?? {
      id: "see link",
      name: "See the license link",
      summary: "See the license link for the terms of use.",
      url: null,
      known: false,
    },
    links,
    attribution: attributionOf(collection),
  };
}
