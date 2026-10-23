<script lang="ts">
  // The H3 layer's controls in the Collections lens (build week 4, step 5): the taxon field (the release's taxon
  // layers as a search, heads included), the indicator, the period strip (decades and years from `h3:periods`) and
  // the resolution (auto by zoom, or pinned). It wires the H3 layer (`layer.svelte.ts`); every rule is in the plain
  // modules beside it. A lazy chunk of its own (CollectionLens.svelte imports it only for an h3 collection).
  import Select from "../../../lib/ui/Select.svelte";
  import Segmented from "../../../lib/ui/Segmented.svelte";
  import type { H3Layer } from "./layer.svelte";
  import { hexAreaLabel } from "./paint";
  import { shortCount, stepPeriod } from "./periods";
  import { taxonGroups, rowLabel } from "./taxa";
  import type { H3Spec } from "../../../lib/catalog/h3";

  interface Props {
    layer: H3Layer;
    spec: H3Spec;
  }
  let { layer, spec }: Props = $props();

  // ---- taxon ----
  let query = $state("");
  let searching = $state(false);
  const current = $derived(layer.taxon ? `${layer.taxon.rank}:${layer.taxon.taxon}` : null);
  const groups = $derived(searching && layer.taxa ? taxonGroups(layer.taxa, query, current) : []);
  function pick(row: (typeof groups)[number]["rows"][number]) {
    layer.setTaxon(row);
    query = "";
    searching = false;
  }

  // ---- period ----
  const view = $derived(layer.view);
  let grain = $state<string | null>(null);
  const grains = $derived([...new Set(layer.bars.map((b) => b.grain))]);
  const shownGrain = $derived(
    grain && grains.includes(grain)
      ? grain
      : (layer.bars.find((b) => b.token === view?.period)?.grain ?? grains[0] ?? null),
  );
  const shownBars = $derived(layer.bars.filter((b) => b.grain === shownGrain));
  function onStripKey(e: KeyboardEvent) {
    if (!view) return;
    if (e.key === "Escape") {
      layer.setPeriod(spec.allPeriod);
      e.preventDefault();
    } else if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      const from = view.period === spec.allPeriod ? shownBars[0]?.token : view.period;
      const next = from ? stepPeriod(layer.bars, from, e.key === "ArrowRight" ? 1 : -1) : null;
      if (view.period === spec.allPeriod && from) layer.setPeriod(from);
      else if (next) layer.setPeriod(next);
      e.preventDefault();
    }
  }

  // ---- resolution ----
  const ladder = $derived(view?.ladder ?? spec.resolutions);
  const pinned = $derived(view && view.res !== "auto" ? view.res : null);
  const sliderRes = $derived(pinned ?? layer.shownRes ?? ladder[0]);
</script>

<div class="h3-controls" data-testid="h3-controls">
  <!-- taxon -->
  <div class="field" data-testid="h3-taxon">
    <span class="field-label">Taxon</span>
    {#if layer.taxon}
      <p class="current" data-testid="h3-taxon-current">
        {rowLabel(layer.taxon)} <span class="muted">({layer.taxon.rank})</span>
        <button type="button" class="link" onclick={() => layer.setTaxon(null)}>All taxa</button>
      </p>
    {/if}
    <input
      type="search"
      class="search"
      placeholder="Search a taxon: phylum to family, the groups above class"
      aria-label="Search a taxon"
      data-testid="h3-taxon-search"
      bind:value={query}
      onfocus={() => {
        searching = true;
        layer.ensureTaxa();
      }}
    />
    {#if searching}
      <div class="taxa" role="listbox" aria-label="Taxa" data-testid="h3-taxa">
        {#if layer.taxaPhase === "loading"}
          <p class="note" role="status">Loading the taxa…</p>
        {:else if layer.taxaPhase === "error"}
          <p class="note" role="alert">The taxon list could not be loaded.</p>
        {:else if groups.length === 0}
          <p class="note">No taxon layer matches “{query}”.</p>
        {/if}
        {#each groups as g (g.rank)}
          <p class="group">{g.label}</p>
          {#each g.rows as r (r.urlPath)}
            <button
              type="button"
              role="option"
              aria-selected={current === `${r.rank}:${r.taxon}`}
              class="row"
              data-testid="h3-taxon-row"
              onclick={() => pick(r)}
            >
              <span class="name">{r.label}</span>
              <span class="count">{shortCount(r.n)}</span>
              <span class="bar" style={`--w:${(r.bar * 100).toFixed(1)}%`}></span>
            </button>
          {/each}
          {#if g.more > 0}<p class="note">… {g.more} more, type to search</p>{/if}
        {/each}
        <button type="button" class="link close" onclick={() => (searching = false)}>Close</button>
      </div>
    {/if}
    {#if layer.taxonNote}<p class="note" role="status">{layer.taxonNote}</p>{/if}
  </div>

  <!-- indicator -->
  {#if view}
    <label class="field">
      <span class="field-label">Indicator</span>
      <Select
        label="Indicator"
        value={view.indicator}
        options={spec.indicators.map((i) => ({ value: i.value, label: i.label }))}
        onchange={(v) => layer.setIndicator(v)}
      />
    </label>
  {/if}

  <!-- period -->
  <div class="field" data-testid="h3-period">
    <span class="field-label">Period</span>
    {#if layer.stripNote}
      <p class="note" data-testid="h3-strip-note">{layer.stripNote}</p>
    {:else if view}
      <div class="period-head">
        <button
          type="button"
          class="chip"
          aria-pressed={view.period === spec.allPeriod}
          onclick={() => layer.setPeriod(spec.allPeriod)}>All years</button
        >
        {#if grains.length > 1 && shownGrain}
          <Segmented
            ariaLabel="Decades or years"
            value={shownGrain}
            options={grains.map((g) => ({ value: g, label: g === "decade" ? "Decades" : "Years" }))}
            onchange={(g) => (grain = g)}
          />
        {/if}
      </div>
      <div
        class="strip"
        class:years={shownGrain === "year"}
        role="toolbar"
        aria-label="Hexagons with records per period (res 3); ←/→ step, Esc all years"
        tabindex="0"
        data-testid="h3-strip"
        onkeydown={onStripKey}
      >
        {#each shownBars as b (b.token)}
          <button
            type="button"
            class="pbar"
            aria-pressed={view.period === b.token}
            title={`${b.token}: ${b.cells.toLocaleString("en-US")} hexagons with records (res 3)`}
            data-period={b.token}
            onclick={() => layer.setPeriod(view.period === b.token ? spec.allPeriod : b.token)}
          >
            <span class="fill" style={`--h:${Math.max(4, b.height * 100).toFixed(0)}%`}></span>
            {#if shownGrain === "decade"}<span class="lab">{b.token}</span>{/if}
          </button>
        {/each}
      </div>
      <p class="note">
        {view.period === spec.allPeriod
          ? "All years. Bars: hexagons with records per period (res 3)."
          : `${spec.periodLabels[view.period] ?? view.period}. Click it again, or Esc, for all years.`}
      </p>
    {/if}
  </div>

  <!-- resolution -->
  {#if view}
    <div class="field" data-testid="h3-res">
      <span class="field-label">Hexagon size</span>
      <label class="auto">
        <input
          type="checkbox"
          checked={view.res === "auto"}
          onchange={(e) =>
            layer.setRes((e.currentTarget as HTMLInputElement).checked ? "auto" : sliderRes)}
        />
        <span>Auto from zoom</span>
      </label>
      <input
        type="range"
        min={Math.min(...ladder)}
        max={Math.max(...ladder)}
        step="1"
        value={sliderRes}
        aria-label="Resolution"
        disabled={view.res === "auto"}
        oninput={(e) => layer.setRes(Number((e.currentTarget as HTMLInputElement).value))}
      />
      <p class="note">res {sliderRes} · {hexAreaLabel(sliderRes)}</p>
    </div>
  {/if}

  {#if layer.sentence}
    <p class="sentence" data-testid="h3-sentence">{layer.sentence}</p>
  {/if}
  {#if layer.coverage}
    <p class="note" data-testid="h3-coverage">{layer.coverage}</p>
  {/if}
  {#each layer.notes as n (n)}
    <p class="note" role="status" data-testid="h3-note">{n}</p>
  {/each}
</div>

<style>
  .h3-controls {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
  .field-label {
    font-size: var(--text-xs);
    color: var(--text-secondary);
  }
  .current {
    margin: 0;
    font-size: var(--text-sm);
  }
  .muted,
  .note {
    color: var(--text-secondary);
  }
  .note {
    margin: 0;
    font-size: var(--text-xs);
  }
  .sentence {
    margin: 0;
    font-size: var(--text-sm);
    font-weight: 600;
  }
  .search {
    width: 100%;
    box-sizing: border-box;
    padding: var(--space-1) var(--space-2);
    border: 1px solid var(--border-control);
    border-radius: var(--radius-control);
    background: var(--fill-control);
    color: var(--text-primary);
    font: inherit;
    font-size: var(--text-sm);
  }
  .taxa {
    max-height: 18rem;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: var(--space-1);
    border: 1px solid var(--border-control);
    border-radius: var(--radius-control);
    background: var(--surface-raised);
  }
  .group {
    margin: var(--space-1) 0 0;
    font-size: var(--text-xs);
    font-weight: 700;
    color: var(--text-secondary);
  }
  .row {
    position: relative;
    display: flex;
    justify-content: space-between;
    gap: var(--space-2);
    padding: 2px var(--space-1);
    border: 0;
    border-radius: var(--radius-control);
    background: transparent;
    color: var(--text-primary);
    font: inherit;
    font-size: var(--text-sm);
    text-align: left;
    cursor: pointer;
  }
  .row:hover,
  .row:focus-visible,
  .row[aria-selected="true"] {
    background: var(--fill-control);
  }
  .row .count {
    color: var(--text-secondary);
    font-variant-numeric: tabular-nums;
  }
  .row .bar {
    position: absolute;
    left: 0;
    bottom: 0;
    height: 2px;
    width: var(--w);
    background: var(--border-control);
  }
  .link {
    padding: 0;
    border: 0;
    background: none;
    color: var(--text-link);
    font: inherit;
    font-size: var(--text-xs);
    text-decoration: underline;
    cursor: pointer;
  }
  .close {
    align-self: flex-end;
  }
  .period-head {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex-wrap: wrap;
  }
  .chip {
    padding: 0 var(--space-2);
    border: 1px solid var(--border-control);
    border-radius: var(--radius-pill);
    background: var(--fill-control);
    color: var(--text-primary);
    font: inherit;
    font-size: var(--text-xs);
    cursor: pointer;
  }
  .chip[aria-pressed="true"],
  .pbar[aria-pressed="true"] .fill {
    outline: 2px solid var(--text-primary);
    outline-offset: 1px;
  }
  .strip {
    display: flex;
    align-items: flex-end;
    gap: 2px;
    height: 56px;
    overflow-x: auto;
  }
  .pbar {
    position: relative;
    flex: 1 0 auto;
    min-width: 28px;
    height: 100%;
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    align-items: stretch;
    padding: 0;
    border: 0;
    background: transparent;
    cursor: pointer;
  }
  .strip.years .pbar {
    min-width: 4px;
    flex: 0 0 4px;
  }
  .pbar .fill {
    display: block;
    height: var(--h);
    background: var(--text-secondary);
    border-radius: 2px 2px 0 0;
  }
  .pbar[aria-pressed="true"] .fill {
    background: var(--text-primary);
  }
  .pbar .lab {
    font-size: 10px;
    color: var(--text-secondary);
    text-align: center;
  }
  .auto {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--text-sm);
  }
</style>
