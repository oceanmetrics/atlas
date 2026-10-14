// The one place the atlas' brand strings and outbound links live: the About dialog, the catalog page
// footer, the map attribution chip and the page <title>s all read from here, so the credit line and
// the supporter links cannot drift between them. Pure data, no DOM, no Svelte (tests/lib-no-svelte).

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

/** the About dialog's one-paragraph description. */
export const ABOUT_DESCRIPTION =
  "The OceanMetrics Atlas is a catalog of species distribution model products with explicit " +
  "credits: every collection names who made it, how to cite it and under what license. It is " +
  "built on STAC and the stac-sdm extension. The data stays in the cloud (cloud-optimized " +
  "PMTiles, Parquet and GeoTIFF read straight from storage) and the app itself is a static site.";

/** outbound links of the About dialog, in display order. */
export const ABOUT_LINKS: readonly BrandLink[] = [
  { label: "MBON Data & Products", href: "https://marinebon.org/data-products/" },
  { label: "BioTrack", href: "https://marinebon.org/biotrack/" },
  { label: "SECOORA", href: "https://secoora.org" },
  { label: "OceanMetrics gazetteer (places)", href: "https://oceanmetrics.io/places/" },
  { label: "Code on GitHub", href: "https://github.com/oceanmetrics/atlas" },
];

/** where the catalog page sits relative to the map page (both entries share one dist/). */
export const CATALOG_PAGE_HREF = "./catalog.html";

export const CITE_ATLAS = `${BRAND_NAME} (2026), oceanmetrics.io/atlas`;
export const CITE_COLLECTION_NOTE =
  "Cite each collection by its own citation, shown in the collection's panel and on the catalog page.";

/** the map page, optionally opened on collection `id` (the `?c=` URL key). */
export function openInMapHref(id: string): string {
  return `./index.html?c=${encodeURIComponent(id)}`;
}
