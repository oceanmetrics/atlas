<script lang="ts">
  // §5.4's species picker: client-side search over ~22k rows, grouped by sp_cat, "Only species in
  // US waters" (default on, keeping the selection across the swap — §13.1's trap), a virtualized
  // list (reusing `dataTableCore.ts`'s window math — the same tested code the species/zone tables
  // use, rather than a second virtualization implementation). Mounted into the shell's topbar
  // search field (the shared "Search species and places" input) when the species lens is active.
  //
  // atlas-4/5 defect fix: "Only species in US waters" used to sit as a THIRD static row inside the
  // topbar's fixed-height search pill (Shell.svelte's `.search-field`, 32 px) -- always rendered,
  // so it overflowed/clipped the pill on every load, species selected or not (the owner's
  // screenshot). It now renders as the dropdown's header, the first thing inside the SAME opened
  // panel the results list already uses (`.picker-dropdown`, absolutely positioned, opens only
  // once the field is focused) -- never part of the field's own static box, and still the very
  // next focusable element after the input (Tab from the field reaches it before any result row).
  // The picker's OWN list header, not the Layers panel's species section: it filters what the
  // SEARCH shows, not what the MAP draws, so it belongs beside the search it filters, not beside
  // layer/palette controls three tools away that Tab from the field could never reach anyway.
  import { onDestroy } from "svelte";
  import { computeVisibleWindow } from "../../lib/ui/dataTableCore";
  import { announce } from "../../lib/ui/announcer";
  import { uid } from "../../lib/ui/uid";
  import {
    createSearchLogger,
    groupByCat,
    keepSelection,
    searchTaxa,
    visibleRows,
    type PickerRow,
    type TaxaIndex,
  } from "./data/picker";

  interface Props {
    index: TaxaIndex | null;
    selected: string | undefined;
    usOnly: boolean;
    onSelect: (key: string) => void;
    onSetUsOnly: (enabled: boolean) => void;
    /** `createSearchLogger` (data/picker.ts) already owns the 900 ms debounce, the >= 3 char
     * gate and the no-repeats rule — this fires only once all three have already passed. */
    onSearchLogged: (query: string) => void;
    onFocusIndex: () => void;
    /** show the "Only species in US waters" box (default). A global registry (the AquaMaps native
     * collection) has no such notion: it passes `false`, and every taxon is offered. */
    showUsFilter?: boolean;
  }

  let {
    index,
    selected,
    usOnly,
    onSelect,
    onSetUsOnly,
    onSearchLogged,
    onFocusIndex,
    showUsFilter = true,
  }: Props = $props();

  let query = $state("");
  let open = $state(false);
  let scrollTop = $state(0);
  let listEl = $state<HTMLDivElement | undefined>();

  // fix list #8 (SC 4.1.2 + 1.3.1): the APG "combobox with listbox popup" pattern.
  // `instanceId` (uid(), never a bare literal — HexButton/Modal/Popover's own identical rule)
  // gives the listbox an id `aria-controls` can point at, and every option a stable id
  // `aria-activedescendant` can address (row.key is already unique and stable, so the option ids
  // survive re-filtering). `activeIndex` is an index into `rows` (below) and is ALWAYS a "row"
  // (never a "header") entry when non-null. Options carry `tabindex="-1"` on purpose -- the
  // preferred variant of this pattern keeps them OUT of the Tab sequence entirely; a screen-reader
  // or keyboard user drives the list from the input with Arrow/Enter/Esc instead.
  const instanceId = uid("picker");
  const listId = `${instanceId}-list`;
  function optionId(key: string): string {
    return `${instanceId}-opt-${key}`;
  }

  let activeIndex = $state<number | null>(null);

  const searchLogger = createSearchLogger({
    onLog: (q) => {
      onSearchLogged(q);
      // reuses the SAME debounce as the analytics log (rather than a second, independent one):
      // a query too short to log (< 3 folded chars) also skips this announcement, which is the
      // right call -- announcing on every keystroke of "l", "le", "lea" would be noise, not help.
      const n = resultCount;
      announce(`${n} result${n === 1 ? "" : "s"} for "${q}".`);
    },
  });
  onDestroy(() => searchLogger.destroy());

  const ROW_HEIGHT = 28;
  const VIEWPORT_HEIGHT = 320;

  type Row = { kind: "header"; cat: string } | { kind: "row"; row: PickerRow };

  function flatten(): Row[] {
    if (!index) return [];
    if (query.trim().length === 0) {
      const groups = groupByCat(visibleRows(index, usOnly));
      const out: Row[] = [];
      for (const g of groups) {
        out.push({ kind: "header", cat: g.cat });
        for (const r of g.rows) out.push({ kind: "row", row: r });
      }
      return out;
    }
    return searchTaxa(index, query, { usOnly }).map((m) => ({ kind: "row", row: m.row }) as Row);
  }

  const rows = $derived(flatten());
  const resultCount = $derived(rows.filter((r) => r.kind === "row").length);
  // BOTH the dropdown's presence and everything that points at it (aria-controls,
  // aria-activedescendant) key off this SAME flag -- an attribute referencing an id that does not
  // exist yet (`open` true but `index` still loading, so the `{#if}` below has not rendered it)
  // would be exactly the "aria-controls points at nothing" defect Popover.svelte's own header
  // warns against.
  const dropdownVisible = $derived(open && !!index);
  const windowState = $derived(
    computeVisibleWindow({
      scrollTop,
      viewportHeight: VIEWPORT_HEIGHT,
      rowHeight: ROW_HEIGHT,
      totalRows: rows.length,
    }),
  );
  const visible = $derived(rows.slice(windowState.startIndex, windowState.endIndex));
  const activeOptionId = $derived.by(() => {
    if (activeIndex === null) return null;
    const r = rows[activeIndex];
    return r?.kind === "row" ? optionId(r.row.key) : null;
  });

  // re-anchors the activedescendant to the first real match whenever the filtered/grouped set
  // changes (typing, "US only", or the index arriving for the first time) -- the APG pattern's
  // "highlight the first match as you type".
  $effect(() => {
    const firstRow = rows.findIndex((r) => r.kind === "row");
    activeIndex = firstRow === -1 ? null : firstRow;
  });

  function onInput(value: string) {
    query = value;
    open = true;
    searchLogger.onInput(query);
  }

  function pick(row: PickerRow) {
    open = false;
    query = "";
    onSelect(row.key);
  }

  function onScroll(e: Event) {
    scrollTop = (e.currentTarget as HTMLDivElement).scrollTop;
  }

  function toggleUsOnly(next: boolean) {
    if (!index) {
      onSetUsOnly(next);
      return;
    }
    const kept = keepSelection(index, selected, next);
    onSetUsOnly(next);
    if (kept && kept !== selected) onSelect(kept);
  }

  /** every index into `rows` that is a "row" (never a "header"), in order -- what
   * ArrowUp/ArrowDown step through. */
  function optionIndices(): number[] {
    const out: number[] = [];
    rows.forEach((r, i) => {
      if (r.kind === "row") out.push(i);
    });
    return out;
  }

  /** scrolls the virtualized list just enough that row `i` enters the rendered window --
   * `computeVisibleWindow`'s own arithmetic (dataTableCore.ts), the SAME code the species/zone
   * tables already use for it. Keyboard-only navigation must never depend on the target option
   * already being in the DOM: only ~12 of ~22k rows are rendered at a time. */
  function ensureRowVisible(i: number) {
    const top = i * ROW_HEIGHT;
    const bottom = top + ROW_HEIGHT;
    let next = scrollTop;
    if (top < next) next = top;
    else if (bottom > next + VIEWPORT_HEIGHT) next = bottom - VIEWPORT_HEIGHT;
    if (next === scrollTop) return;
    scrollTop = next;
    if (listEl) listEl.scrollTop = next;
  }

  function moveActive(delta: number) {
    const indices = optionIndices();
    if (indices.length === 0) return;
    const at = activeIndex === null ? -1 : indices.indexOf(activeIndex);
    const nextPos = Math.max(0, Math.min(indices.length - 1, at + delta));
    activeIndex = indices[nextPos];
    ensureRowVisible(activeIndex);
  }

  function onInputKeydown(event: KeyboardEvent) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      open = true;
      moveActive(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      moveActive(-1);
    } else if (event.key === "Enter") {
      if (activeIndex === null) return;
      const r = rows[activeIndex];
      if (r?.kind !== "row") return;
      event.preventDefault();
      pick(r.row);
    } else if (event.key === "Escape") {
      if (!open) return;
      // the innermost open layer handles Esc first -- same convention as Modal/Popover/Panel's
      // own fixes (fix list #1); belt-and-suspenders here (this field has no enclosing Panel to
      // protect against today, but the field could move under one later).
      event.preventDefault();
      event.stopPropagation();
      open = false;
    }
  }
</script>

<div class="species-picker">
  <input
    type="search"
    class="picker-input"
    role="combobox"
    aria-label="Search species"
    aria-expanded={dropdownVisible}
    aria-controls={dropdownVisible ? listId : undefined}
    aria-autocomplete="list"
    aria-activedescendant={dropdownVisible && activeOptionId ? activeOptionId : undefined}
    placeholder="Search species"
    value={query}
    onfocus={() => {
      open = true;
      onFocusIndex();
    }}
    oninput={(e) => onInput((e.currentTarget as HTMLInputElement).value)}
    onkeydown={onInputKeydown}
  />

  {#if dropdownVisible}
    <div class="picker-dropdown">
      {#if showUsFilter}
        <label class="us-only">
          <input
            type="checkbox"
            checked={usOnly}
            onchange={(e) => toggleUsOnly(e.currentTarget.checked)}
          />
          Only species in US waters
        </label>
      {/if}
      <div
        class="picker-list"
        id={listId}
        role="listbox"
        aria-label="Species results"
        style={`height:${VIEWPORT_HEIGHT}px`}
        bind:this={listEl}
        onscroll={onScroll}
      >
        <div style={`height:${windowState.paddingTop}px`}></div>
        {#each visible as r, i (r.kind === "row" ? r.row.key : `hdr-${windowState.startIndex + i}`)}
          {#if r.kind === "header"}
            <div class="picker-group" role="presentation">{r.cat}</div>
          {:else}
            <button
              type="button"
              id={optionId(r.row.key)}
              role="option"
              tabindex="-1"
              aria-selected={r.row.key === selected}
              class="picker-option"
              class:selected={r.row.key === selected}
              class:active={windowState.startIndex + i === activeIndex}
              onclick={() => pick(r.row)}
            >
              {r.row.label}
            </button>
          {/if}
        {/each}
        <div style={`height:${windowState.paddingBottom}px`}></div>
      </div>
    </div>
  {/if}
</div>

<style>
  /* owner review item 6 (live 0.10.62, "Search bar is narrower for Species than Scores... can we
     keep it clean and wide without [the extra inset outline]?"): `width: 100%` -- WITHOUT it, this
     flex item of the topbar's `.search-field` (inline-flex, row) sizes to its own content instead
     of stretching to fill the field, unlike `ScoresSearch.svelte`'s own `.scores-search`, which
     already carries this rule -- that mismatch was the width difference Ben saw between the two
     lenses. */
  .species-picker {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    width: 100%;
  }

  /* owner review item 6's SECOND half ("the extra inset outline"): this component's own field
     still carries its full border/padding/background here -- the PHONE search modal
     (`.search-field-phone-control`, shell.css) has no ancestor chrome of its own and genuinely
     needs it. The DESKTOP topbar field's redundant, doubled ring (`.search-field` already draws
     the SAME border/padding/background one level up) is instead stripped by a DESKTOP-SCOPED
     override in `shell.css` (`.topbar .search-field .picker-input`) -- see that rule's own header
     for why it lives there, not here. */
  .picker-input {
    /* NOT --size-touch (44px): this field is desktop-only (Shell.svelte's `.search-field` is
       `topbar-desktop-only`, hidden entirely on phone) and its container is a fixed 32 px pill
       (shell.css's own control-row height, spec.md §11's "32-40 px desktop chrome" — 44 px is only
       required under `(pointer: coarse)`, and a bare 44 px here is what overflowed the pill (the
       owner's screenshot) even before the "US only" switch was added below it. Sized like the
       plain `<input>` this replaces (`.search-field input` in shell.css), not overridden here. */
    width: 100%;
    padding: 0 var(--space-3);
    border: 1px solid var(--border-control);
    border-radius: var(--radius-control);
    background: var(--surface-sunken);
    color: var(--text-primary);
    font: inherit;
  }

  /* the dropdown's own container -- absolutely positioned below the field (moved here FROM
     `.picker-list`, atlas-4/5 defect fix), so nothing inside it (the "US only" header or the
     results list) ever contributes to `.species-picker`'s static in-flow height, which is what
     overflowed the topbar's fixed-height search pill. */
  .picker-dropdown {
    position: absolute;
    top: calc(100% + var(--space-1));
    left: 0;
    right: 0;
    z-index: 30;
    border: 1px solid var(--border-control);
    border-radius: var(--radius-control);
    background: var(--surface-raised);
    box-shadow: var(--elev-3);
  }

  .us-only {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-2) var(--space-3);
    border-bottom: 1px solid var(--border-control);
    font-size: var(--text-sm);
    color: var(--text-secondary);
  }

  /* shell.css's `.search-field input { flex: 1; min-width: 0; ... }` is written for the search
     TEXT input and matches every `input` descendant of `.search-field`, however deep -- including
     this checkbox (pre-existing, both before and after this fix's relocation). `flex-basis: 0%` +
     `min-width: 0` collapses it to 0 CSS px whenever `.us-only`'s row is narrower than its content
     (it always is, at this field's ~140 px width) -- invisible and unclickable, part of the same
     "crammed" defect. `flex: none` (bare `flex-grow`/`flex-shrink: 0`, `flex-basis: auto`) opts
     this one control out and keeps its natural checkbox size regardless of available space. */
  .us-only input {
    flex: none;
  }

  .picker-list {
    overflow: auto;
  }

  .picker-group {
    padding: var(--space-1) var(--space-3);
    font-size: var(--text-xs);
    font-weight: 700;
    color: var(--text-secondary);
    background: var(--surface-sunken);
  }

  .picker-option {
    display: block;
    width: 100%;
    text-align: left;
    padding: var(--space-1) var(--space-3);
    border: 0;
    background: none;
    color: var(--text-primary);
    font: inherit;
    font-size: var(--text-sm);
    cursor: pointer;
  }

  .picker-option:hover,
  .picker-option.selected {
    background: var(--fill-control);
  }

  /* fix list #8: options carry `tabindex="-1"` (never individually Tab-focused), so this is NOT
     a real focus indicator -- it is the aria-activedescendant equivalent of DataTable.svelte's
     own `.cell--active` convention, a lighter, dashed marker distinct from the strong
     `:focus-visible` ring so the two are never confused (SC 2.4.7 note, same reasoning). */
  .picker-option.active {
    outline: 1px dashed var(--border-control);
    outline-offset: -2px;
  }
</style>
