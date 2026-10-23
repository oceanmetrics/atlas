<script lang="ts">
  // The About dialog (opened from TopBarActions' About button and its phone ⋯ item): what the atlas is,
  // who supports it, where the related products live, how to cite it. Every string and link comes from
  // `lib/brand/instance.ts` (the instance's instance.json), the same file the catalog page footer and the map attribution read, so the
  // credit line cannot drift. The app is the only thing here that varies per build (`appVersion`).
  import Modal from "../lib/ui/Modal.svelte";
  import SupporterLogos from "../lib/brand/SupporterLogos.svelte";
  import Wordmark from "../lib/brand/Wordmark.svelte";
  import {
    ABOUT_DESCRIPTION,
    ABOUT_LINKS,
    BRAND_NAME,
    CATALOG_PAGE_HREF,
    CITE_ATLAS,
    CITE_COLLECTION_NOTE,
    INSTANCE,
    SEAL,
  } from "../lib/brand/instance";
  import { agencyDisplayName, SEAL_MIN_PX, shouldShowSeal } from "../lib/ui/sealVisibility";
  import { appLine, releaseLine, type AboutRelease } from "./aboutRelease";

  interface Props {
    open: boolean;
    onclose: () => void;
    appVersion: string;
    /** the Help menu's Docs destination (Shell.svelte's `docsHref`). */
    helpDocsHref: string;
    /** the app's CHANGELOG, or (an instance with a release) that release's notes. */
    changelogHref: string;
    /** an instance with a release registry: the resolved release; `null` otherwise. */
    release?: AboutRelease | null;
    /** the seal build flag (`VITE_SEAL`, exactly "1" or no seal: fail closed); a prop for tests. */
    sealFlag?: string;
    /** the shown layer's own About (an h3 layer: what it maps, its release, its credit) */
    layerAbout?: { title: string; lines: string[] } | null;
  }
  let {
    open,
    onclose,
    appVersion,
    helpDocsHref,
    changelogHref,
    release = null,
    sealFlag = import.meta.env.VITE_SEAL,
    layerAbout = null,
  }: Props = $props();

  // the agency seal (instance.json `seal`): only on a build with VITE_SEAL=1 whose agency resolves
  // (ui/sealVisibility.ts), never below its minimum size, on a plain plate whose padding is the
  // guide's clear space; a seal image that fails to load is dropped, never a broken image
  let sealFailed = $state(false);
  const showSeal = $derived(!!SEAL && shouldShowSeal(sealFlag, SEAL.agency) && !sealFailed);
  const agencyName = $derived(SEAL ? agencyDisplayName(SEAL.agency) : null);
  const hasCatalogPage = INSTANCE.pages.includes("catalog");
</script>

<Modal {open} title="About {BRAND_NAME}" {onclose}>
  <p class="wordmark" aria-hidden="true">
    <Wordmark size="1.2em" />
  </p>
  <p class="lede">{ABOUT_DESCRIPTION}</p>

  <SupporterLogos testid="about-supporters" />

  <h3>Related</h3>
  <ul class="links" data-testid="about-links">
    {#each ABOUT_LINKS as l (l.href)}
      <li><a href={l.href} target="_blank" rel="noopener">{l.label}</a></li>
    {/each}
    {#if hasCatalogPage}
      <li>
        <a href={CATALOG_PAGE_HREF} data-testid="about-catalog-link"
          >Catalog of collections and credits</a
        >
      </li>
    {/if}
  </ul>

  {#if layerAbout}
    <h3>This layer: {layerAbout.title}</h3>
    <div data-testid="about-layer">
      {#each layerAbout.lines as line (line)}<p class="cite">{line}</p>{/each}
    </div>
  {/if}

  <h3>How to cite this atlas</h3>
  <!-- the per-collection note belongs to an instance with a catalog of collections -->
  <p class="cite">{CITE_ATLAS}.{hasCatalogPage ? ` ${CITE_COLLECTION_NOTE}` : ""}</p>

  <dl class="meta">
    {#if release}
      <dt>Release</dt>
      <dd data-testid="about-release">{releaseLine(release)}</dd>
    {/if}
    <dt>App</dt>
    <dd data-testid="about-app">{appLine(__APP_SOURCE__, appVersion, INSTANCE.id)}</dd>
  </dl>
  {#if release?.restricted}
    <p class="restricted-note">
      This is a pre-release under review, not the public release — see the version chip to switch.
    </p>
  {/if}
  <p class="more">
    <a href={helpDocsHref} target="_blank" rel="noopener">Documentation</a>
    <a href={changelogHref} target="_blank" rel="noopener">What changed</a>
  </p>
  {#if INSTANCE.about.credits}
    <p class="credits">{INSTANCE.about.credits}</p>
  {/if}
  {#if __SEAL__ && showSeal && SEAL}
    <div class="seal-row">
      <span class="seal-plate">
        <img
          src={SEAL.src}
          alt="Seal of the {agencyName}"
          width={SEAL_MIN_PX}
          height={SEAL_MIN_PX}
          loading="lazy"
          onerror={() => (sealFailed = true)}
        />
      </span>
      <span>Prepared for the <b>{agencyName}</b>.</span>
    </div>
  {/if}
</Modal>

<style>
  .wordmark {
    margin: 0 0 var(--space-2);
    font-family: var(--font-display);
    font-size: var(--text-2xl);
    font-weight: 700;
    line-height: var(--leading-tight);
    letter-spacing: var(--tracking-display);
    color: var(--text-primary);
  }
  .wordmark :global(.wm-1) {
    color: var(--text-accent);
  }
  .wordmark :global(.wm-2) {
    font-weight: 400;
    color: var(--text-secondary);
  }
  .lede,
  .cite {
    margin: 0 0 var(--space-3);
    font-size: var(--text-md);
  }
  .cite {
    color: var(--text-secondary);
    font-size: var(--text-sm);
  }
  h3 {
    margin: var(--space-3) 0 var(--space-1);
    font-size: var(--text-sm);
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .links {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    margin: 0 0 var(--space-3);
    padding: 0;
    list-style: none;
    font-size: var(--text-sm);
  }
  .meta {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: var(--space-1) var(--space-3);
    margin: 0 0 var(--space-2);
  }
  .meta dt {
    color: var(--text-secondary);
    font-size: var(--text-sm);
  }
  .meta dd {
    margin: 0;
  }
  .more {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1) var(--space-3);
    margin: 0;
    font-size: var(--text-sm);
  }
  .restricted-note {
    margin: 0 0 var(--space-3);
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--border-control);
    border-radius: var(--radius-control);
    background: var(--surface-sunken);
    color: var(--text-secondary);
    font-size: var(--text-sm);
  }
  .credits {
    margin: var(--space-3) 0 0;
    font-size: var(--text-sm);
    color: var(--text-secondary);
  }
  .seal-row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    margin-top: var(--space-3);
  }
  /* the seal at >= 72 px, unmodified, on a plain plate whose padding IS the clear space (a quarter
     of the seal's own height, the MMA guide p. 4) */
  .seal-plate {
    flex: none;
    display: block;
    box-sizing: content-box;
    padding: 18px;
    background: var(--surface-seal-plate);
    border-radius: var(--radius-card);
  }
  .seal-plate img {
    display: block;
  }
</style>
