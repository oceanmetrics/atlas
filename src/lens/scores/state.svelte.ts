// atlas-4/0.10.21 fix 1 — the scores lens' MAP-INPUT ownership, split out of `ScoresLens.svelte`
// (the panel body) so it does not depend on the panel being open. Mirrors the species lens' own
// split (`src/lens/species/state.svelte.ts`): this is the ONE `.svelte.ts` wiring module — plain
// runes, no `.svelte` component imported — that derives `mapExtra` (the `composeStyle()`
// contribution: zones/raster/overlays/selection/legend) from `sel`/`boot`/`manifest`, so
// Shell.svelte can read it whenever `sel.lens === "scores"` REGARDLESS of whether the panel/sheet
// happens to have mounted `ScoresLens.svelte` at all.
//
// The bug this fixes (owner's report, live 0.10.17): `Panel.svelte` renders its children only
// while `!geometry.collapsed` (desktop only — `Sheet.svelte`'s phone body always renders, just
// CSS-hidden at "peek"), and the scores panel's body used to be the ONLY place `scoresMapInputs()`
// ever ran (a `$effect` inside `ScoresLens.svelte` writing a `bind:mapExtra` prop). Collapse the
// desktop panel and that component is never mounted at all, so `mapExtra` stays `{}` forever and
// `composeStyle()` gets `raster: null` — the score raster (and the floating legend) never paints,
// even though the map itself is fully visible.
//
// Shell.svelte loads this module the SAME way it loads `ScoresLens.svelte`/`ScoresLegend.svelte` —
// a dynamic `import()` triggered by `sel.lens === "scores"`, never by the panel/tool — so a
// species-only session still never downloads a byte of this (`tests/shell/lazy-lens-imports.test.ts`'s
// spirit, even though that scan only polices `.svelte` SFCs by name: this module pulls in
// `mapInputs.ts`/`boot.ts`/`raster.ts`/`zoneFill.ts`, which is exactly the weight D13's fix moved
// OUT of the static bundle in the first place).
//
// atlas-8 review round 2, item M1 (the SAME class of bug, moved one layer down): the click
// handler, the `sel=` selection write and the popup lived in `ScoresLens.svelte` too — mounted
// ONLY inside the panel body, so a click did nothing with the desktop panel collapsed or the
// Places tool open (species wires its click at Shell level; scores did not). `handleMapClick`
// below is that same fix applied to clicks: a lens-level owner Shell.svelte calls from its ONE
// `map.on("click", ...)` listener (mirroring `src/lens/species/state.svelte.ts#handleMapClick`),
// regardless of which tool/panel is open. usability M9: the popup opens AT ONCE with a "Loading
// value…" line (`popup.ts#cellPopupLoadingText`) and is filled in once the engine answers, rather
// than staying invisible for however long the click-to-value round trip takes (observed: no
// popup for > 3.5s).
//
// `ScoresLens.svelte` still owns everything that needs the PANEL to exist at all — the clicked
// cell's flower fetch, the species/zones table — it just READS this module's `unit`/`lyr`/
// `selection`/`mapSelection`/`showOutsidePra`/`mapExtra` instead of recomputing them, and writes
// user choices back through `selStore` exactly as before (every choice is already in the URL —
// `showOutsidePra` is the one exception, ephemeral chrome same as `Panel.svelte`'s own geometry,
// so it lives here as plain `$state` rather than round-tripping through `sel`).
import type { Popup } from "maplibre-gl";
import type { SelStore } from "../../lib/state/sel.svelte";
import type { MapHandle } from "../../lib/map/map";
import type { ChromePadding } from "../../lib/map/camera";
import { mapClick, type QueryableMap } from "../../lib/map/interaction";
import { createPopup } from "../../lib/map/popup";
import { announce } from "../../lib/ui/announcer";
import { cellFromLonLat, gridFromBoot, tileOf } from "../../lib/grid/grid";
import { effectiveLyr, effectiveUnit } from "./fallback";
import {
  cellRing,
  formatCellToken,
  formatZoneToken,
  parseScoresSelection,
  type ScoresSelection,
} from "./selection";
import { scoresMapInputs, type ScoresMapInputs, type ScoresMapState } from "./mapInputs";
import type { ManifestOverlayRow } from "./raster";
import {
  fullSubregion,
  layerByKey,
  metricLabelsFromManifest,
  primaryUnitType,
  zoneCacheKey,
  zoneKnownBounds,
  zoneRows,
} from "./boot";
import { fetchCellValue } from "./cellClick";
import { getAnalysisSources } from "./engine";
import {
  cellPopupAnnounceText,
  cellPopupLoadingText,
  cellPopupText,
  zonePopupAnnounceText,
  zonePopupText,
} from "./popup";
// R3-W7 (Ben's colour-coding ask): the popup's swatch ramp. R4-A (Ben, 2026-09-30): the
// distribution histogram lives in the LEGEND now -- whole-layer, cached by (ver, lens, layer),
// with only the marker following clicks -- see `lib/map/distribution.ts`'s header.
import { layerHistogramFor } from "../../lib/map/distribution";
import type { Histogram } from "../../lib/map/density";
import { createTitilerHistogramSource, type HistogramSource } from "../../lib/raster/histogram";
import { builtinFetchJson } from "../species/data/shards";
import { paletteStopsWithFallback } from "../../lib/raster/ramps";
import { zoneValuesFor } from "./zoneFill";
// Q1 (atlas-8 P-round, 2026-09-24): the top-bar search's "fly to the zone's own centroid" reuses
// the SAME point `places/zoneStats.ts#zoneCenterFromBoot` already computes for a zone Place's own
// "Zoom to place" (`Places.svelte`) — one reader for "where does this zone's label sit", never a
// second bbox/centroid computation invented here.
import { zoneBboxesByKeyFromFeatures, zoneCenterFromBoot } from "../../places/zoneStats";
import { zoneKeyProperty, zoneSourceId, zoneUnitsFromBoot } from "../../lib/map/layers/zones";
import { studyAreaFromBoot } from "../../lib/map/interaction";

/** the map ring's own shape — a cell's centre + half-extents (pure arithmetic on the release's
 * grid) or a zone key to outline; `ScoresMapState["selection"]`'s own type, named here so
 * `ScoresLens.svelte` does not need to import it out of `mapInputs.ts` just for this. */
export type ScoresMapSelection = ScoresMapState["selection"];

export interface ScoresLensDeps {
  selStore: SelStore;
  boot: () => unknown;
  manifest: () => unknown;
  /** the resolved release version, once `window.__early.version` settles — `handleMapClick`'s own
   * engine-backed value fetch needs it (mirrors `src/lens/species/state.svelte.ts`'s `ver` dep). */
  ver: () => string | null;
  mapHandle: () => MapHandle | undefined;
  /** P3 fix (Opus eyes-on review, 2026-09-24, phone-19/20/21 + desktop-19): the shell's CURRENT
   * chrome geometry (docked panel on desktop; sheet detent + legend chip on the phone) — mirrors
   * `src/lens/species/state.svelte.ts`'s own `chromePadding` dep (V4's fix for the SAME class of
   * bug in the species lens). A getter, not a snapshot, so `selectZone`'s bounds fit pads for
   * whatever is covering the map RIGHT NOW. Optional: a caller that supplies none (a test, the
   * gallery) keeps the old flat 40px padding via `selectZone`'s own fallback below. */
  chromePadding?: () => ChromePadding;
  /** R4-A: the legend histogram's `/cog/statistics` source; defaults to stock titiler over `fetch`.
   * Injectable so a test never touches the network. */
  histogramSource?: HistogramSource;
}

export interface ScoresLens {
  /** the release's own drawable unit type, or `"cell"` — `sel.unit` already fallen back
   * (`fallback.ts#effectiveUnit`) for an unrecognized/stale value. */
  readonly unit: string;
  /** the resolved `metric_key` — `sel.lyr` already fallen back (`fallback.ts#effectiveLyr`); never
   * `undefined` once a release's `boot` has loaded. */
  readonly lyr: string | null;
  /** `manifest.overlays`, read once here so `ScoresLens.svelte`/`LayersPanel.svelte` never derive
   * it a second time. */
  readonly manifestOverlays: readonly ManifestOverlayRow[] | null;
  /** R3 orchestrator audit item 3: `metric_key` -> the manifest's own SHORT label
   * (`boot.ts#metricLabelsFromManifest`) — read once here for the SAME reason as
   * `manifestOverlays`, so the legend title and the layer picker's `<select>` never disagree. */
  readonly metricLabels: Record<string, string>;
  /** `sel.sel` parsed (`selection.ts#parseScoresSelection`) — the selection AS THE FLOWER/SPECIES/
   * TABLE panels see it (`cell:<id>` keeps the raw cell id). */
  readonly selection: ScoresSelection;
  /** the SAME selection, reshaped into what `scoresMapInputs` needs for the map ring. */
  readonly mapSelection: ScoresMapSelection;
  /** the "cells outside Program Areas" overlay switch — ephemeral chrome (module header), never
   * written to `sel`. */
  readonly showOutsidePra: boolean;
  setShowOutsidePra(value: boolean): void;
  /** this lens' `composeStyle()` contribution — `scoresMapInputs()` is null-`boot`-safe (an empty
   * `zones`/`raster: null`/an "unavailable" legend, same as `ScoresLens.svelte`'s own effect
   * produced before this fix, before `boot` has ever loaded), so this is never `undefined`. */
  readonly mapExtra: ScoresMapInputs;
  /** item M1's fix: the click → selection → popup path, owned here so it runs with no panel
   * mounted at all (a collapsed desktop panel, or the Places tool open). Shell.svelte calls this
   * from its ONE `map.on("click", ...)` listener; self-guards on `sel.lens !== "scores"`, same as
   * `src/lens/species/state.svelte.ts#handleMapClick`. */
  handleMapClick(
    lngLat: { lng: number; lat: number },
    point: { x: number; y: number },
  ): Promise<void>;
  /** Q1 (top-bar search, item 1): select a zone found by `search.ts#matchZones` — the SAME `sel`
   * write a map click resolves to when the current spatial unit already IS `unit` (`formatZoneToken`
   * +, for the release's own SELECTABLE unit only, `sel.unit` too — see the impl's own header for
   * why the two fields differ from a real click's write). Flies the camera to the zone's own
   * centroid and opens the SAME popup a click on it would. */
  selectZone(unit: string, key: string): void;
  /** Q1 (top-bar search, item 2): select the cell at `lon`/`lat` — the SAME `sel` write/popup path
   * as `handleMapClick`'s cell branch, plus a camera fly-to (a real click is already looking at the
   * point it resolves; a typed coordinate is not). `false` when the point falls outside this
   * release's grid (no boot yet, or genuinely off-grid) — the caller reports "no match", never a
   * throw. */
  selectCoordinate(lon: number, lat: number): Promise<boolean>;
  /** W6 ("Regions move into the Search bar", Ben 2026-09-25): select a whole-study-area REGION
   * found by `search.ts#matchRegions`/`defaultRegions` — exactly what the (now-removed) Layers
   * pane "Zoom to region" select did: `selStore.set({area: key, map: undefined})`, and Shell.svelte's
   * own `sel.area` effect (`camera.ts#shouldFlyToArea`) owns the fly, never this method directly —
   * D7's own rule ("the study area is a camera, never a filter") stands: this never touches `sel.sel`
   * or any raster/legend input. */
  selectRegion(key: string): void;
}

/** owner review item 1 (live 0.10.62): `selectZone`'s real bbox fallback -- queries the zone's OWN
 * polygon off the SAME PMTiles vector-tile source `map/layers/zones.ts` already composes into the
 * style for every unit (never a second geometry fetch), so a Program-Area search pick can fly to
 * its true extent even though no published release carries `label_pt` (`zoneCenterFromBoot`'s own
 * header). R3-B14/C3: `selectZone` tries `zoneBboxFromBoot` (`./boot.ts`, a PUBLISHED bbox, needs
 * no map handle or loaded tile) first -- this stays the fallback for a release that does not
 * publish one, which is every release today.
 *
 * W6 fix (Ben's live-site report, 2026-09-25): "a SECOND Program-Area search pick does not zoom."
 * This USED to query `querySourceFeatures` FILTERED to the one key just asked for -- MapLibre only
 * answers that from tiles loaded for the CURRENT viewport, and the first pick's own `flyToBounds`
 * had already zoomed the camera in tight on the first zone, so the second zone's tile (elsewhere on
 * the map, never visited) was never requested and the filtered query came back empty every time
 * after the first — reproduced exactly with the e2e fixture (two far-apart Program Areas): pick 1
 * zooms, pick 2 does not, matching the live report. The first pick only ever "worked" because the
 * app's initial wide default camera happens to have every Program Area's outline already loaded
 * (`layerStack.ts`'s "Outlines" group is always-on chrome).
 *
 * The fix: query UNFILTERED (`zoneBboxesByKeyFromFeatures`, `places/zoneStats.ts`) and cache EVERY
 * key the query happens to see, not just the one asked for -- so whichever zones were loaded at the
 * moment of the FIRST query (normally all of them, at the initial wide camera) are cached for every
 * LATER pick, with no live query needed at all. `zoneBoundsCache` is created once per
 * `createScoresLens()` call (this module's own header: "runs exactly ONCE per page load"), so it is
 * a real, page-lifetime cache, not just relief for the one call that populates it. */
function refreshZoneBoundsCache(
  cache: Map<string, [[number, number], [number, number]]>,
  handle: MapHandle,
  boot: unknown,
  unit: string,
): void {
  const spec = zoneUnitsFromBoot(boot).find((u) => u.unit === unit);
  if (!spec) return;
  let features: { properties?: Record<string, unknown> | null; geometry: never }[];
  try {
    // UNFILTERED: every feature of this unit's source-layer currently loaded, whichever zones
    // that happens to include — never a second geometry fetch, and never a throw when the source
    // is not added/loaded yet (a search pick before the map/style has finished loading).
    features = handle.map.querySourceFeatures(zoneSourceId(unit), {
      sourceLayer: spec.sourceLayer,
    }) as never;
  } catch {
    return;
  }
  const found = zoneBboxesByKeyFromFeatures(features, zoneKeyProperty(unit));
  for (const [key, bounds] of found) {
    const cacheKey = zoneCacheKey(unit, key);
    if (!cache.has(cacheKey)) cache.set(cacheKey, bounds);
  }
}

export function createScoresLens(deps: ScoresLensDeps): ScoresLens {
  let showOutsidePra = $state(false);

  const manifestOverlays = $derived(
    (deps.manifest() as { overlays?: ManifestOverlayRow[] } | null)?.overlays ?? null,
  );
  const metricLabels = $derived(metricLabelsFromManifest(deps.manifest()));

  const unit = $derived(effectiveUnit(deps.selStore.sel.unit, deps.boot()));
  const lyr = $derived(effectiveLyr(deps.selStore.sel.lyr, deps.boot()));

  const selection: ScoresSelection = $derived(parseScoresSelection(deps.selStore.sel.sel));

  const mapSelection: ScoresMapSelection = $derived.by(() => {
    if (!selection) return null;
    if (selection.kind === "zone") return selection;
    try {
      return { kind: "cell" as const, ...cellRing(selection.cellId, gridFromBoot(deps.boot())) };
    } catch {
      return null; // no boot.grid yet (Tier 0 hasn't loaded) — draw no ring rather than throw
    }
  });

  // R4-A: the Raster-cells layer's WHOLE-layer histogram (display-only `/cog/statistics`, owner
  // decision D4) and the last click's value for the legend marker. The histogram is keyed by
  // (ver, lens, layer) -- never by a click -- and `null` (loading, failed, tiler down) draws the
  // ramp alone. The marker is remembered with the layer/unit it was clicked on, so switching
  // either drops it rather than drawing a stale line on a different scale.
  const histogramSource = deps.histogramSource ?? createTitilerHistogramSource(builtinFetchJson);
  let rasterHistogram = $state<Histogram | null>(null);
  let clickMarker = $state<{ lyr: string; unit: string; value: number } | null>(null);
  const marker = $derived(
    clickMarker && clickMarker.lyr === lyr && clickMarker.unit === unit ? clickMarker.value : null,
  );
  function setMarker(value: number | null | undefined): void {
    clickMarker =
      lyr && value !== null && value !== undefined && Number.isFinite(value)
        ? { lyr, unit, value }
        : null;
  }

  // this factory runs from an async `import().then()` in Shell.svelte, OUTSIDE any component
  // initialisation, where a bare `$effect` throws `effect_orphan` -- so it gets its own root, whose
  // lifetime is the page's (the factory runs exactly once per page load).
  $effect.root(() => {
    $effect(() => {
      const ver = deps.ver();
      const boot = deps.boot();
      const layerKey = lyr;
      if (!ver || !boot || !layerKey || unit !== "cell") {
        rasterHistogram = null;
        return;
      }
      const layer = layerByKey(boot, layerKey);
      const full = layer ? fullSubregion(layer) : null;
      if (!full?.cog || !full.rescale) {
        rasterHistogram = null;
        return;
      }
      let cancelled = false;
      rasterHistogram = null; // never show the previous layer's shape while this one loads
      void layerHistogramFor(histogramSource, {
        ver,
        lens: "scores",
        layer: layerKey,
        cogUrl: full.cog,
        range: full.rescale,
      }).then((h) => {
        if (!cancelled) rasterHistogram = h;
      });
      return () => {
        cancelled = true;
      };
    });
  });

  const mapExtra: ScoresMapInputs = $derived.by(() =>
    scoresMapInputs({
      rasterHistogram,
      marker,
      boot: deps.boot(),
      overlays: manifestOverlays,
      unit,
      lyr,
      palette: deps.selStore.sel.pal,
      showOutsidePra,
      selection: mapSelection,
      metricLabels,
    }),
  );

  // --- item M1 / usability M9: the click -> selection -> popup path, owned here so it runs with
  // no panel mounted at all -- plain module state (a MapLibre popup is DOM/MapLibre state, not
  // something a template reads; mirrors species' `state.svelte.ts` own `mapLibrePopup`).
  let mapLibrePopup: Popup | null = null;
  let popupToken = 0;

  // W6 fix: `selectZone`'s persistent, page-lifetime bbox cache (see `refreshZoneBoundsCache`'s
  // own header above for the bug this closes) — a plain Map, not SvelteMap: internal bookkeeping
  // only, never read from a template/`$derived`, so nothing needs Svelte's reactive wrapper to
  // track mutations to it (`Toast.svelte`'s own `timers` map follows the same rule).
  // eslint-disable-next-line svelte/prefer-svelte-reactivity
  const zoneBoundsCache = new Map<string, [[number, number], [number, number]]>();

  function clearPopup(): void {
    mapLibrePopup?.remove();
    mapLibrePopup = null;
  }

  function showPopup(
    lngLat: { lng: number; lat: number },
    html: string,
    announceText: string,
  ): void {
    const handle = deps.mapHandle();
    clearPopup();
    if (!handle) return;
    mapLibrePopup = createPopup()
      .setLngLat([lngLat.lng, lngLat.lat])
      .setHTML(html)
      .addTo(handle.map);
    announce(announceText);
  }

  /** usability M9: replaces the CURRENT popup's content in place (no flicker of remove+add) when
   * it is still the one this click opened; falls back to a fresh `showPopup` if it was cleared
   * meanwhile (Esc, or a later click already superseded it and cleared it first). */
  function updatePopup(
    lngLat: { lng: number; lat: number },
    html: string,
    announceText: string,
  ): void {
    if (mapLibrePopup) {
      mapLibrePopup.setHTML(html);
      announce(announceText);
    } else {
      showPopup(lngLat, html, announceText);
    }
  }

  // the Esc-closes-the-popup shortcut (fix list #12's own rule, moved here so it works with no
  // panel mounted) -- a plain, app-lifetime listener: this factory runs exactly ONCE per page load
  // (Shell.svelte instantiates it once, whenever `sel.lens` first becomes "scores", and never
  // discards it -- see this module's own header), the same lifetime `document` itself has.
  document.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      clearPopup();
      clickMarker = null; // the legend marker follows the popup it belongs to
    }
  });

  /** builds the whole zone popup (HTML + announce text) for `zone`, over `zRows` -- the ONE place
   * every zone-popup call site (a real click, the two search-pick paths) resolves the clicked
   * zone's own value once, and reuses it for the popup's ramp swatch AND the legend marker
   * (R4-A: the histogram itself is the legend's, built from the same `boot.zones` values). */
  function buildZonePopup(
    zRows: ReturnType<typeof zoneRows>,
    zone: { unit: string; key: string; name: string },
  ): { html: string; announceText: string } {
    const zoneValue = lyr
      ? zoneValuesFor(zRows, lyr).find((v) => v.key === zone.key)?.value
      : undefined;
    const bootObj = deps.boot() as { palettes?: unknown } | null | undefined;
    const stops = lyr ? paletteStopsWithFallback(bootObj, deps.selStore.sel.pal) : null;
    setMarker(zoneValue);
    return {
      html: zonePopupText({ zones: zRows, lyr, zone, stops }),
      announceText: zonePopupAnnounceText({ zones: zRows, lyr, zone }),
    };
  }

  async function showCellPopup(
    cellId: number,
    lngLat: { lng: number; lat: number },
    center: { lon: number; lat: number },
    token: number,
    prevSel: string | undefined,
  ): Promise<void> {
    const bootObj = deps.boot() as Record<string, unknown>;
    const ver = deps.ver();
    let value: number | null = null;
    try {
      if (ver && lyr) {
        const grid = gridFromBoot(bootObj);
        const tile = tileOf(cellId, grid);
        const sources = await getAnalysisSources(ver, bootObj);
        value = await fetchCellValue(sources, { cellId, tile, metricKey: lyr });
      }
    } catch {
      value = null; // no engine / no tile for this cell (off-grid, unscored) — "no value", not a throw
    }
    if (token !== popupToken) return; // a later click superseded this one
    // R3/D4 (Opus 5.5 eyes-on, 2026-09-24): the manifest's own SHORT per-metric label
    // (`metricLabels`, `boot.ts#metricLabelsFromManifest`) — `boot.layers[].label` is the LONG
    // description text ("Primary productivity: Oregon State Vertically Generalized Production
    // Model (VGPM)..."), which used to print verbatim in a one-line popup. Falls back to the long
    // label, then the bare metric_key, exactly as before, when a release's manifest has not
    // published a short name for this metric yet.
    const layer = layerByKey(bootObj, lyr);
    const label = (lyr && metricLabels[lyr]) || layer?.label || lyr || "value";
    // R3-W7: the SAME ramp the raster tile itself is painted with (`raster/ramps.ts`'s own
    // fallback-aware lookup, never a guessed colour) -- `fullSubregion(layer)?.rescale` is the
    // manifest's own [min, max] band, the SAME one `scoreRasterSpec`/`rasterLegend` (mapInputs.ts)
    // already read for this exact layer.
    const rescale = layer ? fullSubregion(layer)?.rescale : undefined;
    const rampStops = paletteStopsWithFallback(bootObj, deps.selStore.sel.pal);
    const ramp =
      rescale && rampStops ? { stops: rampStops, min: rescale[0], max: rescale[1] } : null;
    // R3-B3 (Opus eyes-on review, 2026-09-25): the popup used to print the raw CLICK point
    // (lngLat, wherever the pointer landed inside the cell) while the flower panel's own title
    // printed the CELL CENTRE (`ScoresLens.svelte`'s `cellCoords`, itself `mapSelection`'s
    // `cellRing()` result) — the same cell read two different coordinate pairs depending on which
    // UI showed it. `center` (the caller's `cellRing()` result, the SAME helper the panel's
    // `mapSelection` already runs through) is now the ONE source for what a cell's coordinates
    // are; `lngLat` is kept only for the popup's own map ANCHOR (where it points on screen).
    const input = {
      cellId,
      lon: center.lon,
      lat: center.lat,
      layerLabel: label,
      value,
      ramp,
    };
    // D3(a) round 2 (orchestrator, 2026-09-24 -- fixes a regression the FIRST D3 fix introduced):
    // `handleMapClick` below now writes `sel` EAGERLY, synchronously, on click -- exactly the
    // pre-D3 behaviour -- so the URL/selection updates at once regardless of how long (or whether
    // at all) this async value confirmation takes. Gating the WRITE itself on that confirmation
    // (the original D3(a) design) coupled two different things that do not fail together: "is this
    // click on a scored cell" (fast, should never depend on the analysis engine succeeding) and
    // "what value does the popup show" (genuinely needs the engine). `e2e/scores.collapsed-panel.
    // spec.ts`'s M1 tests click a genuinely scored ocean cell in a fixture that permanently blocks
    // `.wasm` (no panel/engine can ever boot there) and still expect `sel=cell:` promptly -- the
    // ORIGINAL design could never satisfy that, panel-mounted or not (verified: the same fixture's
    // OTHER M1 variant, "Places tool open", failed identically, with no panel involved at all).
    //
    // The D3 UX contract survives via RETRACTION instead of a gated write: once the fetch
    // genuinely CONFIRMS no value (resolves null, or throws -- a real, prompt answer either way),
    // and nothing has changed the selection since this click's own eager write, roll `sel` back to
    // whatever it was immediately before this click (`prevSel`) -- so a no-value click still never
    // PERMANENTLY becomes the selection, matching `e2e/scores.popup.novalue.spec.ts`'s own
    // "previously selected cell stays selected" / "nothing becomes selected" assertions (both read
    // the URL only AFTER polling for the popup's own settled text, i.e. after this retraction has
    // already run). A confirmed VALUE needs no action: the eager write was already correct.
    if (value === null && deps.selStore.sel.sel === formatCellToken(cellId)) {
      deps.selStore.set({ sel: prevSel });
    }
    setMarker(value); // R4-A: the legend's marker line -- a no-value click clears it
    updatePopup(lngLat, cellPopupText(input), cellPopupAnnounceText(input));
  }

  /** `selectZone`'s own "we have real bounds, go" step -- pulled out so the R3-CI idle retry below
   * calls the EXACT same fly+popup code the immediate attempt does, never a second hand-written
   * copy. `bounds` is null only for the "no polygon, but a published label point" branch (still a
   * real center, no camera-fit box to pad for -- unchanged from before this fix). */
  function flyToZoneCenter(
    handle: MapHandle,
    bounds: readonly [readonly [number, number], readonly [number, number]] | null,
    center: { lon: number; lat: number },
    hit: { unit: string; key: string; name: string },
    zRows: ReturnType<typeof zoneRows>,
  ): void {
    // R3-W7: the popup goes through the SAME shared builder (colour swatch) a real map
    // click uses, not the bare `zonePopupText`/`zonePopupAnnounceText` pair this helper called
    // directly before W7's unified popup template landed.
    const popup = buildZonePopup(zRows, hit);
    if (bounds) {
      // P3 fix (Opus eyes-on review, 2026-09-24): a flat 40px padding ignored the sheet/panel
      // actually covering the map — a Program Area search pick landed under the phone sheet
      // (GAA a sliver at its edge, popup on the map showing Arkansas) or a third under the
      // docked desktop panel. `deps.chromePadding()`, when the shell supplies it, is the SAME
      // live asymmetric-padding path the species lens' bounds fit already uses (V4 fix,
      // `src/lens/species/state.svelte.ts`).
      const padding = deps.chromePadding ? deps.chromePadding() : 40;
      // `bounds` may be a `readonly` tuple (`zoneKnownBounds`'s own return type); `flyToBounds`
      // only ever reads it, never mutates in place (it copies into its own mutable local first --
      // see `map.ts`), so the cast is a type-shape formality, not an escape from that rule.
      handle.flyToBounds(bounds as [[number, number], [number, number]], { padding });
    } else {
      // zoom 6, the SAME literal `Places.svelte#zoomTo`'s own "zone" branch flies a
      // Program-Area place to — "zoomed out just enough to see a Program Area's own extent".
      handle.flyTo({ key: "place", lon: center.lon, lat: center.lat, zoom: 6 });
    }
    showPopup({ lng: center.lon, lat: center.lat }, popup.html, popup.announceText);
  }

  /**
   * R3-CI regression fix (CI run 36158947685, webkit 3/3): `selectZone`'s bounds resolution used to
   * get exactly one synchronous attempt, at the instant Enter was pressed, with no way to recover
   * from a live tile query that missed only because the zones PMTiles layer's tiles had not
   * finished loading/parsing yet (`boot.ts#zoneKnownBounds`'s own header has the full root cause).
   * This retries that SAME resolution once more, after the map's next `"idle"` (bounded by a
   * fallback timer so a genuinely stuck/offline tile request cannot hang it forever — the same
   * shape `report/reportMap.ts#waitForIdle` already uses for the identical class of race, kept as
   * its own small copy here rather than a cross-import: `places/zoneStats.ts`'s own header already
   * documents the "never import `src/lens/**` into `places/`" rule, and the inverse — `lens/scores`
   * reaching into `report/`, a leaf module reached only via a dynamic `import()` from `report.html`
   * — would be a new, backwards coupling for one four-line wait).
   *
   * Guarded so a stale retry can never fly the camera out from under a LATER selection: if the
   * user has since picked something else (another zone, a cell, a coordinate — `sel.sel` no longer
   * names this exact zone) by the time the retry resolves, it does nothing.
   */
  async function retryZoneFlyAfterIdle(
    handle: MapHandle,
    boot: unknown,
    unit: string,
    key: string,
    hit: { unit: string; key: string; name: string },
    zRows: ReturnType<typeof zoneRows>,
  ): Promise<void> {
    await new Promise<void>((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        resolve();
      };
      handle.map.once("idle", finish);
      setTimeout(finish, 1500); // a fallback bound, never an unresolved promise
    });
    if (deps.selStore.sel.lens !== "scores") return; // navigated away from Scores entirely
    if (deps.selStore.sel.sel !== formatZoneToken(unit, key)) return; // superseded by a later pick
    const freshHandle = deps.mapHandle();
    if (!freshHandle) return;
    refreshZoneBoundsCache(zoneBoundsCache, freshHandle, boot, unit);
    const bounds = zoneKnownBounds(boot, unit, key, zoneBoundsCache);
    if (!bounds) return; // still nothing -- this zone genuinely has no cached/published geometry
    const center = {
      lon: (bounds[0][0] + bounds[1][0]) / 2,
      lat: (bounds[0][1] + bounds[1][1]) / 2,
    };
    flyToZoneCenter(freshHandle, bounds, center, hit, zRows);
  }

  return {
    get unit() {
      return unit;
    },
    get lyr() {
      return lyr;
    },
    get manifestOverlays() {
      return manifestOverlays;
    },
    get metricLabels() {
      return metricLabels;
    },
    get selection() {
      return selection;
    },
    get mapSelection() {
      return mapSelection;
    },
    get showOutsidePra() {
      return showOutsidePra;
    },
    setShowOutsidePra(value: boolean) {
      showOutsidePra = value;
    },
    get mapExtra() {
      return mapExtra;
    },

    async handleMapClick(
      lngLat: { lng: number; lat: number },
      point: { x: number; y: number },
    ): Promise<void> {
      if (deps.selStore.sel.lens !== "scores") return;
      const handle = deps.mapHandle();
      if (!handle) return;
      let grid;
      try {
        grid = gridFromBoot(deps.boot());
      } catch {
        return; // no boot.grid yet
      }
      // maplibre-gl's own .d.ts wants a `Point` class instance where `QueryableMap`
      // (interaction.ts, deliberately narrow for testability) accepts a plain `{x,y}` — a real Map
      // satisfies it at runtime (this IS how `queryRenderedFeatures` is documented to be called),
      // so this is a type-shape cast, not a behaviour change.
      const queryable = handle.map as unknown as QueryableMap;
      const result = mapClick(queryable, lngLat, point, { grid, units: mapExtra.zones ?? [] });
      const token = ++popupToken;
      clearPopup(); // closes on the next click, whatever it resolves to
      if (unit === "cell") {
        if (result.cellId !== null) {
          // D3(a) round 2 (orchestrator, 2026-09-24): `sel` is written EAGERLY here, before the
          // click's value is even known — restored to the pre-D3 behaviour, and for the same
          // reason: the URL/selection must never depend on the analysis engine settling (see
          // `showCellPopup`'s own header for the regression this fixes and why). `prevSel` is
          // captured first so `showCellPopup` can retract cleanly to exactly what was selected
          // before, not just clear it, once it confirms this cell carries no value.
          // usability M9: open at once, never wait on the engine — showCellPopup replaces this in
          // place once it answers.
          const prevSel = deps.selStore.sel.sel;
          deps.selStore.set({ sel: formatCellToken(result.cellId) });
          // R3-B3: the cell CENTRE (same `cellRing()` helper `mapSelection`/the flower panel's
          // `cellCoords` already use), not the click point — see `showCellPopup`'s own comment.
          const center = cellRing(result.cellId, grid);
          showPopup(
            lngLat,
            cellPopupLoadingText({ cellId: result.cellId, lon: center.lon, lat: center.lat }),
            "Loading value…",
          );
          void showCellPopup(result.cellId, lngLat, center, token, prevSel);
        }
      } else if (result.zone) {
        deps.selStore.set({ sel: formatZoneToken(result.zone.unit, result.zone.key) });
        const zRows = zoneRows(deps.boot(), result.zone.unit);
        const popup = buildZonePopup(zRows, result.zone);
        showPopup(lngLat, popup.html, popup.announceText);
      }
    },

    // Q1 (top-bar search, item 1): `ScoresSearch.svelte`'s "pick a zone" — the search field has no
    // screen point to query features at (nothing has been clicked), so this builds the SAME `sel`
    // write and popup a map click resolves to directly from the matched zone's own key, rather than
    // routing through `mapClick`'s screen-point query.
    selectZone(unit: string, key: string): void {
      if (deps.selStore.sel.lens !== "scores") return;
      clearPopup();
      const boot = deps.boot();
      // "same sel fields: unit + selected zone" (brief): a real map click never rewrites `sel.unit`
      // because it only ever resolves a ZONE when `sel.unit` already equals it — the precondition
      // IS the current spatial-unit selection. Search has no such precondition (it can be invoked
      // from "Raster cells" mode too), so it sets `unit` explicitly for the release's own
      // SELECTABLE unit only (never for a subregion/ecoregion match — D17: neither is ever a valid
      // `sel.unit`, and `fallback.ts#effectiveUnit` would just clamp it back to "cell" anyway).
      const patch: { sel: string; unit?: string } = { sel: formatZoneToken(unit, key) };
      if (unit === primaryUnitType(boot)) patch.unit = unit;
      deps.selStore.set(patch);

      const zRows = zoneRows(boot, unit);
      const hit = { unit, key, name: zRows.find((z) => z.key === key)?.name ?? key };
      const handle = deps.mapHandle();
      // owner review item 1 (live 0.10.62, "entering a Program Area should zoom to it, like it
      // already zooms to lon,lat"): `zoneCenterFromBoot` needs `label_pt`, which no published
      // release carries (docs/parity.html's own known gap), so this always fell through to the
      // announce-only branch below in production. `zoneBoundsFromMap` (below) is the real fix --
      // the zone's OWN polygon, queried live off the map — tried second; `zoneCenterFromBoot`
      // stays as the last-resort fallback for the day a release does publish `label_pt`.
      //
      // R3-B14/C3: a PUBLISHED `boot.zones[unit][*].bbox` (`zoneBboxFromBoot`) is tried FIRST,
      // ahead of the cache/live map query -- it needs no map handle and no already-loaded tile, so
      // a Program-Area search pick zooms correctly even far outside the current view (the gap
      // V1/owner review item 1's own header names: "a zone far outside the current view can fall
      // back to the announce-only path"). No published release carries `bbox` yet (msens will,
      // R3-C3), so the cache/live-query path stays the effective one until then.
      //
      // W6 fix: the CACHE (`zoneBoundsCache`, populated by any earlier `refreshZoneBoundsCache`
      // call — including this one, below, on a miss) is tried next, ahead of a fresh live query --
      // this is what makes a SECOND pick zoom (see `refreshZoneBoundsCache`'s own header).
      const cacheKey = zoneCacheKey(unit, key);
      if (!zoneBoundsCache.has(cacheKey) && handle) {
        refreshZoneBoundsCache(zoneBoundsCache, handle, boot, unit);
      }
      const bounds = zoneKnownBounds(boot, unit, key, zoneBoundsCache);
      const center = bounds
        ? { lon: (bounds[0][0] + bounds[1][0]) / 2, lat: (bounds[0][1] + bounds[1][1]) / 2 }
        : zoneCenterFromBoot(boot, unit, [key]);
      if (handle && center) {
        flyToZoneCenter(handle, bounds, center, hit, zRows);
        return;
      }
      // no published bbox, no published label point, and NOTHING cached yet from a live tile
      // query (or no map yet) — announce now (a search pick must never go silently unanswered),
      // but if a map handle exists, ALSO retry the live query once more after the map settles.
      //
      // R3-CI (CI run 36158947685, webkit 3/3, "Enter flies the camera into the Aleutian Arc's own
      // polygon bbox"): before this retry, the ABOVE was the only attempt, ever — a real,
      // timing-dependent race, not a geometry bug (`boot.ts#zoneKnownBounds`'s own header has the
      // full root cause: `querySourceFeatures` only answers from tiles that have already finished
      // BOTH fetch AND worker-side parse, and this whole method runs the instant Enter is pressed,
      // with no guarantee the zones layer's tiles are parsed yet). A script pressing Enter
      // immediately after the map object exists wins that race on a fast, idle machine almost
      // always — invisible locally and in CI's less-contended jobs — but lost it consistently on
      // CI's fully-parallel three-engine job. The retry is a SECOND, later attempt at the exact
      // same resolution (`zoneKnownBounds`), never a different one: `zoneCenterFromBoot` is not
      // re-tried (it reads only `boot`, which does not change between attempts).
      announce(zonePopupAnnounceText({ zones: zRows, lyr, zone: hit }));
      if (handle) void retryZoneFlyAfterIdle(handle, boot, unit, key, hit, zRows);
    },

    // Q1 (top-bar search, item 2): `ScoresSearch.svelte`'s "jump to a coordinate" — mirrors
    // `handleMapClick`'s cell branch (eager `sel` write, loading popup, async value fill-in/
    // retraction via `showCellPopup`) plus a camera move, which a real click never needs (the user
    // is already looking at whatever they clicked).
    async selectCoordinate(lon: number, lat: number): Promise<boolean> {
      if (deps.selStore.sel.lens !== "scores") return false;
      let grid;
      try {
        grid = gridFromBoot(deps.boot());
      } catch {
        return false; // no boot.grid yet
      }
      const cellId = cellFromLonLat(lon, lat, grid);
      if (cellId === null) return false; // off this release's grid — a fact about the point, not a throw
      const lngLat = { lng: lon, lat };
      // R3-B3: the cell CENTRE, not the typed point — same rule `handleMapClick` applies to a real
      // click (see `showCellPopup`'s own comment).
      const center = cellRing(cellId, grid);
      const token = ++popupToken;
      clearPopup();
      const prevSel = deps.selStore.sel.sel;
      deps.selStore.set({ sel: formatCellToken(cellId) });
      const handle = deps.mapHandle();
      // zoom 9: close enough to read a single 0.05 deg cell's own popup clearly, short of the
      // per-place heuristic `places/camera.ts#MAX_ZOOM` (12) reserves for a drawn place's true point
      // extent — a typed coordinate is a known location to LOOK AT, not a place being measured.
      if (handle) handle.flyTo({ key: "place", lon, lat, zoom: 9 });
      showPopup(
        lngLat,
        cellPopupLoadingText({ cellId, lon: center.lon, lat: center.lat }),
        "Loading value…",
      );
      void showCellPopup(cellId, lngLat, center, token, prevSel);
      return true;
    },

    // W6 ("Regions move into the Search bar"): the SAME write `LayersPanel.svelte`'s (now-removed)
    // "Zoom to region" select made (`ScoresLens.svelte`'s old `onAreaChange`) — `sel.area` is the
    // one field the shell-level camera effect (`Shell.svelte`, `camera.ts#shouldFlyToArea`) reads,
    // so the fly happens there, not here (D7: a study area is a camera, never a data filter — see
    // this method's own interface doc). A key the release does not publish still resolves (falls
    // back to `FULL`, `studyAreaFromBoot`'s own rule) rather than writing a URL that later 404s.
    selectRegion(key: string): void {
      if (deps.selStore.sel.lens !== "scores") return;
      const boot = deps.boot();
      const area = studyAreaFromBoot(boot, key);
      deps.selStore.set({ area: area.key, map: undefined });
      announce(`Zoomed to ${area.label ?? area.key}.`);
    },
  };
}
