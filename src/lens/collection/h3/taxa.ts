// The taxon field of the H3 layer (build week 4, step 5; obis-hex `data/taxa.ts` and `TaxonPanel.svelte`): the
// layers of the search asset (`taxon_groups.parquet`: the EOVs, phylum to family, and the heads above class written
// as taxon layers by obisindicators 0.11) as one searchable list, with record counts on a log bar and common names
// for the groups people look for. `heads.json` says which layer serves each head (`served_by`). Pure functions
// plus two readers (hyparquet, a dynamic import, and fetch); Node-tested (tests/obis/taxa.test.ts).
import { COMPRESSORS, openRangeFile } from "@oceanmetrics/map";
import type { HeadRow, TaxonRow } from "./view";

/** scientific name -> English common name (WoRMS names as they appear in taxon_groups.parquet), obis-hex 0.11.3 */
export const COMMON_NAMES: Record<string, string> = {
  // phyla
  Chordata: "chordates",
  Arthropoda: "arthropods",
  Mollusca: "molluscs",
  Annelida: "segmented worms",
  Echinodermata: "echinoderms",
  Cnidaria: "cnidarians",
  Foraminifera: "forams",
  Rhodophyta: "red algae",
  Porifera: "sponges",
  Chlorophyta: "green algae",
  Tracheophyta: "vascular plants",
  Bryozoa: "moss animals",
  Chaetognatha: "arrow worms",
  Ctenophora: "comb jellies",
  Nematoda: "roundworms",
  Nemertea: "ribbon worms",
  Platyhelminthes: "flatworms",
  Brachiopoda: "lamp shells",
  Cyanobacteria: "blue-green algae",
  Ochrophyta: "brown algae and kin",
  Myzozoa: "dinoflagellates and kin",
  // classes
  Teleostei: "bony fishes",
  Aves: "birds",
  Malacostraca: "crabs, shrimps and kin",
  Cephalopoda: "squids and octopuses",
  Mammalia: "mammals",
  Polychaeta: "bristle worms",
  Elasmobranchii: "sharks and rays",
  Holocephali: "chimaeras",
  Copepoda: "copepods",
  Bacillariophyceae: "diatoms",
  Phaeophyceae: "brown algae",
  Bivalvia: "clams and mussels",
  Dinophyceae: "dinoflagellates",
  Gastropoda: "snails and slugs",
  Hexacorallia: "stony corals and anemones",
  Octocorallia: "soft corals",
  Asteroidea: "sea stars",
  Echinoidea: "sea urchins",
  Florideophyceae: "red seaweeds",
  Chondrostei: "sturgeons",
  Ophiuroidea: "brittle stars",
  Demospongiae: "demosponges",
  Hydrozoa: "hydroids",
  Scyphozoa: "true jellyfish",
  Holothuroidea: "sea cucumbers",
  Crinoidea: "sea lilies",
  Magnoliopsida: "flowering plants",
  Gymnolaemata: "bryozoans",
  Ascidiacea: "sea squirts",
  Ulvophyceae: "green seaweeds",
  Coccolithophyceae: "coccolithophores",
  Thecostraca: "barnacles",
  Ostracoda: "seed shrimps",
  Branchiopoda: "water fleas",
  Pycnogonida: "sea spiders",
  Thaliacea: "salps",
  Appendicularia: "larvaceans",
  Reptilia: "reptiles",
  Polyplacophora: "chitons",
  Scaphopoda: "tusk shells",
  // orders
  Charadriiformes: "gulls, terns and auks",
  Gadiformes: "cods",
  Perciformes: "perch-like fishes",
  Decapoda: "crabs, shrimps and lobsters",
  Pleuronectiformes: "flatfishes",
  Clupeiformes: "herrings",
  Myopsida: "inshore squids",
  Calanoida: "calanoid copepods",
  Pelecaniformes: "pelicans and herons",
  Procellariiformes: "albatrosses and petrels",
  Carnivora: "seals, sea lions and otters",
  Salmoniformes: "salmons",
  Laminariales: "kelps",
  Cetartiodactyla: "whales and dolphins (and kin)",
  Scombriformes: "tunas and mackerels",
  Carcharhiniformes: "ground sharks",
  Anseriformes: "ducks and geese",
  Sphenisciformes: "penguins",
  Suliformes: "gannets and cormorants",
  Gaviiformes: "loons",
  Testudines: "turtles",
  Sirenia: "sea cows",
  Euphausiacea: "krill",
  Amphipoda: "amphipods",
  Isopoda: "isopods",
  Scleractinia: "stony corals",
  Alcyonacea: "soft corals",
  Actiniaria: "sea anemones",
  Octopoda: "octopuses",
  Lamniformes: "mackerel sharks",
  Myliobatiformes: "stingrays",
  Rajiformes: "skates",
  Squaliformes: "dogfish sharks",
  Alismatales: "seagrasses (and kin)",
  Fucales: "rockweeds",
  // families (listed while searching)
  Delphinidae: "dolphins",
  Balaenopteridae: "rorquals",
  Balaenidae: "right whales",
  Physeteridae: "sperm whale",
  Phocidae: "true seals",
  Otariidae: "sea lions and fur seals",
  Cheloniidae: "sea turtles",
  Laridae: "gulls and terns",
  Procellariidae: "petrels and shearwaters",
  Diomedeidae: "albatrosses",
  Spheniscidae: "penguins",
  Scombridae: "tunas and mackerels",
  Carcharhinidae: "requiem sharks",
  Gadidae: "cods",
  Clupeidae: "herrings",
  Acroporidae: "staghorn corals",
  Zosteraceae: "eelgrasses",
  Rhizophoraceae: "mangroves",
  // the heads above class (obisindicators 0.11 writes them as taxon layers)
  Animalia: "animals",
  Plantae: "plants",
  Vertebrata: "vertebrates",
  Gnathostomata: "jawed vertebrates",
  Tetrapoda: "four-limbed vertebrates",
  Crustacea: "crustaceans",
  Cetacea: "whales and dolphins",
};

export const commonName = (taxon: string): string | null => COMMON_NAMES[taxon] ?? null;

/** the rows' label: the scientific name, then the common name ("Aves — birds") */
export const rowLabel = (r: Pick<TaxonRow, "taxon">) => {
  const cn = commonName(r.taxon);
  return cn ? `${r.taxon} — ${cn}` : r.taxon;
};

/** the ranks in list order: the heads above phylum and between the ranks fall where WoRMS puts them */
export const RANK_ORDER = [
  "kingdom",
  "subkingdom",
  "infrakingdom",
  "phylum",
  "subphylum",
  "infraphylum",
  "parvphylum",
  "gigaclass",
  "megaclass",
  "superclass",
  "class",
  "order",
  "family",
];
const RANK_GROUP: Record<string, string> = {
  phylum: "Phyla",
  class: "Classes",
  order: "Orders",
  family: "Families",
};
export const rankGroup = (rank: string) =>
  RANK_GROUP[rank] ?? `${rank.charAt(0).toUpperCase()}${rank.slice(1)} (above class)`;

/** ranks too long to list unfiltered (about 5,800 families): their rows appear only while searching */
export const QUERY_RANKS: ReadonlySet<string> = new Set(["family"]);
/** rows shown per group before "… N more, type to search" */
export const GROUP_CAP = 50;

/** a log-scale bar width (0 to 1) for a record count against the largest count in the list */
export function logBar(n: number | undefined, max: number): number {
  if (!n || n <= 0 || !(max > 1)) return 0;
  return Math.min(1, Math.log10(n + 1) / Math.log10(max + 1));
}

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** a row's match rank for `q` (lower is better): exact 0, prefix 1, word prefix 2, substring 3; null for none.
 * The scientific name, the rank and the common name are searched. */
export function matchRank(r: TaxonRow, q: string): number | null {
  const want = fold(q.trim());
  if (!want) return null;
  let best: number | null = null;
  for (const hay of [r.taxon, r.rank, commonName(r.taxon) ?? ""]) {
    const h = fold(hay);
    if (!h) continue;
    const score =
      h === want
        ? 0
        : h.startsWith(want)
          ? 1
          : h.split(/[\s,()—-]+/).some((w) => w.startsWith(want))
            ? 2
            : h.includes(want)
              ? 3
              : null;
    if (score !== null && (best === null || score < best)) best = score;
  }
  return best;
}

export interface TaxonGroup {
  label: string;
  rank: string;
  rows: (TaxonRow & { bar: number; label: string })[];
  /** rows left out by the cap */
  more: number;
}

/**
 * The field's list: the taxon rows by rank (heads first, then phylum to family), most records first, each group
 * capped (`GROUP_CAP`, "… N more, type to search"). Families are listed only while searching, except the one on
 * the map (`current`). With a query, only rows that match, best match first then most records.
 */
export function taxonGroups(
  rows: readonly TaxonRow[],
  query = "",
  current: string | null = null,
): TaxonGroup[] {
  const taxa = rows.filter((r) => r.kind !== "eov");
  const max = Math.max(1, ...taxa.map((r) => r.n));
  const q = query.trim();
  const ranks = [...new Set(taxa.map((r) => r.rank))].sort(
    (a, b) =>
      (RANK_ORDER.indexOf(a) < 0 ? 99 : RANK_ORDER.indexOf(a)) -
      (RANK_ORDER.indexOf(b) < 0 ? 99 : RANK_ORDER.indexOf(b)),
  );
  const out: TaxonGroup[] = [];
  for (const rank of ranks) {
    let list = taxa
      .filter((r) => r.rank === rank)
      .map((r) => ({ r, m: q ? matchRank(r, q) : 0 }))
      .filter(
        ({ r, m }) =>
          m !== null && (q || !QUERY_RANKS.has(rank) || `${r.rank}:${r.taxon}` === current),
      );
    list = list.sort((a, b) => (a.m ?? 9) - (b.m ?? 9) || b.r.n - a.r.n);
    if (list.length === 0) continue;
    out.push({
      label: rankGroup(rank),
      rank,
      rows: list
        .slice(0, GROUP_CAP)
        .map(({ r }) => ({ ...r, label: rowLabel(r), bar: logBar(r.n, max) })),
      more: Math.max(0, list.length - GROUP_CAP),
    });
  }
  return out;
}

// ---- readers ------------------------------------------------------------------------------------------------

/** the rows of the search asset (an absolute url read by range, or a buffer for tests). Throws on failure. */
export async function readTaxonRows(source: string | ArrayBuffer): Promise<TaxonRow[]> {
  const { parquetMetadataAsync, parquetReadObjects } = await import("hyparquet");
  const compressors = COMPRESSORS;
  const file = typeof source === "string" ? await openRangeFile(source) : source;
  if (!file) throw new Error(`${String(source)}: not found`);
  const metadata = await parquetMetadataAsync(file, { initialFetchSize: 65_536 });
  const rows = (await parquetReadObjects({
    file,
    metadata,
    columns: ["kind", "rank", "taxon", "label", "n", "url_path"],
    compressors,
  })) as Record<string, unknown>[];
  return rows.map((r) => ({
    kind: String(r.kind ?? ""),
    rank: String(r.rank ?? ""),
    taxon: String(r.taxon ?? ""),
    label: String(r.label ?? r.taxon ?? ""),
    n: Number(r.n ?? 0),
    urlPath: String(r.url_path ?? ""),
  }));
}

/** heads.json's rows (`aphiaid, name, rank, served_by, layer`). */
export function headsOf(json: unknown): HeadRow[] {
  const heads = (json as { heads?: unknown })?.heads;
  if (!Array.isArray(heads)) return [];
  return heads
    .filter((h): h is Record<string, unknown> => !!h && typeof h === "object")
    .map((h) => ({
      aphiaid: Number(h.aphiaid),
      name: String(h.name ?? ""),
      rank: String(h.rank ?? ""),
      servedBy: String(h.served_by ?? ""),
      layer: String(h.layer ?? ""),
    }))
    .filter((h) => Number.isInteger(h.aphiaid) && h.layer !== "");
}

// ---- the layer list: all taxa and the EOVs (the collection's Items) -------------------------------------------------

export interface LayerRow {
  /** the Item id (`i=`) */
  id: string;
  label: string;
  /** "eov" or "all" */
  kind: string;
  /** the EOV's records (`taxon_groups.parquet` `kind = 'eov'`), null before the taxa are read and for all taxa */
  n: number | null;
  bar: number;
}

/**
 * The layer list (obis-hex `taxonItems()`'s head): All taxa first, then the EOVs most records first with their
 * records on a log bar (the counts of the search asset's EOV rows); before the counts arrive, the EOVs in the cube's
 * order. `items` are the collection's Items with their kind and key (`itemKindOf`).
 */
export function layerRows(
  items: readonly { id: string; label: string; kind: string; key?: string }[],
  taxa: readonly Pick<TaxonRow, "kind" | "taxon" | "n">[] | null,
): LayerRow[] {
  const counts = new Map((taxa ?? []).filter((r) => r.kind === "eov").map((r) => [r.taxon, r.n]));
  const max = Math.max(1, ...counts.values());
  const rows = items.map((it, i) => {
    const n = it.kind === "eov" ? (counts.get(it.key ?? it.id) ?? null) : null;
    return { row: { id: it.id, label: it.label, kind: it.kind, n, bar: logBar(n ?? 0, max) }, i };
  });
  rows.sort(
    (a, b) =>
      +(b.row.kind === "all") - +(a.row.kind === "all") ||
      (b.row.n ?? -1) - (a.row.n ?? -1) ||
      a.i - b.i,
  );
  return rows.map((r) => r.row);
}
