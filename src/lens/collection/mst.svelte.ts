// The MarineSensitivity half of the Collections lens' reactive core: what an MST collection needs
// beyond the generic catalog -> items -> item flow (`state.svelte.ts`). Runes live here and in
// `state.svelte.ts` only; every rule (which kind, the Item built from a taxon shard, the manifest ->
// dimensions, the rescale) is a plain module under `lib/catalog/mst/` and `lib/raster/`.
//
//   taxon collections (v7)   the `app/taxa.json` index loads when one is opened; the taxon is `?sp=`
//                            (default: the species lens' default, the leatherback); its Item comes
//                            from `taxon/{xx}.json`. The other MST collections share the taxon, so
//                            switching collection keeps it (compare IUCN range with AquaMaps).
//   nc / gm (v8)             no rune state: their Items are loaded by `state.svelte.ts` through
//                            `loadMstItems` like any collection's, with the manifest's cube.
//
// Every request carries a token: a slower earlier answer never overwrites a later choice.
import { untrack } from "svelte";
import { mstRefOf, type MstRef } from "../../lib/catalog/mst/kinds";
import { loadMstTaxa, loadTaxonItem, type TaxonLoadOptions } from "../../lib/catalog/mst/items";
import type { CollectionEntry, LoadError } from "../../lib/catalog/load";
import type { StacItem } from "../../lib/catalog/types";
import { defaultSpecies, type TaxaIndex } from "../../lens/species/data/picker";
import type { SelStore } from "../../lib/state/sel.svelte";

export type MstPhase = "idle" | "loading" | "ready" | "error";

export interface MstSourceDeps {
  selStore: SelStore;
  /** the active collection entry. */
  entry: () => CollectionEntry | null;
  /** loader overrides for tests (`fetchJson`, `cache`). */
  taxonOptions?: TaxonLoadOptions;
}

export interface MstSource {
  /** the MST kind of the active entry, or null. */
  readonly ref: MstRef | null;
  /** the taxa index (taxon collections), once loaded. */
  readonly taxa: TaxaIndex | null;
  readonly taxaPhase: MstPhase;
  /** the "only US waters" filter of the taxon search (default on, like the species lens). */
  readonly usOnly: boolean;
  /** the taxon on screen (`?sp=`, else the default), or null before the index is there. */
  readonly taxonKey: string | null;
  /** the active taxon collection's Items: [the taxon's Item], or none. */
  readonly items: StacItem[];
  readonly phase: MstPhase;
  readonly error: LoadError | null;
  /** a sentence when the taxon has nothing to draw here (or the lookup failed). */
  readonly notice: string | null;
  setUsOnly(enabled: boolean): void;
  /** pick a taxon: writes `?c=` and `?sp=` (the `c` is what keeps the link in the Collections lens). */
  selectTaxon(key: string): void;
  /** the taxon to restore when the viewer comes back to a taxon collection. */
  readonly remembered: string | undefined;
  remember(key: string | undefined): void;
}

export function createMstSource(deps: MstSourceDeps): MstSource {
  const { selStore } = deps;

  let taxa = $state.raw<TaxaIndex | null>(null);
  let taxaPhase = $state<MstPhase>("idle");
  let usOnly = $state(true);
  let items = $state.raw<StacItem[]>([]);
  let phase = $state<MstPhase>("idle");
  let error = $state.raw<LoadError | null>(null);
  let notice = $state<string | null>(null);
  let remembered = $state<string | undefined>(undefined);

  const ref = $derived(mstRefOf(deps.entry()));
  const isTaxon = $derived(ref?.kind === "taxon");

  // the index, read once when a taxon collection is first opened
  let taxaToken = 0;
  $effect(() => {
    if (!isTaxon || untrack(() => taxa) || untrack(() => taxaPhase) === "loading") return;
    const token = ++taxaToken;
    untrack(() => {
      taxaPhase = "loading";
    });
    void loadMstTaxa(deps.taxonOptions).then((res) => {
      if (token !== taxaToken) return;
      if (res.ok) {
        taxa = res.value;
        taxaPhase = "ready";
      } else {
        error = res.error;
        taxaPhase = "error";
        notice = `The taxon list could not be loaded (${res.error.message}).`;
      }
    });
  });

  const taxonKey = $derived.by(() => {
    if (!isTaxon) return null;
    const sp = selStore.sel.sp;
    if (sp) return sp;
    return taxa ? defaultSpecies(taxa) : null;
  });

  // the taxon's Item in the active collection
  let itemToken = 0;
  $effect(() => {
    const entry = deps.entry();
    const key = taxonKey;
    const taxon = isTaxon;
    const token = ++itemToken;
    if (!taxon || !entry || !key) {
      untrack(() => {
        items = [];
        error = null;
        notice = null;
        phase = taxon && taxaPhase !== "error" ? "loading" : "idle";
      });
      return;
    }
    untrack(() => {
      items = [];
      error = null;
      notice = null;
      phase = "loading";
    });
    void loadTaxonItem(entry, key, deps.taxonOptions).then((res) => {
      if (token !== itemToken) return;
      if (res.ok) {
        items = [res.item];
        phase = "ready";
      } else if (res.kind === "no-model") {
        items = [];
        notice = res.message;
        phase = "ready";
      } else {
        items = [];
        error = res.error;
        notice = res.message;
        phase = "error";
      }
    });
  });

  return {
    get ref() {
      return ref;
    },
    get taxa() {
      return taxa;
    },
    get taxaPhase() {
      return taxaPhase;
    },
    get usOnly() {
      return usOnly;
    },
    get taxonKey() {
      return taxonKey;
    },
    get items() {
      return items;
    },
    get phase() {
      return phase;
    },
    get error() {
      return error;
    },
    get notice() {
      return notice;
    },
    setUsOnly(enabled) {
      usOnly = enabled;
    },
    selectTaxon(key) {
      const entry = deps.entry();
      if (!entry) return;
      if (taxa && !taxa.byKey.has(key)) return; // a key the index does not list
      remembered = key;
      selStore.set({ c: entry.id, sp: key, i: undefined });
    },
    get remembered() {
      return remembered;
    },
    remember(key) {
      remembered = key;
    },
  };
}
