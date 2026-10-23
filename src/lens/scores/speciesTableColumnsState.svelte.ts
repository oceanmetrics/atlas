// P3 fix (owner-reported, 2026-09-24): the species table's "Columns" picker choice persists for
// the SESSION -- module-scope `$state` (the same idiom `state.svelte.ts` uses for other
// non-URL chrome), so it survives `SpeciesTable.svelte` remounting (switching the Species/Zones/
// Composition sub-tab and back, or closing/reopening the Table tool) without writing to
// localStorage or the URL. `null` means "no user choice yet -- use the phone default"
// (`speciesTableColumns.ts#SPECIES_PHONE_DEFAULT_COLUMNS`); a page reload resets it, same as any
// other chrome-only preference this repo keeps out of `sel`.
export const speciesColumnsState: { chosen: Set<string> | null } = $state({ chosen: null });
