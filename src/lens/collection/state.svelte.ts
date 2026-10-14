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
  itemDims,
  pickEntry,
  resolveItem,
  selPatchFor,
  selectDim as selectDimItem,
  viewOf,
  type DimSpec,
} from "../../lib/catalog/dims";
import {
  rasterAssetOf,
  styleUrlOf,
  valuesAssetOf,
  type ValuesAsset,
} from "../../lib/catalog/assets";
import { extentBounds } from "../../lib/catalog/extent";
import {
  likelyCountIndex,
  likelySpeciesText,
  modeledCount,
  readSpeciesData,
  shareByGroup,
  speciesAssetsOf,
  speciesInCell,
  type CellSpecies,
  type GroupShare,
  type SpeciesData,
} from "../../lib/catalog/species";
import type { ChromePadding } from "../../lib/map/camera";
import { mstRefOf } from "../../lib/catalog/mst/kinds";
import { loadMstItems, type MstItemOptions } from "../../lib/catalog/mst/items";
import { taxonFacts, type TaxonFact } from "../../lib/catalog/mst/taxon";
import { createRescaleCache, type Rescale, type RescaleCache } from "../../lib/raster/rescale";
import {
  loadCatalog,
  loadItems,
  clearCatalogCache,
  type AtlasCatalog,
  type CollectionEntry,
  type LoadError,
  type LoadOptions,
} from "../../lib/catalog/load";
import type { CubeDimension, StacCollection, StacItem } from "../../lib/catalog/types";
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
import { createMstSource, type MstSource } from "./mst.svelte";
import {
  EMPTY_COLLECTION_INPUTS,
  collectionMapInputs,
  formatCellValue,
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
  /** reads the collection's public species list (two small Parquet files); default hyparquet. */
  readSpecies?: typeof readSpeciesData;
  /** the chrome (docked panel, phone sheet) covering the map right now, for the default camera fit. */
  chromePadding?: () => ChromePadding;
  /** MarineSensitivity collections (nc / gm manifests, v7 taxon shards): overrides for tests. */
  mst?: { items?: MstItemOptions; taxon?: import("../../lib/catalog/mst/items").TaxonLoadOptions };
  /** the display-rescale reader (titiler `/cog/statistics`, cached); default the module cache. */
  rescale?: RescaleCache;
}

/** the species list of the clicked cell, for the item's season and group (see `lib/catalog/species.ts`). */
export interface CellSpeciesView {
  fid: number;
  season: string;
  /** the item's group dimension ("all" when it has none). */
  group: string;
  /** Likely / Very likely species of the group, highest probability first. */
  list: CellSpecies[];
  /** how many species the models cover in the group. */
  modeled: number;
  share: GroupShare;
}

/** one value of the item's `metric` dimension at the clicked cell (richness / uncertainty ...). */
export interface SiblingValue {
  /** the metric's label ("Richness"). */
  label: string;
  value: number | null;
  /** true for the metric on the map. */
  current: boolean;
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
  /** the clicked cell (mirrors the store, reactively). */
  readonly cell: CellSelection | null;
  /** the public species list's load state (`idle` when the collection publishes none). */
  readonly speciesPhase: "idle" | "loading" | "ready" | "error";
  readonly speciesError: LoadError | null;
  /** the clicked cell's species list; `null` when there is no cell, no list, or no season dimension. */
  readonly cellSpecies: CellSpeciesView | null;
  /** the clicked cell's value for every metric of the same group and season (empty when the
   * collection has no `metric` dimension). */
  readonly siblings: SiblingValue[];
  /** the MarineSensitivity side of the active collection (taxon search, identifiers, notices). */
  readonly mst: MstSource;
  /** the active item's taxon identifiers (WoRMS / BOTW / GBIF ids, Red List, ESA), as rows. */
  readonly taxonFacts: TaxonFact[];
  /** a sentence to show instead of the layer (an MST taxon with no model here, a failed lookup). */
  readonly notice: string | null;
  /** true while a raster's display rescale is being read from the tile server. */
  readonly rangeLoading: boolean;
  /** true when that read failed (the layer is then not drawn). */
  readonly rangeFailed: boolean;
  /** the dimension values still reachable, per dimension key (`availableValues`). */
  isAvailable(dimKey: string, value: string): boolean;
  /** hand the taxon on screen to the Species lens. */
  openInSpecies(): void;
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

async function defaultFetchJson(url: string): Promise<unknown> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export function createCollectionLens(deps: CollectionLensDeps): CollectionLens {
  const { selStore } = deps;
  const store = deps.cellSelection ?? defaultCellSelection;
  const readValues = deps.readValues ?? readValueColumn;
  const fetchStyle = deps.fetchStyle ?? defaultFetchStyle;
  const readSpecies = deps.readSpecies ?? readSpeciesData;

  let phase = $state<Phase>("loading");
  let error = $state.raw<LoadError | null>(null);
  let catalog = $state.raw<AtlasCatalog | null>(null);
  let loadedItems = $state.raw<StacItem[]>([]);
  let loadedPhase = $state<"idle" | "loading" | "ready" | "error">("idle");
  let loadedError = $state.raw<LoadError | null>(null);
  // the `cube:dimensions` an MST dimension cube (nc / gm) brings with its manifest
  let loadedCube = $state.raw<Record<string, CubeDimension> | null>(null);
  let styleJson = $state.raw<unknown | null>(null);
  let values = $state.raw<ValueColumn | null>(null);
  let valuesLoading = $state(false);
  let valuesError = $state.raw<LoadError | null>(null);
  let cell = $state.raw<CellSelection | null>(store.get());
  let reloadTick = $state(0);
  let painter = $state.raw<HexPainter | null>(null);
  let speciesData = $state.raw<SpeciesData | null>(null);
  let speciesPhase = $state<"idle" | "loading" | "ready" | "error">("idle");
  let speciesError = $state.raw<LoadError | null>(null);
  let siblings = $state.raw<SiblingValue[]>([]);

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
  const speciesCache = new Map<string, SpeciesData>();
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

  // --- MarineSensitivity collections ------------------------------------------------------------
  // taxon collections (v7) draw one taxon at a time (`mst.items`); nc / gm are dimension cubes whose
  // Items come from a manifest; every other collection is the generic STAC flow below.
  const mst = createMstSource({
    selStore,
    entry: () => entry,
    taxonOptions: deps.mst?.taxon,
  });
  const isTaxon = $derived(mst.ref?.kind === "taxon");
  const items = $derived(isTaxon ? mst.items : loadedItems);
  const itemsPhase = $derived(isTaxon ? mst.phase : loadedPhase);
  const itemsError = $derived(isTaxon ? mst.error : loadedError);
  // an MST cube's selectors are labelled and ordered by the manifest's `cube:dimensions`
  const collection = $derived.by((): StacCollection | null => {
    const c = entry?.collection ?? null;
    return c && loadedCube && !isTaxon ? { ...c, "cube:dimensions": loadedCube } : c;
  });

  // --- the items of the active collection (lazy) --------------------------------------------------
  let itemsToken = 0;
  $effect(() => {
    const e = entry;
    void reloadTick;
    const token = ++itemsToken;
    const ref = mstRefOf(e);
    untrack(() => {
      loadedItems = [];
      loadedCube = null;
      loadedError = null;
      loadedPhase = e && ref?.kind !== "taxon" ? "loading" : "idle";
    });
    if (!e || ref?.kind === "taxon") return;
    if (ref) {
      void loadMstItems(e, deps.mst?.items).then((res) => {
        if (token !== itemsToken) return;
        if (res.ok) {
          loadedItems = res.value.items;
          loadedCube = res.value.cube;
          loadedPhase = "ready";
        } else {
          loadedError = res.error;
          loadedPhase = "error";
        }
      });
      return;
    }
    void loadItems(e, { ...deps.loadOptions }).then((res) => {
      if (token !== itemsToken) return;
      if (res.ok) {
        loadedItems = res.value.items;
        loadedPhase = "ready";
      } else {
        loadedError = res.error;
        loadedPhase = "error";
      }
    });
  });

  const view = $derived(viewOf(collection, items, selStore.sel.i));
  const item = $derived(view.item);

  // --- a raster's display rescale (`rescale: "auto"`): titiler's band statistics, cached ------------
  const rescaleCache = deps.rescale ?? createRescaleCache(defaultFetchJson);
  let resolved = $state.raw<{ key: string; range: Rescale } | null>(null);
  let rangeFailedKey = $state<string | null>(null);
  const rangeKey = $derived.by(() => {
    const cog = rasterAssetOf(item);
    if (!item || !cog || cog.rescale !== "auto") return null;
    if (Array.isArray(item.properties?.["atlas:value_range"])) return null;
    return `${cog.url}#${cog.bidx ?? 1}`;
  });
  let rangeToken = 0;
  $effect(() => {
    const key = rangeKey;
    const cog = untrack(() => rasterAssetOf(item));
    const token = ++rangeToken;
    if (!key || !cog) return;
    void rescaleCache.get(cog.url, cog.bidx ?? 1).then((range) => {
      if (token !== rangeToken) return;
      if (range) {
        resolved = { key, range };
        rangeFailedKey = null;
      } else {
        rangeFailedKey = key;
      }
    });
  });
  // the item the map draws: the active one, with its rescale filled in once it has been read
  const drawItem = $derived.by((): StacItem | null => {
    const it = item;
    if (!it || !rangeKey || resolved?.key !== rangeKey) return it;
    return { ...it, properties: { ...it.properties, "atlas:value_range": resolved.range } };
  });
  const rangeLoading = $derived(
    rangeKey !== null && resolved?.key !== rangeKey && rangeFailedKey !== rangeKey,
  );
  const rangeFailed = $derived(rangeKey !== null && rangeFailedKey === rangeKey);

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

  // --- the public species list (fetched once per collection, kept in memory) ------------------------
  let speciesToken = 0;
  $effect(() => {
    const assets =
      selStore.sel.lens === "collection" ? speciesAssetsOf(entry?.collection ?? null) : null;
    const token = ++speciesToken;
    if (!assets) {
      untrack(() => {
        speciesData = null;
        speciesPhase = "idle";
        speciesError = null;
      });
      return;
    }
    const hit = speciesCache.get(assets.cellSpeciesUrl);
    if (hit) {
      untrack(() => {
        speciesData = hit;
        speciesPhase = "ready";
        speciesError = null;
      });
      return;
    }
    untrack(() => {
      speciesData = null;
      speciesPhase = "loading";
      speciesError = null;
    });
    void readSpecies(assets).then((res) => {
      if (token !== speciesToken) return;
      if (res.ok) {
        speciesCache.set(assets.cellSpeciesUrl, res.value);
        speciesData = res.value;
        speciesPhase = "ready";
      } else {
        speciesError = res.error;
        speciesPhase = "error";
      }
    });
  });

  const itemSeason = $derived(item ? itemDims(item).season : undefined);
  const itemGroup = $derived(item ? itemDims(item).group : undefined);

  // fid -> likely-species count for the item's season and group (a plain Map read by the hover handler:
  // one lookup per mousemove, never a fetch); null until the species list is loaded
  let likelyIndex: Map<number, number> | null = null;
  $effect(() => {
    const d = speciesData;
    const season = itemSeason;
    likelyIndex = d && season ? likelyCountIndex(d, season, itemGroup) : null;
  });

  const cellSpecies = $derived.by((): CellSpeciesView | null => {
    if (!cell || !entry || cell.collection !== entry.id || !speciesData || !itemSeason) return null;
    const list = speciesInCell(speciesData, cell.fid, itemSeason, itemGroup);
    const modeled = modeledCount(speciesData, itemGroup);
    return {
      fid: cell.fid,
      season: itemSeason,
      group: itemGroup ?? "all",
      list,
      modeled,
      share: shareByGroup(list, modeled),
    };
  });

  // --- the clicked cell's sibling metrics (richness next to uncertainty, same group and season) -----
  async function columnOf(asset: ValuesAsset): Promise<ValueColumn | null> {
    const key = `${asset.url}#${asset.valueColumn}`;
    const hit = columnCache.get(key);
    if (hit) return hit;
    const res = await readValues(asset.url, {
      keyColumn: asset.keyColumn,
      valueColumn: asset.valueColumn,
    });
    if (!res.ok) return null;
    columnCache.set(key, res.value);
    return res.value;
  }

  let siblingsToken = 0;
  $effect(() => {
    const c = cell;
    const e = entry;
    const it = item;
    const all = items;
    const metricDim = view.dims.find((d) => d.key === "metric");
    const selected = view.selected;
    const token = ++siblingsToken;
    if (!c || !e || !it || c.collection !== e.id || !metricDim || metricDim.values.length < 2) {
      untrack(() => {
        siblings = [];
      });
      return;
    }
    const current = itemDims(it).metric;
    void Promise.all(
      metricDim.values.map(async (v): Promise<SiblingValue | null> => {
        if (v.value === current) return { label: v.label, value: c.value, current: true };
        const other = resolveItem(all, { ...selected, metric: v.value });
        const asset = other ? valuesAssetOf(other) : null;
        if (!asset) return null;
        const col = await columnOf(asset);
        const i = col ? col.fids.indexOf(c.fid) : -1;
        const value = col && i >= 0 ? col.values[i] : null;
        return { label: v.label, value: typeof value === "number" ? value : null, current: false };
      }),
    ).then((rows) => {
      if (token !== siblingsToken) return;
      siblings = rows.filter((r): r is SiblingValue => r !== null);
    });
  });

  // --- the default camera: the collection's own extent, once, unless the URL carries a `map=` ---------
  let fitted = false;
  $effect(() => {
    if (fitted || selStore.sel.lens !== "collection") return;
    const handle = deps.mapHandle();
    const coll = entry?.collection;
    if (!handle || !coll) return;
    fitted = true; // first load only: a later collection switch never moves the camera
    if (untrack(() => selStore.sel.map)) return; // `map=` wins
    const bounds = extentBounds(coll);
    if (!bounds) return;
    handle.flyToBounds(bounds, { padding: deps.chromePadding?.() ?? 40 });
  });

  // --- what the map draws ------------------------------------------------------------------------
  const mapInputs = $derived.by(() => {
    if (selStore.sel.lens !== "collection") return EMPTY_COLLECTION_INPUTS;
    const marker = cell && entry && item && cell.collection === entry.id ? cell.value : null;
    return collectionMapInputs({ entry, item: drawItem, style: styleJson, values, marker });
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
      format: formatCellValue,
      extra: (fid) => (likelyIndex ? likelySpeciesText(likelyIndex.get(fid) ?? 0) : null),
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
    // the taxon travels between the v7 taxon collections (compare the IUCN range with AquaMaps for the
    // same species) and is dropped from the URL elsewhere, where `sp` would mean nothing
    const taxon = mstRefOf(e)?.kind === "taxon";
    if (mstRefOf(entry)?.kind === "taxon") mst.remember(selStore.sel.sp ?? mst.remembered);
    const patch = selPatchFor(entries, e, [], null);
    selStore.set(
      taxon
        ? { ...patch, c: e.id, sp: selStore.sel.sp ?? mst.remembered }
        : { ...patch, sp: undefined },
    );
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
    get cell() {
      return cell;
    },
    get speciesPhase() {
      return speciesPhase;
    },
    get speciesError() {
      return speciesError;
    },
    get cellSpecies() {
      return cellSpecies;
    },
    get siblings() {
      return siblings;
    },
    get mst() {
      return mst;
    },
    get taxonFacts() {
      return taxonFacts(item);
    },
    get notice() {
      return isTaxon ? mst.notice : null;
    },
    get rangeLoading() {
      return rangeLoading;
    },
    get rangeFailed() {
      return rangeFailed;
    },
    openInSpecies() {
      const sp = selStore.sel.sp ?? (isTaxon ? (mst.taxonKey ?? undefined) : undefined);
      if (!sp) return;
      const ds = mstRefOf(entry)?.dsKey;
      selStore.set({
        lens: "species",
        sp,
        in: ds && ds !== "ms_merge" ? ds : "merged",
        c: undefined,
        i: undefined,
      });
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
