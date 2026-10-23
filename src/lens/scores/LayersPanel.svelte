<script lang="ts">
  // atlas-4 step 1 — the scores lens' DATA-row content. R3 (Ben's Layers-pane redesign,
  // 2026-09-25) shrank this down to what only the SCORES lens has: the color-palette ramp picker
  // and the "Cells outside Program Areas" overlay checkbox. Everything else that used to live here
  // (Study area, the Layer <select>, Sphere) moved to the shared `lib/ui/LayersPanel.svelte`'s own
  // panel-level fields/rows -- `ScoresLens.svelte` now builds those from the SAME pure boot readers
  // this file used to call directly (`studyAreasFromBoot`, `layerGroups`, `layerByKey`), so nothing
  // here duplicates them.
  //
  // The overlay control writes through a plain callback (never `selStore.set()`): ephemeral chrome
  // (parity doc §6.2 leaves it unchecked by default on every load, so there is nothing for a shared
  // link to reproduce). Fix round (orchestrator, 2026-09-25): "still a Switch -- make it a
  // checkbox row like the stack rows (same class, same accent)" -- a plain native checkbox, the
  // same visual rule `lib/ui/LayersPanel.svelte`'s own `.visible-check` uses (that exact scoped
  // class cannot be imported across components, so this is a byte-for-byte visual match, not a
  // shared stylesheet rule). Round 2 (Ben): the shared accent moved gold -> `--border-control`
  // ("a more muted non-yellow checkbox") -- see `.outside-pra-check` below for the current rule.
  import { tick } from "svelte";
  import Popover from "../../lib/ui/Popover.svelte";
  import Icon from "../../lib/ui/Icon.svelte";
  import { paletteStopsWithFallback, rampCss } from "../../lib/raster/ramps";
  import type { PaletteName } from "../../lib/raster/ramps";
  import { nextRovingIndex } from "../../lib/ui/roving";
  import type { Sel } from "../../lib/state/types";
  import type { SelStore } from "../../lib/state/sel.svelte";
  import type { ManifestOverlayRow } from "./raster";

  interface Props {
    sel: Sel;
    selStore: SelStore;
    boot: unknown;
    manifestOverlays: readonly ManifestOverlayRow[] | null;
    showOutsidePra: boolean;
    onShowOutsidePraChange: (v: boolean) => void;
    /** the release's own unit type (`fallback.ts`'s `effectiveUnit`) -- the outside-PRA switch is
     * only meaningful (and only shown) on the raster/cell branch. */
    unit: string;
  }

  let {
    sel,
    selStore,
    boot,
    manifestOverlays,
    showOutsidePra,
    onShowOutsidePraChange,
    unit,
  }: Props = $props();

  // R3 (Ben, 2026-09-25): "actual color ramps visualized for given options (see CalCOFI explore
  // for ideas)" -- a button showing the CURRENT palette's own gradient strip + name, opening a
  // Popover `role="listbox"` with one `role="option"` per palette (strip + name, `aria-selected`).
  const PALETTE_OPTIONS: { value: PaletteName; label: string }[] = [
    { value: "spectral_r", label: "Spectral" },
    { value: "viridis", label: "Viridis" },
    { value: "cividis", label: "Cividis" },
    { value: "magma", label: "Magma" },
  ];

  function paletteRampCss(name: PaletteName): string {
    const stops = paletteStopsWithFallback(boot as { palettes?: unknown } | null | undefined, name);
    return stops ? rampCss(stops) : "none";
  }

  function paletteLabel(name: string): string {
    return PALETTE_OPTIONS.find((o) => o.value === name)?.label ?? name;
  }

  let paletteOpen = $state(false);
  let focusIdx = $state(0);
  let optionEls: (HTMLButtonElement | undefined)[] = [];

  // Popover's `open` is `$bindable` (R3 fix, `ui/Popover.svelte`'s own header) -- watched here
  // rather than a prop callback so opening resets the roving-focus index to the CURRENT palette and
  // moves real DOM focus onto it (spec: "arrow keys + Enter/Esc").
  $effect(() => {
    if (!paletteOpen) return;
    focusIdx = Math.max(
      0,
      PALETTE_OPTIONS.findIndex((o) => o.value === sel.pal),
    );
    tick().then(() => optionEls[focusIdx]?.focus());
  });

  // the listbox's own arrow-key roving -- reuses the SAME pure `nextRovingIndex` (`ui/roving.ts`)
  // the tool rail already uses (vertical orientation: ArrowUp/ArrowDown, Home/End), rather than a
  // second hand-rolled index walk.
  function onListboxKeydown(event: KeyboardEvent) {
    const next = nextRovingIndex(focusIdx, PALETTE_OPTIONS.length, event.key, "vertical");
    if (next === null) return;
    event.preventDefault();
    focusIdx = next;
    optionEls[next]?.focus();
  }

  function selectPalette(value: string) {
    selStore.set({ pal: value as Sel["pal"] });
    paletteOpen = false; // Popover's own bindable `open` -- refocuses the trigger (see its header)
  }

  function onShowOutsidePraCheckbox(checked: boolean) {
    onShowOutsidePraChange(checked);
  }

  const hasOutsidePra = $derived(
    !!(manifestOverlays ?? []).find(
      (o) => o.overlay_key === "_outside_pra" && o.subregion_key === "FULL",
    ),
  );
</script>

<div class="layers-panel">
  <label class="field">
    <span class="field-label">Color palette</span>
    <Popover
      label={`Color palette: ${paletteLabel(sel.pal)}`}
      triggerClass="ramp-trigger"
      bind:open={paletteOpen}
      matchTriggerWidth
    >
      {#snippet trigger()}
        <span class="ramp-strip ramp-trigger-strip" style="background: {paletteRampCss(sel.pal)}"
        ></span>
        <span class="ramp-trigger-name">{paletteLabel(sel.pal)}</span>
        <Icon name="chevronDown" size={14} />
      {/snippet}
      <div
        class="ramp-listbox"
        role="listbox"
        aria-label="Color palette"
        tabindex="-1"
        onkeydown={onListboxKeydown}
      >
        {#each PALETTE_OPTIONS as opt, i (opt.value)}
          <button
            type="button"
            role="option"
            aria-selected={sel.pal === opt.value}
            tabindex={i === focusIdx ? 0 : -1}
            class="ramp-option"
            bind:this={optionEls[i]}
            onclick={() => selectPalette(opt.value)}
          >
            <span class="ramp-strip" style="background: {paletteRampCss(opt.value)}"></span>
            <span class="ramp-option-name">{opt.label}</span>
            {#if sel.pal === opt.value}<Icon name="check" size={14} />{/if}
          </button>
        {/each}
      </div>
    </Popover>
  </label>

  {#if unit === "cell" && hasOutsidePra}
    <label class="checkbox-row">
      <input
        type="checkbox"
        class="outside-pra-check"
        checked={showOutsidePra}
        onchange={(e) => onShowOutsidePraCheckbox(e.currentTarget.checked)}
      />
      <span>Cells outside Program Areas</span>
    </label>
  {/if}
</div>

<style>
  .layers-panel {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
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

  /* Fix round (orchestrator, 2026-09-25): "make it a checkbox row like the stack rows (same
     class, same accent)" -- same 20x20 native checkbox as `lib/ui/LayersPanel.svelte`'s own
     `.visible-check` (that scoped class cannot cross a component boundary, so this duplicates its
     exact rule rather than importing it). Round 2 (Ben, 2026-09-25): "use a more muted non-yellow
     checkbox" -- `accent-color` moved from `--fill-accent` (gold) to `--border-control` (the same
     "steel" token `.visible-check` also moved to), kept in lockstep with that rule again. */
  .checkbox-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--text-sm);
    cursor: pointer;
  }

  .outside-pra-check {
    width: 20px;
    height: 20px;
    min-width: 20px;
    accent-color: var(--border-control);
    cursor: pointer;
  }

  .outside-pra-check:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }

  :global(.ramp-trigger) {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
    height: var(--size-touch);
    padding: 0 var(--space-3);
    border: 1px solid var(--border-control);
    border-radius: var(--radius-control);
    background: var(--surface-sunken);
    color: var(--text-primary);
    font-size: var(--text-sm);
  }

  .ramp-trigger-name {
    flex: 1 1 auto;
    text-align: left;
  }

  .ramp-strip {
    display: inline-block;
    width: 40px;
    height: 10px;
    border-radius: var(--radius-pill);
    flex: none;
  }

  /* Fix round (orchestrator, 2026-09-25): "the gradient strip (~56x14) at the left" -- bigger than
     the listbox OPTIONS' own strip (kept at 40x10, unchanged: "options = strip + name as now"),
     since the trigger is now a full Select-shaped row with real room for a larger swatch. */
  .ramp-trigger-strip {
    width: 56px;
    height: 14px;
  }

  /* Fix round: the popover itself now matches the trigger's own full row width
     (Popover.svelte's `matchTriggerWidth`) instead of a fixed 220px, so the listbox fills it. */
  .ramp-listbox {
    display: flex;
    flex-direction: column;
    gap: 2px;
    width: 100%;
  }

  .ramp-option {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
    padding: var(--space-1) var(--space-2);
    border: 0;
    border-radius: var(--radius-control);
    background: none;
    color: var(--text-primary);
    font: inherit;
    font-size: var(--text-sm);
    text-align: left;
    cursor: pointer;
  }

  .ramp-option:hover,
  .ramp-option[aria-selected="true"] {
    background: var(--fill-control);
  }

  .ramp-option:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: -2px;
  }

  .ramp-option-name {
    flex: 1 1 auto;
  }
</style>
