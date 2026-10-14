// The Collections lens' reactive orchestration. This is the ONE file in `src/lens/collection/**` that
// uses runes; every rule it applies (the catalog loader, dimension/item resolution, the ramp, the
// legend, the hex feature-state mapping) lives in the plain, Node-testable modules it calls
// (`lib/catalog/*`, `lib/map/layers/hex.ts`, `./mapInputs.ts`) -- the same wiring-only division
// `lens/species/state.svelte.ts` documents for itself.
//
// Data flow, each step guarded against a stale answer (a token per request: a slower earlier
// response never overwrites a later choice):
//   catalog.json -> entries -> the active entry (`?c=`) -> its items (lazy) -> the active item (`?i=`)
//   -> its Parquet value column (read only when the item changes) -> feature state on the hex layer.
// Switching items only re-reads a column and rewrites feature state: the PMTiles grid, the source and
// the style's source list do not change, so the geometry is never refetched.
import { untrack } from "svelte";
import {
  cellSelection as defaultCellSelection,
  type CellSelectionStore,
  type CellSelection,
} from "../../lib/catalog/cellSelection";
import { creditsOf, type Credits } from "../../lib/catalog/credits";
import { resolveCatalogBase } from "../../lib/catalog/base";
import {
  pickEntry,
  selPatchFor,
  selectDim as selectDimItem,
  viewOf,
  type DimSpec,
} from "../../lib/catalog/dims";
import { styleUrlOf, valuesAssetOf } from "../../lib/catalog/assets";
import {
  loadCatalog,
  loadItems,
  clearCatalogCache,
  type AtlasCatalog,
  type CollectionEntry,
  type LoadError,
  type LoadOptions,
} from "../../lib/catalog/load";
import type { StacItem } from "../../lib/catalog/types";
import { readValueColumn, type ValueColumn } from "../../lib/catalog/values";
import {
  createHexPainter,
  installHexInteraction,
  type HexInteractionMap,
  type HexPainter,
  type HexPaintMap,
} from "../../lib/map/layers/hex";
import type { MapHandle } from "../../lib/map/map";
import type { SelStore } from "../../lib/state/sel.svelte";
import {
  EMPTY_COLLECTION_INPUTS,
  collectionMapInputs,
  formatCollectionValue,
  itemLabel,
  type CollectionMapInputs,
} from "./mapInputs";

export type Phase = "loading" | "ready" | "error";

export interface CollectionLensDeps {
  selStore: SelStore;
  mapHandle: () => MapHandle | undefined;
  /** true while a place pick/draw session owns map clicks (`placesMap.interactionOwned`). */
  isOwned?: () => boolean;
  /** the clicked-cell store WP3 reads; default the app-wide singleton. */
  cellSelection?: CellSelectionStore;
  /** loader overrides for tests (`fetchImpl`, `cache`, ...). */
  loadOptions?: Partial<LoadOptions>;
  /** reads one Parquet value column; default `readValueColumn` (hyparquet, lazy). */
  readValues?: typeof readValueColumn;
  /** fetches the collection's style JSON; default `fetch`; `null` on any failure. */
  fetchStyle?: (url: string) => Promise<unknown | null>;
  /** WP4 "Only inside places": the hex FIDs to keep at full opacity (every other painted cell is
   * dimmed), read reactively; `null`/absent = no filter. */
  insideFids?: () => ReadonlySet<number> | null;
}

export interface CollectionLens {
  /** the catalog's load phase. */
  readonly phase: Phase;
  readonly error: LoadError | null;
  readonly entries: CollectionEntry[];
  /** the active collection (`?c=`, default the first available). */
  readonly entry: CollectionEntry | null;
  readonly itemsPhase: "idle" | "loading" | "ready" | "error";
  readonly itemsError: LoadError | null;
  readonly dims: DimSpec[];
  /** one value per dimension (the active item's own dims). */
  readonly selected: Record<string, string>;
  /** the active item. */
  readonly item: StacItem | null;
  readonly credits: Credits;
  readonly mapInputs: CollectionMapInputs;
  /** the item's title; the page title and the Details header read it. */
  readonly itemTitle: string | null;
  readonly itemDescription: string | null;
  /** true when the active item is something the lens can draw (a hex grid + values, or a COG). */
  readonly drawable: boolean;
  /** true while the item's value column is being read. */
  readonly valuesLoading: boolean;
  readonly valuesError: LoadError | null;
  /** the active item's value column (`FID` + values), `null` until it is read or for a raster item. */
  readonly values: ValueColumn | null;
  /** the clicked cell (mirrors the store, reactively). */
  readonly cell: CellSelection | null;
  /** the dimension values still reachable, per dimension key (`availableValues`). */
  isAvailable(dimKey: string, value: string): boolean;
  selectCollection(id: string): void;
  selectDim(key: string, value: string): void;
  clearCell(): void;
  reload(): void;
}

async function defaultFetchStyle(url: string): Promise<unknown | null> {
  try {
    const res = await fetch(url);
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

export function createCollectionLens(deps: CollectionLensDeps): CollectionLens {
  const { selStore } = deps;
  const store = deps.cellSelection ?? defaultCellSelection;
  const readValues = deps.readValues ?? readValueColumn;
  const fetchStyle = deps.fetchStyle ?? defaultFetchStyle;

  let phase = $state<Phase>("loading");
  let error = $state.raw<LoadError | null>(null);
  let catalog = $state.raw<AtlasCatalog | null>(null);
  let items = $state.raw<StacItem[]>([]);
  let itemsPhase = $state<"idle" | "loading" | "ready" | "error">("idle");
  let itemsError = $state.raw<LoadError | null>(null);
  let styleJson = $state.raw<unknown | null>(null);
  let values = $state.raw<ValueColumn | null>(null);
  let valuesLoading = $state(false);
  let valuesError = $state.raw<LoadError | null>(null);
  let cell = $state.raw<CellSelection | null>(store.get());
  let reloadTick = $state(0);
  let painter = $state.raw<HexPainter | null>(null);

  // mirror the store, so a template can read `lens.cell` reactively
  $effect(() =>
    store.subscribe((v) => {
      cell = v;
    }),
  );

  // plain, deliberately non-reactive caches: read inside effects, never by a template
  /* eslint-disable svelte/prefer-svelte-reactivity */
  const columnCache = new Map<string, ValueColumn>();
  const styleCache = new Map<string, unknown | null>();
  /* eslint-enable svelte/prefer-svelte-reactivity */

  // --- the catalog ------------------------------------------------------------------------------
  let catalogToken = 0;
  $effect(() => {
    if (selStore.sel.lens !== "collection") return;
    const base = resolveCatalogBase(selStore.sel.catalog);
    void reloadTick;
    const token = ++catalogToken;
    untrack(() => {
      phase = "loading";
      error = null;
    });
    void loadCatalog({ ...deps.loadOptions, base }).then((res) => {
      if (token !== catalogToken) return;
      if (res.ok) {
        catalog = res.value;
        phase = "ready";
      } else {
        catalog = null;
        error = res.error;
        phase = "error";
      }
    });
  });

  const entries = $derived(catalog?.entries ?? []);
  const entry = $derived(pickEntry(entries, selStore.sel.c));

  // --- the items of the active collection (lazy) --------------------------------------------------
  let itemsToken = 0;
  $effect(() => {
    const e = entry;
    void reloadTick;
    const token = ++itemsToken;
    untrack(() => {
      items = [];
      itemsError = null;
      itemsPhase = e ? "loading" : "idle";
    });
    if (!e) return;
    void loadItems(e, { ...deps.loadOptions }).then((res) => {
      if (token !== itemsToken) return;
      if (res.ok) {
        items = res.value.items;
        itemsPhase = "ready";
      } else {
        itemsError = res.error;
        itemsPhase = "error";
      }
    });
  });

  const view = $derived(viewOf(entry?.collection ?? null, items, selStore.sel.i));
  const item = $derived(view.item);

  // --- the collection's style (a MapLibre fill layer; the ramp is read out of it) ------------------
  let styleToken = 0;
  $effect(() => {
    const e = entry;
    const token = ++styleToken;
    const url = styleUrlOf(e?.collection ?? null);
    untrack(() => {
      styleJson = url && styleCache.has(url) ? (styleCache.get(url) ?? null) : null;
    });
    if (!url || styleCache.has(url)) return;
    void fetchStyle(url).then((json) => {
      styleCache.set(url, json);
      if (token === styleToken) styleJson = json;
    });
  });

  // --- the item's value column (read only when the item changes) ----------------------------------
  let valuesToken = 0;
  $effect(() => {
    const asset = valuesAssetOf(item);
    const token = ++valuesToken;
    if (!asset) {
      untrack(() => {
        values = null;
        valuesLoading = false;
        valuesError = null;
      });
      return;
    }
    const key = `${asset.url}#${asset.valueColumn}`;
    const hit = columnCache.get(key);
    if (hit) {
      untrack(() => {
        values = hit;
        valuesLoading = false;
        valuesError = null;
      });
      return;
    }
    untrack(() => {
      valuesLoading = true;
      valuesError = null;
    });
    void readValues(asset.url, { keyColumn: asset.keyColumn, valueColumn: asset.valueColumn }).then(
      (res) => {
        if (token !== valuesToken) return;
        valuesLoading = false;
        if (res.ok) {
          columnCache.set(key, res.value);
          values = res.value;
        } else {
          valuesError = res.error;
        }
      },
    );
  });

  // fid -> value of the item on screen (a plain Map: read by map event handlers, never a template)
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- read by map event handlers, not templates
  let valueIndex = new Map<number, number | null>();
  $effect(() => {
    const col = values;
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- same non-reactive index
    valueIndex = new Map(col ? col.fids.map((f, i) => [f, col.values[i]] as const) : []);
    // the clicked cell follows the item: same cell, this item's value; another collection clears it
    const sel = untrack(() => store.get());
    const e = untrack(() => entry);
    const it = untrack(() => item);
    if (!sel) return;
    if (!e || !it || sel.collection !== e.id) {
      store.set(null);
      return;
    }
    const next = valueIndex.get(sel.fid);
    store.set({ ...sel, item: it.id, value: typeof next === "number" ? next : null });
  });

  // --- what the map draws ------------------------------------------------------------------------
  const mapInputs = $derived.by(() => {
    if (selStore.sel.lens !== "collection") return EMPTY_COLLECTION_INPUTS;
    const marker = cell && entry && item && cell.collection === entry.id ? cell.value : null;
    return collectionMapInputs({ entry, item, style: styleJson, values, marker });
  });

  // --- the live map: painter + hover/click ---------------------------------------------------------
  const sourceLayer = $derived(mapInputs.hex?.sourceLayer ?? null);
  $effect(() => {
    const handle = deps.mapHandle();
    const layer = sourceLayer;
    if (!handle || !layer) return;
    const p = createHexPainter(handle.map as unknown as HexPaintMap, layer);
    painter = p;
    return () => {
      p.destroy();
      painter = null;
    };
  });

  $effect(() => {
    painter?.apply(mapInputs.hex ? values : null);
  });
  $effect(() => {
    painter?.setInside(mapInputs.hex ? (deps.insideFids?.() ?? null) : null);
  });
  $effect(() => {
    painter?.setSelected(
      mapInputs.hex && cell && entry && cell.collection === entry.id ? cell.fid : null,
    );
  });

  // installed only while a hex layer is on the map: when it goes (another collection, another lens)
  // the interaction is destroyed, which also removes a hover popup that no `mouseleave` would clear
  const hasHex = $derived(mapInputs.hex !== null);
  $effect(() => {
    const handle = deps.mapHandle();
    if (!handle || !hasHex) return;
    const interaction = installHexInteraction(handle.map as unknown as HexInteractionMap, {
      valueOf: (fid) => valueIndex.get(fid),
      format: formatCollectionValue,
      isOwned: () => deps.isOwned?.() === true || untrack(() => selStore.sel.lens) !== "collection",
      onClick: ({ fid, value, lngLat }) => {
        const e = untrack(() => entry);
        const it = untrack(() => item);
        if (!e || !it) return;
        store.set({ collection: e.id, item: it.id, fid, value, lngLat });
      },
    });
    return () => interaction.destroy();
  });

  // --- actions ------------------------------------------------------------------------------------
  function selectCollection(id: string): void {
    const e = entries.find((x) => x.id === id && x.status === "ok");
    if (!e) return;
    store.set(null);
    selStore.set(selPatchFor(entries, e, [], null));
  }

  function selectDim(key: string, value: string): void {
    const next = selectDimItem(items, view.selected, key, value);
    if (!next) return;
    selStore.set(selPatchFor(entries, entry, items, next));
  }

  return {
    get phase() {
      return phase;
    },
    get error() {
      return error;
    },
    get entries() {
      return entries;
    },
    get entry() {
      return entry;
    },
    get itemsPhase() {
      return itemsPhase;
    },
    get itemsError() {
      return itemsError;
    },
    get dims() {
      return view.dims;
    },
    get selected() {
      return view.selected;
    },
    get item() {
      return item;
    },
    get credits() {
      return creditsOf(entry?.collection ?? null);
    },
    get mapInputs() {
      return mapInputs;
    },
    get itemTitle() {
      return item ? itemLabel(item) : null;
    },
    get itemDescription() {
      const d = item?.properties?.description;
      return typeof d === "string" && d.trim() ? d.trim() : null;
    },
    get drawable() {
      return mapInputs.hex !== null || mapInputs.raster !== null;
    },
    get valuesLoading() {
      return valuesLoading;
    },
    get valuesError() {
      return valuesError;
    },
    get values() {
      return values;
    },
    get cell() {
      return cell;
    },
    isAvailable(dimKey, value) {
      const dim = view.dims.find((d) => d.key === dimKey);
      if (!dim) return true;
      const others = Object.fromEntries(
        Object.entries(view.selected).filter(([k]) => k !== dimKey),
      );
      return items.some((it) => {
        const have = (it.properties?.["atlas:dims"] ?? {}) as Record<string, unknown>;
        return (
          String(have[dimKey]) === value &&
          Object.entries(others).every(([k, v]) => String(have[k]) === v)
        );
      });
    },
    selectCollection,
    selectDim,
    clearCell() {
      store.set(null);
    },
    reload() {
      clearCatalogCache(deps.loadOptions?.cache);
      catalog = null;
      reloadTick++;
    },
  };
}
