// What a click on a collection's own vector overlays says (`atlas:overlays`, `lib/catalog/overlays.ts`):
// every feature under the pointer, grouped by overlay in draw order (top first), each with a heading (the
// overlay's title and the feature's `label_field`) over a two-column table of ALL its properties. Pure: plain
// objects in, an HTML string out (the interaction, `./overlayInteraction.ts`, hands it to the ONE themed
// popup, `lib/map/popup.ts#createPopup`). Every value is untrusted TEXT, escaped here, never markup.
//
//   rows     the overlay's `fields` first, in that order (a listed field the feature lacks is a row too:
//            a vector tile drops null properties, and "—" is how a null reads); every other property after,
//            in the feature's own order. `field_labels` names a row; otherwise the property name does.
//   values   null, undefined and "" -> "—"; an integer as it is; an id (`…id`, `FID`) never rounded; a
//            longitude/latitude to 5 decimals; any other float to 4 significant digits; strings verbatim
//            (dates arrive as ISO strings); booleans as true/false.
//   cap      at most `FEATURE_CAP` features, then "and N more".
import type { CollectionOverlaySpec } from "../../lib/catalog/overlays";

/** the most features one popup lists; the rest are counted ("and N more"). */
export const FEATURE_CAP = 25;
export const EMPTY_VALUE = "—";

/** one feature under the pointer, with the overlay it belongs to. */
export interface OverlayHit {
  spec: CollectionOverlaySpec;
  properties: Readonly<Record<string, unknown>>;
}

export interface OverlayRow {
  key: string;
  label: string;
  value: string;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** an identifier: `id`, `sightid`, `FID`, `segment_id`, `objectid` (never rounded). */
const ID_KEY_RE = /id$/i;
/** a coordinate: `lat`, `lon`, `lng`, `latitude`, `start_lon`, `decimalLongitude`. */
const COORD_KEY_RE = /(lat|lon|lng|latitude|longitude)$/i;

/** a property value as text, by the rules in this file's header. */
export function formatOverlayValue(key: string, v: unknown): string {
  if (v === null || v === undefined || v === "") return EMPTY_VALUE;
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return String(v);
    if (Number.isInteger(v) || ID_KEY_RE.test(key)) return String(v);
    if (COORD_KEY_RE.test(key)) return String(Number(v.toFixed(5)));
    return String(Number(v.toPrecision(4)));
  }
  if (typeof v === "string") return v;
  if (typeof v === "boolean") return v ? "true" : "false";
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

/** the popup rows of one feature, in the overlay's `fields` order, then the rest in the feature's own. */
export function overlayRows(
  spec: Pick<CollectionOverlaySpec, "fields" | "fieldLabels">,
  properties: Readonly<Record<string, unknown>>,
): OverlayRow[] {
  const listed = spec.fields ?? [];
  const keys = [...listed, ...Object.keys(properties).filter((k) => !listed.includes(k))];
  return keys.map((key) => ({
    key,
    label: spec.fieldLabels[key] ?? key,
    value: formatOverlayValue(key, properties[key]),
  }));
}

/** the feature's `label_field` value as text, or null when the overlay names none or the feature has none. */
export function overlayLabel(hit: OverlayHit): string | null {
  const f = hit.spec.labelField;
  if (!f) return null;
  const text = formatOverlayValue(f, hit.properties[f]);
  return text === EMPTY_VALUE ? null : text;
}

/** the hover tooltip: the feature's label, else its overlay's title. */
export function overlayHoverText(hit: OverlayHit): string {
  return overlayLabel(hit) ?? hit.spec.title;
}

function swatchHtml(spec: Pick<CollectionOverlaySpec, "geometry" | "color">): string {
  return `<span class="atlas-popup-ov-swatch atlas-popup-ov-swatch--${spec.geometry}" style="--ov-color:${escapeHtml(spec.color)}" aria-hidden="true"></span>`;
}

function featureHtml(hit: OverlayHit): string {
  const label = overlayLabel(hit);
  const head =
    `<div class="atlas-popup-ov-head">${swatchHtml(hit.spec)}` +
    `<span class="atlas-popup-ov-title">${escapeHtml(hit.spec.title)}</span>` +
    (label ? `<span class="atlas-popup-ov-label">${escapeHtml(label)}</span>` : "") +
    `</div>`;
  const rows = overlayRows(hit.spec, hit.properties)
    .map(
      (r) => `<tr><th scope="row">${escapeHtml(r.label)}</th><td>${escapeHtml(r.value)}</td></tr>`,
    )
    .join("");
  return `<section class="atlas-popup-ov-feature">${head}<table class="atlas-popup-ov-table"><tbody>${rows}</tbody></table></section>`;
}

/** "and 3 more" under a capped list. */
export const moreText = (n: number): string => `and ${n} more`;

/**
 * The whole popup: the features (top overlay first, at most `cap`), "and N more" for the rest, and the
 * Item's value line at the point (`cellLine`, the hex cell or raster value; a raster's arrives later and
 * fills the same slot) under the scrolling list, outside it so it never scrolls away.
 */
export function overlayPopupHtml(
  hits: readonly OverlayHit[],
  cellLine: string | null,
  cap: number = FEATURE_CAP,
): string {
  const shown = hits.slice(0, cap);
  const more = hits.length - shown.length;
  return (
    `<div class="atlas-popup-ov" data-testid="overlay-popup">` +
    `<div class="atlas-popup-ov-list">` +
    shown.map(featureHtml).join("") +
    (more > 0 ? `<p class="atlas-popup-ov-more">${moreText(more)}</p>` : "") +
    `</div>` +
    `<p class="atlas-popup-ov-cell"${cellLine ? "" : " hidden"}>${escapeHtml(cellLine ?? "")}</p>` +
    `</div>`
  );
}

/** the `announce()` text of the popup (a live region reads text): how many features, and the first. */
export function overlayAnnounceText(hits: readonly OverlayHit[]): string {
  if (hits.length === 0) return "";
  const first = `${hits[0].spec.title}${overlayLabel(hits[0]) ? `: ${overlayLabel(hits[0])}` : ""}`;
  return hits.length === 1 ? first : `${hits.length} features here. ${first}`;
}
