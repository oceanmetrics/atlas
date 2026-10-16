<script lang="ts">
  // The species of the clicked pixel of a RASTER collection that declares `atlas:cell_species` (Details, under
  // the flower): count line with per-group and Red List chips, then a table sorted by suitability. Rendering and
  // wiring only: the grid math, the tile read, the share, sort / filter / counts and the links are pure
  // functions in `lib/catalog/cellSpecies.ts` (hyparquet is imported there, dynamically, so it stays out of the
  // static graph). One tile read per click, the species lookup once per collection.
  import { untrack } from "svelte";
  import { downloadCsv } from "../../lib/download/csv";
  import type { LoadError } from "../../lib/catalog/load";
  import {
    cellOf,
    cellSpeciesCsv,
    countLine,
    createCellSpeciesStore,
    defaultGroup,
    filterRows,
    formatShare,
    groupCounts,
    joinRows,
    linksFor,
    redlistCounts,
    sortRows,
    type CellSpeciesDescriptor,
    type CellSpeciesLink,
    type CellSpeciesRow,
    type SortKey,
  } from "../../lib/catalog/cellSpecies";
  import { flowerColorFor } from "../../lib/catalog/flower";
  import type { MapView, Sel } from "../../lib/state/types";
  import SciName from "../../lib/ui/SciName.svelte";

  interface Props {
    desc: CellSpeciesDescriptor;
    /** the collection id: the CSV's filename stem. */
    stem: string;
    /** the clicked position [lon, lat]. */
    lngLat: [number, number];
    /** the lens' current selection (one value per dimension). */
    selected: Record<string, string>;
    /** the flower's composite value (the "all" item), when the collection has one. */
    composite: string | null;
    /** the values of the group dimension, with their labels, in the dimension's order. */
    groups: { value: string; label: string }[];
    /** the camera an in-app link keeps (`map=`); absent = the map handle's current one at click time. */
    map: MapView | undefined;
    /** follow a same-app link in place. */
    onNavigate: (patch: Partial<Sel>) => void;
    /** the app's "Auto-zoom to layer" preference (the Layers panel's switch: one preference, one storage key),
     * which decides whether following an Atlas link flies to the species' extent. */
    autoZoom: boolean;
    onAutoZoomChange: (on: boolean) => void;
  }

  let {
    desc,
    stem,
    lngLat,
    selected,
    composite,
    groups,
    map,
    onNavigate,
    autoZoom,
    onAutoZoomChange,
  }: Props = $props();

  const TOP = 15;
  const store = $derived(createCellSpeciesStore(desc));
  const cell = $derived(cellOf(lngLat[0], lngLat[1], desc.grid, desc.tileDeg));
  const labelOf = (g: string) => groups.find((x) => x.value === g)?.label ?? g;
  const unit = $derived(desc.valueUnit === "percent" ? "%" : "");

  let phase = $state<"loading" | "ready" | "error">("loading");
  let error = $state.raw<LoadError | null>(null);
  let rows = $state.raw<CellSpeciesRow[]>([]);
  let retry = $state(0);
  let sortKey = $state<SortKey>("suit");
  let query = $state("");
  let expanded = $state(false);
  // the filters. Group: ONE group at a time (a chip, or the item's EOV to start with; follows the item), `null` =
  // all. Red List: any of the chosen codes. Both are chips; the text query is the box.
  const itemGroup = $derived(defaultGroup(desc, selected, composite));
  // a writable $derived: a chip overrides it, a change of the item's own group resets it
  let groupFilter = $derived<string | null>(itemGroup);
  let redlist = $state<string[]>([]);
  const group = $derived(groupFilter);
  const filtered = $derived(groupFilter !== itemGroup || redlist.length > 0 || query.trim() !== "");
  const toggleGroup = (g: string) => (groupFilter = groupFilter === g ? null : g);
  const toggleRedlist = (code: string) =>
    (redlist = redlist.includes(code) ? redlist.filter((c) => c !== code) : [...redlist, code]);
  function clearFilters() {
    groupFilter = itemGroup;
    redlist = [];
    query = "";
  }

  let token = 0;
  $effect(() => {
    const c = cell;
    const s = store;
    void retry;
    const mine = ++token;
    untrack(() => {
      phase = "loading";
      error = null;
      rows = [];
      expanded = false;
    });
    if (!c) {
      untrack(() => {
        phase = "ready";
      });
      return;
    }
    void Promise.all([s.lookup(), s.cell(c)]).then(([lk, t]) => {
      if (mine !== token) return;
      if (!lk.ok) {
        error = lk.error;
        phase = "error";
      } else if (!t.ok) {
        error = t.error;
        phase = "error";
      } else {
        rows = joinRows(t.value, lk.value, c.lat, desc.grid.res);
        phase = "ready";
      }
    });
  });

  const shown = $derived(sortRows(filterRows(rows, { group, redlist, query }), sortKey));
  const visible = $derived(expanded ? shown : shown.slice(0, TOP));
  const inGroup = $derived(group ? rows.filter((r) => r.group === group) : rows);
  const counts = $derived(
    groupCounts(
      rows,
      groups.map((g) => g.value),
    ),
  );
  // Red List chips count within the active group; a chosen code the group has none of stays, as 0, to be unchosen
  const chips = $derived.by(() => {
    const c = redlistCounts(inGroup);
    return [
      ...c,
      ...redlist
        .filter((code) => !c.some((x) => x.code === code))
        .map((code) => ({ code, count: 0 })),
    ];
  });

  const linksOf = (r: CellSpeciesRow): CellSpeciesLink[] => linksFor(r, desc, map);

  function follow(e: MouseEvent, l: CellSpeciesLink) {
    // a plain click follows in place (the camera per the auto-zoom preference); a modified one is the browser's (new tab, download)
    if (
      !l.sameApp ||
      !l.patch ||
      e.button !== 0 ||
      e.metaKey ||
      e.ctrlKey ||
      e.shiftKey ||
      e.altKey
    )
      return;
    e.preventDefault();
    onNavigate(l.patch);
  }

  function download() {
    if (cell)
      downloadCsv(cellSpeciesCsv(shown, cell.cellId, desc), `${stem}_cell-${cell.cellId}_species`);
  }
</script>

<section
  class="raster-cell-species"
  data-testid="raster-cell-species"
  aria-label="Species in this cell"
>
  <h4>Species in this cell</h4>
  <label class="autozoom">
    <input
      type="checkbox"
      checked={autoZoom}
      data-testid="cell-species-autozoom"
      onchange={(e) => onAutoZoomChange(e.currentTarget.checked)}
    />
    Zoom to species extent when following Atlas links
  </label>
  {#if !cell}
    <p class="note">This position is outside the grid.</p>
  {:else if phase === "loading"}
    <p class="note" role="status">Loading the species list…</p>
  {:else if phase === "error"}
    <p class="note" role="alert" data-testid="raster-cell-species-error">
      The species list could not be read ({error?.message ?? "unknown"}).
      <button type="button" class="linkish" onclick={() => retry++}>Retry</button>
    </p>
  {:else}
    <p class="count" data-testid="raster-cell-species-count">{countLine(rows.length)}</p>
    {#if rows.length === 0}
      <p class="note" data-testid="raster-cell-species-empty">
        No species of this product have habitat in this cell.
      </p>
    {:else}
      <ul class="chips" aria-label="Filter by group and Red List category">
        {#each counts as g (g.group)}
          <li>
            <button
              type="button"
              class="pill chip"
              class:on={groupFilter === g.group}
              class:dim={groupFilter !== null && groupFilter !== g.group}
              aria-pressed={groupFilter === g.group}
              data-testid={`cell-species-chip-group-${g.group}`}
              style:background={`var(${flowerColorFor(g.group)})`}
              onclick={() => toggleGroup(g.group)}>{labelOf(g.group)} {g.count}</button
            >
          </li>
        {/each}
        {#each chips as c (c.code)}
          <li>
            <button
              type="button"
              class="pill redlist chip"
              class:on={redlist.includes(c.code)}
              class:dim={redlist.length > 0 && !redlist.includes(c.code)}
              aria-pressed={redlist.includes(c.code)}
              title="IUCN Red List category"
              data-testid={`cell-species-chip-redlist-${c.code}`}
              onclick={() => toggleRedlist(c.code)}>{c.code} {c.count}</button
            >
          </li>
        {/each}
      </ul>

      <div class="controls">
        <input
          type="search"
          bind:value={query}
          placeholder="Filter species"
          aria-label="Filter species"
          data-testid="raster-cell-species-filter"
        />
        <select bind:value={sortKey} aria-label="Sort species by">
          <option value="suit">{desc.valueLabel}</option>
          <option value="name">Name</option>
          <option value="redlist">Red List</option>
          <option value="group">Group</option>
          <option value="share">Share of habitat</option>
        </select>
      </div>
      {#if itemGroup}
        <button
          type="button"
          class="linkish"
          onclick={() => (groupFilter = groupFilter === itemGroup ? null : itemGroup)}
        >
          {groupFilter === itemGroup ? "Show all groups" : `Only ${labelOf(itemGroup)}`}
        </button>
      {/if}
      {#if filtered}
        <p class="count" data-testid="cell-species-showing">
          Showing {shown.length} of {rows.length}
          <button type="button" class="linkish" onclick={clearFilters}>Clear filters</button>
        </p>
      {/if}

      {#if shown.length === 0}
        <p class="note">No species match.</p>
      {:else}
        <ul class="list" data-testid="raster-cell-species-list">
          {#each visible as r (r.speciesId)}
            <li data-testid="raster-cell-species-row">
              <div class="names">
                <SciName name={r.scientificName} />
                {#if r.commonName}<span class="common">{r.commonName}</span>{/if}
              </div>
              <div class="meta">
                {#if r.group}
                  <span class="pill" style:background={`var(${flowerColorFor(r.group)})`}
                    >{labelOf(r.group)}</span
                  >
                {/if}
                <span
                  class="bar"
                  role="img"
                  aria-label={`${desc.valueLabel} ${r.suit}${unit}`}
                  title={`${desc.valueLabel} ${r.suit}${unit}`}
                  ><span
                    style:width={`${Math.min(100, Math.max(0, (r.suit / desc.valueRange[1]) * 100))}%`}
                  ></span></span
                >
                <span class="num">{r.suit}{unit}</span>
                {#if r.share !== null}
                  <span class="num share" title="Share of the species' global habitat in this cell"
                    >{formatShare(r.share)}</span
                  >
                {/if}
                {#if r.redlist}
                  <span
                    class="pill redlist"
                    title={r.weight === null
                      ? "IUCN Red List category"
                      : `IUCN Red List category, weight ${r.weight}`}>{r.redlist}</span
                  >
                {/if}
              </div>
              <div class="links">
                {#each linksOf(r) as l (l.label)}
                  <a
                    href={l.href}
                    onclick={(e) => follow(e, l)}
                    target={l.sameApp ? undefined : "_blank"}
                    rel={l.sameApp ? undefined : "noopener"}>{l.label}</a
                  >
                {/each}
              </div>
            </li>
          {/each}
        </ul>
        <div class="foot">
          {#if shown.length > TOP}
            <button
              type="button"
              class="linkish"
              data-testid="raster-cell-species-more"
              onclick={() => (expanded = !expanded)}
              >{expanded ? `Top ${TOP}` : `Show all ${shown.length}`}</button
            >
          {/if}
          <button type="button" class="csv" onclick={download}>Download CSV</button>
        </div>
      {/if}
    {/if}
  {/if}
</section>

<style>
  .raster-cell-species {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  h4 {
    margin: 0;
    font-size: var(--text-sm);
  }
  .autozoom {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--text-xs);
    color: var(--text-secondary);
    cursor: pointer;
  }
  .note,
  .count {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--text-secondary);
  }
  .chips {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
  }
  .pill {
    display: inline-block;
    padding: 0 var(--space-2);
    border: 1px solid var(--border-control);
    border-radius: var(--radius-pill);
    background: var(--fill-control);
    color: var(--text-on-cat);
    font-size: var(--text-xs);
    white-space: nowrap;
  }
  .pill.redlist {
    background: var(--fill-control);
    color: var(--text-primary);
  }
  /* the chips are the filters: pressed = outlined at full strength, the rest of a filtered dimension dimmed */
  .chip {
    font: inherit;
    font-size: var(--text-xs);
    cursor: pointer;
  }
  .chip.dim {
    opacity: 0.55;
  }
  .chip.on {
    outline: 2px solid var(--text-primary);
    outline-offset: 1px;
  }
  .chip:focus-visible {
    outline: 2px solid var(--text-primary);
    outline-offset: 2px;
  }
  .controls {
    display: flex;
    gap: var(--space-2);
  }
  .controls input {
    flex: 1;
    min-width: 0;
  }
  .controls input,
  .controls select {
    font: inherit;
    font-size: var(--text-xs);
    color: var(--text-primary);
    background: var(--fill-control);
    border: 1px solid var(--border-control);
    border-radius: var(--radius-pill);
    padding: 0 var(--space-2);
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
    flex-direction: column;
    gap: 2px;
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
  .meta,
  .links {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--text-xs);
  }
  .links a {
    color: var(--text-link);
  }
  .bar {
    display: inline-block;
    width: 56px;
    height: 8px;
    border: 1px solid var(--border-control);
    border-radius: var(--radius-pill);
    overflow: hidden;
  }
  .bar > span {
    display: block;
    height: 100%;
    background: var(--fill-accent);
  }
  .num {
    font-variant-numeric: tabular-nums;
  }
  .share {
    color: var(--text-secondary);
  }
  .foot {
    display: flex;
    gap: var(--space-3);
    align-items: center;
  }
  .linkish {
    padding: 0;
    border: 0;
    background: none;
    color: var(--text-link);
    font: inherit;
    font-size: var(--text-xs);
    text-decoration: underline;
    cursor: pointer;
    align-self: flex-start;
  }
  .csv {
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
