<script lang="ts">
  // atlas-4 — the flower panel. Step 1 ships the two Tier-0-only paths (nothing selected -> the
  // release's `flower_default`; a zone selected -> `boot.zones[unit]`'s own metrics); a cell
  // selection's flower needs the engine (`sql/cell_components.sql`) and is wired by
  // `ScoresLens.svelte`'s step-2 click handling, which passes `cellComponents` down once loaded.
  import Flower from "../../lib/ui/Flower.svelte";
  import {
    defaultFlowerComponents,
    flowerEmptyText,
    flowerTitle,
    zoneFlowerComponents,
    type DedupResult,
  } from "./flower";
  import { flowerMaxComponentScore, zoneAllKey, zoneRows } from "./boot";
  import type { ScoresSelection } from "./selection";
  // V4 fix (owner phone report, 2026-09-24, docs fact-check item 3): `zoneName` below used to
  // return the bundle's bare `name` (== the key on every real release -- zoneStats.ts's own
  // header: no published bundle carries a real Program Area name) instead of the SAME
  // "Full Name (KEY)" label (`paLabel`, V1's names table) the Zones table and Places panel
  // already show -- so the flower title for a selected zone read "GAA", not "GOA Program Area A
  // (GAA)", while every other place that names a Program Area agreed.
  import { paLabel } from "../../places/zoneStats";

  interface Props {
    boot: unknown;
    /** P round deliverable 2 follow-up (coordinator, 2026-09-25): `flowerMaxComponentScore` reads
     * the release MANIFEST's `metrics[]`, not `boot.layers[]` (only the manifest carries a per-
     * component `rescale_max` -- boot.json's `by_subregion` exists only on the composite row on
     * every real release). */
    manifest: unknown;
    selection: ScoresSelection;
    /** the clicked cell's own flower (step 2's engine-backed path, already de-duplicated by
     * `cellFlowerComponents`); `undefined` while unloaded, `null` on a load failure OR genuinely no
     * data. Cell selections fall back to a loading/empty message when this is not yet a real
     * result. */
    cellComponents?: DedupResult | null;
    /** D3(b) (Opus 5.5 eyes-on, 2026-09-24): set ONLY when `cellComponents` became `null` because
     * the fetch itself THREW (a real engine/network failure) — `undefined`/`null` for a plain "no
     * components" answer. Keeps the "genuine query failure" state textually distinct from "nothing
     * scored is selected" (`flower.ts#flowerEmptyText`'s own header explains why they must never be
     * confused). */
    cellComponentsError?: string | null;
    cellCoords?: { lon: number; lat: number };
    /** P3 fix (Opus eyes-on review, 2026-09-24, phone-06/phone-20): the phone sheet's "half" detent
     * gives this panel roughly half the viewport's own height (`sheetGeometry.ts`'s own ~46svh) --
     * the bigger flower (P round deliverable 2, size cap raised 220 -> 480) fills that budget on
     * its own and pushes the Component | Score table below the fold, unscrollable-into-view without
     * first collapsing the sheet. Set by `Shell.svelte` (the one place that knows the live sheet
     * detent); `undefined`/`false` (desktop, and the phone's "full" detent) keeps `Flower.svelte`'s
     * own bigger default untouched -- "full detent keeps the big flower" (the brief's own words). */
    compactFlower?: boolean;
    /** R4-B: the Details panel header already shows the clicked subject -- show it once. */
    subjectInHeader?: boolean;
  }

  let {
    boot,
    manifest,
    selection,
    cellComponents,
    cellComponentsError,
    cellCoords,
    compactFlower = false,
    subjectInHeader = false,
  }: Props = $props();

  /** the flower's own size cap at the phone's "half" detent (see `compactFlower`'s own header
   * above). NOT the old pre-P-round 220 -- measured live (eyes-on screenshots against a REAL cell
   * tap, whose two-line "Cell ID: … (x: …, y: …)" title costs more vertical room than the
   * default/no-selection flower's own single-line title, `e2e/scores.flower.spec.ts`'s own test
   * fixture): 220 left only the table's HEADER row above the fold, not an actual data row. 170
   * leaves real room to spare for both. */
  const FLOWER_SIZE_HALF_DETENT = 170;

  const allKey = $derived(zoneAllKey(boot));
  // P round deliverable 2: the reference ring's own value -- `null` falls back inside Flower.svelte
  // (a manifest that has not loaded yet, or a pre-metrics release; see that function's own header).
  const maxScore = $derived(flowerMaxComponentScore(manifest));

  const title = $derived(
    selection?.kind === "cell" && cellCoords
      ? flowerTitle({ kind: "cell", cellId: selection.cellId, ...cellCoords })
      : selection?.kind === "zone"
        ? flowerTitle({ kind: "zone", name: zoneName(selection.unit, selection.key) })
        : flowerTitle(null),
  );

  function zoneName(unit: string, key: string): string {
    return paLabel(key, zoneRows(boot, unit).find((z) => z.key === key)?.name, unit);
  }

  // every path already returns ONE slot per category (`flower.ts`'s `dedupeFlowerComponents`,
  // atlas-4 fix round 2) -- `droppedLabels` is surfaced to `Flower.svelte` so it can announce the
  // drop once, rather than the data quirk silently disappearing.
  const result = $derived.by((): DedupResult | null => {
    if (selection?.kind === "zone")
      return zoneFlowerComponents(zoneRows(boot, selection.unit), selection.key);
    if (selection?.kind === "cell") return cellComponents ?? null;
    return defaultFlowerComponents(boot, allKey);
  });
  const components = $derived(result?.components ?? null);
  const droppedLabels = $derived(result?.droppedLabels ?? []);
</script>

<div class="flower-panel">
  {#if components}
    <Flower
      {title}
      titleInHeader={subjectInHeader}
      {components}
      {droppedLabels}
      {maxScore}
      size={compactFlower ? FLOWER_SIZE_HALF_DETENT : undefined}
    />
  {:else if selection?.kind === "cell" && cellComponents === undefined}
    <p class="note">Loading the cell's component scores…</p>
  {:else if cellComponentsError}
    <p class="note note--error">{flowerEmptyText(cellComponentsError)}</p>
  {:else}
    <p class="note">{flowerEmptyText()}</p>
  {/if}
</div>

<style>
  .flower-panel {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .note {
    margin: 0;
    color: var(--text-secondary);
    font-size: var(--text-sm);
  }

  /* D3(b): a genuine query failure reads visually distinct from the plain "click a cell" hint --
     never the same colour as a routine empty state. */
  .note--error {
    color: var(--text-danger);
  }
</style>
