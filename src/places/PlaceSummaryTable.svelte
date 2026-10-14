<script lang="ts">
  // The Collections lens' "Table" tool: the CURRENT item summarised over each place in the Places
  // list (n cells, mean, min, max, the share of cells with no value), one row per place, sortable,
  // with a CSV download of the raw numbers. The rows come from `summary.svelte.ts`; the grid is the
  // app's own `DataTable`, the CSV is `download/csv.ts`.
  import DataTable from "../lib/ui/DataTable.svelte";
  import type { DataTableColumn } from "../lib/ui/dataTableCore";
  import { downloadCsv, slugStem } from "../lib/download/csv";
  import { formatCollectionValue } from "../lens/collection/mapInputs";
  import type { PlaceSummaries } from "./summary.svelte";
  import { formatShare, summaryCsv, type SummaryRow } from "./summary";

  interface Props {
    summaries: PlaceSummaries;
  }
  let { summaries }: Props = $props();

  const num = (v: number | null) => (v === null ? "" : formatCollectionValue(v));
  const unit = $derived(summaries.rows[0]?.unit ?? "cells");

  const columns = $derived<DataTableColumn<SummaryRow>[]>([
    { key: "name", label: "Place", value: (r) => r.name, sortable: true },
    {
      key: "n",
      label: unit === "cells" ? "Cells" : "Pixels",
      value: (r) => r.n,
      format: (r) => (r.n === null ? "" : r.n.toLocaleString("en-US")),
      numeric: true,
      sortable: true,
    },
    {
      key: "mean",
      label: "Mean",
      value: (r) => r.mean,
      format: (r) => num(r.mean),
      numeric: true,
      sortable: true,
    },
    {
      key: "min",
      label: "Min",
      value: (r) => r.min,
      format: (r) => num(r.min),
      numeric: true,
      sortable: true,
    },
    {
      key: "max",
      label: "Max",
      value: (r) => r.max,
      format: (r) => num(r.max),
      numeric: true,
      sortable: true,
    },
    {
      key: "no_value",
      label: "No value",
      value: (r) => r.noValueShare,
      format: (r) => formatShare(r.noValueShare),
      numeric: true,
      sortable: true,
    },
  ]);

  const problems = $derived(summaries.rows.filter((r) => r.status === "error"));

  function exportCsv(): void {
    downloadCsv(
      summaryCsv(summaries.rows, summaries.subject ?? ""),
      slugStem(summaries.subject ?? "places-summary", "places-summary"),
    );
  }
</script>

<div class="summary-table" data-testid="place-summary-table">
  {#if summaries.unavailable}
    <p role="status">{summaries.unavailable}</p>
  {:else if !summaries.rows.length}
    <p role="status">Add a place to summarise {summaries.subject ?? "the layer"} over it.</p>
  {:else}
    <p class="subject">
      <b>{summaries.subject}</b> over {summaries.rows.length}
      {summaries.rows.length === 1 ? "place" : "places"}
    </p>
    <DataTable
      label="Places summary table"
      {columns}
      rows={[...summaries.rows]}
      getRowId={(r: SummaryRow) => r.index}
      height={Math.min(360, 40 + summaries.rows.length * 32)}
    />
    {#each problems as r (r.index)}
      <p class="problem" role="status">{r.name}: {r.message ?? "no summary"}.</p>
    {/each}
    {#if summaries.caveat}<p class="caveat">{summaries.caveat}</p>{/if}
    <div class="actions">
      <button type="button" onclick={exportCsv}>Download CSV</button>
    </div>
  {/if}
</div>

<style>
  .summary-table {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .summary-table p {
    margin: 0;
    font-size: var(--text-sm);
  }
  .caveat,
  .problem {
    font-size: var(--text-xs);
    color: var(--text-secondary);
  }
  .actions button {
    height: var(--size-touch);
    padding: 0 var(--space-3);
    border: 1px solid var(--border-control);
    border-radius: var(--radius-control);
    background: none;
    color: var(--text-primary);
    font: inherit;
    font-size: var(--text-sm);
    cursor: pointer;
  }
</style>
