// The registry-backed half of the Collections lens' reactive core (WP7, AquaMaps native 0.5 degree):
// what a collection with `atlas:taxa_registry` needs beyond the generic catalog -> items -> item flow.
// Runes live here and in `state.svelte.ts` only; the rules (the registry ref and item template, the row
// -> Item builder, the search ranking, the native/downscaled fallback, the credits) are plain modules
// under `lib/catalog/registry/`.
//
//   registry rows   `registry.parquet`, read ONCE when a registry collection is opened (about 1 MB; the
//                   Item of the picked taxon is one of its rows);
//   search index    `registry_index.json`, loaded at idle or when the search box is focused, never on the
//                   static path and never twice (the picker is the Species lens' own, so the ranking is);
//   copy numbers    a row of registry v2 with `cog_3857_url` is drawn in the browser from that copy; its band statistics,
//                   histogram and zoom range are read from the shared side table by the original's content hash
//                   (`release/cog3857.ts`, a lazy chunk; nothing is drawn until the read settles, never titiler);
//   taxon           `?sp=` (default: *Dermochelys coriacea*, else the first row), its Item built from the
//                   row; a v7-era key (`sp_key_v7`) is mapped to the row's v8 key and the URL rewritten with
//                   replaceState; `?rep=native|005` picks which COG is drawn (005 only for a row that has one).
//
// Every request carries a token: a slower earlier answer never overwrites a later choice.
import { untrack } from "svelte";
import type { CollectionEntry, LoadError, Loaded } from "../../lib/catalog/load";
import {
  defaultRegistryKey,
  loadRegistryIndex,
  type FetchJson,
} from "../../lib/catalog/registry/search";
import { registryRefOf, itemTemplateOf, type RegistryRef } from "../../lib/catalog/registry/ref";
import {
  readRegistryRows,
  resolveRegistryKey,
  type RegistryRow,
  type RegistryRows,
} from "../../lib/catalog/registry/rows";
import {
  effectiveRep,
  registryItem,
  type CopySides,
  type RegistryRep,
} from "../../lib/catalog/registry/item";
import { contentHashOf } from "../../lib/release/contentHash";
import type { Cog3857Row } from "../../lib/release/cog3857";
import { AM005_COLLECTION_ID, AM005_COLLECTION_URL } from "../../lib/catalog/registry/credits";
import type { StacCollection, StacItem } from "../../lib/catalog/types";
import type { TaxaIndex } from "../../lens/species/data/picker";
import type { SelStore } from "../../lib/state/sel.svelte";

export type RegistryPhase = "idle" | "loading" | "ready" | "error";

export interface RegistrySourceDeps {
  selStore: SelStore;
  /** the active collection entry. */
  entry: () => CollectionEntry | null;
  /** every catalog entry: the MarineSensitivity v8 `am` collection is read from here when listed (it is not, today). */
  entries?: () => readonly CollectionEntry[];
  /** overrides for tests. */
  readRows?: (url: string, keyColumn?: string) => Promise<Loaded<RegistryRows>>;
  /** the shared side table's row of a content hash (default: `readCog3857Row` on the shared table); `null` = none. */
  readSide?: (contentHash: string) => Promise<Cog3857Row | null>;
  fetchJson?: FetchJson;
  /** run `fn` when the browser is idle (default `requestIdleCallback`, else a short timeout). */
  whenIdle?: (fn: () => void) => void;
}

export interface RegistrySource {
  /** the registry of the active entry, or null when it is not a registry collection. */
  readonly ref: RegistryRef | null;
  /** the search index once loaded (the picker's own shape), else null. */
  readonly taxa: TaxaIndex | null;
  readonly taxaPhase: RegistryPhase;
  /** the registry rows' load state. */
  readonly rowsPhase: RegistryPhase;
  /** the taxon on screen (`?sp=`, else the default), or null before the rows are there. */
  readonly taxonKey: string | null;
  /** the registry row of that taxon. */
  readonly row: RegistryRow | null;
  /** which COG is drawn: `005` only when asked for and the row has one. */
  readonly rep: RegistryRep;
  /** true when the taxon has a downscaled surface to switch to. */
  readonly canSwitchRep: boolean;
  /** [the taxon's Item] while the registry collection is active, else none. */
  readonly items: StacItem[];
  readonly phase: RegistryPhase;
  readonly error: LoadError | null;
  /** a sentence when there is nothing to draw (an unknown `sp`, a failed read). */
  readonly notice: string | null;
  /** the credits collection of the downscaled surface (MarineSensitivity v8 `am`), once loaded; null for native. */
  readonly downscaled: StacCollection | null;
  /** start loading the search index (idempotent); called on focus of the search box. */
  ensureIndex(): void;
  selectTaxon(key: string): void;
  setRep(rep: RegistryRep): void;
}

function idleDefault(fn: () => void): void {
  const w = globalThis as { requestIdleCallback?: (cb: () => void) => number };
  if (typeof w.requestIdleCallback === "function") w.requestIdleCallback(fn);
  else setTimeout(fn, 1500);
}

async function fetchCollection(url: string, fetchJson?: FetchJson): Promise<StacCollection | null> {
  try {
    const raw = fetchJson ? await fetchJson(url) : await (await fetch(url)).json();
    if (!raw || typeof raw !== "object") return null;
    const c = raw as StacCollection;
    if (typeof c.id !== "string" || !Array.isArray(c.links)) return null;
    return { ...c, type: "Collection", "atlas:url": url };
  } catch {
    return null;
  }
}

async function sharedSideRow(contentHash: string): Promise<Cog3857Row | null> {
  try {
    const m = await import("../../lib/release/cog3857");
    return await m.readCog3857Row(m.sharedTableUrl(), contentHash);
  } catch {
    return null;
  }
}

export function createRegistrySource(deps: RegistrySourceDeps): RegistrySource {
  const { selStore } = deps;
  const readRows = deps.readRows ?? readRegistryRows;
  const readSide = deps.readSide ?? sharedSideRow;
  const whenIdle = deps.whenIdle ?? idleDefault;

  let rows = $state.raw<RegistryRows | null>(null);
  let rowsPhase = $state<RegistryPhase>("idle");
  let rowsUrl = $state<string | null>(null);
  let taxa = $state.raw<TaxaIndex | null>(null);
  let taxaPhase = $state<RegistryPhase>("idle");
  let error = $state.raw<LoadError | null>(null);
  let downscaled = $state.raw<StacCollection | null>(null);

  const ref = $derived(registryRefOf(deps.entry()?.collection));

  // --- the rows, read once per registry ----------------------------------------------------------
  let rowsToken = 0;
  $effect(() => {
    const r = ref;
    if (!r) return;
    if (untrack(() => rowsUrl) === r.registryUrl && untrack(() => rowsPhase) !== "error") return;
    const token = ++rowsToken;
    untrack(() => {
      rowsUrl = r.registryUrl;
      rows = null;
      rowsPhase = "loading";
      error = null;
    });
    void readRows(r.registryUrl, r.keyColumn).then((res) => {
      if (token !== rowsToken) return;
      if (res.ok) {
        rows = res.value;
        rowsPhase = "ready";
      } else {
        error = res.error;
        rowsPhase = "error";
      }
    });
  });

  // --- the search index: at idle, or on focus -----------------------------------------------------
  let indexToken = 0;
  let indexUrl: string | null = null;
  function ensureIndex(): void {
    const url = untrack(() => ref?.indexUrl) ?? null;
    if (!url || indexUrl === url) return;
    indexUrl = url;
    const token = ++indexToken;
    taxaPhase = "loading";
    void loadRegistryIndex(url, deps.fetchJson).then((res) => {
      if (token !== indexToken) return;
      if (res.ok) {
        taxa = res.value;
        taxaPhase = "ready";
      } else {
        indexUrl = null; // a later focus retries
        taxaPhase = "error";
      }
    });
  }
  $effect(() => {
    if (!ref?.indexUrl || untrack(() => taxa)) return;
    let live = true;
    whenIdle(() => {
      if (live) ensureIndex();
    });
    return () => {
      live = false;
    };
  });

  // --- the taxon, its row and its Item -----------------------------------------------------------
  const taxonKey = $derived.by(() => {
    if (!ref || !rows) return null;
    const sp = selStore.sel.sp;
    if (sp) return resolveRegistryKey(rows, sp);
    return defaultRegistryKey(rows.values());
  });
  // an old link (`?sp=Fis-49220` of the v7 registry) resolves to its v8 row; the URL then names the v8 key
  $effect(() => {
    const key = taxonKey;
    const sp = selStore.sel.sp;
    if (key && sp && key !== sp) untrack(() => selStore.set({ sp: key }));
  });
  const row = $derived(taxonKey && rows ? (rows.get(taxonKey) ?? null) : null);
  const rep = $derived(effectiveRep(row, selStore.sel.rep));
  const template = $derived(itemTemplateOf(deps.entry()?.collection));
  // --- the drawn copy's numbers: the shared side table's row, by the original's content hash ------------
  // (only a row that names a copy of the drawn surface asks; the answer is dropped when the pick has moved on)
  const sideTarget = $derived.by((): { rep: RegistryRep; hash: string } | null => {
    if (!row) return null;
    const copy = rep === "005" ? row.cog3857Url005 : row.cog3857Url;
    const original = rep === "005" ? row.cogUrl005 : row.cogUrl;
    const hash = original ? contentHashOf(original) : null;
    return copy && hash ? { rep, hash } : null;
  });
  let side = $state.raw<{ rep: RegistryRep; hash: string; row: Cog3857Row | null } | null>(null);
  let sideToken = 0;
  $effect(() => {
    const t = sideTarget;
    const token = ++sideToken;
    if (!t) return;
    void readSide(t.hash)
      .catch(() => null)
      .then((r) => {
        if (token === sideToken) side = { ...t, row: r };
      });
  });
  const items = $derived.by((): StacItem[] => {
    const entry = deps.entry();
    if (!ref || !row || !entry) return [];
    const sides: CopySides =
      sideTarget && side && side.rep === sideTarget.rep && side.hash === sideTarget.hash
        ? { [sideTarget.rep]: side.row }
        : {};
    return [registryItem(row, entry.id, template, { rep, collectionTitle: entry.title, sides })];
  });
  const phase = $derived.by((): RegistryPhase => {
    if (!ref) return "idle";
    if (rowsPhase === "error") return "error";
    if (rowsPhase !== "ready") return "loading";
    return "ready";
  });
  const notice = $derived.by(() => {
    if (!ref) return null;
    if (rowsPhase === "error")
      return `The taxon registry could not be loaded (${error?.message ?? "unknown error"}).`;
    if (rowsPhase === "ready" && taxonKey && !row) {
      return `Taxon ${taxonKey} is not in this collection's registry. Pick another taxon.`;
    }
    return null;
  });

  // --- the downscaled surface's credits (MarineSensitivity v8 `am`), only once it is shown ---------------
  let downscaledToken = 0;
  $effect(() => {
    const showing = rep === "005";
    const token = ++downscaledToken;
    if (!showing) return;
    if (untrack(() => downscaled)) return;
    const listed = deps.entries?.().find((e) => e.id === AM005_COLLECTION_ID && e.collection);
    if (listed?.collection) {
      downscaled = listed.collection;
      return;
    }
    void fetchCollection(AM005_COLLECTION_URL, deps.fetchJson).then((c) => {
      if (token === downscaledToken && c) downscaled = c;
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
    get rowsPhase() {
      return rowsPhase;
    },
    get taxonKey() {
      return taxonKey;
    },
    get row() {
      return row;
    },
    get rep() {
      return rep;
    },
    get canSwitchRep() {
      return !!row?.cogUrl005;
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
    get downscaled() {
      return rep === "005" ? downscaled : null;
    },
    ensureIndex,
    selectTaxon(key) {
      const entry = deps.entry();
      if (!entry) return;
      if (rows && !rows.has(key)) return;
      selStore.set({ c: entry.id, sp: key, i: undefined });
    },
    setRep(next) {
      selStore.set({ rep: next });
    },
  };
}
