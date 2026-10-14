// The About dialog's copy and links, shared with the catalog page footer. Kept apart from brand.ts so
// the map page's static path does not carry it: only the lazily loaded About dialog and the catalog
// page import this file.
import { BRAND_NAME, type BrandLink } from "./brand";

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
