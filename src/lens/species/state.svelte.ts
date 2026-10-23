// The species lens' reactive orchestration (atlas-5 steps 1-3). This is the ONE file in
// `src/lens/species/**` that imports svelte — every rule it applies (shard loading, deep-link
// resolution, the layer bar/card view models, the camera, the click popup) lives in the plain,
// Node-testable modules beside it (`data/*.ts`, `mapInputs.ts`, `popup.ts`); this file is wiring
// only, the same division `src/lib/state/sel.svelte.ts` documents for itself.
//
// THE JIGGER GUARD (§11.12): a deep link to a specific INPUT must never flash the merged surface
// first. `resolving` stays true from mount until the initial deep-link resolution (if any) has
// fully settled — including the `selStore.set` that writes the FINAL `sp`/`in` — and every other
// effect here refuses to run while it is true. So the very first taxon fetch this module ever makes
// already carries the resolved `in`, not the URL's naive default.
import { overlayAt } from "../../lib/map/clickInfo";
import { untrack } from "svelte";
import type { Popup } from "maplibre-gl";
import { gridFromBoot } from "../../lib/grid/grid";
import type { MapHandle } from "../../lib/map/map";
import type { CameraBoundsInput, ChromePadding, Viewport } from "../../lib/map/camera";
import {
  boundsToCameraView,
  phoneAwareWideRangeBounds,
  symmetricPadding,
} from "../../lib/map/camera";
import { createPopup } from "../../lib/map/popup";
import { announce } from "../../lib/ui/announcer";
import { mapClick, type LngLat, type QueryableMap } from "../../lib/map/interaction";
import { createTitilerValueSource, type ValueSource } from "../../lib/raster/point";
import { createTitilerHistogramSource, type HistogramSource } from "../../lib/raster/histogram";
import { layerHistogramFor } from "../../lib/map/distribution";
import type { Histogram } from "../../lib/map/density";
import { createTitilerBoundsSource, type BoundsSource } from "../../lib/raster/bounds";
import { paletteStopsFromBoot, type PaletteName } from "../../lib/raster/ramps";
import type { SelStore } from "../../lib/state/sel.svelte";
import type { Representation } from "../../lib/state/types";
import type { SessionLike } from "../../lib/release/dataBase";
import {
  cameraFor,
  cogBoundsCamera,
  cogUrlForBoundsFallback,
  refitNeeded,
  refitOnInputChange,
  studyAreaView,
  FULL_STUDY_AREA,
  DEFAULT_CAMERA_PADDING,
  type BoundsCamera,
  type Camera,
  type CameraBounds,
  type CameraKey,
} from "./data/camera";
import { documentTitle, speciesCard, type SpeciesCard } from "./data/card";
import { datasetIndex, layerBar, type DatasetIndex, type LayerBar } from "./data/layerBar";
import {
  deepLinkKey,
  resolveDeepLink,
  settleUs,
  targetOf,
  MERGED_IN,
  type DeepLinkEvent,
} from "./data/resolve";
import { defaultSpecies, loadTaxa, type TaxaIndex } from "./data/picker";
import { builtinFetchJson, loadTaxon, type ShardError, type TaxonCard } from "./data/shards";
import { DEFAULT_SPECIES_COLORMAP, speciesMapInputs, type SpeciesMapInputs } from "./mapInputs";
import { popupAnnounceText, popupContent, popupHtml, type PopupContent } from "./popup";

const EMPTY_MAP_INPUTS: SpeciesMapInputs = {
  raster: null,
  range: null,
  legend: null,
  notice: null,
  asset: null,
};

export interface NotFoundModalState {
  key: string;
  reasons: string[];
}

export interface SpeciesLensDeps {
  selStore: SelStore;
  /** the resolved release version, once `window.__early.version` settles. */
  ver: () => string | null;
  boot: () => unknown;
  session?: () => SessionLike | null;
  mapHandle: () => MapHandle | undefined;
  /** `Analytics["track"]`, injected so this module never imports `analytics.ts` directly and stays
   * testable without a GA4/gtag stack. */
  track?: (event: string, params: unknown) => void;
  fetchJson?: (url: string) => Promise<unknown>;
  valueSource?: ValueSource;
  /** D8's own last resort (`refineCameraFromCogBounds` below) — defaults to a real titiler
   * `/cog/bounds` fetch through `fetchJson`, same convention as `valueSource` above. */
  boundsSource?: BoundsSource;
  /** R4-A: the legend histogram's `/cog/statistics` source; defaults to stock titiler through
   * `fetchJson`, same convention as `boundsSource`. */
  histogramSource?: HistogramSource;
  /** V1 fix (Opus eyes-on review, 2026-09-24): the shell's CURRENT chrome geometry (docked panel
   * on desktop; sheet detent + legend chip on the phone) — a getter, not a snapshot, so every
   * re-fit (species change, "Zoom to layer") pads for whatever is covering the map RIGHT NOW, not
   * whatever it was at mount. Optional: a caller that supplies none (a test, the gallery) keeps
   * the old flat `DEFAULT_CAMERA_PADDING` behaviour via `applyCamera`'s own fallback below. */
  chromePadding?: () => ChromePadding;
  /** R3-rr fix 1, round 5 (orchestrator eyes-on, phone framing): the current viewport dimensions
   * -- needed alongside {@link isPhone} to decide whether a wide-range model's narrowed "US
   * waters" bounds are too wide for the phone (`lib/map/camera.ts#phoneAwareWideRangeBounds`) and
   * to compute "Whole range"'s own camera directly (never through MapLibre's real
   * `cameraForBounds()`, which does not reliably keep both edges of an extreme arc in frame -- see
   * `setZoomTarget`'s own header). Optional: a caller that supplies neither (a test, the gallery)
   * never substitutes and falls back to the ordinary bounds-fit path for "Whole range" too. */
  viewport?: () => Viewport;
  /** the SAME `matchMedia("(max-width: 899px)")` breakpoint `Shell.svelte` already uses -- never a
   * second breakpoint decision. */
  isPhone?: () => boolean;
}

/** R3-A1: which of a wide-range model's two framings is currently applied — `null` when the
 * current camera was never narrowed (a compact model, or no study area to narrow against), which
 * is the species card's own cue to hide the "Zoom to" toggle entirely rather than show a control
 * with only one meaningful choice. */
export type WideRangeZoom = { value: "us" | "whole" } | null;

export interface SpeciesLens {
  readonly loading: boolean;
  readonly card: TaxonCard | null;
  readonly cardError: ShardError | null;
  readonly bar: LayerBar | null;
  readonly info: SpeciesCard | null;
  readonly mapInputs: SpeciesMapInputs;
  readonly docTitle: string | null;
  readonly notFound: NotFoundModalState | null;
  readonly popup: { lngLat: LngLat; content: PopupContent } | null;
  readonly taxaIndex: TaxaIndex | null;
  readonly datasets: DatasetIndex;
  /** UI-9 (round-3 review): the resolved release id, for the not-found/error copy ("This species
   * isn't in release v7…") -- `null` before `deps.ver()` has settled. */
  readonly ver: string | null;
  readonly wideRange: WideRangeZoom;
  /** R3-W8 item 2: the "Zoom to layer on change" checkbox's own checked state — `Sel.zl !== false`. */
  readonly zoomToLayerOnChange: boolean;

  dismissNotFound(): void;
  closePopup(): void;
  ensureTaxaIndex(): Promise<TaxaIndex | null>;
  selectSpecies(key: string): void;
  selectLayer(inKey: string): void;
  setRepresentation(rep: Representation): void;
  setUsOnly(enabled: boolean): void;
  /** R3-W8 item 2: the checkbox's own writer — URL state (`Sel.zl`) so a shared link reproduces it. */
  setZoomToLayerOnChange(enabled: boolean): void;
  zoomToLayer(): void;
  /** R3-A1: the species card's "Zoom to: US waters | Whole range" toggle — ephemeral (component
   * state, not `Sel`), a no-op when {@link wideRange} is `null` (nothing to toggle between). */
  setZoomTarget(target: "us" | "whole"): void;
  handleMapClick(lngLat: LngLat, point: { x: number; y: number }): Promise<void>;
}

/** the `Sel.in` <-> "was the click resolvable at all" pairing the camera needs (data/camera.ts). */
function cameraKeyOf(sel: { sp?: string; in: string; rep: Representation }): CameraKey {
  return { sp: sel.sp, in: sel.in, rep: sel.rep };
}

function boundsInputOf(cam: Camera): CameraBoundsInput | null {
  return cam.kind === "bounds" ? cam.bounds : null;
}

export function createSpeciesLens(deps: SpeciesLensDeps): SpeciesLens {
  const { selStore } = deps;
  const fetchJson = deps.fetchJson ?? builtinFetchJson;
  const valueSource = deps.valueSource ?? createTitilerValueSource(fetchJson);
  const boundsSource = deps.boundsSource ?? createTitilerBoundsSource(fetchJson);
  const histogramSource = deps.histogramSource ?? createTitilerHistogramSource(fetchJson);
  const track = deps.track ?? (() => {});

  let bootStarted = false;
  let loggedFirstSpecies = false;
  let resolving = $state(true);
  let loading = $state(false);
  let card = $state<TaxonCard | null>(null);
  let cardError = $state<ShardError | null>(null);
  let notFound = $state<NotFoundModalState | null>(null);
  let popup = $state<{ lngLat: LngLat; content: PopupContent } | null>(null);
  let taxaIndex = $state<TaxaIndex | null>(null);
  let prevCameraKey: CameraKey | null = null;
  // R3-A1: the last camera `cameraFor()`/`zoomToLayer()` actually computed, kept around so the
  // "Zoom to" toggle can re-apply EITHER of its two framings without recomputing anything — `null`
  // (or a camera with no `wholeRangeBounds`) means the current model was never narrowed.
  let wideRangeCamera = $state<BoundsCamera | null>(null);
  let zoomTarget = $state<"us" | "whole">("us");
  // R3-W8 item 2: "a fit never runs when `sel.map` was set by the user's own pan since the last
  // pick" (Shell.svelte's own precedence rule for `sel.map`, `map.ts`'s header: `onCamera` only
  // ever fires for a REAL user gesture — every fit this module applies goes through
  // `flyTo`/`flyToBounds`, which mark their own moveend `atlasProgrammatic: true` and are filtered
  // out before they ever reach `selStore`). So any observed CHANGE of `selStore.sel.map` after the
  // first is, by construction, a genuine pan — never an echo of a fit this module itself just made.
  let pannedSincePick = false;
  let mapWatchPrimed = false;
  let taxaLoadPromise: Promise<TaxaIndex | null> | null = null;
  /** the real MapLibre popup (§6.5 step 6: "opens immediately", MapLibre's own re-anchors it on
   * pan/zoom) — plain, not `$state`: it is DOM/MapLibre state, not something a template reads. */
  let mapLibrePopup: Popup | null = null;

  function clearMapPopup(): void {
    mapLibrePopup?.remove();
    mapLibrePopup = null;
    popup = null;
    legendMarker = null; // R4-A: the legend's marker belongs to the popup it came from
  }

  const datasets: DatasetIndex = $derived(
    datasetIndex((deps.boot() as { datasets?: unknown } | null)?.datasets),
  );

  const bar: LayerBar | null = $derived.by(() => {
    const ver = deps.ver();
    if (!card || !ver) return null;
    return layerBar(card, { ver, selectedInput: selStore.sel.in, datasets });
  });

  const info: SpeciesCard | null = $derived.by(() => {
    const ver = deps.ver();
    if (!card || !ver) return null;
    return speciesCard(card, { ver, selectedInput: selStore.sel.in, datasets });
  });

  const baseMapInputs: SpeciesMapInputs = $derived.by(() => {
    const ver = deps.ver();
    if (!bar || !ver || !card) return EMPTY_MAP_INPUTS;
    return speciesMapInputs(bar, {
      rep: selStore.sel.rep,
      boot: deps.boot() as { palettes?: unknown } | null,
      ver,
      scientificName: card.sci,
      commonName: card.common,
    });
  });

  // R4-A (Ben, 2026-09-30): the legend carries the WHOLE-layer histogram (`/cog/statistics` on the
  // drawn asset's own COG, `histogram_range` = its rescale, so the bins line up with the ramp) and
  // the last click's `/cog/point` value as a marker. The histogram is cached by (ver, lens, layer),
  // never by click; a PMTiles range (presence only) has none; `null` -> the ramp alone.
  let legendHistogram = $state<Histogram | null>(null);
  let legendMarker = $state<number | null>(null);
  $effect(() => {
    const ver = deps.ver();
    const asset = baseMapInputs.asset;
    if (!ver || !card || !asset || asset.type !== "cog" || !asset.rescale) {
      legendHistogram = null;
      return;
    }
    let cancelled = false;
    legendHistogram = null; // never show the previous layer's shape while this one loads
    void layerHistogramFor(histogramSource, {
      ver,
      lens: "species",
      layer: `${card.key}|${asset.rep}|${asset.url}`,
      cogUrl: asset.url,
      range: asset.rescale,
    }).then((h) => {
      if (!cancelled) legendHistogram = h;
    });
    return () => {
      cancelled = true;
    };
  });
  const mapInputs: SpeciesMapInputs = $derived.by(() => {
    const legend = baseMapInputs.legend;
    if (legend?.kind !== "continuous") return baseMapInputs;
    return {
      ...baseMapInputs,
      legend: { ...legend, histogram: legendHistogram, marker: legendMarker },
    };
  });

  const docTitle: string | null = $derived.by(() => {
    if (!card) return null;
    // documentTitle only needs {selectedInput, datasets} — it derives the layer's own key/label
    // from `card` itself, so it stays correct even for a residual (merged: null) taxon.
    return documentTitle(card, { selectedInput: selStore.sel.in, datasets });
  });

  async function ensureTaxaIndex(): Promise<TaxaIndex | null> {
    if (taxaIndex) return taxaIndex;
    if (taxaLoadPromise) return taxaLoadPromise;
    const ver = deps.ver();
    if (!ver) return null;
    taxaLoadPromise = loadTaxa(ver, { fetchJson, session: deps.session?.() ?? null }).then(
      (res) => {
        if (res.ok) {
          taxaIndex = res.value;
          return res.value;
        }
        return null;
      },
    );
    return taxaLoadPromise;
  }

  // the release's ecoregion extent (§6.3's `er_bbox`) is not yet published anywhere this lens can
  // read (atlas-1 has not shipped it) — every `cameraFor()` call below passes `fallbackBbox: null`;
  // the fallback chain still holds without it, ending at the study-area view.

  // V1 fix (Opus eyes-on review, 2026-09-24): "the walrus model view sits under the legend chip
  // and the sheet" — `cam.padding` (below) is `cameraFor()`'s own flat `DEFAULT_CAMERA_PADDING`
  // number, which has no idea a phone sheet or a docked desktop panel is covering part of the
  // map. `deps.chromePadding()`, when the shell supplies it, is the SAME asymmetric-padding path
  // `boundsToCameraView` already shifts the fitted center for (P6/D8, camera.ts's own header) —
  // this is the one place that padding actually reaches `flyToBounds`, so wiring it here is
  // enough for every bounds fit (species-change re-fit AND "Zoom to layer" below both call this).
  function applyCamera(cam: Camera | null): void {
    const handle = deps.mapHandle();
    if (!handle || !cam) return;
    if (cam.kind === "bounds") {
      const padding = deps.chromePadding ? deps.chromePadding() : cam.padding;
      handle.flyToBounds(boundsInputOf(cam)!, { padding });
    } else {
      handle.flyTo({ key: cam.source, lon: cam.center[0], lat: cam.center[1], zoom: cam.zoom });
    }
  }

  // R3-A1: called after every FRESH `cameraFor()`/`zoomToLayer()` computation (never after a
  // manual `setZoomTarget()` re-fit, which reuses this same camera rather than recomputing it) —
  // remembers whether the model just framed is a WIDE one that got narrowed, so the species card's
  // "Zoom to" toggle knows whether it has two real choices, and resets to "US waters" (the
  // narrowed framing IS the new default fit — the same "US EEZ" section of the world scores.
  function recordWideRangeCamera(cam: Camera | null): void {
    wideRangeCamera = cam?.kind === "bounds" && cam.wholeRangeBounds ? cam : null;
    zoomTarget = "us";
  }

  // R3-rr fix 1, round 5 (orchestrator eyes-on, real e1fcfc8 build, 2026-09-25): a wide-range
  // model's narrowed "US waters" `cam.bounds` can still be far too wide to frame well at phone
  // width (live-measured: the leatherback's own bounds settled at zoom 0.78, a tiny globe mostly
  // hidden behind the sheet) -- `phoneAwareWideRangeBounds` (camera.ts) substitutes
  // `PHONE_DEFAULT_BOUNDS` when that would happen. Only ever touches a camera that already carries
  // `wholeRangeBounds` (a genuinely wide-range fit) -- an ordinary, already-compact bounds camera
  // is returned completely unchanged, `===` and all, so this is a safe no-op to call on every
  // camera the wide-range paths produce, not just the ones that need it.
  function phoneAwareCamera(cam: Camera | null): Camera | null {
    if (!cam || cam.kind !== "bounds" || !cam.wholeRangeBounds) return cam;
    const viewport = deps.viewport?.() ?? { width: 0, height: 0 };
    const padding = deps.chromePadding ? deps.chromePadding() : undefined;
    const isPhone = deps.isPhone?.() ?? false;
    const bounds = phoneAwareWideRangeBounds(
      cam.bounds,
      viewport,
      padding ?? { top: 0, right: 0, bottom: 0, left: 0 },
      isPhone,
    );
    // `phoneAwareWideRangeBounds` takes/returns the read-only `CameraBoundsInput` shape (it never
    // mutates its input either way); `BoundsCamera.bounds` is the plain mutable tuple shape this
    // module uses everywhere else -- the runtime value is always a plain array regardless, so this
    // is a type-only cast, never a real copy/mutation concern.
    return bounds === cam.bounds ? cam : { ...cam, bounds: bounds as CameraBounds };
  }

  /** the ONE place a freshly-computed wide-range-eligible camera is applied AND recorded -- wraps
   * `applyCamera`/`recordWideRangeCamera` with the phone-awareness above so the three call sites
   * below (the species-change effect, `refineCameraFromCogBounds`, `zoomToLayer`) can never apply
   * the RAW bounds while recording the PHONE-AWARE ones (or vice versa) by forgetting one call. */
  function applyWideRangeCamera(cam: Camera | null): void {
    const aware = phoneAwareCamera(cam);
    applyCamera(aware);
    recordWideRangeCamera(aware);
  }

  // D8 (Opus 5.5 eyes-on, 2026-09-24): `cameraFor()`'s own bundle-only chain (input -> merged ->
  // ecoregion -> sibling) is pure and network-free by contract (data/camera.ts's own header). A
  // release that publishes NO bbox anywhere for this taxon on ANY input (v7 — measured on the
  // walrus, mdl_seq 54383: every asset's `bbox` is null) falls all the way to `kind: "center"` (the
  // whole study area), so a small range reads as a sliver on the globe's limb. The COG this lens is
  // ABOUT to draw still carries its own true extent — `/cog/bounds` is the one place left to ask.
  // Fire-and-forget, guarded by a token (a later species change supersedes an in-flight fetch) AND
  // by re-checking `selStore.sel.sp` once the fetch resolves (the same "did the world move on
  // while I was awaiting" rule `showCellPopup`/`fetchCellValue` follow elsewhere in this codebase).
  let cameraRefineToken = 0;
  async function refineCameraFromCogBounds(card: TaxonCard, key: CameraKey): Promise<void> {
    const cogUrl = cogUrlForBoundsFallback(card, selStore.sel.in, selStore.sel.rep);
    if (!cogUrl) return;
    const token = ++cameraRefineToken;
    const bbox = await boundsSource.cogBounds(cogUrl);
    if (token !== cameraRefineToken) return; // a later species/refit superseded this fetch
    if (!bbox) return;
    if (cameraKeyOf(selStore.sel).sp !== key.sp) return; // the species itself changed meanwhile
    // D1 fix (Opus 5.5 eyes-on review round 2, 2026-09-25): this is v7's OWN path -- every v7
    // taxon (including the leatherback, the lens' default landing species) publishes no bbox
    // anywhere, so `cameraFor()`'s own wide-range step (`wideRangeAware`, called from ITS
    // `input`/`merged` branches) never ran for any of them. Running the SAME rule here, on the
    // COG's own real extent, is what makes the leatherback's whole-Pacific span narrow to its US
    // portion and the "Zoom to" toggle appear on v7 at all -- `recordWideRangeCamera` (not just
    // `applyCamera`) is what the toggle's own `wideRange` getter reads.
    //
    // R3-rr fix 1 (Opus 5.5 eyes-on review round 3, second pass, 2026-09-25): the D1 fix above
    // still missed the leatherback's OWN live bounds -- `/cog/info` returns
    // `[-180, -17.7, 180, 60.45]` (the model reaches Oceania across the antimeridian, so the
    // raster's own bbox is already the full globe in longitude), and `minimalFrame()` cannot
    // narrow a box that wide (its complement is zero-width). This used to `return` right here,
    // BEFORE `wideRangeAware()` ever ran, because a globe-spanning frame was read as "not a
    // camera" rather than as the WIDEST case the wide-range rule exists to handle.
    // `cogBoundsCamera()` (data/camera.ts) now applies that rule to the raw bbox even when
    // `minimalFrame()` couldn't narrow it -- see its own header for why `intersectBbox()`'s
    // dateline-shift search still narrows a -180..180 box against the study area correctly.
    const cam = cogBoundsCamera(
      bbox,
      DEFAULT_CAMERA_PADDING,
      studyAreaView(deps.boot(), FULL_STUDY_AREA),
    );
    if (!cam) return;
    applyWideRangeCamera(cam);
  }

  async function bootstrap(ver: string): Promise<void> {
    try {
      // a throwaway, write-once parse of the page's INITIAL query string (never mutated again, and
      // never read by a template) — no template/effect needs Svelte's reactive wrapper to track it.
      // eslint-disable-next-line svelte/prefer-svelte-reactivity
      const initialParams = new URLSearchParams(location.search);
      const asked = deepLinkKey(initialParams);
      // ONLY a legacy id (mdl_key/mdl_seq) needs resolving through the alias shard. A modern
      // `sp=`(+`in=`) link is already canonical — codec.ts's parseSel (which ran before this
      // module even mounted) already put the right values in `selStore.sel`. Resolving it anyway
      // would be wrong, not just redundant: a merged key's alias entry always maps to itself with
      // `ds_key = "ms_merge"`, so re-running this for a plain `sp=` link would silently clobber an
      // already-correct `?sp=X&in=someInput` link's `in` back to "merged" on every load.
      if (asked?.legacy) {
        let result = await resolveDeepLink(ver, initialParams, {
          index: taxaIndex,
          fetchJson,
          session: deps.session?.() ?? null,
        });
        if (result.kind !== "none" && result.event) {
          track(result.event.name, result.event.params satisfies DeepLinkEvent["params"]);
        }
        // the index was not loaded yet, so US validity is undecided: load it (the picker needs it
        // anyway) and settle, instead of guessing "not US" and switching US-only off.
        if (result.kind === "species" && result.clearUs === null) {
          result = settleUs(result, await ensureTaxaIndex());
        }
        if (result.kind === "species") {
          const target = targetOf(result, selStore.sel);
          // `rep` is omitted, not passed as `undefined`: Object.assign copies an explicit undefined
          // over the field and `rep=undefined` was written into the address bar.
          if (target) {
            selStore.set({
              sp: target.sp,
              in: target.in,
              us: target.us,
              ...(target.rep !== undefined ? { rep: target.rep } : {}),
            });
          }
        } else if (result.kind === "not-found") {
          notFound = { key: result.key, reasons: result.reasons };
        }
      }
      if (!selStore.sel.sp) {
        const idx = await ensureTaxaIndex();
        if (idx) {
          const key = defaultSpecies(idx);
          if (key) selStore.set({ sp: key });
        }
      }
    } finally {
      resolving = false;
    }
  }

  // --- effects --------------------------------------------------------------------------------

  $effect(() => {
    const ver = deps.ver();
    const lens = selStore.sel.lens;
    if (!ver || lens !== "species" || bootStarted) return;
    bootStarted = true;
    void bootstrap(ver);
  });

  $effect(() => {
    if (resolving) return; // the jigger guard (§11.12) — see module header
    const ver = deps.ver();
    const sp = selStore.sel.sp;
    if (!ver || !sp || selStore.sel.lens !== "species") return;
    loading = true;
    clearMapPopup(); // §6.2 step 1: `clear_markers()` at the start of every render observer run
    let cancelled = false;
    loadTaxon(ver, sp, { fetchJson, session: deps.session?.() ?? null }).then((res) => {
      if (cancelled) return;
      loading = false;
      if (res.ok) {
        card = res.value;
        cardError = null;
        // §10: "de-duplicated and SEEDED WITH THE DEFAULT SPECIES so the opening taxon is not
        // logged as a user choice" — the first species this session ever loads is exactly that
        // seed, whether it came from a deep link or the picker's own default; only a SUBSEQUENT
        // load (a real choice) logs.
        if (loggedFirstSpecies) {
          track("select_species", {
            mdl_key: card.key,
            scientific_name: card.sci,
            common_name: card.common ?? undefined,
            sp_cat: card.spCat,
            taxon_id: card.taxonId ?? undefined,
            n_datasets: card.inputs.length,
            redlist_code: card.rl ?? undefined,
            us_only: selStore.sel.us,
          });
        }
        loggedFirstSpecies = true;
      } else {
        card = null;
        cardError = res.error;
      }
    });
    return () => {
      cancelled = true;
    };
  });

  // `docTitle` above is exposed (the getter below) but NOT written to `document.title` here --
  // atlas-8 fix: this used to be a second, independent `$effect` writing it directly, racing
  // Shell.svelte's own title effect with no ordering guarantee. Shell.svelte is now the ONE writer
  // (tests/shell/documentTitle.test.ts); it reads this lens' `docTitle` when `sel.lens ===
  // "species"`.

  // R3-W8 item 2: any user-driven camera move observed AFTER the first read of `selStore.sel.map`
  // arms the pan guard — the FIRST read (mount, or a deep link's own `?map=`) is not itself a pan,
  // it is the starting state this module inherits. See `pannedSincePick`'s own header above.
  $effect(() => {
    void selStore.sel.map; // tracked dependency — the value itself is read fresh where it matters
    if (!mapWatchPrimed) {
      mapWatchPrimed = true;
      return;
    }
    pannedSincePick = true;
  });

  $effect(() => {
    if (resolving || !card) return;
    const key = cameraKeyOf(selStore.sel);
    // read-only comparison, not a dependency the effect should re-run for on its own — prevCameraKey
    // is plain (non-reactive) state precisely so switching `in`/`rep` alone (no species change)
    // does not retrigger this effect a second time once the camera has already been applied.
    const needsSpeciesFit = untrack(() => refitNeeded(prevCameraKey, key));
    // R3-W8 item 2: "picking an input (or Merged) refits the camera to THAT surface's extent" —
    // gated by the "Zoom to layer on change" checkbox (`Sel.zl`) and the pan guard above; a
    // species change is handled unconditionally by `needsSpeciesFit` and never checks either.
    const needsInputFit = untrack(() => refitOnInputChange(prevCameraKey, key));
    if (!needsSpeciesFit && !needsInputFit) return;
    if (!needsSpeciesFit) {
      if (selStore.sel.zl === false) {
        prevCameraKey = key; // the viewer turned the checkbox off — nothing left to retry for
        return;
      }
      if (pannedSincePick) {
        prevCameraKey = key; // the viewer panned since the last pick — respect it, don't retry
        return;
      }
    }
    const boot = deps.boot();
    const cam = cameraFor(card, selStore.sel.in, {
      rep: selStore.sel.rep,
      fallbackBbox: null,
      studyArea: studyAreaView(boot, FULL_STUDY_AREA),
      padding: DEFAULT_CAMERA_PADDING,
    });
    // R3-rr fix 1, round 4 (Opus 5.5 eyes-on review round 3, real-build eyes-on, 2026-09-25):
    // `cameraFor()` returns `null` ONLY when it has no study area to fall back to (its own last
    // resort) -- and on the LIVE app, `deps.boot()` -> `studyAreaView()` can still be incomplete
    // on this effect's FIRST run (this same $effect reads `deps.boot()` reactively and re-runs once
    // it fills in -- confirmed live: a real load hit `cam === null` on pass 1, then a real,
    // populated `boot` on pass 2). The OLD code unconditionally wrote `prevCameraKey = key` before
    // this null check, so `refitNeeded()` on pass 2 saw the SAME key and reported "already fitted"
    // -- permanently skipping the species' own camera fit (and the COG-bounds last resort below)
    // for the rest of the session, EVEN ONCE real study-area data existed. `prevCameraKey` is now
    // only latched once a camera was actually computed, so a null-boot pass retries on the very
    // next boot update instead of silently giving up forever.
    if (!cam) return;
    prevCameraKey = key;
    applyWideRangeCamera(cam);
    pannedSincePick = false; // this IS the new "last pick" moment
    // D8: the bundle published no bbox anywhere for this taxon — try the COG's own extent before
    // giving up on framing it at all.
    if (cam.kind === "center") void refineCameraFromCogBounds(card, key);
  });

  return {
    get loading() {
      return loading;
    },
    get card() {
      return card;
    },
    get cardError() {
      return cardError;
    },
    get bar() {
      return bar;
    },
    get info() {
      return info;
    },
    get mapInputs() {
      return mapInputs;
    },
    get docTitle() {
      return docTitle;
    },
    get notFound() {
      return notFound;
    },
    get popup() {
      return popup;
    },
    get taxaIndex() {
      return taxaIndex;
    },
    get datasets() {
      return datasets;
    },
    get ver() {
      return deps.ver();
    },
    get wideRange(): WideRangeZoom {
      return wideRangeCamera?.wholeRangeBounds ? { value: zoomTarget } : null;
    },
    get zoomToLayerOnChange() {
      return selStore.sel.zl !== false;
    },

    dismissNotFound() {
      notFound = null;
    },
    closePopup() {
      clearMapPopup();
    },
    ensureTaxaIndex,

    selectSpecies(key: string) {
      selStore.set({ sp: key, in: MERGED_IN, rep: "native" });
    },
    selectLayer(inKey: string) {
      track("select_layer", { layer: inKey, mdl_key: card?.key ?? "" });
      selStore.set({ in: inKey });
    },
    setRepresentation(rep: Representation) {
      track("select_representation", { representation: rep, mdl_key: card?.key ?? "" });
      selStore.set({ rep });
    },
    setUsOnly(enabled: boolean) {
      track("toggle_us_only", { enabled });
      selStore.set({ us: enabled });
    },
    setZoomToLayerOnChange(enabled: boolean) {
      track("zoom_to_layer_on_change", { enabled });
      selStore.set({ zl: enabled });
    },
    zoomToLayer() {
      track("zoom_to_layer", {});
      if (!card) return;
      const boot = deps.boot();
      const cam = cameraFor(card, selStore.sel.in, {
        rep: selStore.sel.rep,
        fallbackBbox: null,
        studyArea: studyAreaView(boot, FULL_STUDY_AREA),
        padding: DEFAULT_CAMERA_PADDING,
      });
      applyWideRangeCamera(cam);
      pannedSincePick = false; // an explicit manual re-fit is a "last pick" moment too
      // D8 fold-in (orchestrator round 2, 2026-09-24): the manual "zoom to layer" button used to
      // stop at `cameraFor()`'s own bundle-only chain, so a taxon with NO published bbox anywhere
      // (v7's walrus) fell to `kind: "center"` here too — the SAME COG-bounds last resort the
      // species-change `$effect` above already applies, now wired to this explicit action as well.
      if (cam?.kind === "center") void refineCameraFromCogBounds(card, cameraKeyOf(selStore.sel));
    },
    setZoomTarget(target: "us" | "whole") {
      if (!wideRangeCamera?.wholeRangeBounds || target === zoomTarget) return;
      zoomTarget = target;
      if (target === "whole") {
        // R3-rr fix 1, round 5 (orchestrator eyes-on, real e1fcfc8 build, 2026-09-25): "Whole
        // range" used to fit `wholeRangeBounds` the SAME way as "US waters" -- through
        // `applyCamera`'s bounds branch, i.e. MapLibre's own real, globe-aware
        // `cameraForBounds()`. Measured live that this does NOT reliably keep both edges of an
        // extreme (~150deg) arc in frame: the leatherback's confirmed-data arc (145..294
        // continuous, Guam/CNMI to the Atlantic seaboard) settled centred over the Americas
        // (~-105deg) on desktop -- missing the Pacific side entirely -- and on the phone pushed
        // the centre to lat -56.5, well south of the box's own -17.7 south edge, behind the
        // sheet. `boundsToCameraView` (the SAME pure Mercator math `phoneDefaultCamera`'s own
        // known-good phone default already trusts) computes the arc's exact geometric midpoint
        // by construction -- a centre that can never fall outside the box it was fit to -- and a
        // zoom that fits the box's FULL span within the padded viewport, applied as a plain
        // camera move (`flyTo`, never `flyToBounds`/`cameraForBounds`).
        // `symmetricPadding` (camera.ts's own header): keeps the SAME total chrome reserve on
        // EACH axis (so the zoom, which fits the box's full span into the available space, is
        // unaffected) but zeroes both differentials -- an asymmetric reserve (the desktop docked
        // panel, the phone sheet) would otherwise push this extreme, near-zero-zoom arc's centre
        // far enough that it lands outside the globe's own visible hemisphere (longitude) or even
        // outside the box's own latitude range entirely (measured live on the phone: the SHIFT's
        // own `1/worldPx` term overshoots badly at this zoom -- see the function's own header).
        const viewport = deps.viewport?.() ?? { width: 0, height: 0 };
        const padding = symmetricPadding(
          deps.chromePadding ? deps.chromePadding() : { top: 0, right: 0, bottom: 0, left: 0 },
        );
        const view = boundsToCameraView(wideRangeCamera.wholeRangeBounds, viewport, { padding });
        deps.mapHandle()?.flyTo({
          key: "whole-range",
          lon: view.center[0],
          lat: view.center[1],
          zoom: view.zoom,
        });
      } else {
        applyCamera({
          kind: "bounds",
          bounds: wideRangeCamera.bounds,
          padding: wideRangeCamera.padding,
          source: wideRangeCamera.source,
        });
      }
      track("species_zoom_target", { target, mdl_key: card?.key ?? "" });
    },

    async handleMapClick(lngLat: LngLat, point: { x: number; y: number }): Promise<void> {
      if (selStore.sel.lens !== "species" || !card) return;
      // a click on a gazetteer overlay feature (a sanctuary, a lease) opens THAT card (the place and
      // its "Add to Places" button); a second, species popup on top of it would be two cards for one
      // click, so this click is the place's (click beside it to read the species value)
      if (overlayAt(point)) return;
      // §6.5 step 6: opens on the FIRST click, immediately (not the second, as mapgl's own marker
      // popup would need) — set right away, one popup instance at a time.
      function show(content: PopupContent, markerValue: number | null = null): void {
        popup = { lngLat, content };
        legendMarker = markerValue; // R4-A: only a real value draws the legend's marker line
        const handle = deps.mapHandle();
        mapLibrePopup?.remove();
        mapLibrePopup = handle
          ? createPopup()
              .setLngLat([lngLat.lng, lngLat.lat])
              .setHTML(popupHtml(content))
              .addTo(handle.map)
          : null;
        // fix list #12 (SC 4.1.3): the popup is a plain MapLibre div, not a live region -- nothing
        // ever announced its text (a value the app computed and displayed should not be invisible
        // to AT, even though the map itself stays outside the keyboard model -- see accessibility
        // .md §3.1).
        announce(popupAnnounceText(content));
      }

      const boot = deps.boot();
      let cellId: number | null = null;
      const handle = deps.mapHandle();
      if (boot && handle) {
        try {
          // `QueryableMap` (map/interaction.ts) is deliberately narrower than MapLibre's real `Map`
          // (built so a plain fake satisfies it in a test); the real map always satisfies it at
          // runtime — `queryRenderedFeatures`'s stricter `PointLike` param type is TS-only friction.
          cellId = mapClick(handle.map as unknown as QueryableMap, lngLat, point, {
            grid: gridFromBoot(boot),
            units: [],
          }).cellId;
        } catch {
          cellId = null;
        }
      }
      const asset = baseMapInputs.asset;
      const base = { sci: card.sci, lon: lngLat.lng, lat: lngLat.lat, cellId };
      if (!asset) {
        show(popupContent({ ...base, kind: "no-value" }));
        return;
      }
      if (asset.type === "pmtiles") {
        show(popupContent({ ...base, kind: "presence" }));
        return;
      }
      if (!asset.rescale) {
        show(popupContent({ ...base, kind: "no-value" }));
        return;
      }
      const value = await valueSource.pointValue({
        domain: "species",
        lon: lngLat.lng,
        lat: lngLat.lat,
        cogUrl: asset.url,
      });
      const stops = paletteStopsFromBoot(
        boot as { palettes?: unknown } | null,
        (asset.colormap ?? DEFAULT_SPECIES_COLORMAP) as PaletteName,
      );
      show(
        value === null
          ? popupContent({ ...base, kind: "no-value" })
          : popupContent({ ...base, kind: "value", value, rescale: asset.rescale, stops }),
        value,
      );
    },
  };
}
