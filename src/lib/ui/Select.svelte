<script lang="ts" module>
  export interface SelectOption {
    value: string;
    label: string;
    /** a native disabled `<option>`: listed (so the viewer sees it exists) but not choosable. */
    disabled?: boolean;
  }

  /** R3-B2 (round-3 plan, `LayersPanel.svelte`'s "Layer" picker): one `<optgroup>`. */
  export interface SelectOptionGroup {
    label: string;
    options: SelectOption[];
  }
</script>

<script lang="ts">
  // atlas-3 spec.md §6: "version | mdiChevronDown | the v7 ▾ chip, every <select>-like control."
  // A native <select> underneath (full keyboard/AT support for free) with the chevron as a
  // decorative overlay -- the select itself carries the accessible name, the icon is aria-hidden.
  import Icon from "./Icon.svelte";
  import { uid } from "./uid";

  interface Props {
    /** a flat option list -- mutually exclusive with `groups` (every real caller today uses ONE
     * or the other, never both; when both are given `groups` wins and `options` is ignored). */
    options?: SelectOption[];
    /** R3-B2 (round-3 plan): the Layer picker's `<optgroup>`s (composite/component/raw) -- was a
     * bespoke native `<select>` in `lens/scores/LayersPanel.svelte` duplicating everything this
     * component already does (the chevron overlay, the width/focus rules); this is the ONE select
     * control every picker in the app now uses, grouped or not. */
    groups?: SelectOptionGroup[];
    value: string;
    /** the accessible name (aria-label) -- spec.md's controls carry no visible label of their own */
    label: string;
    /** the closed box's own `title` attribute (portable tooltip fallback -- see `.select`'s own
     * `text-overflow` comment in `lens/scores/LayersPanel.svelte`'s history: WebKit never reaches
     * CSS ellipsis on a closed `<select>`'s value). Defaults to the selected option's own label. */
    title?: string;
    onchange?: (value: string) => void;
    id?: string;
  }

  let { options, groups, value, label, title, onchange, id }: Props = $props();

  const effectiveGroups = $derived<SelectOptionGroup[]>(
    groups ?? [{ label: "", options: options ?? [] }],
  );
  const selectedLabel = $derived(
    effectiveGroups.flatMap((g) => g.options).find((o) => o.value === value)?.label,
  );
  // per-INSTANCE, not per-label, when no explicit id is given (SC 4.1.2) -- see HexButton.svelte's
  // identical fix. Resolved ONCE, a plain const, never re-run on a later render.
  // svelte-ignore state_referenced_locally
  const selectId = id ?? uid("select");

  // the innermost open layer handles Esc first: while the native listbox is open, Escape closing
  // it is the browser's own default action and does not stop the keydown from also bubbling to an
  // enclosing Panel's Escape-collapses-it handler.
  function handleKeydown(event: KeyboardEvent) {
    if (event.key === "Escape") event.stopPropagation();
  }
</script>

<span class="select-wrap">
  <select
    id={selectId}
    class="select"
    aria-label={label}
    title={title ?? selectedLabel}
    {value}
    onchange={(e) => onchange?.(e.currentTarget.value)}
    onkeydown={handleKeydown}
  >
    {#each effectiveGroups as group (group.label || "_ungrouped")}
      {#if groups}
        <optgroup label={group.label}>
          {#each group.options as opt (opt.value)}
            <option value={opt.value} disabled={opt.disabled}>{opt.label}</option>
          {/each}
        </optgroup>
      {:else}
        {#each group.options as opt (opt.value)}
          <option value={opt.value} disabled={opt.disabled}>{opt.label}</option>
        {/each}
      {/if}
    {/each}
  </select>
  <Icon name="version" size={16} class="select-chevron" />
</span>

<style>
  .select-wrap {
    position: relative;
    display: inline-flex;
    align-items: center;
    /* D2 (Opus eyes-on assessment, 2026-09-24): every caller (LayersPanel's Study area/Spatial
       units/Color palette, ReportTool's zone picker) places this in a container that gives it a
       definite width -- a flex-column field or row -- but `inline-flex` on its own only ever
       shrink-wraps to content, so the visible box ended at the label text while the chevron
       (positioned against THIS element, below) floated wherever an ambient parent `stretch`
       happened to push it. Spanning the container explicitly removes that dependency; see
       `.select`'s own `width: 100%` below for the other half of the fix. */
    width: 100%;
  }

  .select {
    height: var(--size-touch);
    padding: 0 28px 0 var(--space-3);
    border: 1px solid var(--border-control);
    border-radius: var(--radius-control);
    background: var(--surface-sunken);
    color: var(--text-primary);
    font: inherit;
    font-size: var(--text-sm);
    appearance: none;
    cursor: pointer;
    /* D2: a horizontal flex child does not stretch along the MAIN axis on its own (`align-items:
       stretch` only affects the CROSS axis) -- without this the select's own border-box stayed
       content-sized even once `.select-wrap` above spanned the full field, which is exactly what
       let the chevron (absolutely positioned against the now-wide wrapper) drift away from the
       box it is meant to sit inside. */
    width: 100%;
    /* D2/P3 (Opus eyes-on assessment, 2026-09-24; moved here from `lens/scores/LayersPanel.svelte`'s
       own bespoke `.select` class R3-B2, round-3 plan: the Layer picker's grouped native `<select>`
       is now THIS component, not a second hand-rolled one): a closed `<select>`'s own rendered value
       text was CLIPPED mid-word with no ellipsis on every long option -- Chromium honours
       `text-overflow` on a closed select's value once it is forced single-line/non-overflowing like
       this. `title` (below) is the portable fallback for engines (WebKit) where the visual ellipsis
       does not reach a select's internal text layout at all -- the full text is never SILENTLY lost,
       only visually clipped where the platform allows nothing else. */
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .select:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }

  .select-wrap :global(.select-chevron) {
    position: absolute;
    right: var(--space-2);
    color: var(--icon-muted);
    pointer-events: none;
  }
</style>
