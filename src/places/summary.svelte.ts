// places/summary.svelte.ts -- the reactive half of the place summaries and the "Only inside places"
// filter. It watches the Collections lens (the CURRENT item), the places list (`sel.pl`, gazetteer
// places by reference through `placesMap`) and `sel.filter`, and produces:
//   - `rows`: one SummaryRow per place (n cells, mean, min, max, no-value share) for the Places pane
//     and the Table tool;
//   - `insideFids`: the set of hex cells inside any place while the filter is on, which the lens
//     hands to the hex painter (feature state `inside`).
//
// Hex items: cells whose centroid is inside the place -- the `hex_centroids` table (read once per
// collection, lazily, only when there is a place or the filter is on), `lib/geo/pip.ts`, and the
// item's value column the lens already holds. The cell lists are cached per place geometry, so
// switching group / season / metric only recomputes the cheap statistics.
// Raster (COG) items: titiler `/cog/statistics` per place (`lib/raster/statistics.ts`), display-grid
// statistics, labelled as such.
//
// Every rule lives in the plain modules (summary.ts, pip.ts, statistics.ts); this file is wiring.
import { untrack } from "svelte";
import { centroidsAssetOf, readCentroids, type Centroids } from "../lib/catalog/centroids";
import type { Loaded } from "../lib/catalog/load";
import type { CollectionLens } from "../lens/collection/state.svelte";
import { prepareArea } from "../lib/geo/pip";
import type { AreaGeometry } from "../lib/geo/types";
import {
  createTitilerStatisticsSource,
  fetchPostJson,
  type RasterStats,
  type StatisticsSource,
} from "../lib/raster/statistics";
import type { SelStore } from "../lib/state/sel.svelte";
import type { Place } from "../lib/geo/placeCodec";
import type { PlacesMapStore } from "./placesMap.svelte";
import {
  cellStats,
  fidsInside,
  geometryKey,
  summaryRows,
  valueIndexOf,
  type CellStats,
  type PlaceInput,
  type SummaryRow,
} from "./summary";

export type SummaryMode = "hex" | "raster" | "none";

/** the slice of the Collections lens this reads (a fake satisfies it in a test). */
export type SummaryLens = Pick<
  CollectionLens,
  "entry" | "item" | "itemTitle" | "mapInputs" | "values" | "valuesLoading"
> &
  Partial<Pick<CollectionLens, "drawsH3">>;

export interface PlaceSummaries {
  readonly mode: SummaryMode;
  /** the item being summarised ("Richness, all species, summer"), `null` when none is drawable. */
  readonly subject: string | null;
  /** one row per place, index-aligned with the list; empty when there are no places. */
  readonly rows: readonly SummaryRow[];
  /** a one-line caveat about what the numbers are (centroid counting; display-grid statistics). */
  readonly caveat: string | null;
  /** why there is nothing to show for the current item ("This collection publishes no cell
   * centroids."), `null` when there is. */
  readonly unavailable: string | null;
  /** hex cells inside any place while `?filter=places` is on and ready; else `null` (no dimming). */
  readonly insideFids: ReadonlySet<number> | null;
  /** whether the filter can do anything for the current item/places, and when not, why. */
  readonly filterNote: string | null;
  readonly filterOn: boolean;
  /** the shown layer is an h3 layer: the filter keeps its hexagons by the gazetteer's H3 membership (the layer's
   * own panel says how many) */
  readonly h3: boolean;
  setFilter(on: boolean): void;
}

export interface PlaceSummariesDeps {
  selStore: SelStore;
  lens: SummaryLens;
  placesMap: Pick<PlacesMapStore, "gazGeometry" | "gazEntry">;
  /** default `readCentroids` (hyparquet, lazy). */
  readCentroids?: typeof readCentroids;
  /** default: titiler `/cog/statistics`. */
  statistics?: StatisticsSource;
}

const HEX_CAVEAT =
  "Cells are counted by centroid: a cell is in a place when its centre is, so edge cells count whole or not at all. Cells with no value are left out of the mean, min and max.";
export const RASTER_CAVEAT =
  "Raster statistics are for the display grid: the pixels of the map's raster whose centre is inside the place, as the tile server samples them. They are not zonal statistics of the model surface.";

export function createPlaceSummaries(deps: PlaceSummariesDeps): PlaceSummaries {
  const { selStore, lens, placesMap } = deps;
  const readCentroidTable = deps.readCentroids ?? readCentroids;
  const stats = deps.statistics ?? createTitilerStatisticsSource(fetchPostJson);

  // the g1 codec (and `model.ts`) are a lazy chunk: the list is decoded once it arrives
  let model = $state.raw<typeof import("./model") | null>(null);
  void import("./model").then((m) => {
    model = m;
  });
  const places = $derived<Place[]>(model ? model.placesFromHash(selStore.sel.pl) : []);
  const filterOn = $derived(selStore.sel.filter === "places");

  // --- the places, as the summary sees them ------------------------------------------------------
  const inputs = $derived.by<PlaceInput[]>(() =>
    places.map((p): PlaceInput => {
      if (p.kind === "geom") return { name: p.name, state: "ready", geometry: p.geometry };
      if (p.kind === "gaz") {
        const name = p.name || p.id;
        const g = placesMap.gazGeometry(p.id);
        if (g) return { name, state: "ready", geometry: g };
        return placesMap.gazEntry(p.id)?.status === "error"
          ? { name, state: "none", reason: "couldn't load this place" }
          : { name, state: "loading" };
      }
      if (p.kind === "upload") {
        return { name: p.name, state: "none", reason: "uploaded without geometry in this session" };
      }
      return {
        name: p.keys.join(", "),
        state: "none",
        reason: "an old zone place has no geometry",
      };
    }),
  );

  // --- what the current item is ------------------------------------------------------------------
  const hasHex = $derived(lens.mapInputs.hex !== null);
  const cogUrl = $derived(lens.mapInputs.cogUrl);
  const cogBidx = $derived(lens.mapInputs.cogBidx);
  const mode = $derived<SummaryMode>(hasHex ? "hex" : cogUrl ? "raster" : "none");
  const centroidsAsset = $derived(centroidsAssetOf(lens.entry?.collection ?? null));
  const needed = $derived(inputs.length > 0 || filterOn);

  // --- hex: the centroid table (once per collection, only when needed) -----------------------------
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- a plain cache read in effects only
  const centroidCache = new Map<string, Centroids>();
  let centroids = $state.raw<Centroids | null>(null);
  let centroidsPhase = $state<"idle" | "loading" | "ready" | "error">("idle");
  let centroidsToken = 0;
  $effect(() => {
    const asset = centroidsAsset;
    const want = needed && mode === "hex";
    const token = ++centroidsToken;
    if (!want || !asset) {
      untrack(() => {
        centroids = null;
        centroidsPhase = "idle";
      });
      return;
    }
    const hit = centroidCache.get(asset.url);
    if (hit) {
      untrack(() => {
        centroids = hit;
        centroidsPhase = "ready";
      });
      return;
    }
    untrack(() => {
      centroids = null;
      centroidsPhase = "loading";
    });
    void readCentroidTable(asset.url, asset.keyColumn).then((res: Loaded<Centroids>) => {
      if (token !== centroidsToken) return;
      if (res.ok) {
        centroidCache.set(asset.url, res.value);
        centroids = res.value;
        centroidsPhase = "ready";
      } else {
        centroidsPhase = "error";
      }
    });
  });

  // the cell list of a place geometry (a plain cache: the geometry decides, the item does not)
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- a plain cache read in derivations only
  const cellCache = new Map<string, number[]>();
  function cellsOf(c: Centroids, asset: string, g: AreaGeometry): number[] {
    const key = `${asset}|${geometryKey(g)}`;
    let hit = cellCache.get(key);
    if (!hit) {
      hit = fidsInside(c, prepareArea(g));
      cellCache.set(key, hit);
    }
    return hit;
  }

  const valueIndex = $derived(valueIndexOf(lens.values));

  const hexRows = $derived.by<SummaryRow[]>(() => {
    if (mode !== "hex" || !centroids || !centroidsAsset) return [];
    const c = centroids;
    const url = centroidsAsset.url;
    return summaryRows(inputs, (p) => {
      const fids = cellsOf(c, url, p.geometry);
      if (lens.valuesLoading || !lens.values) return null;
      return cellStats(fids.map((f) => valueIndex.get(f)));
    });
  });

  // --- raster: titiler statistics per place -------------------------------------------------------
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- bumped through `rasterVersion`
  const rasterCache = new Map<string, Loaded<RasterStats> | "pending">();
  let rasterVersion = $state(0);
  $effect(() => {
    if (mode !== "raster" || !cogUrl) return;
    const bidx = cogBidx ?? undefined;
    for (const p of inputs) {
      if (p.state !== "ready") continue;
      const key = `${cogUrl}|${bidx ?? 1}|${geometryKey(p.geometry)}`;
      if (rasterCache.has(key)) continue;
      rasterCache.set(key, "pending");
      void stats.statistics({ cogUrl, bidx, geometry: p.geometry }).then((res) => {
        rasterCache.set(key, res);
        rasterVersion++;
      });
    }
  });
  const rasterRows = $derived.by<SummaryRow[]>(() => {
    void rasterVersion;
    if (mode !== "raster" || !cogUrl) return [];
    const band = cogBidx ?? 1;
    return summaryRows(inputs, () => null, "pixels").map((row, i) => {
      const p = inputs[i];
      if (p.state !== "ready") return row;
      const got = rasterCache.get(`${cogUrl}|${band}|${geometryKey(p.geometry)}`);
      if (!got || got === "pending") return row;
      if (!got.ok) {
        const blocked = got.error.kind === "network";
        return {
          ...row,
          status: "error" as const,
          message: blocked
            ? "the tile server could not be reached for statistics"
            : got.error.message,
        };
      }
      const r = got.value;
      const s: CellStats = {
        n: r.count,
        nValue: r.count,
        noValueShare: r.noValueShare,
        mean: r.mean,
        min: r.min,
        max: r.max,
      };
      return {
        ...row,
        n: s.n,
        mean: s.mean,
        min: s.min,
        max: s.max,
        noValueShare: s.noValueShare,
        status: "ok" as const,
      };
    });
  });

  const rows = $derived<SummaryRow[]>(
    mode === "hex" ? hexRows : mode === "raster" ? rasterRows : [],
  );

  const unavailable = $derived.by<string | null>(() => {
    // an h3 layer's places are its filter's: the statistics of the hexagons are in the layer's panel, the place's own
    // values on its Place page
    if (lens.drawsH3)
      return "This layer is summarised per hexagon: turn on “Only inside places” for the hexagons of your places; each place's own values are on its Place page.";
    if (mode === "none") return "Pick a layer the map can draw to summarise it over your places.";
    if (mode === "hex" && !centroidsAsset) {
      return "This collection publishes no cell centroids, so it can't be summarised over places yet.";
    }
    if (mode === "hex" && centroidsPhase === "error") {
      return "The cell centroids could not be read, so places can't be summarised right now.";
    }
    return null;
  });

  // --- the filter ---------------------------------------------------------------------------------
  const insideFids = $derived.by<ReadonlySet<number> | null>(() => {
    if (!filterOn || mode !== "hex" || !centroids || !centroidsAsset) return null;
    const c = centroids;
    const url = centroidsAsset.url;
    const ready = inputs.filter(
      (p): p is Extract<PlaceInput, { state: "ready" }> => p.state === "ready",
    );
    if (!ready.length) return null;
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- a plain set handed to the painter
    const out = new Set<number>();
    for (const p of ready) for (const f of cellsOf(c, url, p.geometry)) out.add(f);
    return out;
  });
  const filterNote = $derived.by<string | null>(() => {
    if (!filterOn) return null;
    if (lens.drawsH3)
      return inputs.length
        ? "Only the hexagons of the places (the gazetteer's H3 membership): statistics of the hexagons, in the layer's panel."
        : "Add a place to see its hexagons.";
    if (mode !== "hex") return "The filter works on hex-grid layers; this layer isn't one.";
    if (unavailable) return unavailable;
    if (!inputs.length) return "Add a place to see the cells inside it.";
    if (!inputs.some((p) => p.state === "ready")) return "Waiting for the places to load.";
    if (centroidsPhase === "loading") return "Reading the cell centroids…";
    return null;
  });

  const subject = $derived(mode === "none" ? null : lens.itemTitle);
  const caveat = $derived(mode === "hex" ? HEX_CAVEAT : mode === "raster" ? RASTER_CAVEAT : null);

  return {
    get mode() {
      return mode;
    },
    get subject() {
      return subject;
    },
    get rows() {
      return rows;
    },
    get caveat() {
      return caveat;
    },
    get unavailable() {
      return unavailable;
    },
    get insideFids() {
      return insideFids;
    },
    get filterNote() {
      return filterNote;
    },
    get filterOn() {
      return filterOn;
    },
    get h3() {
      return !!lens.drawsH3;
    },
    setFilter(on) {
      selStore.set({ filter: on ? "places" : undefined });
    },
  };
}
