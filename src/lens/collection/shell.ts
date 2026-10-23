// The Collections lens' components as the shell reaches them: one lazily loaded module
// (`loadCollection` in `virtual:instance-modules`, scripts/instance-modules.mjs), so an instance that
// does not build the lens carries none of them. The lens' reactive core and the place summaries
// stay eager (`createCollectionLens`, `createPlaceSummaries`): their map inputs must exist whether
// or not a panel has mounted. Each component is its own chunk, loaded when the lens (or its Table)
// is first shown.
export const components = {
  Lens: () => import("./CollectionLens.svelte"),
  Legend: () => import("./CollectionLegend.svelte"),
  SummaryTable: () => import("../../places/PlaceSummaryTable.svelte"),
};
