<script lang="ts">
  // atlas-4 — the Scores lens' orchestrator. Mounted by Shell.svelte only when `sel.lens ===
  // "scores"`; owns nothing about MapLibre itself. 0.10.21 fix 1: it no longer COMPUTES the
  // composeStyle inputs itself (that used to live in an `$effect` here, writing a `bind:mapExtra`
  // prop the panel body only ever ran while mounted — the exact bug this fix closes, see
  // `../scores/state.svelte.ts`'s own header) -- it reads them off the `lens` prop
  // (`createScoresLens()`, instantiated by Shell.svelte independent of this component ever
  // mounting) and renders whichever panel body the shell's active rail tool calls for. Step 1
  // landed layers/legend/controls; step 2 adds the map click -> selection wiring, the clicked
  // cell's engine-backed flower, and the species/zones/composition table. "places" and "report"
  // still fall back to the shell's own placeholder text — those tools belong to other phases.
  //
  // atlas-8 review round 2, item M1: the click -> selection -> popup path (this component's own
  // `$effect` registering `map.on("click", ...)`) moved to `../scores/state.svelte.ts`'s
  // `handleMapClick` -- the SAME class of bug 0.10.21 fixed for map inputs, one layer down: this
  // component is mounted only inside the panel body, so a click did nothing with the desktop panel
  // collapsed or the Places tool open. Shell.svelte now calls `lens.handleMapClick(...)` from its
  // ONE `map.on("click", ...)` listener, same as species. This component keeps only what needs the
  // PANEL to exist at all: the clicked cell's flower fetch, and the layers/table panels below.
  import type { Sel } from "../../lib/state/types";
  import type { SelStore } from "../../lib/state/sel.svelte";
  import type { MapHandle } from "../../lib/map/map";
  import type { ScoresLens } from "./state.svelte";
  import { gridFromBoot, tileOf } from "../../lib/grid/grid";
  import { componentMetricKeys } from "../../lib/analysis/queries";
  import { exclusive } from "../../lib/analysis/exclusive";
  import { cellFlowerComponents, type CellComponentRow, type DedupResult } from "./flower";
  import { getAnalysisSources } from "./engine";
  import ScoresLayersPanel from "./LayersPanel.svelte";
  // R3 (round-2 plan §5 U4): the lens-independent stack shell — `docs/map.md`'s "the Layers panel
  // IS the stack" (Ben's decision R3). `ScoresLayersPanel` above is now only its "Data" row's
  // content, passed in as the `dataControls` snippet below.
  import LibLayersPanel, {
    type LayersLayerField,
    type LayersOutlineChoice,
    type LayersProjectionControl,
    type LayersRowState,
    type LayersUnitToggle,
  } from "../../lib/ui/LayersPanel.svelte";
  import { layerByKey, layerGroups, metricKeyLabel, primaryUnitNote, unitOptions } from "./boot";
  import { isPlacesSelectionEmpty } from "../../lib/state/types";
  import { placesFromHash } from "../../places/model";
  import FlowerPanel from "./FlowerPanel.svelte";
  import TablePanel from "./TablePanel.svelte";
  import type { LayerStackEntry, Outline } from "../../lib/state/types";
  import type { LayerGroupId } from "../../lib/map/layerStack";

  interface Props {
    sel: Sel;
    selStore: SelStore;
    boot: unknown;
    manifest: unknown;
    ver: string | null;
    mapHandle: MapHandle | undefined;
    activeTool: string;
    /** the shell's own placeholder text for `activeTool`, rendered for a tool this lens does not
     * (yet, or ever) own — "places" and "report" belong to other phases. */
    fallbackBody: string;
    /** 0.10.21 fix 1 -- the lens-level map-input store Shell.svelte instantiates whenever
     * `sel.lens === "scores"` (`state.svelte.ts#createScoresLens`), independent of this component.
     * `unit`/`lyr`/`manifestOverlays`/`selection`/`mapSelection`/`showOutsidePra`/`mapExtra` all
     * come from here now, not recomputed a second time. */
    lens: ScoresLens;
    /** R3: the resolved layer stack (`sel.layers ?? defaultLayerStackEntries()`) and its writer —
     * both computed once by Shell.svelte (the SAME object `composeStyleInput` reads), so the panel
     * and the map can never disagree about what the current stack is. */
    layerStack: readonly LayerStackEntry[];
    onLayerStackChange: (next: readonly LayerStackEntry[]) => void;
    /** P3 fix (Opus eyes-on review, 2026-09-24): passed straight through to `FlowerPanel`'s own
     * prop of the same name -- see that component's header for why. */
    compactFlower?: boolean;
    /** R3-W8 item 3: forwarded straight through to `LibLayersPanel`'s own controlled-row-expansion
     * pair — see SpeciesLens.svelte's identical prop for the full header. */
    expandedRow?: LayerGroupId | null;
    onExpandedRowChange?: (id: LayerGroupId | null) => void;
    /** R4-B: the Details tool's header row -- the last-clicked label (`lastClicked.ts`), the
     * "Add to report" action (Shell's `onAddLastClicked`, the SAME place-append the Report pane's
     * own "Add to places" row calls) and "Open table" (a spine hop, never a tool switch on click). */
    lastClickedLabel?: string | null;
    onAddLastClicked?: () => void;
    onOpenTable?: () => void;
    /** R3-W8 item 5 fix round: forwarded straight through to `TablePanel`'s own prop of the same
     * name -- switches the rail to the Report tool's Places tab (the empty-state hand-off, "Select
     * places under Report → Places"). */
    onOpenPlaces?: () => void;
  }

  let {
    sel,
    selStore,
    boot,
    manifest,
    ver,
    mapHandle,
    activeTool,
    fallbackBody,
    lens,
    layerStack,
    onLayerStackChange,
    compactFlower = false,
    expandedRow,
    onExpandedRowChange,
    lastClickedLabel = null,
    onAddLastClicked,
    onOpenTable,
    onOpenPlaces,
  }: Props = $props();

  const unit = $derived(lens.unit);
  const lyr = $derived(lens.lyr);
  const manifestOverlays = $derived(lens.manifestOverlays);

  // P round deliverable 1: the Layers panel's own primary control (the shared `LibLayersPanel`'s
  // `unitToggle` prop) -- replaces the old "Spatial units" `<Select>` that used to live in
  // `ScoresLayersPanel` (`./LayersPanel.svelte`, still rendered below for the Data row's OTHER
  // controls). `onUnitChange` is the SAME body that Select's own `onchange` used to call.
  function onUnitChange(value: string) {
    selStore.set({ unit: value, sel: undefined });
  }
  const unitToggle = $derived<LayersUnitToggle>({
    options: unitOptions(boot),
    value: unit,
    onChange: onUnitChange,
  });

  // Fix round (Ben, 2026-09-25): "dim Selection if there is none to display, otherwise its
  // presence can cause confusion." `sel.sel` is the ONE field every kind of selection (a clicked
  // cell, a zone, a drawn/uploaded place) writes -- `isPlacesSelectionEmpty` is the shared pure
  // predicate (`lib/state/types.ts`, tested in `tests/state/codec.test.ts`) both lenses read so
  // "empty" can never mean something different in scores vs species.
  //
  // R3-rr fix 3 (Opus 5.5 eyes-on review round 3, 2026-09-25): a loaded `pl=` places list ALSO
  // counts as "not empty", even with no `sel.sel` pick (`?pl=z.pa.GAA` loads one place with nothing
  // selected — the Places panel + Download menu both already treat that as "places present").
  // `placesFromHash` is the SAME decoder the Download menu reads (`Shell.svelte`'s
  // `downloadPlaces`), never a second parser of the hash.
  const rowState = $derived<Partial<Record<LayerGroupId, LayersRowState>>>({
    "data-places": {
      empty: isPlacesSelectionEmpty(sel.sel, placesFromHash(sel.pl).length),
      hint: "— nothing selected",
    },
  });

  // R3 deliverable 3 (Ben, 2026-09-25): "Move Layer selector to top" -- promoted from
  // `ScoresLayersPanel`'s own body to the shared panel's panel-level field, built here from the
  // SAME pure boot readers that component used to call directly (`layerGroups`/`layerByKey`), so
  // the move changes nothing about what the control reads or writes, only where it renders.
  //
  // W6 (Ben, 2026-09-25): "Regions move into the Search bar" -- the "Zoom to region" select this
  // deliverable ALSO promoted (its own `studyAreasFromBoot`-derived `zoomField`, `onAreaChange`)
  // moved OUT again, into `ScoresSearch.svelte`'s "Regions" group (`search.ts#matchRegions`,
  // `state.svelte.ts#selectRegion`) -- "the Search bar is really a zoom to this place... Region
  // ... could also [live] there too" (Ben). `LibLayersPanel`'s `zoomField` prop is gone with it.
  const groups = $derived(layerGroups(boot));

  // Fix round (orchestrator, 2026-09-25, R3-B1): the WHOLE `metricLabels ?? layer.label` chain
  // now routes through `metricKeyLabel()` as its `label` argument -- a curated label that is
  // itself just the bare key ("score") is caught there too, not only an ABSENT one (see that
  // function's own header for why the old `?? metricKeyLabel(key)` tail never saw that case).
  function metricLabel(l: { metric_key: string; label?: string }): string {
    return metricKeyLabel(l.metric_key, lens.metricLabels[l.metric_key] ?? l.label);
  }

  function onLyrChange(value: string) {
    selStore.set({ lyr: value });
  }

  // v1's own note ("predates the BOEM Program Areas") used to render under "Study area" -- kept,
  // now folded into the same description slot under the Layer/Zoom-to-region row (`unitNote` is
  // `null` on every release since v1, so this is a no-op change for every current release).
  const unitNote = $derived(primaryUnitNote(boot, ver));

  const layerField = $derived<LayersLayerField>({
    label: "Layer",
    value: lyr ?? "",
    groups: groups.map((g) => ({
      label: g.label,
      options: g.layers.map((l) => ({ value: l.metric_key, label: metricLabel(l) })),
    })),
    onChange: onLyrChange,
    description: (() => {
      const l = layerByKey(boot, lyr);
      const desc = l?.label ?? null;
      // M6 (review round 1): a release that publishes no SHORT label for this layer falls back to
      // the SAME `label` text `metricLabel()` already used for the option -- repeating it verbatim
      // as a description is redundant, not informative.
      const layerDesc = desc === null || !l ? null : desc === metricLabel(l) ? null : desc;
      if (unitNote && layerDesc) return `${unitNote} ${layerDesc}`;
      return unitNote ?? layerDesc;
    })(),
  });

  // R3 deliverable 6, fix round D7: the "Outlines" row's Program-Areas on/off toggle, bound to
  // `Sel.out`. `value` is the wider `Outline` type now (`LayersOutlineChoice`'s own header) --
  // unchecking the checkbox writes "none" directly.
  function onOutlineChange(value: Outline) {
    selStore.set({ out: value });
  }
  const outline = $derived<LayersOutlineChoice>({ value: sel.out, onChange: onOutlineChange });

  // R3 deliverable 7: Sphere moved to the bottom of the shared panel -- SAME body the old switch in
  // `ScoresLayersPanel` called.
  function onProjChange(checked: boolean) {
    const proj = checked ? "globe" : "mercator";
    selStore.set({ proj });
    mapHandle?.setProjection(proj);
  }
  const projection = $derived<LayersProjectionControl>({
    checked: sel.proj === "globe",
    onChange: onProjChange,
  });

  // the selection AS THE FLOWER/SPECIES/TABLE PANELS SEE IT (`cell:<id>` keeps the raw cell id —
  // `flower.ts`/`species.ts` need it verbatim for titles and headers).
  const selection = $derived(lens.selection);

  // the SAME selection, reshaped into what `scoresMapInputs` needs for the map ring (a cell's
  // centre + half-extents rather than its bare id — pure arithmetic on the release's own grid, so
  // no engine call is needed just to draw the ring).
  const mapSelection = $derived(lens.mapSelection);

  // click -> selection -> popup lives in `../scores/state.svelte.ts#handleMapClick` now (item M1);
  // Shell.svelte calls it directly. This component only needs `selection`/`mapSelection` (above)
  // to render the flower/species/zones panels below.

  // --- a clicked cell's flower (step 2): the wide `cell` tile fetched through the engine
  // (`sql/cell_components.sql`), never `/cog/point` (plan D4 reserves that for species values
  // only). A token guard drops a stale response if the selection moves on before it resolves.
  // atlas-8 review round 2, item 3a: `cellTiles()` rebuilds the SAME shared `cell` view a place
  // analysis (or the click popup's own value fetch) builds, so this whole build-then-read
  // sequence now runs inside `exclusive(sources.db, ...)` too (usability B1's rule).
  let cellFlowerRows = $state<DedupResult | null | undefined>(undefined);
  // D3(b) (Opus 5.5 eyes-on, 2026-09-24): the catch below used to swallow ANY failure into the
  // SAME `null` a genuinely empty result produces, so FlowerPanel could never tell "the release has
  // nothing here" from "the fetch itself broke" apart -- both showed the (misleading) "no flower
  // data is published" text. Captured here, separately, so the panel can show a distinct message
  // that NAMES the failure.
  let cellFlowerError = $state<string | null>(null);
  let cellFlowerToken = 0;
  $effect(() => {
    const s = selection;
    const v = ver;
    if (s?.kind !== "cell") {
      cellFlowerRows = undefined;
      cellFlowerError = null;
      return;
    }
    const token = ++cellFlowerToken;
    cellFlowerRows = undefined;
    cellFlowerError = null;
    (async () => {
      if (!v) throw new Error("no release version yet");
      const bootObj = boot as Record<string, unknown>;
      const grid = gridFromBoot(bootObj);
      const tile = tileOf(s.cellId, grid);
      const sources = await getAnalysisSources(v, bootObj);
      return exclusive(sources.db, async () => {
        await sources.cellTiles([tile]);
        const { cellComponents } = await import("../../lib/analysis/queries");
        const rows = await cellComponents(sources.db, sources.templates, {
          cellId: s.cellId,
          metricKeys: componentMetricKeys(bootObj),
        });
        // `cellComponents()` is typed as `Promise<Record<string, unknown>[]>` (a generic engine
        // result); `sql/cell_components.sql`'s actual columns are exactly `CellComponentRow`'s.
        return rows as unknown as CellComponentRow[];
      });
    })()
      .then((rows) => {
        if (token === cellFlowerToken) cellFlowerRows = cellFlowerComponents(rows);
      })
      .catch((err: unknown) => {
        if (token !== cellFlowerToken) return;
        cellFlowerRows = null;
        cellFlowerError = err instanceof Error ? err.message : String(err);
      });
  });

  const cellCoords = $derived(
    mapSelection?.kind === "cell" ? { lon: mapSelection.lon, lat: mapSelection.lat } : undefined,
  );

  // NavigationControl/FullscreenControl/ScaleControl (parity doc §6.2 step 7) were tried here via
  // `mapHandle.map.addControl(...)` and REVERTED: MapLibre appends every control's real
  // `<button>` INTO `#map`, which Shell.svelte gives `role="img"` (spec.md/atlas-3) — axe's
  // `nested-interactive` rule correctly flags interactive controls inside an element role="img"
  // marks non-interactive to assistive tech (measured: `e2e/shell.a11y.spec.ts` went red). Fixing
  // it needs a decision this phase should not make alone (drop `role="img"` from `#map` now that
  // it holds real controls? give the controls their own non-`#map` DOM parent MapLibre does not
  // support?) — left for whoever adds map controls next; see the atlas-4 report's "could not
  // satisfy" list. The Nominatim geocoder was never attempted (a third-party dependency + a live
  // network call, also out of scope this phase).
</script>

{#if activeTool === "layers"}
  <LibLayersPanel
    stack={layerStack}
    onChange={onLayerStackChange}
    {unitToggle}
    {layerField}
    {outline}
    {projection}
    {rowState}
    {expandedRow}
    {onExpandedRowChange}
  >
    {#snippet dataControls()}
      <ScoresLayersPanel
        {sel}
        {selStore}
        {boot}
        {manifestOverlays}
        showOutsidePra={lens.showOutsidePra}
        onShowOutsidePraChange={(v) => lens.setShowOutsidePra(v)}
        {unit}
      />
    {/snippet}
  </LibLayersPanel>
{:else if activeTool === "details"}
  <!-- R4-B: the Flower plot, moved out of the Layers pane's second tab into its own spine entry.
       A map click updates it in place (`selection`/`cellFlowerRows` are the lens' own reactive
       state); a click never switches tools. -->
  <div class="details" data-testid="details-tool">
    {#if lastClickedLabel}
      <div class="details-head" data-testid="details-head">
        <div class="details-actions">
          <button type="button" data-testid="details-add" onclick={() => onAddLastClicked?.()}>
            Add to report
          </button>
          <button type="button" data-testid="details-open-table" onclick={() => onOpenTable?.()}>
            Open table
          </button>
        </div>
      </div>
    {/if}
    <FlowerPanel
      {boot}
      {manifest}
      {selection}
      cellComponents={cellFlowerRows}
      cellComponentsError={cellFlowerError}
      {cellCoords}
      {compactFlower}
      subjectInHeader={!!lastClickedLabel}
    />
  </div>
{:else if activeTool === "table"}
  <TablePanel
    {sel}
    {selStore}
    {boot}
    {manifest}
    {ver}
    {unit}
    {lyr}
    {selection}
    {cellCoords}
    {onOpenPlaces}
  />
{:else}
  <p>{fallbackBody}</p>
{/if}

<style>
  .details {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .details-head {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--border-control);
    border-radius: var(--radius-card);
    background: var(--surface-raised);
  }

  .details-actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  .details-actions button {
    display: inline-flex;
    align-items: center;
    height: var(--size-touch);
    padding: 0 var(--space-3);
    border: 1px solid var(--border-control);
    border-radius: var(--radius-control);
    background: var(--fill-control);
    color: var(--text-primary);
    font: inherit;
    cursor: pointer;
  }

  .details-actions button:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }
</style>
