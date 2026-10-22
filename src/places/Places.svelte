<script lang="ts">
  // The Places panel: the list, the gazetteer picker, draw, coordinates, upload, share/download.
  // Core logic lives in the plain modules beside this component (model.ts, recents.ts, camera.ts,
  // download.ts, gazPick.ts, draw.ts) -- this file only renders their output and wires events, per
  // CLAUDE.md ("keep core logic in an exported function ... a component just calls it").
  //
  // Every place mutation goes through `selStore.set({ pl: hashFromPlaces(next) })` -- NEVER a local
  // copy of the list -- so `#pl=` and what's rendered can never disagree (CLAUDE.md
  // "URL-is-the-view"). Status text goes through the shell's ONE shared live region
  // (e2e/shell.a11y.spec.ts's "exactly one live region" walk clicks through every rail tool,
  // including this one) -- UI-1 (round 3): every message here is USER-INITIATED (a pick, an add,
  // a remove, a download, a draw hint, an error), so every one now goes through `notify()`
  // (announces AND shows a visible toast) rather than the screen-reader-only `announce()`.
  import { onDestroy } from "svelte";
  import Icon from "../lib/ui/Icon.svelte";
  import Pill from "../lib/ui/Pill.svelte";
  import Chip from "../lib/ui/Chip.svelte";
  import Accordion from "../lib/ui/Accordion.svelte";
  import Select from "../lib/ui/Select.svelte";
  import Switch from "../lib/ui/Switch.svelte";
  import { notify } from "../lib/ui/announcer";
  import { encodePlace, type Place } from "../lib/geo/placeCodec";
  import type { Sel } from "../lib/state/types";
  import type { SelStore } from "../lib/state/sel.svelte";
  import type { MapHandle } from "../lib/map/map";
  import type { PlacesMapStore } from "./placesMap.svelte";
  import type { PlaceSummaries } from "./summary.svelte";
  import { summaryLine } from "./summary";
  import {
    addGazPlace,
    addPlace,
    duplicatePlaceAt,
    fallbackZoneLabel,
    featureCollectionOf,
    hashFromPlaces,
    isGeomOrUpload,
    MAX_PLACES,
    placesFromHash,
    removePlaceAt,
    renamePlaceAt,
    selectedPlaceIndex,
  } from "./model";
  import { approxAreaKm2 } from "./area";
  import { centerZoomForGeometry } from "./camera";
  import { installGazPick, type GazPickHandle, type GazPickMapLike } from "./gazPick";
  import {
    PLACES_ATTRIBUTION,
    PLACES_SLUG,
    PLACES_SOURCE_LAYER,
    gazetteerDataBase,
    placesTilesUrl,
  } from "../lib/gazetteer/config";
  import type { GazHit, GazPickLayer } from "../lib/gazetteer/resolve";
  import { clearRecents, loadRecents, pushRecent, recentPlace } from "./recents";
  import { downloadGeoJson, placesToGeoJson } from "./download";
  import {
    createDrawSession,
    loadTerraDraw,
    type DrawSession,
    type DrawShape,
    type FeatureId,
    type TerraDrawModules,
  } from "./draw";
  import {
    drawFeaturePlaceIndex,
    emptyDrawFeatureIndex,
    withDrawFeature,
    withoutDrawPlace,
    type DrawFeatureIndex,
  } from "./drawFeatures";
  import { densifyGeometry } from "./densify";
  import { geomPlaceFrom } from "./geomPlace";
  import CoordinateDialog from "./CoordinateDialog.svelte";
  import UploadPanel from "./UploadPanel.svelte";
  import ShareDialog from "./ShareDialog.svelte";
  import { getPlacesEngine } from "./engine";
  import { noopTrack, placeDrawParams, placeShareParams, type Track } from "./analytics";
  import type { AreaGeometry } from "../lib/geo/types";
  import type { NormalizedPlace } from "../lib/geo/upload/normalize";

  interface Props {
    sel: Sel;
    selStore: SelStore;
    mapHandle: MapHandle | undefined;
    mapStore: PlacesMapStore;
    /** WP4: the current item summarised over each place, and the "Only inside places" filter. */
    summaries?: PlaceSummaries;
    /** Deliverable 7: place_draw/place_upload/place_share, counts and buckets only. Defaults to a
     * no-op -- see analytics.ts's own header for why nothing here sends anything until the GA4
     * loader is wired app-wide. */
    track?: Track;
  }

  let { sel, selStore, mapHandle, mapStore, summaries, track = noopTrack }: Props = $props();

  const places = $derived(placesFromHash(sel.pl));
  const selectedIndex = $derived(selectedPlaceIndex(sel.sel));

  /**
   * The raw MapLibre `Map` (`docs/map.md`: "for `on`/`off` and `queryRenderedFeatures`; never for
   * `addLayer`") bridged to the narrow, test-double-friendly shape `gazPick.ts` declares -- one
   * explicit cast here rather than widening that interface to import maplibre-gl's types.
   */
  function rawMap(): GazPickMapLike | undefined {
    return mapHandle && (mapHandle.map as unknown as GazPickMapLike);
  }

  function storage(): Storage | null {
    try {
      return window.localStorage;
    } catch {
      return null;
    }
  }

  function writePlaces(next: Place[], selectIndex?: number) {
    selStore.set({
      pl: hashFromPlaces(next),
      sel: selectIndex === undefined ? sel.sel : `place:${selectIndex}`,
    });
  }

  function remember(p: Place) {
    try {
      pushRecent(storage(), encodePlace(p));
    } catch {
      /* an encode failure here must never block the mutation that already succeeded */
    }
  }

  // a pick/draw highlight used to persist on the map after this panel unmounted (a rail tool switch
  // mid session) -- releasing the interaction override is always safe (falls straight back to the
  // store's own baseline, `placesMap.svelte.ts`), so this runs unconditionally.
  onDestroy(() => {
    gazHandle?.uninstall();
    mapStore.setGazetteer(null);
    mapStore.setOutline(null);
  });

  // --- "Search the gazetteer" (WP4) -----------------------------------------------------------------
  // The places index (`places_index.parquet`, ~1 MB, every collection) is read ONCE by the
  // @oceanmetrics/places client's `search()` and searched locally; the lazy chunk and the file are only fetched when the
  // field is first focused or typed in. A hit is added BY REFERENCE (a `p.` token), exactly like a
  // click on the map.
  let query = $state("");
  let hits = $state<GazHit[]>([]);
  let searching = $state(false);
  let searched = $state(false);
  let searchError = $state<string | null>(null);
  let searchTimer: ReturnType<typeof setTimeout> | undefined;
  let searchToken = 0;
  let indexWarm = false;

  function warmIndex() {
    if (indexWarm) return;
    indexWarm = true;
    void import("../lib/gazetteer/resolve")
      .then((m) => m.searchGazetteer("", { limit: 1 }))
      .catch(() => {
        indexWarm = false; // unreachable: the next focus tries again
      });
  }

  function onQuery(value: string) {
    query = value;
    clearTimeout(searchTimer);
    searchToken++;
    if (!value.trim()) {
      hits = [];
      searched = false;
      searching = false;
      searchError = null;
      return;
    }
    searchTimer = setTimeout(() => void runSearch(value), 200);
  }

  async function runSearch(value: string) {
    const mine = ++searchToken;
    searching = true;
    try {
      const { searchGazetteer } = await import("../lib/gazetteer/resolve");
      const found = await searchGazetteer(value, { limit: 8 });
      if (mine !== searchToken) return;
      hits = found;
      searched = true;
      searchError = null;
    } catch (e) {
      if (mine !== searchToken) return;
      hits = [];
      searchError = (e as Error)?.message ?? "the gazetteer could not be reached";
    } finally {
      if (mine === searchToken) searching = false;
    }
  }

  function addHit(hit: GazHit) {
    addGazPicked({ id: hit.id, name: hit.name });
    onQuery("");
  }

  onDestroy(() => clearTimeout(searchTimer));

  // --- "Pick from gazetteer" (gazetteer-places, plan P2 item 10) ----------------------------------
  // Shows a gazetteer PMTiles collection on the map (the composeStyle `gazetteer` input, through
  // `mapStore.setGazetteer`) and adds the clicked polygon BY REFERENCE: a `p.` token carrying the
  // place_id, never the geometry (placeCodec.ts). The built-in `places` collection (NMS:*, MRGID:*,
  // PSGID:*) is always offered; the others come from layers.json, which answers 403 until it is
  // published -- then the select simply lists only `places`.
  const PLACES_LAYER: GazPickLayer = {
    slug: PLACES_SLUG,
    title: "Sanctuaries and regions",
    pmtiles: placesTilesUrl(gazetteerDataBase()),
    sourceLayer: PLACES_SOURCE_LAYER,
    attribution: PLACES_ATTRIBUTION,
  };
  let gazOn = $state(false);
  let gazLayers = $state<GazPickLayer[]>([PLACES_LAYER]);
  let gazSlug = $state(PLACES_SLUG);
  let gazHandle: GazPickHandle | undefined;
  let gazManifestAsked = false;

  function gazLayer(): GazPickLayer {
    return gazLayers.find((l) => l.slug === gazSlug) ?? PLACES_LAYER;
  }

  function showGazLayer() {
    const l = gazLayer();
    mapStore.setGazetteer({
      slug: l.slug,
      pmtiles: l.pmtiles,
      sourceLayer: l.sourceLayer,
      attribution: l.attribution,
    });
  }

  function stopGazPick() {
    gazHandle?.uninstall();
    gazHandle = undefined;
    gazOn = false;
    mapStore.setGazetteer(null);
  }

  function addGazPicked(pick: { id: string; name: string }) {
    const result = addGazPlace(places, pick.id, pick.name);
    if (!result.ok) {
      notify(result.reason ?? "Couldn't add that place.");
      return;
    }
    remember(result.places[result.places.length - 1]);
    writePlaces(result.places, result.places.length - 1);
    notify(`Added ${pick.name || pick.id} to places.`);
  }

  async function toggleGazPick() {
    if (gazOn) {
      stopGazPick();
      notify("Gazetteer picker off.");
      return;
    }
    const map = rawMap();
    if (!map) {
      notify("The map isn't ready yet.");
      return;
    }
    if (drawMode) {
      drawSession?.stop();
      drawSession = undefined;
      drawMode = null;
    }
    gazOn = true;
    showGazLayer();
    gazHandle = installGazPick(map, addGazPicked);
    notify("Gazetteer picker on. Click a place on the map to add it.");
    if (!gazManifestAsked) {
      gazManifestAsked = true;
      try {
        const { loadPickLayers } = await import("../lib/gazetteer/resolve");
        const more = await loadPickLayers();
        if (more) {
          gazLayers = [PLACES_LAYER, ...more.filter((l) => l.slug !== PLACES_SLUG)];
        } else {
          gazManifestAsked = false; // not published yet: ask again next time it is opened
        }
      } catch {
        gazManifestAsked = false; // lazy chunk failed: the built-in collection still works
      }
    }
  }

  function chooseGazLayer(slug: string) {
    gazSlug = slug;
    if (gazOn) showGazLayer();
  }

  // --- draw (Deliverable 3): terra-draw is a LAZY chunk, loaded once per panel lifetime ----------
  let drawSession: DrawSession | undefined;
  let drawModules: TerraDrawModules | undefined;
  let drawMode = $state<DrawShape | "select" | null>(null);
  let drawBusy = $state(false);
  // P9: terra-draw's own `finish` event fires on an EDIT of an already-drawn feature too (drag a
  // corner, resize, drag the whole shape), not only on a fresh draw (`draw.ts`'s own `onFinish`
  // comment) -- this maps THIS session's feature ids to the place index each one created, so
  // `onDrawFinish` can tell "a new shape" from "the same shape moved" instead of appending a
  // duplicate row every time. Scoped to one session: `ensureDrawSession` starts it fresh, `stopDraw`
  // drops it (`drawFeatures.ts`'s own header explains why nothing needs to survive past a session).
  let drawFeatures: DrawFeatureIndex = emptyDrawFeatureIndex();

  // keep the store's "who owns map clicks" flag in sync with local pick/draw state, so Shell.svelte's
  // click dispatch can skip a lens' own click handler while THIS panel has an active pick/draw
  // session claiming clicks.
  $effect(() => {
    mapStore.setInteractionOwned(gazOn || drawMode !== null);
  });

  /** Deliverable 7's `place_draw` param -- counts a vertex, never carries a coordinate. */
  function vertexCountOf(geometry: AreaGeometry): number {
    const rings = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
    return rings.reduce((n, poly) => n + poly.reduce((m, r) => m + r.length, 0), 0);
  }

  // P9: an edit of a feature THIS session already turned into a place (`onDrawFinish` below,
  // keyed by terra-draw's own feature id) updates that SAME row -- same index, same name,
  // re-analysed through `geomPlaceFrom` -- never appends a new one (the "dragging a drawn shape's
  // corner adds a duplicate place" bug, live-verified on 0.10.48).
  function editDrawnPlace(index: number, rawGeometry: AreaGeometry) {
    const existing = places[index];
    if (!existing || existing.kind !== "geom") return; // the row moved/vanished under us -- drop it
    const place = geomPlaceFrom(rawGeometry, existing.name);
    const next = places.slice();
    next[index] = place;
    writePlaces(next, index);
    mapStore.setOutline(featureCollectionOf(densifyGeometry(place.geometry)));
    notify("Place updated.");
  }

  function onDrawFinish(featureId: FeatureId, rawGeometry: AreaGeometry, isNewFeature: boolean) {
    const editIndex = isNewFeature ? undefined : drawFeaturePlaceIndex(drawFeatures, featureId);
    if (editIndex !== undefined) {
      editDrawnPlace(editIndex, rawGeometry);
      return;
    }
    const place = geomPlaceFrom(rawGeometry, `Drawn place ${places.length + 1}`);
    const result = addPlace(places, place);
    if (!result.ok) {
      notify(result.reason ?? "Couldn't add that shape.");
      return;
    }
    const index = result.places.length - 1;
    drawFeatures = withDrawFeature(drawFeatures, featureId, index);
    remember(place);
    writePlaces(result.places, index);
    track(
      "place_draw",
      placeDrawParams(vertexCountOf(place.geometry), approxAreaKm2(place.geometry)),
    );
    // Deliverable 3: "the outline is redrawn from the decoded geometry densified along lon/lat
    // lines" -- what is displayed from here on is the SAME (already analysed) geometry stored
    // above, never the raw shape terra-draw just handed back.
    mapStore.setOutline(featureCollectionOf(densifyGeometry(place.geometry)));
    drawSession?.setMode("select"); // straight into edit, so the just-drawn shape can be adjusted
    drawMode = "select";
    notify("Place drawn. Drag its corners to adjust, or use Enter coordinates for another.");
  }

  async function ensureDrawSession(): Promise<DrawSession | undefined> {
    const map = rawMap();
    if (!map) {
      notify("The map isn't ready yet.");
      return undefined;
    }
    if (drawSession) return drawSession;
    drawBusy = true;
    try {
      drawModules ??= await loadTerraDraw();
      drawSession = createDrawSession({ map, onFinish: onDrawFinish }, drawModules);
      drawFeatures = emptyDrawFeatureIndex(); // a fresh TerraDraw instance -> a fresh id namespace
      return drawSession;
    } catch {
      notify("Couldn't load the drawing tools — try Enter coordinates instead.");
      return undefined;
    } finally {
      drawBusy = false;
    }
  }

  async function startDraw(shape: DrawShape) {
    stopGazPick(); // the picker and a draw session both claim map clicks
    const session = await ensureDrawSession();
    if (!session) return;
    session.setMode(shape);
    drawMode = shape;
  }

  // "Done": the full teardown -- stop the session, drop the reference, and clear `drawMode` so the
  // click-ownership effect above releases map clicks back to the rest of the app.
  function stopDraw() {
    drawSession?.stop();
    drawSession = undefined;
    drawMode = null;
  }

  onDestroy(() => drawSession?.stop());

  // --- "Enter coordinates" (Deliverable 3's keyboard/screen-reader path) -------------------------
  let coordDialogOpen = $state(false);

  function addEnteredPlaces(entered: NormalizedPlace[]) {
    let current = places;
    let lastIndex = -1;
    for (const e of entered) {
      const place = geomPlaceFrom(e.geometry, e.name);
      const result = addPlace(current, place);
      if (!result.ok) {
        notify(result.reason ?? "Couldn't add every place — the 20-place cap was reached.");
        break;
      }
      current = result.places;
      lastIndex = current.length - 1;
      remember(place);
    }
    if (lastIndex >= 0) {
      writePlaces(current, lastIndex);
      notify(entered.length > 1 ? `Added ${entered.length} places.` : "Place added.");
    }
  }

  // --- the DuckDB engine GeoPackage upload reads through (lazy; booted on the first .gpkg) ------------
  const getEngine = () => getPlacesEngine();

  // --- the list -----------------------------------------------------------------------------------
  function kindIcon(p: Place): "places" | "draw" | "upload" {
    return p.kind === "zone" || p.kind === "gaz" ? "places" : p.kind === "geom" ? "draw" : "upload";
  }

  function rowName(p: Place): string {
    if (p.kind === "geom" || p.kind === "upload") return p.name;
    if (p.kind === "gaz") {
      const e = mapStore.gazEntry(p.id);
      return p.name || (e?.status === "ok" ? e.resolved.name : "") || p.id;
    }
    return fallbackZoneLabel(p); // a legacy zone place (older link): its keys, never a lookup
  }

  /** the geometry a place is zoomed/drawn from: a drawn or uploaded place's own, or a `p.` place's
   * once fetched (`mapStore.gazGeometry`, reactive); `null` for a legacy zone place, an upload that
   * carries none, or a gazetteer place still loading / failed. */
  function effectiveGeometry(p: Place): AreaGeometry | null {
    if (p.kind === "geom") return p.geometry;
    if (p.kind === "gaz") return mapStore.gazGeometry(p.id) ?? null;
    return null;
  }

  /** area is a fast client-side estimate (area.ts); `null` while a `p.` geometry is loading. */
  function areaOf(p: Place): number | null {
    const geometry = effectiveGeometry(p);
    return geometry ? approxAreaKm2(geometry) : null;
  }

  function fmt(n: number | null, digits = 0): string {
    return n === null ? "—" : n.toLocaleString("en-US", { maximumFractionDigits: digits });
  }

  function selectRow(i: number) {
    selStore.set({ sel: sel.sel === `place:${i}` ? undefined : `place:${i}` });
  }

  function zoomTo(p: Place) {
    if (!mapHandle) return;
    if (p.kind === "geom" || p.kind === "gaz") {
      const geometry = effectiveGeometry(p);
      if (!geometry) {
        notify("That gazetteer place is still loading — try again in a moment.");
        return;
      }
      const cz = centerZoomForGeometry(geometry);
      mapHandle.flyTo({ key: "place", lon: cz.lon, lat: cz.lat, zoom: cz.zoom });
      return;
    }
    notify("This place's geometry isn't in this session — ask for the GeoJSON to zoom to it.");
  }

  function rename(i: number, name: string) {
    const result = renamePlaceAt(places, i, name);
    if (!result.ok) {
      if (result.reason) notify(result.reason);
      return;
    }
    remember(result.places[i]);
    writePlaces(result.places);
  }

  function duplicate(i: number) {
    const result = duplicatePlaceAt(places, i);
    if (!result.ok) {
      notify(result.reason ?? "Couldn't duplicate that place.");
      return;
    }
    remember(result.places[result.places.length - 1]);
    writePlaces(result.places, result.places.length - 1);
  }

  function remove(i: number) {
    remember(places[i]);
    const next = removePlaceAt(places, i);
    // P9: a row this DRAW SESSION mapped to `i` no longer exists -- drop it and shift every later
    // mapped index down, so a later edit of an active drawn feature lands on the row it actually
    // drew instead of whatever now sits at a stale index (drawFeatures.ts's own header).
    drawFeatures = withoutDrawPlace(drawFeatures, i);
    selStore.set({
      pl: hashFromPlaces(next),
      sel: sel.sel === `place:${i}` ? undefined : sel.sel,
    });
    notify("Place removed.");
  }

  // --- footer: share / download / report ----------------------------------------------------------
  // Deliverable 6: the footer's Share opens the SAME dialog that shows the link's length and, over
  // budget, the simplification ladder -- not a bare clipboard copy (that stays the top bar's own
  // one-line convenience for the whole view, unrelated to a place's own geometry).
  let shareDialogOpen = $state(false);

  function onShareTracked(linkLength: number) {
    track("place_share", placeShareParams(linkLength));
  }

  function onDownload() {
    if (!places.length) {
      notify("No places to download yet.");
      return;
    }
    downloadGeoJson(placesToGeoJson(places, (id) => mapStore.gazGeometry(id)));
    notify(`Downloaded ${places.length} place${places.length === 1 ? "" : "s"} as GeoJSON.`);
  }

  // --- "Recent" accordion (Deliverable 1: last ten tokens, localStorage, never the only copy) -----
  let recentTokens = $state<string[]>(loadRecents(storage()));

  function refreshRecents() {
    recentTokens = loadRecents(storage());
  }

  function addBackRecent(token: string) {
    const p = recentPlace(token);
    if (!p) {
      notify("That recent place can no longer be read.");
      return;
    }
    if (places.length >= MAX_PLACES) {
      notify(`Up to ${MAX_PLACES} places at a time — remove one to add another.`);
      return;
    }
    const next = [...places, p];
    writePlaces(next, next.length - 1);
    notify("Added back from Recent.");
  }

  function onClearRecents() {
    clearRecents(storage());
    refreshRecents();
  }
</script>

<div class="places">
  <!-- one flow: Places (with its count), then "Add a place", then a footer pinned to the bottom of
       the pane. No sub-tabs. -->
  <h3 class="flow-heading" data-tour="places-heading" data-testid="places-heading">
    Places <span class="flow-count">{places.length} / {MAX_PLACES}</span>
  </h3>

  {#if !places.length}
    <p class="empty">No places yet. Add one below.</p>
  {:else}
    <ul class="place-list" aria-label="Places">
      {#each places as place, i (i)}
        {@const areaKm2 = areaOf(place)}
        <li class="place-row" class:place-row--selected={selectedIndex === i}>
          <button
            type="button"
            class="row-select"
            aria-pressed={selectedIndex === i}
            onclick={() => selectRow(i)}
          >
            <Icon name={kindIcon(place)} size={18} title={place.kind} />
            {#if isGeomOrUpload(place)}
              <input
                class="row-name"
                type="text"
                maxlength="60"
                value={rowName(place)}
                aria-label="Rename place"
                onclick={(e) => e.stopPropagation()}
                onchange={(e) => rename(i, e.currentTarget.value)}
              />
            {:else}
              <span class="row-name row-name--readonly">{rowName(place)}</span>
            {/if}
          </button>

          <span class="row-stat" title="Area">{fmt(areaKm2)} km²</span>
          {#if place.kind === "gaz" && mapStore.gazEntry(place.id)?.status === "error"}
            <span title="The gazetteer place could not be fetched"
              ><Chip label="couldn't load" /></span
            >
            <button type="button" class="chip" onclick={() => mapStore.retryGaz(place.id)}>
              Retry
            </button>
          {:else if place.kind === "gaz" && areaKm2 === null}
            <Chip label="loading…" />
          {/if}

          {#if summaries && summaries.rows[i]}
            <p class="row-summary" data-testid="place-summary">{summaryLine(summaries.rows[i])}</p>
          {/if}

          <span class="row-actions" role="group" aria-label="Place actions">
            <button type="button" aria-label="Zoom to place" onclick={() => zoomTo(place)}>
              <Icon name="search" size={16} />
            </button>
            {#if isGeomOrUpload(place)}
              <button type="button" aria-label="Duplicate place" onclick={() => duplicate(i)}>
                <Icon name="copy" size={16} />
              </button>
            {/if}
            <button type="button" aria-label="Delete place" onclick={() => remove(i)}>
              <Icon name="close" size={16} />
            </button>
          </span>
        </li>
      {/each}
    </ul>
  {/if}

  {#if summaries && (places.length || summaries.filterOn)}
    <section class="summary-bar" aria-label="Summary of the layer over your places">
      {#if summaries.subject && !summaries.unavailable}
        <p class="summary-subject">
          Showing <b>{summaries.subject}</b> over each place.
        </p>
      {/if}
      {#if summaries.unavailable}
        <p class="summary-note" role="status">{summaries.unavailable}</p>
      {:else if summaries.caveat}
        <details class="summary-caveat">
          <summary>What do these numbers mean?</summary>
          <p>{summaries.caveat}</p>
        </details>
      {/if}
      {#if summaries.mode === "hex" || summaries.filterOn}
        <div class="filter-row">
          <Switch
            label="Only inside places"
            checked={summaries.filterOn}
            variant="quiet"
            onchange={(on) => summaries.setFilter(on)}
          />
          <span>Only inside places</span>
        </div>
        {#if summaries.filterNote}
          <p class="summary-note" role="status">{summaries.filterNote}</p>
        {/if}
      {/if}
    </section>
  {/if}

  <h3 class="flow-heading flow-heading--add">Add a place</h3>

  <section class="search-bar" aria-label="Find a place in the gazetteer">
    <input
      type="search"
      class="search-input"
      aria-label="Search the gazetteer"
      placeholder="Search places, e.g. Channel Islands"
      autocomplete="off"
      value={query}
      onfocus={warmIndex}
      oninput={(e) => onQuery(e.currentTarget.value)}
    />
    {#if searching}
      <p class="search-note" role="status">Searching the gazetteer…</p>
    {:else if searchError}
      <p class="search-note" role="alert">Couldn't search the gazetteer ({searchError}).</p>
    {:else if searched && !hits.length}
      <p class="search-note">No areas match "{query.trim()}".</p>
    {/if}
    {#if hits.length}
      <ul class="hit-list" aria-label="Gazetteer results">
        {#each hits as hit (hit.id)}
          <li class="hit-row">
            <span class="hit-text">
              <span class="hit-name">{hit.name}</span>
              <span class="hit-meta">
                {[
                  hit.placeType.replace(/_/g, " "),
                  hit.collection,
                  hit.areaKm2 !== null ? `${fmt(hit.areaKm2)} km²` : "",
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </span>
            <button
              type="button"
              class="hit-add"
              aria-label={`Add ${hit.name} to Places`}
              disabled={places.length >= MAX_PLACES}
              onclick={() => addHit(hit)}
            >
              Add
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  <section class="pick-bar" aria-label="Pick from gazetteer">
    <Pill
      label="Pick from gazetteer"
      pressed={gazOn}
      disabled={!mapHandle}
      disabledReason={mapHandle ? undefined : "The map isn't ready yet."}
      onclick={toggleGazPick}
    />
    {#if gazOn && gazLayers.length > 1}
      <Select
        label="Gazetteer layer"
        value={gazSlug}
        onchange={chooseGazLayer}
        options={gazLayers.map((l) => ({ value: l.slug, label: l.title }))}
      />
    {/if}
  </section>

  <section class="draw-bar" aria-label="Draw a place" role="group">
    <button
      type="button"
      class="draw-tool"
      class:draw-tool--active={drawMode === "polygon"}
      disabled={drawBusy}
      onclick={() => startDraw("polygon")}
    >
      <Icon name="draw" size={16} />
      Polygon
    </button>
    <button
      type="button"
      class="draw-tool"
      class:draw-tool--active={drawMode === "rectangle"}
      disabled={drawBusy}
      onclick={() => startDraw("rectangle")}
    >
      Rectangle
    </button>
    <button
      type="button"
      class="draw-tool"
      class:draw-tool--active={drawMode === "circle"}
      disabled={drawBusy}
      onclick={() => startDraw("circle")}
    >
      Circle
    </button>
    {#if drawMode}
      <button type="button" class="draw-tool" onclick={stopDraw}>Done</button>
    {/if}
    <button type="button" class="draw-tool" onclick={() => (coordDialogOpen = true)}>
      Enter coordinates
    </button>
  </section>

  <UploadPanel {mapHandle} {getEngine} onAdd={addEnteredPlaces} {track} />

  <Accordion title="Recent">
    {#if !recentTokens.length}
      <p class="empty">No recent places yet.</p>
    {:else}
      <ul class="recent-list">
        {#each recentTokens as token (token)}
          {@const p = recentPlace(token)}
          {#if p}
            <li class="recent-row">
              <span
                >{p.kind === "zone"
                  ? fallbackZoneLabel(p)
                  : p.kind === "gaz"
                    ? p.name || p.id
                    : p.name}</span
              >
              <button type="button" onclick={() => addBackRecent(token)}>Add back</button>
            </li>
          {/if}
        {/each}
      </ul>
      <button type="button" class="clear-recents" onclick={onClearRecents}>Clear</button>
    {/if}
  </Accordion>

  <!-- the pinned footer: it does not scroll away (`position: sticky` to the panel body's own
       scrollport); with zero places Share/Download are disabled outright, before a click. -->
  <footer class="places-footer">
    <div class="footer-actions">
      <button type="button" disabled={!places.length} onclick={() => (shareDialogOpen = true)}>
        <Icon name="share" size={16} />
        Share
      </button>
      <button type="button" disabled={!places.length} onclick={onDownload}>
        <Icon name="download" size={16} />
        Download places
      </button>
    </div>
  </footer>

  <CoordinateDialog
    open={coordDialogOpen}
    onclose={() => (coordDialogOpen = false)}
    onAccept={addEnteredPlaces}
  />

  <ShareDialog
    open={shareDialogOpen}
    onclose={() => (shareDialogOpen = false)}
    {sel}
    {selStore}
    {places}
    onShare={onShareTracked}
  />
</div>

<style>
  .places {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .pick-bar {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex-wrap: wrap;
  }

  .summary-bar {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-2);
    border: 1px solid var(--border-control);
    border-radius: var(--radius-control);
    background: var(--surface-sunken);
  }

  .summary-bar p {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--text-secondary);
  }

  .summary-bar .summary-subject {
    color: var(--text-primary);
  }

  .summary-caveat {
    font-size: var(--text-xs);
    color: var(--text-secondary);
  }

  .summary-caveat summary {
    cursor: pointer;
  }

  .filter-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--text-sm);
  }

  .row-summary {
    flex: 1 0 100%;
    margin: 0;
    font-size: var(--text-xs);
    color: var(--text-secondary);
  }

  .search-bar {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .search-input {
    height: 32px;
    padding: 0 var(--space-3);
    border: 1px solid var(--border-control);
    border-radius: var(--radius-control);
    background: var(--surface-sunken);
    color: var(--text-primary);
    font: inherit;
    font-size: var(--text-sm);
  }

  .search-note {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--text-secondary);
  }

  .hit-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .hit-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    padding: var(--space-1) var(--space-2);
    border: 1px solid var(--border-control);
    border-radius: var(--radius-control);
  }

  .hit-text {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .hit-name {
    font-size: var(--text-sm);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .hit-meta {
    font-size: var(--text-xs);
    color: var(--text-secondary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .hit-add {
    flex: none;
    height: 28px;
    padding: 0 var(--space-3);
    border: 1px solid var(--border-control);
    border-radius: var(--radius-control);
    background: none;
    color: var(--text-primary);
    font: inherit;
    font-size: var(--text-sm);
    cursor: pointer;
  }

  .hit-add:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .draw-bar {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex-wrap: wrap;
  }

  .draw-tool {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    height: 28px;
    padding: 0 var(--space-3);
    border: 1px solid var(--border-control);
    border-radius: var(--radius-control);
    background: none;
    color: var(--text-primary);
    font: inherit;
    font-size: var(--text-sm);
    cursor: pointer;
  }

  .draw-tool--active {
    background: var(--fill-accent);
    border-color: var(--border-accent);
    color: var(--text-on-accent);
  }

  .draw-tool:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  /* Q3 item 1: the one-line reason shown IN PLACE of the "Show analysis cells" Pill for a
     selected zone place -- see the template's own comment for why this replaces the button rather
     than disabling it. */

  .empty {
    color: var(--text-secondary);
    font-size: var(--text-sm);
  }

  .place-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .place-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2);
    border: 1px solid var(--border-control);
    border-radius: var(--radius-control);
    flex-wrap: wrap;
  }

  .place-row--selected {
    border-color: var(--border-accent);
  }

  .row-select {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    flex: 1 1 auto;
    min-width: 120px;
    border: 0;
    background: none;
    padding: 0;
    color: inherit;
    font: inherit;
    cursor: pointer;
    text-align: left;
  }

  .row-name {
    font-size: var(--text-sm);
  }

  .row-name--readonly {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  input.row-name {
    border: 1px solid transparent;
    background: none;
    color: inherit;
    padding: var(--space-1);
    border-radius: var(--radius-control);
  }

  input.row-name:hover,
  input.row-name:focus {
    border-color: var(--border-control);
  }

  .row-stat {
    font-size: var(--text-sm);
    color: var(--text-secondary);
    white-space: nowrap;
  }

  .row-actions {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    margin-left: auto;
  }

  .row-actions button {
    display: inline-grid;
    place-items: center;
    width: 28px;
    height: 28px;
    border: 0;
    border-radius: var(--radius-control);
    background: none;
    color: var(--icon-muted);
    cursor: pointer;
  }

  .row-actions button:hover {
    color: var(--text-primary);
    background: var(--fill-control);
  }

  .flow-heading {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    margin: 0;
    font-size: var(--text-base, 1rem);
    font-weight: 600;
  }

  .flow-heading--add {
    margin-top: var(--space-2);
    padding-top: var(--space-3);
    border-top: 1px solid var(--divider);
  }

  .flow-count {
    font-size: var(--text-sm);
    font-weight: 400;
    color: var(--text-secondary);
  }

  /* R4-D: the Last-clicked row, pink-outlined like the map's own selection ring. */

  /* R4-D: pinned to the bottom of the pane's own scroller (`.panel-body` / the sheet body), bleeding
     through its padding so scrolled content never shows beside or under it. */
  .places-footer {
    position: sticky;
    bottom: calc(var(--space-4) * -1);
    z-index: 1;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin: 0 calc(var(--space-4) * -1) calc(var(--space-4) * -1);
    padding: var(--space-3) var(--space-4) var(--space-4);
    border-top: 1px solid var(--divider);
    background: var(--surface-panel, var(--surface-raised));
  }

  .footer-actions {
    display: flex;
    gap: var(--space-2);
    flex-wrap: wrap;
  }

  .places-footer button {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    height: var(--size-touch);
    padding: 0 var(--space-3);
    border: 1px solid var(--border-control);
    border-radius: var(--radius-control);
    background: none;
    color: var(--text-primary);
    /* R3-B6 (Opus eyes-on review, 2026-09-25): a plain `<button>` carries the browser's own
       default font, not this panel's -- every other control here (`.add-picked`, `.cap-note`,
       the chip links) already sets `var(--text-sm)` explicitly, so Share/Download places/Report
       were the one row reading visibly larger than everything around them. */
    font-size: var(--text-sm);
    cursor: pointer;
  }

  .places-footer button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .recent-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    margin: 0 0 var(--space-2);
    padding: 0;
    list-style: none;
  }

  .recent-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    font-size: var(--text-sm);
  }

  .recent-row button {
    border: 1px solid var(--border-control);
    border-radius: var(--radius-control);
    background: none;
    color: var(--text-primary);
    padding: var(--space-1) var(--space-2);
    cursor: pointer;
  }

  .clear-recents {
    border: 0;
    background: none;
    color: var(--text-secondary);
    text-decoration: underline;
    cursor: pointer;
    padding: 0;
  }
</style>
