<script lang="ts">
  // The taxon selector of a taxon collection: v7 MST (AquaMaps 0.05, IUCN range, merged model, ...) or a
  // registry-backed one (AquaMaps native 0.5 degree). Both are the species lens' own search
  // (`SpeciesPicker`: scientific and common names, ranked exact / prefix / word-start / substring) over
  // an index of taxa; a taxon is not a dimension of the collection (16 153 / 17 499 of them), so it is a
  // search, not a `<select>`. The v7 index loads when the collection is opened; a registry's loads at idle
  // or when this field is focused (`source.ensureIndex`), so until it arrives the field shows the current
  // taxon and a search box that starts the load.
  import SpeciesPicker from "../species/SpeciesPicker.svelte";
  import type { TaxaIndex } from "../species/data/picker";

  /** what the field needs of either source (`MstSource`, `RegistrySource`). */
  interface TaxonSource {
    readonly taxa: TaxaIndex | null;
    readonly taxaPhase: "idle" | "loading" | "ready" | "error";
    readonly taxonKey: string | null;
    selectTaxon(key: string): void;
    readonly usOnly?: boolean;
    setUsOnly?(enabled: boolean): void;
    ensureIndex?(): void;
  }

  interface Props {
    source: TaxonSource;
    /** the current taxon's label while the index is not loaded yet (a registry's row is read first). */
    currentLabel?: string | null;
    /** the "Only species in US waters" box (v7 only). */
    showUsFilter?: boolean;
  }
  let { source, currentLabel = null, showUsFilter = true }: Props = $props();

  const current = $derived(
    source.taxonKey && source.taxa ? source.taxa.byKey.get(source.taxonKey) : undefined,
  );
  const shownLabel = $derived(current?.label ?? currentLabel);
</script>

<div class="taxon-field" data-testid="taxon-field">
  <span class="field-label">Taxon</span>
  {#if source.taxaPhase === "error"}
    <p class="error" role="alert">The taxon list could not be loaded.</p>
  {/if}
  {#if shownLabel}
    <p class="current" data-testid="taxon-current">{shownLabel}</p>
  {/if}
  {#if source.taxa}
    <SpeciesPicker
      index={source.taxa}
      selected={source.taxonKey ?? undefined}
      usOnly={source.usOnly ?? false}
      onSelect={(key) => source.selectTaxon(key)}
      onSetUsOnly={(enabled) => source.setUsOnly?.(enabled)}
      onSearchLogged={() => {}}
      onFocusIndex={() => source.ensureIndex?.()}
      {showUsFilter}
    />
  {:else if source.ensureIndex}
    <input
      type="search"
      class="stub"
      aria-label="Search taxa"
      placeholder="Search taxa"
      data-testid="taxon-search-stub"
      onfocus={() => source.ensureIndex?.()}
    />
    {#if source.taxaPhase === "loading"}
      <p role="status" class="note">Loading the taxon list…</p>
    {/if}
  {:else if source.taxaPhase !== "error"}
    <p role="status" class="note">Loading the taxon list…</p>
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
  .stub {
    width: 100%;
    padding: 0 var(--space-3);
    border: 1px solid var(--border-control);
    border-radius: var(--radius-control);
    background: var(--surface-sunken);
    color: var(--text-primary);
    font: inherit;
  }
</style>
