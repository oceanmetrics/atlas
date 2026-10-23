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
  footerText,
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
  membershipFiles,
  parseMembership,
  placeFilterExpr,
  placeFilterNote,
  readMembershipCells,
  type MembershipManifest,
} from "./placeFilter";
import {
  periodBars,
  readPeriodRows,
  stripMessage,
  type PeriodBar,
  type PeriodStatRow,
} from "./periods";
import { headsOf, layerRows, readTaxonRows, type LayerRow } from "./taxa";
import {
  h3ViewOf,
  headRowOf,
  itemKindOf,
  releaseTarget,
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
  let membership = $state.raw<{
    key: string;
    phase: "idle" | "loading" | "ready" | "error";
    error: string | null;
    byRes: Map<number, string[]>;
    without: string[];
    minShare: number;
    sources: { title: string; citation: string | null; license: string | null }[];
  }>({
    key: "",
    phase: "idle",
    error: null,
    byRes: new Map(),
    without: [],
    minShare: 0.01,
    sources: [],
  });

  const spec = $derived(deps.spec());
  const entry = $derived(deps.entry());
  const item = $derived(deps.item());

  // the taxon the URL names: a row of the search asset, or a head by AphiaID
  const taxonParamNow = $derived(selStore.sel.taxon);
  const resolved = $derived.by(() => {
    const p = taxonParamNow;
    if (!p) return { row: null as TaxonRow | null, note: null as string | null };
    if (!taxa) return { row: null, note: null };
    if (p.startsWith("aphia:")) {
      const h = headRowOf(heads, taxa, p);
      return { row: h.row, note: h.reason };
    }
    const row = taxonRowOf(taxa, p);
    return { row, note: row ? null : `The release has no taxon layer ${p}.` };
  });
  const waitingForTaxa = $derived(!!taxonParamNow && taxa === null && taxaPhase !== "error");

  const target = $derived.by((): ReleaseTarget | null => {
    if (!spec || !entry || !item || waitingForTaxa) return null;
    return releaseTarget(spec, entry.id, item, resolved.row);
  });
  const view = $derived(
    spec && target
      ? h3ViewOf({ dim: selStore.sel.dim, res: selStore.sel.res }, spec, target)
      : null,
  );

  // a pinned split resolution over a wide view draws a coarser one (obis-hex's MAX_PARENTS fallback)
  const layoutParentRes = $derived(
    (target?.collection["h3:layout"] as { parent_res?: Record<string, number> } | undefined)
      ?.parent_res ?? null,
  );
  const pinPlan = $derived(view ? pinForView(view.res, layoutParentRes, viewKm2) : null);
  const effRes = $derived(pinPlan?.res ?? "auto");

  // ---- the place filter (`?filter=places` with gazetteer places in the hash) ---------------------------------------
  const filterOn = $derived(selStore.sel.filter === "places");
  const filterPlaces = $derived(
    filterOn && placesModel ? placesModel.placesFromHash(selStore.sel.pl) : [],
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
        const periodArg = v.periodRef
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
          period: v.periodRef ? { grain: v.periodRef.grain, value: v.periodRef.value } : null,
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

    // the places codec, once the filter is on
    $effect(() => {
      if (!filterOn || placesModel) return;
      void import("../../../places/model").then((mod) => (placesModel = mod));
    });

    // the membership of the filter's places at the drawn resolution (and the parents' for res 6 and 7)
    $effect(() => {
      const key = placesKey;
      const res = shownRes;
      if (!filterOn || res === null) return;
      untrack(() => {
        if (membership.key !== key)
          membership = {
            key,
            phase: "idle",
            error: null,
            byRes: new Map(),
            without: [],
            minShare: 0.01,
            sources: [],
          };
        if (!key || membership.byRes.has(res) || membership.phase === "loading") return;
        void loadMembership(key, gazPlaces, res);
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
        t.kind === "taxon" ? { rank: t.item.rank ?? "", taxon: t.item.key ?? "" } : null;
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
    let rows = speciesRows(cells.summed, lookup, taxon);
    const notes: string[] = [];
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
    const out: string[] = [];
    for (const c of untrack(() => membership.byRes).values()) out.push(...c);
    return out;
  }

  const manifestCache = new Map<string, Promise<MembershipManifest | null>>();
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
        let mp = manifestCache.get(url);
        if (!mp) {
          mp = fetchJson(url).then(
            (j) => parseMembership(j, url),
            () => null,
          );
          manifestCache.set(url, mp);
        }
        const man = await mp;
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
  const filterList = $derived.by(() => {
    const out: string[] = [];
    for (const c of membership.byRes.values()) out.push(...c);
    return out;
  });
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

  const legend = $derived.by((): CollectionLegend | null => {
    const v = view;
    const t = target;
    const res = shownRes;
    if (!v || !t || res === null) return null;
    const d =
      domain === "view" && loadedDomain ? loadedDomain : domainAt(statsRows, v.indicator, res);
    const ind = spec?.indicators.find((i) => i.value === v.indicator);
    return {
      kind: "continuous",
      title: `${t.label} · ${ind ? shortLabel(ind.value, ind.label) : v.indicator}`,
      subtitle: legendSubtitle({
        period: periodLabel,
        res,
        auto: v.res === "auto",
        indicator: v.indicator,
        domain: domain === "view" && loadedDomain ? "view" : "release",
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
    return sentenceParts({
      label: t.label,
      kind: t.kind,
      ...(t.item.rank ? { rank: t.item.rank } : {}),
      ...(t.kind === "taxon" && t.item.key ? { taxon: t.item.key } : {}),
      period: periodLabel,
      res: shownRes,
      indicator: v.indicator,
      indicatorLabel: ind?.label ?? v.indicator,
      place:
        filterOn && gazPlaces.length
          ? withinPart(gazPlaces.map((p) => p.name))
          : placePart(pr !== undefined ? { parentRes: pr } : null),
    });
  });
  const sentence = $derived(parts ? sentenceText(parts) : "");
  const valued = (rows: readonly Record<string, number | null>[], k: string) =>
    rows.reduce((a, r) => a + (r[k] === null || r[k] === undefined ? 0 : 1), 0);
  const coverage = $derived.by(() => {
    const v = view;
    if (!v || shownRes === null) return "";
    // the place filter's line counts its own hexagons (the loaded ones: the release's counts are worldwide)
    if (filterOn && loadedNow) {
      const n = loadedNow.length;
      const k = valued(loadedNow, v.indicator);
      const fmt = (x: number) => x.toLocaleString("en-US");
      return v.indicator === "es"
        ? `${fmt(k)} of ${fmt(n)} hexagons in the place have ≥ ${meta?.esn ?? 50} records`
        : `${fmt(n)} hexagons in the place`;
    }
    return coverageText(statsRows, v.indicator, shownRes, meta?.esn ?? 50);
  });
  const status = $derived(
    statusLine({
      error: workerError,
      loading: !workerOk || (!!slot && statsRows === null),
      cells: loadedNow ? loadedNow.length : null,
      label: target?.label ?? "this layer",
      period: view?.periodRef ? (spec?.periodLabels[view.period] ?? view.period) : null,
      filtered: filterOn,
    }),
  );
  const filterNote = $derived(
    filterOn
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
            app: appName,
          });
    },
    get reproduce() {
      const s = slot;
      const v = view;
      if (!s || !v || shownRes === null) return "";
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
