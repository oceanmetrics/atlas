<script lang="ts">
  // atlas-6 step 4, Deliverable 5: composite / flower / components / species table for a custom
  // (drawn/entered) place, by the published zone method (master plan D7/D7b) -- the same SQL twins
  // a Program Area's own page runs, over this place's cell set instead of a zone's. `Flower`/
  // `DataTable` are shared src/lib/ui/ components (not the scores lens's own), so this renders
  // fully within src/places/** without touching src/lens/scores/**.
  //
  // Q3 (P round, item 1, "Selecting a Program Area place opens no results panel in Places"): a
  // `kind: "zone"` place gets THIS SAME panel now, not a second copy -- its coverage/flower/
  // components read straight off `boot` (published, synchronous: a zone's numbers are baked in at
  // release time, so there is no engine round trip, no `loadingScores` state and no
  // `describeAnalysisError` failure mode for that half); only its species table still needs the
  // engine (`results.ts#zoneSpeciesResults`, the same `zone_taxon` path the scores lens' own
  // Table > Zones tool uses). The flower/component-label rule is reused from there too
  // (`lens/scores/flower.ts#zoneFlowerComponents`, `lens/scores/boot.ts#zoneRows`) so a zone's
  // flower here can never disagree with the one the Flower tool draws for the identical zone click.
  import { untrack } from "svelte";
  import Flower from "../lib/ui/Flower.svelte";
  import DataTable from "../lib/ui/DataTable.svelte";
  import { announce } from "../lib/ui/announcer";
  import { categoryLabel } from "../lib/ui/categories";
  import type { GeomPlace, ZonePlace } from "../lib/geo/placeCodec";
  import type { AreaGeometry } from "../lib/geo/types";
  import type { DataEngineContext } from "./dataEngine";
  import type { ComponentScore, SpeciesRow } from "../lib/analysis/queries";
  import {
    cellModelEnabled,
    computeScoreResults,
    computeSpeciesResults,
    describeAnalysisError,
    speciesTilePlan,
    zoneSpeciesResults,
    type ScoreResults,
  } from "./results";
  import { estimateFetchPlan, formatMb, needsConfirmation, type FetchPlan } from "./fetchPlan";
  import { downloadCsv, slugStem, toCsv } from "../lib/download/csv";
  import { unitForZoneSet } from "./model";
  import {
    summarizeZoneStats,
    zoneComponentScores,
    zoneDisplayName,
    zoneNCellsFor,
    zoneStatsFor,
    type ZoneComponentScore,
  } from "./zoneStats";
  import { zoneFlowerComponents } from "../lens/scores/flower";
  import { flowerMaxComponentScore, zoneRows } from "../lens/scores/boot";

  interface Props {
    place: GeomPlace | ZonePlace;
    boot: unknown;
    /** P round deliverable 2 follow-up (coordinator, 2026-09-25): both flowers below pass this
     * through `flowerMaxComponentScore` for their reference ring, the SAME function/manifest the
     * scores lens' own Flower tool uses -- a place's flower and a clicked cell/zone's flower must
     * never draw the ring at two different values for the same release. */
    manifest: unknown;
    ver: string | null;
    dataEngine: (() => Promise<DataEngineContext>) | undefined;
  }

  let { place, boot, manifest, ver, dataEngine }: Props = $props();

  const maxScore = $derived(flowerMaxComponentScore(manifest));

  const isZone = $derived(place.kind === "zone");
  const zoneUnit = $derived(place.kind === "zone" ? unitForZoneSet(place.set) : null);
  const zoneKeys = $derived(place.kind === "zone" ? place.keys : []);
  /** item 1 scopes the full zone results (flower/components/species) to ONE selected Program Area
   * -- a multi-pick zone place (map Pick mode's Ctrl/Cmd-click) still gets the coverage note
   * (summed/averaged, `summarizeZoneStats` already does this for the list row), but the flower and
   * component table are keyed on a SINGLE zone's own `metrics`, so several picks show a short
   * explanatory note instead of guessing which one's flower to draw. */
  const zoneSoleKey = $derived(zoneKeys.length === 1 ? zoneKeys[0] : null);
  const zoneStatsList = $derived(zoneUnit ? zoneStatsFor(boot, zoneUnit, zoneKeys) : []);
  const zoneSummary = $derived(summarizeZoneStats(zoneStatsList));
  const zoneNCells = $derived(zoneUnit ? zoneNCellsFor(boot, zoneUnit, zoneKeys) : null);
  const zoneName = $derived(zoneDisplayName(zoneStatsList));
  const zoneFlower = $derived(
    zoneUnit && zoneSoleKey ? zoneFlowerComponents(zoneRows(boot, zoneUnit), zoneSoleKey) : null,
  );
  const zoneComponentRows = $derived(
    zoneUnit && zoneSoleKey ? zoneComponentScores(boot, zoneUnit, zoneSoleKey) : [],
  );
  const resultsLabel = $derived(
    place.kind === "geom" ? place.name : zoneName || zoneKeys.join(", "),
  );

  let scoreResults = $state<ScoreResults | null>(null);
  let scoreError = $state<string | null>(null);
  let loadingScores = $state(false);

  let fetchPlan = $state<FetchPlan | null>(null);
  let awaitingConfirm = $state(false);
  let speciesRows = $state<SpeciesRow[] | null>(null);
  let speciesProgress = $state<{ done: number; total: number } | null>(null);
  let speciesError = $state<string | null>(null);
  let loadingSpecies = $state(false);

  const speciesAvailable = $derived(cellModelEnabled(boot));

  // usability B1: these results belong to ONE place. On 0.10.21 the effect below read `place` only
  // AFTER an `await`, so it never tracked it: selecting (or uploading) another place kept the
  // previous place's composite under the new name. `placeKey` is the geometry itself (or, for a
  // zone place, its set + keys -- Q3 item 1) -- `places` is re-derived from `#pl=` whenever `sel`
  // changes (a pan writes `map=`), which hands this panel a NEW object for the SAME place that must
  // not re-run anything, and a rename changes nothing a result depends on -- and `run` stamps every
  // analysis, so a place switched or removed mid-analysis drops its late result instead of landing
  // it on the row that replaced it.
  const placeKey = $derived(
    place.kind === "geom"
      ? `geom:${JSON.stringify(place.geometry)}`
      : `zone:${place.set}:${place.keys.join(",")}`,
  );
  let run = 0;

  async function loadScores(geometry: AreaGeometry, token: number) {
    if (!dataEngine) {
      scoreError = "No release is resolved yet.";
      return;
    }
    loadingScores = true;
    scoreError = null;
    try {
      const ctx = await dataEngine();
      const result = await computeScoreResults(ctx, boot, geometry);
      if (token === run) scoreResults = result;
    } catch (err) {
      // P7: the SAME honest sentence `Places.svelte`'s row chip shows for this failure
      // (results.ts#describeAnalysisError) -- a missing release object names itself, instead of a
      // raw, stack-shaped `Error#message`.
      if (token === run) scoreError = describeAnalysisError(err);
    } finally {
      if (token === run) loadingScores = false;
    }
  }

  async function preparePlan() {
    if (!dataEngine || !ver || place.kind !== "geom") return;
    const token = run;
    const geometry = place.geometry;
    const ctx = await dataEngine();
    const { urls } = speciesTilePlan(ctx, ver, geometry);
    if (token !== run) return;
    if (!urls.length) {
      speciesRows = [];
      return;
    }
    const plan = await estimateFetchPlan(urls);
    if (token !== run) return;
    fetchPlan = plan;
    if (needsConfirmation(plan)) {
      awaitingConfirm = true;
    } else {
      await runSpecies();
    }
  }

  async function runSpecies() {
    if (!dataEngine || place.kind !== "geom") return;
    const token = run;
    const geometry = place.geometry;
    awaitingConfirm = false;
    loadingSpecies = true;
    speciesError = null;
    try {
      const ctx = await dataEngine();
      const result = await computeSpeciesResults(ctx, geometry, (done, total) => {
        if (token === run) speciesProgress = { done, total };
      });
      if (token !== run) return;
      speciesRows = result.rows;
      announce(`Species table loaded, ${result.rows.length} rows.`);
    } catch (err) {
      // P7: same honest-sentence helper `loadScores` above uses -- species reads
      // `serve/cell_model/tile=*` tiles, the SAME class of possibly-missing release object.
      if (token === run) speciesError = describeAnalysisError(err);
    } finally {
      if (token === run) loadingSpecies = false;
    }
  }

  // Q3 item 1: the zone twin of `runSpecies()` above -- no fetch plan (see `results.ts#
  // zoneSpeciesResults`'s own header for why a zone's species table needs no tile confirmation),
  // otherwise the SAME run-token guard so a place switch mid-load drops the late result rather than
  // landing it under whichever zone is selected by the time it resolves.
  async function runZoneSpecies() {
    if (!dataEngine || !zoneUnit || !zoneSoleKey) return;
    const token = run;
    const unit = zoneUnit;
    const key = zoneSoleKey;
    loadingSpecies = true;
    speciesError = null;
    try {
      const ctx = await dataEngine();
      const rows = await zoneSpeciesResults(ctx, boot, unit, key);
      if (token !== run) return;
      speciesRows = rows;
      announce(`Species table loaded, ${rows.length} rows.`);
    } catch (err) {
      if (token === run) speciesError = describeAnalysisError(err);
    } finally {
      if (token === run) loadingSpecies = false;
    }
  }

  $effect(() => {
    void placeKey; // a different place (geometry, or zone set+keys) is what re-runs this
    const token = ++run;
    scoreResults = null;
    scoreError = null;
    speciesRows = null;
    fetchPlan = null;
    awaitingConfirm = false;
    speciesProgress = null;
    loadingSpecies = false;
    speciesError = null;
    if (place.kind === "geom") {
      const geometry = untrack(() => place.geometry);
      void loadScores(geometry, token);
    }
    // zone: coverage/flower/components are synchronous `$derived` reads straight off `boot` (see
    // this file's own header) -- nothing to kick off here. Only species is async for a zone, and
    // `runZoneSpecies`'s own run-token guard covers a place switch mid-load the same way
    // `runSpecies` does for a custom place.
  });

  const flowerComponents = $derived(
    (scoreResults?.components ?? []).map((c) => ({ key: c.component, score: c.score })),
  );

  const componentColumns = [
    // P round V2 fix (Opus eyes-on: raw keys like "primprod" show in the UI): `value` stays the
    // raw component key (CSV export -- csv.ts's own toCsv reads `value`, never `format`) while
    // `format` is what DataTable.svelte actually renders on screen.
    {
      key: "component",
      label: "Component",
      value: (r: ComponentScore) => r.component,
      format: (r: ComponentScore) => categoryLabel(r.component),
    },
    {
      key: "score",
      label: "Score",
      value: (r: ComponentScore) => r.score,
      format: (r: ComponentScore) => r.score.toFixed(1),
      numeric: true,
      sortable: true,
    },
    {
      key: "coverage",
      label: "Coverage",
      value: (r: ComponentScore) => r.coverage,
      format: (r: ComponentScore) => `${(r.coverage * 100).toFixed(1)}%`,
      numeric: true,
      sortable: true,
    },
    {
      key: "mean_where_present",
      label: "Mean where present",
      value: (r: ComponentScore) => r.mean_where_present,
      format: (r: ComponentScore) => r.mean_where_present.toFixed(1),
      numeric: true,
      sortable: true,
    },
  ];

  const speciesColumns = [
    {
      key: "sp_common",
      label: "Common name",
      value: (r: SpeciesRow) => r.sp_common ?? r.sp_scientific,
    },
    { key: "sp_scientific", label: "Scientific name", value: (r: SpeciesRow) => r.sp_scientific },
    {
      key: "sp_cat",
      label: "Category",
      value: (r: SpeciesRow) => r.sp_cat,
      format: (r: SpeciesRow) => categoryLabel(r.sp_cat),
    },
    {
      key: "avg_suit",
      label: "Avg. suitability",
      value: (r: SpeciesRow) => r.avg_suit,
      format: (r: SpeciesRow) => r.avg_suit.toFixed(1),
      numeric: true,
      sortable: true,
    },
    {
      key: "area_km2",
      label: "Area km²",
      value: (r: SpeciesRow) => r.area_km2,
      format: (r: SpeciesRow) => r.area_km2.toLocaleString("en-US", { maximumFractionDigits: 0 }),
      numeric: true,
      sortable: true,
    },
  ];

  // Q3 item 1: the zone twin of `componentColumns` above -- just Component/Score, since a
  // published zone's `metrics` carry no per-component coverage/mean-where-present the way a
  // custom place's live SQL blend does (`ZoneComponentScore`'s own header, zoneStats.ts).
  const zoneComponentColumns = [
    {
      key: "component",
      label: "Component",
      value: (r: ZoneComponentScore) => r.component,
      format: (r: ZoneComponentScore) => categoryLabel(r.component),
    },
    {
      key: "score",
      label: "Score",
      value: (r: ZoneComponentScore) => r.score,
      format: (r: ZoneComponentScore) => r.score.toFixed(1),
      numeric: true,
      sortable: true,
    },
  ];

  // P8 item 4: wires `DataTable`'s own `onExport` hook -- see csv.ts's header for why this is
  // fixed rather than removed (no other CSV reaches a drawn/entered place's own components or
  // species). `stem` reruns per place, never cached, so a rename before exporting is reflected.
  const stem = $derived(slugStem(place.kind === "geom" ? place.name : resultsLabel));

  function onExportComponents(rows: ComponentScore[]) {
    downloadCsv(toCsv(rows, componentColumns), `${stem}_components`);
  }

  function onExportZoneComponents(rows: ZoneComponentScore[]) {
    downloadCsv(toCsv(rows, zoneComponentColumns), `${stem}_components`);
  }

  function onExportSpecies(rows: SpeciesRow[]) {
    downloadCsv(toCsv(rows, speciesColumns), `${stem}_species`);
  }
</script>

<section class="results" aria-label="Results for {resultsLabel}">
  {#if isZone}
    <!-- Q3 item 1: a zone place's coverage/flower/components read straight off `boot` -- published
         at release time, so there is no loading/error state to show here (unlike the geom branch
         below, which runs a live SQL query). -->
    <p class="coverage-note">
      {zoneNCells === null ? "—" : zoneNCells.toLocaleString("en-US")} cells,
      {zoneSummary.areaKm2 === null
        ? "—"
        : zoneSummary.areaKm2.toLocaleString("en-US", { maximumFractionDigits: 0 })} km²; published composite
      {zoneSummary.composite === null
        ? "not published for this release"
        : zoneSummary.composite.toFixed(1)}.
    </p>
    {#if zoneSoleKey}
      {#if zoneFlower}
        <div class="composite-row">
          <Flower
            title={resultsLabel}
            components={zoneFlower.components}
            droppedLabels={zoneFlower.droppedLabels}
            size={160}
            {maxScore}
            showTable={false}
          />
          <p class="composite-figure">
            <strong>
              {zoneSummary.composite === null ? "—" : zoneSummary.composite.toFixed(1)}
            </strong>
            composite
          </p>
        </div>
        <DataTable
          label="Components"
          columns={zoneComponentColumns}
          rows={zoneComponentRows}
          getRowId={(r) => r.metric_key}
          height={200}
          onExport={onExportZoneComponents}
        />
      {:else}
        <p class="status">No flower data is published for this Program Area in this release.</p>
      {/if}
    {:else if zoneKeys.length > 1}
      <p class="status">Select a single Program Area to see its flower and components.</p>
    {/if}
  {:else if loadingScores}
    <p class="status">Computing scores…</p>
  {:else if scoreError}
    <p class="status status--error">{scoreError}</p>
  {:else if scoreResults}
    <p class="coverage-note">
      {scoreResults.coverage.coveragePct.toFixed(1)}% of this place is inside the US study area ({scoreResults.coverage.nCellsStudyArea.toLocaleString(
        "en-US",
      )} of
      {scoreResults.coverage.nCellsTotal.toLocaleString("en-US")} cells).
    </p>
    {#if scoreResults.coverage.nCellsStudyArea === 0}
      <p class="status status--error">
        This place is outside US waters here: no scores can be computed.
      </p>
    {:else}
      <div class="composite-row">
        <Flower
          title={resultsLabel}
          components={flowerComponents}
          size={160}
          {maxScore}
          showTable={false}
        />
        <p class="composite-figure">
          <strong>{scoreResults.composite.toFixed(1)}</strong> composite
        </p>
      </div>
      <DataTable
        label="Components"
        columns={componentColumns}
        rows={scoreResults.components}
        getRowId={(r) => r.metric_key}
        height={200}
        onExport={onExportComponents}
      />
    {/if}
  {/if}

  {#if speciesAvailable}
    <div class="species-section">
      <h3>Species</h3>
      {#if speciesRows}
        <DataTable
          label="Species table"
          columns={speciesColumns}
          rows={speciesRows}
          getRowId={(r) => r.mdl_key}
          height={260}
          onExport={onExportSpecies}
        />
      {:else if loadingSpecies}
        <p class="status">
          Loading species{speciesProgress
            ? ` — batch ${speciesProgress.done} of ${speciesProgress.total}`
            : "…"}
        </p>
      {:else if awaitingConfirm && fetchPlan}
        <div class="fetch-plan" role="group" aria-label="Species fetch plan">
          <p>
            Loading species needs {fetchPlan.tileCount} tile{fetchPlan.tileCount === 1 ? "" : "s"},
            {fetchPlan.measured ? "" : "about "}{formatMb(fetchPlan.bytes)}. Continue?
          </p>
          <button type="button" onclick={runSpecies}>Load species</button>
        </div>
      {:else if speciesError}
        <p class="status status--error">{speciesError}</p>
      {:else if isZone && !zoneSoleKey}
        <!-- Q3 item 1: `zoneSpeciesResults`/`loadSpeciesRowsFor` take ONE zone key -- a multi-pick
             zone place gets this note instead of a button that would only ever load ONE of its
             several areas' species without saying which. -->
        <p class="status">
          Species aren't available for several Program Areas at once — select just one.
        </p>
      {:else}
        <button
          type="button"
          onclick={isZone ? runZoneSpecies : preparePlan}
          disabled={!dataEngine}
        >
          Load species
        </button>
      {/if}
    </div>
  {:else}
    <p class="status">Species aren't available for this release.</p>
  {/if}
</section>

<style>
  .results {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    border-top: 1px solid var(--divider);
    padding-top: var(--space-3);
  }

  .status {
    font-size: var(--text-sm);
    color: var(--text-secondary);
    margin: 0;
  }

  .status--error {
    color: var(--text-danger);
  }

  .coverage-note {
    font-size: var(--text-sm);
    margin: 0;
  }

  /* Q3 fix round 1 (coordinator finding, eyes-on): this used to be a flex ROW -- the flower's
     fixed-width figure left the composite text only the narrow leftover space beside it, which
     wrapped "25.0" / "composite" onto separate lines even on a 1280px desktop. A COLUMN, both
     children centred, puts the composite figure under the flower instead -- readable at any
     panel width, phone included. */
  .composite-row {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-2);
  }

  .composite-figure {
    font-size: var(--text-lg);
    margin: 0;
    text-align: center;
  }

  .species-section h3 {
    margin: 0 0 var(--space-2);
    font-size: var(--text-md);
  }

  .fetch-plan {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    font-size: var(--text-sm);
  }

  .fetch-plan button,
  .species-section > button {
    align-self: flex-start;
    height: var(--size-touch);
    padding: 0 var(--space-3);
    border: 1px solid var(--border-control);
    border-radius: var(--radius-control);
    background: var(--fill-accent);
    color: var(--text-on-accent);
    cursor: pointer;
  }
</style>
