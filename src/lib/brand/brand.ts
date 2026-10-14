// The brand strings the map page needs on its static path: the credit line (map attribution chip,
// catalog footer, About) and the supporter links, plus the open-in-map link. The longer About copy
// lives in about.ts so it only loads with the About dialog. Pure data, no DOM, no Svelte
// (tests/lib-no-svelte).

export const BRAND_NAME = "OceanMetrics Atlas";

export interface BrandLink {
  label: string;
  href: string;
}

/** who supports the atlas (BOEM funds it; MBON hosts BioTrack and the gazetteer's community). */
export const SUPPORTERS: readonly BrandLink[] = [
  { label: "BOEM", href: "https://www.boem.gov" },
  { label: "MBON", href: "https://marinebon.org" },
];

/** the line the map attribution chip and the catalog footer both carry. */
export const BRAND_CREDIT = `${BRAND_NAME} · supported by BOEM and MBON`;

/** the map page, optionally opened on collection `id` (the `?c=` URL key). */
export function openInMapHref(id: string): string {
  return `./index.html?c=${encodeURIComponent(id)}`;
}
