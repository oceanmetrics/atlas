<script lang="ts">
  // The License modal: the SPDX id, its full name, a one-line plain-language summary, the collection's
  // own license link(s) and the attribution to copy (with a Copy button). The content is the view model
  // `lib/catalog/licenses.ts#licenseModelOf` builds; this only presents it.
  import Modal from "./Modal.svelte";
  import type { LicenseModel } from "../catalog/licenses";

  interface Props {
    open: boolean;
    /** the collection's title, for the dialog's heading. */
    title: string;
    model: LicenseModel;
    onclose?: () => void;
  }
  let { open, title, model, onclose }: Props = $props();

  let copied = $state<"idle" | "done" | "failed">("idle");
  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(model.attribution);
      copied = "done";
    } catch {
      copied = "failed";
    }
  }
  $effect(() => {
    if (!open) copied = "idle";
  });
</script>

<Modal {open} title={`License: ${title}`} {onclose}>
  <div class="license" data-testid="license-modal">
    <p class="id">
      <strong>{model.info.id}</strong>
      {#if model.info.name !== model.info.id}<span class="name"> · {model.info.name}</span>{/if}
    </p>
    <p class="summary">{model.info.summary}</p>

    {#if model.info.url || model.links.length > 0}
      <h3>License text</h3>
      <ul class="links">
        {#if model.info.url}
          <li>
            <a href={model.info.url} target="_blank" rel="noopener noreferrer"
              >SPDX: {model.info.id}</a
            >
          </li>
        {/if}
        {#each model.links as l (l.href)}
          <li>
            <a href={l.href} target="_blank" rel="noopener noreferrer">{l.title}</a>
          </li>
        {/each}
      </ul>
    {/if}

    <h3>Attribution</h3>
    <p class="attribution" data-testid="license-attribution">{model.attribution}</p>
    <p>
      <button type="button" class="copy" onclick={copy}>Copy attribution</button>
      <span class="copied" role="status">
        {#if copied === "done"}Copied.{:else if copied === "failed"}Could not copy: select the text
          above.{/if}
      </span>
    </p>
  </div>
</Modal>

<style>
  .license {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
  }
  .license p,
  .license h3,
  .license ul {
    margin: 0;
  }
  .license h3 {
    margin-top: var(--space-2);
    font-size: var(--text-md);
    font-family: var(--font-display);
  }
  .name {
    color: var(--text-secondary);
  }
  .links {
    padding-left: var(--space-5);
  }
  .links a,
  .attribution {
    overflow-wrap: anywhere;
  }
  .attribution {
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-control);
    background: var(--surface-sunken);
    font-size: var(--text-sm);
  }
  .copy {
    padding: var(--space-1) var(--space-3);
    border: 1px solid var(--border-control);
    border-radius: var(--radius-control);
    background: var(--fill-control);
    color: var(--text-primary);
    font: inherit;
    cursor: pointer;
  }
  .copy:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }
  .copied {
    margin-left: var(--space-2);
    font-size: var(--text-sm);
    color: var(--text-secondary);
  }
</style>
