<script lang="ts" module>
  /** "Sphere": the bottom row of the whole panel (every lens shares ONE projection, `Sel.proj`). */
  export interface LayersProjectionControl {
    checked: boolean;
    onChange: (checked: boolean) => void;
  }

  /** Fix round (Ben, 2026-09-25): "dim Selection if there is none to display, otherwise its
   * presence can cause confusion." A row that HAS a checkbox/opacity/reorder but nothing under it
   * on the map right now (today, only "Selection" / `data-places`) renders dimmed and carries a
   * small hint — same treatment as a disabled row, but the checkbox itself is untouched (an empty
   * row is not the same as a row the viewer turned off). The lens supplies this per group id
   * because only the lens knows what "empty" means for that group (`Sel.sel` for Selection); this
   * component only renders the signal, it never computes it. */
  export interface LayersRowState {
    empty: boolean;
    /** shown after the row name, e.g. "— nothing selected"; ignored unless `empty`. */
    hint?: string;
  }
</script>

<script lang="ts">
  // One Layers panel that IS the stack, the data row expanding into the lens's own controls, PLUS the
  // ability to change the stacking of the data layer relative to map layers (place names). Lens-
  // independent (the species and collection lenses mount this the same way): it owns the STACK rows
  // (name, visible checkbox, opacity popover, ▲▼ move) and hands the lens's own controls to the
  // `dataControls` snippet, unmodified.
  //
  // This component never touches MapLibre or `composeStyle` — it only reads/writes
  // `LayerStackEntry[]` (`../map/layerStack.ts`, the pure model `style.ts#composeStyle` consumes via
  // its `layerStack` input). `Shell.svelte` owns turning a change here into `selStore.set({layers})`
  // (URL-is-the-view, CLAUDE.md) — this component only calls `onChange`.
  //
  // Three basemap rows (Land & water, Boundaries, Roads & buildings) are hidden from the list (still
  // full model citizens -- `layerStack.ts#LAYER_GROUP_IN_PANEL`'s own header); "Sphere" sits at the
  // very bottom.
  import { tick, type Snippet } from "svelte";
  import Icon from "./Icon.svelte";
  import Popover from "./Popover.svelte";
  // P5 fix (post-merge finding, e2e/shell.a11y.spec.ts "exactly one live region"): `move()`/
  // `reset()` below used to hold their own local `announce` STATE and render a second, private
  // `<p aria-live>` -- a real SC 4.1.3 regression against this app's own rule (announcer.ts's own
  // header: "Exactly ONE <Announcer /> renders the actual region... every other component calls
  // `announce(text)` and renders no region of its own"). Routed through the shared function
  // instead, so the whole shell keeps exactly one `role="status"` region, same as every other
  // component's own non-visual confirmation (ScoresLens.svelte's popup echo, SpeciesPicker's
  // result-count announcement).
  import { announce } from "./announcer";
  import {
    LAYER_GROUP_ENABLED,
    LAYER_GROUP_IN_PANEL,
    LAYER_GROUP_LABEL,
    canMoveLayerStackEntryVisible,
    defaultLayerStackEntries,
    isDefaultLayerStack,
    moveLayerStackEntryVisible,
    type LayerGroupId,
    type LayerStackEntry,
  } from "../map/layerStack";

  interface Props {
    stack: readonly LayerStackEntry[];
    onChange: (next: readonly LayerStackEntry[]) => void;
    /** the lens's own controls (today's scores `LayersPanel.svelte` content / species'
     * title+layer-bar+card), rendered inside the "Data" row once it is expanded. Optional so a
     * lens that has not resolved yet (boot still loading) can omit it and the row just shows
     * nothing below its header — never a placeholder that looks like a bug. */
    dataControls?: Snippet;
    /** the lens' own main data selection, promoted above the stack (the species lens' "Model input"
     * picker; the collection lens' collection and dimension selectors). A snippet, because each is
     * a whole component the lens already owns. */
    speciesField?: Snippet;
    /** R3 deliverable 7 — see {@link LayersProjectionControl}. */
    projection?: LayersProjectionControl;
    /** Fix round — see {@link LayersRowState}. Omitted groups render normally (never dimmed);
     * a lens that has nothing empty-able to report (there is none today besides Selection) simply
     * does not pass this prop at all. */
    rowState?: Partial<Record<LayerGroupId, LayersRowState>>;
    /** R3-W8 item 3: controlled row-expansion, so Shell.svelte can restore the "Data"/"Outlines"
     * expander from a shared `ui=` link and read it back to build one. `undefined` (every existing
     * caller/test) keeps this component's own internal state — only Shell wires this pair, and
     * only one `LayersPanel` is ever mounted at a time (see `DATA_ROW_BODY_ID`'s own header), so a
     * single Shell-level value is enough regardless of which lens is active. */
    expandedRow?: LayerGroupId | null;
    onExpandedRowChange?: (id: LayerGroupId | null) => void;
    /** WP4: the list of gazetteer collections shown under the "Place layers" row (toggles, swatches,
     * credits). A snippet, so this lib component never imports `src/places/`; omitted = the row is
     * just its visible/opacity/reorder controls. */
    placeLayers?: Snippet;
  }

  let {
    stack,
    onChange,
    dataControls,
    speciesField,
    projection,
    rowState,
    expandedRow,
    onExpandedRowChange,
    placeLayers,
  }: Props = $props();

  /** the one row this panel EXPANDS -- "Data" (the lens's own layer). Every other group is
   * visible/opacity/reorder only. */
  const DATA_ROW_ID: LayerGroupId = "data-raster";
  const EXPANDABLE_ROW_IDS: readonly LayerGroupId[] = [DATA_ROW_ID];

  /** m6 (review round 1): `aria-controls` target for an expander button — only one `LayersPanel`
   * is ever mounted at a time (the active lens owns the rail), so static ids are safe. */
  const DATA_ROW_BODY_ID = "layers-data-row-body";

  // "the stack in draw order (top of the list = top of the map)" (Deliverable 3) -- the MODEL's own
  // array is bottom-to-top (style.ts#LAYER_ORDER's convention: index 0 paints first, i.e. lowest),
  // so the panel reverses it for DISPLAY only. R3: filtered to `LAYER_GROUP_IN_PANEL` -- the three
  // dropped basemap rows stay in `stack` (so reorder/opacity on them, if a `layers=` link set any,
  // is never lost), they simply have no row here to change them from. Fix round (Opus 5.5 review,
  // D2): the move buttons now call `moveLayerStackEntryVisible`/`canMoveLayerStackEntryVisible` by
  // `entry.id` (they re-derive the underlying array index themselves, hopping hidden rows) --
  // this derivation no longer needs to hand out each row's raw `arrIndex` alongside it.
  const rows = $derived(
    stack
      .filter((entry) => LAYER_GROUP_IN_PANEL[entry.id])
      .slice()
      .reverse(),
  );

  let internalExpandedId = $state<LayerGroupId | null>(DATA_ROW_ID);
  // R3-W8 item 3: `expandedRow === undefined` (no caller controlling it) falls back to this
  // component's own internal state, exactly as before this prop pair existed.
  const expandedId = $derived(expandedRow !== undefined ? expandedRow : internalExpandedId);

  function toggleExpanded(id: LayerGroupId) {
    const next = expandedId === id ? null : id;
    if (onExpandedRowChange) onExpandedRowChange(next);
    else internalExpandedId = next;
  }

  function setVisible(id: LayerGroupId, visible: boolean) {
    onChange(stack.map((e) => (e.id === id ? { ...e, visible } : e)));
  }

  function setOpacity(id: LayerGroupId, opacity: number) {
    onChange(stack.map((e) => (e.id === id ? { ...e, opacity } : e)));
  }

  // m4 (review round 1): a move that lands its row at the very top/bottom of the stack disables
  // the button just clicked (it reached the end it moves toward) -- a keyboard/screen-reader user
  // who just pressed it then has a DISABLED element under focus, which browsers cannot keep
  // focused, so focus silently reverts to `<body>` and the next Tab press restarts from the top of
  // the page instead of continuing from this row. `panelEl` + a stable `data-move-id`/
  // `data-move-dir` pair on each button (not a `bind:this` array -- rows are reordered, not
  // recreated, but keeping a ref array in sync with THAT is more moving parts than one DOM query)
  // let the handler refocus something real in the SAME row after Svelte re-renders it.
  let panelEl = $state<HTMLDivElement | undefined>();

  function refocusRow(id: LayerGroupId, preferredDir: "up" | "down") {
    if (!panelEl) return;
    const preferred = panelEl.querySelector<HTMLButtonElement>(
      `[data-move-id="${id}"][data-move-dir="${preferredDir}"]`,
    );
    if (preferred && !preferred.disabled) return preferred.focus();
    const otherDir = preferredDir === "up" ? "down" : "up";
    const other = panelEl.querySelector<HTMLButtonElement>(
      `[data-move-id="${id}"][data-move-dir="${otherDir}"]`,
    );
    if (other && !other.disabled) return other.focus();
    // both move buttons are disabled (a one-entry stack, never true today, but not this
    // function's assumption to make) -- the row's own checkbox is always focusable, scoped by the
    // row's own data-row-id.
    panelEl
      .querySelector<HTMLButtonElement>(`[data-row-id="${id}"] input, [data-row-id="${id}"] button`)
      ?.focus();
  }

  /** ▲ (toward the top of the LIST) moves toward the END of the model array (toward the top of the
   * MAP); ▼ is the reverse. Fix round (Opus 5.5 review, D2): moves over the VISIBLE (in-panel)
   * rows only now -- see `layerStack.ts#moveLayerStackEntryVisible`'s own header for why a plain
   * one-step array move could silently swap with a hidden basemap row. `label` is only for the
   * `aria-live` announcement's wording; the announced position is the row's position among the
   * PANEL's own visible rows (what the viewer sees), not the full model array. */
  function move(id: LayerGroupId, label: string, dir: "up" | "down") {
    const next = moveLayerStackEntryVisible(stack, id, dir, LAYER_GROUP_IN_PANEL);
    onChange(next);
    const visible = next.filter((e) => LAYER_GROUP_IN_PANEL[e.id]);
    const newVisibleIndex = visible.findIndex((e) => e.id === id);
    const displayPosition = visible.length - newVisibleIndex; // 1 = top of the list
    announce(`${label} moved to position ${displayPosition} of ${visible.length}`);
    tick().then(() => refocusRow(id, dir));
  }

  function reset() {
    onChange(defaultLayerStackEntries());
    announce("Layers reset to the default stack");
  }
</script>

<div class="layers-stack" bind:this={panelEl}>
  {#if speciesField}
    <!-- R3-W8 item 1: the species lens' promoted "Model input" picker — same panel position as
         `layerField` above (scores' own equivalent), never both at once. -->
    <div class="species-field-row" data-testid="species-field-row">
      {@render speciesField()}
    </div>
  {/if}

  <!-- fix list #10 (SC 1.3.1, e2e/keyboard-walk.spec.ts): a plain `div` (never a landmark) so this
       never becomes a SECOND `region` nested inside Panel.svelte's own "Layers" region — the same
       fix the pre-R3 non-interactive bullet list carried, kept here now that this IS "what's on the
       map" (interactive, not a summary of it). -->
  <div class="layers-control">
    <h3>Layers on the map</h3>
  </div>
  <ul class="stack-list">
    {#each rows as entry (entry.id)}
      {@const enabled = LAYER_GROUP_ENABLED[entry.id]}
      {@const label = LAYER_GROUP_LABEL[entry.id]}
      {@const isExpandable = EXPANDABLE_ROW_IDS.includes(entry.id)}
      {@const bodyId = DATA_ROW_BODY_ID}
      {@const rState = rowState?.[entry.id]}
      {@const rowEmpty = rState?.empty ?? false}
      {@const hintId = `${entry.id}-empty-hint`}
      <li
        class="stack-row"
        class:stack-row--disabled={!enabled}
        class:stack-row--dim={rowEmpty}
        data-row-id={entry.id}
      >
        <div class="row-head">
          <input
            type="checkbox"
            class="visible-check"
            checked={entry.visible}
            disabled={!enabled}
            aria-label={`${label} visible on the map`}
            aria-describedby={rowEmpty ? hintId : undefined}
            onchange={(e) => setVisible(entry.id, e.currentTarget.checked)}
          />

          {#if isExpandable}
            <button
              type="button"
              class="row-name row-name--button"
              aria-expanded={expandedId === entry.id}
              aria-controls={bodyId}
              onclick={() => toggleExpanded(entry.id)}
            >
              <!-- fix round (Ben): the expander glyph must not read as the same family as the
                   ▲▼ reorder buttons at the row's other end -- a sideways caret that rotates open,
                   never a chevronUp/chevronDown swap (see Accordion.svelte's identical
                   rotate-one-icon convention, which this now matches instead of duplicating). -->
              <Icon
                name="chevronRight"
                size={16}
                class={`row-caret ${expandedId === entry.id ? "row-caret--open" : ""}`}
              />
              {label}
            </button>
          {:else}
            <span class="row-name">
              {label}
              {#if !enabled}<span class="hint">— coming soon</span>{/if}
            </span>
          {/if}

          {#if rowEmpty && rState?.hint}
            <span class="hint" id={hintId}>{rState.hint}</span>
          {/if}

          <Popover label={`${label} opacity`} triggerClass="opacity-btn" align="right">
            {#snippet trigger()}
              <Icon name="opacity" size={13} />
              <span class="opacity-pct">{Math.round(entry.opacity * 100)}%</span>
            {/snippet}
            <div class="opacity-popover-body">
              <label class="opacity-range-label">
                <span>{label} opacity</span>
                <input
                  type="range"
                  min="0.1"
                  max="1"
                  step="0.05"
                  value={entry.opacity}
                  disabled={!enabled}
                  aria-valuetext={`${Math.round(entry.opacity * 100)}%`}
                  oninput={(e) => setOpacity(entry.id, Number(e.currentTarget.value))}
                />
              </label>
              <p class="opacity-value">{Math.round(entry.opacity * 100)}%</p>
            </div>
          </Popover>

          <span class="move-buttons">
            <button
              type="button"
              class="move-btn"
              aria-label={`Move ${label} up (toward the top of the map)`}
              data-tooltip="Move up (draw above)"
              disabled={!enabled ||
                !canMoveLayerStackEntryVisible(stack, entry.id, "up", LAYER_GROUP_IN_PANEL)}
              data-move-id={entry.id}
              data-move-dir="up"
              onclick={() => move(entry.id, label, "up")}
            >
              <Icon name="arrowUp" size={14} />
            </button>
            <button
              type="button"
              class="move-btn"
              aria-label={`Move ${label} down (toward the bottom of the map)`}
              data-tooltip="Move down (draw below)"
              disabled={!enabled ||
                !canMoveLayerStackEntryVisible(stack, entry.id, "down", LAYER_GROUP_IN_PANEL)}
              data-move-id={entry.id}
              data-move-dir="down"
              onclick={() => move(entry.id, label, "down")}
            >
              <Icon name="arrowDown" size={14} />
            </button>
          </span>
        </div>

        {#if entry.id === "data-overlays" && placeLayers}
          <div class="row-body" data-testid="place-layers-body">
            {@render placeLayers()}
          </div>
        {/if}

        {#if entry.id === DATA_ROW_ID && expandedId === DATA_ROW_ID && dataControls}
          <div class="row-body" id={DATA_ROW_BODY_ID}>
            {@render dataControls()}
          </div>
        {/if}
      </li>
    {/each}
  </ul>

  {#if projection}
    <!-- R3 deliverable 7: Sphere moved to the bottom of the panel (both lenses share ONE
         projection) -- a plain checkbox row, same shape as every stack row's own visible check. -->
    <div class="sphere-row">
      <label class="sphere-check">
        <input
          type="checkbox"
          checked={projection.checked}
          onchange={(e) => projection?.onChange(e.currentTarget.checked)}
        />
        <span>Sphere (globe projection)</span>
      </label>
    </div>
  {/if}

  <div class="stack-footer">
    <button type="button" class="reset-btn" disabled={isDefaultLayerStack(stack)} onclick={reset}>
      Reset layers
    </button>
  </div>
</div>

<style>
  /* fix round (Opus 5.5 eyes-on review): "Reset layers" clipped at the docked-panel default
     (1280x800) -- read, not guessed: `.panel-body`'s own `overflow: auto` + bottom padding were
     both already correct; the panel's CONTENT (this whole stack, 7 sections deep with the Data
     row expanded) was measured ~26px taller than the available area, so the initial (unscrolled)
     view clipped the last ~1.5px of the footer button's own bottom border before ever reaching
     that padding -- adding padding AFTER the button cannot pull the button itself back into view,
     only reducing the space ABOVE it can. `var(--space-3)` (12px) -> `var(--space-2)` (8px)
     across the stack's own 6 section gaps recovers 24px, closing nearly all of it; combined with
     `.stack-footer`'s own added bottom padding (its comfortable-clearance half of the same fix,
     for whenever a taller manifest/description genuinely does need a small scroll), the button
     renders fully at this viewport again. */
  .layers-stack {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  /* the lens' own main data selection row — a vertical stack (label, pills, representation, the
     zoom-to-layer checkbox; or the collection and dimension selectors), bottom-bordered, at the top
     of the pane. */
  .species-field-row {
    padding-bottom: var(--space-2);
    border-bottom: 1px solid var(--divider);
  }

  .layers-control h3 {
    font-size: var(--text-sm);
    margin: 0 0 var(--space-1);
  }

  .stack-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .stack-row {
    border: 1px solid var(--border-control);
    border-radius: var(--radius-control);
    background: var(--surface-sunken);
  }

  .stack-row--disabled {
    opacity: 0.5;
  }

  /* fix round (Ben): "dim Selection if there is none to display" -- same visual treatment as
     `.stack-row--disabled` (a row the model has switched off entirely), but a DIFFERENT state: the
     checkbox stays enabled/checked, only the map has nothing to show for it right now. Two class
     names, one rule, kept separate on purpose so neither reads as "the other one" in the DOM. */
  .stack-row--dim {
    opacity: 0.5;
  }

  .row-head {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-1) var(--space-2);
    min-height: 36px;
  }

  .row-name {
    flex: 1 1 auto;
    display: flex;
    align-items: center;
    gap: var(--space-1);
    font-size: var(--text-sm);
    color: var(--text-primary);
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .row-name--button {
    background: none;
    border: 0;
    padding: 0;
    min-height: var(--size-touch);
    cursor: pointer;
    color: inherit;
    font: inherit;
    font-weight: 600;
  }

  .row-name--button:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }

  /* fix round (Ben): the expander glyph rotates in place (Accordion.svelte's own convention --
     one icon, CSS rotation, never an icon SWAP) -- pointing right (closed) to pointing down
     (open), which reads as "this opens a panel", distinct from the move buttons' up/down ARROWS. */
  .row-head :global(.row-caret) {
    color: var(--icon-muted);
    transition: transform var(--motion-fast) var(--ease-out);
  }

  .row-head :global(.row-caret--open) {
    transform: rotate(90deg);
  }

  .hint {
    color: var(--text-secondary);
    font-weight: 400;
    font-size: var(--text-xs);
  }

  /* R3: a native checkbox replaces the Switch (Ben, 2026-09-25: "checkbox instead of toggle") --
     the app's own tokens, not the browser default appearance, but otherwise a plain checkbox.
     Fix round (Ben, 2026-09-25): "use a more muted non-yellow checkbox, preferably situated left
     of the label" -- `--fill-accent` (gold) was a WHOLE-TRACK-style emphasis wrong for a stack of
     5+ simultaneous checkboxes (every visible row reads "selected/important" at once); moved to
     the app's neutral "steel" control family (`--border-control`, the SAME token this row's own
     border already uses) and moved first in DOM order so it reads checkbox-then-name, matching
     every other checkbox list in the app. The markup order changed (see the `{#each}` block above)
     -- this rule itself did not need to, `.row-head`'s flex order follows DOM order. */
  .visible-check {
    width: 20px;
    height: 20px;
    min-width: 20px;
    accent-color: var(--border-control);
    cursor: pointer;
  }

  .visible-check:disabled {
    cursor: default;
    opacity: 0.5;
  }

  .visible-check:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }

  /* R3: the opacity slider moved off the row into this small trigger button (Popover's own
     `triggerClass`) -- a droplet icon + the current percent, ONE horizontal line, content-sized.
     Fix round (orchestrator, 2026-09-25, desktop-04/phone-04): paired with Popover.svelte's own
     `.popover-trigger--custom` fix (the base trigger's `inline-grid; place-items: center` was
     stacking the icon and the percent text on top of each other, not beside), this button also
     needed `flex: none` on its own two children so neither the icon nor the percent text ever
     shrinks/clips inside the row, and a touch-target floor on coarse pointers (phone) below. */
  :global(.opacity-btn) {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 28px;
    padding: 0 var(--space-2);
    border: 1px solid var(--border-control);
    border-radius: var(--radius-control);
    background: var(--surface-raised);
    color: var(--text-secondary);
    font-size: var(--text-xs);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  :global(.opacity-btn .icon) {
    flex: none;
  }

  @media (pointer: coarse) {
    :global(.opacity-btn) {
      height: var(--size-touch);
    }
  }

  .opacity-pct {
    flex: none;
    min-width: 2.4em;
    text-align: right;
  }

  .opacity-popover-body {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    width: 160px;
  }

  .opacity-range-label {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    font-size: var(--text-xs);
  }

  .opacity-range-label input[type="range"] {
    width: 100%;
    accent-color: var(--fill-accent); /* orchestrator hand-off: no browser-default blue on paper */
  }

  .opacity-value {
    margin: 0;
    text-align: right;
    font-size: var(--text-xs);
    color: var(--text-secondary);
    font-variant-numeric: tabular-nums;
  }

  /* fix round (Ben): "some extra visual differentiation" from the expander -- besides the glyph
     swap above (caret vs arrows), the two reorder buttons now sit in one small BORDERED segment
     (like a mini Segmented control) at the row's far right, instead of two bare icon buttons that
     could read as part of the same control family as the expander's own bare icon+label button. */
  .move-buttons {
    display: inline-flex;
    border: 1px solid var(--border-control);
    border-radius: var(--radius-control);
    overflow: hidden;
  }

  /* R3 (Ben, 2026-09-25): "the ▲▼ move buttons stay but at 32px and quiet" -- smaller than the
     44px touch-target minimum other controls hold to; a deliberate compactness trade the brief
     calls for on a row this dense (checkbox + opacity + two move buttons all on one line). */
  .move-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border: 0;
    background: none;
    color: var(--text-secondary);
    cursor: pointer;
    position: relative;
  }

  /* the one internal divider between the two segments (not a border on each button, which would
     double up at the shared edge). */
  .move-btn + .move-btn {
    border-left: 1px solid var(--border-control);
  }

  .move-btn:disabled {
    color: var(--text-secondary);
    opacity: 0.35;
    cursor: default;
  }

  .move-btn:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: -2px;
  }

  /* UI-11 (round 3): the CSS-only `[data-tooltip]` hover/focus tooltip is now ONE global utility
     (`src/lib/ui/tooltip.css`, imported once at the app root) -- this was a second, `.move-btn`-
     scoped copy of the identical rule `shell.css`'s own `.tool[data-tooltip]` also carried. */

  .row-body {
    padding: 0 var(--space-2) var(--space-2);
    border-top: 1px solid var(--border-control);
    padding-top: var(--space-2);
  }

  /* fix round (D7): now a real checkbox toggle among others in this pane (not a single-choice
     radio pair any more) -- moved to the SAME muted token every other stack checkbox uses. */

  /* the "Ecoregions" row: permanently checked+disabled (it cannot be turned off from here) --
     dimmed as a whole so it reads as "always on," not as a broken/unclickable live control. */

  .sphere-row {
    padding-top: var(--space-1);
    border-top: 1px solid var(--divider);
  }

  .sphere-check {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--text-sm);
    cursor: pointer;
  }

  .sphere-check input {
    width: 20px;
    height: 20px;
    accent-color: var(--border-control); /* fix round: same muted token as .visible-check above */
    cursor: pointer;
  }

  /* fix round (Opus 5.5 eyes-on review): "Reset layers" clipped -- measured at the docked-panel
     default (1280x800), the button's own bottom edge sat ~1.5px PAST `.panel-body`'s own
     scrollable bottom edge (Panel.svelte's `padding-bottom: var(--space-4)`, apparently consumed
     by ordinary flex-gap rounding across this panel's several sections) -- enough for the
     button's own border/corner to visibly clip in a screenshot, with no scrollbar obviously
     showing the true (barely) overflowed state. A dedicated bottom padding HERE, on top of the
     panel's own, is deliberate slack against exactly that kind of small cross-browser rounding
     drift -- never rely on a scroll container's padding landing at a sub-pixel-exact multiple of
     its content's own height. */
  .stack-footer {
    display: flex;
    justify-content: flex-end;
    padding-bottom: var(--space-2);
  }

  .reset-btn {
    min-height: var(--size-touch);
    padding: 0 var(--space-3);
    border: 1px solid var(--border-control);
    border-radius: var(--radius-control);
    background: var(--surface-sunken);
    color: var(--text-primary);
    font: inherit;
    font-size: var(--text-sm);
    cursor: pointer;
  }

  .reset-btn:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .reset-btn:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }
</style>
