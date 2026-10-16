// Dimension selectors for a collection, derived from its `cube:dimensions` (STAC datacube
// extension), and the rules that turn a selection into an Item.
//
// A collection is a cube: every Item carries `atlas:dims`, one value per dimension (biotrack:
// group x season x metric = 6 x 2 x 2 items). The selectors are every NON-spatial `cube:dimensions`
// entry that lists `values`, in declaration order (object key order); a collection that declares no
// selectable dimension falls back to the dimensions its items' `atlas:dims` reveal, in first-seen
// order. The rules, one function each, each with its own test:
//
//   dimsOf          which selectors, with value labels (cube `values`, `atlas:labels`, `{value,label}`)
//   itemDims        an item's own dims, stringified
//   defaultSelection  the first value of every dimension
//   resolveItem     the item whose dims equal the selection EXACTLY, else null
//   snapItem        the nearest item to a selection (keeps the dimension the user just changed,
//                   then as many others as possible, ties to the first in declaration order)
//   availableValues the values of one dimension that still lead to an item given the other selections
//
// URL state (`Sel.c` / `Sel.i`, written by `selPatchFor`): `?c=<collection id>&i=<item id>`. Item ids
// are stable per collection, so one `i` names the whole selection; the dims are derived from the
// item, not stored separately. The default view (the first available collection, its default item)
// writes NOTHING (the URL is empty), and an unknown `c` or `i` falls back to the default rather than
// erroring.
import type { CollectionEntry } from "./load";
import type { CubeDimension, StacCollection, StacItem } from "./types";

export interface DimValue {
  value: string;
  label: string;
}

export interface DimSpec {
  /** the key in `cube:dimensions` and in each item's `atlas:dims`. */
  key: string;
  /** a short selector label ("Group"); the cube's own `title`, else the key, title-cased. */
  label: string;
  /** the cube's `description`, usable as a tooltip. */
  description?: string;
  /** the dimension that picks a taxon (`cube:dimensions[key]["atlas:taxon_dim"]`). */
  taxon?: boolean;
  values: DimValue[];
}

/** `shark_tank` -> `Shark tank`; a short human label for a key or value with no label of its own. */
export function prettify(raw: string): string {
  const s = raw.replace(/[_]+/g, " ").trim();
  return s.length === 0 ? raw : s.charAt(0).toUpperCase() + s.slice(1);
}

/** dimension types that are the grid itself, never a selector. */
const NON_SELECTABLE_TYPES = new Set(["spatial", "geometry"]);

function valueEntries(dim: CubeDimension): DimValue[] {
  const labels = dim["atlas:labels"] ?? {};
  const out: DimValue[] = [];
  const seen = new Set<string>();
  for (const v of dim.values ?? []) {
    const value = typeof v === "object" && v !== null ? String(v.value) : String(v);
    if (seen.has(value)) continue;
    seen.add(value);
    const own = typeof v === "object" && v !== null && typeof v.label === "string" ? v.label : null;
    out.push({ value, label: own ?? labels[value] ?? prettify(value) });
  }
  return out;
}

/** an item's own dims, every value stringified (`{}` for an item with none). */
export function itemDims(item: StacItem): Record<string, string> {
  const raw = item.properties?.["atlas:dims"];
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) out[k] = String(v);
  return out;
}

/**
 * An item's display title: its own `properties.title`, else its dimension labels in the cube's order joined by
 * " · " ("All EOVs (mean) · Risk-weighted share"; the labels are the selectors' own, so the layer reads the same
 * as the selection that picked it), else its id. A collection whose items carry no title of their own (the
 * `eov` x `metric` cube) thus needs none written per item.
 */
export function itemTitleOf(item: StacItem, dims: readonly DimSpec[]): string {
  const own = item.properties?.title;
  if (typeof own === "string" && own.trim()) return own.trim();
  const have = itemDims(item);
  const parts = dims
    .filter((d) => have[d.key] !== undefined)
    .map((d) => d.values.find((v) => v.value === have[d.key])?.label ?? prettify(have[d.key]));
  return parts.length > 0 ? parts.join(" · ") : item.id;
}

/** the selectors for `collection`; `items` supply them when the cube declares none (and any value an
 * item uses that the cube's `values` list omits is appended, so every item stays reachable). */
export function dimsOf(
  collection: StacCollection | null,
  items: readonly StacItem[] = [],
): DimSpec[] {
  const specs: DimSpec[] = [];
  const cube = collection?.["cube:dimensions"];
  if (cube && typeof cube === "object") {
    for (const [key, dim] of Object.entries(cube)) {
      if (!dim || typeof dim !== "object") continue;
      if (dim.type && NON_SELECTABLE_TYPES.has(dim.type)) continue;
      const values = valueEntries(dim);
      if (values.length === 0) continue;
      specs.push({
        key,
        label: dim.title?.trim() || prettify(key),
        ...(dim.description ? { description: dim.description } : {}),
        ...(dim["atlas:taxon_dim"] === true ? { taxon: true } : {}),
        values,
      });
    }
  }
  // dimensions only the items reveal (no cube, or a dimension the cube did not list)
  for (const item of items) {
    for (const [key, value] of Object.entries(itemDims(item))) {
      let spec = specs.find((s) => s.key === key);
      if (!spec) {
        spec = { key, label: prettify(key), values: [] };
        specs.push(spec);
      }
      if (!spec.values.some((v) => v.value === value)) {
        spec.values.push({ value, label: prettify(value) });
      }
    }
  }
  return specs;
}

/** the first value of every dimension. */
export function defaultSelection(dims: readonly DimSpec[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const d of dims) if (d.values.length > 0) out[d.key] = d.values[0].value;
  return out;
}

function matches(item: StacItem, wanted: Record<string, string>): boolean {
  const have = itemDims(item);
  return Object.entries(wanted).every(([k, v]) => have[k] === v);
}

/** the item whose dims equal `wanted` on every key `wanted` names, else `null`. */
export function resolveItem(
  items: readonly StacItem[],
  wanted: Record<string, string>,
): StacItem | null {
  return items.find((i) => matches(i, wanted)) ?? null;
}

/**
 * The nearest item to `wanted` when no item matches it exactly -- the "switch one selector, snap the
 * rest" behaviour. Items are scored by how many dimensions agree with `wanted`; the dimension the
 * user just `changed` must agree (an item that does not carry it is never chosen), then the most
 * other dimensions, ties to the first item in the collection's own order. `null` for no items.
 */
export function snapItem(
  items: readonly StacItem[],
  wanted: Record<string, string>,
  changed?: string,
): StacItem | null {
  const exact = resolveItem(items, wanted);
  if (exact) return exact;
  let best: StacItem | null = null;
  let bestScore = -1;
  for (const item of items) {
    const have = itemDims(item);
    if (changed && wanted[changed] !== undefined && have[changed] !== wanted[changed]) continue;
    const score = Object.entries(wanted).filter(([k, v]) => have[k] === v).length;
    if (score > bestScore) {
      best = item;
      bestScore = score;
    }
  }
  return best;
}

/** the values of `dim` that lead to an item given the OTHER dimensions' current `selected` values
 * (the dimension itself is ignored), so a selector can grey out an impossible choice. */
export function availableValues(
  dim: DimSpec,
  items: readonly StacItem[],
  selected: Record<string, string>,
): Set<string> {
  const others = Object.fromEntries(Object.entries(selected).filter(([k]) => k !== dim.key));
  const out = new Set<string>();
  for (const item of items) {
    if (!matches(item, others)) continue;
    const v = itemDims(item)[dim.key];
    if (v !== undefined) out.add(v);
  }
  return out;
}

// --- the selectors' text: why a value is unavailable, which values to list, what a snap changed ------------

const labelOf = (dim: DimSpec | undefined, value: string | undefined): string =>
  (dim?.values.find((v) => v.value === value)?.label ?? value ?? "").trim();

/**
 * The note after an unavailable value of `dim` ("Atlantic" with a Pacific-only species selected). It
 * names what blocks it: the sibling dimension whose CURRENT value is the only thing keeping `value`
 * from an item (dropping that one selection would make an item exist). A taxon-like sibling reads
 * "(no Common Murre model)"; any other "(not with the current season)"; when no single sibling is to
 * blame (several together) "(not with the current selection)". A value that is available has no note
 * (`""`).
 */
export function unavailableNote(args: {
  dim: DimSpec;
  value: string;
  dims: readonly DimSpec[];
  items: readonly StacItem[];
  selected: Record<string, string>;
}): string {
  const { dim, value, dims, items, selected } = args;
  if (availableValues(dim, items, selected).has(value)) return "";
  // taxon-like siblings are asked first: "no <species> model" is the more telling reason
  const siblings = dims
    .filter((d) => d.key !== dim.key)
    .sort((a, b) => Number(b.taxon === true) - Number(a.taxon === true));
  for (const sib of siblings) {
    const rest = Object.fromEntries(
      Object.entries(selected).filter(([k]) => k !== dim.key && k !== sib.key),
    );
    const leadsToItem = items.some((it) => matches(it, rest) && itemDims(it)[dim.key] === value);
    if (!leadsToItem) continue;
    return sib.taxon
      ? `(no ${labelOf(sib, selected[sib.key])} model)`
      : `(not with the current ${sib.label.toLowerCase()})`;
  }
  return "(not with the current selection)";
}

export interface SelectorOptions {
  options: { value: string; label: string }[];
  /** how many values the filtered list leaves out (0 = nothing to reveal). */
  hidden: number;
}

/**
 * The options of one selector. A taxon-like dimension lists only the values that lead to an item given
 * the other dimensions' current selection (the region, and the season / variable where they narrow it)
 * unless `showAll`; every other dimension, and the "show all" list, lists every value, an unavailable one
 * with its {@link unavailableNote}. The current value is always listed.
 */
export function selectorOptions(args: {
  dim: DimSpec;
  dims: readonly DimSpec[];
  items: readonly StacItem[];
  selected: Record<string, string>;
  showAll?: boolean;
}): SelectorOptions {
  const { dim, dims, items, selected, showAll = false } = args;
  const available = availableValues(dim, items, selected);
  const filter = dim.taxon === true && !showAll;
  const shown = dim.values.filter(
    (v) => !filter || available.has(v.value) || v.value === selected[dim.key],
  );
  return {
    options: shown.map((v) => {
      const note = unavailableNote({ dim, value: v.value, dims, items, selected });
      return { value: v.value, label: note ? `${v.label} ${note}` : v.label };
    }),
    hidden: dim.values.length - shown.length,
  };
}

/**
 * The sentence after a selector change moved the taxon too ("Switched to Arctic Tern: Common Murre has no
 * Atlantic model."), `null` when it did not: the changed dimension is the taxon itself, there is no taxon
 * dimension, or the taxon is the same.
 */
export function switchedNotice(args: {
  dims: readonly DimSpec[];
  before: Record<string, string>;
  after: Record<string, string>;
  changed: string;
}): string | null {
  const { dims, before, after, changed } = args;
  const taxon = dims.find((d) => d.taxon === true);
  if (!taxon || taxon.key === changed) return null;
  if (before[taxon.key] === undefined || before[taxon.key] === after[taxon.key]) return null;
  const to = dims.find((d) => d.key === changed);
  return `Switched to ${labelOf(taxon, after[taxon.key])}: ${labelOf(taxon, before[taxon.key])} has no ${labelOf(to, after[changed])} model.`;
}

// --- collection + item selection (the lens' view, and its URL state) -------------------------------

/** the entry for `?c=`: an AVAILABLE entry with that id, else the first available one, else null. */
export function pickEntry(
  entries: readonly CollectionEntry[],
  c: string | undefined,
): CollectionEntry | null {
  const available = entries.filter((e) => e.status === "ok");
  return available.find((e) => e.id === c) ?? available[0] ?? null;
}

export interface ItemView {
  dims: DimSpec[];
  /** one value per dimension: the active item's own dims. */
  selected: Record<string, string>;
  item: StacItem | null;
}

/**
 * The active view of a collection's items for `?i=`: the item with that id, else the item at the
 * default selection (first value of each dimension), else the first item, else none.
 */
export function viewOf(
  collection: StacCollection | null,
  items: readonly StacItem[],
  itemId: string | undefined,
): ItemView {
  const dims = dimsOf(collection, items);
  const byId = itemId ? (items.find((i) => i.id === itemId) ?? null) : null;
  const item =
    byId ??
    resolveItem(items, defaultSelection(dims)) ??
    snapItem(items, defaultSelection(dims)) ??
    items[0] ??
    null;
  const selected = item ? { ...defaultSelection(dims), ...itemDims(item) } : defaultSelection(dims);
  return { dims, selected, item };
}

/** the item to show after the user changes `key` to `value`: snap to the nearest existing item. */
export function selectDim(
  items: readonly StacItem[],
  selected: Record<string, string>,
  key: string,
  value: string,
): StacItem | null {
  return snapItem(items, { ...selected, [key]: value }, key);
}

/** the `Sel` patch for showing `item` of `entry`: defaults are omitted (`undefined`), so the default
 * view stays an empty URL. */
export function selPatchFor(
  entries: readonly CollectionEntry[],
  entry: CollectionEntry | null,
  items: readonly StacItem[],
  item: StacItem | null,
): { c: string | undefined; i: string | undefined } {
  const first = pickEntry(entries, undefined);
  const c = entry && first && entry.id !== first.id ? entry.id : undefined;
  const defaultItem = entry ? viewOf(entry.collection, items, undefined).item : null;
  const i = item && defaultItem && item.id !== defaultItem.id ? item.id : undefined;
  return { c, i };
}
