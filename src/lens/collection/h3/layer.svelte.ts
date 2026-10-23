// The H3 layer of the Collections lens (build week 4, step 5): an `h3` collection (the obis-h3 release) drawn by the
// map package's release slot (`h3ReleaseSlot`: the release's own Parquet read in MapLibre's worker, every indicator
// in each tile), mounted on a style recorder as `cogSlot` is, so its source and fill go into the one composed
// style (`H3LayerSpec`, `setStyle(diff)`). A LAZY module: `state.svelte.ts` imports it only when the active
// collection declares the `h3` profile, so the static path carries none of it, and the h3 worker module is added to
// MapLibre's worker here, by a second `setupMapLibre` (`h3WorkerUrl`), the first time an h3 collection opens.
//
// The rules live in the plain modules beside it (view.ts, paint.ts, periods.ts, taxa.ts, cellSpecies.ts); this file
// only wires them to the URL (`Sel`: `i`, `taxon`, `dim.indicator`, `dim.period`, `res`, `cell`) and the map.
import {
  H3_LAYER,
  ReleaseReader,
  cellIdOf,
  cellIdRes,
  h3OfCellId,
  h3ReleaseSlot,
  parentId,
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
  periodBars,
  readPeriodRows,
  stripMessage,
  type PeriodBar,
  type PeriodStatRow,
} from "./periods";
import { headsOf, readTaxonRows } from "./taxa";
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
  };
  readonly statsRows: StatsRow[] | null;
  ensureTaxa(): void;
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
let lookupPromise: { href: string; p: Promise<Map<number, LookupRow>> } | null = null;

export function createH3Layer(deps: H3LayerDeps): H3Layer {
  const { selStore } = deps;
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

  // ---- the slot: one per target (layer templates + item), updated for indicator, period and resolution -------
  let slot = $state.raw<H3ReleaseSlot | null>(null);
  let slotKey = "";
  const rec = recorder(() => untrack(() => zoom));

  // ---- the period strip and taxa: one read each ---------------------------------------------------------------
  /* eslint-disable svelte/prefer-svelte-reactivity -- plain caches read inside effects, never by a template */
  const periodCache = new Map<string, PeriodStatRow[]>();
  const listCache = new Map<string, CellSpeciesList>();
  /* eslint-enable svelte/prefer-svelte-reactivity */

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
            res: v.res,
            title: t.label,
            opacity: H3_FILL_OPACITY,
            onchange: () => queueMicrotask(() => statsTick++),
          });
          s.mount(rec, null, null);
          slot = s;
        } else {
          slot.update({ indicator: v.indicator, period: periodArg, res: v.res });
        }
        statsTick++;
      });
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
              error: "This collection publishes no species table for a hexagon.",
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
          if (untrack(() => selStore.sel.cell) === h3)
            species = {
              phase: "error",
              list: null,
              error: `The species of this hexagon could not be read (${e instanceof Error ? e.message : String(e)}).`,
            };
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
      const whole = l.template.replace("{res}", String(res));
      const pr = l.parentRes?.[String(res)];
      const urls =
        l.parentTemplate && pr !== undefined
          ? [
              l.parentTemplate
                .replace("{res}", String(res))
                .replace("{parent}", h3OfCellId(parentId(id, pr))),
              whole,
            ]
          : [whole];
      for (const url of urls) {
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
    const before = { ...pageReader.stats };
    if (!lookupPromise || lookupPromise.href !== sp.speciesTable!.lookup!.href) {
      const p = readLookup(sp);
      lookupPromise = { href: sp.speciesTable!.lookup!.href, p };
      p.catch(() => (lookupPromise = null));
    }
    const [cells, lookup] = await Promise.all([readCellRows(sp, h3, pageReader), lookupPromise.p]);
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
      bytes: pageReader.stats.bytes - before.bytes,
      requests: pageReader.stats.requests - before.requests,
      ms: Math.round(performance.now() - t0),
    };
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
    return {
      sourceId: s.ids.source,
      source: releaseSource(l),
      fill: {
        id: s.ids.fill,
        type: "fill",
        source: s.ids.source,
        "source-layer": H3_LAYER,
        filter: releaseFilter(v.indicator),
        paint: {
          "fill-color": h3FillColor(l, v.indicator, statsRows),
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

  const shownRes = $derived(slot && view ? resAtZoom(slot.layer(), zoom) : null);
  const periodLabel = $derived(spec && view ? (spec.periodLabels[view.period] ?? view.period) : "");

  const legend = $derived.by((): CollectionLegend | null => {
    const v = view;
    const t = target;
    const res = shownRes;
    if (!v || !t || res === null) return null;
    const d = domainAt(statsRows, v.indicator, res);
    const ind = spec?.indicators.find((i) => i.value === v.indicator);
    return {
      kind: "continuous",
      title: `${t.label} · ${ind ? shortLabel(ind.value, ind.label) : v.indicator}`,
      subtitle: legendSubtitle({
        period: periodLabel,
        res,
        auto: v.res === "auto",
        indicator: v.indicator,
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

  const sentence = $derived.by(() => {
    const t = target;
    const v = view;
    if (!t || !v || shownRes === null) return "";
    const ind = spec?.indicators.find((i) => i.value === v.indicator);
    return sentenceText({
      label: t.label,
      kind: t.kind,
      ...(t.item.rank ? { rank: t.item.rank } : {}),
      period: periodLabel,
      res: shownRes,
      indicator: v.indicator,
      indicatorLabel: ind?.label ?? v.indicator,
    });
  });

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
      return view && shownRes !== null ? coverageText(statsRows, view.indicator, shownRes) : "";
    },
    get sentence() {
      return sentence;
    },
    get notes() {
      return [
        ...(view?.notes ?? []),
        ...(resolved.note ? [resolved.note] : []),
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
