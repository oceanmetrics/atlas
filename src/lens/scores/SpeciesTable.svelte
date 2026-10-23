<script lang="ts">
  // atlas-4 step 2 — the species table (parity doc §7.4/§7.5). A BESPOKE grid rather than
  // src/lib/ui/DataTable.svelte: that component renders every cell as plain text
  // (`String(value)`), and this table needs two REAL `<a>` cells (taxon -> BOTW/WoRMS, model ->
  // the species lens in place) with working modifier-click/new-tab/screen-reader "open link"
  // behaviour, which plain-text cells cannot provide. It still reuses `dataTableCore.ts`'s proven,
  // unit-tested sort/filter functions (CLAUDE.md: "keep core logic in an exported function"), so
  // this component is wiring, not a second implementation of sort/filter semantics. Keyboard CELL
  // navigation (roving tabindex) and row virtualization are NOT re-implemented here — species
  // tables run to the low thousands of rows, not DataTable's 10k design point, and per-column
  // sort/filter plus ordinary Tab order already reach every control; see the atlas-4 report.
  //
  // P3 fix (owner-reported, 2026-09-24): "Table is an absurdity of unintelligible ellipses" — the
  // OLD "R1" rule (see CHANGELOG/git history) divided 12 columns evenly across whatever width the
  // panel happened to be, which on a 390px phone gave every header/cell ~2 characters before an
  // ellipsis. Replaced with: a READABLE minimum width per column (`dataTableCore.ts#columnWidthPx`)
  // + horizontal scroll of the TABLE (not the panel) + a sticky identifying column/header, and on
  // phone widths a curated six-column default with a "Columns" control to add/remove any column
  // (`speciesTableColumns.ts`).
  import { onMount } from "svelte";
  import { announce } from "../../lib/ui/announcer";
  import Icon from "../../lib/ui/Icon.svelte";
  import SciName from "../../lib/ui/SciName.svelte";
  import {
    columnWidthPx,
    filterRows,
    sortRows,
    totalTableWidthPx,
    type DataTableColumn,
    type SortDirection,
  } from "../../lib/ui/dataTableCore";
  import { viewportBucket } from "../../lib/ui/panelGeometry";
  import type { SpeciesRow } from "../../lib/analysis/queries";
  import type { Sel } from "../../lib/state/types";
  import { categoryLabel } from "../../lib/ui/categories";
  import { formatAreaKm2, formatPercent0, formatPercent2, modelHref, taxonUrl } from "./species";
  import { SPECIES_PHONE_DEFAULT_COLUMNS, visibleSpeciesColumnKeys } from "./speciesTableColumns";
  import { speciesColumnsState } from "./speciesTableColumnsState.svelte";

  interface Props {
    label: string;
    rows: SpeciesRow[];
    sel: Sel;
    onModelClick: (mdlKey: string) => void;
  }

  let { label, rows, sel, onModelClick }: Props = $props();

  function taxonStr(row: SpeciesRow): string {
    return `${row.taxon_authority ?? ""}:${row.taxon_id ?? ""}`;
  }

  // the first identifying column -- sticky on the left (P3: "the first identifying column
  // (Scientific name for species rows) sticky"). A `position: sticky; left: 0` cell need not be
  // FIRST in row order to stick correctly: it pins to the scroll container's left edge and (with
  // an opaque background) covers whatever scrolls underneath it, so `cat`/`taxon` stay ahead of it
  // in column order -- unchanged from before this fix, and unchanged in the CSV export order
  // (TablePanel.svelte's own, independent `columns` array).
  const STICKY_COLUMN_KEY = "scientific";

  const columns: DataTableColumn<SpeciesRow>[] = [
    // P round V2 fix (Opus eyes-on: raw lowercase categories show in the UI): `value` stays the
    // raw `sp_cat` (sort/filter compare it as-is, same as before); `format` is the cell's DISPLAY
    // text, this component's own `cellText()` prefers it over `String(value)`.
    {
      key: "cat",
      label: "Category",
      value: (r) => r.sp_cat,
      format: (r) => categoryLabel(r.sp_cat),
      sortable: true,
    },
    { key: "taxon", label: "Taxon", value: taxonStr, sortable: true },
    { key: "scientific", label: "Scientific name", value: (r) => r.sp_scientific, sortable: true },
    { key: "common", label: "Common name", value: (r) => r.sp_common ?? "", sortable: true },
    { key: "er_code", label: "ER code", value: (r) => r.er_code ?? "", sortable: true },
    {
      key: "er_score",
      label: "ER score",
      value: (r) => r.er_score,
      format: (r) => formatPercent0(r.er_score),
      sortable: true,
      numeric: true,
    },
    { key: "model", label: "Model", value: (r) => r.mdl_key, sortable: true },
    {
      key: "is_mmpa",
      label: "MMPA",
      value: (r) => r.is_mmpa,
      format: (r) => (r.is_mmpa ? "Yes" : "No"),
      sortable: true,
      narrow: true,
    },
    {
      key: "is_mbta",
      label: "MBTA",
      value: (r) => r.is_mbta,
      format: (r) => (r.is_mbta ? "Yes" : "No"),
      sortable: true,
      narrow: true,
    },
    {
      key: "area_km2",
      label: "Area (km²)",
      value: (r) => r.area_km2,
      format: (r) => formatAreaKm2(r.area_km2),
      sortable: true,
      numeric: true,
      // R3-B9: the filter box is narrower than "Area (km²)" -- truncated to "Area (kn" in review.
      filterPlaceholder: "Area",
    },
    {
      key: "avg_suit",
      label: "Avg. suitability",
      value: (r) => r.avg_suit,
      format: (r) => formatPercent2(r.avg_suit),
      sortable: true,
      numeric: true,
      filterPlaceholder: "Suit.",
    },
    {
      key: "pct_cat",
      label: "% of category",
      value: (r) => r.pct_cat,
      format: (r) => formatPercent2(r.pct_cat),
      sortable: true,
      numeric: true,
      filterPlaceholder: "% cat",
    },
  ];
  const ALL_COLUMN_KEYS = columns.map((c) => c.key);

  // --- phone column subset + "Columns" picker (P3) ------------------------------------------------
  let viewportWidth = $state(typeof window === "undefined" ? 1280 : window.innerWidth);
  onMount(() => {
    const onResize = () => (viewportWidth = window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  });
  const isPhone = $derived(viewportBucket(viewportWidth) === "phone");

  const visibleColumns = $derived.by(() => {
    const keys = new Set(
      visibleSpeciesColumnKeys(ALL_COLUMN_KEYS, viewportWidth, speciesColumnsState.chosen),
    );
    return columns.filter((c) => keys.has(c.key));
  });

  // dataTableCore.ts's own header: `table-layout: fixed` only honours a `<colgroup>`'s widths once
  // the `<table>` has an explicit (summed) pixel width -- `width: max-content`/`auto` do not
  // qualify, and were measured (a bare-HTML repro, no app code) to make every column ignore its
  // `<col>` width and size itself from its own CONTENT instead.
  const tableWidthPx = $derived(totalTableWidthPx(visibleColumns));

  let columnsOpen = $state(false);
  let columnsButtonEl = $state<HTMLButtonElement | undefined>();

  /** the checklist's own notion of "checked", independent of whether the user has ever opened it
   * -- reads the phone default until a real choice exists (mirrors `visibleSpeciesColumnKeys`'
   * own `chosen ?? default` rule, so the checkboxes never show a state the table itself does not). */
  function isColumnChecked(key: string): boolean {
    const chosen = speciesColumnsState.chosen ?? new Set(SPECIES_PHONE_DEFAULT_COLUMNS);
    return chosen.has(key);
  }

  function toggleColumn(key: string, checked: boolean) {
    // a plain Set, not SvelteSet: this is a THROWAWAY copy mutated once and handed off as the new
    // value of `speciesColumnsState.chosen` (an already-reactive `$state` field) on the next line
    // -- reactivity comes from reassigning that field, not from observing this Set in place
    // (Toast.svelte's own identical exception to this rule, same reasoning).
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    const next = new Set(speciesColumnsState.chosen ?? SPECIES_PHONE_DEFAULT_COLUMNS);
    if (checked) next.add(key);
    else next.delete(key);
    speciesColumnsState.chosen = next;
  }

  function closeColumnsPopover() {
    if (!columnsOpen) return;
    columnsOpen = false;
    columnsButtonEl?.focus();
  }

  function onColumnsPopoverKeydown(event: KeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeColumnsPopover();
    }
  }

  let sortColumnKey = $state<string | null>(null);
  let sortDirection = $state<SortDirection>(null);
  let filters = $state<Record<string, string>>({});

  const sortColumn = $derived(columns.find((c) => c.key === sortColumnKey));
  const filteredRows = $derived(filterRows(rows, columns, filters));
  const sortedRows = $derived(sortRows(filteredRows, sortColumn, sortDirection));

  let isInitialLoad = true;
  $effect(() => {
    const count = filteredRows.length;
    announce(
      isInitialLoad
        ? `${label} loaded, ${count.toLocaleString("en-US")} rows`
        : `Filtered to ${count.toLocaleString("en-US")} rows`,
    );
    isInitialLoad = false;
  });

  function ariaSortFor(col: DataTableColumn<SpeciesRow>) {
    if (!col.sortable) return undefined;
    if (sortColumnKey !== col.key || !sortDirection) return "none" as const;
    return sortDirection === "asc" ? ("ascending" as const) : ("descending" as const);
  }

  function toggleSort(col: DataTableColumn<SpeciesRow>) {
    if (!col.sortable) return;
    if (sortColumnKey !== col.key) {
      sortColumnKey = col.key;
      sortDirection = "asc";
    } else if (sortDirection === "asc") {
      sortDirection = "desc";
    } else {
      sortColumnKey = null;
      sortDirection = null;
    }
  }

  function onFilterInput(key: string, value: string) {
    filters = { ...filters, [key]: value };
  }

  function cellText(row: SpeciesRow, col: DataTableColumn<SpeciesRow>): string {
    return col.format ? col.format(row) : String(col.value(row) ?? "");
  }

  /** the model link's ordinary click: switch lens IN PLACE (no reload); a modifier-click or
   * middle-click falls through to the browser's own new-tab default action untouched. */
  function handleModelClick(event: MouseEvent, mdlKey: string) {
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    onModelClick(mdlKey);
  }
</script>

<div class="species-table">
  {#if isPhone}
    <div class="columns-bar">
      <div class="columns-control">
        <button
          type="button"
          class="columns-btn"
          bind:this={columnsButtonEl}
          aria-expanded={columnsOpen}
          aria-controls="species-columns-popover"
          onclick={() => (columnsOpen = !columnsOpen)}
        >
          <Icon name="filter" size={14} />
          Columns
        </button>
        {#if columnsOpen}
          <!-- delegated keydown (Escape closes) on a container that owns focusable descendants --
               same convention as src/lib/ui/DataTable.svelte's own roving-tabindex `<tbody>`. -->
          <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
          <div
            class="columns-popover"
            id="species-columns-popover"
            role="group"
            aria-label="Choose visible columns"
            onkeydown={onColumnsPopoverKeydown}
          >
            {#each columns as col (col.key)}
              <label class="columns-option">
                <input
                  type="checkbox"
                  checked={isColumnChecked(col.key)}
                  onchange={(e) =>
                    toggleColumn(col.key, (e.currentTarget as HTMLInputElement).checked)}
                />
                {col.label}
              </label>
            {/each}
            <button type="button" class="columns-done" onclick={closeColumnsPopover}>Done</button>
          </div>
        {/if}
      </div>
    </div>
  {/if}

  <div class="scroll-region">
    <table class="grid" style={`width:${tableWidthPx}px`} aria-label={label}>
      <colgroup>
        {#each visibleColumns as col (col.key)}
          <col style={`width:${columnWidthPx(col)}px`} />
        {/each}
      </colgroup>
      <thead>
        <tr>
          {#each visibleColumns as col (col.key)}
            <th
              scope="col"
              class:sticky-col={col.key === STICKY_COLUMN_KEY}
              aria-sort={ariaSortFor(col)}
            >
              {#if col.sortable}
                <button type="button" class="sort-btn" onclick={() => toggleSort(col)}>
                  <span>{col.label}</span>
                  {#if sortColumnKey === col.key && sortDirection}
                    <Icon name={sortDirection === "asc" ? "sortAsc" : "sortDesc"} size={14} />
                  {/if}
                </button>
              {:else}
                {col.label}
              {/if}
            </th>
          {/each}
        </tr>
        <tr class="filter-row">
          {#each visibleColumns as col (col.key)}
            <th scope="col" class:sticky-col={col.key === STICKY_COLUMN_KEY}>
              <label class="filter-field">
                <span class="sr-only">Filter {col.label}</span>
                <Icon name="filter" size={12} class="filter-icon" />
                <input
                  type="text"
                  value={filters[col.key] ?? ""}
                  placeholder={col.filterPlaceholder ?? col.label}
                  title={`Filter ${col.label}`}
                  oninput={(e) =>
                    onFilterInput(col.key, (e.currentTarget as HTMLInputElement).value)}
                />
              </label>
            </th>
          {/each}
        </tr>
      </thead>
      <tbody>
        {#if sortedRows.length === 0}
          <tr>
            <td colspan={visibleColumns.length} class="empty">No rows match the current filter.</td>
          </tr>
        {:else}
          {#each sortedRows as row (row.mdl_key + "|" + row.sp_scientific)}
            <tr>
              {#each visibleColumns as col (col.key)}
                <td
                  class:num={col.numeric}
                  class:sticky-col={col.key === STICKY_COLUMN_KEY}
                  title={cellText(row, col)}
                >
                  {#if col.key === "taxon"}
                    <a
                      href={taxonUrl(row.taxon_authority, row.taxon_id)}
                      target="_blank"
                      rel="noopener"
                    >
                      {cellText(row, col)}
                    </a>
                  {:else if col.key === "model"}
                    <a
                      href={modelHref(sel, row.mdl_key)}
                      onclick={(e) => handleModelClick(e, row.mdl_key)}
                    >
                      {cellText(row, col)}
                    </a>
                  {:else if col.key === "scientific"}
                    <!-- UI-13 (round 3): every printed binomial goes through the SAME `<SciName>`
                         (italic) -- this table used to print it upright, the one style break next
                         to the (already-italic) species card/popup. -->
                    <SciName name={cellText(row, col)} />
                  {:else}
                    {cellText(row, col)}
                  {/if}
                </td>
              {/each}
            </tr>
          {/each}
        {/if}
      </tbody>
    </table>
  </div>
</div>

<style>
  .species-table {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    font-size: var(--text-sm);
    /* R3-B9 (Opus eyes-on review, 2026-09-25): fills whatever height `TablePanel.svelte`'s own
       `height: 100%` now hands down, so `.scroll-region` below (flex: 1) can grow into a tall
       desktop panel instead of stopping at a fixed 50vh and leaving the rest of the panel blank.
       `min-height: 0` is the flex-child fix for "a flex item's automatic minimum size is its
       content size" -- without it this box refuses to shrink below the table's own full height,
       and `.scroll-region`'s internal scroll never engages at all. Resolves to `auto` (no-op) when
       an ancestor's own height is itself `auto` (the gallery, Panel.svelte's own identical note),
       so this degrades gracefully anywhere this component is mounted without a definite height. */
    height: 100%;
    min-height: 0;
  }

  .columns-bar {
    display: flex;
    justify-content: flex-end;
  }

  .columns-control {
    position: relative;
  }

  .columns-btn {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    height: var(--size-touch);
    padding: 0 var(--space-3);
    border: 1px solid var(--border-control);
    border-radius: var(--radius-control);
    background: var(--fill-control);
    color: var(--text-primary);
    font: inherit;
    font-size: var(--text-sm);
    cursor: pointer;
  }

  .columns-btn:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }

  .columns-btn[aria-expanded="true"] {
    color: var(--text-accent);
    border-color: var(--text-accent);
  }

  .columns-popover {
    position: absolute;
    z-index: 20;
    top: calc(100% + var(--space-1));
    right: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    width: 200px;
    max-height: 60vh;
    overflow: auto;
    padding: var(--space-2);
    border: 1px solid var(--border-control);
    border-radius: var(--radius-card);
    background: var(--surface-raised);
    color: var(--text-primary);
    box-shadow: var(--elev-3);
  }

  .columns-option {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--text-sm);
    min-height: var(--size-touch);
  }

  .columns-done {
    align-self: flex-end;
    margin-top: var(--space-1);
    height: var(--size-touch);
    padding: 0 var(--space-3);
    border: 1px solid var(--border-control);
    border-radius: var(--radius-control);
    background: var(--fill-control);
    color: var(--text-primary);
    font: inherit;
    font-size: var(--text-sm);
    cursor: pointer;
  }

  .scroll-region {
    /* P3 fix: the TABLE scrolls horizontally (the panel around it never does) -- `overflow: auto`
       handles both axes, and the table below is allowed to be WIDER than this box.
       R3-B9: a fixed `max-height: 50vh` left ~180px of blank panel below the table on a tall
       desktop dock (the box never grew past half the viewport no matter how tall the panel
       actually was) -- `flex: 1` (this box's own parent, `.species-table`, is a flex column with
       `height: 100%`) lets it fill whatever the panel actually gives it instead. `min-height`
       keeps a handful of rows visible even where the panel is short (the phone sheet's "half"
       detent) -- the closest equivalent of the OLD cap's floor, not its ceiling. */
    overflow: auto;
    flex: 1;
    min-height: 160px;
    border: 1px solid var(--border-control);
    border-radius: var(--radius-control);
  }

  /* P3 fix (owner-reported, 2026-09-24, replaces the old "R1" fixed-even-division rule): each
     column gets an explicit width from `<colgroup>` (`dataTableCore.ts#columnWidthPx` -- a
     readable minimum for text, narrower for numeric/boolean); `width` (the SUM of those widths,
     `tableWidthPx`) is set inline above, per dataTableCore.ts's own header -- `table-layout: fixed`
     only honours a `<colgroup>` once the table has a DEFINITE width. `min-width: 100%` still
     stretches it (proportionally) to fill a panel wide enough to hold every column without
     scrolling. */
  .grid {
    min-width: 100%;
    table-layout: fixed;
    border-collapse: collapse;
    font-variant-numeric: tabular-nums;
  }

  thead th {
    position: sticky;
    top: 0;
    z-index: 1;
    background: var(--surface-sunken);
    text-align: left;
    padding: 0;
  }

  /* the first identifying column (Scientific name): sticky on the LEFT too, so it survives a
     horizontal scroll the same way the header row survives a vertical one. A header cell that is
     both column- and row-sticky needs the higher z-index so it stacks above a plain top-sticky
     header cell scrolling underneath it. */
  .sticky-col {
    position: sticky;
    left: 0;
    z-index: 2;
    background: var(--surface-sunken);
  }

  tbody td.sticky-col {
    z-index: 1;
    /* an OPAQUE surface (not the panel's own translucent glass background) -- this cell must
       fully cover whatever column scrolled out from underneath it, not blend with it. */
    background: var(--surface-raised);
  }

  .sort-btn {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-1);
    width: 100%;
    padding: var(--space-2);
    border: 0;
    background: none;
    color: var(--text-primary);
    font: inherit;
    font-weight: 700;
    text-align: left;
    cursor: pointer;
  }

  .sort-btn:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: -2px;
  }

  th[aria-sort="ascending"] .sort-btn,
  th[aria-sort="descending"] .sort-btn {
    color: var(--text-accent);
  }

  /* P3 fix: a header label is NEVER truncated -- it wraps (to two lines, typically, at this
     column's minimum width) instead of ellipsizing away the column's own name. */
  .sort-btn span {
    white-space: normal;
    overflow-wrap: break-word;
  }

  .filter-row th {
    padding: var(--space-1) var(--space-2) var(--space-2);
    font-weight: 400;
  }

  .filter-field {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    border: 1px solid var(--border-control);
    border-radius: var(--radius-control);
    padding: 0 var(--space-1);
    background: var(--surface-sunken);
  }

  .filter-field input {
    flex: 1;
    min-width: 0;
    border: 0;
    background: none;
    color: var(--text-primary);
    font: inherit;
    font-size: var(--text-xs);
    padding: var(--space-1);
    width: 100%;
  }

  td {
    padding: var(--space-1) var(--space-2);
    border-bottom: 1px solid var(--divider);
    /* R4-C: at full stage a cell wraps instead of truncating (the readable column minimum + the
       table's own horizontal scroll still cover a phone). */
    overflow-wrap: anywhere;
  }

  td.num {
    text-align: right;
  }

  /* the taxon/model links: same ellipsis treatment as plain cell text (the `<a>`, not `td` alone,
     is what actually overflows -- an inline element's text does not ellipsis on its own). */
  td a {
    display: block;
  }

  .empty {
    padding: var(--space-4);
    text-align: center;
    color: var(--text-secondary);
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
</style>
