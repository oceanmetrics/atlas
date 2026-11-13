// A collection's place in a line of versions (the STAC version extension): its `version`, `deprecated`, and
// links `rel: predecessor-version | successor-version | latest-version` (each with `href` and `title`). The
// credits strip shows "Version 2", a "superseded" note for a deprecated one, and a link per relation. A link
// to this app itself (`https://oceanmetrics.io/atlas/?c=...`, the instance's own site, or the page being
// viewed) opens in the same tab and stays in the deployment being viewed (its query on this page's path);
// any other link opens in a new tab. Pure: the page's address is a parameter.
import { INSTANCE } from "../brand/instance";
import { assetUrl } from "./load";
import type { StacCollection } from "./types";

export const VERSION_RELS = ["predecessor-version", "successor-version", "latest-version"] as const;
export type VersionRel = (typeof VERSION_RELS)[number];

export const VERSION_REL_LABEL: Record<VersionRel, string> = {
  "predecessor-version": "Previous version",
  "successor-version": "Newer version",
  "latest-version": "Latest version",
};

export interface VersionLink {
  rel: VersionRel;
  /** "Previous version", "Newer version", "Latest version". */
  label: string;
  title: string;
  href: string;
  /** a link to this app: open it in the same tab. */
  sameApp: boolean;
}

export interface VersionInfo {
  /** the collection's `version`, `null` when it states none. */
  version: string | null;
  deprecated: boolean;
  links: VersionLink[];
}

/** where the page is (`location`), for telling this app's own links apart; `null` outside a browser. */
export interface PageLocation {
  origin: string;
  pathname: string;
}

const appRoot = (u: URL): string => `${u.origin}${u.pathname.replace(/index\.html$/, "")}`;

/**
 * The version facts of a collection, or null when it carries none of them. `here` is the page's own
 * address; `site` the instance's public URL (`instance.json` `og.siteUrl`).
 */
export function versionInfoOf(
  collection: StacCollection | null | undefined,
  here: PageLocation | null = typeof location === "undefined" ? null : location,
  site: string | undefined = INSTANCE.og.siteUrl,
): VersionInfo | null {
  if (!collection) return null;
  const v = collection.version;
  const version = typeof v === "string" && v.trim() ? v.trim() : null;
  const deprecated = collection.deprecated === true;
  const roots = new Set<string>();
  if (here) roots.add(appRoot(new URL(here.pathname, here.origin)));
  if (site) {
    try {
      roots.add(appRoot(new URL(site)));
    } catch {
      // a malformed site url: only the page itself is this app
    }
  }
  const links: VersionLink[] = [];
  for (const rel of VERSION_RELS) {
    const link = collection.links.find((l) => l.rel === rel);
    const abs = link ? assetUrl(collection, link) : null;
    if (!link || !abs) continue;
    let url: URL;
    try {
      url = new URL(abs);
    } catch {
      continue;
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") continue;
    const sameApp = roots.has(appRoot(url));
    const title = typeof link.title === "string" && link.title.trim() ? link.title.trim() : abs;
    links.push({
      rel,
      label: VERSION_REL_LABEL[rel],
      title,
      // this app's own link stays in the deployment being viewed (a preview, a local build)
      href: sameApp && here ? `${here.pathname}${url.search}${url.hash}` : url.href,
      sameApp,
    });
  }
  if (version === null && !deprecated && links.length === 0) return null;
  return { version, deprecated, links };
}
