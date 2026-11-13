// Which of a collection's own overlays are on (`cov=`) and what "Only features matching the selected layer"
// (`covf=1`) does with the Item's `atlas:overlay_filter`: the pure rules the Collections lens applies to the
// parsed `atlas:overlays` (`overlays.ts`). Not on the static path: the lens reaches this module through its
// overlays' lazy chunk (`lens/collection/overlayRuntime.ts`), loaded only for a collection that has overlays.
import { OVERLAY_FILTER_FIELD, type CollectionOverlaySpec, type OverlayFilter } from "./overlays";
import type { StacItem } from "./types";

const isRecord = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/** an Item's `atlas:overlay_filter`, or null when it names none (or a token that holds the delimiter). */
export function overlayFilterOf(item: StacItem | null | undefined): OverlayFilter | null {
  const f = item?.properties?.[OVERLAY_FILTER_FIELD];
  if (!isRecord(f)) return null;
  const field = str(f.field);
  const token = str(f.token);
  return field && token && !token.includes("|") ? { field, token } : null;
}

// --- which overlays are on (`cov=`) ----------------------------------------------------------------

/** the overlays drawn: `cov` (the URL) when present, unknown ids ignored, else the `default: true` ones.
 * Always in the collection's own order (the draw order), whatever order the URL lists them in. */
export function visibleOverlayIds(
  specs: readonly CollectionOverlaySpec[],
  cov: readonly string[] | undefined,
): string[] {
  return specs.filter((s) => (cov === undefined ? s.default : cov.includes(s.id))).map((s) => s.id);
}

/** the `Sel.cov` after switching `id` on or off: `undefined` again when the result is the defaults. */
export function toggledCov(
  specs: readonly CollectionOverlaySpec[],
  cov: readonly string[] | undefined,
  id: string,
  on: boolean,
): string[] | undefined {
  const cur = visibleOverlayIds(specs, cov);
  const next = specs.map((s) => s.id).filter((sid) => (sid === id ? on : cur.includes(sid)));
  const defaults = visibleOverlayIds(specs, undefined);
  return next.length === defaults.length && next.every((x, i) => x === defaults[i])
    ? undefined
    : next;
}

// --- "Only features matching the selected layer" (`covf=1`) ---------------------------------------

export interface OverlayFilterState {
  /** at least one overlay declares a `filter_field`: the panel offers the checkbox. */
  offered: boolean;
  /** the checkbox can be ticked: the Item names a filter that an overlay's `filter_field` matches. */
  enabled: boolean;
  /** why it cannot (the checkbox's title); `null` when it can. */
  reason: string | null;
  /** the filter the map applies right now (`covf=1` and enabled), else null. */
  active: OverlayFilter | null;
}

export function overlayFilterState(
  specs: readonly CollectionOverlaySpec[],
  item: StacItem | null | undefined,
  covf: boolean,
): OverlayFilterState {
  const offered = specs.some((s) => s.filterField !== null);
  const filter = overlayFilterOf(item);
  const matches = !!filter && specs.some((s) => s.filterField === filter.field);
  const reason = !offered
    ? null
    : !filter
      ? "The selected layer names no matching features."
      : !matches
        ? `No collection layer is filtered by "${filter.field}".`
        : null;
  return { offered, enabled: matches, reason, active: covf && matches ? filter : null };
}
