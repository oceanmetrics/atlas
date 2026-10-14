<script lang="ts">
  // The About dialog (opened from TopBarActions' About button and its phone ⋯ item): what the atlas is,
  // who supports it, where the related products live, how to cite it. Every string and link comes from
  // `lib/brand/brand.ts` and `about.ts`, the same files the catalog page footer and the map attribution read, so the
  // credit line cannot drift. The app is the only thing here that varies per build (`appVersion`).
  import Modal from "../lib/ui/Modal.svelte";
  import { BRAND_NAME, SUPPORTERS } from "../lib/brand/brand";
  import {
    ABOUT_DESCRIPTION,
    ABOUT_LINKS,
    CATALOG_PAGE_HREF,
    CITE_ATLAS,
    CITE_COLLECTION_NOTE,
  } from "../lib/brand/about";

  interface Props {
    open: boolean;
    onclose: () => void;
    appVersion: string;
    /** the Help menu's Docs destination (Shell.svelte's `docsHref`). */
    helpDocsHref: string;
    /** the app's CHANGELOG. */
    changelogHref: string;
  }
  let { open, onclose, appVersion, helpDocsHref, changelogHref }: Props = $props();
</script>

<Modal {open} title="About {BRAND_NAME}" {onclose}>
  <p class="wordmark" aria-hidden="true">
    <span class="wm-ocean">Ocean</span><span class="wm-metrics">Metrics</span>
    <span class="wm-atlas">Atlas</span>
  </p>
  <p class="lede">{ABOUT_DESCRIPTION}</p>

  <p class="support" data-testid="about-supporters">
    Supported by
    {#each SUPPORTERS as s, i (s.href)}{#if i > 0}{i === SUPPORTERS.length - 1
          ? " and "
          : ", "}{/if}<a href={s.href} target="_blank" rel="noopener">{s.label}</a>{/each}.
  </p>

  <h3>Related</h3>
  <ul class="links" data-testid="about-links">
    {#each ABOUT_LINKS as l (l.href)}
      <li><a href={l.href} target="_blank" rel="noopener">{l.label}</a></li>
    {/each}
    <li>
      <a href={CATALOG_PAGE_HREF} data-testid="about-catalog-link"
        >Catalog of collections and credits</a
      >
    </li>
  </ul>

  <h3>How to cite this atlas</h3>
  <p class="cite">{CITE_ATLAS}. {CITE_COLLECTION_NOTE}</p>

  <dl class="meta">
    <dt>App</dt>
    <dd>{BRAND_NAME} {appVersion}</dd>
  </dl>
  <p class="more">
    <a href={helpDocsHref} target="_blank" rel="noopener">Documentation</a>
    <a href={changelogHref} target="_blank" rel="noopener">What changed</a>
  </p>
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
  .wm-metrics {
    color: var(--text-accent);
  }
  .wm-atlas {
    font-weight: 400;
    color: var(--text-secondary);
  }
  .lede,
  .support,
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
</style>
