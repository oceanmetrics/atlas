// The info dialog of one gazetteer place layer (the "Place layers" list in the Layers panel): what the
// collection says about itself, read from `<gazetteer>/<slug>/collection.json`, falling back to the
// manifest row (`index/layers.json`) the list is built from when the collection cannot be read.
//
// Pure except `loadLayerCollection` (a plain `fetch`, no parquet): the view-model builder
// (`layerInfoModel`) is a function of the manifest row and the parsed collection, tested with the
// published `gebco_undersea` collection as a fixture. Nothing here pulls the places index (hyparquet).
import { GAZETTEER_ROOT, gazetteerDataBase } from "./config";
import type { Layer } from "./vendor/types";
import { licenseInfo, spdxPageUrl, type LicenseInfo } from "../catalog/licenses";
import { resolveHref } from "../catalog/base";

/** the places site's page for one layer (`oceanmetrics/places` web: history router, `/l/<slug>`). */
export const PLACES_SITE = "https://oceanmetrics.io/places/";
export const placesLayerPage = (slug: string): string =>
  `${PLACES_SITE}l/${encodeURIComponent(slug)}`;

/** the two places a collection is read from, in order: the canonical host, then the path-style bucket
 * URL (the canonical host 302s without CORS headers, so a browser can fall short there; the base
 * `catalog/base.ts` documents the same). Deduplicated (a staging override may make them one). */
export function collectionJsonUrls(slug: string, dataBase = gazetteerDataBase()): string[] {
  const path = `${encodeURIComponent(slug)}/collection.json`;
  return [...new Set([`${GAZETTEER_ROOT}${path}`, `${dataBase}${path}`])];
}

export interface LayerCollection {
  /** the parsed `collection.json`. */
  json: Record<string, unknown>;
  /** the URL it was actually read from (relative hrefs resolve against it). */
  url: string;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);

const cache = new Map<string, Promise<LayerCollection | null>>();

/** the collection of `slug`, once per slug; `null` when no URL answers a STAC collection (not cached,
 * so a retry asks again). */
export function loadLayerCollection(
  slug: string,
  fetchImpl: typeof fetch = (...args) => fetch(...args),
  dataBase = gazetteerDataBase(),
): Promise<LayerCollection | null> {
  const hit = cache.get(slug);
  if (hit) return hit;
  const p = (async (): Promise<LayerCollection | null> => {
    for (const url of collectionJsonUrls(slug, dataBase)) {
      try {
        const res = await fetchImpl(url);
        if (!res.ok) continue;
        const json: unknown = await res.json();
        if (isRecord(json) && json.type === "Collection") return { json, url };
      } catch {
        /* the next URL */
      }
    }
    return null;
  })();
  cache.set(slug, p);
  void p.then((r) => {
    if (!r) cache.delete(slug);
  });
  return p;
}

/** forget the cached collections (tests). */
export function clearLayerCollectionCache(): void {
  cache.clear();
}

// --- the view model ---------------------------------------------------------------------------------

export interface InfoLink {
  label: string;
  href: string;
}

export interface InfoProvider {
  name: string;
  roles: string[];
  url: string | null;
}

export interface InfoStatus {
  value: string;
  date: string | null;
  source: string | null;
  note: string | null;
}

export interface LayerInfoModel {
  slug: string;
  title: string;
  /** the collection's description; `null` when it could not be read (or has none). */
  description: string | null;
  /** `true` when the collection could not be loaded: only the manifest's own fields are filled. */
  partial: boolean;
  license: (LicenseInfo & { links: InfoLink[] }) | null;
  attribution: string | null;
  providers: InfoProvider[];
  /** the `via` links: the upstream publisher and the source layers. */
  via: InfoLink[];
  featureCount: number | null;
  placeType: string | null;
  version: string | null;
  updated: string | null;
  status: InfoStatus | null;
  /** the `describedby` README, absolute and fetchable; `null` when the collection names none. */
  readmeUrl: string | null;
  /** the places site's page for the layer, and the data files. */
  links: InfoLink[];
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x.trim()) : [];

function statusOf(raw: unknown, manifest: Layer | null): InfoStatus | null {
  if (isRecord(raw) && str(raw.value)) {
    return {
      value: str(raw.value)!.replace(/_/g, " "),
      date: str(raw.date),
      source: str(raw.source),
      note: str(raw.note),
    };
  }
  const m = manifest?.status;
  if (m && m.value) {
    return {
      value: m.value.replace(/_/g, " "),
      date: m.date || null,
      source: m.source || null,
      note: m.note ?? null,
    };
  }
  return null;
}

function linksOf(json: Record<string, unknown>, rel: string, base: string): InfoLink[] {
  const links = Array.isArray(json.links) ? json.links : [];
  const out: InfoLink[] = [];
  for (const l of links) {
    if (!isRecord(l) || l.rel !== rel) continue;
    const href = str(l.href) ? resolveHref(base, str(l.href)!) : null;
    if (href) out.push({ label: str(l.title) ?? href, href });
  }
  return out;
}

/**
 * What the dialog shows. `collection` is `null` when it could not be read: the model then carries the
 * manifest's own fields (title, license, attribution, feature count, place type, version, updated,
 * status) and `partial: true`, and nothing is invented.
 */
export function layerInfoModel(args: {
  slug: string;
  manifest: Layer | null;
  collection: LayerCollection | null;
}): LayerInfoModel {
  const { slug, manifest, collection } = args;
  const json = collection?.json ?? null;
  const base = collection?.url ?? `${GAZETTEER_ROOT}${encodeURIComponent(slug)}/collection.json`;
  const canonical = `${GAZETTEER_ROOT}${encodeURIComponent(slug)}/collection.json`;

  const licenseId = str(json?.license) ?? manifest?.license ?? null;
  const licenseLinks = json
    ? linksOf(json, "license", base)
    : manifest?.license_url
      ? [{ label: manifest.license_url, href: manifest.license_url }]
      : [];
  const info = licenseInfo(licenseId);
  const license = info
    ? { ...info, url: info.url ?? spdxPageUrl(info.id), links: licenseLinks }
    : licenseLinks.length > 0
      ? { ...licenseInfo("see link")!, links: licenseLinks }
      : null;

  const providers: InfoProvider[] = [];
  if (json && Array.isArray(json.providers)) {
    for (const p of json.providers) {
      if (!isRecord(p) || !str(p.name)) continue;
      providers.push({ name: str(p.name)!, roles: strings(p.roles), url: str(p.url) });
    }
  }

  const readme = json ? linksOf(json, "describedby", base)[0] : undefined;
  const provenance = json?.["gazetteer:provenance"];
  const count = json?.["geoparquet:feature_count"];

  // data files: the collection's own assets resolved against its canonical address, else the
  // conventional names under the slug
  const assets = isRecord(json?.assets) ? (json!.assets as Record<string, unknown>) : {};
  const assetHref = (key: string, fallback: string): string => {
    const a = assets[key];
    const href = isRecord(a) ? str(a.href) : null;
    return (
      (href && resolveHref(canonical, href)) ||
      `${GAZETTEER_ROOT}${encodeURIComponent(slug)}/${fallback}`
    );
  };
  const links: InfoLink[] = [
    { label: "Layer page on oceanmetrics.io/places", href: placesLayerPage(slug) },
    { label: "places.parquet", href: assetHref("places", "places.parquet") },
    { label: "places.pmtiles", href: assetHref("places-tiles", "places.pmtiles") },
  ];

  return {
    slug,
    title: str(json?.title) ?? manifest?.title ?? slug,
    description: str(json?.description),
    partial: !json,
    license,
    attribution: str(json?.["gazetteer:attribution"]) ?? str(manifest?.attribution) ?? null,
    providers,
    via: json ? linksOf(json, "via", base) : [],
    featureCount:
      typeof count === "number" ? count : typeof manifest?.n === "number" ? manifest.n : null,
    placeType: str(json?.["gazetteer:place_type"]) ?? manifest?.place_type ?? null,
    version:
      (isRecord(provenance) ? str(provenance.version) : null) ??
      str(json?.version) ??
      manifest?.version ??
      null,
    updated: str(json?.updated) ?? manifest?.updated ?? manifest?.source_date ?? null,
    status: statusOf(json?.["gazetteer:status"], manifest),
    readmeUrl: readme?.href ?? null,
    links,
  };
}
