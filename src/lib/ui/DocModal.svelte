<script lang="ts">
  // A markdown document in a Modal: fetches the file, renders it as HTML (`lib/markdown/render.ts`, a
  // safe renderer loaded lazily so the static path does not carry it) and keeps an "Open raw" link to
  // the file itself. Used for a collection's Methods README (the credits strip and the catalog page) and
  // for a place layer's README (the Layers panel's info modal). Fetched once per URL (a small cache);
  // a failure says so and still offers the raw link.
  import Modal from "./Modal.svelte";
  import { renderedDoc, type RenderedDoc } from "./docCache";

  interface Props {
    open: boolean;
    title: string;
    /** absolute URL of the markdown file. */
    url: string;
    onclose?: () => void;
  }
  let { open, title, url, onclose }: Props = $props();

  let doc = $state.raw<RenderedDoc | null>(null);
  let token = 0;
  $effect(() => {
    if (!open) return;
    const mine = ++token;
    const wanted = url;
    doc = null;
    void renderedDoc(wanted).then((d) => {
      if (mine === token) doc = d;
    });
  });
</script>

<Modal {open} {title} {onclose} size="lg">
  <div class="doc" data-testid="doc-modal">
    {#if !doc}
      <p role="status">Loading…</p>
    {:else if !doc.ok}
      <p class="error" role="alert">
        The document could not be loaded ({doc.error}). You can still open the file itself below.
      </p>
    {:else}
      <!-- the HTML is built by `renderMarkdown`, which escapes every piece of text it writes: no raw
           HTML from the file reaches this point (tests/lib/markdown.test.ts) -->
      <!-- eslint-disable-next-line svelte/no-at-html-tags -->
      <div class="md">{@html doc.html}</div>
    {/if}
    <p class="raw">
      <a href={url} target="_blank" rel="noopener noreferrer">Open raw</a>
    </p>
  </div>
</Modal>

<style>
  .doc {
    min-width: 0;
  }
  .raw {
    margin: var(--space-4) 0 0;
    padding-top: var(--space-2);
    border-top: 1px solid var(--divider);
    font-size: var(--text-sm);
  }
  .error {
    color: var(--text-danger, var(--text-primary));
  }
  .md :global(h1),
  .md :global(h2),
  .md :global(h3),
  .md :global(h4) {
    font-family: var(--font-display);
    margin: var(--space-4) 0 var(--space-2);
    line-height: 1.25;
  }
  .md :global(h1) {
    font-size: var(--text-xl);
    margin-top: 0;
  }
  .md :global(h2) {
    font-size: var(--text-lg);
  }
  .md :global(h3),
  .md :global(h4) {
    font-size: var(--text-md);
  }
  .md :global(p),
  .md :global(ul),
  .md :global(ol),
  .md :global(blockquote),
  .md :global(pre) {
    margin: 0 0 var(--space-3);
  }
  .md :global(ul),
  .md :global(ol) {
    padding-left: var(--space-5);
  }
  .md :global(li > ul),
  .md :global(li > ol) {
    margin: var(--space-1) 0 0;
  }
  .md :global(code) {
    font-family: var(--font-mono, ui-monospace, monospace);
    font-size: 0.9em;
    padding: 0 3px;
    border-radius: 3px;
    background: var(--surface-sunken);
  }
  .md :global(pre) {
    overflow: auto;
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-control);
    background: var(--surface-sunken);
  }
  .md :global(pre code) {
    padding: 0;
    background: none;
  }
  .md :global(blockquote) {
    padding-left: var(--space-3);
    border-left: 3px solid var(--divider);
    color: var(--text-secondary);
  }
  .md :global(.md-table) {
    overflow-x: auto;
    margin: 0 0 var(--space-3);
  }
  .md :global(table) {
    border-collapse: collapse;
    font-size: var(--text-sm);
  }
  .md :global(th),
  .md :global(td) {
    padding: var(--space-1) var(--space-2);
    border: 1px solid var(--divider);
    text-align: left;
    vertical-align: top;
  }
  .md :global(th) {
    background: var(--surface-sunken);
  }
  .md :global(img) {
    max-width: 100%;
    height: auto;
  }
  .md :global(a) {
    color: var(--text-link);
    overflow-wrap: anywhere;
  }
</style>
