<script lang="ts">
  // The Cell pane of the H3 layer (build week 4, step 5; obis-hex's CellPanel and CellSpecies): the selected
  // hexagon (`cell=`) with its resolution and area, the layer and period, the five indicators (the chosen one
  // first) beside the release median at that resolution, and the species behind its records from the release's
  // species table (`cellSpecies.ts`): the top ten with records and first-last years, then all of them with a
  // filter, a sort, the first 500 rows, and a CSV of every species. A lazy chunk (CollectionLens.svelte).
  import { INSTANCE } from "../../../lib/brand/instance";
  import { saveBlob } from "../../../lib/download/saveBlob";
  import type { H3Spec } from "../../../lib/catalog/h3";
  import {
    MAX_ROWS,
    TOP_SPECIES,
    filterSpecies,
    shareText,
    sortSpecies,
    speciesCsv,
    speciesCsvName,
    wormsUrl,
    yearsText,
    type SpeciesSortKey,
  } from "./cellSpecies";
  import type { H3Layer } from "./layer.svelte";
  import { formatIndicator, hexAreaLabel, shortLabel } from "./paint";

  interface Props {
    layer: H3Layer;
    spec: H3Spec;
  }
  let { layer, spec }: Props = $props();

  const cell = $derived(layer.cell);
  const view = $derived(layer.view);
  const sp = $derived(layer.species);
  const order = $derived(
    view
      ? [...spec.indicators].sort(
          (a, b) => +(b.value === view.indicator) - +(a.value === view.indicator),
        )
      : spec.indicators,
  );
  let expanded = $state(false);
  let filter = $state("");
  let sortKey = $state<SpeciesSortKey>("records");
  let sortDir = $state<"asc" | "desc">("desc");
  const shown = $derived(
    sp.list ? sortSpecies(filterSpecies(sp.list.rows, filter), sortKey, sortDir) : [],
  );
  function sortBy(k: SpeciesSortKey) {
    if (sortKey === k) sortDir = sortDir === "asc" ? "desc" : "asc";
    else {
      sortKey = k;
      sortDir = k === "records" || k === "yearMax" ? "desc" : "asc";
    }
  }
  function downloadCsv() {
    const list = sp.list;
    if (!list || !view || !layer.target) return;
    const name = speciesCsvName({
      prefix: INSTANCE.download.prefix,
      h3: list.h3,
      layer: layer.target.item.key ?? layer.target.item.layer,
      period: view.period,
      release: spec.release,
    });
    saveBlob(new Blob([speciesCsv(list)], { type: "text/csv;charset=utf-8" }), name);
  }
  const fmt = (n: number) => n.toLocaleString("en-US");
</script>

<div class="h3-cell" data-testid="h3-cell-pane">
  {#if !cell}
    <p data-testid="h3-cell-empty">
      Click a hexagon on the map to see all five indicators and the species recorded in it.
    </p>
  {:else}
    <h3>Hexagon <code>{cell.h3}</code></h3>
    <p class="muted">
      res {cell.res} · {hexAreaLabel(cell.res)} · {layer.target?.label ?? ""} · {spec.periodLabels[
        view?.period ?? spec.allPeriod
      ] ?? view?.period}
    </p>
    <table class="ind" data-testid="h3-cell-indicators">
      <tbody>
        {#each order as i (i.value)}
          <tr class:chosen={i.value === view?.indicator}>
            <th scope="row">{shortLabel(i.value, i.label)}</th>
            <td>{cell.values ? formatIndicator(i.value, cell.values[i.value]) : "…"}</td>
          </tr>
        {/each}
      </tbody>
    </table>
    {#if cell.median !== null && view}
      <p class="muted" data-testid="h3-cell-median">
        Release median of {shortLabel(view.indicator, view.indicator)} at res {cell.res}: {formatIndicator(
          view.indicator,
          cell.median,
        )}
      </p>
    {/if}

    <div class="species" data-testid="h3-cell-species">
      <h4>Species</h4>
      {#if sp.phase === "loading"}
        <p role="status">Reading the species of this hexagon…</p>
      {:else if sp.phase === "error"}
        <p role="alert">{sp.error}</p>
      {:else if sp.list}
        {@const list = sp.list}
        <p class="muted" data-testid="h3-cell-species-total">
          {fmt(list.records)} records of {fmt(list.names)} species{list.scope === "children"
            ? ` (its res-${list.tableRes} hexagons)`
            : ""}
        </p>
        {#each list.notes as n (n)}<p class="note" role="status">{n}</p>{/each}
        {#if !expanded}
          <ol class="top">
            {#each list.rows.slice(0, TOP_SPECIES) as r (r.aphiaid)}
              <li>
                <a href={wormsUrl(r.aphiaid)} target="_blank" rel="noopener"><i>{r.species}</i></a>
                <span class="muted">{fmt(r.records)} · {yearsText(r)}</span>
              </li>
            {/each}
          </ol>
          {#if list.rows.length > TOP_SPECIES}
            <button
              type="button"
              class="link"
              data-testid="h3-cell-expand"
              onclick={() => (expanded = true)}>All {fmt(list.rows.length)} species ▸</button
            >
          {/if}
        {:else}
          <div class="tools">
            <input
              type="search"
              placeholder="Filter: name, class, family, order, phylum"
              aria-label="Filter the species"
              bind:value={filter}
            />
            <button type="button" class="link" onclick={() => (expanded = false)}
              >Top {TOP_SPECIES} ◂</button
            >
          </div>
          <div class="table-wrap">
            <table class="all" data-testid="h3-cell-table">
              <thead>
                <tr>
                  <th><button type="button" onclick={() => sortBy("species")}>Species</button></th>
                  <th><button type="button" onclick={() => sortBy("class")}>Class</button></th>
                  <th><button type="button" onclick={() => sortBy("family")}>Family</button></th>
                  <th class="num"
                    ><button type="button" onclick={() => sortBy("records")}>Records</button></th
                  >
                  <th class="num">Share</th>
                  <th class="num"
                    ><button type="button" onclick={() => sortBy("yearMin")}>First</button></th
                  >
                  <th class="num"
                    ><button type="button" onclick={() => sortBy("yearMax")}>Last</button></th
                  >
                </tr>
              </thead>
              <tbody>
                {#each shown.slice(0, MAX_ROWS) as r (r.aphiaid)}
                  <tr>
                    <td
                      ><a href={wormsUrl(r.aphiaid)} target="_blank" rel="noopener"
                        ><i>{r.species}</i></a
                      ></td
                    >
                    <td>{r.class ?? ""}</td>
                    <td>{r.family ?? ""}</td>
                    <td class="num">{fmt(r.records)}</td>
                    <td class="num">{shareText(r.records, list.records)}</td>
                    <td class="num">{r.yearMin ?? ""}</td>
                    <td class="num">{r.yearMax ?? ""}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
          {#if shown.length > MAX_ROWS}
            <p class="note">
              The first {MAX_ROWS} of {fmt(shown.length)} rows; the CSV has them all.
            </p>
          {/if}
        {/if}
        <button type="button" class="chip" data-testid="h3-cell-csv" onclick={downloadCsv}>
          Species CSV
        </button>
        <p class="note" data-testid="h3-cell-read">
          Read {(list.bytes / 1024).toFixed(0)} KB in {list.requests} requests, {list.ms} ms.
        </p>
      {/if}
    </div>
    <button type="button" class="chip" onclick={() => layer.selectCell(null)}
      >Clear selection</button
    >
  {/if}
</div>

<style>
  .h3-cell {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .h3-cell h3,
  .h3-cell h4,
  .h3-cell p {
    margin: 0;
  }
  .h3-cell h3 {
    font-size: var(--text-md);
  }
  .h3-cell h4 {
    font-size: var(--text-sm);
  }
  .muted,
  .note {
    color: var(--text-secondary);
    font-size: var(--text-xs);
  }
  table {
    border-collapse: collapse;
    font-size: var(--text-sm);
  }
  .ind th {
    text-align: left;
    font-weight: 400;
    padding-right: var(--space-3);
    color: var(--text-secondary);
  }
  .ind td {
    font-variant-numeric: tabular-nums;
  }
  .ind tr.chosen th,
  .ind tr.chosen td {
    font-weight: 700;
    color: var(--text-primary);
  }
  .top {
    margin: 0;
    padding-left: 1.4em;
    font-size: var(--text-sm);
  }
  .top li {
    display: flex;
    justify-content: space-between;
    gap: var(--space-2);
  }
  .tools {
    display: flex;
    gap: var(--space-2);
    align-items: center;
  }
  .tools input {
    flex: 1;
    padding: var(--space-1) var(--space-2);
    border: 1px solid var(--border-control);
    border-radius: var(--radius-control);
    background: var(--fill-control);
    color: var(--text-primary);
    font: inherit;
    font-size: var(--text-sm);
  }
  .table-wrap {
    max-height: 22rem;
    overflow: auto;
  }
  .all th,
  .all td {
    padding: 2px var(--space-1);
    text-align: left;
    white-space: nowrap;
  }
  .all .num {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  .all th button {
    padding: 0;
    border: 0;
    background: none;
    color: var(--text-secondary);
    font: inherit;
    font-weight: 700;
    cursor: pointer;
  }
  .link {
    align-self: flex-start;
    padding: 0;
    border: 0;
    background: none;
    color: var(--text-link);
    font: inherit;
    font-size: var(--text-xs);
    text-decoration: underline;
    cursor: pointer;
  }
  .chip {
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
  a {
    color: var(--text-link);
  }
</style>
