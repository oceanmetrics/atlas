<script lang="ts">
  // atlas-6 step 4, Deliverable 6: "Copy link shows what the link carries ... and its length."
  // Over 2,000 chars: a note. Over 8,000: the simplification ladder, with a before/after the user
  // ACCEPTS -- and accepting writes the SAME simplified geometry back to #pl= (never a
  // share-only copy), so "the panel always analyses the geometry that is in the link" holds: the
  // numbers visibly update FIRST, then the (now-shorter) link is what gets copied.
  import Modal from "../lib/ui/Modal.svelte";
  import { announce } from "../lib/ui/announcer";
  import {
    fitPlacesToUrl,
    URL_LONG_MAX,
    URL_SILENT_MAX,
    type FitResult,
  } from "../lib/geo/placeCodec";
  import { hashFromPlaces } from "./model";
  import { diffSimplification, describeShareSummary, shareUrl, summarizeShare } from "./share";
  import { downloadGeoJson, placesToGeoJson } from "./download";
  import type { Place, GeomPlace } from "../lib/geo/placeCodec";
  import type { Sel } from "../lib/state/types";
  import type { SelStore } from "../lib/state/sel.svelte";
  import type { GridSpec } from "../lib/grid/grid";
  import type { FeatureCollection, Geometry } from "geojson";

  interface Props {
    open: boolean;
    onclose: () => void;
    sel: Sel;
    selStore: SelStore;
    places: Place[];
    /** Deliverable 7: counts/buckets only -- defaults to a no-op until the GA4 loader is wired
     * app-wide (analytics.ts's own header; this stays a no-op call site until that lands). */
    onShare?: (linkLength: number) => void;
    /** an instance with a release: its grid, so the simplification diff counts covered cells. */
    grid?: GridSpec | null;
    /** the "Download" GeoJSON when the caller resolves more than the generic builder can (a release's
     * zone places, named and with their polygons: `places/zoneDownload.ts`); absent, the generic one. */
    placesGeoJson?: () => FeatureCollection<Geometry | null>;
  }

  let {
    open,
    onclose,
    sel,
    selStore,
    places,
    onShare,
    grid = null,
    placesGeoJson,
  }: Props = $props();

  let fit = $state<FitResult | null>(null);
  let busy = $state(false);

  function baseLength(): number {
    // "everything in the URL that is not this #pl= value" (placeCodec.ts's own FitOptions doc) --
    // the current href already carries the CURRENT #pl=, so subtracting its length approximates
    // the rest byte-for-byte closely enough for a length ESTIMATE (never used to build a real URL).
    const current = sel.pl ?? "";
    return current ? location.href.length - current.length : location.href.length;
  }

  async function compute() {
    busy = true;
    try {
      fit = await fitPlacesToUrl(places, { baseLength: baseLength() });
    } finally {
      busy = false;
    }
  }

  $effect(() => {
    if (open) void compute();
  });

  const summary = $derived(summarizeShare(sel, places));

  /** the first geom place the ladder actually changed, for the before/after readout -- Deliverable
   * 6 asks for ONE comparison, not one per place. */
  const changedPlace = $derived.by(() => {
    if (!fit) return null;
    for (let i = 0; i < places.length; i++) {
      const before = places[i];
      const after = fit.places[i];
      if (before?.kind === "geom" && after?.kind === "geom" && before.geometry !== after.geometry) {
        return { before: before as GeomPlace, after: after as GeomPlace };
      }
    }
    return null;
  });

  const diff = $derived(
    changedPlace
      ? diffSimplification(changedPlace.before, changedPlace.after, grid ?? undefined)
      : null,
  );

  async function accept() {
    if (!fit) return;
    // the numbers visibly update FIRST (this write IS the analysed geometry from here on), THEN
    // the link is copyable -- never a share-only simplified copy diverging from #pl=. Recompute
    // from `fit.places` directly (not the `places` PROP, which updates reactively off `sel.pl` on
    // its own schedule) so `fit` reflects exactly what was just written, with no timing gap.
    selStore.set({ pl: hashFromPlaces(fit.places) });
    busy = true;
    try {
      fit = await fitPlacesToUrl(fit.places, { baseLength: baseLength() });
    } finally {
      busy = false;
    }
    announce("Simplified. The numbers above now match the link.");
  }

  // Fix round 1 (Opus review): build the link from `fit.hash`, NEVER `location.href` verbatim --
  // `fitPlacesToUrl` can report `status: "ok"`/`"long"` with `simplified: true` (a rung had to run
  // to reach that length), and `location.href` still carries the ORIGINAL, unsimplified `#pl=`
  // until `accept()` writes it back. Copying `location.href` in that case would copy a link far
  // longer than the "length" this dialog just showed.
  async function copyLink() {
    if (!fit) return;
    const url = shareUrl(location.href, sel.pl, fit.hash);
    try {
      await navigator.clipboard.writeText(url);
      onShare?.(fit.length);
      announce("Link copied to your clipboard.");
    } catch {
      announce("Couldn't copy the link automatically — copy it from the address bar.");
    }
  }

  function download() {
    downloadGeoJson(placesGeoJson ? placesGeoJson() : placesToGeoJson(places));
    announce("Downloaded places as GeoJSON.");
  }
</script>

<Modal {open} title="Share" {onclose}>
  <p class="summary">{describeShareSummary(summary)}</p>

  {#if busy || !fit}
    <p class="status">Checking the link length…</p>
  {:else}
    <p class="length" class:length--long={fit.status !== "ok"}>
      Link length: {fit.length.toLocaleString("en-US")} characters
      {#if fit.status === "ok" && fit.length > URL_SILENT_MAX}
        (long link)
      {/if}
    </p>

    <!-- Fix round 1 (Opus review): branch on `fit.simplified` BEFORE `fit.status` -- a rung of
         the ladder can already have run to reach "ok" or "long" (fitPlacesToUrl tries a rung,
         then re-checks the status against the SAME thresholds), and in that case the geometry on
         screen (`#pl=`) is still the ORIGINAL, unsimplified one until `accept()` runs. Showing the
         plain "Copy link"/"Copy anyway" buttons in that state would let a person copy a link whose
         `#pl=` doesn't match the length just displayed -- the ladder must render whenever
         `simplified` is true, whatever the status ended up being. (`status === "upload"` never
         coexists with `simplified: true` -- fitPlacesToUrl's own fallback that produces "upload"
         always passes a literal `null` tolerance -- so that branch stays separate, below.) -->
    {#if fit.simplified}
      <div class="ladder" role="group" aria-label="Simplify to fit the link">
        {#if diff}
          <p>
            Simplifying to {fit.tolerance}° would change this place from {diff.beforeVertices} to
            {diff.afterVertices} vertices ({diff.areaChangePct >= 0
              ? "+"
              : ""}{diff.areaChangePct.toFixed(2)}% area{#if diff.cellsBefore !== null && diff.cellsAfter !== null},
              {diff.cellsBefore} →
              {diff.cellsAfter} cells{/if}).
          </p>
        {/if}
        <button type="button" class="primary" onclick={accept}
          >Simplify and update the numbers</button
        >
      </div>
    {:else if fit.status === "ok"}
      <button type="button" class="primary" onclick={copyLink}>Copy link</button>
    {:else if fit.status === "long"}
      <p class="note">
        This link is over {URL_SILENT_MAX.toLocaleString("en-US")} characters — some chat apps and older
        browsers truncate very long links.
      </p>
      <button type="button" class="primary" onclick={copyLink}>Copy anyway</button>
    {:else if fit.status === "upload"}
      <p class="note">
        This place is too large to carry in a link, even simplified, and would exceed
        {URL_LONG_MAX.toLocaleString("en-US")} characters. Download it as GeoJSON and share that file
        instead — the link below names it but cannot carry its shape.
      </p>
      <button type="button" class="primary" onclick={download}>Download GeoJSON</button>
      <button type="button" onclick={copyLink}>Copy link anyway</button>
    {/if}
  {/if}
</Modal>

<style>
  .summary {
    margin: 0 0 var(--space-2);
    font-size: var(--text-sm);
    color: var(--text-secondary);
  }

  .status,
  .note {
    font-size: var(--text-sm);
    margin: 0 0 var(--space-2);
  }

  .length {
    font-size: var(--text-sm);
    margin: 0 0 var(--space-3);
  }

  .length--long {
    color: var(--text-danger);
  }

  .ladder {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  button {
    align-self: flex-start;
    height: var(--size-touch);
    padding: 0 var(--space-3);
    border: 1px solid var(--border-control);
    border-radius: var(--radius-control);
    background: none;
    color: var(--text-primary);
    cursor: pointer;
  }

  button.primary {
    background: var(--fill-accent);
    color: var(--text-on-accent);
  }
</style>
