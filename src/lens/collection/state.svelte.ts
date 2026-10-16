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
  bandValueOf,
  flowerPetalsFor,
  flowerSpecOf,
  type FlowerView,
} from "../../lib/catalog/flower";
import {
  itemDims,
  itemTitleOf,
  pickEntry,
  selectorOptions as selectorOptionsOf,
  switchedNotice,
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
import { layerExtent, worldView } from "../../lib/catalog/layerExtent";
import { boundsKey, loadAutoZoom, saveAutoZoom, shouldAutoZoom } from "../../lib/map/autoZoom";
import { parseCellSpecies, type CellGrid } from "../../lib/catalog/cellSpecies";
import { carryDecision, makeReturnTo, returnStillValid, type ReturnTarget } from "./returnTo";
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
import { registryRefOf } from "../../lib/catalog/registry/ref";
import { registryFacts } from "../../lib/catalog/registry/item";
import {
  DOWNSCALED_TITLE,
  NATIVE_TITLE,
  downscaledCredits,
  registryAttribution,
} from "../../lib/catalog/registry/credits";
import { loadMstItems, type MstItemOptions } from "../../lib/catalog/mst/items";
import { taxonFacts, type TaxonFact } from "../../lib/catalog/mst/taxon";
import { createRescaleCache, type Rescale, type RescaleCache } from "../../lib/raster/rescale";
import {
  createHistogramCache,
  createTitilerHistogramSource,
  rasterHistogramKey,
  type HistogramCache,
} from "../../lib/raster/histogram";
import { createTitilerValueSource, type ValueSource } from "../../lib/raster/point";
import { createLatestRead, pointInBounds, wrapLon } from "../../lib/raster/pointRead";
import { colorForValue } from "../../lib/raster/ramps";
import { DEFAULT_HISTOGRAM_BINS, type Histogram } from "../../lib/map/density";
import {
  installRasterInteraction,
  type RasterInteractionMap,
} from "../../lib/map/layers/rasterValue";
import { announce } from "../../lib/ui/announcer";
import {
  createCogExtentCache,
  itemSourceBounds,
  type CogExtentCache,
} from "../../lib/raster/bounds";
import {
  loadCatalog,
  loadItems,
  clearCatalogCache,
  unlistedEntryId,
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
import type { Sel } from "../../lib/state/types";
import { createMstSource, type MstSource } from "./mst.svelte";
import {
  createRegistrySource,
  type RegistrySource,
  type RegistrySourceDeps,
} from "./registry.svelte";
import {
  EMPTY_COLLECTION_INPUTS,
  collectionMapInputs,
  formatCellValue,
  formatRasterValue,
  rasterDomainOf,
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
  /** registry-backed taxon collections (AquaMaps native): overrides for tests. */
  registry?: Pick<RegistrySourceDeps, "readRows" | "fetchJson" | "whenIdle">;
  /** the display-rescale reader (titiler `/cog/statistics`, cached); default the module cache. */
  rescale?: RescaleCache;
  /** the COG footprint reader (titiler `/cog/info`, cached); default the module cache. */
  cogExtent?: CogExtentCache;
  /** the legend histogram of a raster item (titiler `/cog/statistics`, cached); default the module cache. */
  histogram?: HistogramCache;
  /** the value under the pointer of a raster item (titiler `/cog/point`); default stock titiler. */
  valueSource?: ValueSource;
  /** where the "Auto-zoom to layer" choice is kept; default the browser's localStorage. */
  storage?: Pick<Storage, "getItem" | "setItem"> | null;
  /** WP4 "Only inside places": the hex FIDs to keep at full opacity (every other painted cell is
   * dimmed), read reactively; `null`/absent = no filter. */
  insideFids?: () => ReadonlySet<number> | null;
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

/** the value of a raster item at a clicked position (`/cog/point`), for the legend marker and the Details tool. */
export interface RasterPoint {
  collection: string;
  item: string;
  /** [lon, lat] as clicked. */
  lngLat: [number, number];
  /** `null` = no data (or not read yet, while `loading`). */
  value: number | null;
  loading: boolean;
  /** the value as text with the item's unit ("87%", "no data"); "" while loading. */
  text: string;
  /** the flower plot of this pixel when the collection declares `atlas:flower` and every band has been read
   * (one `/cog/point` for all petals); `null` otherwise. */
  flower: FlowerView | null;
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
  /** the active item's value column (`FID` + values), `null` until it is read or for a raster item. */
  readonly values: ValueColumn | null;
  /** the clicked cell (mirrors the store, reactively). */
  readonly cell: CellSelection | null;
  /** the clicked position of a raster (COG) item with its value; `null` for none (or a hex item). */
  readonly point: RasterPoint | null;
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
  /** the registry side of the active collection (AquaMaps native: taxon search, representation switch). */
  readonly registry: RegistrySource;
  /** the credit line the map attribution adds while this lens draws a layer that needs one
   * (AquaMaps' CC BY-NC); `null` otherwise. */
  readonly attribution: string | null;
  /** the active item's taxon identifiers (WoRMS / BOTW / GBIF ids, Red List, ESA), as rows. */
  readonly taxonFacts: TaxonFact[];
  /** a sentence to show instead of the layer (an MST taxon with no model here, a failed lookup). */
  readonly notice: string | null;
  /** true while a raster's display rescale is being read from the tile server. */
  readonly rangeLoading: boolean;
  /** true when that read failed (the layer is then not drawn). */
  readonly rangeFailed: boolean;
  /** true when the active layer has an extent the camera can fit (the "Zoom to layer" button's enabled state). */
  readonly canZoomToLayer: boolean;
  /** "Auto-zoom to layer": a change of layer flies the camera to the new layer's extent (a browser setting). */
  readonly autoZoom: boolean;
  setAutoZoom(on: boolean): void;
  /** fly the camera to the active layer's extent (the shell's fit path, centred in the open area). */
  zoomToLayer(): void;
  /** the dimension values still reachable, per dimension key (`availableValues`). */
  isAvailable(dimKey: string, value: string): boolean;
  /** the options of one selector with the reason an unavailable value is unavailable; a taxon-like
   * dimension lists only what exists for the current selection unless `showAll` (`hidden` = how many it
   * leaves out). */
  selectorOptions(
    dimKey: string,
    showAll: boolean,
  ): { options: { value: string; label: string }[]; hidden: number };
  /** hand the taxon on screen to the Species lens. */
  openInSpecies(): void;
  selectCollection(id: string): void;
  selectDim(key: string, value: string): void;
  clearCell(): void;
  /** follow a same-app link (the species panel's "Atlas") in place: the layer changes, the clicked point
   * is carried to it (re-read there, not dropped) and the layer we came from is remembered in `returnTo`. */
  followLink(patch: Partial<Sel>): void;
  /** where "Back to ..." returns to (the layer and camera before the last `followLink`); `null` for none. */
  readonly returnTo: ReturnTarget | null;
  /** return to the layer and camera before the last `followLink`, carrying the clicked point back. */
  goBack(): void;
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

async function defaultFetchJson(url: string, signal?: AbortSignal): Promise<unknown> {
  const res = await fetch(url, signal ? { signal } : undefined);
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
    const extra = selStore.sel.collection;
    void loadCatalog({
      ...deps.loadOptions,
      base,
      ...(extra ? { extraCollections: [extra] } : {}),
    }).then((res) => {
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
  // a `?collection=` link opens on its collection unless the link also says `?c=`
  const entry = $derived(
    pickEntry(
      entries,
      selStore.sel.c ?? (selStore.sel.collection ? unlistedEntryId(entries) : null) ?? undefined,
    ),
  );

  // --- MarineSensitivity collections ------------------------------------------------------------
  // taxon collections (v7) draw one taxon at a time (`mst.items`); nc / gm are dimension cubes whose
  // Items come from a manifest; every other collection is the generic STAC flow below.
  const mst = createMstSource({
    selStore,
    entry: () => entry,
    taxonOptions: deps.mst?.taxon,
  });
  const isTaxon = $derived(mst.ref?.kind === "taxon");
  // registry-backed taxon collections (a collection with `atlas:taxa_registry`: AquaMaps native 0.5
  // degree) also draw one taxon at a time, its Item built from a registry row
  const registry = createRegistrySource({
    selStore,
    entry: () => entry,
    entries: () => entries,
    ...deps.registry,
  });
  const isRegistry = $derived(registry.ref !== null);
  const items = $derived(isTaxon ? mst.items : isRegistry ? registry.items : loadedItems);
  const itemsPhase = $derived(isTaxon ? mst.phase : isRegistry ? registry.phase : loadedPhase);
  const itemsError = $derived(isTaxon ? mst.error : isRegistry ? registry.error : loadedError);
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
    const byRow = registryRefOf(e?.collection) !== null;
    untrack(() => {
      loadedItems = [];
      loadedCube = null;
      loadedError = null;
      loadedPhase = e && ref?.kind !== "taxon" && !byRow ? "loading" : "idle";
    });
    if (!e || ref?.kind === "taxon" || byRow) return;
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
    let it = item;
    if (!it) return it;
    // an item with no title of its own is titled by its dimension labels ("All EOVs (mean) · Risk-weighted share")
    const own = it.properties?.title;
    if (!(typeof own === "string" && own.trim())) {
      const title = itemTitleOf(it, view.dims);
      if (title !== it.id) it = { ...it, properties: { ...it.properties, title } };
    }
    if (!rangeKey || resolved?.key !== rangeKey) return it;
    return { ...it, properties: { ...it.properties, "atlas:value_range": resolved.range } };
  });
  const rangeLoading = $derived(
    rangeKey !== null && resolved?.key !== rangeKey && rangeFailedKey !== rangeKey,
  );
  const rangeFailed = $derived(rangeKey !== null && rangeFailedKey === rangeKey);

  // --- a raster's footprint: the source `bounds`, so a regional COG is never asked for tiles outside it
  // (each would 404). An Item that states its `bbox` (a registry row's) needs no request at all; any other
  // reads `/cog/info.geojson` once per COG. The raster waits for that answer (one small request); an
  // unreadable footprint draws unbounded rather than not at all. -----------------------------------
  const bboxBounds = $derived(itemSourceBounds(item));
  const extentCache = deps.cogExtent ?? createCogExtentCache(defaultFetchJson);
  let extent = $state.raw<{
    url: string;
    bounds: [number, number, number, number] | null;
  } | null>(null);
  const extentUrl = $derived(bboxBounds ? null : (rasterAssetOf(item)?.url ?? null));
  $effect(() => {
    const url = extentUrl;
    if (!url) return;
    void extentCache.get(url).then((bounds) => {
      if (untrack(() => extentUrl) === url) extent = { url, bounds };
    });
  });
  const extentPending = $derived(extentUrl !== null && extent?.url !== extentUrl);

  // --- a raster's legend histogram: titiler's `/cog/statistics` over the item's own range, once per (COG, band)
  // (`raster/histogram.ts`, a display-only read like the rescale above). A fixed-range item (AquaMaps,
  // a manifest rescale) costs this one request; an `auto` item reads its range first (above), then this
  // over that range: the range is the histogram's own parameter, so the two cannot share one call.
  // While it loads, or when it fails, the legend simply has no histogram. -----------------------------
  const histogramCache =
    deps.histogram ?? createHistogramCache(createTitilerHistogramSource(defaultFetchJson));
  const rasterHistKey = $derived.by(() => {
    const cog = rasterAssetOf(drawItem);
    const dom = rasterDomainOf(drawItem, entry?.collection ?? null);
    return cog && dom ? rasterHistogramKey(cog.url, cog.bidx, dom, DEFAULT_HISTOGRAM_BINS) : null;
  });
  let rasterHist = $state.raw<{ key: string; h: Histogram } | null>(null);
  $effect(() => {
    const key = rasterHistKey;
    const cog = untrack(() => rasterAssetOf(drawItem));
    const range = untrack(() => rasterDomainOf(drawItem, entry?.collection ?? null));
    if (!key || !cog || !range) return;
    let cancelled = false;
    void histogramCache
      .get({ cogUrl: cog.url, bidx: cog.bidx, range, bins: DEFAULT_HISTOGRAM_BINS })
      .then((h) => {
        if (!cancelled && h) rasterHist = { key, h };
      });
    return () => {
      cancelled = true;
    };
  });
  // never the previous layer's shape while this one loads
  const rasterHistogram = $derived(
    rasterHistKey !== null && rasterHist?.key === rasterHistKey ? rasterHist.h : null,
  );

  // --- the value of a raster item at the clicked position (`/cog/point`, behind `ValueSource`) -------
  const valueSource = deps.valueSource ?? createTitilerValueSource(defaultFetchJson);
  let rasterPoint = $state.raw<{
    collection: string;
    item: string;
    lngLat: [number, number];
    value: number | null;
    loading: boolean;
    /** every band of the pixel, when the collection has a flower (one read serves all petals) */
    bands: (number | null)[] | null;
    /** the COG those bands belong to: a sibling on the same COG needs no new request */
    bandsUrl: string | null;
  } | null>(null);
  // the COG and band the active item draws, as one key: a read for another key is dropped
  const cogKey = $derived.by(() => {
    const cog = rasterAssetOf(item);
    return cog ? `${cog.url}#${cog.bidx ?? 1}` : null;
  });
  // the bands of the last few pixel reads of a flower collection, by COG and position: the read hands its
  // number to `setPointValue`, which looks the whole answer up here (the interaction's `read` is number-only)
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- a plain cache read by the point reader, never a template
  const bandsRead = new Map<string, (number | null)[]>();
  const bandsKey = (url: string, ll: [number, number]) => `${url}|${ll[0]},${ll[1]}`;
  async function readPoint(lngLat: [number, number], signal: AbortSignal): Promise<number | null> {
    const cog = untrack(() => rasterAssetOf(item));
    const it = untrack(() => item);
    const key = untrack(() => cogKey);
    if (!cog) return null;
    const req = {
      domain: "collection" as const,
      // 5 decimals (about a metre): the same pixel asks the same URL, and the URL stays short
      lon: Math.round(wrapLon(lngLat[0]) * 1e5) / 1e5,
      lat: Math.round(lngLat[1] * 1e5) / 1e5,
      cogUrl: cog.url,
      signal,
    };
    // a flower collection reads ALL bands in one request (the petals are bands of this pixel); the item's
    // own value is its band of that answer
    const flower = untrack(() => flowerSpecOf(entry?.collection) !== null);
    if (flower) {
      const pv = await valueSource.pointValues(req);
      if (key !== untrack(() => cogKey)) throw new Error("the layer changed while reading");
      if (pv) {
        bandsRead.set(bandsKey(cog.url, lngLat), pv.values);
        if (bandsRead.size > 4) bandsRead.delete(bandsRead.keys().next().value as string);
      }
      return bandValueOf(it, pv);
    }
    const v = await valueSource.pointValue({
      ...req,
      ...(cog.bidx === undefined ? {} : { bidx: cog.bidx }),
    });
    if (key !== untrack(() => cogKey)) throw new Error("the layer changed while reading");
    return v;
  }
  function setPointValue(ll: [number, number], value: number | null): void {
    const p = rasterPoint;
    if (!p || p.lngLat[0] !== ll[0] || p.lngLat[1] !== ll[1]) return;
    const url = untrack(() => rasterAssetOf(item)?.url ?? null);
    const bands = url ? (bandsRead.get(bandsKey(url, ll)) ?? null) : null;
    rasterPoint = { ...p, value, loading: false, bands, bandsUrl: bands ? url : null };
  }
  // set by `followLink` / `goBack` for the one follow that carries the clicked point to another collection;
  // `fromKey` is the COG we left, so the item still on screen from it is never taken for the new one
  let carry: { fromKey: string | null } | null = null;
  // the clicked position follows the item (another band or taxon: the same place, this layer's value);
  // another collection, or a hex item, drops it (unless a follow carries it, above)
  const reread = createLatestRead<[number, number], number | null>(readPoint, setPointValue);
  $effect(() => {
    const key = cogKey;
    const it = item;
    const e = entry;
    untrack(() => {
      const p = rasterPoint;
      if (!p) return;
      // a same-app follow (`followLink`, `goBack`) carries the point to the other collection: wait for
      // its item (never the one we came from), then re-key and re-read the pixel there
      const decision = carryDecision({
        carrying: carry !== null,
        pointCollection: p.collection,
        entryId: e?.id ?? null,
        hasItem: !!it && !!key,
        key,
        fromKey: carry?.fromKey ?? null,
      });
      if (decision === "wait") return;
      if (decision === "rekey" && it) {
        carry = null;
        reread.cancel();
        rasterPoint = {
          ...p,
          collection: e!.id,
          item: it.id,
          value: null,
          loading: true,
          bands: null,
          bandsUrl: null,
        };
        reread.run(p.lngLat);
        return;
      }
      if (!key || !it || !e || p.collection !== e.id) {
        reread.cancel();
        rasterPoint = null;
        return;
      }
      if (p.item === it.id) return;
      // a sibling on the COG whose bands were all read already (another petal of the flower) needs no request
      if (p.bands && p.bandsUrl === rasterAssetOf(it)?.url) {
        reread.cancel();
        rasterPoint = {
          ...p,
          item: it.id,
          value: bandValueOf(it, { values: p.bands }),
          loading: false,
        };
        return;
      }
      rasterPoint = { ...p, item: it.id, value: null, loading: true, bands: null, bandsUrl: null };
      reread.run(p.lngLat);
    });
  });
  const rasterPointView = $derived.by((): RasterPoint | null => {
    const p = rasterPoint;
    if (!p || !entry || !item || p.collection !== entry.id || p.item !== item.id) return null;
    return {
      collection: p.collection,
      item: p.item,
      lngLat: p.lngLat,
      value: p.value,
      loading: p.loading,
      text: p.loading ? "" : formatRasterValue(p.value, mapInputs.legend?.unit ?? ""),
      flower:
        p.loading || !p.bands
          ? null
          : flowerPetalsFor(entry, items, view.selected, { values: p.bands }),
    };
  });

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

  // --- the camera: the layer's own extent (WP14) -------------------------------------------------------
  // `layerExtent` picks the frame per kind of item (hex: the collection's extent; registry: the surface's
  // box; nc / gm COGs: the cached `/cog/info.geojson` footprint; else the collection's). The button flies
  // there at any time; "Auto-zoom to layer" (a browser setting, default on) does it when the layer changes.
  // The first layer of a page that opened with `?map=` never moves the camera (the URL is the view), and a
  // fit is a programmatic move: it never writes `map=` (the writer only records the user's own moves).
  const autoStorage = (() => {
    if (deps.storage !== undefined) return deps.storage;
    try {
      return typeof window === "undefined" ? null : window.localStorage;
    } catch {
      return null; // storage blocked
    }
  })();
  let autoZoom = $state(loadAutoZoom(autoStorage));
  const layerFrame = $derived(
    layerExtent({
      item,
      collection: entry?.collection ?? null,
      cogBounds: extent && extent.url === extentUrl ? extent.bounds : null,
    }),
  );
  function fitTo(bounds: NonNullable<typeof layerFrame>["bounds"]): void {
    const handle = deps.mapHandle();
    if (!handle) return;
    // a whole-world layer (AquaMaps) has no frame to centre: look at its middle latitude, same longitude
    const world = worldView(bounds, handle.camera().lon);
    if (world) handle.flyTo({ key: "layer", ...world });
    else handle.flyToBounds(bounds, { padding: deps.chromePadding?.() ?? 40 });
  }
  // the first fit of a page: with auto-zoom on it is the first layer's (below), else the collection's extent
  let fitted = false;
  $effect(() => {
    if (fitted || selStore.sel.lens !== "collection") return;
    const handle = deps.mapHandle();
    const coll = entry?.collection;
    if (!handle || !coll) return;
    fitted = true; // first load only: a later collection switch never moves the camera
    if (untrack(() => autoZoom)) return; // the layer's own frame, once the item resolves
    if (untrack(() => selStore.sel.map)) return; // `map=` wins
    const bounds = extentBounds(coll);
    if (!bounds) return;
    handle.flyToBounds(bounds, { padding: deps.chromePadding?.() ?? 40 });
  });
  // auto-zoom: fly to a layer's frame once (a COG waits for its footprint); a layer in the same frame as
  // the last fit (another season of one hex grid) leaves the camera where the user put it
  let seenLayer = false;
  let lastFrame: string | null = null;
  let skipAutoZoomOnce = false;
  $effect(() => {
    if (selStore.sel.lens !== "collection") return;
    const frame = layerFrame;
    const handle = deps.mapHandle();
    const on = autoZoom;
    const waiting = extentPending;
    if (!item || !frame || !handle || waiting) return;
    untrack(() => {
      const first = !seenLayer;
      seenLayer = true;
      const key = `${entry?.id ?? ""}|${boundsKey(frame.bounds)}`;
      if (key === lastFrame) return;
      const hasMapParam = !!selStore.sel.map;
      lastFrame = key;
      // `goBack` flies to the camera it saved: the layer it returns to must not fly away from it
      if (skipAutoZoomOnce) {
        skipAutoZoomOnce = false;
        return;
      }
      if (shouldAutoZoom({ on, first, hasMapParam })) fitTo(frame.bounds);
    });
  });

  // --- what the map draws ------------------------------------------------------------------------
  // the cell grid of the layer on screen: the collection's own (`atlas:cell_species.grid`) or, for the
  // AquaMaps registry, its surface (0.5 degree native, 0.05 degree downscaled); `null` = ring alone
  const highlightGrid = $derived.by((): CellGrid | null => {
    const own = parseCellSpecies(entry?.collection)?.grid;
    if (own) return own;
    if (!isRegistry) return null;
    const res = registry.rep === "005" ? 0.05 : 0.5;
    return { ncol: Math.round(360 / res), nrow: Math.round(180 / res), x0: -180, y0: 90, res };
  });
  const mapInputs = $derived.by(() => {
    if (selStore.sel.lens !== "collection") return EMPTY_COLLECTION_INPUTS;
    const rp = rasterPoint;
    const marker =
      rp && entry && item && rp.collection === entry.id && rp.item === item.id && !rp.loading
        ? rp.value
        : cell && entry && item && cell.collection === entry.id
          ? cell.value
          : null;
    // the legend names the surface on screen: the downscaled one is not the collection's own native one
    // the clicked position stays on the map (the same condition as `rasterPointView`): a ring, and the
    // cell's square where the layer has a grid (`atlas:cell_species.grid`, or the registry's surface)
    const point =
      rp && entry && item && rp.collection === entry.id && rp.item === item.id
        ? { lngLat: rp.lngLat, grid: highlightGrid }
        : null;
    const legendEntry =
      entry && isRegistry
        ? { ...entry, title: registry.rep === "005" ? DOWNSCALED_TITLE : NATIVE_TITLE }
        : entry;
    const inputs = collectionMapInputs({
      entry: legendEntry,
      item: drawItem,
      style: styleJson,
      values,
      marker,
      histogram: rasterHistogram,
      cogBounds: bboxBounds ?? (extent && extent.url === extentUrl ? extent.bounds : null),
      point,
    });
    // a raster is held back until its footprint is known (the legend and the summaries stay)
    return extentPending && inputs.raster ? { ...inputs, raster: null } : inputs;
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

  // a raster item: the value under the pointer (hover, debounced) and at a click, see
  // `lib/map/layers/rasterValue.ts` (its request budget: `lib/raster/pointRead.ts`)
  const hasRaster = $derived(mapInputs.raster !== null);
  $effect(() => {
    const handle = deps.mapHandle();
    if (!handle || !hasRaster) return;
    const unit = () => untrack(() => mapInputs.legend?.unit ?? "");
    const interaction = installRasterInteraction(handle.map as unknown as RasterInteractionMap, {
      read: readPoint,
      outside: (ll) =>
        !pointInBounds(
          ll[0],
          ll[1],
          untrack(() => bboxBounds ?? (extent && extent.url === extentUrl ? extent.bounds : null)),
        ),
      format: (v) => formatRasterValue(v, unit()),
      subject: () => untrack(() => (item ? itemTitleOf(item, view.dims) : "")),
      color: (v) => {
        const stops = untrack(() => mapInputs.legend?.stops ?? []);
        if (stops.length < 2) return null;
        return colorForValue(
          stops.map((s) => s.color),
          v,
          stops[0].value,
          stops[stops.length - 1].value,
        );
      },
      isOwned: () => deps.isOwned?.() === true || untrack(() => selStore.sel.lens) !== "collection",
      onClickStart: (ll) => {
        const e = untrack(() => entry);
        const it = untrack(() => item);
        if (!e || !it) return;
        reread.cancel();
        carry = null;
        rasterPoint = {
          collection: e.id,
          item: it.id,
          lngLat: ll,
          value: null,
          loading: true,
          bands: null,
          bandsUrl: null,
        };
      },
      onClickValue: setPointValue,
      announce,
    });
    return () => interaction.destroy();
  });

  // --- following a same-app link, and the way back -------------------------------------------------
  let returnTo = $state.raw<ReturnTarget | null>(null);
  // the way back is only good while the layer it was made for is on screen: another collection picked in
  // the selector, or a leave from this lens, ends it (and a point still waiting to be carried)
  $effect(() => {
    const lens = selStore.sel.lens;
    const c = selStore.sel.c ?? entry?.id ?? null;
    untrack(() => {
      if (lens !== "collection") carry = null;
      if (returnTo && !returnStillValid(returnTo, lens, c)) returnTo = null;
    });
  });
  function followLink(patch: Partial<Sel>): void {
    const e = entry;
    returnTo = makeReturnTo({
      sel: selStore.sel,
      camera: deps.mapHandle()?.camera() ?? null,
      label: (item ? itemTitleOf(item, view.dims) : "") || (e?.title ?? ""),
      target: patch.c ?? e?.id ?? "",
    });
    carry = rasterPoint ? { fromKey: cogKey } : null;
    selStore.set(patch);
  }
  function goBack(): void {
    const back = returnTo;
    if (!back) return;
    carry = rasterPoint ? { fromKey: cogKey } : null;
    skipAutoZoomOnce = true;
    returnTo = null;
    selStore.set(back.sel);
    deps
      .mapHandle()
      ?.flyTo({ key: "back", lon: back.camera.lon, lat: back.camera.lat, zoom: back.camera.zoom });
  }

  // --- actions ------------------------------------------------------------------------------------
  function selectCollection(id: string): void {
    const e = entries.find((x) => x.id === id && x.status === "ok");
    if (!e) return;
    store.set(null);
    carry = null;
    returnTo = null;
    switchNotice = null;
    // the taxon travels between the v7 taxon collections (compare the IUCN range with AquaMaps for the
    // same species) and is dropped from the URL elsewhere, where `sp` would mean nothing
    const taxon = mstRefOf(e)?.kind === "taxon";
    if (mstRefOf(entry)?.kind === "taxon") mst.remember(selStore.sel.sp ?? mst.remembered);
    const patch = selPatchFor(entries, e, [], null);
    // a registry collection keys its taxa by its own registry (an AquaMaps key, not a v7 merged key), so
    // the taxon neither travels into it nor out of it; `rep=005` belongs to it alone
    const rep = selStore.sel.rep === "005" ? { rep: "native" as const } : {};
    selStore.set(
      taxon
        ? {
            ...patch,
            ...rep,
            c: e.id,
            sp: isRegistry ? mst.remembered : (selStore.sel.sp ?? mst.remembered),
          }
        : { ...patch, ...rep, sp: undefined },
    );
  }

  // "Switched to <species>: <old species> has no Atlantic model." after a selector change moved the taxon
  let switchNotice = $state<string | null>(null);
  function selectDim(key: string, value: string): void {
    const next = selectDimItem(items, view.selected, key, value);
    switchNotice = null;
    if (!next) return;
    switchNotice = switchedNotice({
      dims: view.dims,
      before: view.selected,
      after: { ...view.selected, ...itemDims(next) },
      changed: key,
    });
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
      const c = entry?.collection ?? null;
      // the downscaled surface on screen is MarineSensitivity's: its citation and license
      return isRegistry && registry.downscaled && c
        ? creditsOf(downscaledCredits(registry.downscaled, c))
        : creditsOf(c);
    },
    get attribution() {
      return registryAttribution(isRegistry && mapInputs.raster !== null);
    },
    get registry() {
      return registry;
    },
    get mapInputs() {
      return mapInputs;
    },
    get itemTitle() {
      return item ? itemTitleOf(item, view.dims) : null;
    },
    get itemDescription() {
      const d = item?.properties?.description;
      return typeof d === "string" && d.trim() ? d.trim() : null;
    },
    get drawable() {
      // a raster held back for its footprint is still a drawable item (its legend is up)
      return (
        mapInputs.hex !== null ||
        mapInputs.raster !== null ||
        mapInputs.range !== null ||
        (extentPending && mapInputs.legend !== null)
      );
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
    get point() {
      return rasterPointView;
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
      return isRegistry ? registryFacts(item) : taxonFacts(item);
    },
    get notice() {
      return isTaxon ? mst.notice : isRegistry ? registry.notice : switchNotice;
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
    get canZoomToLayer() {
      return layerFrame !== null;
    },
    get autoZoom() {
      return autoZoom;
    },
    setAutoZoom(on) {
      autoZoom = on;
      saveAutoZoom(autoStorage, on);
    },
    zoomToLayer() {
      const frame = layerFrame;
      if (frame) fitTo(frame.bounds);
    },
    selectorOptions(dimKey, showAll) {
      const dim = view.dims.find((d) => d.key === dimKey);
      if (!dim) return { options: [], hidden: 0 };
      return selectorOptionsOf({ dim, dims: view.dims, items, selected: view.selected, showAll });
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
      reread.cancel();
      carry = null;
      rasterPoint = null;
    },
    followLink,
    get returnTo() {
      return returnTo;
    },
    goBack,
    reload() {
      clearCatalogCache(deps.loadOptions?.cache);
      catalog = null;
      reloadTick++;
    },
  };
}
