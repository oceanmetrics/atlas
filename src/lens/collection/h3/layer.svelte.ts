// The H3 layer of the Collections lens (build week 4, step 5): an `h3` collection (the obis-h3 release) drawn by the
// map package's release slot (`h3ReleaseSlot`: the release's own Parquet read in MapLibre's worker, every indicator
// in each tile), mounted on a style recorder as `cogSlot` is, so its source and fill go into the one composed
// style (`H3LayerSpec`, `setStyle(diff)`). A LAZY module: `state.svelte.ts` imports it only when the active
// collection declares the `h3` profile, so the static path carries none of it, and the h3 worker module is added to
// MapLibre's worker here, by a second `setupMapLibre` (`h3WorkerUrl`), the first time an h3 collection opens.
//
// The rules live in the plain modules beside it (view.ts, paint.ts, periods.ts, taxa.ts, cellSpecies.ts); this file
// only wires them to the URL (`Sel`: `i`, `taxon`, `dim.indicator`, `dim.period`, `res`, `cell`) and the map.
/* eslint-disable svelte/prefer-svelte-reactivity -- the Maps and Sets here are locals of readers and caches; the
   reactive state is `$state.raw`, always reassigned whole */
import {
  H3_LAYER,
  ReleaseReader,
  newReadStats,
  type ReadStats,
  cellIdOf,
  cellIdRes,
  h3ReleaseSlot,
  releaseFilter,
  releaseSource,
  setupMapLibre,
  type H3ReleaseSlot,
  type StatsRow,
} from "@oceanmetrics/map";
import h3WorkerUrl from "@oceanmetrics/map/h3-worker?worker&url";
import { addProtocol, importScriptInWorkers, setWorkerUrl } from "maplibre-gl";
import maplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import type { Map as MapLibreMap, MapLayerMouseEvent } from "maplibre-gl";
import { untrack } from "svelte";
import { filterColl as filterCollOf } from "../../../lib/gazetteer/overlayUrl";
import type { MembershipCollection } from "../../../lib/gazetteer/resolve";
import { BRAND_NAME } from "../../../lib/brand/instance";
import type { H3Spec } from "../../../lib/catalog/h3";
import type { CollectionEntry } from "../../../lib/catalog/load";
import type { StacItem } from "../../../lib/catalog/types";
import { SELECTION_COLOR } from "../../../lib/map/colors";
import type { MapHandle } from "../../../lib/map/map";
import { createPopup, detailsLinkHtml } from "../../../lib/map/popup";
import type { H3LayerSpec } from "../../../lib/map/types";
import type { SelStore } from "../../../lib/state/sel.svelte";
import type { CollectionLegend } from "../mapInputs";
import {
  CACHE_MAX,
  readCellRows,
  readLookup,
  SPECIES_TAIL,
  speciesRows,
  totalsNote,
  totalsOf,
  overlapsPeriod,
  type CellSpeciesList,
  type LookupRow,
} from "./cellSpecies";
import {
  coverageText,
  domainAt,
  placePart,
  rampOn,
  resNote,
  sentenceParts,
  statusLine,
  filteredCoverage,
  withinPart,
  type SentenceParts,
  formatIndicator,
  h3FillColor,
  hoverLines,
  legendStops,
  legendSubtitle,
  resAtZoom,
  scaleOf,
  sentenceText,
  shortLabel,
} from "./paint";
import {
  aboutLines,
  boxKm2,
  boxOfRings,
  cellFileUrls,
  feedTileStats,
  footerText,
  tilesLine,
  type TileCounts,
  h3ShortcutFor,
  obisChecklistUrl,
  pinForView,
  pngStamp,
  releaseMetaOf,
  reproduceSql,
  viewDomain,
  type ReleaseMeta,
} from "./share";
import {
  FILTER_MAX_CELLS,
  allCells,
  collFilterNote,
  collectionPlan,
  membershipFiles,
  parseMembership,
  placeFilterExpr,
  placeFilterNote,
  readMembershipCells,
  seaPatch,
  type MembershipManifest,
} from "./placeFilter";
import {
  periodBars,
  readPeriodRows,
  stripMessage,
  type PeriodBar,
  type PeriodStatRow,
} from "./periods";
import {
  BOX_RES,
  boxHolds,
  boxPart,
  boxRanges,
  ESN,
  rangeOf,
  readLine,
  subtreeAsk,
  subtreeCoverage,
  subtreeLine,
  subtreeRes,
  subtreeTableOf,
  subtreeTaxonPart,
  taxonLine,
  viewBox,
  type Box,
  type SubtreeDomain,
} from "./subtree";
import type { SubtreeOutcome } from "./subtreeRun";
import { headsOf, layerRows, readTaxonRows, type LayerRow } from "./taxa";
import { wormsByName, wormsPageUrl, wormsRecord, type FetchLike, type WormsRecord } from "./worms";
import {
  h3ViewOf,
  headRowOf,
  itemKindOf,
  releaseTarget,
  subtreeTarget,
  taxonParam,
  taxonRowOf,
  type H3View,
  type HeadRow,
  type ReleaseTarget,
  type TaxonRow,
} from "./view";

export interface H3LayerDeps {
  selStore: SelStore;
  mapHandle: () => MapHandle | undefined;
  /** true while a place pick/draw session owns map clicks */
  isOwned?: () => boolean;
  entry: () => CollectionEntry | null;
  item: () => StacItem | null;
  /** the collection's Items: a taxon filters the all-taxa one */
  items: () => readonly StacItem[];
  spec: () => H3Spec | null;
  /** the app's name and version for the footer and the citation ("OceanMetrics Atlas 0.5.0") */
  app?: string;
  /** readers (tests) */
  readTaxa?: typeof readTaxonRows;
  fetchJson?: (url: string) => Promise<unknown>;
  /** the WoRMS REST fetch (tests) */
  wormsFetch?: FetchLike;
  /** the subtree's runner (tests); default the lazy `subtreeRun.ts` */
  runSubtree?: (typeof import("./subtreeRun"))["runSubtree"];
}

/** the WoRMS subtree the layer shows (`taxon=aphia:<id>` that is no head, or a `<rank>:<name>` with no layer) */
export interface SubtreeView {
  phase: "resolving" | "computing" | "ready" | "refused" | "empty" | "error";
  /** the AphiaID whose subtree is computed (the accepted one of a synonym) */
  aphiaid: number | null;
  name: string;
  rank: string | null;
  record: WormsRecord | null;
  /** "subtree of Cetacea (computed in the browser from the species table, res ≤ 5)" */
  line: string;
  /** the taxon's line: name, rank, status, the accepted name, records */
  taxonLine: string | null;
  /** the taxon's page in WoRMS */
  wormsUrl: string | null;
  /** what the last computation read */
  readLine: string | null;
  /** an over-cap refusal, an error, or why nothing is drawn */
  message: string | null;
  /** the resolution computed and the cap */
  res: number | null;
  cap: number;
}

export interface CellView {
  h3: string;
  res: number;
  /** the five indicators of the hexagon in the layer and period on the map; null while read */
  values: Record<string, number | null> | null;
  /** the release median of the indicator at the hexagon's resolution (stats.parquet p50) */
  median: number | null;
}

export interface H3Layer {
  readonly style: H3LayerSpec | null;
  readonly legend: CollectionLegend | null;
  readonly target: ReleaseTarget | null;
  readonly view: H3View | null;
  /** the resolution the map draws now */
  readonly shownRes: number | null;
  readonly coverage: string;
  readonly sentence: string;
  readonly notes: string[];
  readonly bars: PeriodBar[];
  readonly stripNote: string | null;
  readonly taxa: TaxonRow[] | null;
  readonly taxaPhase: "idle" | "loading" | "ready" | "error";
  readonly taxon: TaxonRow | null;
  readonly taxonNote: string | null;
  /** the WoRMS subtree, when the taxon is one */
  readonly subtree: SubtreeView | null;
  /** show the subtree of an AphiaID (a pick of "Search all of WoRMS") */
  setAphia(id: number): void;
  readonly cell: CellView | null;
  readonly species: {
    phase: "idle" | "loading" | "ready" | "error";
    list: CellSpeciesList | null;
    error: string | null;
    /** the OBIS API checklist of the hexagon's box, when the species table cannot be read */
    checklist?: string | null;
  };
  readonly statsRows: StatsRow[] | null;
  /** the title sentence as chips (taxon, period, place, hexagon size, indicator) */
  readonly parts: SentenceParts | null;
  /** what the map is waiting for, or why it shows nothing (null when the hexagons are drawn) */
  readonly status: string | null;
  /** release.json, once read */
  readonly meta: ReleaseMeta | null;
  /** the footer line: OBIS and WoRMS dates, the release, the resolution, the app */
  readonly footer: string;
  /** Reproduce: DuckDB SQL over the layer's own file for the view (and the selected hexagon) */
  readonly reproduce: string;
  /** the ramp's domain: the release's (stats.parquet) or the loaded hexagons' */
  readonly domain: "release" | "view";
  /** All taxa and the EOVs, most records first */
  readonly layers: LayerRow[];
  /** the selected Item (`i=`) */
  readonly layerId: string | null;
  /** the place filter's line, null when the filter is off */
  readonly filterNote: string | null;
  /** `filter=coll:<slug>`: the collection the hexagons are filtered to, else null */
  readonly filterColl: string | null;
  /** the polygon collections with an H3 membership (the filter's choices); null until `ensureCollections` reads them */
  readonly collections: readonly MembershipCollection[] | null;
  ensureCollections(): void;
  /** filter the hexagons to a whole gazetteer collection, or (null) turn the filter off */
  setFilterColl(slug: string | null): void;
  /** the selected places' collections (Data sources) */
  readonly placeSources: { title: string; citation: string | null; license: string | null }[];
  /** the app's name and version */
  readonly app: string;
  /** the About modal's section of the layer */
  readonly about: { title: string; lines: string[] } | null;
  /** what the map PNG is stamped with */
  readonly stamp: ReturnType<typeof pngStamp> | null;
  ensureTaxa(): void;
  setDomain(d: "release" | "view"): void;
  setLayer(id: string): void;
  /** fly to a sea or ocean (a camera preset), clearing the places and their filter */
  goToSea(id: string): void;
  setIndicator(v: string): void;
  setPeriod(token: string): void;
  setRes(r: "auto" | number): void;
  setTaxon(row: TaxonRow | null): void;
  selectCell(h3: string | null): void;
  destroy(): void;
}

const esc = (t: string) =>
  t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
/** the popup's lines as HTML (each line escaped; the chosen indicator bold) */
const linesHtml = (lines: readonly string[]) =>
  `<div class="atlas-popup-lines">${lines
    .map((l) =>
      l.startsWith("▸ ") ? `<div><b>${esc(l.slice(2))}</b></div>` : `<div>${esc(l)}</div>`,
    )
    .join("")}</div>`;

/** the place filter's reads: the cells per resolution for the current places (or the collection) */
interface MembershipState {
  key: string;
  phase: "idle" | "loading" | "ready" | "error";
  error: string | null;
  byRes: Map<number, string[]>;
  without: string[];
  minShare: number;
  sources: { title: string; citation: string | null; license: string | null }[];
  /** a collection filter: its title, whether it has no membership at all, the resolutions over the read cap */
  title: string | null;
  noMembership: boolean;
  over: ReadonlySet<number>;
}
const emptyMembership = (key: string): MembershipState => ({
  key,
  phase: "idle",
  error: null,
  byRes: new Map(),
  without: [],
  minShare: 0.01,
  sources: [],
  title: null,
  noMembership: false,
  over: new Set(),
});

// ---- the worker: the h3 module joins MapLibre's worker once per page ----------------------------------------
let workerReady: Promise<void> | null = null;
export function ensureH3Worker(): Promise<void> {
  workerReady ??= setupMapLibre({
    maplibre: { addProtocol, importScriptInWorkers, setWorkerUrl },
    workerUrl: maplibreWorkerUrl,
    h3WorkerUrl,
  });
  return workerReady;
}

// ---- the recorder: a stand-in map the slot mounts on (its source and fill go into the composed style) -------
function recorder(zoom: () => number): MapLibreMap {
  const m = {
    addSource: () => undefined,
    addLayer: () => undefined,
    getLayer: () => undefined,
    getSource: () => undefined,
    removeLayer: () => undefined,
    removeSource: () => undefined,
    setPaintProperty: () => undefined,
    setFilter: () => undefined,
    getZoom: zoom,
    on: () => undefined,
    off: () => undefined,
  };
  return m as unknown as MapLibreMap;
}

const SELECTED_WIDTH = 3;
/** the hexagons' fill opacity (obis-hex's default `o=0.85`); the Layers panel's opacity scales it */
export const H3_FILL_OPACITY = 0.85;

/** the main thread's reader (the Cell pane's values and species): files opened once, row groups cached */
const pageReader = new ReleaseReader({ maxBytes: 32 * 1024 * 1024 });
/** the species table's own reader, one per page: its 245 KB footer is read once (a 256 KiB tail, one request) and
 * kept for every hexagon after the first; `speciesForCell` reads the row groups of the hexagon's range only. */
const speciesReader = new ReleaseReader({ maxBytes: 32 * 1024 * 1024, tail: SPECIES_TAIL });
let lookupPromise: {
  href: string;
  p: Promise<Map<number, LookupRow>>;
  stats: ReadStats;
  counted: boolean;
} | null = null;

export function createH3Layer(deps: H3LayerDeps): H3Layer {
  const { selStore } = deps;
  const appName = deps.app ?? `${BRAND_NAME} ${__APP_VERSION__}`;
  const fetchJson =
    deps.fetchJson ??
    (async (url: string) => {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    });
  const readTaxa = deps.readTaxa ?? readTaxonRows;

  let destroyRoot = () => {};
  let zoom = $state(deps.mapHandle()?.map.getZoom?.() ?? 2);
  let statsRows = $state.raw<StatsRow[] | null>(null);
  let statsTick = $state(0);
  let taxa = $state.raw<TaxonRow[] | null>(null);
  let heads = $state.raw<HeadRow[]>([]);
  let taxaPhase = $state<"idle" | "loading" | "ready" | "error">("idle");
  let periodRows = $state.raw<{ key: string; rows: PeriodStatRow[] } | null>(null);
  let cellValues = $state.raw<{ key: string; values: Record<string, number | null> | null } | null>(
    null,
  );
  let species = $state.raw<H3Layer["species"]>({ phase: "idle", list: null, error: null });
  let meta = $state.raw<ReleaseMeta | null>(null);
  /** what the slot's tiles cost since it was mounted (the map package's `stats()`, fed once per frame) */
  let tileStats = $state.raw<TileCounts | null>(null);
  /** the hexagons in the map's loaded tiles at the drawn resolution (read on idle), their five values */
  let loaded = $state.raw<{
    key: string;
    res: number;
    cells: Record<string, number | null>[];
  } | null>(null);
  /** the map's view area, km² (a pinned split resolution steps down past MAX_PARENTS parents) */
  let viewKm2 = $state(0);
  // the place filter: the places codec (lazy), each place's membership, and the cells per resolution
  let placesModel = $state.raw<typeof import("../../../places/model") | null>(null);
  let membership = $state.raw<MembershipState>(emptyMembership(""));

  const spec = $derived(deps.spec());
  const entry = $derived(deps.entry());
  const item = $derived(deps.item());

  // the taxon the URL names: a row of the search asset, or a head by AphiaID
  const taxonParamNow = $derived(selStore.sel.taxon);
  // the species table a WoRMS subtree is computed from (the collection document's own fields)
  const subtreeTable = $derived(
    subtreeTableOf(entry?.collection as unknown as Record<string, unknown> | null),
  );
  const resolved = $derived.by(() => {
    const p = taxonParamNow;
    const none = { row: null as TaxonRow | null, note: null as string | null, subtree: false };
    if (!p) return none;
    if (!taxa) return none;
    if (p.startsWith("aphia:")) {
      const h = headRowOf(heads, taxa, p);
      if (h.subtree && !subtreeTable)
        return {
          ...none,
          note: `AphiaID ${p.slice(6)} is not one of the release's precomputed taxa, and the release publishes no species table to compute its subtree from.`,
        };
      return { row: h.row, note: h.reason, subtree: h.subtree };
    }
    const row = taxonRowOf(taxa, p);
    if (row) return { ...none, row };
    // a rank:name the release has no layer for is a WoRMS subtree
    return subtreeTable
      ? { ...none, subtree: true }
      : { ...none, note: `The release has no taxon layer ${p}.` };
  });
  const waitingForTaxa = $derived(!!taxonParamNow && taxa === null && taxaPhase !== "error");
  const ask = $derived(resolved.subtree ? subtreeAsk(taxonParamNow) : null);

  // ---- the WoRMS subtree: its record (WoRMS REST), then its cells (DuckDB-WASM over the species table) ----------
  const wormsFetch: FetchLike = deps.wormsFetch ?? ((u, i) => fetch(u, i));
  let worms = $state.raw<{
    key: string;
    phase: "loading" | "ready" | "error";
    record: WormsRecord | null;
    error: string | null;
  } | null>(null);
  let viewBounds = $state.raw<Box | null>(null);
  /** the box the res-5 cells were computed for (kept while the view stays inside it) */
  let box = $state.raw<Box | null>(null);
  let run = $state.raw<{
    key: string;
    phase: "computing" | "done" | "error";
    outcome: SubtreeOutcome | null;
    error: string | null;
  } | null>(null);
  /** the last computed cells the map draws (kept while the next computation runs) */
  let drawn = $state.raw<{
    key: string;
    aphiaid: number;
    decade: string | null;
    href: string;
    res: number;
    box: Box | null;
    cells: number;
    domains: Record<string, SubtreeDomain | null>;
    taxa: ReadonlySet<number>;
    records: number;
    sql: string;
    readLine: string;
  } | null>(null);
  const oldHrefs: string[] = [];
  const subtreeAphia = $derived.by((): number | null => {
    if (!ask) return null;
    const w = worms;
    if (!w || w.key !== taxonParamNow) return null;
    if (w.record) return w.record.acceptedId;
    return ask.kind === "aphia" && w.phase === "error" ? ask.id : null;
  });
  /** the WoRMS record of the taxon the URL names now, once read */
  const recordNow = $derived(worms && worms.key === taxonParamNow ? worms.record : null);
  const subtreeName = $derived(
    recordNow
      ? recordNow.acceptedId !== recordNow.id
        ? recordNow.acceptedName
        : recordNow.name
      : ask?.kind === "name"
        ? ask.name
        : ask
          ? `AphiaID ${ask.id}`
          : "",
  );
  const subtreeRank = $derived(recordNow ? recordNow.rank : ask?.kind === "name" ? ask.rank : null);
  /** the decade a subtree is computed for (`dim.period=<yyy0>s` of the species table's decade variant), else null */
  const subtreeDecade = $derived.by((): string | null => {
    if (!ask || !subtreeTable?.decade || !spec) return null;
    const tok = selStore.sel.dim?.[spec.viewDims.period ?? "period"];
    if (!tok || !tok.endsWith("s")) return null;
    const v = tok.slice(0, -1);
    return subtreeTable.decade.decades.includes(v) ? v : null;
  });
  const subtreePlanNow = $derived.by(() => {
    if (!ask || !subtreeTable) return null;
    return subtreeRes({
      res: selStore.sel.res ?? "auto",
      zoom,
      decade: subtreeDecade !== null,
      tableRes: subtreeDecade ? subtreeTable.decade!.resolutions : subtreeTable.resolutions,
    });
  });
  const subtreeKey = $derived.by((): string | null => {
    const a = subtreeAphia;
    const pl = subtreePlanNow;
    if (a === null || !pl) return null;
    const b = pl.res >= BOX_RES ? box : null;
    if (pl.res >= BOX_RES && !b && viewBounds && viewBox(viewBounds) !== null) return null;
    return JSON.stringify([a, pl.res, pl.tableRes, subtreeDecade, b]);
  });

  const target = $derived.by((): ReleaseTarget | null => {
    if (!spec || !entry || !item || waitingForTaxa) return null;
    if (resolved.subtree) {
      // the cells of this taxon and period only (a new taxon draws nothing until its cells are in)
      const d = drawn;
      if (!d || d.aphiaid !== subtreeAphia || d.decade !== subtreeDecade) return null;
      return subtreeTarget(spec, entry.id, {
        href: d.href,
        res: d.res,
        name: subtreeName,
        rank: subtreeRank,
        decades: subtreeTable?.decade?.decades ?? [],
        decadeRes: [1, 2, ...(subtreeTable?.decade?.resolutions ?? [])],
      });
    }
    return releaseTarget(spec, entry.id, item, resolved.row);
  });
  const view = $derived.by((): H3View | null => {
    if (!spec || !target) return null;
    const v = h3ViewOf({ dim: selStore.sel.dim, res: selStore.sel.res }, spec, target);
    if (target.kind !== "subtree" || !subtreePlanNow) return v;
    // a subtree: the ladder is the subtree's (1 to its cap), the pin clamped to it with the plan's words
    const cap = subtreePlanNow.cap;
    return {
      ...v,
      ladder: Array.from({ length: cap }, (_, i) => i + 1),
      res: selStore.sel.res === undefined ? "auto" : Math.min(cap, Math.max(1, selStore.sel.res)),
      notes: [
        ...v.notes.filter((n) => !n.startsWith("A decade layer") && !n.startsWith("This layer")),
        ...(subtreePlanNow.note ? [subtreePlanNow.note] : []),
      ],
    };
  });

  // a pinned split resolution over a wide view draws a coarser one (obis-hex's MAX_PARENTS fallback)
  const layoutParentRes = $derived(
    (target?.collection["h3:layout"] as { parent_res?: Record<string, number> } | undefined)
      ?.parent_res ?? null,
  );
  const pinPlan = $derived(
    view && target?.kind !== "subtree" ? pinForView(view.res, layoutParentRes, viewKm2) : null,
  );
  // a subtree's Parquet holds one resolution: the slot draws it
  const effRes = $derived(
    target?.kind === "subtree" && drawn ? drawn.res : (pinPlan?.res ?? "auto"),
  );

  // ---- the place filter (`?filter=places` with gazetteer places in the hash) ---------------------------------------
  const filterColl = $derived(filterCollOf(selStore.sel.filter));
  let collections = $state.raw<readonly MembershipCollection[] | null>(null);
  let collectionsLoading = false;
  /** the collection's words in the sentence, coverage and status: its title once read, else the list's, else the slug */
  const collTitle = $derived(
    membership.title ?? collections?.find((c) => c.slug === filterColl)?.title ?? filterColl ?? "",
  );
  const placesOn = $derived(selStore.sel.filter === "places");
  const filterOn = $derived(placesOn || filterColl !== null);
  const filterPlaces = $derived(
    placesOn && placesModel ? placesModel.placesFromHash(selStore.sel.pl) : [],
  );
  const gazPlaces = $derived(
    filterPlaces.flatMap((p) => (p.kind === "gaz" ? [{ id: p.id, name: p.name || p.id }] : [])),
  );
  const placesKey = $derived(gazPlaces.map((p) => p.id).join("|"));
  const domain = $derived<"release" | "view">(selStore.sel.dom === "view" ? "view" : "release");

  // ---- the slot: one per target (layer templates + item), updated for indicator, period and resolution -------
  let slot = $state.raw<H3ReleaseSlot | null>(null);
  let slotKey = "";
  const rec = recorder(() => untrack(() => zoom));

  // ---- the period strip and taxa: one read each ---------------------------------------------------------------
  const periodCache = new Map<string, PeriodStatRow[]>();
  const listCache = new Map<string, CellSpeciesList>();

  // the tiles are asked only once the h3 module is in MapLibre's worker (an `h3r://` request before it fails)
  let workerOk = $state(false);
  let workerError = $state<string | null>(null);
  void ensureH3Worker().then(
    () => (workerOk = true),
    (e: unknown) => (workerError = e instanceof Error ? e.message : String(e)),
  );

  destroyRoot = $effect.root(() => {
    // the map's zoom (the legend and coverage follow the resolution drawn)
    $effect(() => {
      const handle = deps.mapHandle();
      if (!handle) return;
      const m = handle.map;
      const on = () => (zoom = m.getZoom());
      on();
      m.on("zoomend", on);
      return () => m.off("zoomend", on);
    });

    // the taxa when a link names one (the field asks with ensureTaxa)
    $effect(() => {
      if (taxonParamNow && taxaPhase === "idle") untrack(() => loadTaxa());
    });

    $effect(() => {
      const t = target;
      const v = view;
      if (!t || !v) {
        untrack(() => {
          slot = null;
          slotKey = "";
          statsRows = null;
        });
        return;
      }
      const key = JSON.stringify([t.collection["h3:layout"], t.collection["h3:periods"], t.item]);
      untrack(() => {
        // a subtree's file is the period's own (computed for it): the slot has no period to pick
        const periodArg =
          v.periodRef && t.kind !== "subtree"
            ? { grain: v.periodRef.grain, value: v.periodRef.value }
            : null;
        if (key !== slotKey || !slot) {
          slotKey = key;
          statsRows = null;
          const s = h3ReleaseSlot({
            collection: t.collection,
            item: t.item,
            indicator: v.indicator,
            period: periodArg,
            res: untrack(() => effRes),
            title: t.label,
            opacity: H3_FILL_OPACITY,
            // a subtree has no stats.parquet: its legend is the computed cells' own
            ...(t.kind === "subtree" ? { statsHref: null } : {}),
            onchange: () => queueMicrotask(() => statsTick++),
          });
          s.mount(rec, null, null);
          slot = s;
        } else {
          slot.update({ indicator: v.indicator, period: periodArg, res: untrack(() => effRes) });
        }
        statsTick++;
      });
    });

    // the drawn resolution follows the pinned one's plan (a wide view steps a split resolution down)
    $effect(() => {
      const r = effRes;
      const s = untrack(() => slot);
      const v = untrack(() => view);
      if (!s || !v) return;
      untrack(() => {
        s.update({
          indicator: v.indicator,
          period:
            v.periodRef && target?.kind !== "subtree"
              ? { grain: v.periodRef.grain, value: v.periodRef.value }
              : null,
          res: r,
        });
        statsTick++;
      });
    });

    // release.json (the footer, Cite, About, Data sources): once per collection
    $effect(() => {
      const href = spec?.releaseMeta;
      if (!href) return;
      void fetchJson(href).then(
        (j) => {
          if (untrack(() => spec?.releaseMeta) === href) meta = releaseMetaOf(j);
        },
        () => {
          /* the words leave the dates out */
        },
      );
    });

    // the map's view area and the hexagons in its loaded tiles (on idle: the tiles are in)
    $effect(() => {
      const handle = deps.mapHandle();
      const s = slot;
      if (!handle || !s) return;
      const m = handle.map;
      const onMove = () => {
        try {
          const b = m.getBounds();
          viewKm2 = boxKm2(b.getWest(), b.getSouth(), b.getEast(), b.getNorth());
          viewBounds = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
        } catch {
          /* a map without bounds yet */
        }
      };
      const onIdle = () => untrack(() => readLoaded(m, s));
      onMove();
      m.on("moveend", onMove);
      m.on("idle", onIdle);
      return () => {
        m.off("moveend", onMove);
        m.off("idle", onIdle);
      };
    });

    // the view's bounds for the subtree's box (before any slot exists)
    $effect(() => {
      const handle = deps.mapHandle();
      if (!handle || !ask) return;
      const m = handle.map;
      const on = () => {
        try {
          const b = m.getBounds();
          viewBounds = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
        } catch {
          /* a map without bounds yet */
        }
      };
      on();
      m.on("moveend", on);
      return () => m.off("moveend", on);
    });

    // the WoRMS record of the subtree's taxon (its name, rank, status, the accepted id of a synonym)
    $effect(() => {
      const a = ask;
      const key = taxonParamNow;
      if (!a || !key) return;
      if (untrack(() => worms?.key) === key) return;
      untrack(() => (worms = { key, phase: "loading", record: null, error: null }));
      const p =
        a.kind === "aphia"
          ? wormsRecord(a.id, wormsFetch)
          : wormsByName(a.rank, a.name, wormsFetch);
      void p.then(
        (record) => {
          if (untrack(() => worms?.key) !== key) return;
          worms = record
            ? { key, phase: "ready", record, error: null }
            : {
                key,
                phase: "error",
                record: null,
                error:
                  a.kind === "aphia"
                    ? `WoRMS has no record of AphiaID ${a.id}.`
                    : `WoRMS has no ${a.rank} ${a.name}.`,
              };
        },
        (e: unknown) => {
          if (untrack(() => worms?.key) === key)
            worms = {
              key,
              phase: "error",
              record: null,
              error: `WoRMS could not be asked: ${e instanceof Error ? e.message : String(e)}`,
            };
        },
      );
    });

    // the box of a res-5 subtree: the view grown by a quarter, kept while the view stays inside it
    $effect(() => {
      const b = viewBounds;
      const pl = subtreePlanNow;
      if (!b || !pl || pl.res < BOX_RES) return;
      const cur = untrack(() => box);
      if (cur === null || !boxHolds(cur, b)) box = viewBox(b);
    });

    // the subtree's cells: one computation per (AphiaID, resolution, decade, box), the last one drawn meanwhile
    $effect(() => {
      const key = subtreeKey;
      const tbl = subtreeTable;
      const pl = subtreePlanNow;
      const a = subtreeAphia;
      if (!key || !tbl || !pl || a === null) return;
      if (untrack(() => run?.key) === key) return;
      const name = untrack(() => subtreeName);
      const b = pl.res >= BOX_RES ? untrack(() => box) : null;
      const ranges = b
        ? boxRanges(
            b,
            pl.tableRes,
            Math.max(
              untrack(() => zoom),
              6,
            ),
          )
        : null;
      untrack(() => (run = { key, phase: "computing", outcome: null, error: null }));
      const runner = deps.runSubtree
        ? Promise.resolve(deps.runSubtree)
        : import("./subtreeRun").then((m) => m.runSubtree);
      void runner
        .then((go) =>
          go({
            table: tbl,
            aphiaid: a,
            name,
            res: pl.res,
            tableRes: pl.tableRes,
            decade: untrack(() => subtreeDecade),
            ranges,
            indicators: untrack(() => spec?.indicators.map((i) => i.value) ?? []),
            esn: untrack(() => meta?.esn ?? ESN),
          }),
        )
        .then(
          (outcome) => {
            if (untrack(() => run?.key) !== key) {
              if (outcome.kind === "ready") URL.revokeObjectURL(outcome.href);
              return;
            }
            run = { key, phase: "done", outcome, error: null };
            if (outcome.kind !== "ready") return;
            const prev = untrack(() => drawn);
            if (prev) oldHrefs.push(prev.href);
            // the worker may still read the one before: revoke two back
            while (oldHrefs.length > 2) URL.revokeObjectURL(oldHrefs.shift()!);
            drawn = {
              key,
              aphiaid: a,
              decade: untrack(() => subtreeDecade),
              href: outcome.href,
              res: pl.res,
              box: b,
              cells: outcome.cells,
              domains: outcome.domains,
              taxa: outcome.taxa,
              records: outcome.records,
              sql: outcome.sql,
              readLine: readLine({
                bytes: outcome.read.bytes,
                files: outcome.read.files,
                lookupBytes: outcome.read.lookupBytes,
                cells: outcome.cells,
                ms: outcome.read.ms,
              }),
            };
          },
          (e: unknown) => {
            if (untrack(() => run?.key) === key)
              run = {
                key,
                phase: "error",
                outcome: null,
                error: e instanceof Error ? e.message : String(e),
              };
          },
        );
    });

    // a new taxon drops the cells of the last one
    $effect(() => {
      void taxonParamNow;
      untrack(() => {
        if (drawn && !resolved.subtree) {
          oldHrefs.push(drawn.href);
          drawn = null;
        }
      });
    });

    // the places codec, once the filter is on
    $effect(() => {
      if (!placesOn || placesModel) return;
      void import("../../../places/model").then((mod) => (placesModel = mod));
    });

    // the membership of the filter's places at the drawn resolution (and the parents' for res 6 and 7)
    $effect(() => {
      const coll = filterColl;
      const key = coll !== null ? `coll:${coll}` : placesKey;
      const res = shownRes;
      if (!filterOn || res === null) return;
      untrack(() => {
        if (membership.key !== key) membership = emptyMembership(key);
        if (!key || membership.byRes.has(res) || membership.phase === "loading") return;
        void (coll !== null ? loadCollection(key, coll, res) : loadMembership(key, gazPlaces, res));
      });
    });

    // the layer's own keys: g toggles the globe (never while typing, with a modifier, or under a modal or the tour)
    $effect(() => {
      const onKey = (e: KeyboardEvent) => {
        if (untrack(() => selStore.sel.lens) !== "collection") return;
        const t = e.target as HTMLElement | null;
        const sc = h3ShortcutFor(
          {
            key: e.key,
            ctrlKey: e.ctrlKey,
            altKey: e.altKey,
            metaKey: e.metaKey,
            targetTag: t?.tagName,
            targetEditable: t?.isContentEditable,
          },
          { busy: !!document.querySelector("dialog[open], .driver-popover") },
        );
        if (sc !== "projection") return;
        const proj = untrack(() => selStore.sel.proj) === "globe" ? "mercator" : "globe";
        selStore.set({ proj });
        deps.mapHandle()?.setProjection(proj);
        e.preventDefault();
      };
      document.addEventListener("keydown", onKey);
      return () => document.removeEventListener("keydown", onKey);
    });

    // what the tiles cost: the footer's line, from the slot's counts (one write per frame while a view loads)
    $effect(() => {
      const s = slot;
      if (!s) {
        untrack(() => (tileStats = null));
        return;
      }
      return feedTileStats(s, (st) => (tileStats = { ...st }));
    });

    // the legend rows the slot read (every resolution and variable of the layer and period)
    $effect(() => {
      void statsTick;
      const s = slot;
      statsRows = s ? s.statsRows() : null;
    });

    // the strip's rows: the period rows of the item at the strip's resolution
    $effect(() => {
      const t = target;
      const st = spec?.stats ?? null;
      if (!t || !st || t.periods.length === 0) return;
      const key = JSON.stringify([st, t.item]);
      const hit = periodCache.get(key);
      if (hit) {
        periodRows = { key, rows: hit };
        return;
      }
      void readPeriodRows(st, t.periods, t.item).then(
        (rows) => {
          periodCache.set(key, rows);
          if (untrack(() => target) === t) periodRows = { key, rows };
        },
        () => {
          /* no strip heights: the bars stay flat */
        },
      );
    });

    // the selected hexagon's values (one row of the layer file at its resolution)
    $effect(() => {
      const h3 = selStore.sel.cell;
      const s = slot;
      const v = view;
      if (!h3 || !s || !v) return;
      const l = s.layer();
      const key = JSON.stringify([h3, l.template, l.parentTemplate ?? null, v.periodRef]);
      if (untrack(() => cellValues?.key) === key) return;
      untrack(() => (cellValues = { key, values: null }));
      void readCellValues(h3, l).then((values) => {
        if (untrack(() => cellValues?.key) === key) cellValues = { key, values };
      });
    });

    // the selected hexagon's species (the flat table; the lookup once per page)
    $effect(() => {
      const h3 = selStore.sel.cell;
      const sp = spec;
      const t = target;
      const v = view;
      if (!h3 || !sp || !t || !v) {
        untrack(() => (species = { phase: "idle", list: null, error: null }));
        return;
      }
      if (!sp.speciesFlat || !sp.speciesTable?.lookup) {
        untrack(
          () =>
            (species = {
              phase: "error",
              list: null,
              error: "the collection publishes no species table for a hexagon",
            }),
        );
        return;
      }
      const taxon =
        t.kind === "taxon"
          ? { rank: t.item.rank ?? "", taxon: t.item.key ?? "" }
          : t.kind === "subtree"
            ? { rank: "subtree", taxon: t.item.key ?? "" }
            : null;
      const key = JSON.stringify([h3, taxon, v.periodRef]);
      const hit = listCache.get(key);
      if (hit) {
        untrack(() => (species = { phase: "ready", list: hit, error: null }));
        return;
      }
      untrack(() => (species = { phase: "loading", list: null, error: null }));
      void loadSpecies(sp, h3, t, v).then(
        (list) => {
          listCache.set(key, list);
          if (listCache.size > CACHE_MAX) listCache.delete(listCache.keys().next().value as string);
          if (untrack(() => selStore.sel.cell) === h3)
            species = { phase: "ready", list, error: null };
        },
        (e: unknown) => {
          if (untrack(() => selStore.sel.cell) === h3) {
            const box = cellBox(h3);
            species = {
              phase: "error",
              list: null,
              error: e instanceof Error ? e.message : String(e),
              checklist: box ? obisChecklistUrl(box) : null,
            };
          }
        },
      );
    });

    // hover and click on the hexagons
    $effect(() => {
      const handle = deps.mapHandle();
      const s = slot;
      if (!handle || !s) return;
      return installInteraction(handle.map, s.ids.fill);
    });
  });

  // ---- reads -----------------------------------------------------------------------------------------------
  async function readCellValues(
    h3: string,
    l: ReturnType<H3ReleaseSlot["layer"]>,
  ): Promise<Record<string, number | null> | null> {
    try {
      const id = cellIdOf(h3);
      const res = cellIdRes(id);
      if (!l.ladder.includes(res)) return null;
      for (const url of cellFileUrls(l, h3)) {
        const got = await pageReader.rows(url, [[id, id]], {
          id: "cell_id",
          idType: "int64",
          columns: l.columns,
        });
        if (got && got.h3.length > 0) {
          const out: Record<string, number | null> = {};
          for (const c of l.columns) {
            const v = got.columns[c]?.[0];
            out[c] = typeof v === "number" && Number.isFinite(v) ? v : null;
          }
          return out;
        }
        if (got) return null;
      }
      return null;
    } catch {
      return null;
    }
  }

  async function loadSpecies(
    sp: H3Spec,
    h3: string,
    t: ReleaseTarget,
    v: H3View,
  ): Promise<CellSpeciesList> {
    const t0 = performance.now();
    if (!lookupPromise || lookupPromise.href !== sp.speciesTable!.lookup!.href) {
      const stats = newReadStats();
      const p = readLookup(sp, undefined, stats);
      lookupPromise = { href: sp.speciesTable!.lookup!.href, p, stats, counted: false };
      p.catch(() => (lookupPromise = null));
    }
    const lk = lookupPromise;
    const [cells, lookup] = await Promise.all([readCellRows(sp, h3, speciesReader), lk.p]);
    // the names are read once per page: the hexagon that waited for them reports their bytes
    const lookupBytes = lk.counted ? 0 : lk.stats.bytes;
    lk.counted = true;
    if (!cells) throw new Error("not a hexagon of the species table");
    const taxon = t.kind === "taxon" ? { rank: t.item.rank ?? "", taxon: t.item.key ?? "" } : null;
    const keep = t.kind === "subtree" ? (untrack(() => drawn)?.taxa ?? null) : null;
    let rows = speciesRows(cells.summed, lookup, taxon, keep);
    const notes: string[] = [];
    if (keep)
      notes.push(
        `The species of the subtree of ${t.label}: the taxa whose lineage in the species lookup holds it.`,
      );
    const filteredByRank = !!taxon && ["phylum", "class", "order", "family"].includes(taxon.rank);
    if (taxon && !filteredByRank)
      notes.push(
        `The species of every taxon: ${t.label} is not a rank column of the species lookup (phylum, class, order, family).`,
      );
    if (t.kind === "eov")
      notes.push("The species of every taxon: the release's species table does not mark the EOVs.");
    if (cells.plan.scope === "parent")
      notes.push(
        `The species of the res-${cells.plan.tableRes} hexagon around this one: the release keeps one species table per hexagon at res ${cells.plan.tableRes}.`,
      );
    if (v.periodRef) {
      rows = rows.filter((r) => overlapsPeriod(r, v.periodRef));
      notes.push(
        `Species whose first and last years span the ${v.period}; their records are those of every year (the table per period is not read).`,
      );
    }
    const totals = totalsOf(rows);
    const own = untrack(() => cellValues?.values) ?? null;
    const tn =
      cells.plan.scope === "parent" || v.periodRef || (taxon && !filteredByRank) || t.kind === "eov"
        ? null
        : totalsNote(totals, { n: own?.n ?? null, sp: own?.sp ?? null }, false);
    if (tn) notes.push(tn);
    return {
      h3,
      res: cells.plan.res,
      tableRes: cells.plan.tableRes,
      scope: cells.plan.scope,
      rows,
      records: totals.records,
      names: totals.names,
      notes,
      bytes: cells.bytes,
      requests: cells.requests,
      groupsRead: cells.groupsRead,
      groupsSkipped: cells.groupsSkipped,
      lookupBytes,
      ms: Math.round(performance.now() - t0),
    };
  }

  /** the hexagons of the loaded tiles at the drawn resolution, deduplicated (a hexagon cut by tile edges is in
   * several tiles), with the place filter's cells only when it is on */
  function readLoaded(m: MapLibreMap, s: H3ReleaseSlot): void {
    const res = untrack(() => shownRes);
    if (res === null || !m.getSource(s.ids.source)) return;
    let feats: { properties?: Record<string, unknown> | null }[];
    try {
      feats = m.querySourceFeatures(s.ids.source, { sourceLayer: H3_LAYER });
    } catch {
      return;
    }
    const keep = filterOn ? new Set(filterCells()) : null;
    const cols = spec?.indicators.map((i) => i.value) ?? [];
    const seen = new Map<string, Record<string, number | null>>();
    for (const f of feats) {
      const h3 = f.properties?.h3;
      if (typeof h3 !== "string" || seen.has(h3) || parseInt(h3[1], 16) !== res) continue;
      if (keep && !keep.has(h3)) continue;
      const row: Record<string, number | null> = {};
      for (const c of cols) {
        const v = Number(f.properties?.[c]);
        row[c] = f.properties?.[c] == null || !Number.isFinite(v) ? null : v;
      }
      seen.set(h3, row);
    }
    let sum = 0;
    for (const r of seen.values()) sum += r.n ?? 0;
    const key = `${res}|${seen.size}|${sum}|${keep ? keep.size : -1}`;
    if (loaded?.key !== key) loaded = { key, res, cells: [...seen.values()] };
  }

  /** the box of the hexagon from the tile features that draw it (the OBIS checklist link) */
  function cellBox(h3: string): [number, number, number, number] | null {
    const m = deps.mapHandle()?.map;
    const s = untrack(() => slot);
    if (!m || !s || !m.getSource(s.ids.source)) return null;
    try {
      const fs = m.querySourceFeatures(s.ids.source, {
        sourceLayer: H3_LAYER,
        filter: ["==", ["get", "h3"], h3],
      });
      const rings = fs.flatMap((f) =>
        f.geometry.type === "Polygon"
          ? f.geometry.coordinates
          : f.geometry.type === "MultiPolygon"
            ? f.geometry.coordinates.flat()
            : [],
      );
      return boxOfRings(rings);
    } catch {
      return null;
    }
  }

  /** the filter's cells: every resolution read so far for the current places (the fill's step on the zoom draws one) */
  function filterCells(): string[] {
    return allCells(untrack(() => membership.byRes));
  }

  const manifestCache = new Map<string, Promise<MembershipManifest | null>>();
  const manifestOf = (url: string) => {
    let mp = manifestCache.get(url);
    if (!mp) {
      mp = fetchJson(url).then(
        (j) => parseMembership(j, url),
        () => null,
      );
      manifestCache.set(url, mp);
    }
    return mp;
  };

  /** a whole collection at a resolution (`filter=coll:<slug>`): every file of the resolution read, unless the
   * manifest's own row and byte counts put it over the cap (nothing is read then) */
  async function loadCollection(key: string, slug: string, res: number): Promise<void> {
    membership = { ...membership, phase: "loading" };
    try {
      const { collectionMembership } = await import("../../../lib/gazetteer/resolve");
      const info = await collectionMembership(slug);
      if (untrack(() => membership.key) !== key) return;
      if (!info.membership) {
        membership = { ...membership, phase: "ready", title: info.title, noMembership: true };
        return;
      }
      const man = await manifestOf(info.membership);
      if (!man) throw new Error(`${info.membership}: no membership manifest`);
      const plan = collectionPlan(man, res);
      const cells = new Set<string>();
      if (!plan.over)
        for (const c of (
          await Promise.all(plan.files.map((f) => readMembershipCells(f.url, null)))
        ).flat())
          cells.add(c);
      if (untrack(() => membership.key) !== key) return;
      const byRes = new Map(membership.byRes);
      byRes.set(res, [...cells].sort());
      membership = {
        ...membership,
        phase: "ready",
        byRes,
        over: plan.over ? new Set([...membership.over, res]) : membership.over,
        title: info.title,
        noMembership: false,
        minShare: man.minShare,
        sources: info.title
          ? [{ title: info.title, citation: info.citation, license: info.license }]
          : [],
      };
    } catch (e) {
      if (untrack(() => membership.key) === key)
        membership = {
          ...membership,
          phase: "error",
          error: e instanceof Error ? e.message : String(e),
        };
    }
  }

  async function loadMembership(
    key: string,
    places: readonly { id: string; name: string }[],
    res: number,
  ): Promise<void> {
    membership = { ...membership, phase: "loading" };
    try {
      const { placeMembership } = await import("../../../lib/gazetteer/resolve");
      const infos = await Promise.all(places.map((p) => placeMembership(p.id)));
      const without = places.filter((_, i) => !infos[i].membership).map((p) => p.name);
      const cells = new Set<string>();
      let minShare = 0.01;
      for (const info of infos) {
        if (!info.membership) continue;
        const url = info.membership;
        const man = await manifestOf(url);
        if (!man) throw new Error(`${url}: no membership manifest`);
        minShare = man.minShare;
        const cellsAt = async (r: number, parents: ReadonlySet<string> | null) => {
          const got = await Promise.all(
            membershipFiles(man, r, parents).map((f) => readMembershipCells(f.url, [info.id])),
          );
          return got.flat();
        };
        const pr = man.parentRes[String(res)];
        const parents = pr !== undefined ? new Set(await cellsAt(pr, null)) : null;
        for (const c of await cellsAt(res, parents)) cells.add(c);
      }
      if (untrack(() => membership.key) !== key) return;
      const byRes = new Map(membership.byRes);
      byRes.set(res, [...cells].sort());
      membership = {
        ...membership,
        key,
        phase: "ready",
        error: null,
        byRes,
        without,
        minShare,
        sources: infos
          .filter((i) => i.title)
          .map((i) => ({ title: i.title!, citation: i.citation, license: i.license })),
      };
    } catch (e) {
      if (untrack(() => membership.key) === key)
        membership = {
          ...membership,
          phase: "error",
          error: e instanceof Error ? e.message : String(e),
        };
    }
  }

  function loadTaxa(): void {
    const sp = untrack(() => spec);
    if (!sp?.taxonGroups || taxaPhase === "loading" || taxaPhase === "ready") return;
    taxaPhase = "loading";
    const headsP = sp.heads
      ? fetchJson(sp.heads.href).then(headsOf, () => [] as HeadRow[])
      : Promise.resolve([] as HeadRow[]);
    void Promise.all([readTaxa(sp.taxonGroups), headsP]).then(
      ([rows, h]) => {
        taxa = rows;
        heads = h;
        taxaPhase = "ready";
      },
      () => {
        taxaPhase = "error";
      },
    );
  }

  // ---- the map: hover reads the five indicators of the tile's feature; a click selects the hexagon -------------
  function installInteraction(map: MapLibreMap, fillId: string): () => void {
    const popup = createPopup({
      closeButton: false,
      closeOnClick: false,
      offset: 10,
      maxWidth: "260px",
    });
    let shown = false;
    let hovered: string | null = null;
    const owned = () =>
      deps.isOwned?.() === true || untrack(() => selStore.sel.lens) !== "collection";
    const hide = () => {
      if (shown) popup.remove();
      shown = false;
      map.getCanvas().style.cursor = "";
      hovered = null;
    };
    const onMove = (e: MapLayerMouseEvent) => {
      if (owned()) return hide();
      const f = e.features?.[0];
      const h3 = typeof f?.properties?.h3 === "string" ? f.properties.h3 : null;
      if (!f || !h3) return hide();
      map.getCanvas().style.cursor = "pointer";
      if (h3 !== hovered) {
        hovered = h3;
        const ind = untrack(() => view?.indicator ?? "es");
        const lines = hoverLines(
          h3,
          f.properties ?? {},
          untrack(() => spec?.indicators ?? []),
          ind,
        );
        popup.setHTML(linesHtml(lines));
      }
      popup.setLngLat(e.lngLat);
      if (!shown) {
        popup.addTo(map);
        shown = true;
      }
    };
    // the click popup states the values and links to Details (the Cell pane), as every lens's popup does
    const clickPopup = createPopup({ offset: 10, maxWidth: "260px" });
    const onClick = (e: MapLayerMouseEvent) => {
      if (owned()) return;
      const f = e.features?.[0];
      const h3 = f?.properties?.h3;
      if (typeof h3 !== "string") return;
      selStore.set({ cell: h3 });
      hide();
      const ind = untrack(() => view?.indicator ?? "es");
      const lines = hoverLines(
        h3,
        f?.properties ?? {},
        untrack(() => spec?.indicators ?? []),
        ind,
      );
      clickPopup
        .setLngLat(e.lngLat)
        .setHTML(`${linesHtml(lines)}${detailsLinkHtml()}`)
        .addTo(map);
    };
    // a click off the hexagons clears the selection (obis-hex's click off the cells)
    const onMapClick = (e: MapLayerMouseEvent) => {
      if (owned() || !untrack(() => selStore.sel.cell)) return;
      const hit = map.getLayer(fillId)
        ? map.queryRenderedFeatures(e.point, { layers: [fillId] })
        : [];
      if (hit.length === 0) selStore.set({ cell: undefined });
    };
    map.on("mousemove", fillId, onMove);
    map.on("mouseleave", fillId, hide);
    map.on("click", fillId, onClick);
    map.on("click", onMapClick);
    return () => {
      map.off("mousemove", fillId, onMove);
      map.off("mouseleave", fillId, hide);
      map.off("click", fillId, onClick);
      map.off("click", onMapClick);
      hide();
      clickPopup.remove();
    };
  }

  // ---- what the map draws and says --------------------------------------------------------------------------
  const style = $derived.by((): H3LayerSpec | null => {
    const s = slot;
    const v = view;
    if (!s || !v || !workerOk) return null;
    void statsTick;
    const l = s.layer();
    const cell = selStore.sel.cell ?? null;
    const base = releaseFilter(v.indicator);
    // the place filter draws only the places' hexagons, and nothing while their membership loads
    const filter = filterOn ? placeFilterExpr(base, filterTooMany ? [] : filterList) : base;
    return {
      sourceId: s.ids.source,
      source: releaseSource(l),
      fill: {
        id: s.ids.fill,
        type: "fill",
        source: s.ids.source,
        "source-layer": H3_LAYER,
        filter,
        paint: {
          "fill-color":
            domain === "view" && loadedDomain
              ? rampOn(v.indicator, loadedDomain)
              : subtreeDomain
                ? rampOn(v.indicator, subtreeDomain)
                : h3FillColor(l, v.indicator, statsRows),
          "fill-opacity": H3_FILL_OPACITY,
        },
      },
      selected: cell
        ? {
            id: `${s.ids.fill}:selected`,
            type: "line",
            source: s.ids.source,
            "source-layer": H3_LAYER,
            filter: ["==", ["get", "h3"], cell],
            paint: { "line-color": SELECTION_COLOR, "line-width": SELECTED_WIDTH },
          }
        : null,
    };
  });

  const shownRes = $derived.by(() => {
    void effRes;
    void statsTick;
    return slot && view ? resAtZoom(slot.layer(), zoom) : null;
  });
  const filterList = $derived(allCells(membership.byRes));
  const filterTooMany = $derived(filterList.length > FILTER_MAX_CELLS);
  /** the loaded hexagons at the drawn resolution, when the reader has them for it */
  const loadedNow = $derived(loaded && loaded.res === shownRes ? loaded.cells : null);
  const loadedDomain = $derived.by(() => {
    const v = view;
    if (!v || !loadedNow) return null;
    return viewDomain(
      loadedNow.map((c) => c[v.indicator]),
      scaleOf(v.indicator) === "log",
    );
  });
  const periodLabel = $derived(spec && view ? (spec.periodLabels[view.period] ?? view.period) : "");
  /** a subtree's colour domain: p02 to p98 of its computed cells (records from 1, on a log scale) */
  const subtreeDomain = $derived.by((): [number, number] | null => {
    const v = view;
    if (!v || target?.kind !== "subtree" || !drawn) return null;
    const d = rangeOf(drawn.domains[v.indicator] ?? null);
    if (!d) return null;
    return scaleOf(v.indicator) === "log" ? [Math.max(1, d[0]), Math.max(1, d[1])] : d;
  });

  const legend = $derived.by((): CollectionLegend | null => {
    const v = view;
    const t = target;
    const res = shownRes;
    if (!v || !t || res === null) return null;
    const d =
      domain === "view" && loadedDomain
        ? loadedDomain
        : t.kind === "subtree"
          ? subtreeDomain
          : domainAt(statsRows, v.indicator, res);
    const ind = spec?.indicators.find((i) => i.value === v.indicator);
    return {
      kind: "continuous",
      title: `${t.label} · ${ind ? shortLabel(ind.value, ind.label) : v.indicator}`,
      subtitle: legendSubtitle({
        period: periodLabel,
        res,
        auto: v.res === "auto",
        indicator: v.indicator,
        domain:
          domain === "view" && loadedDomain ? "view" : t.kind === "subtree" ? "subtree" : "release",
      }),
      stops: d ? legendStops(d, v.indicator) : [],
      unit: v.indicator === "n" ? "records" : v.indicator === "sp" ? "species" : "",
      histogram: null,
      marker: null,
      ...(scaleOf(v.indicator) === "log" ? { ticks: 3 } : {}),
    };
  });

  const bars = $derived.by(() => {
    const t = target;
    if (!t || t.periods.length === 0) return [];
    return periodBars(periodRows?.rows ?? [], t.periods, t.item);
  });

  const parts = $derived.by((): SentenceParts | null => {
    const t = target;
    const v = view;
    const s = slot;
    if (!t || !v || !s || shownRes === null) return null;
    const ind = spec?.indicators.find((i) => i.value === v.indicator);
    const pr = s.layer().parentRes?.[String(shownRes)];
    const p = sentenceParts({
      label: t.label,
      kind: t.kind,
      ...(t.item.rank ? { rank: t.item.rank } : {}),
      ...(t.kind === "taxon" && t.item.key ? { taxon: t.item.key } : {}),
      period: periodLabel,
      res: shownRes,
      indicator: v.indicator,
      indicatorLabel: ind?.label ?? v.indicator,
      place:
        filterColl !== null
          ? withinPart([collTitle])
          : filterOn && gazPlaces.length
            ? withinPart(gazPlaces.map((p) => p.name))
            : t.kind === "subtree" && drawn?.box
              ? boxPart(shownRes)
              : placePart(pr !== undefined ? { parentRes: pr } : null),
    });
    return t.kind === "subtree" ? { ...p, taxon: subtreeTaxonPart(subtreeName, subtreeRank) } : p;
  });
  const sentence = $derived(parts ? sentenceText(parts) : "");
  const valued = (rows: readonly Record<string, number | null>[], k: string) =>
    rows.reduce((a, r) => a + (r[k] === null || r[k] === undefined ? 0 : 1), 0);
  const coverage = $derived.by(() => {
    const v = view;
    if (!v || shownRes === null) return "";
    // the place filter's line counts its own hexagons (the loaded ones: the release's counts are worldwide)
    if (filterOn && loadedNow)
      return filteredCoverage({
        indicator: v.indicator,
        valued: valued(loadedNow, v.indicator),
        n: loadedNow.length,
        esn: meta?.esn ?? 50,
        ...(filterColl !== null ? { where: collTitle } : {}),
      });
    if (target?.kind === "subtree" && drawn)
      return subtreeCoverage({
        indicator: v.indicator,
        valued: drawn.domains[v.indicator]?.cells ?? 0,
        cells: drawn.cells,
        esn: meta?.esn ?? ESN,
      });
    return coverageText(statsRows, v.indicator, shownRes, meta?.esn ?? 50);
  });
  /** the subtree's own status: resolving, computing, refused, nothing, failed (null once its cells are drawn) */
  const subtreeStatus = $derived.by((): string | null => {
    if (!ask) return null;
    const w = worms;
    if (w && w.key === taxonParamNow && w.phase === "error" && ask.kind === "name") return w.error;
    if (subtreeAphia === null) return `Asking WoRMS for ${subtreeName}…`;
    const r = run;
    if (r?.phase === "error") return `The subtree could not be computed: ${r.error}`;
    if (r?.phase === "done" && r.outcome?.kind === "refused") return r.outcome.line;
    if (r?.phase === "done" && r.outcome?.kind === "empty")
      return `No OBIS records of ${subtreeName} in the species table${drawn?.box ? " in this view" : ""}.`;
    if (!target) return `Computing the subtree of ${subtreeName} in the browser…`;
    return null;
  });
  const status = $derived(
    subtreeStatus ??
      statusLine({
        error: workerError,
        loading: !workerOk || (!!slot && statsRows === null && target?.kind !== "subtree"),
        cells: loadedNow ? loadedNow.length : null,
        label: target?.label ?? "this layer",
        period: view?.periodRef ? (spec?.periodLabels[view.period] ?? view.period) : null,
        filtered: filterColl !== null ? collTitle : filterOn,
      }),
  );
  const filterNote = $derived(
    filterColl !== null
      ? collFilterNote({
          title: collTitle,
          slug: filterColl,
          phase: membership.phase,
          without: membership.noMembership,
          over: shownRes !== null && membership.over.has(shownRes),
          cells:
            membership.phase === "ready" && shownRes !== null
              ? (membership.byRes.get(shownRes)?.length ?? null)
              : null,
          res: shownRes ?? 0,
          minShare: membership.minShare,
          error: membership.error,
          tooMany: filterTooMany,
        })
      : filterOn
        ? placeFilterNote({
            phase: membership.phase,
            places: filterPlaces.length,
            without: [
              ...membership.without,
              ...filterPlaces
                .filter((p) => p.kind !== "gaz")
                .map((p) => ("name" in p && p.name) || "a drawn place"),
            ],
            cells:
              membership.phase === "ready" && shownRes !== null
                ? (membership.byRes.get(shownRes)?.length ?? null)
                : null,
            res: shownRes ?? 0,
            minShare: membership.minShare,
            error: membership.error,
            tooMany: filterTooMany,
          })
        : null,
  );

  const cell = $derived.by((): CellView | null => {
    const h3 = selStore.sel.cell;
    if (!h3 || !view) return null;
    const res = cellIdRes(cellIdOf(h3));
    const med = statsRows?.find((r) => r.res === res && r.variable === view.indicator)?.p50 ?? null;
    return {
      h3,
      res,
      values: cellValues?.key.includes(h3) ? cellValues.values : null,
      median: med,
    };
  });

  return {
    get style() {
      return style;
    },
    get legend() {
      return legend;
    },
    get target() {
      return target;
    },
    get view() {
      return view;
    },
    get shownRes() {
      return shownRes;
    },
    get coverage() {
      return coverage;
    },
    get parts() {
      return parts;
    },
    get status() {
      return status;
    },
    get meta() {
      return meta;
    },
    get footer() {
      return shownRes === null || !view
        ? ""
        : footerText({
            meta,
            res: resNote(shownRes, view.res === "auto"),
            tiles: tilesLine(tileStats),
            app: appName,
          });
    },
    get reproduce() {
      const s = slot;
      const v = view;
      if (!s || !v || shownRes === null) return "";
      if (target?.kind === "subtree" && drawn)
        return `-- ${sentence}\n-- the subtree computed in the page (obisindicators' indicator SQL over the species table)\nINSTALL httpfs; LOAD httpfs;\n${drawn.sql};`;
      return reproduceSql({
        layer: s.layer(),
        res: shownRes,
        indicator: v.indicator,
        title: sentence,
        cell: selStore.sel.cell ?? null,
        manifest: spec?.files ?? null,
      });
    },
    get domain() {
      return domain;
    },
    get layers() {
      return layerRows(
        deps.items().map((it) => {
          const k = itemKindOf(it);
          const title = it.properties?.title;
          return {
            id: it.id,
            label: typeof title === "string" && title.trim() ? title.trim() : it.id,
            kind: k.layer,
            ...(k.key ? { key: k.key } : {}),
          };
        }),
        taxa,
      );
    },
    get layerId() {
      return item?.id ?? null;
    },
    get filterNote() {
      return filterNote;
    },
    get app() {
      return appName;
    },
    get stamp() {
      return legend
        ? pngStamp({
            legendTitle: legend.title,
            sentence,
            release: meta?.release ?? spec?.release ?? null,
            format: (v: number) => formatIndicator(view?.indicator ?? "es", v),
          })
        : null;
    },
    get about() {
      const e = entry;
      if (!e) return null;
      const d = (e.collection as { description?: unknown } | null)?.description;
      return {
        title: e.title,
        lines: aboutLines({ meta, description: typeof d === "string" ? d : null }),
      };
    },
    get placeSources() {
      return membership.sources;
    },
    get sentence() {
      return sentence;
    },
    get notes() {
      return [
        ...(view?.notes ?? []),
        ...(resolved.note ? [resolved.note] : []),
        ...(pinPlan?.note ? [pinPlan.note] : []),
        ...(workerError ? [`The hexagon layer could not start: ${workerError}`] : []),
      ];
    },
    get bars() {
      return bars;
    },
    get stripNote() {
      const t = target;
      return t ? stripMessage({ kind: t.kind, sets: t.periods.length, label: t.label }) : null;
    },
    get taxa() {
      return taxa;
    },
    get taxaPhase() {
      return taxaPhase;
    },
    get taxon() {
      return resolved.row;
    },
    get taxonNote() {
      return resolved.note;
    },
    get subtree(): SubtreeView | null {
      if (!ask) return null;
      const w = worms?.key === taxonParamNow ? worms : null;
      const r = run;
      const phase: SubtreeView["phase"] =
        subtreeAphia === null
          ? w?.phase === "error"
            ? "error"
            : "resolving"
          : r?.phase === "error"
            ? "error"
            : r?.phase === "done"
              ? r.outcome?.kind === "ready"
                ? "ready"
                : (r.outcome?.kind ?? "error")
              : "computing";
      const cap = subtreePlanNow?.cap ?? 5;
      return {
        phase,
        aphiaid: subtreeAphia,
        name: subtreeName,
        rank: subtreeRank,
        record: w?.record ?? null,
        line: subtreeLine(subtreeName, cap),
        taxonLine: w?.record
          ? taxonLine(w.record, drawn && drawn.aphiaid === subtreeAphia ? drawn.records : null)
          : null,
        wormsUrl: subtreeAphia !== null ? wormsPageUrl(subtreeAphia) : null,
        readLine: drawn && drawn.aphiaid === subtreeAphia ? drawn.readLine : null,
        message: subtreeStatus ?? (w?.phase === "error" ? w.error : null),
        res: subtreePlanNow?.res ?? null,
        cap,
      };
    },
    setAphia(id) {
      // a WoRMS taxon filters the all-taxa Item; a decade stays (the species table has decades), a year goes
      const k = spec?.viewDims.period ?? "period";
      const dim = { ...(selStore.sel.dim ?? {}) };
      if (dim[k] && !dim[k].endsWith("s")) delete dim[k];
      selStore.set({
        taxon: `aphia:${id}`,
        i: deps.items().find((it) => itemKindOf(it).layer === "all")?.id ?? selStore.sel.i,
        dim: Object.keys(dim).length ? dim : undefined,
        cell: undefined,
      });
    },
    get cell() {
      return cell;
    },
    get species() {
      return species;
    },
    get statsRows() {
      return statsRows;
    },
    ensureTaxa: () => loadTaxa(),
    setDomain(d) {
      selStore.set({ dom: d === "view" ? "view" : undefined });
    },
    get filterColl() {
      return filterColl;
    },
    get collections() {
      return collections;
    },
    ensureCollections() {
      if (collections || collectionsLoading) return;
      collectionsLoading = true;
      void import("../../../lib/gazetteer/resolve").then(async (m) => {
        collections = (await m.listMembershipCollections()) ?? [];
        collectionsLoading = false;
      });
    },
    setFilterColl(slug) {
      selStore.set({ filter: slug ? `coll:${slug}` : undefined, cell: undefined });
    },
    goToSea(id) {
      const p = seaPatch(id);
      if (!p) return;
      selStore.set(p.sel);
      deps.mapHandle()?.flyTo(p.camera);
    },
    setLayer(id) {
      selStore.set({ i: id, taxon: undefined, cell: undefined });
    },
    setIndicator(v) {
      const k = spec?.viewDims.indicator ?? "indicator";
      selStore.set({ dim: { ...(selStore.sel.dim ?? {}), [k]: v } });
    },
    setPeriod(token) {
      const k = spec?.viewDims.period ?? "period";
      const next = { ...(selStore.sel.dim ?? {}) };
      if (token === spec?.allPeriod) delete next[k];
      else next[k] = token;
      selStore.set({ dim: Object.keys(next).length ? next : undefined });
    },
    setRes(r) {
      selStore.set({ res: r === "auto" ? undefined : r, cell: undefined });
    },
    setTaxon(row) {
      if (!row) {
        selStore.set({ taxon: undefined });
        return;
      }
      // a taxon filters the all-taxa Item, and has no periods
      const k = spec?.viewDims.period ?? "period";
      const dim = { ...(selStore.sel.dim ?? {}) };
      delete dim[k];
      selStore.set({
        taxon: taxonParam(row),
        i: deps.items().find((it) => itemKindOf(it).layer === "all")?.id ?? selStore.sel.i,
        dim: Object.keys(dim).length ? dim : undefined,
      });
    },
    selectCell(h3) {
      selStore.set({ cell: h3 ?? undefined });
    },
    destroy() {
      destroyRoot();
    },
  };
}

/** the hover's value text for a test or a caller with the properties at hand */
export { formatIndicator };
