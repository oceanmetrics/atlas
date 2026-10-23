// The hook registry (vision doc 2026-10-21, "The atlas, one codebase with skins"): everything a
// collection needs to render beyond the generic lens is declared in its STAC as an `atlas:*` hook,
// and this file is the ONE place that maps a hook name to the module that reads it. Each module keeps
// its own code and exports its own name (`FLOWER_HOOK`, `CELL_SPECIES_HOOK`, `TAXA_REGISTRY_HOOK`, and `H3_HOOK`,
// the one hook named by a platform profile rather than an `atlas:*` field: `h3` -> `catalog/h3.ts`);
// the registry only names hook -> parser. Never a collection id: the hook is the field.
//
//   HOOKS          hook name -> { parse(collection) -> spec | null } (null: not declared, or unusable)
//   hooksOf        the registry's hooks a collection declares usably, in registry order
//   hookSpec       one hook's parsed spec, typed by its name
//   unknownHooks   the collection's `atlas:*` keys that are neither a registered hook nor a generic
//                  data field (DATA_FIELDS): a renderer hook this build lacks (`atlas:uncertainty`
//                  arrives with the MarineSensitivity instance, build week 4, 2026-11-20 to 11-26)
//
// Static imports only of the parsers: none of them pulls hyparquet or duckdb (cellSpecies.ts
// reads its tiles behind its own dynamic import), so the size budget's static graph is unchanged.
// The MST kinds (`mst/kinds.ts`) stay id-keyed for now; they become a declared hook in week 4.
import { CELL_SPECIES_HOOK, parseCellSpecies } from "./cellSpecies";
import { FLOWER_HOOK, flowerSpecOf } from "./flower";
import { H3_HOOK, parseH3 } from "./h3";
import { TAXA_REGISTRY_HOOK, registryRefOf } from "./registry/ref";
import type { StacCollection } from "./types";

type Collection = StacCollection | null | undefined;

export const HOOKS = {
  [FLOWER_HOOK]: { parse: flowerSpecOf },
  [CELL_SPECIES_HOOK]: { parse: parseCellSpecies },
  [TAXA_REGISTRY_HOOK]: { parse: registryRefOf },
  // a collection of the platform `h3` profile: hexagons from its own Parquet (`h3ReleaseSlot`, lazy)
  [H3_HOOK]: { parse: parseH3 },
} as const satisfies Record<string, { parse(collection: Collection): unknown }>;

export type HookName = keyof typeof HOOKS;

/** the spec a hook's parser returns (without the `null`). */
export type HookSpec<N extends HookName> = NonNullable<ReturnType<(typeof HOOKS)[N]["parse"]>>;

/** the registered hook names, in registry order. */
export const HOOK_NAMES = Object.keys(HOOKS) as HookName[];

/**
 * The `atlas:*` fields that are data, not renderers: read by the generic lens, the loader or a hook's
 * own module, on a Collection, an Item, an asset or a cube dimension. `atlas:item_template` is the
 * `atlas:taxa_registry` hook's companion (registry/ref.ts#itemTemplateOf); `atlas:url` is set by the
 * loader itself.
 */
export const DATA_FIELDS: ReadonlySet<string> = new Set([
  "atlas:absent",
  "atlas:absent_note",
  "atlas:access",
  "atlas:bidx",
  "atlas:colormap",
  "atlas:dims",
  "atlas:funders",
  "atlas:id_field",
  "atlas:item_template",
  "atlas:key",
  "atlas:key_column",
  "atlas:key_property",
  "atlas:labels",
  "atlas:metric",
  "atlas:note",
  "atlas:representation",
  "atlas:rescale",
  "atlas:status",
  "atlas:taxa",
  "atlas:taxon_dim",
  "atlas:url",
  "atlas:value_column",
  "atlas:value_range",
]);

/** one hook's parsed spec for `collection`, or null when it does not declare it (or not usably). */
export function hookSpec<N extends HookName>(collection: Collection, name: N): HookSpec<N> | null {
  return (HOOKS[name].parse(collection) as HookSpec<N> | null) ?? null;
}

/** the registered hooks `collection` declares usably (its parser returns a spec), in registry order. */
export function hooksOf(collection: Collection): HookName[] {
  return HOOK_NAMES.filter((name) => hookSpec(collection, name) !== null);
}

/** the collection's top-level `atlas:*` keys that are neither a registered hook nor a data field. */
export function unknownHooks(collection: Collection): string[] {
  if (!collection) return [];
  return Object.keys(collection).filter(
    (k) => k.startsWith("atlas:") && !(k in HOOKS) && !DATA_FIELDS.has(k),
  );
}
