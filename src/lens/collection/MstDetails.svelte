<script lang="ts">
  // The MarineSensitivity part of the Details panel: the taxon's identifiers (WoRMS AphiaID linked to
  // its taxon page, BOTW / GBIF ids, Red List and ESA status) and where the surface comes from. Pure
  // presentation of `lib/catalog/mst/taxon.ts#taxonFacts` plus the collection's `sdm:*` fields.
  import type { TaxonFact } from "../../lib/catalog/mst/taxon";

  interface Props {
    facts: TaxonFact[];
    /** `sdm:source_authority` of the collection (AquaMaps, IUCN, ...). */
    source: string | null;
    /** hand the taxon to the Species lens; omitted when there is none to hand over. */
    onOpenSpecies?: () => void;
  }
  let { facts, source, onOpenSpecies }: Props = $props();
</script>

{#if facts.length > 0 || source}
  <dl class="mst-details" data-testid="mst-details">
    {#each facts as f (f.label)}
      <div class="row">
        <dt>{f.label}</dt>
        <dd>
          {#if f.href}
            <a href={f.href} target="_blank" rel="noopener">{f.value}</a>
          {:else}
            {f.value}
          {/if}
        </dd>
      </div>
    {/each}
    {#if source}
      <div class="row">
        <dt>Source</dt>
        <dd>{source}</dd>
      </div>
    {/if}
  </dl>
  {#if onOpenSpecies}
    <button type="button" class="open-species" onclick={onOpenSpecies}>Open in Species lens</button>
  {/if}
{/if}

<style>
  .mst-details {
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    font-size: var(--text-xs);
  }
  .row {
    display: flex;
    gap: var(--space-2);
  }
  dt {
    flex: none;
    min-width: 7.5rem;
    color: var(--text-secondary);
  }
  dd {
    margin: 0;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .open-species {
    align-self: flex-start;
    padding: 0 var(--space-2);
    border: 1px solid var(--border-control);
    border-radius: var(--radius-pill);
    background: var(--fill-control);
    color: var(--text-primary);
    font: inherit;
    font-size: var(--text-xs);
    cursor: pointer;
  }
</style>
