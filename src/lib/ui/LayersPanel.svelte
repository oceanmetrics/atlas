<script lang="ts" module>
  import type { SegmentedOption } from "./Segmented.svelte";
  import type { SelectOptionGroup } from "./Select.svelte";
  import type { Outline } from "../state/types";

  /** P round deliverable 1 (Ben, live-review 2026-09-24): "emphasize Raster Cells vs Program Areas
   * as a toggle similar to Scores vs Species at top, but this only applies to Scores (so grayed out
   * for Species)" — the spatial-unit choice (cell raster vs zone fill), promoted from a `<Select>`
   * buried inside the Data row's own body (`lens/scores/LayersPanel.svelte`'s old "Spatial units"
   * field, now removed — this toggle replaces it, not a second control setting the same thing) to
   * ONE segmented control at the very top of this shared panel, styled like the top bar's own
   * Scores|Species `Segmented`.
   *
   * R3 (Ben, live-review 2026-09-25): "prettify this pill so [it] doesn't look like [a] 3rd missing
   * option on right that is not colored when 'Program areas' is selected" -- rendered with
   * `Segmented`'s new `fit` prop (content-sized, left-aligned) instead of the P-round's row-stretch
   * layout, the same shape the top bar's own Scores|Species switch already uses.
   *
   * Orchestrator hand-off (Opus UI review of main, 2026-09-25): "in the Species lens HIDE the
   * toggle instead of showing it disabled with a reason" -- species has no spatial-unit CHOICE to
   * make at all (unlike scores' zone choropleth), so `SpeciesLens.svelte` now omits this prop
   * entirely (this whole panel section is `{#if unitToggle}`) rather than passing a disabled one.
   * The disabled/reason path this type used to carry for that case is gone with it -- `onChange`
   * is required now, matching the one real caller left (scores, always enabled). */
  export interface LayersUnitToggle {
    /** `lens/scores/boot.ts#unitOptions(boot)` — "Raster cells" always first (R3: the "(0.05°)"
     * resolution note was dropped, Ben 2026-09-25), then the release's one drawable unit (e.g.
     * "Program areas") when it publishes one. */
    options: SegmentedOption[];
    value: string;
    onChange: (value: string) => void;
  }

  /** R3 deliverable 3: the Layer (metric) picker, promoted from inside the Data row's own body
   * (`lens/scores/LayersPanel.svelte`'s old bespoke native `<select>`) to panel-level, directly
   * below the unit toggle — full width (W6, 2026-09-25: the field it used to sit beside, "Zoom to
   * region", moved into the Search bar's Regions group — `search.ts#matchRegions`/`selectRegion`
   * — since the search field was already "a zoom to this place"). `groups` is `Select.svelte`'s new
   * `<optgroup>` support (R3-B2) — this component no longer hand-rolls its own grouped `<select>`.
   * Species has no metric-layer choice of its own (it
   * picks a SPECIES, a different mechanism entirely, via its own `LayerBarView` inside
   * `dataControls`) — `SpeciesLens.svelte` omits this prop and that row simply does not render. */
  export interface LayersLayerField {
    label: string;
    value: string;
    groups: SelectOptionGroup[];
    onChange: (value: string) => void;
    /** the current layer's own one-line description — rendered under the field,
     * `data-testid="layer-description"`, unchanged from where it lived before this move. */
    description?: string | null;
  }

  /** R3 deliverable 6, reshaped by the fix round (Opus 5.5 review, D7): the "Outlines" row's
   * expander body — bound to `Sel.out`, but no longer a two-option RADIO. Read from
   * `Shell.svelte`/`boot.ts` (not guessed): `Sel.out` gates exactly ONE real outline (the
   * Program-Area selectable unit's own line, `zoneUnitsWithOutline()`); the ecoregion boundary is
   * a separate, always-on decoration `boot.ts#ecoregionZoneUnitFromManifest` appends independent
   * of `sel.out`/`sel.unit` — `boot.units[]` never publishes ecoregion as a selectable unit at all
   * (D17). So there is one real ON/OFF toggle here, not a choice between two outlines; the panel
   * now renders two independent checkboxes (Program Areas, live; Ecoregions, permanently
   * checked+disabled, an honest "this is always on" rather than a dead radio option). `onChange`
   * takes the WIDER `Outline` type (not just `"programarea" | "ecoregion"`) because unchecking
   * Program Areas now writes `"none"` directly, the same value the row's own visible checkbox
   * above already reaches by hiding the whole `data-zones` group. */
  export interface LayersOutlineChoice {
    value: Outline;
    onChange: (value: Outline) => void;
  }

  /** R3 deliverable 7: "Sphere" moved out of the Data row's body to the bottom of the whole panel
   * (both lenses share ONE projection, `Sel.proj` — this is not scores-specific). */
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

  /** the Data row's camera controls (WP14). */
  export interface ZoomToLayerControl {
    /** the layer has no extent to fit (nothing drawn): the button is disabled. */
    disabled: boolean;
    onZoom: () => void;
    /** "Auto-zoom to layer" is on. */
    auto: boolean;
    onAutoChange: (on: boolean) => void;
  }
</script>

<script lang="ts">
  // R3 (round-2 plan §5 U4, `docs/usability.md` §7 R3, Ben's decision 2026-09-24): "one Layers panel
  // that IS the stack, the data row expanding into today's controls — PLUS the ability to change
  // the stacking of data layers (Program Areas, the score raster) relative to map layers (place
  // names, bathymetry)." Lens-independent (both `ScoresLens.svelte` and `SpeciesLens.svelte` mount
  // this the same way, per this task's own Deliverable 3): it owns the STACK rows (name, visible
  // checkbox, opacity popover, ▲▼ move) and hands the lens's own controls to the `dataControls`
  // snippet, unmodified.
  //
  // This component never touches MapLibre or `composeStyle` — it only reads/writes
  // `LayerStackEntry[]` (`../map/layerStack.ts`, the pure model `style.ts#composeStyle` consumes via
  // its `layerStack` input). `Shell.svelte` owns turning a change here into `selStore.set({layers})`
  // (URL-is-the-view, CLAUDE.md) — this component only calls `onChange`.
  //
  // R3 (Ben, live-review 2026-09-25) reshaped this panel top to bottom: the unit toggle stays at
  // top (now `fit`-sized); the Layer + Zoom-to-region fields moved here from inside the Data row's
  // body; every stack row's `Switch` became a plain checkbox; the inline opacity slider moved into
  // a per-row popover; three basemap rows (Land & water, Boundaries, Roads & buildings) are hidden
  // from the list (still full model citizens -- `layerStack.ts#LAYER_GROUP_IN_PANEL`'s own header);
  // "Outlines" gained an expander for the `Sel.out` choice; "Sphere" moved to the very bottom.
  import { tick, type Snippet } from "svelte";
  import Icon from "./Icon.svelte";
  import Segmented from "./Segmented.svelte";
  import Select from "./Select.svelte";
  import Popover from "./Popover.svelte";
  import Switch from "./Switch.svelte";
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
    /** the panel's own primary control (see {@link LayersUnitToggle}'s header) — optional so a lens
     * that has not resolved `boot` yet renders the rest of the panel with no toggle at all, never a
     * disabled-looking placeholder for data that just has not arrived. */
    unitToggle?: LayersUnitToggle;
    /** R3 deliverable 3 — see {@link LayersLayerField}. Omitted by the species lens (no metric
     * layer choice there). */
    layerField?: LayersLayerField;
    /** R3-W8 item 1 (Ben, 2026-09-25: "promote the main data selection up"): the species lens' own
     * equivalent of `layerField` — its "Model input" picker (the layer-bar pills + representation
     * toggle, `LayerBarView.svelte`), moved out of the Data row's body to this same panel-level
     * slot. A snippet, not a typed field-value shape like `layerField`, because the species picker
     * is not a single `<select>` — it is a whole existing component the species lens already owns.
     * Mutually exclusive with `layerField` in practice (never both true at once — scores passes
     * one, species the other) but each renders independently so neither lens has to know the other
     * exists. */
    speciesField?: Snippet;
    /** R3 deliverable 6 — see {@link LayersOutlineChoice}. Omitted while a lens has not resolved
     * `sel`/`boot` yet; the "Outlines" row then still expands but shows no radio body,
     * matching `dataControls`' own "nothing to render yet" convention. */
    outline?: LayersOutlineChoice;
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
    /** WP14: "Zoom to layer" and "Auto-zoom to layer" for the Data row (the lens owns the camera and the
     * saved choice). Omitted = the row has neither. */
    zoom?: ZoomToLayerControl;
  }

  let {
    stack,
    onChange,
    dataControls,
    unitToggle,
    layerField,
    speciesField,
    outline,
    projection,
    rowState,
    expandedRow,
    onExpandedRowChange,
    placeLayers,
    zoom,
  }: Props = $props();

  function onUnitToggleChange(value: string) {
    // `unitToggle` itself is optional (a lens that has not resolved `boot` yet, or -- species --
    // has no toggle at all now the disabled path is gone); the `?.` guards ONLY that, never a
    // missing `onChange` (required on the type now there is exactly one real caller).
    unitToggle?.onChange(value);
  }

  /** the two rows this panel EXPANDS — "Data" (the lens's own layer) and "Outlines" (the
   * outline choice, R3 deliverable 6). Every other group is visible/opacity/reorder only. */
  const DATA_ROW_ID: LayerGroupId = "data-raster";
  const ZONES_ROW_ID: LayerGroupId = "data-zones";
  const EXPANDABLE_ROW_IDS: readonly LayerGroupId[] = [DATA_ROW_ID, ZONES_ROW_ID];

  /** m6 (review round 1): `aria-controls` target for an expander button — only one `LayersPanel`
   * is ever mounted at a time (the active lens owns the rail), so static ids are safe. */
  const DATA_ROW_BODY_ID = "layers-data-row-body";
  const ZONES_ROW_BODY_ID = "layers-zones-row-body";

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
  {#if unitToggle}
    <!-- P round deliverable 1: the panel's own primary control, ABOVE the stack list -- styled
         like the top bar's Scores|Species `Segmented` (same component, reused, not re-styled).
         R3: `fit` (content-sized, left-aligned) instead of the P-round row-stretch. -->
    <div class="unit-toggle" data-control="layers-unit-toggle">
      <Segmented
        options={unitToggle.options}
        value={unitToggle.value}
        ariaLabel="Spatial units"
        onchange={onUnitToggleChange}
        fit
      />
    </div>
  {/if}

  {#if layerField}
    <div class="fields-row">
      <label class="field field-layer">
        <span class="field-label">{layerField.label}</span>
        <Select
          label={layerField.label}
          value={layerField.value}
          groups={layerField.groups}
          onchange={layerField.onChange}
        />
      </label>
    </div>
    {#if layerField?.description}
      <p class="note" data-testid="layer-description">{layerField.description}</p>
    {/if}
  {/if}

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
      {@const bodyId = entry.id === DATA_ROW_ID ? DATA_ROW_BODY_ID : ZONES_ROW_BODY_ID}
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

          {#if zoom && entry.id === DATA_ROW_ID}
            <button
              type="button"
              class="zoom-btn"
              aria-label="Zoom to layer"
              data-tooltip="Zoom to layer"
              data-testid="zoom-to-layer"
              disabled={zoom.disabled}
              onclick={zoom.onZoom}
            >
              <Icon name="zoomToLayer" size={16} />
            </button>
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

        {#if zoom && entry.id === DATA_ROW_ID}
          <div class="auto-zoom-row" data-testid="auto-zoom-row">
            <Switch
              label="Auto-zoom to layer"
              variant="quiet"
              checked={zoom.auto}
              onchange={zoom.onAutoChange}
            />
            <span>Auto-zoom to layer</span>
          </div>
        {/if}

        {#if entry.id === "data-overlays" && placeLayers}
          <div class="row-body" data-testid="place-layers-body">
            {@render placeLayers()}
          </div>
        {/if}

        {#if entry.id === DATA_ROW_ID && expandedId === DATA_ROW_ID && dataControls}
          <div class="row-body" id={DATA_ROW_BODY_ID}>
            {@render dataControls()}
          </div>
        {:else if entry.id === ZONES_ROW_ID && expandedId === ZONES_ROW_ID && outline}
          <!-- Fix round (Opus 5.5 eyes-on review, D7): this used to be a RADIO group, which claims
               a real exclusive choice between two outlines -- it was not. Read (not guessed) from
               `Shell.svelte`/`boot.ts`: `Sel.out` only ever gates ONE selectable unit's outline
               (`zoneUnitsWithOutline()`; `boot.units[]` NEVER publishes an "ecoregion" selectable
               unit, D17 -- see `boot.ts#ecoregionZoneUnitFromManifest`'s own header), and the
               ecoregion boundary is a SEPARATE, always-on decoration appended after that, entirely
               independent of `sel.out`/`sel.unit` (`Shell.svelte`'s own "R3 orchestrator audit item
               2" comment). So there is exactly ONE real toggle here (Program Areas' own outline,
               on/off) and one fact with nothing to switch (Ecoregions is always drawn) -- two
               independent checkboxes say that honestly; a radio group does not. "none" is still
               reached the same way as before (the row's own visible checkbox above). -->
          <div class="row-body" id={ZONES_ROW_BODY_ID}>
            <div class="outline-choice" role="group" aria-label="Outlines">
              <label class="outline-option">
                <input
                  type="checkbox"
                  checked={outline.value === "programarea"}
                  disabled={!entry.visible}
                  onchange={(e) =>
                    outline?.onChange(e.currentTarget.checked ? "programarea" : "none")}
                />
                <span class="outline-option-text">
                  <span class="outline-option-label">Program Areas</span>
                  <span class="outline-option-note"
                    >BOEM's 2026 planning units the scores are reported for.</span
                  >
                </span>
              </label>
              <label class="outline-option outline-option--fixed">
                <input type="checkbox" checked disabled />
                <span class="outline-option-text">
                  <span class="outline-option-label">Ecoregions</span>
                  <span class="outline-option-note"
                    >Always shown — the regions each score rescales within (0–100).</span
                  >
                </span>
              </label>
            </div>
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

  .unit-toggle {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding-bottom: var(--space-2);
    border-bottom: 1px solid var(--divider);
  }

  .fields-row {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    flex: 1 1 160px;
    min-width: 0;
  }

  .field-label {
    font-size: var(--text-xs);
    color: var(--text-secondary);
  }

  .note {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--text-secondary);
  }

  /* R3-W8 item 1: the species picker's own row — a vertical stack (label, pills, representation,
     the zoom-to-layer checkbox), unlike `.fields-row`'s wrapping horizontal layout, and bottom-
     bordered the same way `.unit-toggle` is (this sits directly below it, at the top of the pane). */
  .species-field-row {
    padding-bottom: var(--space-2);
    border-bottom: 1px solid var(--divider);
  }

  /* phone, "half" detent (Deliverable 3's own requirement: "the toggle, Layer, Zoom to region and
     the first [two] rows visible without scrolling"): eyes-on first found the layer DESCRIPTION
     alone eating enough height that the stack's first row never came into view -- clamped to 2
     lines as a first pass. Fix round (orchestrator, 2026-09-25): line-clamping still left the
     first two rows below the fold, and the description is no longer the only copy of this text on
     phone anyway -- the Legend modal (W3's B5, merged from main) now shows the SAME layer
     description there. Omitted entirely on phone (never rendered short-but-clamped); unchanged on
     desktop, where there is no Legend-modal duplicate and no space pressure. Paired with a
     tighter panel-wide gap on the same viewport (below) to free the rest of the room.

     Fix round 2 (Ben, 2026-09-25): measured against a real 46svh sheet (`--size-sheet-half`,
     `lib/brand/tokens.css`) this STILL only clears the first row plus the next row's own top
     border -- every remaining gap tightened here (unit-toggle's own bottom padding, the stacked
     Layer/Zoom fields' gap, the "Layers on the map" heading's margin) buys real but modest room;
     closing the rest would mean shrinking a touch target (every row is >= 44px on a coarse
     pointer, `.opacity-btn`'s own rule below) or raising `--size-sheet-half` itself, a SHARED
     token `chromePadding.ts`/`FlowerPanel.svelte`/`tests/map/chromePadding.test.ts` all key off --
     out of this slice's own scope, left for whoever owns the sheet chrome next. */
  @media (max-width: 480px) {
    .note {
      display: none;
    }

    .layers-stack {
      gap: var(--space-1);
    }

    .unit-toggle {
      padding-bottom: var(--space-1);
    }

    .fields-row {
      gap: var(--space-1);
    }
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

  /* WP14: the Data row's "Zoom to layer" button, quiet like the move buttons beside it */
  .zoom-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border: 1px solid var(--border-control);
    border-radius: var(--radius-control);
    background: none;
    color: var(--text-secondary);
    cursor: pointer;
    position: relative;
    flex: none;
  }
  .zoom-btn:disabled {
    opacity: 0.35;
    cursor: default;
  }
  .zoom-btn:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: -2px;
  }
  .auto-zoom-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: 0 var(--space-2) var(--space-1) calc(var(--space-2) + 20px);
    font-size: var(--text-sm);
    color: var(--text-secondary);
    margin-top: calc(-1 * var(--space-1));
  }

  .row-body {
    padding: 0 var(--space-2) var(--space-2);
    border-top: 1px solid var(--border-control);
    padding-top: var(--space-2);
  }

  .outline-choice {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .outline-option {
    display: flex;
    align-items: flex-start;
    gap: var(--space-2);
    cursor: pointer;
  }

  /* fix round (D7): now a real checkbox toggle among others in this pane (not a single-choice
     radio pair any more) -- moved to the SAME muted token every other stack checkbox uses. */
  .outline-option input {
    margin-top: 3px;
    accent-color: var(--border-control);
    cursor: pointer;
  }

  .outline-option input:disabled {
    cursor: default;
    opacity: 0.6;
  }

  /* the "Ecoregions" row: permanently checked+disabled (it cannot be turned off from here) --
     dimmed as a whole so it reads as "always on," not as a broken/unclickable live control. */
  .outline-option--fixed {
    cursor: default;
    opacity: 0.75;
  }

  .outline-option-text {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .outline-option-label {
    font-size: var(--text-sm);
    font-weight: 600;
  }

  .outline-option-note {
    font-size: var(--text-xs);
    color: var(--text-secondary);
  }

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

  /* phone: `.field`'s own `flex: 1 1 160px` still applies inside `.fields-row` (now one field, the
     Layer select, full width since W6 moved "Zoom to region" into the Search bar) -- kept `flex:
     none` here so a future SECOND field added to this row cannot silently reproduce the ~200px
     blank-gap bug eyes-on once caught (phone-04-layers-full): a 160px flex-BASIS applying along a
     column `flex-direction`'s now-vertical main axis. */
  @media (max-width: 480px) {
    .fields-row {
      flex-direction: column;
    }

    .field {
      flex: none;
    }
  }
</style>
