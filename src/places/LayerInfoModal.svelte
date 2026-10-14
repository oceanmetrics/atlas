<script lang="ts">
  // The info dialog of one gazetteer place layer: title, description, license and attribution,
  // providers and upstream links, feature count, place type, version, updated, status, the README
  // (collapsed "Read more") and links to the layer's page on the places site and its data files. The
  // collection is read once per layer (`layerInfo.ts`); while it loads, or if it cannot be read, the
  // manifest row the list was built from fills what it can and the dialog says the rest is missing.
  import Modal from "../lib/ui/Modal.svelte";
  import DocBody from "../lib/ui/DocBody.svelte";
  import {
    layerInfoModel,
    loadLayerCollection,
    type LayerCollection,
    type LayerInfoModel,
  } from "../lib/gazetteer/layerInfo";
  import type { Layer } from "../lib/gazetteer/vendor/types";

  interface Props {
    open: boolean;
    slug: string;
    /** the manifest row of the layer (what the list shows), when the manifest has one. */
    manifest: Layer | null;
    onclose?: () => void;
  }
  let { open, slug, manifest, onclose }: Props = $props();

  let phase = $state<"loading" | "ready" | "failed">("loading");
  let collection = $state.raw<LayerCollection | null>(null);
  let readMore = $state(false);
  let token = 0;
  let tick = $state(0);

  $effect(() => {
    if (!open) return;
    void tick;
    const mine = ++token;
    const wanted = slug;
    phase = "loading";
    collection = null;
    readMore = false;
    void loadLayerCollection(wanted).then((c) => {
      if (mine !== token) return;
      collection = c;
      phase = c ? "ready" : "failed";
    });
  });

  const model = $derived<LayerInfoModel>(layerInfoModel({ slug, manifest, collection }));
  const fmtCount = (n: number) => n.toLocaleString("en-US");
  const day = (iso: string) => iso.slice(0, 10);
</script>

<Modal {open} title={model.title} {onclose}>
  <div class="info" data-testid="layer-info">
    {#if phase === "loading"}
      <p class="note" role="status">Reading the collection…</p>
    {:else if phase === "failed"}
      <p class="note" role="alert" data-testid="layer-info-partial">
        The collection's own description could not be loaded, so this shows what the place-layer
        list knows.
        <button type="button" class="retry" onclick={() => tick++}>Retry</button>
      </p>
    {/if}

    {#if model.description}
      <p class="description">{model.description}</p>
    {/if}

    <dl class="facts">
      {#if model.featureCount !== null}
        <dt>Features</dt>
        <dd>{fmtCount(model.featureCount)}</dd>
      {/if}
      {#if model.placeType}
        <dt>Place type</dt>
        <dd>{model.placeType.replace(/_/g, " ")}</dd>
      {/if}
      {#if model.version}
        <dt>Version</dt>
        <dd>{model.version}</dd>
      {/if}
      {#if model.updated}
        <dt>Updated</dt>
        <dd>{day(model.updated)}</dd>
      {/if}
      {#if model.status}
        <dt>Status</dt>
        <dd data-testid="layer-info-status">
          {model.status.value}{#if model.status.date}
            ({model.status.date}){/if}{#if model.status.source}
            · <a href={model.status.source} target="_blank" rel="noopener noreferrer">source</a
            >{/if}{#if model.status.note}<span class="sub"> — {model.status.note}</span>{/if}
        </dd>
      {/if}
      {#if model.license}
        <dt>License</dt>
        <dd>
          <strong>{model.license.id}</strong>
          {#if model.license.name !== model.license.id}· {model.license.name}{/if}
          <span class="sub">{model.license.summary}</span>
          {#each model.license.links as l (l.href)}
            <br /><a href={l.href} target="_blank" rel="noopener noreferrer">{l.label}</a>
          {/each}
        </dd>
      {/if}
      {#if model.attribution}
        <dt>Credit</dt>
        <dd>{model.attribution}</dd>
      {/if}
      {#if model.providers.length > 0}
        <dt>Providers</dt>
        <dd>
          <ul>
            {#each model.providers as p (p.name)}
              <li>
                {#if p.url}<a href={p.url} target="_blank" rel="noopener noreferrer">{p.name}</a
                  >{:else}{p.name}{/if}
                {#if p.roles.length > 0}<span class="sub"> · {p.roles.join(", ")}</span>{/if}
              </li>
            {/each}
          </ul>
        </dd>
      {/if}
      {#if model.via.length > 0}
        <dt>Sources</dt>
        <dd>
          <ul>
            {#each model.via as l (l.href)}
              <li><a href={l.href} target="_blank" rel="noopener noreferrer">{l.label}</a></li>
            {/each}
          </ul>
        </dd>
      {/if}
    </dl>

    <ul class="links" aria-label="Links">
      {#each model.links as l (l.href)}
        <li><a href={l.href} target="_blank" rel="noopener noreferrer">{l.label}</a></li>
      {/each}
    </ul>

    {#if model.readmeUrl}
      <details class="readme" bind:open={readMore} data-testid="layer-info-readme">
        <summary>Read more</summary>
        {#if readMore}<DocBody url={model.readmeUrl} />{/if}
      </details>
    {/if}
  </div>
</Modal>

<style>
  .info {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    min-width: 0;
  }
  .info p,
  .info ul {
    margin: 0;
  }
  .note {
    font-size: var(--text-sm);
    color: var(--text-secondary);
  }
  .description {
    font-size: var(--text-sm);
  }
  .facts {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: var(--space-1) var(--space-3);
    margin: 0;
    font-size: var(--text-sm);
  }
  dt {
    color: var(--text-secondary);
  }
  dd {
    margin: 0;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  dd ul {
    list-style: none;
    padding: 0;
  }
  .sub {
    color: var(--text-secondary);
  }
  .links {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1) var(--space-4);
    padding: 0;
    list-style: none;
    font-size: var(--text-sm);
  }
  .readme summary {
    cursor: pointer;
    font-size: var(--text-sm);
    color: var(--text-link);
  }
  .readme[open] summary {
    margin-bottom: var(--space-2);
  }
  .retry {
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
