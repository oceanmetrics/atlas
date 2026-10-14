<script lang="ts">
  // The species lens' PANEL body — mounted by the shell into the "layers" tool's reserved panel
  // region when `sel.lens === "species"` (docs/map.md / shell contract: the shell owns WHERE a
  // lens mounts, never what it renders). Composes the pure view models `state.svelte.ts` already
  // computed: title + copy buttons (§7.1), the layer bar + representation toggle (§7.2), the
  // sidebar card (§7.3). The legend and the picker mount elsewhere (over the map, and in the
  // topbar's shared search field) — see Shell.svelte.
  //
  // R3 (round-2 plan §5 U4, Deliverable 4: "the species raster and its range are stack rows too"):
  // this whole body is now the shared stack's "Data" row content (`src/lib/ui/LayersPanel.svelte`'s
  // `dataControls` snippet) — the species raster/range paint through the SAME `data-raster` group
  // the scores lens' raster does, so switching lenses keeps whatever visible/opacity/order choice
  // the viewer already made (`sel.layers` is lens-independent view state).
  import type { SpeciesLens } from "./state.svelte";
  import SpeciesTitle from "./SpeciesTitle.svelte";
  import LayerBarView from "./LayerBarView.svelte";
  import SpeciesCardView from "./SpeciesCardView.svelte";
  import LibLayersPanel, {
    type LayersProjectionControl,
    type LayersRowState,
  } from "../../lib/ui/LayersPanel.svelte";
  import type { LayerStackEntry, Representation, Sel } from "../../lib/state/types";
  import { isPlacesSelectionEmpty } from "../../lib/state/types";
  import { placesFromHash } from "../../places/model";
  import type { SelStore } from "../../lib/state/sel.svelte";
  import type { MapHandle } from "../../lib/map/map";
  import type { LayerGroupId } from "../../lib/map/layerStack";
  import { speciesCardErrorText } from "./data/card";
  import PlaceLayerList from "../../places/PlaceLayerList.svelte";
  import type { PlaceOverlays } from "../../places/overlays.svelte";

  interface Props {
    lens: SpeciesLens;
    rep: Representation;
    layerStack: readonly LayerStackEntry[];
    onLayerStackChange: (next: readonly LayerStackEntry[]) => void;
    boot: unknown;
    /** R3 deliverable 6/7: the shared panel's "Outlines" outline choice and "Sphere" row are
     * lens-independent (`Sel.out`/`Sel.proj`) -- new here (this component previously took no `sel`/
     * `selStore`/`mapHandle` at all, since the old panel body had no such controls of its own). */
    sel: Sel;
    selStore: SelStore;
    mapHandle: MapHandle | undefined;
    /** R3-W8 item 3: forwarded straight through to `LibLayersPanel`'s own controlled-row-expansion
     * pair — see that component's header. Shell.svelte owns the value (one Layers pane, shared
     * across lenses). */
    expandedRow?: LayerGroupId | null;
    onExpandedRowChange?: (id: LayerGroupId | null) => void;
    /** R4-B: which spine entry this lens is rendering -- "layers" (the controls) or "details" (the
     * species card's descriptive content, formerly the Layers pane's "Species info" tab). */
    part?: "layers" | "details";
    /** WP11: the gazetteer "Place layers" list, mounted through `LayersPanel`'s `placeLayers` snippet
     * exactly as the Collections lens does (the overlays are drawn in either lens). */
    overlays?: PlaceOverlays;
  }

  // `boot` stays a declared prop (Shell.svelte always passes it, and a lens prop this narrow is
  // not worth a second Shell.svelte branch to drop) but is no longer destructured -- this
  // component reads nothing from it now the toggle it used to feed is gone (below).
  let {
    lens,
    rep,
    layerStack,
    onLayerStackChange,
    sel,
    selStore,
    mapHandle,
    expandedRow,
    onExpandedRowChange,
    part = "layers",
    overlays,
  }: Props = $props();

  function onProjChange(checked: boolean) {
    const proj = checked ? "globe" : "mercator";
    selStore.set({ proj });
    mapHandle?.setProjection(proj);
  }
  const projection = $derived<LayersProjectionControl>({
    checked: sel.proj === "globe",
    onChange: onProjChange,
  });

  // Fix round (Ben, 2026-09-25) -- same rule as the scores lens, see that component's own header
  // on `rowState`/`isPlacesSelectionEmpty`. R3-rr fix 3: a loaded `pl=` places list ALSO counts as
  // "not empty", even with no `sel.sel` pick — `placesFromHash` is the SAME decoder the Download
  // menu already reads (`Shell.svelte`'s `downloadPlaces`), never a second parser of the hash.
  const rowState = $derived<Partial<Record<LayerGroupId, LayersRowState>>>({
    "data-places": {
      empty: isPlacesSelectionEmpty(sel.sel, placesFromHash(sel.pl).length),
      hint: "— nothing selected",
    },
  });

  // R3-W8 item 2: "have a tickbox to stop [zoom-to-layer] in case you want to toggle between
  // layers" — a plain checkbox writer, `lens.setZoomToLayerOnChange` (URL state, `Sel.zl`).
  function onZoomToLayerChange(checked: boolean) {
    lens.setZoomToLayerOnChange(checked);
  }
</script>

{#snippet speciesInfoContent()}
  <!-- R4-B: the Details tool's Species content (formerly R3-W8 item 4's "Species info" tab) --
       everything that is INFORMATION rather than a control (names, listing, categories, inputs
       table…). The controls themselves (the model-input picker, zoom-to-layer checkbox, title/zoom
       actions) stay in the Layers tool. -->
  <div class="species-info" data-testid="species-info-tab">
    {#if lens.cardError}
      <p class="error" role="alert">{speciesCardErrorText(lens.cardError.kind, lens.ver)}</p>
    {:else if lens.info}
      <SpeciesCardView
        info={lens.info}
        hideName={!lens.card?.common}
        asset={lens.mapInputs.asset}
        onSelect={(key) => lens.selectLayer(key)}
      />
    {:else if lens.loading}
      <p>Loading…</p>
    {/if}
  </div>
{/snippet}
{#snippet placeLayers()}
  {#if overlays}<PlaceLayerList {overlays} />{/if}
{/snippet}

{#if part === "details"}
  {@render speciesInfoContent()}
{:else}
  <LibLayersPanel
    stack={layerStack}
    onChange={onLayerStackChange}
    {projection}
    {rowState}
    {expandedRow}
    {onExpandedRowChange}
    placeLayers={overlays ? placeLayers : undefined}
  >
    {#snippet speciesField()}
      <!-- R3-W8 item 1 (Ben, 2026-09-25): "promote the main data selection up" — the layer bar
         (Merged + each input pill, the representation toggle) moved here from the Data row's own
         body, labelled the same way the scores lens' promoted "Layer" field is. -->
      {#if lens.bar}
        <div class="model-input-field" data-testid="model-input-field">
          <span class="field-label">Model input</span>
          <LayerBarView
            bar={lens.bar}
            {rep}
            onSelectLayer={(key) => lens.selectLayer(key)}
            onSetRepresentation={(r) => lens.setRepresentation(r)}
          />
          <label class="zoom-to-layer-check">
            <input
              type="checkbox"
              data-testid="zoom-to-layer-toggle"
              checked={lens.zoomToLayerOnChange}
              onchange={(e) => onZoomToLayerChange(e.currentTarget.checked)}
            />
            <span>Zoom to layer on change</span>
          </label>
        </div>
      {/if}
    {/snippet}
    {#snippet dataControls()}
      <div class="species-panel" data-testid="species-panel">
        {#if lens.cardError}
          <!-- UI-9 (round-3 review): "Couldn't load this species (not-found)." printed the raw error
             code -- a genuine not-found now names the release and points back at search; every
             other (transient/infra) failure gets a plain retry hint. -->
          <p class="error" role="alert">{speciesCardErrorText(lens.cardError.kind, lens.ver)}</p>
        {:else if lens.card}
          <SpeciesTitle
            sci={lens.card.sci}
            common={lens.card.common}
            wideRange={lens.wideRange}
            onSetZoomTarget={(target) => lens.setZoomTarget(target)}
          />
          {#if lens.mapInputs.notice}
            <p class="notice" role="status">{lens.mapInputs.notice}</p>
          {/if}
        {:else if lens.loading}
          <p>Loading…</p>
        {/if}
      </div>
    {/snippet}
  </LibLayersPanel>
{/if}

<style>
  .species-panel,
  .species-info {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .error,
  .notice {
    color: var(--text-secondary);
  }

  /* R3-W8 item 1: the promoted "Model input" field — label, the layer bar, the zoom-to-layer
     checkbox, one vertical stack (matches `LibLayersPanel.svelte`'s own `.field`/`.field-label`
     shape, duplicated here for the same reason `ScoresLayersPanel`'s `.outside-pra-check` already
     duplicates `.visible-check` -- a scoped class cannot cross a component boundary). */
  .model-input-field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .field-label {
    font-size: var(--text-xs);
    color: var(--text-secondary);
  }

  .zoom-to-layer-check {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--text-sm);
    cursor: pointer;
  }

  .zoom-to-layer-check input {
    width: 20px;
    height: 20px;
    accent-color: var(--border-control);
    cursor: pointer;
  }
</style>
