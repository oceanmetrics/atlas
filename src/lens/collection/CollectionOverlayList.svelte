<script lang="ts">
  // The "Collection layers" list under the Layers panel's "Data" row: a collection's own vector overlays
  // (`atlas:overlays`: sightings, tracklines, survey hexagons), one checkbox each with a swatch in its colour
  // and the shape of its geometry, in the collection's order (the draw order, top first), so several can be
  // on at once. Under them, when an overlay declares a `filter_field`, ONE checkbox: "Only features matching
  // the selected layer" (`covf=1`), disabled with its reason when the Item names no matching filter.
  // State and rules are the lens' (`state.svelte.ts`, `lib/catalog/overlays.ts`); this file only renders them.
  import OverlaySwatch from "./OverlaySwatch.svelte";
  import type { CollectionLens } from "./state.svelte";
  import type { FeatureFilterView } from "../../lib/catalog/featureFilterState";
  import type { FilterOption } from "../../lib/catalog/featureFilters";

  interface Props {
    lens: CollectionLens;
  }
  let { lens }: Props = $props();

  const onCount = $derived(lens.overlays.filter((o) => o.on).length);
  const filter = $derived(lens.overlayFilter);

  // --- "Filter features" (`atlas:overlay_filters`) ---------------------------------------------------------
  const FOLLOW = "__follow";
  const ALL = "__all";
  /** the select's current value: the follow entry, All, or the chosen option's value. */
  function selectValue(f: FeatureFilterView): string {
    const c = f.choice;
    if (c.kind === "follow") return FOLLOW;
    if (c.kind === "option") return String(c.option.value);
    return ALL;
  }
  function onSelect(f: FeatureFilterView, v: string) {
    lens.chooseFeatureFilter(f.spec.id, v === FOLLOW ? "follow" : v === ALL ? "all" : v);
  }
  const optionLabel = (o: FilterOption) => (o.count === null ? o.label : `${o.label} (${o.count})`);
  /** the option whose models "Show model" offers: the chosen one (never the followed default). */
  const chosenOption = (f: FeatureFilterView): FilterOption | null =>
    f.choice.kind === "option" ? f.choice.option : null;
  const layerLabel = (layer: string) =>
    lens.taxonDimension?.values.find((v) => v.value === layer)?.label ?? layer;
  /** the steps of a range: whole numbers from min to max when there are few enough to list. */
  function rangeSteps(min: number, max: number): number[] | null {
    if (!Number.isInteger(min) || !Number.isInteger(max) || max - min > 200) return null;
    return Array.from({ length: max - min + 1 }, (_, i) => min + i);
  }
  function onRange(f: FeatureFilterView, which: "from" | "to", raw: string) {
    if (f.choice.kind !== "range") return;
    const n = Number(raw);
    if (!Number.isFinite(n)) return;
    const from = which === "from" ? n : f.choice.from;
    const to = which === "to" ? n : f.choice.to;
    lens.chooseFeatureFilter(f.spec.id, { from, to });
  }
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

  {#if lens.featureFilters.length}
    <div
      class="feature-filters"
      role="group"
      aria-label="Filter features"
      data-testid="feature-filters"
    >
      <h4 class="heading">Filter features</h4>
      {#each lens.featureFilters as f (f.spec.id)}
        {#if f.spec.type === "select"}
          {@const chosen = chosenOption(f)}
          <label class="ff-field" data-filter-id={f.spec.id}>
            <span class="ff-label">{f.spec.title}</span>
            <select
              aria-label={f.spec.title}
              value={selectValue(f)}
              onchange={(e) => onSelect(f, e.currentTarget.value)}
            >
              {#if f.spec.followDim}<option value={FOLLOW}>{f.followLabel}</option>{/if}
              <option value={ALL}>All</option>
              {#each f.spec.options as o (String(o.value))}
                <option value={String(o.value)}>{optionLabel(o)}</option>
              {/each}
            </select>
          </label>
          {#if chosen && chosen.layers.length && lens.taxonDimension}
            <p class="show-model" data-testid="show-model">
              Show model:
              {#each chosen.layers as layer, i (layer)}
                {#if i > 0}<span aria-hidden="true">·</span>{/if}
                <button type="button" class="linkish" onclick={() => lens.showModel(layer)}
                  >{layerLabel(layer)}</button
                >
              {/each}
            </p>
          {/if}
        {:else if f.choice.kind === "range"}
          {@const steps = rangeSteps(f.spec.min, f.spec.max)}
          <div class="ff-field ff-range" data-filter-id={f.spec.id}>
            <span class="ff-label">{f.spec.title}</span>
            <span class="ff-range-row">
              {#each ["from", "to"] as const as which (which)}
                {@const v = which === "from" ? f.choice.from : f.choice.to}
                {#if steps}
                  <select
                    aria-label={`${f.spec.title} ${which}`}
                    value={String(v)}
                    onchange={(e) => onRange(f, which, e.currentTarget.value)}
                  >
                    {#each steps as y (y)}<option value={String(y)}>{y}</option>{/each}
                  </select>
                {:else}
                  <input
                    type="number"
                    aria-label={`${f.spec.title} ${which}`}
                    min={f.spec.min}
                    max={f.spec.max}
                    value={v}
                    onchange={(e) => onRange(f, which, e.currentTarget.value)}
                  />
                {/if}
                {#if which === "from"}<span class="ff-to">to</span>{/if}
              {/each}
            </span>
          </div>
        {/if}
      {/each}
    </div>
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
  .feature-filters {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    margin-top: var(--space-1);
    padding-top: var(--space-1);
    border-top: 1px solid var(--divider);
  }
  .ff-field {
    display: flex;
    flex-direction: column;
    gap: 2px;
    font-size: var(--text-sm);
  }
  .ff-label {
    font-size: var(--text-xs);
    color: var(--text-secondary);
  }
  .ff-field select,
  .ff-field input {
    min-height: 32px;
    padding: 0 var(--space-2);
    border: 1px solid var(--border-control);
    border-radius: var(--radius-control);
    background: var(--fill-control);
    color: var(--text-primary);
    font: inherit;
    font-size: var(--text-sm);
  }
  .ff-range-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .ff-range-row select,
  .ff-range-row input {
    flex: 1 1 0;
    min-width: 0;
  }
  .ff-to {
    font-size: var(--text-xs);
    color: var(--text-secondary);
  }
  .show-model {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--text-secondary);
  }
  .linkish {
    padding: 0;
    border: 0;
    background: none;
    color: var(--text-link, var(--text-primary));
    font: inherit;
    text-decoration: underline;
    cursor: pointer;
  }
  .linkish:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }
  .filter--disabled,
  .filter--disabled input {
    cursor: not-allowed;
    opacity: 0.6;
  }
</style>
