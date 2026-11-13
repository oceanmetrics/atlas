// The lazy chunk of a collection's own vector overlays (`atlas:overlays`): which are on, the filter state,
// the style parts, and the hover/click interaction with its card. `state.svelte.ts` loads it once a
// collection that declares overlays opens, so the static path carries only the hook's parser
// (`lib/catalog/overlays.ts`) and a collection without overlays never loads this.
import { overlayFilterState, toggledCov, visibleOverlayIds } from "../../lib/catalog/overlayState";
import {
  cffWith,
  filtersByOverlay,
  optionToken,
  rangeToken,
  resolveFeatureFilters,
} from "../../lib/catalog/featureFilterState";
import { collectionOverlayStyle, covHitLayerIds } from "../../lib/map/layers/collectionOverlays";
import { installCollectionOverlayInteraction } from "./overlayInteraction";

export const runtime = {
  visibleOverlayIds,
  toggledCov,
  overlayFilterState,
  collectionOverlayStyle,
  covHitLayerIds,
  resolveFeatureFilters,
  filtersByOverlay,
  cffWith,
  optionToken,
  rangeToken,
  install: installCollectionOverlayInteraction,
};

export type OverlayRuntime = typeof runtime;
