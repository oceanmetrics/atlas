// U6 (round 2): the guided tour's STEP DATA -- pure, driver.js-free, so it is testable under plain
// Node (CLAUDE.md's testing pyramid) without pulling the ~450 KB-budget-relevant driver.js chunk
// into this module's import graph. The RUNTIME (driver.js itself, the popover wiring) lives in
// `tourRuntime.ts`, which Shell.svelte reaches ONLY through a dynamic `import()` -- see that file's
// header. Anchors are the `data-tour="…"` attributes already stamped on the shell's controls
// (docs/usability.md "Take a tour", CalCOFI explore's `src/tour.ts` pattern) plus the two new ones
// this round adds: `rail-<tool>` (HexButton.svelte's `tourId` prop, via Rail.svelte) for a specific
// rail tool, and the species legend's own `data-testid` (already unique, so no new attribute
// needed there).
import type { Lens } from "../lib/state/types";
import type { ToolName } from "./tools";

export interface TourActions {
  getLens(): Lens;
  /** switches the lens (Shell.svelte's own `onLensChange`, reused verbatim). */
  setLens(lens: Lens): void;
  /** opens a rail tool's panel (Shell.svelte's own `selectTool`, reused verbatim). */
  selectTool(name: ToolName): void;
  /** captures the CURRENT lens/tool before the tour starts, so `restore()` can put them back --
   * the tour must leave the view exactly as it found it (CalCOFI's `src/tour.ts` pattern). */
  snapshot(): void;
  restore(): void;
}

export interface TourStep {
  /** stable, used by analytics (`tour_step`) and by the e2e gate that asserts every anchor
   * actually exists on the lens it belongs to. */
  id: string;
  /** a CSS selector into the live DOM -- driver.js resolves it itself, once `before()` (below) has
   * had a chance to make the target exist/visible. */
  element: string;
  title: string;
  description: string;
  side?: "left" | "right" | "top" | "bottom";
  align?: "start" | "center" | "end";
  /** puts the app into the state this step needs (a lens switch, a rail tool opened) BEFORE
   * driver.js tries to find/highlight `element` -- tourRuntime.ts's `onNextClick`/`onPrevClick`
   * run this and wait a beat for Svelte to render, exactly as CalCOFI's tour does. */
  before?: (a: TourActions) => void;
}

// --- Collections (6 steps) -------------------------------------------------------------------------
export const COLLECTION_TOUR_STEPS: TourStep[] = [
  {
    id: "map",
    element: '[data-tour="map"]',
    side: "left",
    align: "start",
    title: "The map",
    description: "Colour shows the selected layer of the selected collection.",
    // guarded (a tour started while ALREADY on the collection lens is the common case): calling
    // setLens() unconditionally re-sets lens state for no reason -- measured on the species side
    // (see the species step below) as a legend that never resolved because its OWN redundant
    // setLens() call kept restarting the species data load underneath the walk.
    before: (a) => {
      if (a.getLens() !== "collection") a.setLens("collection");
    },
  },
  {
    id: "lenses",
    element: '[data-tour="lens-switch"]',
    side: "bottom",
    title: "The lenses",
    description: "Collections maps a published layer; Species shows one species' distribution.",
  },
  {
    id: "layers",
    element: '[data-tour="rail-layers"]',
    side: "right",
    title: "Layers",
    description: "Choose the collection and its dimensions, such as group, season and metric.",
    before: (a) => a.selectTool("layers"),
  },
  {
    id: "click",
    element: '[data-tour="map"]',
    side: "left",
    align: "start",
    title: "Click",
    description: "Click a cell for its value.",
  },
  {
    id: "table",
    element: '[data-tour="rail-table"]',
    side: "right",
    title: "Table",
    description: "The tables for the current layer.",
    before: (a) => a.selectTool("table"),
  },
  {
    // the Places tool is one flow with no sub-tabs; this step opens it and points at its heading
    // (`Places.svelte`'s `[data-tour="places-heading"]`).
    id: "places",
    element: '[data-tour="places-heading"]',
    side: "right",
    title: "Places",
    description:
      "Pick a place from the gazetteer, draw your own area, enter coordinates or upload a file.",
    before: (a) => a.selectTool("places"),
  },
];

// --- Species (5 steps, docs/usability.md §5 "Take a tour", Species) -------------------------------
export const SPECIES_TOUR_STEPS: TourStep[] = [
  {
    id: "search",
    element: '[data-tour="search"]',
    side: "bottom",
    title: "Search",
    description: "Find a species by common or scientific name.",
    // guarded, same reason the collection "map" step's identical guard has: an UNCONDITIONAL
    // setLens("species") here, even when a `?sp=` deep link already put the shell on the species
    // lens, restarted the reactive chain the species lens' own data load depends on -- measured
    // directly: the "legend" step's anchor (a REAL resolved species query)
    // never appeared, reproducibly, until this guard was added.
    before: (a) => {
      if (a.getLens() !== "species") a.setLens("species");
    },
  },
  {
    id: "card",
    element: '[data-tour="panel"]',
    side: "right", // R4-B: the panel docks left by default
    align: "start",
    title: "The card",
    description: "The merged model and the inputs it combines.",
    before: (a) => a.selectTool("layers"),
  },
  {
    id: "map",
    element: '[data-tour="map"]',
    side: "left",
    align: "start",
    title: "The map",
    description: "Click anywhere for the modelled value.",
  },
  {
    id: "legend",
    element: '[data-testid="species-legend"]',
    side: "top",
    title: "The legend",
    description: "What 1–100 means.",
  },
  {
    id: "back",
    element: '[data-tour="lens-switch"]',
    side: "bottom",
    title: "Back",
    description: "Switch to Collections to map a published layer.",
  },
];

export function tourStepsForLens(lens: Lens): TourStep[] {
  return lens === "species" ? SPECIES_TOUR_STEPS : COLLECTION_TOUR_STEPS;
}
