<script lang="ts">
  // atlas-6 step 2, Deliverable 3: "Enter coordinates" -- the keyboard/screen-reader alternative to
  // drawing ("drawing is never the only way"). All the parsing/validation lives in coords.ts; this
  // component renders a textarea, calls it, and shows the refusal VERBATIM (what/why/fix) when it
  // fails -- the same rule the upload pipeline's own refusals follow (design:ux-copy).
  import Modal from "../lib/ui/Modal.svelte";
  import { parseCoordinateEntry } from "./coords";
  import type { NormalizedPlace } from "../lib/geo/upload/normalize";
  import type { Refusal } from "../lib/geo/upload/types";

  interface Props {
    open: boolean;
    onclose: () => void;
    onAccept: (places: NormalizedPlace[]) => void;
  }

  let { open, onclose, onAccept }: Props = $props();

  let text = $state("");
  let refusal = $state<Refusal | null>(null);
  let busy = $state(false);

  const PLACEHOLDER =
    "-124.5, 40.0, -123.0, 41.5\n\nor\n\n-124.1, 40.2\n-123.8, 40.9\n-123.2, 40.4";

  async function submit() {
    busy = true;
    refusal = null;
    try {
      const result = await parseCoordinateEntry(text);
      if (!result.ok) {
        refusal = result.refusal;
        return;
      }
      onAccept(result.places);
      text = "";
      onclose();
    } finally {
      busy = false;
    }
  }

  function handleClose() {
    refusal = null;
    onclose();
  }
</script>

<Modal {open} title="Enter coordinates" onclose={handleClose}>
  <p class="hint">
    A bounding box (<code>xmin, ymin, xmax, ymax</code>), a list of coordinates (one
    <code>lon, lat</code> per line, three or more), or pasted WKT/GeoJSON.
  </p>
  <label class="field">
    <span class="visually-hidden">Coordinates, bounding box, or WKT/GeoJSON</span>
    <textarea bind:value={text} rows="6" placeholder={PLACEHOLDER}></textarea>
  </label>
  {#if refusal}
    <div class="refusal" role="alert">
      <p><strong>{refusal.what}</strong></p>
      <p>{refusal.why}</p>
      <p>{refusal.fix}</p>
    </div>
  {/if}
  <div class="actions">
    <button type="button" disabled={busy || !text.trim()} onclick={submit}>
      {busy ? "Checking…" : "Add place"}
    </button>
  </div>
</Modal>

<style>
  .hint {
    margin: 0 0 var(--space-3);
    font-size: var(--text-sm);
    color: var(--text-secondary);
  }

  .field {
    display: block;
  }

  textarea {
    width: 100%;
    min-height: 120px;
    padding: var(--space-2);
    border: 1px solid var(--border-control);
    border-radius: var(--radius-control);
    background: var(--surface-raised);
    color: var(--text-primary);
    font: inherit;
    font-family: monospace;
    resize: vertical;
  }

  .refusal {
    margin-top: var(--space-3);
    padding: var(--space-3);
    border: 1px solid var(--border-control);
    border-radius: var(--radius-control);
    background: var(--fill-control);
    font-size: var(--text-sm);
  }

  .refusal p {
    margin: 0 0 var(--space-1);
  }

  .refusal p:last-child {
    margin-bottom: 0;
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    margin-top: var(--space-3);
  }

  .actions button {
    height: var(--size-touch);
    padding: 0 var(--space-4);
    border: 1px solid var(--border-control);
    border-radius: var(--radius-control);
    background: var(--fill-accent);
    color: var(--text-on-accent);
    font-weight: 700;
    cursor: pointer;
  }

  .actions button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
