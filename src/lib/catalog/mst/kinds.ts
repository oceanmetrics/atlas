// Which MarineSensitivity (MST) collections the app knows how to draw, and under what name.
//
// The catalog links the MST STAC BY REFERENCE (https://file.marinesensitivity.org/stac/), and the
// loader flattens the v7 parent into its children (`catalog/load.ts`). Those collections publish no
// per-taxon Items: each has ONE `*-model_cell` Item pointing at a Parquet of per-taxon rows, which
// the Collections lens cannot draw. Three kinds are drawn instead, each from per-model COGs:
//
//   taxon  a v7 collection (`msens-v7-{ds_key}`: am_0.05, rng_iucn, ..., ms_merge). One COG PER TAXON,
//          found through the release's `app/` bundle (`taxa.json` + `taxon/{xx}.json`), picked by
//          name; the lens' own selector is a taxon search, not a dimension.
//   nc     `msens-v8-nc`, NOAA NCCOS seabird density: region x species-or-group x season x variable.
//   gm     `msens-v8-gm`, NOAA SEFSC density (Gulf of Mexico): species x time.
//
// nc and gm are dimension cubes whose per-model table the STAC does not publish yet, so their
// dimensions come from a static manifest (`public/mst/{nc,gm}_models.json`, `manifest.ts`).
import type { CollectionEntry } from "../load";

export type MstKind = "taxon" | "nc" | "gm";

export interface MstRef {
  kind: MstKind;
  /** the dataset key (`am_0.05`, `ms_merge`, `nc`, `gm`). */
  dsKey: string;
  /** the MST release the collection belongs to. */
  ver: "v7" | "v8";
}

/** the pieces of an entry the rules read (so a test need not build a whole entry). */
export type MstEntryLike = Pick<CollectionEntry, "id" | "group">;

/** the MST kind of a catalog entry, or `null` for anything else (the catalog's own collections, an
 * MST collection of a release the app does not draw). The group guard stops a collection of the
 * catalog's own that happens to reuse an MST id from being hijacked. */
export function mstRefOf(entry: MstEntryLike | null | undefined): MstRef | null {
  if (!entry) return null;
  if (entry.group === "mst-v7") {
    const m = /^msens-v7-(.+)$/.exec(entry.id);
    return m ? { kind: "taxon", dsKey: m[1], ver: "v7" } : null;
  }
  if (entry.group === "mst-v8") {
    if (entry.id === "msens-v8-nc") return { kind: "nc", dsKey: "nc", ver: "v8" };
    if (entry.id === "msens-v8-gm") return { kind: "gm", dsKey: "gm", ver: "v8" };
  }
  return null;
}

/** picker titles that replace the STAC collection's own where it is ambiguous or too terse. The
 * titles are the atlas' wording; the STAC `description`, citation and license are shown untouched. */
const TITLES: Record<string, string> = {
  // the v7 `am_0.05` collection is the DOWNSCALED AquaMaps; the raw 0.5 degree one is the atlas' own
  // `aquamaps_native` (WP7), so the name has to say which one this is
  "msens-v7-am_0.05": "AquaMaps habitat suitability (0.05 degree)",
  "msens-v8-nc": "NOAA NCCOS seabird density (Atlantic and Pacific)",
  "msens-v8-gm": "NOAA SEFSC marine mammal and sea turtle density (Gulf of Mexico)",
};

/** the title to list `id` under: the atlas' override, else the STAC title. */
export function mstTitle(id: string, stacTitle: string): string {
  return TITLES[id] ?? stacTitle;
}
