// The Scores lens as the shell reaches it: ONE lazily loaded module (`loadScores` in
// `virtual:instance-modules`, scripts/instance-modules.mjs), so an instance that does not build the
// lens carries none of it, not even the small readers the shell calls (MarineSensitivity/atlas
// 0.10.93 imported `boot.ts`, `fallback.ts` and `selection.ts` statically into Shell.svelte; here
// they come through this module). The panel, legend, search and modal components stay their own
// chunks, loaded through `components`.
export { createScoresLens, type ScoresLens } from "./state.svelte";
export { ecoregionZoneUnitFromManifest, fullSubregion, layerByKey, unitOptions } from "./boot";
export { effectiveLyr } from "./fallback";
export { parseScoresSelection } from "./selection";
export { placesSubjectHeader } from "./species";
export { lastClickedLabel } from "./lastClicked";
export { placeFromLastClicked } from "./lastClickedPlace";

/** the lens' components, each its own chunk (the shell mounts them once loaded). */
export const components = {
  Lens: () => import("./ScoresLens.svelte"),
  Legend: () => import("./ScoresLegend.svelte"),
  Search: () => import("./ScoresSearch.svelte"),
  Welcome: () => import("./WelcomeModal.svelte"),
};
