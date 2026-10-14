<script lang="ts">
  // owner review item 7 (live 0.10.62): the species lens' "Table" rail tool's real body -- the
  // selected model's inputs, reshaped from the SAME `LayerBar` the species panel's own layer bar
  // already computes (`data/inputsTable.ts#inputsTableRows`, no new data source, no second fetch).
  // A plain semantic `<table>`, not `src/lib/ui/DataTable.svelte` (that component's virtualization/
  // sort/filter machinery is built for hundreds-to-thousands of rows; a model has a handful of
  // inputs, and a fixed-height virtualized grid would be the wrong tool for it).
  import type { LayerBar } from "./data/layerBar";
  import { inputsTableRows } from "./data/inputsTable";
  import Icon from "../../lib/ui/Icon.svelte";
  import { collapseToMap } from "../../lib/ui/backToMap";
  import { downloadCsv, toCsv } from "../../lib/download/csv";

  interface Props {
    bar: LayerBar | null;
    loading: boolean;
    cardError: boolean;
  }

  let { bar, loading, cardError }: Props = $props();
  const rows = $derived(inputsTableRows(bar));

  // R4-C: the download is the table as shown (same rows, same four columns).
  function onExportCsv() {
    const csv = toCsv(rows, [
      { key: "input", value: (r) => r.input },
      { key: "dataset", value: (r) => r.dataset },
      { key: "representation", value: (r) => r.representation },
      { key: "available", value: (r) => (r.available ? "Available" : "Not available") },
    ]);
    downloadCsv(csv, "model-inputs");
  }
</script>

<div class="inputs-tool" data-testid="species-inputs-table">
  <!-- R4-C: the same header-row pattern as the Scores table (← Map, subject, download); no tabs. -->
  <div class="header-row">
    <button type="button" class="back-btn" onclick={() => collapseToMap()}>← Map</button>
    <h3 class="header-text">Model inputs</h3>
    <button
      type="button"
      class="icon-btn"
      aria-label="Download CSV"
      data-tooltip="Download CSV"
      disabled={rows.length === 0}
      onclick={onExportCsv}
    >
      <Icon name="download" size={16} />
    </button>
  </div>
  {#if cardError}
    <p class="empty" role="alert">Couldn't load this species' model inputs.</p>
  {:else if loading}
    <p class="empty">Loading…</p>
  {:else if !bar || rows.length === 0}
    <!-- brief's own rule: "if a model has no inputs, say so plainly" -- never a blank table. -->
    <p class="empty">
      {bar ? "This model has no inputs." : "Select a species to see its model inputs."}
    </p>
  {:else}
    <table class="inputs-table">
      <caption class="visually-hidden">Model inputs for the selected species</caption>
      <thead>
        <tr>
          <th scope="col">Input</th>
          <th scope="col">Dataset</th>
          <th scope="col">Representation</th>
          <th scope="col">Availability</th>
        </tr>
      </thead>
      <tbody>
        {#each rows as r (r.key)}
          <tr>
            <td>{r.input}</td>
            <td>{r.dataset}</td>
            <td>{r.representation}</td>
            <td>
              {#if r.available}
                Available
              {:else}
                <span class="unavailable" title={r.reason ?? undefined}>Not available</span>
              {/if}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</div>

<style>
  .inputs-tool {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .header-row {
    display: flex;
    align-items: center;
    gap: var(--space-2) var(--space-4);
  }

  .header-text {
    flex: 1;
    margin: 0;
    font-size: var(--text-md);
  }

  .back-btn {
    min-height: var(--size-touch);
    padding: 0 var(--space-3);
    border: 1px solid var(--border-control);
    border-radius: var(--radius-control);
    background: none;
    color: var(--text-primary);
    font: inherit;
    font-size: var(--text-sm);
    cursor: pointer;
  }

  .icon-btn {
    display: inline-grid;
    place-items: center;
    width: var(--size-touch);
    height: var(--size-touch);
    border: 1px solid var(--border-control);
    border-radius: var(--radius-control);
    background: none;
    color: var(--icon-muted);
    cursor: pointer;
  }

  .icon-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .back-btn:focus-visible,
  .icon-btn:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }

  /* the phone's sheet has its own detents; the map is reached by dragging it down */
  @media (max-width: 899px) {
    .back-btn {
      display: none;
    }
  }

  .empty {
    color: var(--text-secondary);
  }

  .inputs-table {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--text-sm);
  }

  .inputs-table th,
  .inputs-table td {
    padding: var(--space-1) var(--space-2);
    text-align: left;
    border-bottom: 1px solid var(--border-control);
  }

  .inputs-table th {
    color: var(--text-secondary);
    font-weight: 600;
  }

  /* the SAME struck-through convention `LayerBarView.svelte`'s own unavailable pill uses (this
     file's own header: the SAME data, reshaped) -- a plain `<span title>`, never a disabled
     `<button>` (nothing here is clickable; this tool only lists what the panel already lets you
     pick). */
  .unavailable {
    color: var(--text-secondary);
    text-decoration: line-through;
  }
</style>
