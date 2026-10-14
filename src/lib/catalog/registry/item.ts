// A registry row -> a STAC Item (`atlas:item_template`), and the native-vs-downscaled switch.
//
// The Item is built client-side: one COG asset `cog` (the native surface) and, when the row names one,
// `cog_005` (the same model downscaled to a global 0.05 degree grid by MarineSensitivity, release v8). Rules, one test each
// (tests/catalog/registry/item.test.ts):
//   - id = the row key; `bbox` = the box of the COG that is drawn (`bbox_native` or `bbox_005`; a malformed
//     box is left off, never guessed), geometry = that box as a polygon; `datetime: null`;
//   - the `cog` asset: rescale, colormap, band and no-data come from the collection's template, with
//     the Spectral-reversed ramp / [1, 100] / no-data 0 where it says nothing;
//   - `sdm:taxon`: names, the group (`other` for a model with no taxon match), WoRMS / BOTW ids as
//     `authorities`, the Red List code; a null value is omitted, never written as "null";
//   - `rep=005` with no `cog_url_005` falls back to native (`effectiveRep`), so a shared link to a taxon
//     with no downscaled surface still draws.
import { COG_MEDIA_TYPE, taxonFacts, taxonTitle, type TaxonFact } from "../mst/taxon";
import type { StacAsset, StacItem } from "../types";
import type { Representation } from "../../state/types";
import { OTHER_GROUP } from "./search";
import { DEFAULT_ITEM_TEMPLATE, type ItemTemplate } from "./ref";
import type { RegistryRow } from "./rows";

/** the representations of a registry taxon: the collection's own surface, or the 0.05 degree one. */
export type RegistryRep = "native" | "005";

/** `rep` from the URL -> what the registry draws: `005` only when asked for AND the row has one. */
export function effectiveRep(
  row: Pick<RegistryRow, "cogUrl005"> | null | undefined,
  rep: Representation | string | undefined,
): RegistryRep {
  return rep === "005" && row?.cogUrl005 ? "005" : "native";
}

/** the box of a row as a closed GeoJSON polygon ring. */
function boxPolygon(b: [number, number, number, number]): unknown {
  const [w, s, e, n] = b;
  return {
    type: "Polygon",
    coordinates: [
      [
        [w, s],
        [e, s],
        [e, n],
        [w, n],
        [w, s],
      ],
    ],
  };
}

/** the `sdm:taxon` property (template shape), with null values omitted. */
export function sdmTaxonOfRow(row: RegistryRow): Record<string, unknown> {
  const authorities: Record<string, string> = {};
  if (row.aphiaId !== null) authorities.worms = String(row.aphiaId);
  if (row.botwId !== null) authorities.botw = String(row.botwId);
  return {
    scientific_name: row.scientificName,
    ...(row.commonName ? { common_name: row.commonName } : {}),
    group: row.group ?? OTHER_GROUP,
    ...(Object.keys(authorities).length > 0 ? { authorities } : {}),
    ...(row.redlistCode ? { redlist_code: row.redlistCode } : {}),
  };
}

/**
 * The Item of one registry row. `rep` picks which COG plays the `data` role (the one the lens draws):
 * `native` (default) or `005` (needs `cog_url_005`, else native). Both assets are always listed when the
 * row has both, so the switch never has to rebuild anything but the roles.
 */
export function registryItem(
  row: RegistryRow,
  collectionId: string,
  template: ItemTemplate = DEFAULT_ITEM_TEMPLATE,
  opts: { rep?: Representation | string; collectionTitle?: string } = {},
): StacItem {
  const rep = effectiveRep(row, opts.rep);
  const box = rep === "005" ? row.bbox005 : row.bboxNative;
  const title = taxonTitle(row.scientificName, row.commonName);
  const cog: StacAsset = {
    href: row.cogUrl,
    type: COG_MEDIA_TYPE,
    roles: [rep === "native" ? "data" : "reference"],
    ...(template.title ? { title: template.title } : {}),
    bands: [
      {
        name: "suitability",
        data_type: "uint8",
        nodata: template.nodata,
        ...(template.unit ? { unit: template.unit } : {}),
      },
    ],
    "atlas:rescale": template.rescale,
    "atlas:colormap": template.colormap,
    "atlas:bidx": template.bidx,
  };
  const assets: Record<string, StacAsset> = { cog };
  if (row.cogUrl005) {
    assets.cog_005 = {
      href: row.cogUrl005,
      type: COG_MEDIA_TYPE,
      roles: [rep === "005" ? "data" : "reference"],
      title:
        "AquaMaps habitat suitability downscaled to 0.05 degree, global (MarineSensitivity v8)",
      "atlas:rescale": template.rescale,
      "atlas:colormap": template.colormap,
    };
  }
  return {
    type: "Feature",
    stac_version: "1.1.0",
    id: row.key,
    collection: collectionId,
    // each COG has its own footprint in the registry (`bbox_native`, `bbox_005`), so the source bounds of
    // BOTH representations come from the row and no `/cog/info` request is made
    ...(box ? { bbox: box, geometry: boxPolygon(box) } : {}),
    properties: {
      title,
      description: opts.collectionTitle ? `${title} in ${opts.collectionTitle}.` : title,
      datetime: null,
      "atlas:value_range": template.valueRange,
      "atlas:representation": rep,
      "sdm:taxon": sdmTaxonOfRow(row),
    },
    assets,
    links: [],
  };
}

// --- Details -------------------------------------------------------------------------------------

/** the AquaMaps species page for a registry key (`Rep-3437`). The plan's `receive.php?type_of_map=regular&
 * SpecID=` answers an empty frame on its own (it needs the session `preMap.php` starts); `preMap.php` with
 * the cached-map parameters opens the species' map page (checked in a browser 2026-10-14 for Fis-49220,
 * Thunnus thynnus). */
export function aquamapsUrl(key: string): string {
  return `https://www.aquamaps.org/preMap.php?cache=1&SpecID=${encodeURIComponent(key)}&from=premap&map=cached&type_of_map=regular`;
}

/** the Details rows of a registry Item: the taxon identifiers (WoRMS linked, BOTW, Red List) and the
 * AquaMaps key linked to its page. */
export function registryFacts(item: StacItem | null): TaxonFact[] {
  const facts = taxonFacts(item);
  if (!item) return facts;
  return [...facts, { label: "AquaMaps key", value: item.id, href: aquamapsUrl(item.id) }];
}
