// The species lens' data layer, part 3: the deep-link resolver.
//
// WHAT HAS TO KEEP WORKING (`atlas-refs/"parity species app.md"` §4, §9):
//   - `?mdl_key=ms_merge|WORMS:137209` — a merged key, as the scores app emits it (URL-encoded there,
//     raw when the old app wrote it back: `|` and `:` go in unescaped).
//   - `?mdl_key=am|Rep-3437` — ANY raw input key, which must land on the taxon AND select that input.
//   - `?mdl_seq=54383` — the v1-v7b integer id, published in the BOEM final report and its
//     deliverables. Those links are in PDFs that cannot be re-issued; they resolve or they are dead.
//   - a target that is not US-valid turns the "Only species in US waters" checkbox OFF, or the taxon
//     it just resolved to would not be in the list the picker is showing.
//
// HOW. One `alias/{xx}.json` fetch (shards.ts), no DuckDB, no scan of the picker index. The alias
// shard carries every raw input key AND every legacy `mdl_seq`, and the merged key itself maps to
// `[merged_key, "ms_merge"]` — so one lookup answers all three cases, and the kind of answer is
// exactly the `resolution` the analytics event has always recorded.
//
// ORDER OF PRECEDENCE matches state/legacy.ts (`mdl_key` beats `mdl_seq`, and a modern `sp=` beats
// both): a legacy id is only ever a fallback for a link that does not already say `sp`.
import {
  MERGED_DS_KEY,
  loadAlias,
  type LoadOptions,
  type ShardResult,
  type AliasEntry,
} from "./shards";
import type { TaxaIndex } from "./picker";
import { formatSel, parseSel, type UrlLike } from "../../../lib/state/codec";
import { DEFAULT_SEL, defaultOut, type Sel } from "../../../lib/state/types";

/** the `in` value meaning "the merged model" in this app's URL (state/types.ts's default). */
export const MERGED_IN = DEFAULT_SEL.in;

/** what the old app logged, and still logs: `deeplink_mdl_key{mdl_key, resolution}` (§10,
 * app.R:1388-1392). `resolution` is a RESOLUTION KIND only — app.R's own comment warns against
 * mixing ok/error values into that column, which would spoil it for filtering. */
export type DeepLinkResolution = "merged_model" | "input_model" | "not_found";

/** the event as DATA. analytics/ is not imported here on purpose: this module is pure and the UI
 * half hands this object to `track()`. tests/lens/species/resolve.test.ts type-checks this shape
 * against `EventParamsMap["deeplink_mdl_key"]`, so the two cannot drift. */
export interface DeepLinkEvent {
  name: "deeplink_mdl_key";
  params: { mdl_key: string; resolution: DeepLinkResolution };
}

/** §5.5 modal 4 / app.R:1410-1428 — the two explanations a dead link gets, verbatim. The first is
 * parameterized by the key that failed. */
export function notFoundReasons(key: string): string[] {
  return [
    `The requested model (mdl_key=${key}) is no longer available. It may have been modified or ` +
      `removed by a newer version of the Marine Sensitivity Toolkit.`,
    "Please search for the species using the Species dropdown above.",
    "If the species is not listed, its expert range map (IUCN Red List) falls entirely outside the " +
      "US Exclusive Economic Zone, so it has no modeled distribution in the study area.",
  ];
}

export type DeepLinkResult =
  | {
      kind: "species";
      /** merged key -> `?sp=`. */
      sp: string;
      /** `ds_key` of the input to show, or `"merged"`. */
      in: string;
      resolution: "merged_model" | "input_model";
      /** the target is not US-valid: the picker's "US only" box must be unticked (§4). `null` = not
       * decided yet (the taxa index is not loaded, so validity is unknown): the caller loads the
       * index and settles it with `settleUs()` -- it must NOT be read as "clear". */
      clearUs: boolean | null;
      /** null when nothing legacy was in the URL (a modern `?sp=` link logs no deep-link event). */
      event: DeepLinkEvent | null;
    }
  | {
      kind: "not-found";
      key: string;
      reasons: string[];
      event: DeepLinkEvent;
    }
  | {
      kind: "none";
    };

/** which key a URL is asking with, and whether it is a legacy one. `sp` wins, then `mdl_key`, then
 * `mdl_seq` (state/legacy.ts's rule: `mdl_key` is the stable public id; `mdl_seq` renumbers). */
export function deepLinkKey(params: URLSearchParams): { key: string; legacy: boolean } | null {
  const sp = params.get("sp")?.trim();
  if (sp) return { key: sp, legacy: false };
  const mdlKey = params.get("mdl_key")?.trim();
  if (mdlKey) return { key: mdlKey, legacy: true };
  const mdlSeq = params.get("mdl_seq")?.trim();
  if (mdlSeq) return { key: mdlSeq, legacy: true };
  return null;
}

/** does this taxon need the "US only" box unticked to be visible? `null` when the index is not
 * loaded yet: validity is UNKNOWN and nothing may be decided (it used to answer `true`, which
 * switched US-only off -- `us=0` in the rewritten URL -- for a species with US waters). With the
 * index loaded, a taxon it does not list is treated as NOT US-valid (`coalesce(is_valid_usa,
 * FALSE)`), so the box is cleared rather than hiding the target. */
export function isNonUsTarget(index: TaxaIndex | null, mergedKey: string): boolean | null {
  if (!index) return null;
  const row = index.byKey.get(mergedKey);
  return row ? !row.validUsa : true;
}

/** settle a `clearUs: null` result once the index is available; any other result is returned as is. */
export function settleUs(result: DeepLinkResult, index: TaxaIndex | null): DeepLinkResult {
  if (result.kind !== "species" || result.clearUs !== null) return result;
  return { ...result, clearUs: isNonUsTarget(index, result.sp) };
}

/**
 * The pure half: turn an alias entry (or its absence) into a result. Split out so every branch is
 * testable without a fetch, and so the async wrapper below has no rules of its own.
 *
 * `entry` is the `alias/{xx}.json` row for `key`, or null when the shard did not contain it. The
 * `ms_merge` ds_key is what a MERGED key maps to; anything else is a raw input key.
 */
export function resolveFromAlias(
  key: string,
  entry: AliasEntry | null,
  index: TaxaIndex | null,
  opts: { legacy?: boolean } = {},
): DeepLinkResult {
  const legacy = opts.legacy ?? true;
  const event = (resolution: DeepLinkResolution): DeepLinkEvent => ({
    name: "deeplink_mdl_key",
    params: { mdl_key: key, resolution },
  });

  if (entry) {
    const merged = entry.dsKey === MERGED_DS_KEY;
    return {
      kind: "species",
      sp: entry.mergedKey,
      in: merged ? MERGED_IN : entry.dsKey,
      resolution: merged ? "merged_model" : "input_model",
      clearUs: isNonUsTarget(index, entry.mergedKey),
      event: legacy ? event(merged ? "merged_model" : "input_model") : null,
    };
  }

  // no alias row: the key may still BE a merged key the picker index knows (app.R's second branch,
  // `url_mdl_key %in% all_keys`) — e.g. a release whose alias shard omits the self-mapping
  if (index?.byKey.has(key))
    return {
      kind: "species",
      sp: key,
      in: MERGED_IN,
      resolution: "merged_model",
      clearUs: isNonUsTarget(index, key),
      event: legacy ? event("merged_model") : null,
    };

  return { kind: "not-found", key, reasons: notFoundReasons(key), event: event("not_found") };
}

export interface ResolveOptions extends LoadOptions {
  /** the picker index, when it is already loaded. Optional: a deep link must resolve on the FIRST
   * paint, before the ~1 MB index is fetched — without it the US-only box is cleared for a target
   * whose validity is unknown, which shows the taxon rather than hiding it. */
  index?: TaxaIndex | null;
  /** injected for tests; defaults to shards.ts's cached loader. */
  loadAliasEntry?: (ver: string, key: string) => Promise<ShardResult<AliasEntry>>;
}

/**
 * Resolve a URL's species deep link for `ver`. Never throws: a shard that fails to load resolves to
 * `not-found` with the same two explanations a genuinely retired key gets (the user-visible
 * outcome is identical, and the typed error is already recorded by shards.ts).
 */
export async function resolveDeepLink(
  ver: string,
  params: URLSearchParams,
  opts: ResolveOptions = {},
): Promise<DeepLinkResult> {
  const asked = deepLinkKey(params);
  if (!asked) return { kind: "none" };
  const load = opts.loadAliasEntry ?? ((v, k) => loadAlias(v, k, opts));
  const res = await load(ver, asked.key);
  const entry = res.ok ? res.value : null;
  return resolveFromAlias(asked.key, entry, opts.index ?? null, { legacy: asked.legacy });
}

// ---- the canonical URL --------------------------------------------------------------------------

/** the view a resolved deep link produces, as a patch on `Sel`. */
export interface SpeciesTarget {
  sp: string;
  in: string;
  /** representation; `undefined` keeps whatever the URL said. */
  rep?: Sel["rep"];
  /** false when the resolver cleared it. */
  us?: boolean;
}

export function targetOf(result: DeepLinkResult, current: Sel): SpeciesTarget | null {
  if (result.kind !== "species") return null;
  // `clearUs: null` (undecided) keeps whatever the URL said, exactly as a searched species does
  return { sp: result.sp, in: result.in, us: result.clearUs === true ? false : current.us };
}

/**
 * The canonical URL rewrite, as a pure function: `sp` + `in` + `rep` (each written only when it
 * differs from its default), every legacy key DROPPED.
 *
 * It is `parseSel` -> patch -> `formatSel`, deliberately: `parseSel` already rewrites `mdl_key` /
 * `mdl_seq` / `splash` (state/legacy.ts) and `formatSel` already omits defaults and keeps `,`/`:`
 * readable. Re-implementing either here is how two encoders drift apart. The app writes this with
 * `history.replaceState`, never `pushState` (CLAUDE.md, "URL-is-the-view").
 */
export function canonicalUrl(
  loc: UrlLike,
  target: SpeciesTarget,
): { search: string; hash: string } {
  const sel = parseSel(loc);
  // `out`'s default is per-lens (state/types.ts's DEFAULT_OUT_BY_LENS). A URL that never said `out`
  // must keep taking the default of the lens it ends up in, or switching to the species lens would
  // write the SCORES default out into the link as if the user had chosen it.
  const explicitOut = new URLSearchParams(loc.search ?? "").has("out");
  const next: Sel = {
    ...sel,
    lens: "species",
    out: explicitOut ? sel.out : defaultOut("species"),
    sp: target.sp,
    in: target.in,
    rep: target.rep ?? sel.rep,
    us: target.us ?? sel.us,
  };
  return formatSel(next);
}
