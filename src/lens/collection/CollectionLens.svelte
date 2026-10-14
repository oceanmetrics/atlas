<script lang="ts">
  // The Collections lens' panel: a collection picker (grouped OceanMetrics / MarineSensitivity v7 / v8),
  // one select per dimension of the chosen collection (derived from `cube:dimensions`, so biotrack
  // shows group / season / metric and a density collection shows its own), a credits strip, and the
  // shared layer stack. It renders UI only: the data loading and the map inputs live in
  // `state.svelte.ts` (a lens-level store the shell instantiates whenever the lens is selected, so a
  // collapsed panel never stops the map from painting -- docs/map.md's 0.10.21 rule).
  import LibLayersPanel, {
    type LayersProjectionControl,
    type LayersRowState,
  } from "../../lib/ui/LayersPanel.svelte";
  import Select, { type SelectOptionGroup } from "../../lib/ui/Select.svelte";
  import { GROUP_LABEL, GROUP_ORDER } from "../../lib/catalog/load";
  import type { LayerStackEntry, Sel } from "../../lib/state/types";
  import { isPlacesSelectionEmpty } from "../../lib/state/types";
  import { placesFromHash } from "../../places/model";
  import type { SelStore } from "../../lib/state/sel.svelte";
  import type { MapHandle } from "../../lib/map/map";
  import type { LayerGroupId } from "../../lib/map/layerStack";
  import CellSpeciesPanel from "./CellSpeciesPanel.svelte";
  import CreditsStrip from "./CreditsStrip.svelte";
  import { formatCellValue } from "./mapInputs";
  import type { CollectionLens } from "./state.svelte";

  interface Props {
    lens: CollectionLens;
    layerStack: readonly LayerStackEntry[];
    onLayerStackChange: (next: readonly LayerStackEntry[]) => void;
    sel: Sel;
    selStore: SelStore;
    mapHandle: MapHandle | undefined;
    expandedRow?: LayerGroupId | null;
    onExpandedRowChange?: (id: LayerGroupId | null) => void;
    part?: "layers" | "details";
  }

  let {
    lens,
    layerStack,
    onLayerStackChange,
    sel,
    selStore,
    mapHandle,
    expandedRow,
    onExpandedRowChange,
    part = "layers",
  }: Props = $props();

  // the collection picker: unavailable collections are listed but disabled, so the viewer sees the
  // MarineSensitivity catalog is there even when a part of it cannot be reached right now.
  const collectionGroups = $derived<SelectOptionGroup[]>(
    GROUP_ORDER.map((g) => ({
      label: GROUP_LABEL[g],
      options: lens.entries
        .filter((e) => e.group === g)
        .map((e) => ({
          value: e.id,
          label: e.status === "ok" ? e.title : `${e.title} (unavailable)`,
          disabled: e.status !== "ok",
        })),
    })).filter((g) => g.options.length > 0),
  );

  function onProjChange(checked: boolean) {
    const proj = checked ? "globe" : "mercator";
    selStore.set({ proj });
    mapHandle?.setProjection(proj);
  }
  const projection = $derived<LayersProjectionControl>({
    checked: sel.proj === "globe",
    onChange: onProjChange,
  });

  const rowState = $derived<Partial<Record<LayerGroupId, LayersRowState>>>({
    "data-places": {
      empty: isPlacesSelectionEmpty(sel.sel, placesFromHash(sel.pl).length),
      hint: "— nothing selected",
    },
  });

  const cell = $derived(lens.cell);
</script>

{#snippet detailsContent()}
  <div class="collection-details" data-testid="collection-details">
    {#if lens.entry}
      <p class="collection-title">{lens.entry.title}</p>
    {/if}
    {#if lens.itemTitle}
      <h3>{lens.itemTitle}</h3>
    {/if}
    {#if cell && lens.entry && cell.collection === lens.entry.id}
      <p data-testid="collection-cell">
        Cell <b>{cell.fid}</b>:
        {cell.value === null ? "no value" : formatCellValue(cell.value)}
      </p>
      {#if lens.siblings.length > 1}
        <ul class="siblings" data-testid="collection-siblings">
          {#each lens.siblings as sib (sib.label)}
            <li class:current={sib.current}>
              <span>{sib.label}</span>
              <b>{sib.value === null ? "no value" : formatCellValue(sib.value)}</b>
            </li>
          {/each}
        </ul>
      {/if}
      {#if lens.cellSpecies || lens.speciesPhase !== "idle"}
        {@const cs = lens.cellSpecies}
        <CellSpeciesPanel
          phase={lens.speciesPhase}
          error={lens.speciesError}
          fid={cell.fid}
          season={cs?.season ?? lens.selected.season ?? ""}
          seasonLabel={lens.dims
            .find((d) => d.key === "season")
            ?.values.find((v) => v.value === (cs?.season ?? lens.selected.season))?.label ??
            cs?.season ??
            ""}
          groupLabel={lens.dims
            .find((d) => d.key === "group")
            ?.values.find((v) => v.value === (cs?.group ?? lens.selected.group))?.label ?? "All"}
          list={cs?.list ?? []}
          modeled={cs?.modeled ?? 0}
          share={cs?.share ?? { veryLikely: 0, likely: 0, rest: 100 }}
          stem={lens.entry.id}
        />
      {/if}
      <button type="button" class="clear" onclick={() => lens.clearCell()}>Clear selection</button>
    {:else}
      <p>Click a cell on the map to see its value.</p>
    {/if}
    {#if lens.itemDescription}
      <p class="description">{lens.itemDescription}</p>
    {/if}
  </div>
{/snippet}

{#if part === "details"}
  {@render detailsContent()}
{:else}
  <LibLayersPanel
    stack={layerStack}
    onChange={onLayerStackChange}
    {projection}
    {rowState}
    {expandedRow}
    {onExpandedRowChange}
  >
    {#snippet speciesField()}
      <div class="collection-field" data-testid="collection-field">
        {#if lens.phase === "loading"}
          <p role="status">Loading the catalog…</p>
        {:else if lens.phase === "error"}
          <p class="error" role="alert">
            The catalog could not be loaded ({lens.error?.message ?? "unknown error"}).
            <button type="button" class="retry" onclick={() => lens.reload()}>Retry</button>
          </p>
        {:else if lens.entries.every((e) => e.status !== "ok")}
          <p class="error" role="alert">None of the catalog's collections could be loaded.</p>
        {:else}
          <label class="field">
            <span class="field-label">Collection</span>
            <Select
              label="Collection"
              value={lens.entry?.id ?? ""}
              groups={collectionGroups}
              onchange={(id) => lens.selectCollection(id)}
            />
          </label>

          {#if lens.itemsPhase === "loading"}
            <p role="status">Loading the collection…</p>
          {:else if lens.itemsPhase === "error"}
            <p class="error" role="alert">
              This collection's layers could not be loaded ({lens.itemsError?.message ??
                "unknown"}).
            </p>
          {:else}
            {#each lens.dims as dim (dim.key)}
              <label class="field">
                <span class="field-label" title={dim.description}>{dim.label}</span>
                <Select
                  label={dim.label}
                  value={lens.selected[dim.key] ?? ""}
                  options={dim.values.map((v) => ({
                    value: v.value,
                    label: lens.isAvailable(dim.key, v.value)
                      ? v.label
                      : `${v.label} (not available here)`,
                  }))}
                  onchange={(v) => lens.selectDim(dim.key, v)}
                />
              </label>
            {/each}
            {#if lens.itemsPhase === "ready" && !lens.drawable}
              <p class="note" role="status" data-testid="collection-undrawable">
                This collection's layers cannot be drawn by the Collections lens yet: it publishes
                no hex grid with values and no cloud-optimized GeoTIFF the lens understands.
              </p>
            {:else if lens.valuesLoading}
              <p role="status" class="note">Loading values…</p>
            {:else if lens.valuesError}
              <p class="error" role="alert">
                The values could not be read ({lens.valuesError.message}).
              </p>
            {/if}
          {/if}

          <CreditsStrip credits={lens.credits} />
        {/if}
      </div>
    {/snippet}
    {#snippet dataControls()}
      <div class="data-controls" data-testid="collection-data-controls">
        {#if lens.itemTitle}
          <p class="title">{lens.itemTitle}</p>
        {/if}
        {#if lens.itemDescription}
          <p class="note">{lens.itemDescription}</p>
        {/if}
      </div>
    {/snippet}
  </LibLayersPanel>
{/if}

<style>
  .collection-field {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
  .field-label {
    font-size: var(--text-xs);
    color: var(--text-secondary);
  }
  .note,
  .description {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--text-secondary);
  }
  .title {
    margin: 0;
    font-size: var(--text-sm);
    font-weight: 700;
  }
  .error {
    margin: 0;
    font-size: var(--text-sm);
  }
  .retry,
  .clear {
    margin-left: var(--space-2);
    padding: 0 var(--space-2);
    border: 1px solid var(--border-control);
    border-radius: var(--radius-pill);
    background: var(--fill-control);
    color: var(--text-primary);
    font: inherit;
    font-size: var(--text-xs);
    cursor: pointer;
  }
  .data-controls {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
  .collection-details {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .collection-details h3 {
    margin: 0;
    font-size: var(--text-md);
  }
  .collection-details p {
    margin: 0;
  }
  .collection-title {
    font-size: var(--text-xs);
    color: var(--text-secondary);
  }
  .siblings {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    font-size: var(--text-sm);
  }
  .siblings li {
    display: flex;
    justify-content: space-between;
    color: var(--text-secondary);
  }
  .siblings li.current {
    color: var(--text-primary);
  }
</style>
