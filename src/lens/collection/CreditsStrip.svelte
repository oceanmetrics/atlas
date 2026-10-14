<script lang="ts">
  // The credits strip under the selectors: every collection says WHO made it and HOW to cite it
  // (CLAUDE.md "Catalog contract"): citation, license, principal investigators, funders and a link to
  // the methods README. Pure presentation of `lib/catalog/credits.ts#creditsOf`; a collection that
  // publishes none of it renders nothing. Never shows an e-mail address.
  import type { Credits } from "../../lib/catalog/credits";
  import DocModal from "../../lib/ui/DocModal.svelte";
  import LicenseModal from "../../lib/ui/LicenseModal.svelte";

  interface Props {
    credits: Credits;
  }
  let { credits }: Props = $props();

  // "Methods" and "License" open as dialogs (the README rendered, the license explained), not as raw
  // files in a new tab; each dialog carries its own link to the raw file / the license text
  let methodsOpen = $state(false);
  let licenseOpen = $state(false);

  const people = $derived(credits.pis.length > 0 ? credits.pis : credits.contacts);
  const peopleLabel = $derived(credits.pis.length > 0 ? "PI" : "Contact");
  const hasAny = $derived(
    !!credits.citation ||
      !!credits.license ||
      people.length > 0 ||
      credits.funders.length > 0 ||
      !!credits.methodsUrl,
  );
</script>

{#if hasAny}
  <dl class="credits" data-testid="credits-strip" aria-label="Credits">
    {#if credits.citation}
      <div class="row">
        <dt>Cite</dt>
        <dd>
          {credits.citation}
          {#if credits.doiUrl}
            <a href={credits.doiUrl} target="_blank" rel="noopener">DOI</a>
          {/if}
        </dd>
      </div>
    {/if}
    {#if credits.license}
      <div class="row">
        <dt>License</dt>
        <dd>
          {#if credits.licenseModel}
            <button
              type="button"
              class="linkish"
              aria-haspopup="dialog"
              data-testid="license-open"
              onclick={() => (licenseOpen = true)}>{credits.license}</button
            >
          {:else if credits.licenseUrl}
            <a href={credits.licenseUrl} target="_blank" rel="noopener">{credits.license}</a>
          {:else}
            {credits.license}
          {/if}
        </dd>
      </div>
    {/if}
    {#if people.length > 0}
      <div class="row">
        <dt>{peopleLabel}{people.length > 1 ? "s" : ""}</dt>
        <dd>
          {people
            .map((p) => (p.organization ? `${p.name} (${p.organization})` : p.name))
            .join("; ")}
        </dd>
      </div>
    {/if}
    {#if credits.funders.length > 0}
      <div class="row">
        <dt>Funders</dt>
        <dd>{credits.funders.join(", ")}</dd>
      </div>
    {/if}
    {#if credits.methodsUrl}
      <div class="row">
        <dt>Methods</dt>
        <dd>
          <button
            type="button"
            class="linkish"
            aria-haspopup="dialog"
            data-testid="methods-open"
            onclick={() => (methodsOpen = true)}>Methods and field dictionary</button
          >
        </dd>
      </div>
    {/if}
  </dl>
  {#if credits.methodsUrl}
    <DocModal
      open={methodsOpen}
      title={`Methods: ${credits.title ?? "collection"}`}
      url={credits.methodsUrl}
      onclose={() => (methodsOpen = false)}
    />
  {/if}
  {#if credits.licenseModel}
    <LicenseModal
      open={licenseOpen}
      title={credits.title ?? "collection"}
      model={credits.licenseModel}
      onclose={() => (licenseOpen = false)}
    />
  {/if}
{/if}

<style>
  .credits {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    margin: 0;
    padding: var(--space-2);
    border: 1px solid var(--border-control);
    border-radius: var(--radius-control);
    background: var(--surface-sunken);
    font-size: var(--text-xs);
  }
  .row {
    display: flex;
    gap: var(--space-2);
  }
  .linkish {
    padding: 0;
    border: 0;
    background: none;
    color: var(--text-link);
    font: inherit;
    text-align: left;
    text-decoration: underline;
    cursor: pointer;
  }
  .linkish:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }
  dt {
    flex: none;
    min-width: 56px;
    color: var(--text-secondary);
  }
  dd {
    margin: 0;
    min-width: 0;
    overflow-wrap: anywhere;
  }
</style>
