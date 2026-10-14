// Per-taxon Items for the v7 MST collections, built from the release's `app/` bundle.
//
// WHICH ROUTE (docs/mst-by-reference.md): the MST STAC API (https://stac-api.marinesensitivity.org/)
// answers `/search` with CORS and one Item per model, but it serves release v9 only; asking for a v7
// collection (`msens-v7-am_0.05`) is an HTTP 500 ("No Parquet configured"). The catalog links v7, so
// the per-taxon Items are read from the v7 `app/` bundle the Species lens already uses
// (`taxa.json` index + `taxon/{xx}.json` shards), and presented under the STAC collection's own id,
// title and credits. `taxonItem` is the one place that turns a shard's `TaxonCard` into a STAC Item.
import type { StacAsset, StacItem } from "../types";
import { MERGED_DS_KEY, type TaxonAsset, type TaxonCard } from "../../../lens/species/data/shards";

export const COG_MEDIA_TYPE = "image/tiff; application=geotiff; profile=cloud-optimized";

export type Rescale = [number, number];

export type SurfaceResult =
  | {
      ok: true;
      url: string;
      /** VERBATIM from the shard; `null` when it names none (then the lens reads titiler's own). */
      rescale: Rescale | null;
      colormap: string | null;
      /** `merged` for the merged model, else the shard's `rep` (`model`, `native`). */
      rep: string;
    }
  | { ok: false; reason: "no-input" | "no-surface" | "no-asset" | "no-cog" };

function isCog(a: TaxonAsset): boolean {
  return a.type === "cog";
}

/**
 * The COG a taxon has in collection `dsKey`. `ms_merge` -> the merged surface. Any other dataset ->
 * that input's `model` representation (the surface on the analysis grid, which is what the
 * collection's value range describes), else any other COG it has. `no-input`: the taxon has no model
 * from this dataset at all; `no-surface` (merged only): the taxon has no merged surface in this
 * release; `no-asset`: the model feeds the merge but the release registers no file for it; `no-cog`: the dataset's models for it are all vector (PMTiles) and nothing here draws them.
 * A rescale is passed through verbatim and never defaulted.
 */
export function surfaceFor(card: TaxonCard, dsKey: string): SurfaceResult {
  if (dsKey === MERGED_DS_KEY) {
    const m = card.merged;
    if (!m) return { ok: false, reason: "no-surface" };
    return { ok: true, url: m.url, rescale: m.rescale, colormap: m.colormap, rep: "merged" };
  }
  const input = card.inputs.find((i) => i.dsKey === dsKey);
  if (!input) return { ok: false, reason: "no-input" };
  if (input.assets.length === 0) return { ok: false, reason: "no-asset" };
  const cogs = input.assets.filter(isCog);
  const asset = cogs.find((a) => a.rep === "model") ?? cogs[0];
  if (!asset) return { ok: false, reason: "no-cog" };
  return {
    ok: true,
    url: asset.url,
    rescale: asset.rescale,
    colormap: asset.colormap,
    rep: asset.rep,
  };
}

/** the `sdm:taxon` property an Item carries: the identifiers the Details panel shows. */
export interface SdmTaxon {
  scientific_name: string;
  common_name?: string;
  sp_cat?: string;
  /** the taxon authority's id (`137209`) and which authority (`worms`, `botw`). */
  id?: string;
  authority?: string;
  /** the same ids by authority, for the ones the atlas links or names. */
  ids: Record<string, string>;
  /** IUCN Red List category (`EN`). */
  redlist?: string;
  /** `NMFS:EN` style ESA listing. */
  esa?: string;
}

export function sdmTaxonOf(card: TaxonCard): SdmTaxon {
  const authority = card.taxonAuthority?.toLowerCase() ?? undefined;
  const ids: Record<string, string> = {};
  if (card.taxonId && authority) ids[authority] = card.taxonId;
  return {
    scientific_name: card.sci,
    ...(card.common ? { common_name: card.common } : {}),
    ...(card.spCat ? { sp_cat: card.spCat } : {}),
    ...(card.taxonId ? { id: card.taxonId } : {}),
    ...(authority ? { authority } : {}),
    ids,
    ...(card.rl ? { redlist: card.rl } : {}),
    // `IUCN:LC` with no source is a Red List code the shard mirrors, not an ESA listing
    ...(card.esa?.code && card.esa.source ? { esa: card.esa.code } : {}),
  };
}

/** `Dermochelys coriacea (Leatherback Turtle)`. */
export function taxonTitle(sci: string, common: string | null | undefined): string {
  return common ? `${sci} (${common})` : sci;
}

/**
 * The STAC Item for one taxon in one v7 collection: a single COG asset (`data`) carrying the
 * asset's own `atlas:rescale` and `atlas:colormap`, the legend range as `atlas:value_range`, and the
 * taxon's identifiers as `sdm:taxon`. `null` when the taxon has nothing drawable there (see
 * `surfaceFor`; the caller says why).
 */
export function taxonItem(
  card: TaxonCard,
  dsKey: string,
  collectionId: string,
  collectionTitle?: string,
): StacItem | null {
  const s = surfaceFor(card, dsKey);
  if (!s.ok) return null;
  const asset: StacAsset = {
    href: s.url,
    type: COG_MEDIA_TYPE,
    roles: ["data"],
    "atlas:rescale": s.rescale ?? "auto",
    ...(s.colormap ? { "atlas:colormap": s.colormap } : {}),
  };
  const title = taxonTitle(card.sci, card.common);
  return {
    type: "Feature",
    id: card.key,
    collection: collectionId,
    properties: {
      title,
      description: collectionTitle ? `${title} in ${collectionTitle}.` : title,
      datetime: null,
      ...(s.rescale ? { "atlas:value_range": s.rescale } : {}),
      "sdm:taxon": sdmTaxonOf(card),
      "atlas:representation": s.rep,
    },
    assets: { data: asset },
    links: [],
  };
}

// --- the Details rows -----------------------------------------------------------------------------

export interface TaxonFact {
  label: string;
  value: string;
  href?: string;
}

const WORMS_URL = "https://www.marinespecies.org/aphia.php?p=taxdetails&id=";

const AUTHORITY_LABEL: Record<string, string> = {
  worms: "WoRMS AphiaID",
  botw: "BOTW (BirdLife) id",
  gbif: "GBIF id",
};

/** the identifiers of an Item's `sdm:taxon`, as labelled rows (WoRMS links to its taxon page). Total:
 * an Item with no `sdm:taxon` yields none. */
export function taxonFacts(item: StacItem | null): TaxonFact[] {
  const raw = item?.properties?.["sdm:taxon"];
  if (!raw || typeof raw !== "object") return [];
  const t = raw as Partial<SdmTaxon>;
  const facts: TaxonFact[] = [];
  if (t.scientific_name) facts.push({ label: "Scientific name", value: t.scientific_name });
  if (t.common_name) facts.push({ label: "Common name", value: t.common_name });
  if (t.sp_cat) facts.push({ label: "Category", value: t.sp_cat });
  for (const [authority, id] of Object.entries(t.ids ?? {})) {
    if (!id) continue;
    const label = AUTHORITY_LABEL[authority] ?? `${authority} id`;
    facts.push(
      authority === "worms" && /^[0-9]+$/.test(id)
        ? { label, value: id, href: `${WORMS_URL}${id}` }
        : { label, value: id },
    );
  }
  if (t.redlist) facts.push({ label: "IUCN Red List", value: t.redlist });
  if (t.esa) facts.push({ label: "ESA listing", value: t.esa });
  return facts;
}

/** why a taxon has nothing to draw in a collection, in a sentence the panel can show. */
export function noSurfaceMessage(
  reason: Extract<SurfaceResult, { ok: false }>["reason"],
  taxon: string,
  collectionTitle: string,
  ver: string,
): string {
  switch (reason) {
    case "no-input":
      return `${taxon} has no model in ${collectionTitle} (${ver}). Pick another taxon, or look for it in the Merged Model.`;
    case "no-surface":
      return `${ver} publishes no merged surface for ${taxon}.`;
    case "no-asset":
      return `${ver} has no raster registered for ${taxon}'s ${collectionTitle} model.`;
    case "no-cog":
      return `${taxon}'s ${collectionTitle} model is a vector range; only raster surfaces are drawn here yet.`;
  }
}
