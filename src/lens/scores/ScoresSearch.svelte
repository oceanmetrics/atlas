<script lang="ts">
  // atlas-8 P-round Q1 (owner-reported defect, live 0.10.50): the Scores lens' top-bar search field
  // was a stub `<input>` -- "the Nominatim geocoder was never attempted" (`ScoresLens.svelte`'s own
  // note). This is its replacement: the SAME "combobox with listbox popup" APG pattern
  // `SpeciesPicker.svelte` already implements for the species lens (roving `aria-activedescendant`,
  // options carry `tabindex="-1"`, Arrow/Enter/Esc drive it from the input) -- kept its own,
  // separate component rather than folded into SpeciesPicker, because the two search DIFFERENT
  // things (zones/coordinates vs. a species index) and Shell.svelte already renders exactly one of
  // them at a time (`sel.lens === "species" ? SpeciesPickerComp : ScoresSearchComp`).
  //
  // No geocoder: `search.ts` matches only against the release's own published zones (`boot.zones`)
  // plus arithmetic on the release's own grid (coordinates) -- no third-party service, no network
  // call, offline-safe (CHANGELOG.md).
  import { uid } from "../../lib/ui/uid";
  import { announce } from "../../lib/ui/announcer";
  import { scoresSearch, scoresSearchDefault, type ScoresSearchMatch } from "./search";

  interface Props {
    boot: unknown;
    onSelectZone: (unit: string, key: string) => void;
    onSelectCoord: (lon: number, lat: number) => void;
    // W6 ("Regions move into the Search bar", Ben 2026-09-25).
    onSelectRegion: (key: string) => void;
  }

  let { boot, onSelectZone, onSelectCoord, onSelectRegion }: Props = $props();

  let query = $state("");
  let open = $state(false);
  let containerEl = $state<HTMLDivElement | undefined>();

  const instanceId = uid("scores-search");
  const listId = `${instanceId}-list`;
  function optionId(i: number): string {
    return `${instanceId}-opt-${i}`;
  }

  const trimmed = $derived(query.trim());
  // W6: "Clicking into the Search box should open the dropdown... before any typing" -- a blank,
  // focused field now lists Regions then Program Areas (`scoresSearchDefault`), not a bare hint.
  const results = $derived(trimmed.length ? scoresSearch(boot, query) : scoresSearchDefault(boot));
  // the dropdown itself is open whenever the field has focus (matches SpeciesPicker's own
  // `dropdownVisible`).
  const dropdownVisible = $derived(open);
  // group headers ("Regions" / "Program Areas") ahead of the first item of each kind -- a plain,
  // presentational label, never an `option` itself; a `coord` match (at most one, always first
  // when present) gets no header, same as before this change.
  const GROUP_LABEL: Record<ScoresSearchMatch["kind"], string | null> = {
    region: "Regions",
    zone: "Program Areas",
    coord: null,
  };
  function groupHeaderFor(i: number): string | null {
    const r = results[i];
    if (i > 0 && results[i - 1].kind === r.kind) return null; // same group as the previous row
    return GROUP_LABEL[r.kind];
  }
  // re-anchors the active option to the first result whenever the result set changes (typing) --
  // the APG pattern's "highlight the first match as you type", same intent as SpeciesPicker's own
  // effect. A WRITABLE `$derived` (not `$state` + `$effect`, SpeciesPicker's own idiom): the single
  // assignment this one-line derivation needs is exactly what `$derived` covers on its own --
  // `moveActive` (below) still reassigns it directly to step through results, a plain override that
  // holds until `results` itself changes and this formula recomputes.
  let activeIndex = $derived<number | null>(results.length ? 0 : null);
  const activeOptionId = $derived(
    activeIndex !== null && results[activeIndex] ? optionId(activeIndex) : null,
  );

  function onInput(value: string) {
    query = value;
    open = true;
  }

  function pick(i: number) {
    const r = results[i];
    if (!r) return;
    open = false;
    query = "";
    if (r.kind === "zone") {
      onSelectZone(r.unit, r.key);
      announce(`Selected ${r.label}.`);
    } else if (r.kind === "region") {
      onSelectRegion(r.key);
      announce(`Zoomed to ${r.label}.`);
    } else {
      onSelectCoord(r.lon, r.lat);
      announce(`Flying to ${r.label}.`);
    }
  }

  // UI-17 (Opus 5.5 eyes-on review, round 3): "the search hint stays open after focus leaves" --
  // Tabbing through the field left the results/hint listbox floating over the map while focus moved
  // on to Share and beyond. Closes only when focus lands OUTSIDE the whole combobox (the input +
  // its dropdown) -- a click on an option moves focus to the option's own `<button>` first (still
  // inside `containerEl`), so that path stays open long enough for `pick()`'s own `onclick` to run.
  function onFocusOut(event: FocusEvent) {
    const next = event.relatedTarget;
    if (next instanceof Node && containerEl?.contains(next)) return;
    open = false;
  }

  function moveActive(delta: number) {
    if (!results.length) return;
    const at = activeIndex ?? -1;
    activeIndex = Math.max(0, Math.min(results.length - 1, at + delta));
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      open = true;
      moveActive(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      moveActive(-1);
    } else if (event.key === "Enter") {
      if (activeIndex === null) return;
      event.preventDefault();
      pick(activeIndex);
    } else if (event.key === "Escape") {
      if (!open) return;
      // the innermost open layer handles Esc first -- same convention as SpeciesPicker's own
      // identical rule (fix list #1).
      event.preventDefault();
      event.stopPropagation();
      open = false;
    }
  }

  function resultKey(r: ScoresSearchMatch, i: number): string {
    if (r.kind === "zone") return `zone:${r.unit}:${r.key}`;
    if (r.kind === "region") return `region:${r.key}`;
    return `coord:${i}`;
  }
</script>

<div class="scores-search" bind:this={containerEl} onfocusout={onFocusOut}>
  <input
    type="search"
    class="scores-search-input"
    role="combobox"
    aria-label="Search Program Areas or coordinates"
    aria-expanded={dropdownVisible}
    aria-controls={dropdownVisible ? listId : undefined}
    aria-autocomplete="list"
    aria-activedescendant={dropdownVisible && activeOptionId ? activeOptionId : undefined}
    placeholder="Regions, Program Areas or lon, lat"
    value={query}
    onfocus={() => (open = true)}
    oninput={(e) => onInput((e.currentTarget as HTMLInputElement).value)}
    onkeydown={onKeydown}
  />

  {#if dropdownVisible}
    <div class="scores-search-dropdown">
      {#if results.length === 0}
        {#if trimmed.length === 0}
          <p class="scores-search-hint" role="presentation">
            Type a Program Area name or key, or coordinates like "-140, 57".
          </p>
        {:else}
          <p class="scores-search-empty" role="presentation">No matches</p>
        {/if}
      {:else}
        <div class="scores-search-list" id={listId} role="listbox" aria-label="Search results">
          {#each results as r, i (resultKey(r, i))}
            {@const header = groupHeaderFor(i)}
            {#if header}
              <p class="scores-search-group-label" aria-hidden="true">{header}</p>
            {/if}
            <button
              type="button"
              id={optionId(i)}
              role="option"
              tabindex="-1"
              aria-selected={i === activeIndex}
              class="scores-search-option"
              class:active={i === activeIndex}
              onclick={() => pick(i)}
            >
              {r.label}
            </button>
          {/each}
        </div>
        <!-- W6: the coordinate syntax hint moves below the list once the dropdown has real rows --
             only for the blank/default state (a typed, non-coordinate query already knows the user
             is not typing coordinates; the hint would just be noise there). -->
        {#if trimmed.length === 0}
          <p class="scores-search-hint scores-search-hint--footer" role="presentation">
            Or type coordinates like "-140, 57".
          </p>
        {/if}
      {/if}
    </div>
  {/if}
</div>

<style>
  .scores-search {
    position: relative;
    display: flex;
    /* SpeciesPicker.svelte's own `.species-picker` rule, and the SAME reason: on the desktop field
       the dropdown is `position: absolute` so this never matters, but the phone modal's own
       `.search-field-phone--scores` override (shell.css) forces it to `position: static` -- without
       `column` here, a plain `display: flex` (row, the default) placed the STATIC dropdown as a
       flex ITEM beside the input instead of stacking it below (eyes-on evidence caught this: the
       results list rendered as a narrow box to the input's right, half off the dialog). */
    flex-direction: column;
    width: 100%;
  }

  /* owner review item 6's SECOND half ("the extra inset outline") -- see SpeciesPicker.svelte's
     own `.picker-input` header (the SAME rule, same reason): the PHONE search modal needs this
     border/padding/background (no ancestor chrome of its own); the DESKTOP topbar field's doubled
     ring is stripped by a desktop-scoped override in `shell.css`
     (`.topbar .search-field .scores-search-input`) instead of here. */
  .scores-search-input {
    width: 100%;
    padding: 0 var(--space-3);
    border: 1px solid var(--border-control);
    border-radius: var(--radius-control);
    background: var(--surface-sunken);
    color: var(--text-primary);
    font: inherit;
  }

  /* mirrors SpeciesPicker.svelte's own `.picker-dropdown` (its header explains why this must be
     absolutely positioned: the topbar's `.search-field` is a fixed-height 32px pill, and nothing
     inside this dropdown may contribute to that box's static in-flow height). */
  .scores-search-dropdown {
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

  .scores-search-hint,
  .scores-search-empty {
    margin: 0;
    padding: var(--space-2) var(--space-3);
    font-size: var(--text-sm);
    color: var(--text-secondary);
  }

  .scores-search-hint--footer {
    border-top: 1px solid var(--border-control);
  }

  .scores-search-list {
    max-height: 320px;
    overflow: auto;
  }

  /* W6: a plain, decorative section label ahead of each kind's first row ("Regions", "Program
     Areas") -- `aria-hidden`, never an `option` or a `listbox` boundary of its own. */
  .scores-search-group-label {
    margin: 0;
    padding: var(--space-1) var(--space-3) 2px;
    font-size: var(--text-xs);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.02em;
    color: var(--text-secondary);
  }

  .scores-search-group-label:not(:first-child) {
    margin-top: var(--space-1);
    border-top: 1px solid var(--border-control);
    padding-top: var(--space-2);
  }

  .scores-search-option {
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

  .scores-search-option:hover {
    background: var(--fill-control);
  }

  /* options carry `tabindex="-1"` (never individually Tab-focused) -- this is the
     aria-activedescendant equivalent of a focus ring, same as SpeciesPicker's own `.active`. */
  .scores-search-option.active {
    outline: 1px dashed var(--border-control);
    outline-offset: -2px;
  }
</style>
