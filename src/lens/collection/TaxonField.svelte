<script lang="ts">
  // The taxon selector of an MST taxon collection (v7: AquaMaps, IUCN range, merged model, ...): the
  // species lens' own search (`SpeciesPicker`: scientific and common names, ranked exact / prefix /
  // word-start / substring, "Only species in US waters") over the release's `app/taxa.json`. A taxon is
  // not a dimension of the collection (there are 16 153), so it is a search, not a `<select>`.
  import SpeciesPicker from "../species/SpeciesPicker.svelte";
  import type { MstSource } from "./mst.svelte";

  interface Props {
    mst: MstSource;
  }
  let { mst }: Props = $props();

  const current = $derived(mst.taxonKey && mst.taxa ? mst.taxa.byKey.get(mst.taxonKey) : undefined);
</script>

<div class="taxon-field" data-testid="taxon-field">
  <span class="field-label">Taxon</span>
  {#if mst.taxaPhase === "error"}
    <p class="error" role="alert">The taxon list could not be loaded.</p>
  {:else if !mst.taxa}
    <p role="status" class="note">Loading the taxon list…</p>
  {:else}
    {#if current}
      <p class="current" data-testid="taxon-current">{current.label}</p>
    {/if}
    <SpeciesPicker
      index={mst.taxa}
      selected={mst.taxonKey ?? undefined}
      usOnly={mst.usOnly}
      onSelect={(key) => mst.selectTaxon(key)}
      onSetUsOnly={(enabled) => mst.setUsOnly(enabled)}
      onSearchLogged={() => {}}
      onFocusIndex={() => {}}
    />
  {/if}
</div>

<style>
  .taxon-field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
  .field-label {
    font-size: var(--text-xs);
    color: var(--text-secondary);
  }
  .current {
    margin: 0;
    font-size: var(--text-sm);
    font-weight: 700;
  }
  .note,
  .error {
    margin: 0;
    font-size: var(--text-sm);
  }
</style>
