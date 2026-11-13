<script lang="ts">
  // The Collections lens' legend, bottom-right over the map: the shared continuous `Legend.svelte`
  // (ramp, end labels, the layer's histogram and the clicked cell's marker) fed by
  // `mapInputs.ts#collectionMapInputs`. The same component sits inside the phone legend chip.
  import Icon from "../../lib/ui/Icon.svelte";
  import Legend from "../../lib/ui/Legend.svelte";
  import { uid } from "../../lib/ui/uid";
  import { formatCollectionValue, type CollectionLegend } from "./mapInputs";
  import OverlaySwatch from "./OverlaySwatch.svelte";
  import type { CollectionOverlayView } from "./state.svelte";

  interface Props {
    legend: CollectionLegend;
    /** the tile service is confirmed down (src/shell/health.svelte.ts): only a raster item needs it,
     * so a hex legend is never replaced. */
    tilesDown?: boolean;
    /** the legend belongs to a raster (titiler) item. */
    isRaster?: boolean;
    /** WP14: fly the camera to the layer (the button sits in the card's header); omitted = no button. */
    onZoom?: () => void;
    zoomDisabled?: boolean;
    /** the collection's own overlays (`atlas:overlays`): the ones on get a chip under the ramp. */
    overlays?: readonly CollectionOverlayView[];
  }
  let {
    legend,
    tilesDown = false,
    isRaster = false,
    onZoom,
    zoomDisabled = false,
    overlays = [],
  }: Props = $props();
  const titleId = uid("collection-legend-down");
  const shownOverlays = $derived(overlays.filter((o) => o.on));
</script>

{#snippet overlayChips()}
  {#if shownOverlays.length}
    <ul
      class="overlay-chips"
      aria-label="Collection layers on the map"
      data-testid="legend-overlays"
    >
      {#each shownOverlays as o (o.spec.id)}
        <li><OverlaySwatch geometry={o.spec.geometry} color={o.spec.color} />{o.spec.title}</li>
      {/each}
    </ul>
  {/if}
{/snippet}

{#if isRaster && tilesDown}
  <div
    class="collection-legend collection-legend--down"
    role="region"
    aria-labelledby={titleId}
    data-testid="collection-legend"
  >
    <h2 id={titleId}>{legend.title}</h2>
    <p>Map tiles unavailable -- ramp not shown.</p>
  </div>
{:else if legend.kind === "presence"}
  <div
    class="collection-legend"
    role="region"
    aria-labelledby={titleId}
    data-testid="collection-legend"
  >
    <h2 id={titleId} class="presence-title">{legend.title}</h2>
    {#if legend.subtitle}<p class="presence-subtitle">{legend.subtitle}</p>{/if}
    <div class="presence-row">
      <span class="swatch" style="background:{legend.swatch}"></span>
      <span>range (presence)</span>
    </div>
    {@render overlayChips()}
  </div>
{:else}
  <div class="collection-legend" data-testid="collection-legend">
    {#if onZoom}
      <button
        type="button"
        class="legend-zoom"
        aria-label="Zoom to layer"
        data-tooltip="Zoom to layer"
        data-testid="legend-zoom-to-layer"
        disabled={zoomDisabled}
        onclick={onZoom}
      >
        <Icon name="zoomToLayer" size={16} />
      </button>
    {/if}
    <Legend
      title={legend.title}
      subtitle={legend.subtitle}
      stops={legend.stops}
      unit={legend.unit || "value"}
      formatValue={formatCollectionValue}
      histogram={legend.histogram}
      marker={legend.marker}
      ticks={legend.ticks ?? 2}
    />
    {@render overlayChips()}
  </div>
{/if}

<style>
  .collection-legend {
    position: absolute;
    right: var(--space-3);
    /* the same corner and clearance as the species legend: above the map-attribution chip */
    bottom: calc(var(--space-2) + 22px + var(--space-2));
    z-index: 5;
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-control);
    background: var(--surface-raised);
    box-shadow: var(--elev-2);
  }
  /* a right-docked panel fills that corner: float to the left instead (shell.css mirrors the dock) */
  :global(.stage[data-panel-dock="right"]) .collection-legend {
    right: auto;
    left: var(--space-3);
  }
  :global(.stage[data-panel-maximized="true"]) .collection-legend {
    display: none;
  }
  /* WP14: the card's header corner; the title (Legend's own h2) leaves it room */
  .legend-zoom {
    position: absolute;
    top: var(--space-1);
    right: var(--space-1);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border: 0;
    border-radius: var(--radius-control);
    background: none;
    color: var(--text-secondary);
    cursor: pointer;
  }
  .legend-zoom:hover:not(:disabled) {
    color: var(--text-primary);
  }
  .legend-zoom:disabled {
    opacity: 0.35;
    cursor: default;
  }
  .legend-zoom:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: -2px;
  }
  .collection-legend :global(h2) {
    padding-right: 24px;
  }
  .presence-title,
  .collection-legend--down h2 {
    font-size: var(--text-sm);
    margin: 0 0 var(--space-1);
  }
  .presence-subtitle {
    margin: 0 0 var(--space-1);
    font-size: var(--text-sm);
    color: var(--text-secondary);
  }
  .presence-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--text-sm);
  }
  .overlay-chips {
    list-style: none;
    margin: var(--space-2) 0 0;
    padding: var(--space-1) 0 0;
    border-top: 1px solid var(--divider);
    display: flex;
    flex-direction: column;
    gap: 2px;
    max-width: 260px;
    font-size: var(--text-xs);
    color: var(--text-secondary);
  }
  .overlay-chips li {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .swatch {
    width: 18px;
    height: 12px;
    border-radius: 2px;
    border: 1px solid var(--border-control);
  }
</style>
