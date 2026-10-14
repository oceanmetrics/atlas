// Legacy query-key rewriting (plan atlas-2 `state/`): old Shiny-app links keep working, rewritten to
// today's keys before the normal parse runs. `mdl_key`/`mdl_seq` -> `sp` (+ `in` when the legacy id
// was a raw input key, resolved through `alias/{xx}.json`); `splash=false` -> `tour=off`; `er_clr` is
// kept as-is (the debug overlay) — nothing here deletes or renames it, so it simply falls into
// `parseSel`'s "unknown keys ignored" bucket rather than erroring or being mistaken for a rewrite
// trigger.
//
// `alias/{xx}.json` does not exist yet (it is atlas-1's to publish), so the lookup it will back is an
// INJECTABLE interface: every caller today gets `NO_ALIAS_LOOKUP` (always "unresolved") until a real
// implementation exists to inject.

export interface AliasResolution {
  sp?: string;
  in?: string;
}

export interface AliasLookup {
  /** resolve a legacy raw input key (`ds_key`) to today's `sp`/`in` pair, or `null` when unknown or
   * the lookup has no data (e.g. `alias/{xx}.json` not loaded yet). Never throws. */
  resolveInput(rawKey: string): AliasResolution | null;
}

/** the only implementation available until atlas-1 publishes `alias/{xx}.json`: every legacy id
 * carries through as `sp` alone (see `rewriteLegacyParams`), with no `in` resolved. */
export const NO_ALIAS_LOOKUP: AliasLookup = { resolveInput: () => null };

/**
 * Rewrite legacy keys on `params` IN PLACE, before the ordinary per-key parse in `codec.ts` runs.
 * - `mdl_key` (preferred when both are present — it is the STABLE public model id; `mdl_seq` is only
 *   ever an autoincrement that renumbers per rebuild, msens `version.R:387-391`) or `mdl_seq` -> `sp`;
 *   an existing `sp` value is never clobbered (a legacy id sitting beside an already-modern link keeps
 *   the modern value). The alias lookup may additionally resolve an `in` value from the same raw key.
 * - `splash=false` -> `tour=off` (an existing `tour` value is never clobbered either).
 * - `er_clr` is untouched: kept as the debug overlay, not part of `Sel`, so it survives as an
 *   "unknown key" that `parseSel` silently ignores.
 */
export function rewriteLegacyParams(
  params: URLSearchParams,
  alias: AliasLookup = NO_ALIAS_LOOKUP,
): void {
  const legacyId = params.get("mdl_key") ?? params.get("mdl_seq");
  if (legacyId !== null) {
    params.delete("mdl_key");
    params.delete("mdl_seq");
    if (!params.has("sp")) params.set("sp", legacyId);
    const resolved = alias.resolveInput(legacyId);
    if (resolved?.in && !params.has("in")) params.set("in", resolved.in);
  }

  if (params.get("splash") === "false") {
    params.delete("splash");
    if (!params.has("tour")) params.set("tour", "off");
  } else if (params.has("splash")) {
    // any OTHER splash= value is simply not a recognized legacy token (unknown values fall back to
    // defaults) — drop it rather than let it survive as a meaningless key on every rewritten link.
    params.delete("splash");
  }
}

/** the four tools the spine offers (mirrors `src/shell/tools.ts`'s `ToolName`; duplicated as a
 * plain union because `src/lib/` never imports from `src/shell/`). */
export type LegacyToolName = "layers" | "details" | "table" | "places";

/**
 * map a `?tool=` value to today's tool. `tool=flower` (the retired Flower rail tool) -> `details`;
 * `tool=report` (the retired Report tool, whose body was the Places flow) -> `places`; the four
 * current names pass straight through; anything else is `null` (absent -- a malformed value falls
 * through, it is never an error). `tool` is not a `Sel` key, so this is a separate reader the shell
 * calls once at boot, and only when no `ui=` token supplied a tool.
 */
export function legacyToolFromParams(params: URLSearchParams): LegacyToolName | null {
  const raw = params.get("tool");
  if (raw === "flower") return "details";
  if (raw === "report") return "places";
  if (raw === "layers" || raw === "details" || raw === "table" || raw === "places") return raw;
  return null;
}
