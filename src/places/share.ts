// places/share.ts -- Deliverable 6: "Copy link shows what the link carries (lens, layer,
// camera, n places) and its length." The length/simplification-ladder math already exists
// (`geo/placeCodec.ts`'s `fitPlacesToUrl`, atlas-2) -- this module is the panel's own summary of
// the REST of the URL, which `fitPlacesToUrl` deliberately knows nothing about (it only sees a
// `baseLength` number), plus the before/after diff Deliverable 6 asks the ladder to show.
import { geometryArea, polygonsOf, type AreaGeometry } from "../lib/geo/types";
import { cellsInPolygon } from "../lib/geo/coverage";
import type { GridSpec } from "../lib/grid/grid";
import type { GeomPlace } from "../lib/geo/placeCodec";
import type { Sel } from "../lib/state/types";
import type { Place } from "../lib/geo/placeCodec";

export interface ShareSummary {
  lens: string;
  layer: string | null;
  hasCamera: boolean;
  nPlaces: number;
}

/** what the CURRENT link carries, besides the places themselves -- `#pl=`'s own length is
 * `fitPlacesToUrl`'s concern (placeCodec.ts), not this. */
export function summarizeShare(sel: Sel, places: readonly Place[]): ShareSummary {
  return {
    lens: sel.lens,
    layer: sel.sp ?? null,
    hasCamera: !!sel.map,
    nPlaces: places.length,
  };
}

export function describeShareSummary(s: ShareSummary): string {
  const parts = [`the ${s.lens} lens`];
  if (s.layer) parts.push(`layer "${s.layer}"`);
  if (s.hasCamera) parts.push("the current map view");
  parts.push(`${s.nPlaces} place${s.nPlaces === 1 ? "" : "s"}`);
  return `This link carries ${parts.join(", ")}.`;
}

/**
 * The actual link to copy, built from `newHash` (a `FitResult.hash` -- the geometry the panel just
 * ANALYSED and is showing the numbers for) rather than trusting `href`'s own `#pl=` to already
 * match it. Fix round 1 (Opus review): `fitPlacesToUrl` can return `status: "ok"` (or "long") with
 * `simplified: true` -- a rung DID have to run to fit the budget -- and copying `location.href`
 * verbatim in that case copies the ORIGINAL, unsimplified (and often far longer) link while the
 * dialog is showing the SIMPLIFIED one's length: a real link/number divergence, not a cosmetic one.
 *
 * P8 item 5 (Opus docs review, app finding #6): the fix above STILL did a plain string
 * substring-replace of `pl=<oldPl>` against `href` -- and that assumption ("every one of those
 * characters is already a valid, unescaped URL-fragment character") is false for the REAL address
 * bar. `formatSel` (`lib/state/codec.ts`) writes the hash through `URLSearchParams`, which DOES
 * percent-encode `~` (the multi-place separator) to `%7E`, and a place name's own internal "%20"
 * escape (a space, `encodeName()` in `lib/geo/placeCodec.ts`) becomes a literal `%` re-encoded to
 * "%2520". `oldPl` is always the RAW, undecoded g1 token, so with more than one place or a name
 * containing a space, the literal substring `pl=<oldPl>` never actually appears in `href` and
 * `.replace()` silently no-ops -- "Copy link anyway" then copied the FULL ORIGINAL link,
 * unsimplified, while the dialog's own summary showed the fitted length. Live-shaped repro:
 * `href = ".../#pl=g1.Big%20Box.AAA%7Eg1.Small.BBB"`, `oldPl = "g1.Big Box.AAA~g1.Small.BBB"` --
 * `pl=g1.Big Box.AAA~g1.Small.BBB` is nowhere in `href`.
 *
 * Fixed by never comparing strings at all: parse `href` with `URL`/`URLSearchParams` (which
 * decodes exactly the one layer `formatSel` applied) and set `pl` on the PARSED param bag, so the
 * copied link always carries the dialog's own fitted hash regardless of what characters it or any
 * other place in the (unread) old value contained. `oldPl` is kept in the signature for call-site
 * stability -- `URLSearchParams#set` already replaces-or-inserts on its own, so the "existing vs.
 * none" branch this used to need is gone.
 */
export function shareUrl(href: string, oldPl: string | undefined, newHash: string): string {
  void oldPl;
  const url = new URL(href);
  const existing = new URLSearchParams(url.hash.replace(/^#/, ""));
  existing.delete("pl");
  // `pl` first, matching `codec.ts#formatSel`'s own key order (it calls `hashParams.set("pl", …)`
  // before `"t"`) -- so a copied link reads the same way the address bar always has, whether or
  // not this href already carried a `pl=`.
  const hashParams = new URLSearchParams();
  hashParams.set("pl", newHash);
  for (const [k, v] of existing) hashParams.append(k, v);
  // the same cosmetic un-escaping `codec.ts#prettyEncode` applies when the address bar itself
  // writes this hash, so a copied link reads the same way (",": "%2C", ":": "%3A" -- neither
  // character is ever part of a `pl=` token itself, both can appear in a `t=` title).
  url.hash = `#${hashParams.toString().replace(/%2C/g, ",").replace(/%3A/g, ":")}`;
  return url.toString();
}

function vertexCount(g: AreaGeometry): number {
  return polygonsOf(g).reduce((n, rings) => n + rings.reduce((m, r) => m + r.length, 0), 0);
}

export interface SimplificationDiff {
  beforeVertices: number;
  afterVertices: number;
  /** signed percent change in planar area. */
  areaChangePct: number;
  /** `null` when no grid was supplied (no release resolved yet) -- the ladder still shows the
   * vertex/area diff without it. */
  cellsBefore: number | null;
  cellsAfter: number | null;
}

/**
 * Before/after a simplification rung, for Deliverable 6's ladder UI: "before/after (vertices, area
 * change %, cells changed) the user accepts". `grid` is optional because a place can be simplified
 * before any release/grid is resolved -- the vertex/area half of the diff never needs one.
 */
export function diffSimplification(
  before: GeomPlace,
  after: GeomPlace,
  grid?: GridSpec,
): SimplificationDiff {
  const areaBefore = geometryArea(before.geometry);
  const areaAfter = geometryArea(after.geometry);
  return {
    beforeVertices: vertexCount(before.geometry),
    afterVertices: vertexCount(after.geometry),
    areaChangePct: areaBefore > 0 ? ((areaAfter - areaBefore) / areaBefore) * 100 : 0,
    cellsBefore: grid ? cellsInPolygon(before.geometry, grid).length : null,
    cellsAfter: grid ? cellsInPolygon(after.geometry, grid).length : null,
  };
}
