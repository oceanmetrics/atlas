<script lang="ts">
  // atlas-4 step 2/3 — the "table" rail tool: the species table + CSV + glossary + composition
  // treemap (parity doc §7.3-§7.6), plus the zones table (the atlas-4 subplan's "New" bullet, the
  // keyboard/screen-reader equivalent of the choropleth). One `Tabs` underline tablist among the three (R4-C: same data, different view -- control grammar);
  // species/composition data loads lazily through the engine (`speciesLoad.ts`) only once this
  // panel is actually open.
  import { untrack, type Component } from "svelte";
  import Tabs from "../../lib/ui/Tabs.svelte";
  import { collapseToMap } from "../../lib/ui/backToMap";
  import Icon from "../../lib/ui/Icon.svelte";
  import { manifestCapability, type Manifest } from "../../lib/release/manifest";
  import { componentMetricKeys, type SpeciesRow } from "../../lib/analysis/queries";
  import type { Sel } from "../../lib/state/types";
  import type { SelStore } from "../../lib/state/sel.svelte";
  import { layerByKey, primaryUnitType, zoneAllKey, zoneRows } from "./boot";
  import { formatZoneToken } from "./selection";
  import type { ScoresSelection } from "./selection";
  import {
    csvFilename,
    modelSelPatch,
    placesSubjectHeader,
    speciesFilenameStem,
    speciesHeader,
    speciesTableEmptyText,
    toCsv,
  } from "./species";
  import { loadCompositionRows, loadSpeciesRows } from "./speciesLoad";
  import SpeciesTable from "./SpeciesTable.svelte";
  import ZonesTable from "./ZonesTable.svelte";
  import GlossaryModal from "./GlossaryModal.svelte";
  import type { CompositionRow } from "./composition";
  // atlas-7 step 4: "Report on selected" builds the SAME `z.<set>.<keys>` token the Places panel's
  // own zone places use (places/model.ts) -- never a second zone-place encoding.
  import { hashFromPlaces, placesFromHash, zoneSetForUnit } from "../../places/model";
  import { paLabel } from "../../places/zoneStats";
  import { reportSubjects } from "../../lib/state/subjects";
  import { tableTabRequest, takeTableTabRequest } from "../../shell/tableTab.svelte";

  // `Composition.svelte` is loaded via a DYNAMIC `import()`, never a static one, even though it
  // contains no forbidden-marker text itself: it is what dynamically imports `Treemap.svelte`, and
  // that inner import compiles to a reference to `Treemap-<hash>.js` (Vite's own chunk-preload
  // bookkeeping) — a reference `scripts/size-budget.mjs`'s "treemap" marker correctly flags if it
  // ends up inside a file THIS panel reaches by static import. Two hops of dynamic import keep
  // that filename out of the static graph entirely (measured: a static import here failed the
  // budget on `Treemap-<hash>.js` appearing in the entry chunk).
  // see Composition.svelte's own identical note on why this cannot be the real
  // (unimportable-from-plain-.ts) Props type.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let CompositionComponent = $state<Component<any> | null>(null);
  $effect(() => {
    if (!CompositionComponent) {
      import("./Composition.svelte").then((mod) => {
        CompositionComponent = mod.default;
      });
    }
  });

  interface Props {
    sel: Sel;
    selStore: SelStore;
    boot: unknown;
    manifest: unknown;
    ver: string | null;
    unit: string;
    lyr: string | null;
    selection: ScoresSelection;
    /** UI-4: the clicked cell's own centre (`ScoresLens.svelte`'s `cellCoords`, the SAME prop
     * `FlowerPanel` already receives), so this panel's header can print "Species in Cell {id} ·
     * {lat}° N, {lon}° W" through the shared `formatSubject()` rather than the id alone. */
    cellCoords?: { lon: number; lat: number };
    /** R3-W8 item 5 fix round: switches the rail to the Report tool's Places tab -- the empty-state
     * hand-off ("Select places under Report → Places") shown when nothing is selected AND no place
     * has been explicitly added (`reportSubjects()`'s own "last-clicked, selection: null" case). */
    onOpenPlaces?: () => void;
  }

  let {
    sel,
    selStore,
    boot,
    manifest,
    ver,
    unit,
    lyr,
    selection,
    cellCoords,
    onOpenPlaces,
  }: Props = $props();

  let subTab = $state<"species" | "zones" | "composition">("species");
  // the guided tour's "Table" step asks for the Zones tab (the ranked Program Areas it describes);
  // a request made before this panel mounted is applied on mount, one made while it is open, when
  // it arrives. Consumed, so it never steers a later open.
  $effect(() => {
    if (tableTabRequest.tab === null) return;
    const tab = takeTableTabRequest();
    if (tab) subTab = tab;
  });
  let glossaryOpen = $state(false);

  const allKey = $derived(zoneAllKey(boot));
  const unitLabel = $derived(
    (boot as { units?: Array<{ label?: unknown }> } | null)?.units?.[0]?.label as
      string | undefined,
  );
  const currentZone = $derived(
    selection?.kind === "zone"
      ? zoneRows(boot, selection.unit).find((z) => z.key === selection.key)
      : undefined,
  );
  // V4 fix (owner phone report, 2026-09-24, docs fact-check item 3): the table header for a
  // CLICKED Program Area used to read `currentZone?.name` verbatim (== the bare key -- no
  // published bundle carries a real name, zoneStats.ts's own header) instead of the SAME
  // "Full Name (KEY)" label (`paLabel`, V1's names table) the Zones table already shows for that
  // same zone. Filename stem below is left as the bare name/key on purpose -- a CSV filename is
  // not the place for "(" ")" punctuation.
  const currentZoneLabel = $derived(
    currentZone && selection?.kind === "zone"
      ? paLabel(currentZone.key, currentZone.name, selection.unit)
      : undefined,
  );
  // R3-W8 item 5: "the Table's subject line uses the same rule and says so" -- `reportSubjects()`
  // (src/lib/state/subjects.ts) is the ONE rule that decides whether a non-empty EXPLICIT Places
  // list (`sel.pl`) or the Last-clicked slot (`sel.sel`, this panel's own `selection` prop already
  // IS that slot, parsed once upstream in ScoresLens.svelte) governs. While no place has been
  // explicitly added, this is a no-op (`subject.kind` is always "last-clicked" and the header text
  // is byte-identical to before this item) -- the species/zones DATA this panel queries still comes
  // from `selection`/`unit`/`lyr` alone (aggregating species across an explicit multi-place list is
  // a larger feature left to a later round; see this item's own report for the scoping note).
  const places = $derived(placesFromHash(sel.pl));
  const subject = $derived(reportSubjects(sel, places));
  // R3-W8 item 5 fix round: "when there is no selection, add a line 'Select places under
  // Report → Places'... next to the existing all-US-waters aggregate" -- true only when NEITHER a
  // click nor an explicit place governs (`reportSubjects()`'s own "nothing at all" shape).
  const noSelectionAtAll = $derived(subject.kind === "last-clicked" && subject.selection === null);
  const header = $derived(
    subject.kind === "places"
      ? placesSubjectHeader(subject.items.length)
      : speciesHeader({
          selection,
          zoneName: currentZoneLabel,
          unit: selection?.kind === "zone" ? selection.unit : unit,
          unitLabel: unitLabel ?? null,
          zoneAllKey: allKey,
          cellCoords,
        }),
  );
  const filenameStem = $derived(
    speciesFilenameStem({
      selection,
      zoneName: currentZone?.name,
      unit: selection?.kind === "zone" ? selection.unit : unit,
      unitLabel: unitLabel ?? null,
      zoneAllKey: allKey,
    }),
  );

  const cellSpeciesAvailable = $derived(
    manifestCapability(manifest as Manifest | null, "cell_species_list"),
  );
  const noSpeciesPublished = $derived(
    selection?.kind === "zone" && currentZone !== undefined && currentZone.n_taxa === 0,
  );
  const unavailable = $derived(selection?.kind === "cell" && !cellSpeciesAvailable);

  let speciesRows = $state<SpeciesRow[] | null | undefined>(undefined);
  let compositionRows = $state<CompositionRow[] | null | undefined>(undefined);
  // D3(b) (Opus 5.5 eyes-on, 2026-09-24): `speciesRows === null` used to be ONE state covering both
  // "nothing scored is selected" (the bail-out below) AND a genuine thrown failure from
  // `loadSpeciesRows` — both rendered the SAME "could not be loaded" text, which reads as a bug for
  // the former. Captured separately so the panel can show a message that NAMES the failure only
  // when there really was one (`speciesTableEmptyText`'s own header).
  let speciesError = $state<string | null>(null);

  async function reload() {
    speciesError = null;
    // #9 (2026-10-16): a cold `?tool=table` mounts this panel before the release's boot.json has
    // resolved; loading then built the analysis engine over a `null` boot ("Cannot read properties
    // of null (reading 'ver')"). Stay in the loading state -- the effect below re-runs when `boot`
    // arrives.
    if (!boot) {
      speciesRows = undefined;
      compositionRows = undefined;
      return;
    }
    if (!ver || unavailable || noSpeciesPublished) {
      speciesRows = null;
      compositionRows = null;
      return;
    }
    speciesRows = undefined;
    compositionRows = undefined;
    // two INDEPENDENT queries, two independent failures: the species table and the composition
    // treemap are different tabs of this SAME panel (subTab), so a composition.sql failure (e.g.
    // a taxonomy join mismatch on some release) must not also blank the species table -- they used
    // to share one try/catch, so ANY failure in EITHER query nulled BOTH, even when the species
    // rows had already loaded successfully one line above.
    try {
      speciesRows = await loadSpeciesRows(ver, boot as Record<string, unknown>, {
        selection,
        zoneAllKey: allKey,
      });
    } catch (err) {
      speciesRows = null;
      speciesError = err instanceof Error ? err.message : String(err);
    }
    try {
      compositionRows = await loadCompositionRows(ver, boot as Record<string, unknown>);
    } catch {
      compositionRows = null;
    }
  }

  $effect(() => {
    // re-run whenever the selection (or the release) changes; `untrack` keeps `subTab` from
    // retriggering a reload merely by switching tabs on data already in hand.
    void selection;
    void ver;
    void boot;
    untrack(() => reload());
  });

  function onExportCsv() {
    if (!speciesRows) return;
    const columns = [
      { key: "sp_cat", value: (r: SpeciesRow) => r.sp_cat },
      { key: "sp_scientific", value: (r: SpeciesRow) => r.sp_scientific },
      { key: "sp_common", value: (r: SpeciesRow) => r.sp_common },
      { key: "taxon_authority", value: (r: SpeciesRow) => r.taxon_authority },
      { key: "taxon_id", value: (r: SpeciesRow) => r.taxon_id },
      { key: "er_code", value: (r: SpeciesRow) => r.er_code },
      { key: "er_score", value: (r: SpeciesRow) => r.er_score },
      { key: "is_mmpa", value: (r: SpeciesRow) => r.is_mmpa },
      { key: "is_mbta", value: (r: SpeciesRow) => r.is_mbta },
      { key: "mdl_key", value: (r: SpeciesRow) => r.mdl_key },
      { key: "area_km2", value: (r: SpeciesRow) => r.area_km2 },
      { key: "avg_suit", value: (r: SpeciesRow) => r.avg_suit },
      { key: "pct_cat", value: (r: SpeciesRow) => r.pct_cat },
    ];
    const csv = toCsv(speciesRows, columns);
    const filename = csvFilename(filenameStem);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  function onModelClick(mdlKey: string) {
    selStore.set(modelSelPatch(mdlKey));
  }

  function onSelectZone(key: string) {
    selStore.set({ sel: formatZoneToken(zonesUnit, key) });
  }

  // atlas-7 step 4: "Report on selected" -- one zone Place carrying every checked key (model.ts's
  // own multi-key zone shape; `expandPlaces()` on the report side splits it back into one reported
  // area per key, exactly as if each had been added from the Places panel separately).
  // `window.open()` runs SYNCHRONOUSLY in this handler, same rule as Places.svelte's own "Report"
  // (no `await` before it, or the popup blocker treats the tab as not user-initiated).
  function onReportSelected(keys: string[]) {
    if (!keys.length) return;
    const set = zoneSetForUnit(zonesUnit);
    if (!set) return; // an unrecognized unit type: nothing to encode, no broken link to open
    const hash = hashFromPlaces([{ kind: "zone", set, keys }]);
    const query = ver ? `?ver=${encodeURIComponent(ver)}` : "";
    window.open(`./report.html${query}${hash ? `#pl=${hash}` : ""}`, "_blank", "noopener");
  }

  const currentLayer = $derived(layerByKey(boot, lyr));
  const componentKeys = $derived(componentMetricKeys(boot));
  // the zones table always ranks the release's ONE drawable unit (D17) — independent of whether
  // the map is currently in the cell-raster branch or the zone-choropleth branch.
  const zonesUnit = $derived(primaryUnitType(boot) ?? "programarea");
</script>

<div class="table-panel">
  <!-- R4-C: ONE header row at full stage -- back to the map, what is shown, the view tabs, info,
       download. "← Map" collapses the panel through the spine's own active-entry click (R4-B), so
       it never needs a Shell hook; hidden on the phone, where the sheet has its own detents. -->
  <div class="header-row">
    <button type="button" class="back-btn" onclick={() => collapseToMap()}>← Map</button>
    <h3 class="header-text">{unavailable ? `${header} — unavailable` : header}</h3>
    <Tabs
      ariaLabel="Table view"
      value={subTab}
      options={[
        { value: "species", label: "Species" },
        { value: "zones", label: "Zones" },
        { value: "composition", label: "Composition" },
      ]}
      onchange={(v) => (subTab = v as typeof subTab)}
    />
    <!-- UI-11 (round 3): `data-tooltip` equal to `aria-label` -- these icon-only buttons had no
         tooltip before this round. -->
    <button
      type="button"
      class="icon-btn"
      aria-label="Column glossary"
      data-tooltip="Column glossary"
      onclick={() => (glossaryOpen = true)}
    >
      <Icon name="info" size={16} />
    </button>
    <button
      type="button"
      class="icon-btn"
      aria-label="Download CSV"
      data-tooltip="Download CSV"
      disabled={!speciesRows}
      onclick={onExportCsv}
    >
      <Icon name="download" size={16} />
    </button>
  </div>

  {#if noSelectionAtAll}
    <!-- R4-C empty state: one sentence on how selection works and one button into Report. The
         all-US-waters aggregate below stays (R3-W8 item 5: "don't replace that aggregate"). -->
    <p class="note select-places-hint" data-testid="select-places-hint">
      Click a cell or a Program Area on the map, or add places, to see what lives there.
      <button type="button" class="select-places-link" onclick={() => onOpenPlaces?.()}>
        Add places in Report
      </button>
    </p>
  {/if}

  {#if subTab === "species"}
    {#if unavailable}
      <p class="note">This release does not publish a species list for a clicked cell.</p>
    {:else if noSpeciesPublished}
      <p class="note">No species table published for this zone in {ver}.</p>
    {:else if speciesRows === undefined}
      <p class="note">Loading species…</p>
    {:else if speciesRows === null}
      <p class="note" class:note--error={speciesError}>{speciesTableEmptyText(speciesError)}</p>
    {:else}
      <SpeciesTable label={header} rows={speciesRows} {sel} {onModelClick} />
    {/if}
  {:else if subTab === "zones"}
    <ZonesTable
      zones={zoneRows(boot, zonesUnit)}
      metricKey={lyr ?? ""}
      metricLabel={currentLayer?.label ?? lyr ?? "Score"}
      {componentKeys}
      {onSelectZone}
      {onReportSelected}
    />
  {:else if CompositionComponent}
    {@const Comp = CompositionComponent}
    <Comp title={header} rows={compositionRows} />
  {:else}
    <p class="note">Loading the composition view…</p>
  {/if}
</div>

<GlossaryModal open={glossaryOpen} onclose={() => (glossaryOpen = false)} />

<style>
  .table-panel {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    /* R3-B9 (Opus eyes-on review, 2026-09-25): hands a definite height down to `SpeciesTable.svelte`'s
       own root (`.species-table { height: 100% }`), which is what lets ITS `.scroll-region` grow
       to fill a tall desktop panel instead of stopping at a fixed 50vh -- see that component's own
       comment. `min-height: 0` is the matching flex-child fix (an auto-height flex item refuses to
       shrink below its content's natural height by default). Resolves to `auto` wherever the
       ancestor chain (`Panel.svelte`'s `.panel-body`) has no definite height of its own, same
       graceful no-op `Panel.svelte`'s own header documents. */
    height: 100%;
    min-height: 0;
  }

  .header-row {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--space-2) var(--space-4);
  }

  .header-text {
    flex: 1 1 12rem;
    margin: 0;
    font-size: var(--text-md);
  }

  .back-btn {
    min-height: var(--size-touch);
    padding: 0 var(--space-3);
    border: 1px solid var(--border-control);
    border-radius: var(--radius-control);
    background: none;
    color: var(--text-primary);
    font: inherit;
    font-size: var(--text-sm);
    cursor: pointer;
  }

  .back-btn:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }

  /* the phone's sheet has its own detents; the map is reached by dragging it down */
  @media (max-width: 899px) {
    .back-btn {
      display: none;
    }
  }

  .icon-btn {
    display: inline-grid;
    place-items: center;
    width: var(--size-touch);
    height: var(--size-touch);
    border: 1px solid var(--border-control);
    border-radius: var(--radius-control);
    background: none;
    color: var(--icon-muted);
    cursor: pointer;
  }

  .icon-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .note {
    margin: 0;
    color: var(--text-secondary);
    font-size: var(--text-sm);
  }

  /* D3(b): a genuine query failure reads visually distinct from the plain "click a cell" hint --
     never the same colour as a routine empty state (FlowerPanel.svelte's own identical rule). */
  .note--error {
    color: var(--text-danger);
  }

  .select-places-hint {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex-wrap: wrap;
  }

  .select-places-link {
    border: none;
    background: none;
    padding: 0;
    color: var(--text-link);
    font: inherit;
    font-size: var(--text-sm);
    cursor: pointer;
    text-decoration: underline;
  }

  .select-places-link:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }
</style>
