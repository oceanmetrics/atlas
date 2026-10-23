// The atlas instance this build is for (instances/<id>/instance.json, selected by VITE_INSTANCE and
// aliased as `@instance` in vite.config.ts): the brand strings and links, the default catalog, lens,
// theme and tour, the tool list and the service hosts. Every reader of a brand string imports it from
// here; nothing in src/ names a brand. Pure data, no DOM, no Svelte (tests/lib-no-svelte).
//
// The JSON is typed by `Instance` below with plain strings where the code has a compile-time union
// (Lens, ToolName, CatalogGroup): each consumer narrows its own field against its own union
// (state/types.ts, shell/tools.ts, catalog/load.ts), so an instance can never put a value the build
// does not know into one. instances/instance.schema.json is the contract; tests/instances.test.ts
// validates every instance against it, and vite.config.ts refuses to build an invalid one.
import raw from "@instance/instance.json";

export interface BrandLink {
  label: string;
  href: string;
}

/** a supporter: label, full name, link, and logo files under the instance's `assets/` (page-relative
 * URLs, so the same build runs under any mount path). `logoDark` is the dark (navy) theme variant. */
export interface Supporter extends BrandLink {
  name: string;
  logo: string;
  logoDark?: string;
}

export interface Instance {
  id: string;
  name: string;
  /** three parts (ink, accent, light: "Ocean" "Metrics" "Atlas"), or one string. */
  wordmark: string | readonly [string, string, string];
  title: string;
  description: string;
  og: { siteName: string; siteUrl: string; image?: string; imageAlt?: string };
  favicon: string;
  mark: string;
  supporters: readonly Supporter[];
  credit: string;
  cite: string;
  /** `credits`: an optional "prepared by" line under the links. */
  about: { description: string; links: readonly BrandLink[]; credits?: string };
  catalog: { base: string; groups: readonly { id: string; label: string }[] };
  /** the lenses this instance builds (1.1); `defaults.lens` is one of them. */
  lenses: readonly string[];
  /** `bathymetry` (1.3): the Layers panel's Bathymetry row on a fresh page, `on` or `off` (absent = `off`). */
  defaults: { lens: string; theme: string; tour: string; bathymetry?: "on" | "off" };
  tools: readonly string[];
  /** the HTML entries this instance publishes (1.1), always `index`. */
  pages: readonly string[];
  /** the GitHub repository (owner/name) feedback issues go to and the Docs/changelog links name. */
  repo: string;
  /** the first part of every downloaded figure's file name. */
  download: { prefix: string };
  feedback: { app: string };
  places: { site: string; attribution: string };
  titiler: { host: string };
  /** the release registry, only for an instance that reads one (1.1). */
  release?: { registry: string; preview?: string; access?: "gate"; docs?: string };
  /** the agency seal, only for an instance that may show it (1.1). */
  seal?: { agency: string; src: string };
  /** the report page's strings, for an instance whose `pages` name `report`. */
  report?: { title: string; stem: string };
  /** the gzip budgets scripts/size-budget.mjs holds the build to, in KB (1.1). */
  budget: { static_kb: number; worker_kb: number };
  /** the Ocean Metrics bar (`@oceanmetrics/nav`) above the top bar, or `false` for an instance without it (1.2). */
  nav: false | NavSpec;
  /** Help lists the example views of `lib/tryThese.ts` ("Try these"); absent or false = none. */
  tryThese?: boolean;
}

/** the bar's per-instance settings: `current` marks one item; the rest are the element's own attributes. */
export interface NavSpec {
  current: string;
  items?: readonly { id: string; label: string; href: string; door?: boolean }[];
  /** a file under the instance's `assets/` (page-relative), shown instead of the bar's own mark. */
  mark?: string;
  label?: string;
  changes_href?: string;
}

// `unknown` first: the JSON module types `wordmark` as string[], not the tuple; the schema is what
// guarantees the shape (tests/instances.test.ts, and the build refuses an invalid instance).
export const INSTANCE: Instance = raw as unknown as Instance;

/** the brand name in prose ("OceanMetrics Atlas"). */
export const BRAND_NAME = INSTANCE.name;

/** the line the map attribution chip and the catalog footer both carry. */
export const BRAND_CREDIT = INSTANCE.credit;

export const SUPPORTERS: readonly Supporter[] = INSTANCE.supporters;

/** the About dialog's one-paragraph description, and its outbound links in display order. */
export const ABOUT_DESCRIPTION = INSTANCE.about.description;
export const ABOUT_LINKS: readonly BrandLink[] = INSTANCE.about.links;

/** how to cite the atlas itself. */
export const CITE_ATLAS = INSTANCE.cite;

/** the release registry block (`release`), or `null` for an instance without one. The registry base
 * itself is a data origin and is read through `catalog/base.ts`; this is for the preview origin and
 * the docs book. */
export const RELEASE = INSTANCE.release ?? null;

/** the agency seal (`seal`), or `null` for an instance that never shows one. Whether it renders is
 * `ui/sealVisibility.ts#shouldShowSeal` (the `VITE_SEAL` build flag too, fail closed). */
export const SEAL = INSTANCE.seal ?? null;

/** the report page's strings (`report`), or `null`. */
export const REPORT = INSTANCE.report ?? null;

/** the GitHub repository (owner/name) feedback issues are filed in. */
export const REPO = INSTANCE.repo;

/** the first part of every downloaded figure's file name. */
export const DOWNLOAD_PREFIX = INSTANCE.download.prefix;

/** the wordmark's parts (one string is one part). */
export const WORDMARK: readonly string[] =
  typeof INSTANCE.wordmark === "string" ? [INSTANCE.wordmark] : INSTANCE.wordmark;

/** the wordmark as plain text, the way it reads in the top bar: three parts are the first two run
 * together, a space, then the third ("OceanMetrics Atlas"); one part as is ("Marine Sensitivity
 * Atlas"). For prose that names the atlas the way its heading does (the Scores lens' welcome). */
export const WORDMARK_TEXT =
  WORDMARK.length === 3 ? `${WORDMARK[0]}${WORDMARK[1]} ${WORDMARK[2]}` : WORDMARK.join(" ");

// --- the same for every instance ------------------------------------------------------------------

export const CITE_COLLECTION_NOTE =
  "Cite each collection by its own citation, shown in the collection's panel and on the catalog page.";

/** where the catalog page sits relative to the map page (both entries share one dist/). */
export const CATALOG_PAGE_HREF = "./catalog.html";

/** the map page, optionally opened on collection `id` (the `?c=` URL key). */
export function openInMapHref(id: string): string {
  return `./index.html?c=${encodeURIComponent(id)}`;
}

/** the Ocean Metrics bar's settings, or `null` for an instance without the bar (`nav: false`). */
export const NAV: NavSpec | null = navOf(INSTANCE);

/** the GEBCO sea floor is on by default (instance `defaults.bathymetry`, schema 1.3): the oceanmetrics instance draws it
 * on every map (Ben 2026-10-22: the bathymetric basemap goes everywhere); an instance whose look is its own (the
 * MarineSensitivity Atlas) keeps its basemap and offers the Bathymetry row as a choice in the Layers panel */
export const BATHYMETRY_DEFAULT_ON: boolean = INSTANCE.defaults.bathymetry === "on";

/** an instance's bar settings, or `null` when it says `nav: false`. */
export function navOf(instance: Pick<Instance, "nav">): NavSpec | null {
  return instance.nav === false ? null : instance.nav;
}
