<script lang="ts">
  // The species list of the clicked cell (WP3): Likely / Very likely species of the item's group and
  // season, highest probability first. Rendering only: every rule (filter, sort, class pill, share bar,
  // CSV) is a pure function in `lib/catalog/species.ts`, and the data is read once by the lens.
  import { downloadCsv } from "../../lib/download/csv";
  import {
    classPill,
    countLine,
    speciesCsv,
    type CellSpecies,
    type GroupShare,
  } from "../../lib/catalog/species";
  import type { LoadError } from "../../lib/catalog/load";
  import SciName from "../../lib/ui/SciName.svelte";

  interface Props {
    phase: "idle" | "loading" | "ready" | "error";
    error: LoadError | null;
    fid: number;
    season: string;
    seasonLabel: string;
    groupLabel: string;
    list: CellSpecies[];
    modeled: number;
    share: GroupShare;
    /** the stem of the CSV's filename (the collection id). */
    stem: string;
  }

  let { phase, error, fid, season, seasonLabel, groupLabel, list, modeled, share, stem }: Props =
    $props();

  const pct = (n: number) => `${Math.round(n)}%`;
  const veryCount = $derived(list.filter((s) => s.cls === "Very likely").length);
  const likelyCount = $derived(list.length - veryCount);

  function download() {
    downloadCsv(speciesCsv(list, fid, season), `${stem}_cell-${fid}_${season}_species`);
  }
</script>

<section class="cell-species" data-testid="cell-species" aria-label="Species likely in this cell">
  <h4>Species · {groupLabel}, {seasonLabel}</h4>
  {#if phase === "loading"}
    <p role="status" class="note">Loading the species list…</p>
  {:else if phase === "error"}
    <p class="note" role="alert">
      The species list could not be read ({error?.message ?? "unknown"}).
    </p>
  {:else if phase === "ready"}
    <p class="count" data-testid="cell-species-count">{countLine(list.length, modeled)}</p>
    <div
      class="share"
      role="img"
      aria-label="{pct(share.veryLikely)} very likely, {pct(share.likely)} likely, {pct(
        share.rest,
      )} not likely"
      title="{veryCount} very likely, {likelyCount} likely, of {modeled} modeled"
      data-testid="cell-species-share"
    >
      <span class="very" style:width="{share.veryLikely}%"></span>
      <span class="likely" style:width="{share.likely}%"></span>
    </div>
    {#if list.length === 0}
      <p class="note" data-testid="cell-species-empty">
        No species are likely (prob &gt;= 0.6) in this cell for this group and season.
      </p>
    {:else}
      <ul class="list">
        {#each list as s (s.aphiaId)}
          {@const pill = classPill(s.cls)}
          <li data-testid="cell-species-row">
            <span class="names">
              <SciName name={s.scientificName} />
              {#if s.commonName}<span class="common">{s.commonName}</span>{/if}
            </span>
            <span class="meta">
              <span class="prob">{s.prob.toFixed(2)}</span>
              {#if pill}<span class="pill pill--{pill.tone}">{pill.label}</span>{/if}
              {#if s.iucnCode}<span class="iucn" title="IUCN Red List category">{s.iucnCode}</span
                >{/if}
            </span>
          </li>
        {/each}
      </ul>
      <button type="button" class="csv" onclick={download}> Download CSV </button>
    {/if}
  {/if}
</section>

<style>
  .cell-species {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  h4 {
    margin: 0;
    font-size: var(--text-sm);
  }
  .note,
  .count {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--text-secondary);
  }
  .share {
    display: flex;
    height: 8px;
    border: 1px solid var(--border-control);
    border-radius: var(--radius-pill);
    overflow: hidden;
    background: transparent;
  }
  .share .very {
    background: var(--fill-accent);
  }
  .share .likely {
    background: color-mix(in srgb, var(--fill-accent) 40%, transparent);
  }
  .list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    max-height: 40vh;
    overflow-y: auto;
  }
  .list li {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: var(--space-2);
    padding: var(--space-1) 0;
    border-bottom: 1px solid var(--divider);
    font-size: var(--text-sm);
  }
  .names {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .common {
    font-size: var(--text-xs);
    color: var(--text-secondary);
  }
  .meta {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    flex-shrink: 0;
  }
  .prob {
    font-variant-numeric: tabular-nums;
  }
  .pill,
  .iucn {
    padding: 0 var(--space-2);
    border: 1px solid var(--border-control);
    border-radius: var(--radius-pill);
    font-size: var(--text-xs);
    white-space: nowrap;
  }
  .pill--very {
    background: var(--fill-accent);
    border-color: var(--border-accent);
    color: var(--text-on-accent);
  }
  .pill--likely {
    background: transparent;
    border-color: var(--border-accent);
    color: var(--text-accent);
  }
  .iucn {
    background: var(--fill-control);
    color: var(--text-primary);
  }
  .csv {
    align-self: flex-start;
    padding: 0 var(--space-3);
    border: 1px solid var(--border-control);
    border-radius: var(--radius-pill);
    background: var(--fill-control);
    color: var(--text-primary);
    font: inherit;
    font-size: var(--text-xs);
    cursor: pointer;
  }
</style>
