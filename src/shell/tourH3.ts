import type { TourActions, TourStep } from "./tour";

// --- an h3 layer's stops (obis-hex TOUR_STOPS that apply), after "layers" -------------------------
// A lazy module: Shell.svelte imports it when the tour starts on an h3 layer. The targets are the `data-tour`
// attributes of the lazy h3 controls (src/lens/collection/h3/H3Controls.svelte); tests/obis/tour.test.ts checks
// every one is stamped there.
const inLayers = (a: TourActions) => a.selectTool("layers");
export const H3_TOUR_STEPS: TourStep[] = [
  {
    id: "h3-sentence",
    element: '[data-tour="h3-sentence"]',
    side: "right",
    title: "What the map shows",
    description:
      "The sentence says it: taxon, period, place, hexagon size, indicator. Click a word to change it.",
    before: inLayers,
  },
  {
    id: "h3-layer",
    element: '[data-tour="h3-layer"]',
    side: "right",
    title: "All taxa or an EOV",
    description: "The Essential Ocean Variables, most records first.",
    before: inLayers,
  },
  {
    id: "h3-taxon",
    element: '[data-tour="h3-taxon"]',
    side: "right",
    title: "Any taxon group",
    description:
      "Search a phylum, class, order or family, or a group above class, by its scientific or common name.",
    before: inLayers,
  },
  {
    id: "h3-indicator",
    element: '[data-tour="h3-indicator"]',
    side: "right",
    title: "The indicator",
    description:
      "ES(50), richness, Shannon, Simpson or records; the colour range of the release or of the loaded hexagons.",
    before: inLayers,
  },
  {
    id: "h3-period",
    element: '[data-tour="h3-period"]',
    side: "right",
    title: "The period",
    description:
      "A decade or a year; each bar is the hexagons with records then. ←/→ step, Esc for all years.",
    before: inLayers,
  },
  {
    id: "h3-res",
    element: '[data-tour="h3-res"]',
    side: "right",
    title: "Hexagon size",
    description:
      "Auto from the zoom, or pinned. Click a hexagon for its five values and its species.",
    before: inLayers,
  },
  {
    id: "h3-share",
    element: '[data-tour="h3-share"]',
    side: "right",
    title: "Cite and reproduce",
    description: "The citation, the SQL that reads the view's file, the data sources and the keys.",
    before: inLayers,
  },
];
