// The catalog page's view model: pure functions from the loader's STAC objects to exactly the strings
// and links the page prints. Nothing here touches the DOM, `fetch` or Svelte, so every rule (license
// label and link, contact line, DOI link, asset size, temporal label, extent sketch, grouping) is
// asserted by tests/catalog/page-model.test.ts. Every field of a STAC collection is optional: a
// missing one yields an empty value, never a throw, and an unavailable collection (an external one
// that could not be fetched) becomes a card that says so.
import {
  GROUP_LABEL,
  GROUP_ORDER,
  assetUrl,
  type CatalogGroup,
  type CollectionEntry,
} from "../lib/catalog/load";
import type {
  CubeDimension,
  StacAsset,
  StacCollection,
  StacContact,
  StacProvider,
} from "../lib/catalog/types";
import { openInMapHref } from "../lib/brand/brand";
import { licenseModelOf, type LicenseModel } from "../lib/catalog/licenses";

// --- small formatters ---------------------------------------------------------------------------

/** `sci:doi` -> a resolvable URL (a bare `10.x/y`, a `doi:` prefix or an https URL all work). */
export function doiUrl(doi: string | null | undefined): string | null {
  const v = (doi ?? "").trim().replace(/^doi:\s*/i, "");
  if (!v) return null;
  return /^https?:\/\//i.test(v) ? v : `https://doi.org/${v}`;
}

export interface LicenseView {
  label: string;
  url: string | null;
}

/** an SPDX-style id -> its page; `null` for `proprietary`, `various` or anything that is not a plain id. */
export function spdxUrl(id: string): string | null {
  return /^[A-Za-z0-9.+-]+$/.test(id) && !/^(proprietary|various)$/i.test(id)
    ? `https://spdx.org/licenses/${id}.html`
    : null;
}

/** the license as shown: the `license` string, linked to the collection's own `license` link when it
 * has one (absolute against the collection), else to the SPDX page of a plain id. */
export function licenseView(collection: StacCollection): LicenseView | null {
  const label = (collection.license ?? "").trim();
  if (!label) return null;
  const link = collection.links.find((l) => l.rel === "license");
  return { label, url: (link ? assetUrl(collection, link) : null) ?? spdxUrl(label) };
}

/** `11620162` -> `11.6 MB` (decimal units, as file listings print them); `null` for no/bad size. */
export function formatBytes(n: unknown): string | null {
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0) return null;
  if (n < 1000) return `${Math.round(n)} B`;
  const units = ["kB", "MB", "GB", "TB"];
  let v = n;
  let i = -1;
  do {
    v /= 1000;
    i++;
  } while (v >= 999.95 && i < units.length - 1);
  return `${v.toFixed(1)} ${units[i]}`;
}

/** `derived_merge` -> `derived merge`. */
export function humanize(s: string | null | undefined): string {
  return (s ?? "").trim().replace(/[_-]+/g, " ");
}

/** the first paragraph of a description (blank-line separated), whitespace collapsed. */
export function firstParagraph(text: string | null | undefined): string {
  const first = (text ?? "").trim().split(/\n\s*\n/)[0] ?? "";
  return first.replace(/\s+/g, " ").trim();
}

// --- contacts, providers ------------------------------------------------------------------------

export interface ContactView {
  name: string;
  organization: string | null;
  position: string | null;
  roles: string[];
  /** e-mail addresses as TEXT (the page prints them; it never builds a mailto link). */
  emails: string[];
  /** `Name, position, organization <email>` as one printable line. */
  line: string;
}

function strings(v: unknown): string[] {
  return Array.isArray(v)
    ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "").map((x) => x.trim())
    : [];
}

/** one STAC contact as printed; `null` when it carries no name and no organization. */
export function formatContact(c: StacContact): ContactView | null {
  const name = (c.name ?? "").trim();
  const organization = (c.organization ?? "").trim() || null;
  if (!name && !organization) return null;
  const position = (c.position ?? "").trim() || null;
  const emails = (Array.isArray(c.emails) ? c.emails : [])
    .map((e) => (typeof e?.value === "string" ? e.value.trim() : ""))
    .filter(Boolean);
  const head = [name || organization, position, name ? organization : null]
    .filter((x): x is string => !!x)
    .join(", ");
  return {
    name: name || (organization as string),
    organization,
    position,
    roles: strings(c.roles),
    emails,
    line: emails.length > 0 ? `${head} <${emails.join(", ")}>` : head,
  };
}

const isPi = (c: ContactView) => c.roles.some((r) => /principal|^pi$/i.test(r));

/** contacts in print order: principal investigators first, the rest after, each group in source order. */
export function contactViews(collection: StacCollection): ContactView[] {
  const all = (Array.isArray(collection.contacts) ? collection.contacts : [])
    .map(formatContact)
    .filter((c): c is ContactView => c !== null);
  return [...all.filter(isPi), ...all.filter((c) => !isPi(c))];
}

export interface ProviderView {
  name: string;
  roles: string[];
  url: string | null;
}

export function providerViews(collection: StacCollection): ProviderView[] {
  return (Array.isArray(collection.providers) ? collection.providers : [])
    .filter((p): p is StacProvider => !!p && typeof p.name === "string" && p.name.trim() !== "")
    .map((p) => ({
      name: p.name.trim(),
      roles: strings(p.roles),
      url: typeof p.url === "string" && /^https?:\/\//.test(p.url) ? p.url : null,
    }));
}

// --- assets -------------------------------------------------------------------------------------

export interface AssetView {
  key: string;
  title: string;
  /** a short human type: `PMTiles`, `Parquet`, `GeoTIFF (COG)`, ... else the media type. */
  type: string;
  size: string | null;
  href: string | null;
}

export function assetTypeLabel(media: string | undefined): string {
  const t = (media ?? "").toLowerCase();
  if (!t) return "file";
  if (t.includes("pmtiles")) return "PMTiles";
  if (t.includes("parquet")) return "Parquet";
  if (t.includes("geotiff")) return "GeoTIFF (COG)";
  if (t.includes("style+json")) return "map style (JSON)";
  if (t.startsWith("application/json")) return "JSON";
  return media as string;
}

/** the collection's own `assets` (or, for a collection that only declares `item_assets`, those, flagged
 * "per item"), one row each. Data assets first. */
export function assetViews(collection: StacCollection): AssetView[] {
  const own = collection.assets && typeof collection.assets === "object" ? collection.assets : {};
  const declared = Object.entries(own);
  const itemAssets = collection["item_assets"];
  const perItem =
    declared.length === 0 && itemAssets && typeof itemAssets === "object"
      ? Object.entries(itemAssets as Record<string, StacAsset>)
      : [];
  const rows: (AssetView & { data: boolean })[] = [
    ...declared.map(([key, a]) => ({ a, key, per: false })),
    ...perItem.map(([key, a]) => ({ a, key, per: true })),
  ].map(({ a, key, per }) => ({
    key,
    title: (a.title ?? "").trim() || key,
    type: assetTypeLabel(a.type),
    size: formatBytes(a["file:size"]),
    href: a.href ? assetUrl(collection, a) : null,
    data: (a.roles ?? []).includes("data"),
    ...(per ? { title: `${(a.title ?? "").trim() || key} (one per item)` } : {}),
  }));
  rows.sort((x, y) => Number(y.data) - Number(x.data));
  return rows.map((r) => ({
    key: r.key,
    title: r.title,
    type: r.type,
    size: r.size,
    href: r.href,
  }));
}

// --- dimensions, temporal, extent ---------------------------------------------------------------

export interface DimView {
  label: string;
  values: string[];
  /** values beyond the display cap. */
  more: number;
}

const DIM_VALUE_CAP = 12;

function dimValueLabel(d: CubeDimension, v: unknown): string {
  if (v && typeof v === "object" && "value" in v) {
    const o = v as { value: string | number; label?: string };
    return (o.label ?? "").trim() || String(o.value);
  }
  const key = String(v);
  return d["atlas:labels"]?.[key] ?? key;
}

/** one line per selector dimension (`cube:dimensions` entries with values); a collection without a
 * datacube falls back to its `summaries` arrays (the MarineSensitivity collections; `sdm:*` keys are
 * skipped, they have their own row). */
export function dimViews(collection: StacCollection): DimView[] {
  const cap = (label: string, all: string[]): DimView => ({
    label,
    values: all.slice(0, DIM_VALUE_CAP),
    more: Math.max(0, all.length - DIM_VALUE_CAP),
  });
  const dims = collection["cube:dimensions"];
  const out: DimView[] = [];
  if (dims && typeof dims === "object") {
    for (const [key, d] of Object.entries(dims)) {
      if (!d || !Array.isArray(d.values) || d.values.length === 0) continue;
      out.push(
        cap(
          (d.title ?? "").trim() || key,
          d.values.map((v) => dimValueLabel(d, v)),
        ),
      );
    }
  }
  if (out.length > 0) return out;
  const summaries = collection["summaries"];
  if (summaries && typeof summaries === "object") {
    for (const [key, v] of Object.entries(summaries as Record<string, unknown>)) {
      if (key.startsWith("sdm:") || !Array.isArray(v) || v.length === 0) continue;
      if (!v.every((x) => typeof x === "string" || typeof x === "number")) continue;
      out.push(cap(key, v.map(String)));
    }
  }
  return out;
}

function year(iso: unknown): string | null {
  if (typeof iso !== "string") return null;
  const m = /^(-?\d{4})/.exec(iso);
  return m ? m[1] : null;
}

/** `2000-2023`, `2019-present`, `2025`; followed by ` (seasonal)` etc. from `sdm:temporal_interval`.
 * `null` when the collection says nothing about time. */
export function temporalLabel(collection: StacCollection): string | null {
  const ext = collection.extent as { temporal?: { interval?: unknown } } | undefined;
  const interval = ext?.temporal?.interval;
  const first = Array.isArray(interval) && Array.isArray(interval[0]) ? interval[0] : null;
  const start = year(first?.[0]);
  const end = year(first?.[1]);
  let range: string | null = null;
  if (start && end) range = start === end ? start : `${start}–${end}`;
  else if (start) range = `${start}–present`;
  else if (end) range = `until ${end}`;
  const step = humanize(
    typeof collection["sdm:temporal_interval"] === "string"
      ? (collection["sdm:temporal_interval"] as string)
      : "",
  );
  if (range && step) return `${range} (${step})`;
  return range ?? (step || null);
}

export type BBox = [west: number, south: number, east: number, north: number];

/** the first spatial bbox, 4 finite numbers (a 6-number 3D bbox is reduced to its horizontal part). */
export function bboxOf(collection: StacCollection): BBox | null {
  const ext = collection.extent as { spatial?: { bbox?: unknown } } | undefined;
  const raw = ext?.spatial?.bbox;
  const b = Array.isArray(raw) && Array.isArray(raw[0]) ? (raw[0] as unknown[]) : null;
  if (!b || (b.length !== 4 && b.length !== 6)) return null;
  const n = b.map(Number);
  if (!n.every(Number.isFinite)) return null;
  const [w, s, e, nn] = b.length === 4 ? n : [n[0], n[1], n[3], n[4]];
  return [w, s, e, nn];
}

export interface SketchRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** the bbox as a rectangle in the 360 x 180 sketch space (x = lon + 180, y = 90 - lat), clamped to the
 * world and never thinner than 2 units so a tiny extent is still visible. A box crossing the
 * antimeridian (west > east) is drawn as the whole width. */
export function sketchRect(bbox: BBox): SketchRect {
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  const [w0, s0, e0, n0] = bbox;
  const [w, e] = w0 > e0 ? [-180, 180] : [clamp(w0, -180, 180), clamp(e0, -180, 180)];
  const s = clamp(s0, -90, 90);
  const n = clamp(n0, -90, 90);
  const width = Math.max(2, e - w);
  const height = Math.max(2, n - s);
  return {
    x: Math.min(clamp(w + 180, 0, 360 - width), 360 - width),
    y: Math.min(clamp(90 - n, 0, 180 - height), 180 - height),
    width,
    height,
  };
}

// --- one card -----------------------------------------------------------------------------------

export interface CreditsView {
  citation: string | null;
  doiUrl: string | null;
  license: LicenseView | null;
  /** what the License modal shows; `null` when the collection states no license. */
  licenseModel: LicenseModel | null;
  sourceAuthority: string | null;
  contacts: ContactView[];
  providers: ProviderView[];
  funders: string[];
  version: string | null;
}

/** whether a card link is a markdown document, shown rendered in a dialog (Methods, README) rather
 * than as a raw file in a new tab. */
export function isMarkdownLink(href: string): boolean {
  try {
    return /\.(md|markdown)$/i.test(new URL(href).pathname);
  } catch {
    return false;
  }
}

export interface LinkView {
  label: string;
  href: string;
}

export interface CatalogCard {
  id: string;
  title: string;
  group: CatalogGroup;
  external: boolean;
  status: "ok" | "unavailable";
  /** why an unavailable collection is unavailable (e.g. `HTTP 404`); `null` when available. */
  unavailableReason: string | null;
  description: string;
  responseType: string | null;
  method: string | null;
  temporal: string | null;
  dims: DimView[];
  itemCount: number;
  bbox: BBox | null;
  credits: CreditsView | null;
  links: LinkView[];
  assets: AssetView[];
  /** `index.html?c=<id>`; `null` for an unavailable collection (nothing to open). */
  openInMap: string | null;
}

function linkViews(entry: CollectionEntry, c: StacCollection): LinkView[] {
  const out: LinkView[] = [];
  const methods = c.links.find((l) => l.rel === "describedby");
  const methodsHref = methods ? assetUrl(c, methods) : null;
  if (methodsHref) out.push({ label: "Methods", href: methodsHref });
  // a README that is not already the methods link (a second `describedby`, or a markdown link titled README)
  const readme = c.links.find(
    (l) =>
      l !== methods &&
      (l.rel === "describedby" || /readme/i.test(l.title ?? "") || /readme\.md$/i.test(l.href)) &&
      l.rel !== "self",
  );
  const readmeHref = readme ? assetUrl(c, readme) : null;
  if (readmeHref && readmeHref !== methodsHref) out.push({ label: "README", href: readmeHref });
  out.push({ label: "collection.json (STAC)", href: entry.href });
  return out;
}

/** the printable model of one catalog entry. */
export function buildCard(entry: CollectionEntry): CatalogCard {
  const base = {
    id: entry.id,
    title: entry.title,
    group: entry.group,
    external: entry.external,
  };
  const c = entry.collection;
  if (entry.status !== "ok" || !c) {
    return {
      ...base,
      status: "unavailable",
      unavailableReason: entry.error?.message ?? "could not be loaded",
      description: "",
      responseType: null,
      method: null,
      temporal: null,
      dims: [],
      itemCount: 0,
      bbox: null,
      credits: null,
      links: [{ label: "collection.json (STAC)", href: entry.href }],
      assets: [],
      openInMap: null,
    };
  }
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  return {
    ...base,
    status: "ok",
    unavailableReason: null,
    description: firstParagraph(c.description),
    responseType: str(c["sdm:response_type"]) ? humanize(c["sdm:response_type"]) : null,
    method: str(c["sdm:method"]) ? humanize(c["sdm:method"]) : null,
    temporal: temporalLabel(c),
    dims: dimViews(c),
    itemCount: c.links.filter((l) => l.rel === "item").length,
    bbox: bboxOf(c),
    credits: {
      citation: str(c["sci:citation"]),
      doiUrl: doiUrl(c["sci:doi"]),
      license: licenseView(c),
      licenseModel: licenseModelOf(c),
      sourceAuthority: str(c["sdm:source_authority"]),
      contacts: contactViews(c),
      providers: providerViews(c),
      funders: strings(c["atlas:funders"]),
      version: str(c.version),
    },
    links: linkViews(entry, c),
    assets: assetViews(c),
    openInMap: openInMapHref(entry.id),
  };
}

// --- grouping -----------------------------------------------------------------------------------

export interface CardGroup {
  group: CatalogGroup;
  label: string;
  cards: CatalogCard[];
}

/** cards in picker order (OceanMetrics, v7, v8, other), each group in the catalog's own order,
 * empty groups dropped. */
export function groupCards(entries: readonly CollectionEntry[]): CardGroup[] {
  return GROUP_ORDER.map((group) => ({
    group,
    label: GROUP_LABEL[group],
    cards: entries.filter((e) => e.group === group).map(buildCard),
  })).filter((g) => g.cards.length > 0);
}
