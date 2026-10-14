// What the Collections lens loads when the active collection is an MST one (`kinds.ts`):
//
//   nc / gm   the manifest's models as Items + the `cube:dimensions` that label and order the
//             selectors (`manifest.ts`);
//   taxon     one Item for the picked taxon, from the v7 `app/` bundle (`taxon.ts`); the Items are not
//             a list the user steps through (16 153 taxa), so the lens asks for one by key.
//
// Nothing here throws: every call resolves to a result shaped like `catalog/load.ts`'s.
import type { Loaded, LoadError } from "../load";
import type { CubeDimension, StacItem } from "../types";
import { loadTaxon, type FetchJson, type ShardCache } from "../../../lens/species/data/shards";
import { loadTaxa, type TaxaIndex } from "../../../lens/species/data/picker";
import { MST_SPECIES_VER } from "../../release/mst";
import { mstRefOf, mstTitle, type MstEntryLike } from "./kinds";
import { loadManifest, manifestCube, manifestItems, type ManifestKind } from "./manifest";
import { noSurfaceMessage, surfaceFor, taxonItem } from "./taxon";

export interface MstItemOptions {
  fetchImpl?: typeof fetch;
  /** where `mst/*.json` live (tests); default the page's own base. */
  manifestBase?: string;
}

export interface MstItemSet {
  items: StacItem[];
  /** the `cube:dimensions` for the selectors (nc / gm). */
  cube: Record<string, CubeDimension>;
}

function manifestError(url: string, message: string): LoadError {
  return { kind: "network", url, message: `the model table could not be read (${message})` };
}

/** the Items of an nc / gm entry. `ok: false` for a taxon collection (those load one taxon at a time). */
export async function loadMstItems(
  entry: MstEntryLike,
  opts: MstItemOptions = {},
): Promise<Loaded<MstItemSet>> {
  const ref = mstRefOf(entry);
  if (!ref || ref.kind === "taxon") {
    return {
      ok: false,
      error: { kind: "schema", url: entry.id, message: "not a dimension-cube MST collection" },
    };
  }
  const res = await loadManifest(ref.kind as ManifestKind, {
    fetchImpl: opts.fetchImpl,
    base: opts.manifestBase,
  });
  if (!res.ok) return { ok: false, error: manifestError(res.url, res.message) };
  return {
    ok: true,
    value: { items: manifestItems(res.manifest), cube: manifestCube(res.manifest) },
  };
}

// --- taxon collections ----------------------------------------------------------------------------

/** a shard error kind as a catalog `LoadErrorKind` (`not-found` is an HTTP-404-shaped answer). */
function loadKind(kind: string): LoadError["kind"] {
  return kind === "network" || kind === "parse" || kind === "schema" ? kind : "http";
}

export interface TaxonLoadOptions {
  ver?: string;
  fetchJson?: FetchJson;
  cache?: ShardCache;
}

/** the v7 taxa index (`app/taxa.json`), as the species lens' picker loads it. */
export async function loadMstTaxa(opts: TaxonLoadOptions = {}): Promise<Loaded<TaxaIndex>> {
  const ver = opts.ver ?? MST_SPECIES_VER;
  const res = await loadTaxa(ver, { fetchJson: opts.fetchJson });
  if (res.ok) return { ok: true, value: res.value };
  return {
    ok: false,
    error: {
      kind: loadKind(res.error.kind),
      url: res.error.url,
      message: res.error.detail,
      ...(res.error.status === undefined ? {} : { status: res.error.status }),
    },
  };
}

export type TaxonItemResult =
  | { ok: true; item: StacItem }
  /** the taxon is fine but has nothing to draw in this collection: a state, with a sentence for it. */
  | { ok: false; kind: "no-model"; message: string; sci: string }
  | { ok: false; kind: "error"; message: string; error: LoadError };

/** the Item of taxon `key` in the v7 collection `entry`. */
export async function loadTaxonItem(
  entry: MstEntryLike & { title: string },
  key: string,
  opts: TaxonLoadOptions = {},
): Promise<TaxonItemResult> {
  const ref = mstRefOf(entry);
  if (!ref || ref.kind !== "taxon") {
    return {
      ok: false,
      kind: "error",
      message: "not a taxon collection",
      error: { kind: "schema", url: entry.id, message: "not a taxon collection" },
    };
  }
  const res = await loadTaxon(ref.ver, key, { fetchJson: opts.fetchJson, cache: opts.cache });
  if (!res.ok) {
    const notFound = res.error.kind === "not-found";
    const message = notFound
      ? `Taxon ${key} is not in release ${ref.ver}.`
      : `The taxon could not be loaded (${res.error.detail}).`;
    return {
      ok: false,
      kind: "error",
      message,
      error: {
        kind: loadKind(res.error.kind),
        url: res.error.url,
        message,
        ...(res.error.status === undefined ? {} : { status: res.error.status }),
      },
    };
  }
  const card = res.value;
  const title = mstTitle(entry.id, entry.title);
  const item = taxonItem(card, ref.dsKey, entry.id, title);
  if (!item) {
    const s = surfaceFor(card, ref.dsKey);
    const reason = s.ok ? "no-input" : s.reason;
    return {
      ok: false,
      kind: "no-model",
      sci: card.sci,
      message: noSurfaceMessage(reason, card.sci, title, ref.ver),
    };
  }
  return { ok: true, item };
}
