// R3-W2: the Download menu's legend-endpoint formatter -- matches what the LIVE legend chip
// already shows (never a second `.toFixed(2)` guess, which prints "0.00"/"93.00" where the chip
// reads "0"/"93"). Species endpoints are integers (1..100), so they round; a collection layer's
// endpoints are already rounded upstream (`atlas:value_range`), so they print as given.
// This DUPLICATES `lens/species/mapInputs.ts#formatSpeciesLegendValue` rather than importing it:
// that module sits in a lazy lens chunk, and a static import here would re-introduce the bundle
// weight DownloadMenu.svelte's own lazy split exists to avoid.
import type { DownloadLens } from "./items";

export function legendValueFormatter(lens: DownloadLens): (value: number) => string {
  return lens === "species" ? (v) => String(Math.round(v)) : (v) => String(v);
}
