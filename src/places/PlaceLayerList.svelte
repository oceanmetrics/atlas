<script lang="ts">
  // The "Places" list under the Layers panel's "Place layers" stack row: every gazetteer collection
  // from `index/layers.json` (title, feature count, a colour swatch of its published paint), grouped
  // by theme, each toggleable; the credits of the ones that are on sit beneath. State and rules are in
  // `overlays.svelte.ts` / `overlays.ts`; this file only renders them.
  import type { PlaceOverlays } from "./overlays.svelte";
  import { swatchColor } from "./overlays";
  import Icon from "../lib/ui/Icon.svelte";
  import LayerInfoModal from "./LayerInfoModal.svelte";

  interface Props {
    overlays: PlaceOverlays;
  }
  let { overlays }: Props = $props();

  // the layer whose info dialog is open (one dialog, re-pointed per layer; created on first use)
  let infoSlug = $state<string | null>(null);

  const count = (n: number | null) => (n === null ? "" : n.toLocaleString("en-US"));
</script>

<div class="place-layers" data-testid="place-layers">
  <h4 class="heading">
    Places
    {#if overlays.layers.length}<span class="n"
        >{overlays.on.length} of {overlays.layers.length} on</span
      >{/if}
  </h4>

  {#if overlays.phase === "loading" && !overlays.layers.length}
    <p class="note" role="status">Loading the place layers…</p>
  {:else if overlays.phase === "error"}
    <p class="note" role="alert">
      The place layers could not be loaded ({overlays.error}).
      <button type="button" class="retry" onclick={() => overlays.reload()}>Retry</button>
    </p>
  {:else}
    <div class="scroll" role="group" aria-label="Place layers">
      {#each overlays.groups as group (group.theme)}
        <section class="group">
          {#if group.label}<h5>{group.label}</h5>{/if}
          <ul>
            {#each group.layers as layer (layer.slug)}
              <li class="row">
                <label class="layer">
                  <input
                    type="checkbox"
                    checked={overlays.isOn(layer.slug)}
                    onchange={(e) => overlays.toggle(layer.slug, e.currentTarget.checked)}
                  />
                  <span class="swatch" style:background={swatchColor(layer)} aria-hidden="true"
                  ></span>
                  <span class="label">{layer.label}</span>
                  {#if layer.n !== null}<span class="count">{count(layer.n)}</span>{/if}
                </label>
                <button
                  type="button"
                  class="info"
                  aria-label={`About ${layer.label}`}
                  aria-haspopup="dialog"
                  data-testid="place-layer-info"
                  onclick={() => (infoSlug = layer.slug)}
                >
                  <Icon name="info" size={14} />
                </button>
              </li>
            {/each}
          </ul>
        </section>
      {/each}
    </div>
    {#if overlays.on.length}
      <button type="button" class="clear" onclick={() => overlays.clear()}
        >Hide all place layers</button
      >
    {/if}
  {/if}

  {#if infoSlug}
    <LayerInfoModal
      open={true}
      slug={infoSlug}
      manifest={overlays.manifestRow(infoSlug) ?? null}
      onclose={() => (infoSlug = null)}
    />
  {/if}

  {#if overlays.credits.length}
    <div class="credits" data-testid="place-layer-credits">
      <h5>Place layer credits</h5>
      <ul>
        {#each overlays.credits as credit (credit.slug)}
          <li><span class="credit-title">{credit.title}:</span> {credit.attribution}</li>
        {/each}
      </ul>
    </div>
  {/if}
</div>

<style>
  .place-layers {
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
  .note {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--text-secondary);
  }
  .scroll {
    max-height: 16rem;
    overflow: auto;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .group h5,
  .credits h5 {
    margin: 0 0 var(--space-1);
    font-size: var(--text-xs);
    font-weight: 600;
    color: var(--text-secondary);
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
  }
  .row {
    display: flex;
    align-items: center;
    gap: var(--space-1);
  }
  .info {
    flex: none;
    display: inline-grid;
    place-items: center;
    width: 24px;
    height: 24px;
    padding: 0;
    border: 0;
    border-radius: var(--radius-control);
    background: none;
    color: var(--icon-muted);
    cursor: pointer;
  }
  .info:hover {
    color: var(--text-primary);
    background: var(--fill-control);
  }
  .info:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 1px;
  }
  .layer {
    flex: 1 1 auto;
    min-width: 0;
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
    accent-color: var(--border-control);
    cursor: pointer;
  }
  .swatch {
    flex: none;
    width: 14px;
    height: 14px;
    border-radius: 3px;
    border: 1px solid var(--border-control);
  }
  .label {
    flex: 1 1 auto;
    min-width: 0;
  }
  .count {
    flex: none;
    font-size: var(--text-xs);
    color: var(--text-secondary);
  }
  .retry,
  .clear {
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
  .credits li {
    font-size: var(--text-xs);
    color: var(--text-secondary);
    margin-bottom: var(--space-1);
  }
  .credit-title {
    font-weight: 600;
  }
</style>
