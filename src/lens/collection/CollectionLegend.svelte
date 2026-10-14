<script lang="ts">
  // The Collections lens' legend, bottom-right over the map: the shared continuous `Legend.svelte`
  // (ramp, end labels, the layer's histogram and the clicked cell's marker) fed by
  // `mapInputs.ts#collectionMapInputs`. The same component sits inside the phone legend chip.
  import Legend from "../../lib/ui/Legend.svelte";
  import { uid } from "../../lib/ui/uid";
  import { formatCollectionValue, type CollectionLegend } from "./mapInputs";

  interface Props {
    legend: CollectionLegend;
    /** the tile service is confirmed down (src/shell/health.svelte.ts): only a raster item needs it,
     * so a hex legend is never replaced. */
    tilesDown?: boolean;
    /** the legend belongs to a raster (titiler) item. */
    isRaster?: boolean;
  }
  let { legend, tilesDown = false, isRaster = false }: Props = $props();
  const titleId = uid("collection-legend-down");
</script>

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
  </div>
{:else}
  <div class="collection-legend" data-testid="collection-legend">
    <Legend
      title={legend.title}
      subtitle={legend.subtitle}
      stops={legend.stops}
      unit={legend.unit || "value"}
      formatValue={formatCollectionValue}
      histogram={legend.histogram}
      marker={legend.marker}
    />
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
  .swatch {
    width: 18px;
    height: 12px;
    border-radius: 2px;
    border: 1px solid var(--border-control);
  }
</style>
