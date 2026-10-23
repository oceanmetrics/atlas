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
  about: { description: string; links: readonly BrandLink[] };
  catalog: { base: string; groups: readonly { id: string; label: string }[] };
  /** the lenses this instance builds (1.1); `defaults.lens` is one of them. */
  lenses: readonly string[];
  defaults: { lens: string; theme: string; tour: string };
  tools: readonly string[];
  /** the HTML entries this instance publishes (1.1), always `index`. */
  pages: readonly string[];
  feedback: { app: string };
  places: { site: string; attribution: string };
  titiler: { host: string };
  /** the release registry, only for an instance that reads one (1.1; read from build week 4 step 2). */
  release?: { registry: string; preview?: string; access?: "gate" };
  /** the agency seal, only for an instance that may show it (1.1; read from build week 4 step 2). */
  seal?: { agency: string; src: string };
  /** the gzip budgets scripts/size-budget.mjs holds the build to, in KB (1.1). */
  budget: { static_kb: number; worker_kb: number };
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

/** the wordmark's parts (one string is one part). */
export const WORDMARK: readonly string[] =
  typeof INSTANCE.wordmark === "string" ? [INSTANCE.wordmark] : INSTANCE.wordmark;

// --- the same for every instance ------------------------------------------------------------------

export const CITE_COLLECTION_NOTE =
  "Cite each collection by its own citation, shown in the collection's panel and on the catalog page.";

/** where the catalog page sits relative to the map page (both entries share one dist/). */
export const CATALOG_PAGE_HREF = "./catalog.html";

/** the map page, optionally opened on collection `id` (the `?c=` URL key). */
export function openInMapHref(id: string): string {
  return `./index.html?c=${encodeURIComponent(id)}`;
}
