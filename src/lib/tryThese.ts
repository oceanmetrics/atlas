// Help -> "Try these": five atlas views that show what the Collections lens can do, each a label and a `Sel`
// written by the codec (`formatSel`), so a link can never drift from the grammar (tests/lib/tryThese.test.ts asserts every
// one round-trips through `parseSel`). Ben 2026-10-23: the map features must be findable without asking. The same
// idea is the indicators viewer's Help -> Try these (indicators `viewer/src/lib/tryThese.ts`) and the places site's
// home page; the instance module table gates it (`tryThese` capability: oceanmetrics only), and the shell loads this
// module by dynamic import when Help opens, so it stays off the static path.
import { formatSel } from "./state/codec";
import { DEFAULT_SEL, type Sel } from "./state/types";

export interface TryThis {
  id: string;
  /** the Help row */
  label: string;
  /** the view, as the patch on the default `Sel` that writes it */
  sel: Partial<Sel>;
}

const OBIS = { c: "obis_h3", i: "all" } as const;

export const TRY_THESE: readonly TryThis[] = [
  {
    id: "obis-richness",
    label: "OBIS species richness on the globe",
    sel: {
      ...OBIS,
      dim: { indicator: "sp", period: "all" },
      proj: "globe",
    },
  },
  {
    id: "obis-es-2020s",
    label: "ES(50) in the 2020s",
    sel: {
      ...OBIS,
      dim: { indicator: "es", period: "2020s" },
      proj: "globe",
    },
  },
  {
    id: "fish-monterey",
    label: "The fish EOV at Monterey Bay",
    sel: {
      c: "obis_h3",
      i: "fish",
      dim: { indicator: "es", period: "all" },
      map: { lon: -122.1, lat: 36.75, zoom: 9 },
    },
  },
  {
    id: "cetacea",
    label: "A WoRMS subtree: whales and dolphins (Cetacea)",
    sel: {
      ...OBIS,
      dim: { indicator: "sp", period: "all" },
      taxon: "infraorder:Cetacea",
      res: 3,
      map: { lon: -150, lat: 30, zoom: 3 },
    },
  },
  {
    id: "eov-risk",
    label: "EOV risk: click the map for the flower",
    sel: {
      c: "aquamaps_eov",
      i: "all_risk",
      map: { lon: -122, lat: 33, zoom: 4 },
    },
  },
];

/** the example as a relative atlas link (`?c=...`): a plain anchor, openable and copyable; the page it is on is the base */
export function tryHref(t: Pick<TryThis, "sel">): string {
  const { search, hash } = formatSel({ ...DEFAULT_SEL, ...t.sel });
  return `${search || "?"}${hash}`;
}

/** the example as a full atlas url on `base` (`https://oceanmetrics.io/atlas/`) */
export function tryUrl(t: Pick<TryThis, "sel">, base: string): string {
  return `${base}${tryHref(t)}`;
}
