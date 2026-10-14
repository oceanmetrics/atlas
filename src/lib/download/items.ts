// R3-W2 Deliverable 2: the Download menu's item LIST, as data -- pure, DOM-free, one function per
// lens state (CLAUDE.md's testing pyramid: "one fixture per rule/branch"). `DownloadMenu.svelte`
// maps each `kind` to the actual DOM action (`mapCapture.ts`/`cogDownload.ts`/`places/download.ts`)
// -- this module decides only WHICH items exist and whether each is enabled, never how to execute
// one (a canvas/fetch call has no business being "pure").
import type { IconName } from "../ui/icon-paths";
import type { DownloadLens } from "./filename";

export type { DownloadLens };

export type DownloadItemKind = "map-png" | "map-svg" | "cog-tif" | "places-geojson";

export interface DownloadItemSpec {
  id: DownloadItemKind;
  label: string;
  hint?: string;
  icon: IconName;
  disabled: boolean;
}

export interface DownloadItemsContext {
  /** `null`/`undefined` -> "Data layer · GeoTIFF" is disabled with a reason; a string -> enabled. */
  cogUrl?: string | null;
  /** why `cogUrl` is missing, shown as the disabled item's hint (e.g. "no COG published for this
   * view", "no surface selected") -- required whenever `cogUrl` is falsy, per the brief's "Disabled
   * (with the reason as the hint) when no COG is published for the view." */
  cogDisabledReason?: string;
  /** whether the current session has at least one place to export (`sel.pl`, decoded) -- the
   * brief: "Offer 'Selected places · GeoJSON' ... when there is a selection." */
  hasPlacesSelection: boolean;
}

const MAP_PNG: DownloadItemSpec = {
  id: "map-png",
  label: "Map view · PNG",
  hint: "the current view, with legend and footer",
  icon: "image",
  disabled: false,
};

const MAP_SVG: DownloadItemSpec = {
  id: "map-svg",
  label: "Map view · SVG",
  hint: "raster map in an SVG wrapper",
  icon: "vectorFile",
  disabled: false,
};

/**
 * The Download menu's items for the current view. Order matches the brief's own listing (Map PNG,
 * Map SVG, Data layer GeoTIFF, Vector data GeoJSON).
 */
export function buildDownloadItems(ctx: DownloadItemsContext): DownloadItemSpec[] {
  const items: DownloadItemSpec[] = [MAP_PNG, MAP_SVG];

  items.push(
    ctx.cogUrl
      ? {
          id: "cog-tif",
          label: "Data layer · GeoTIFF",
          hint: "the COG this view draws",
          icon: "geoRaster",
          disabled: false,
        }
      : {
          id: "cog-tif",
          label: "Data layer · GeoTIFF",
          hint: ctx.cogDisabledReason ?? "no COG published for this view",
          icon: "geoRaster",
          disabled: true,
        },
  );

  if (ctx.hasPlacesSelection) {
    items.push({
      id: "places-geojson",
      label: "Selected places · GeoJSON",
      hint: "the current places, as analysed",
      icon: "geoVector",
      disabled: false,
    });
  }

  return items;
}
