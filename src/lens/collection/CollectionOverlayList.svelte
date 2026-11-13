<script lang="ts">
  // The "Collection layers" list under the Layers panel's "Data" row: a collection's own vector overlays
  // (`atlas:overlays`: sightings, tracklines, survey hexagons), one checkbox each with a swatch in its colour
  // and the shape of its geometry, in the collection's order (the draw order, top first), so several can be
  // on at once. Under them, when an overlay declares a `filter_field`, ONE checkbox: "Only features matching
  // the selected layer" (`covf=1`), disabled with its reason when the Item names no matching filter.
  // State and rules are the lens' (`state.svelte.ts`, `lib/catalog/overlays.ts`); this file only renders them.
  import OverlaySwatch from "./OverlaySwatch.svelte";
  import type { CollectionLens } from "./state.svelte";

  interface Props {
    lens: CollectionLens;
  }
  let { lens }: Props = $props();

  const onCount = $derived(lens.overlays.filter((o) => o.on).length);
  const filter = $derived(lens.overlayFilter);
</script>

<div class="collection-layers" data-testid="collection-layers">
  <h4 class="heading">
    Collection layers
    <span class="n">{onCount} of {lens.overlays.length} on</span>
  </h4>
  <ul role="group" aria-label="Collection layers">
    {#each lens.overlays as o (o.spec.id)}
      <li>
        <label class="layer" data-overlay-id={o.spec.id}>
          <input
            type="checkbox"
            checked={o.on}
            onchange={(e) => lens.toggleOverlay(o.spec.id, e.currentTarget.checked)}
          />
          <OverlaySwatch geometry={o.spec.geometry} color={o.spec.color} />
          <span class="label">{o.spec.title}</span>
        </label>
      </li>
    {/each}
  </ul>
  {#if filter.offered}
    <label
      class="layer filter"
      class:filter--disabled={!filter.enabled}
      title={filter.reason ?? undefined}
      data-testid="overlay-filter"
    >
      <input
        type="checkbox"
        checked={filter.on && filter.enabled}
        disabled={!filter.enabled}
        title={filter.reason ?? undefined}
        onchange={(e) => lens.setOverlayFilter(e.currentTarget.checked)}
      />
      <span class="label">Only features matching the selected layer</span>
    </label>
  {/if}
</div>

<style>
  .collection-layers {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
  .heading {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    margin: 0;
    font-size: var(--text-sm);
  }
  .n {
    font-size: var(--text-xs);
    font-weight: 400;
    color: var(--text-secondary);
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
  }
  .layer {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-height: 28px;
    font-size: var(--text-sm);
    cursor: pointer;
  }
  .layer input {
    width: 18px;
    height: 18px;
    min-width: 18px;
    margin: 0;
    accent-color: var(--border-control);
    cursor: pointer;
  }
  .label {
    flex: 1 1 auto;
    min-width: 0;
  }
  .filter {
    margin-top: var(--space-1);
    padding-top: var(--space-1);
    border-top: 1px solid var(--divider);
    font-size: var(--text-xs);
    color: var(--text-secondary);
  }
  .filter--disabled,
  .filter--disabled input {
    cursor: not-allowed;
    opacity: 0.6;
  }
</style>
