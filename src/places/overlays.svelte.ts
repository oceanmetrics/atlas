// places/overlays.svelte.ts -- the reactive half of the Layers panel's "Place layers" group: it reads
// the gazetteer manifest (`index/layers.json`, a plain fetch: no parquet, so nothing of the places
// index is pulled in), keeps the set of collections that are ON in the URL (`?ov=`, written with
// `selStore.set` like every other view state), and hands out what the shell needs: the composeStyle
// `placeOverlays` input, the credit line for the map attribution, and the `overlayCredits` store.
//
// Every rule (themes, specs, credits, URL grammar) lives in the plain modules this wires together
// (`overlays.ts`, `lib/gazetteer/overlayUrl.ts`, `lib/gazetteer/manifest.ts`, `overlayInteraction.ts`).
// Hover and click on the overlays are installed here too, while at least one overlay is on.
import { untrack } from "svelte";
import { effectiveOv, toggledOv } from "../lib/gazetteer/overlayUrl";
import { fetchLayersManifest } from "../lib/gazetteer/manifest";
import { overlayHitLayerIds } from "../lib/map/layers/overlays";
import type { MapHandle } from "../lib/map/map";
import type { PlaceOverlaySpec } from "../lib/map/types";
import type { SelStore } from "../lib/state/sel.svelte";
import { notify } from "../lib/ui/announcer";
import { installOverlayInteraction, type OverlayMapLike } from "./overlayInteraction";
import { overlayCredits as defaultCredits, type OverlayCreditsStore } from "./overlayCredits";
import {
  groupOverlays,
  listedOverlays,
  overlayCreditLine,
  overlayCreditsFor,
  overlayLayersFrom,
  overlaySpecs,
  type OverlayCredit,
  type OverlayGroup,
  type OverlayLayer,
} from "./overlays";
import type { TiledLayer } from "../lib/gazetteer/manifest";

export interface PlaceOverlays {
  readonly phase: "loading" | "ready" | "error";
  readonly error: string | null;
  /** every collection the manifest has (unlisted ones too: a link may turn one on). */
  readonly layers: readonly OverlayLayer[];
  /** the manifest row (`index/layers.json`) of a collection, for its info dialog; `undefined` when the
   * manifest has none. */
  manifestRow(slug: string): TiledLayer | undefined;
  /** the listed ones (plus an unlisted one while it is on), grouped for the list. */
  readonly groups: readonly OverlayGroup[];
  /** the collections that are ON (the URL's `?ov=`, or the default set). */
  readonly on: readonly string[];
  /** the composeStyle `placeOverlays` input: the ones that are ON and listed. */
  readonly specs: readonly PlaceOverlaySpec[];
  readonly credits: readonly OverlayCredit[];
  /** the joined credit line (map attribution); "" when none is on. */
  readonly creditLine: string;
  isOn(slug: string): boolean;
  toggle(slug: string, on?: boolean): void;
  /** switch every overlay off (`?ov=`). */
  clear(): void;
  reload(): void;
}

export interface PlaceOverlaysDeps {
  selStore: SelStore;
  mapHandle?: () => MapHandle | undefined;
  /** true while a place pick/draw session owns map clicks. */
  isOwned?: () => boolean;
  /** whether the overlays are drawn at all right now (default always). The shell turns them off in a
   * lens whose Layers panel has no "Place layers" list to switch them from. */
  enabled?: () => boolean;
  /** manifest reader; default `fetchLayersManifest` (a plain fetch). */
  fetchManifest?: () => Promise<TiledLayer[]>;
  /** where the credits are published; default the app-wide `overlayCredits`. */
  credits?: OverlayCreditsStore;
  /** adds a gazetteer place by reference (the popup's button); default: the Places list. */
  onAdd?: (place: { id: string; name: string }) => void;
}

export function createPlaceOverlays(deps: PlaceOverlaysDeps): PlaceOverlays {
  const { selStore } = deps;
  const creditsStore = deps.credits ?? defaultCredits;
  const fetchManifest = deps.fetchManifest ?? (() => fetchLayersManifest());

  let phase = $state<"loading" | "ready" | "error">("loading");
  let error = $state<string | null>(null);
  let layers = $state.raw<readonly OverlayLayer[]>([]);
  let rows = $state.raw<readonly TiledLayer[]>([]);
  let tick = $state(0);

  // the manifest: once, and again on `reload()` (a failed read keeps the URL's set; nothing is lost)
  let token = 0;
  $effect(() => {
    void tick;
    const mine = ++token;
    untrack(() => {
      phase = "loading";
      error = null;
    });
    fetchManifest().then(
      (fetched) => {
        if (mine !== token) return;
        rows = fetched;
        layers = overlayLayersFrom(fetched);
        phase = "ready";
      },
      (e: unknown) => {
        if (mine !== token) return;
        error = e instanceof Error ? e.message : String(e);
        phase = "error";
      },
    );
  });

  const on = $derived(effectiveOv(selStore.sel.ov));
  const enabled = $derived(deps.enabled?.() ?? true);
  const specs = $derived(enabled ? overlaySpecs(layers, on) : []);
  const credits = $derived(enabled ? overlayCreditsFor(layers, on) : []);
  const creditLine = $derived(overlayCreditLine(credits));
  const groups = $derived(groupOverlays(listedOverlays(layers, on)));

  $effect(() => {
    creditsStore.set(credits);
  });

  // hover + click while any overlay is on
  const hitIds = $derived(overlayHitLayerIds(specs));
  const anyOn = $derived(specs.length > 0);
  $effect(() => {
    const handle = deps.mapHandle?.();
    if (!handle || !anyOn) return;
    const interaction = installOverlayInteraction(handle.map as unknown as OverlayMapLike, {
      hitLayerIds: () => untrack(() => hitIds),
      isOwned: () => deps.isOwned?.() === true,
      onAdd: (place) => (deps.onAdd ?? addToPlaces)(place),
    });
    return () => interaction.destroy();
  });

  async function addToPlaces(place: { id: string; name: string }): Promise<void> {
    const model = await import("./model");
    const current = model.placesFromHash(selStore.sel.pl);
    const result = model.addGazPlace(current, place.id, place.name);
    if (!result.ok) {
      notify(result.reason ?? "Couldn't add that place.");
      return;
    }
    selStore.set({
      pl: model.hashFromPlaces(result.places),
      sel: `place:${result.places.length - 1}`,
    });
    notify(`Added ${place.name || place.id} to places.`);
  }

  function toggle(slug: string, value?: boolean): void {
    const next = value ?? !on.includes(slug);
    selStore.set({ ov: toggledOv(selStore.sel.ov, slug, next) });
  }

  return {
    get phase() {
      return phase;
    },
    get error() {
      return error;
    },
    get layers() {
      return layers;
    },
    get groups() {
      return groups;
    },
    get on() {
      return on;
    },
    get specs() {
      return specs;
    },
    get credits() {
      return credits;
    },
    get creditLine() {
      return creditLine;
    },
    manifestRow: (slug) => rows.find((r) => r.slug === slug),
    isOn: (slug) => on.includes(slug),
    toggle,
    clear() {
      selStore.set({ ov: [] });
    },
    reload() {
      tick++;
    },
  };
}
