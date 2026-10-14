// The brand strings the map page needs on its static path: the credit line (map attribution chip,
// catalog footer, About) and the supporter links, plus the open-in-map link. The longer About copy
// lives in about.ts so it only loads with the About dialog. Pure data, no DOM, no Svelte
// (tests/lib-no-svelte).

export const BRAND_NAME = "OceanMetrics Atlas";

export interface BrandLink {
  label: string;
  href: string;
}

/** a supporter: label, full name, link, and logo files under `public/logos/` (relative URLs, so the
 * same build runs under any mount path). `logoDark` is the variant for the dark (navy) theme. */
export interface Supporter extends BrandLink {
  name: string;
  logo: string;
  logoDark?: string;
}

/** who supports the atlas (MMA funds the MarineSensitivity work it builds on; MBON hosts BioTrack and
 * the gazetteer's community). Logos: the MMA seal (marinesensitivity.org/branding), the MBON logo
 * (@marinebon/ui), both copied into `public/logos/`. */
export const SUPPORTERS: readonly Supporter[] = [
  {
    label: "MMA",
    name: "Marine Minerals Administration",
    href: "https://marinesensitivity.org",
    logo: "./logos/mma-seal-320.png",
  },
  {
    label: "MBON",
    name: "Marine Biodiversity Observation Network",
    href: "https://marinebon.org",
    logo: "./logos/mbon-logo.png",
    logoDark: "./logos/mbon-logo-white.png",
  },
];

/** the line the map attribution chip and the catalog footer both carry. */
export const BRAND_CREDIT = `${BRAND_NAME} · supported by MMA and MBON`;

/** the map page, optionally opened on collection `id` (the `?c=` URL key). */
export function openInMapHref(id: string): string {
  return `./index.html?c=${encodeURIComponent(id)}`;
}
