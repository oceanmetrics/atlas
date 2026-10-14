// places/placesMap.svelte.ts -- the ONE reactive bridge between Places.svelte and the shell's
// single `composeStyle()` call (docs/map.md: "one composed style, applied with ONE
// `setStyle(diff:true)`" -- Shell.svelte, not this module, owns that call). This is a `.svelte.ts`
// module (runes allowed, same convention as `src/lib/state/sel.svelte.ts`) rather than plain state
// inside Places.svelte, because the shell's `$effect` that recomposes the style needs to react to
// it too, and a value can only be `$derived` from a rune the reader can see.
//
// Everything here is DATA the shell folds into its `selection` composeStyle input (atlas-6's scope:
// "src/lib/map/ only through composeStyle inputs and the selection layer group") -- nothing here
// ever calls `addLayer`/`setStyle`/`fitBounds`.
//
// 0.10.21 (the same-class candidate fix 1 flagged, `e2e/places.deeplink-outline.spec.ts`): this
// store ALSO owns a BASELINE restore of a selected drawn place's outline, from `sel.pl`/`sel.sel`
// alone -- `model.ts#selectedGeomPlaceGeometry`. Before this, that restore lived ONLY in
// `Places.svelte`'s own `$effect` ("the selected row's outline persists..."), which runs only
// while the Places panel is mounted (Shell.svelte loads it lazily, keyed on `activeTool ===
// "places"`, never the default tool) -- so a deep link selecting a drawn place
// (`?sel=place:0#pl=...`) with the Places tool never opened showed no outline at all, the SAME
// shape as fix 1's scores-lens bug (map state computed only inside panel-gated UI). Shell.svelte
// already instantiates this store UNCONDITIONALLY, at module scope, regardless of which tool is
// active -- mirroring `createSpeciesLens`/`createScoresLens`, this is now "a lens/place-level store
// the shell instantiates", not panel-only UI.
//
// atlas-8 review round 2, item m3: that baseline restore used to be a SECOND `$effect` writing the
// SAME `outline` state `Places.svelte`'s own "the selected row's outline persists..." effect also
// wrote (gated on `!pickOn && !drawMode`) -- two independent writers of one bucket, ordered only by
// Svelte's own effect-scheduling, the shape GATES.md already flagged for `document.title` (fixed
// there by making Shell.svelte the ONE writer). Fixed the same way: `baseline` is now a pure
// `$derived` (never an effect -- nothing to race), `interaction` is the ONE piece of `$state` a
// caller can set (pick mode's highlight, a draw's live preview -- everything `Places.svelte`'s own
// `mapStore.setOutline(...)` calls already meant), and `outline` composes them ONCE, here:
// `interaction ?? baseline`. `Places.svelte` no longer needs its own baseline-restoring effect at
// all -- clearing the interaction override (pick/draw ending) falls straight back to the baseline
// this module already tracks; see that component's own `setOutline(null)` call sites, unchanged.
// A place/pl selection change drops any STALE interaction override (a pick highlight or a draw
// preview belongs to the selection that was current when it was set): pick/draw re-assert their
// own interaction immediately if still active, through their own callbacks. `tests/places/
// placesMap.test.ts` unit-tests the precedence.
//
// That reset effect surfaced a SECOND, newly-introduced collision while wiring item M1 (scores
// clicks dispatched unconditionally, regardless of `activeTool`): a scores-lens zone click during
// an ACTIVE pick session wrote `sel=zone:...` (its own selection), which this store's reset
// effect then correctly read as "the selection changed" and cleared the pick highlight `refreshOutline()`
// had just set -- the SAME click that was supposed to extend the pick set instead erased its own
// highlight. `interactionOwned` (below) is the fix: Places.svelte sets it while pick mode or a
// draw session has an EXCLUSIVE claim on map clicks, and Shell.svelte's one `map.on("click", ...)`
// listener skips dispatching to the scores lens' `handleMapClick` while it is true -- restoring
// the SAME exclusivity the old panel-mount-bound wiring gave Places by accident, without losing
// M1's actual fix (a scores click with the Places tool merely OPEN, pick/draw NOT active, still
// works).
//
// P7 fix (0.10.46, "drawn places vanish from the map after the second draw"): `baseline` used to
// be ONE place -- `model.ts#selectedGeomPlaceGeometry(sel.pl, sel.sel)` -- so drawing (or picking,
// or selecting) a SECOND place moved the map's only visible outline onto it and dropped whatever
// was drawn just before. `baseline` is now EVERY `kind: "geom"` place in the list, ALWAYS
// (`model.ts#allGeomPlacesOutline(sel.pl)`, keyed on `sel.pl` alone -- selection no longer decides
// what is drawn), and `composeOutline` is a UNION (pick mode's own live highlight / a draw's just-
// finished preview layered ON TOP of every already-listed place), not an override. See
// `allGeomPlacesOutline`'s and `composeOutline`'s own headers in model.ts.
import type { FeatureCollection } from "geojson";
import type { SelStore } from "../lib/state/sel.svelte";
// 0.10.79 size-budget fix round: `./model` drags the whole g1 codec (`placeCodec`, ~3.3 KB gzip)
// onto the static critical path, so it is a type-only import here and the runtime module loads via
// a dynamic `import()` below (same convention as Shell.svelte's `placesModel`). Until it resolves
// the baseline is `null` and the outline is just the interaction override -- a link with places in
// the hash paints its outlines one tick after the chunk arrives, never missing.
import type { allGeomPlacesOutline as AllGeomFn, composeOutline as ComposeFn } from "./model";
import type { GazetteerLayerSpec } from "../lib/map/types";
import type { MapHandle } from "../lib/map/map";
import { createPlaceOverlays, type PlaceOverlays } from "./overlays.svelte";
import { joinCredits } from "../lib/gazetteer/config";
import { notify } from "../lib/ui/announcer";
import { createGazResolver, type GazEntry } from "./gazResolver";
import type { GazResolved } from "../lib/gazetteer/resolve";

// gazetteer-places (the `p.` place_id token, docs/gazetteer-places.md): the geometry of a place
// carried BY REFERENCE is fetched here, once per id, for the whole session -- not in Places.svelte,
// for the same reason the outline baseline lives in this store: a deep link with the Places tool
// closed must still draw the outline and credit the source. `../lib/gazetteer/resolve` (hyparquet)
// is a dynamic import(); config.ts above is dependency-free and safe in the static graph.

export interface PlacesMapStore {
  /** every `kind: "geom"` place in the list, PLUS (layered on top) an interaction override when
   * one is set -- the pick-mode highlight of a not-yet-added candidate, or a draw's just-finished
   * live preview (Deliverable 2/3). P7 (0.10.46): no longer just the selected place -- see this
   * module's own header. `null` only when there is nothing to show at all. */
  readonly outline: FeatureCollection | null;
  /** "show analysis cells" (Deliverable 2): the covered cells, each carrying `pct` (1-100) and
   * `opacity` (`pct / 100`) properties for the selection layer's data-driven fill-opacity. */
  readonly cells: FeatureCollection | null;
  /** atlas-8 review round 2, item m4: the "Show analysis cells" toggle's own on/off state, moved
   * out of `Places.svelte`'s local `$state` -- it used to read "off" after a collapse/tool-switch/
   * remount while `cells` (above) stayed painted, so the toggle and the map could disagree. Chrome
   * (never the URL), same lifetime as `outline`/`cells`. */
  readonly showCells: boolean;
  /** true while Places' pick mode or an active draw session owns map clicks EXCLUSIVELY -- see
   * this module's own header (item M1's regression). Shell.svelte reads this before dispatching a
   * click to any lens' `handleMapClick`. */
  readonly interactionOwned: boolean;
  /** sets the INTERACTION override (item m3) -- `null` releases it back to the baseline. */
  /** the gazetteer collection shown for "Pick from gazetteer" (a composeStyle `gazetteer` input);
   * `null` = off. Chrome, never the URL. */
  readonly gazetteer: GazetteerLayerSpec | null;
  /** the credit line for what gazetteer data is on the map right now (the picker's collection
   * while it is on, plus every resolved gazetteer place in the list); "" when there is none. */
  readonly credits: string;
  /** WP4: the gazetteer collections toggled in the Layers panel's "Place layers" group (`?ov=`);
   * their credit line is part of `credits`. */
  readonly overlays: PlaceOverlays;
  /** state of a `p.` place's geometry fetch (reactive); `undefined` = not asked for yet. */
  gazEntry(id: string): GazEntry | undefined;
  /** the resolved analysis geometry of a `p.` place (reactive), `undefined` until it loads. */
  gazGeometry(id: string): GazResolved["geometry"] | undefined;
  /** fetch a failed `p.` place again. */
  retryGaz(id: string): void;
  setGazetteer(spec: GazetteerLayerSpec | null): void;
  setOutline(fc: FeatureCollection | null): void;
  setCells(fc: FeatureCollection | null): void;
  setShowCells(value: boolean): void;
  setInteractionOwned(value: boolean): void;
}

export interface PlacesMapDeps {
  selStore: SelStore;
  /** the live map, for the overlays' hover and click (read when needed, never captured). */
  mapHandle?: () => MapHandle | undefined;
  /** whether the "Place layers" overlays are drawn right now (default always). */
  overlaysEnabled?: () => boolean;
}

export function createPlacesMapStore(deps: PlacesMapDeps): PlacesMapStore {
  let interaction = $state<FeatureCollection | null>(null);
  let cells = $state<FeatureCollection | null>(null);
  let showCells = $state(false);
  let interactionOwned = $state(false);
  let gazetteer = $state<GazetteerLayerSpec | null>(null);
  let placeCredit = $state("");
  // bumped by the resolver on every state change: reading `gazVersion` is what makes `gazEntry`/
  // `gazGeometry` (and the baseline derived below) reactive over a plain Map.
  let gazVersion = $state(0);
  let model = $state<{
    all: typeof AllGeomFn;
    compose: typeof ComposeFn;
    ids: (pl: string | undefined) => string[];
  } | null>(null);
  void import("./model").then((m) => {
    model = {
      all: m.allGeomPlacesOutline,
      compose: m.composeOutline,
      ids: (pl) => m.gazIdsOf(m.placesFromHash(pl)),
    };
  });
  const resolver = createGazResolver({
    resolve: async (id) => (await import("../lib/gazetteer/resolve")).resolveGazPlace(id),
    onChange: () => gazVersion++,
    onError: (_id, message) =>
      notify(`${message} The place stays in your link; reload to try again.`, { tone: "error" }),
  });
  // fetch every `p.` place in the list as soon as the list names it (any tool, any panel state)
  $effect(() => {
    if (!model) return;
    void resolver.ensure(model.ids(deps.selStore.sel.pl));
  });
  // the credit for those places, once they are on the map (index/layers where published, else the
  // built-in per-authority credit -- resolve.ts#creditsForPlaces never throws)
  $effect(() => {
    void gazVersion;
    if (!model) return;
    const ids = model.ids(deps.selStore.sel.pl).filter((id) => resolver.get(id)?.status === "ok");
    if (!ids.length) {
      placeCredit = "";
      return;
    }
    let live = true;
    void import("../lib/gazetteer/resolve")
      .then((m) => m.creditsForPlaces(ids))
      .then((c) => {
        if (live) placeCredit = c;
      });
    return () => {
      live = false;
    };
  });

  // the baseline (this module's own header comment) -- a pure `$derived`, never an effect: it has
  // no side effect to race, so reading it can never disagree with a concurrent writer the way two
  // effects writing the same `$state` could.
  //
  // P7 fix ("drawn places vanish from the map after the second draw"): EVERY place in the list,
  // not just the selected row -- `model.ts#allGeomPlacesOutline`'s own header has the root cause.
  // Depends on `sel.pl` alone (never `sel.sel`): which place is selected no longer decides what is
  // drawn, only which places EXIST decides that.
  const baseline = $derived.by(() => {
    void gazVersion; // a `p.` place's geometry arriving redraws the outline
    return model ? model.all(deps.selStore.sel.pl, (id) => resolver.geometry(id)) : null;
  });
  // the overlays' own click handling must stand down while a pick/draw session owns the map
  const overlays = createPlaceOverlays({
    selStore: deps.selStore,
    mapHandle: deps.mapHandle,
    isOwned: () => interactionOwned,
    enabled: deps.overlaysEnabled,
  });
  const credits = $derived(joinCredits([gazetteer?.attribution, placeCredit, overlays.creditLine]));

  // a place/pl selection change drops any interaction override left over from a PREVIOUS
  // selection (this module header's own rule, unchanged by the P7 fix) -- `Places.svelte`'s
  // pick/draw callbacks (`refreshOutline()`, `onDrawFinish()`) re-assert a fresh one immediately
  // if still active.
  $effect(() => {
    void deps.selStore.sel.pl;
    void deps.selStore.sel.sel;
    interaction = null;
  });

  // composed ONCE, here (item m3), through the unit-tested `model.ts#composeOutline`.
  const outline = $derived(model ? model.compose(interaction, baseline) : interaction);

  return {
    get outline() {
      return outline;
    },
    get cells() {
      return cells;
    },
    get showCells() {
      return showCells;
    },
    get interactionOwned() {
      return interactionOwned;
    },
    get gazetteer() {
      return gazetteer;
    },
    get credits() {
      return credits;
    },
    get overlays() {
      return overlays;
    },
    gazEntry(id: string) {
      void gazVersion;
      return resolver.get(id);
    },
    gazGeometry(id: string) {
      void gazVersion;
      return resolver.geometry(id);
    },
    retryGaz(id: string) {
      void resolver.retry(id);
    },
    setGazetteer(spec: GazetteerLayerSpec | null) {
      gazetteer = spec;
    },
    setOutline(fc: FeatureCollection | null) {
      interaction = fc;
    },
    setCells(fc: FeatureCollection | null) {
      cells = fc;
    },
    setShowCells(value: boolean) {
      showCells = value;
    },
    setInteractionOwned(value: boolean) {
      interactionOwned = value;
    },
  };
}
