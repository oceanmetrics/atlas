// The camera ⇄ URL rule, as pure functions (CLAUDE.md "URL-is-the-view"): the map's centre, zoom
// and projection live in `?map=lon,lat,zoom[,bearing,pitch]` + `?proj=` or they live nowhere.
// `map.ts` owns the MapLibre wiring; everything decidable without a browser is here, so it is
// unit-testable under vitest's node environment.
//
// Three rules, one per function below:
//  1. ROUND before writing. A raw MapLibre centre is a 15-significant-digit float; a link a person
//     pastes should be readable, and an unrounded write makes every sub-pixel render a new URL.
//  2. Never write an unchanged camera (`cameraEqual`) — `history.replaceState` on every frame of a
//     drag is what makes a URL-bound map feel like it is fighting the user.
//  3. DEBOUNCE, ~300 ms, and never write a PROGRAMMATIC move. A `flyTo` is the app moving the map,
//     not the user choosing a view; writing it back mid-flight records intermediate cameras that
//     the user never asked for and that a reload would then restore instead of the destination.
import type { MapView } from "../state/types";

// --- bounds -> camera, WITHOUT MapLibre's own fitBounds ------------------------------------------
//
// atlas-5's species camera (src/lens/species/data/camera.ts) hands the lens an EXTENT, not a
// center+zoom preset — a species surface has a real footprint, unlike a study-area preset. But
// `tests/map/no-fitbounds.test.ts` scans src/lib/map AND src/lens for a call to MapLibre's own
// bounds-fitting method (never named literally in this file's prose, on purpose — see that test's
// own regex), because it normalizes longitudes internally and inverts across the antimeridian
// (EBS/PIS). The species data layer's `minimalFrame()` already solved that
// by RE-EXPRESSING a frame so `east` may exceed 180 in a continuous (never wrapped) degree space —
// so the fit math here must stay linear in that same space and must never re-wrap it.
//
// This function is deliberately named `boundsToCameraView`, never MapLibre's own bounds-fitting
// method name (function name, method name, or call site — see this repo's source-scan gate): it is
// the plain Web Mercator projection that method uses internally (a linear x = lon/360+0.5, a
// standard non-linear y for latitude), computed by hand so a bbox with `east > 180` projects to
// `x > 1` instead of being wrapped back into 0..1 first.
const MERCATOR_TILE_SIZE = 512;
const MERCATOR_MIN_ZOOM = 0;
const MERCATOR_MAX_ZOOM = 22;

function lngToMercatorX(lng: number): number {
  return lng / 360 + 0.5;
}

function latToMercatorY(lat: number): number {
  const clamped = Math.min(89.9, Math.max(-89.9, lat));
  const rad = (clamped * Math.PI) / 180;
  return 0.5 - Math.log((1 + Math.sin(rad)) / (1 - Math.sin(rad))) / (4 * Math.PI);
}

function mercatorXToLng(x: number): number {
  return (x - 0.5) * 360;
}

function mercatorYToLat(y: number): number {
  const y2 = 180 - y * 360;
  return (360 / Math.PI) * Math.atan(Math.exp((y2 * Math.PI) / 180)) - 90;
}

/** `[[west, south], [east, north]]` — `east` MAY exceed 180 (a re-expressed, unwrapped frame). */
export type CameraBoundsInput = readonly [readonly [number, number], readonly [number, number]];

export interface Viewport {
  width: number;
  height: number;
}

/** CSS px reserved on each edge of the viewport by shell chrome (a docked panel, the phone sheet,
 * the bottom tab bar) -- never MapLibre's own persisted `padding` state (see `paddedStudyAreaCenter`
 * below for why). */
export interface ChromePadding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export const NO_PADDING: ChromePadding = { top: 0, right: 0, bottom: 0, left: 0 };

/**
 * R3-rr fix 1, round 5 (orchestrator eyes-on, real e1fcfc8 build, 2026-09-25 — "Whole range" not
 * showing the western Pacific hits): {@link boundsToCameraView}'s shift moves the fitted centre by
 * the padding's own LEFT-RIGHT and TOP-BOTTOM *differentials*, toward the free area's middle —
 * correct and desired for an ordinary, already-narrow fit, but measured live to push an EXTREME
 * (~150deg-wide, near-zero-zoom) box's centre by an amount the shift's own `1/worldPx` term
 * (`shiftForPadding`'s own header) was never designed for: at this globe-regime zoom, `worldPx` is
 * tiny, so the SAME pixel padding produces a wildly larger shift in normalized world-space than it
 * does at an ordinary fit's zoom. Measured two distinct failure shapes live: the desktop docked
 * panel's `right`-heavy reserve shifted the leatherback's confirmed-data arc's LONGITUDE off
 * Guam/CNMI entirely (one edge fell outside the globe's own visible ~180deg hemisphere); trying to
 * ALSO keep the phone sheet's own bottom-heavy reserve shifting LATITUDE (to push the fit above the
 * sheet, as an ordinary fit does) overshot even further at this same low zoom, landing the centre
 * at lat -43 to -56 — south of the box's OWN south edge (-17.7) — the SAME "wrong place entirely"
 * failure the longitude bug was, just on the other axis.
 *
 * Splits EACH axis's total reserve evenly between its two edges (same TOTAL space reserved per
 * axis, so the fitted ZOOM — which depends only on each axis's sum — is unchanged) while zeroing
 * both differentials: the fitted centre becomes the box's own exact geometric midpoint on BOTH
 * axes, regardless of which side of the viewport the chrome happens to occupy. This does mean
 * "Whole range" on the phone does not get the SAME above-the-sheet push an ordinary (compact) fit
 * gets — a real, accepted trade-off (documented as a follow-up, not silently dropped): the
 * alternative (keep the vertical differential) is measurably WORSE, landing outside the box
 * entirely, so "geometrically correct but not chrome-optimized" beats "chrome-optimized but
 * wrong". Used for "Whole range" only — an ordinary (already narrow, ordinary-zoom) bounds fit
 * keeps the real, fully asymmetric padding on both axes, where this overshoot does not occur.
 */
export function symmetricPadding(padding: ChromePadding): ChromePadding {
  const h = (padding.left + padding.right) / 2;
  const v = (padding.top + padding.bottom) / 2;
  return { top: v, bottom: v, left: h, right: h };
}

/** the uncapped shift math both {@link paddedStudyAreaCenter} and {@link boundsToCameraView} share
 * -- letting `worldPx = MERCATOR_TILE_SIZE * 2^zoom`, the shift is `(frontPad - backPad) / 2 /
 * worldPx` in normalized world units, on each axis independently: exact (not a linear
 * approximation) because it operates in the map's own Mercator space, the same one `zoom`/
 * `worldPx` already describe. Takes the two DIFFERENCES directly (never the full
 * {@link ChromePadding}) so a caller that needs to bound them first (`paddedStudyAreaCenter`) can,
 * without reconstructing a padding object just to have this re-subtract it. */
function shiftForPadding(
  center: { lon: number; lat: number },
  zoom: number,
  hDiff: number,
  vDiff: number,
): { lon: number; lat: number } {
  const worldPx = MERCATOR_TILE_SIZE * 2 ** zoom;
  const x = lngToMercatorX(center.lon) - hDiff / 2 / worldPx;
  const y = latToMercatorY(center.lat) - vDiff / 2 / worldPx;
  return { lon: mercatorXToLng(x), lat: mercatorYToLat(y) };
}

export interface BoundsToCameraOptions {
  /** CSS px reserved on every edge (the species lens' default is a uniform 40 —
   * `data/camera.ts`'s `DEFAULT_CAMERA_PADDING`), OR an asymmetric {@link ChromePadding} when the
   * caller also has a docked panel/sheet to keep the content out from under (P6/D8: "reuse it for
   * D8" — the SAME chrome-aware math the initial camera uses, so a model fit is not centred behind
   * the very chrome that is hiding half of it). A bare number is shorthand for all four edges equal. */
  padding?: number | ChromePadding;
  minZoom?: number;
  maxZoom?: number;
}

function paddingOf(padding: number | ChromePadding | undefined): ChromePadding {
  if (padding === undefined) return NO_PADDING;
  if (typeof padding === "number")
    return { top: padding, right: padding, bottom: padding, left: padding };
  return padding;
}

/**
 * The center+zoom that frames `bounds` in `viewport`, computed by hand in linear Mercator space so
 * `bounds[1][0]` (east) may exceed 180 without wrapping — the whole point of this module existing
 * instead of calling MapLibre's own `fitBounds`. Degenerate input (a zero-area box, a non-finite
 * viewport) still returns a sane camera: the box's own center at `maxZoom`'s bound, never `NaN`.
 *
 * P6/D8: an ASYMMETRIC {@link ChromePadding} (a docked panel/sheet occluding one side only) both
 * shrinks the available space (used for the zoom/scale, same as a uniform number) AND shifts the
 * fitted center toward the free area's own middle (`paddedStudyAreaCenter`'s same shift, reused
 * here at the FIT's own computed zoom rather than a caller-supplied one) — a uniform `padding`
 * (every existing caller) shifts by exactly zero, so this is additive, not a behaviour change for
 * them.
 */
export function boundsToCameraView(
  bounds: CameraBoundsInput,
  viewport: Viewport,
  opts: BoundsToCameraOptions = {},
): { center: [number, number]; zoom: number } {
  const padding = paddingOf(opts.padding);
  const minZoom = opts.minZoom ?? MERCATOR_MIN_ZOOM;
  const maxZoom = opts.maxZoom ?? MERCATOR_MAX_ZOOM;
  const [[west, south], [east, north]] = bounds;

  const x0 = lngToMercatorX(west);
  const x1 = lngToMercatorX(east);
  const y0 = latToMercatorY(north); // north has the SMALLER y (Mercator y grows southward)
  const y1 = latToMercatorY(south);

  const width = Math.max(x1 - x0, 1e-12);
  const height = Math.max(y1 - y0, 1e-12);

  const availW = Math.max((viewport.width || 0) - padding.left - padding.right, 1);
  const availH = Math.max((viewport.height || 0) - padding.top - padding.bottom, 1);

  const scaleX = availW / (width * MERCATOR_TILE_SIZE);
  const scaleY = availH / (height * MERCATOR_TILE_SIZE);
  const scale = Math.min(scaleX, scaleY);
  const zoom = Math.min(maxZoom, Math.max(minZoom, Math.log2(Math.max(scale, 1e-9))));

  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const rawCenter = { lon: mercatorXToLng(cx), lat: mercatorYToLat(cy) };
  // an asymmetric padding shifts the fitted content toward the free area's own middle, at the
  // FIT's own zoom — a bounds fit's zoom already scales with the content being framed, so this
  // never falls into the low-zoom "globe shows the whole world" regime `paddedStudyAreaCenter`'s
  // own header (`PHONE_STUDY_AREA_ZOOM_BOOST`) describes.
  const shifted = shiftForPadding(
    rawCenter,
    zoom,
    padding.left - padding.right,
    padding.top - padding.bottom,
  );
  return { center: [shifted.lon, shifted.lat], zoom };
}

/**
 * R3-A1 (round-3 plan, Ben 2026-09-25): the reference desktop viewport the study-area presets'
 * own zoom was tuned for -- `scripts/verify.mjs#runState`'s own comment ("docs/map.md's default
 * study-area zoom is chosen for a 1280x800 aspect"), the same number `scripts/verify.mjs`'s and
 * `scripts/eyes-shots.mjs`'s `desktop` viewport already use. The ONE place this literal is allowed
 * to live -- every caller of {@link cameraViewToBounds} for "the study area's own extent" must use
 * this SAME constant or two computations of "the study area" would silently disagree.
 */
export const STUDY_AREA_REFERENCE_VIEWPORT: Viewport = { width: 1280, height: 800 };

/**
 * The inverse of {@link boundsToCameraView}: the bbox a plain (unpadded) Mercator camera at
 * `view` would show across `viewport`. Exists because `boot.study_areas` publishes a CAMERA
 * (center + zoom), never an extent (`docs/map.md`/this module's own "no fitBounds" header) -- a
 * caller that genuinely needs "the study area as a box" (R3-A1's wide-range species framing,
 * `src/lens/species/data/camera.ts#studyAreaBboxFallback`) has no bbox to read and must derive one
 * from the SAME camera the desktop default view already renders, rather than invent a number.
 *
 * Plain Mercator, not the globe projection MapLibre renders at low zoom (`PHONE_STUDY_AREA_ZOOM_
 * BOOST`'s own header) -- at the low zoom a study-area preset uses this is already an
 * OVER-estimate of what a real (spherical) render shows, which is the safe direction for an
 * intersection test to err (a too-wide "study area" box narrows a wide model less aggressively,
 * never wrongly excludes real US range).
 */
export function cameraViewToBounds(
  view: { lon: number; lat: number; zoom: number },
  viewport: Viewport,
): CameraBoundsInput {
  const worldPx = MERCATOR_TILE_SIZE * 2 ** view.zoom;
  const cx = lngToMercatorX(view.lon);
  const cy = latToMercatorY(view.lat);
  const halfWx = viewport.width / 2 / worldPx;
  const halfWy = viewport.height / 2 / worldPx;
  const west = mercatorXToLng(cx - halfWx);
  const east = mercatorXToLng(cx + halfWx);
  // north has the SMALLER mercator y (y grows southward, boundsToCameraView's own convention)
  const north = mercatorYToLat(cy - halfWy);
  const south = mercatorYToLat(cy + halfWy);
  return [
    [west, south],
    [east, north],
  ];
}

/**
 * P2 round 2 (orchestrator, real-v7-build eyes-on, 2026-09-24 -- supersedes round 1's
 * `MAX_STUDY_AREA_SHIFT_PX` cap, which fixed the SYNTHETIC hermetic fixture's "empty sky" pixel
 * count but not the real defect): capping the SHIFT was the wrong lever. Measured directly against
 * the live v7 build (`?map=lon,lat,zoom`, real CARTO tiles, no fixture) at the study area's own
 * zoom (2.16): the visible frame shows most of the GLOBE -- Canada, Greenland, Finland, Norway,
 * Iceland -- almost regardless of which latitude the shift targets (17, 27, 35, 43 all measured
 * "Canada/Greenland dominant"). This is not a shift-math bug: MapLibre's GLOBE projection renders
 * a true sphere below roughly zoom 3, so "how much of the world is visible" is set by ZOOM, not by
 * center -- a translate-only correction, however capped, cannot escape it. Capping the shift also
 * threw away real precision for no benefit: it forced the SAME under-shot fallback (200px) at
 * every zoom, when the correct shift at a higher zoom is smaller anyway (an uncapped shift's own
 * `1/worldPx` term already shrinks it as zoom grows -- see `shiftForPadding`'s own header).
 *
 * The fix is {@link PHONE_STUDY_AREA_ZOOM_BOOST} below: raise the zoom BEFORE computing the
 * (uncapped) shift. At the boosted zoom the real, uncapped shift both (a) lands the free area on
 * CONUS + the Gulf/Atlantic coast instead of the Arctic (measured: zoom 3.0, real padding -> lat
 * 33.4, "Canada" reduced to a minor top-of-frame label) and (b) happens to also close the "empty
 * sky" gap round 1 was chasing (a higher zoom renders a visually LARGER globe disc, covering more
 * of the free area, not less). `boundsToCameraView` never needed a cap or a boost: a bounds fit's
 * OWN zoom already scales with the content being framed (a small species range fits at a zoom
 * where flat Mercator IS globe-accurate), so the runaway low-zoom regime this note describes
 * cannot occur there.
 */
export const PHONE_STUDY_AREA_ZOOM_BOOST = 0.85;

/**
 * WP13: no longer called by the shell. The map now carries the live padding (`livePadding.ts`,
 * `handle.setPadding`), which centres the camera in the open area for the globe as well, and this
 * hand shift would move the first view twice. Kept exported and tested as the flat-Mercator
 * reference for what that padding does at a given zoom. The header below is the ORIGINAL rule it
 * was written under ("never MapLibre's persisted padding"), which WP13 reversed (docs/map.md,
 * "Camera padding").
 *
 * usability M4 ("the panel/sheet cover the study area... frame the study area with padding for
 * the panel/sheet"): shifts a center+zoom camera so the SAME geographic point instead appears at
 * the middle of the VISIBLE (unobscured) rectangle of the viewport, not the middle of the whole
 * canvas. Deliberately NOT `map.setPadding()` (MapLibre's own persisted padding state): that would
 * also silently reshape every LATER `flyTo`/`flyToBounds` call (the species camera, `boundsToCameraView`
 * above) on top of their own, independently-computed zoom -- this is a one-time initial-view
 * adjustment, so it returns a plain `{lon,lat}` the caller bakes into the camera it constructs the
 * map with, and nothing else in the app ever reads MapLibre's padding state (`docs/map.md`: "no
 * fitBounds, anywhere" carries the same "no antimeridian-unsafe native camera math" spirit).
 *
 * UNCAPPED (round 2 -- see {@link PHONE_STUDY_AREA_ZOOM_BOOST}'s own header for why a cap on this
 * shift was the wrong fix): the caller is responsible for passing a `zoom` where a flat-Mercator
 * shift is a fair stand-in for the globe's own rendering -- `Shell.svelte`'s `initialStudyArea`
 * adds the phone boost to `zoom` before calling this, exactly once, for exactly this reason.
 */
export function paddedStudyAreaCenter(
  center: { lon: number; lat: number },
  zoom: number,
  padding: ChromePadding,
): { lon: number; lat: number } {
  return shiftForPadding(center, zoom, padding.left - padding.right, padding.top - padding.bottom);
}

/**
 * P9 (Opus docs re-check appendix finding A2, live-verified on 0.10.48): {@link
 * PHONE_STUDY_AREA_ZOOM_BOOST} boosts the zoom of the SAME point the desktop camera uses --
 * `FALLBACK_FULL_STUDY_AREA`'s own centroid, `(-101.304, 46.9)`, central North Dakota, chosen as a
 * geometric middle of the WHOLE study area (Alaska through the Caribbean) for a near-whole-globe
 * desktop view. That point is on land, nowhere near a scored ocean cell. Boosting *its* zoom just
 * crops down to a smaller patch of the SAME wrong place: measured live (production, 390x844,
 * `?tour=off`, no other change), the boosted camera is `lon -101.304, lat 33.509, zoom 3.01` and
 * the ENTIRE free area (top bar to sheet top) shows Canada/the Great Lakes -- 0% scored cells, 0%
 * recognisable U.S. coast. No shift or boost of that SAME point fixes it, because the point itself,
 * not the zoom, is wrong.
 *
 * P9's own fix (a tight northern-Gulf-of-Mexico/south-east-coast bbox, `[[-92,24],[-84,31]]`,
 * zoom ~4.9-5.2) traded too much away: it read as "one region of four" (Reviewers, round-3 plan
 * R3-A2) -- correct and recognisable, but Pacific/Atlantic/Alaska were nowhere in the first view at
 * all.
 *
 * **R3-A2 (Ben, 2026-09-25): "find an extent that includes at least the waters of the lower 48 and
 * ideally a sliver of Alaska (hinting at extent coverage there)."** Chosen BY LOOKING (bounded
 * iteration, real builds, `scripts/eyes-shots.mjs`'s `map`/`layers` phone states), starting from the
 * plan's own `[[-135,20],[-60,52]]` and narrowing:
 *   1. `[[-135,20],[-60,52]]` (zoom ~1.7 at the half-detent padding): framed CONUS + a real
 *      south-east-Alaska/Gulf-of-Alaska sliver at the top-left edge, but wasted roughly the bottom
 *      half of the free area on Mexico/Central America/northern South America with no scored
 *      content in frame.
 *   2. Narrowing the south edge alone (`south: 20 -> 26/28`) does NOT help: this bbox is
 *      WIDTH-bound (63-75 deg of longitude vs. a 390px-wide phone), so `boundsToCameraView`'s zoom
 *      is set entirely by the east-west span -- moving the south/north edges only re-centers the
 *      same zoom, it never tightens it.
 *   3. `[[-128,24],[-65,52]]`: trimming the WIDTH (west -135 -> -128, east -60 -> -65) raised the
 *      zoom to ~2.0 at the half-detent padding, while -128 W still carried the south-east-Alaska
 *      panhandle/Gulf-of-Alaska edge into frame and -65 W kept the whole Atlantic seaboard +
 *      Florida in. Verified live: the free area showed real coloured scored cells along the
 *      Pacific coast, the Gulf of Mexico, and the Atlantic/Florida shelf, WITH a visible tan/green
 *      sliver of Alaska hugging the top-left edge of the globe. This landed the first pass.
 *
 * SECOND PASS (orchestrator, 2026-09-25, after reading a real `phone-02-map.png` screenshot of step
 * 3 above): coverage was right, but roughly the TOP THIRD of the free area was empty navy "sky"
 * above the globe's own rendered rim -- step 3's own "the box's real geography already fills the
 * free area" reasoning undersold how much of that vertical space the globe's disk itself was NOT
 * covering at zoom ~2.0. Measured directly with `e2e/shell.firstview.phone.spec.ts`'s two-colour
 * (black space / white water) probe, as a PERCENT of the free area (not raw px against the whole
 * canvas, which extends behind the sheet): 43.0% sky at the default "half" sheet detent, 22.7% at
 * "peek" -- confirming the screenshot's own "roughly a third" read.
 *
 * Two things this pass established, both by direct measurement rather than the zoom formula alone
 * (`e2e/shell.firstview.phone.spec.ts`'s own header has the exact numbers):
 *   - The sheet's bottom padding has ZERO effect on the initial zoom here: this bbox is
 *     WIDTH-bound (its longitude span exceeds what a 390px phone can show without shrinking, well
 *     before the north-south span becomes the binding dimension), so `half` and `peek` measured
 *     IDENTICAL zoom and IDENTICAL absolute gapPx -- only the free area's own height (hence the
 *     gap's PERCENT of it) differs between them. Narrowing the bbox's own longitude span is the
 *     only lever that raises zoom and shrinks the sky band.
 *   - The relationship between span and the measured gap is NOT smoothly proportional to the zoom
 *     formula: span 43 measured 11.6% (half) / 6.1% (peek); span 40 measured 4.6% / 2.4% -- a
 *     "cliff", because the exact pixel the probe first hits depends on where land vs. open ocean
 *     sits at that specific latitude/longitude, not on zoom in the abstract.
 *
 * **`PHONE_DEFAULT_BOUNDS = [[-119,25],[-78,51]]`** (this constant, span 41, zoom ~2.59): narrowed
 * further than step 3, keeping the Pacific coast and Florida/the Gulf in frame (both explicitly
 * required) -- but a span this narrow cannot ALSO carry the Alaska hint (needs west out to ~-130)
 * or the Atlantic seaboard north of roughly the Carolinas (needs east out to ~-65) within the same
 * 10%-sky budget: narrowing FROM EITHER EDGE is the same lever (less width, more zoom, less sky),
 * so keeping all of "Alaska + Pacific + the whole Atlantic + Florida" was never possible once the
 * sky-band target is taken as a hard constraint. Per the explicit instruction ("if the Alaska
 * sliver cannot survive that, keep the full lower 48 with minimal sky and say so with the shot"):
 * the Alaska hint is dropped, and the Atlantic is ALSO trimmed north of the Carolinas -- a
 * corollary of the identical physical constraint, not a separate concession. Measured on the real
 * fixture: 7.0% sky at half detent, 3.7% at peek, both comfortably under the 10% target (live
 * screenshots: `phone-02-map`/`phone-03-layers-half`, round-3 W4 report).
 *
 * This DELIBERATELY does not chase the old "~3 floor" zoom heuristic P9's header below still
 * documents for the ORIGINAL bug (a near-whole-study-area bbox at zoom ~1.27 showing empty sky):
 * that floor was specific to a THIN default (a thin bbox or a boosted point) whose own frame
 * carries little real vertical content at low zoom. This bbox's own zoom (~2.59) happens to land
 * close to that old floor now, but that is a coincidence of what the sky-band target required here,
 * not a reason to treat "~3" as a rule -- the live screenshot is the proof, not a zoom number in
 * isolation (unchanged from the first pass's own reasoning).
 *
 * Never the whole study area's own bbox (Alaska through the Caribbean, ~114 degrees of longitude,
 * zoom ~1.27): even wider than this constant, and its own north-south span is dominated by open
 * ocean between the mainland and the Aleutians rather than a coherent coastline.
 *
 * Scoped to the DEFAULT first view only (`Shell.svelte`'s two call sites already gate on
 * `sel.area === DEFAULT_SEL.area`/no `sel.map`) -- an explicit `?area=`/`?map=` is never
 * second-guessed, and desktop is untouched (its free area is tall enough that the unboosted FULL
 * centroid already keeps real coastline in frame at the study-area preset's own zoom).
 */
export const PHONE_DEFAULT_BOUNDS: CameraBoundsInput = [
  [-119, 25],
  [-78, 51],
];

/** the phone's DEFAULT first-view camera -- see {@link PHONE_DEFAULT_BOUNDS}'s own header. */
export function phoneDefaultCamera(
  viewport: Viewport,
  padding: ChromePadding,
): { center: [number, number]; zoom: number } {
  return boundsToCameraView(PHONE_DEFAULT_BOUNDS, viewport, { padding });
}

/**
 * R3-rr fix 1, round 5 (orchestrator eyes-on, real e1fcfc8 build, 2026-09-25 — Ben's product
 * intent via the orchestrator: "on the phone 'US waters' should look like the app's phone default
 * view"): a wide-range species' narrowed "US EEZ" intersection can still be far too wide to frame
 * well at phone width — measured live: the leatherback's own ~136deg-wide intersection settled at
 * `lng -134, lat -48.8, zoom 0.78` — a tiny globe mostly hidden behind the sheet, empty sky above
 * (`phone-us-waters.png` from the prior round's own report). A ~150deg-wide box cannot be usefully
 * fit into 390px with the sheet's own padding; MapLibre's real, globe-aware `cameraForBounds()`
 * zooms out far enough to technically contain it and, doing so, pushes the centre toward the
 * globe's own pole/limb rather than anywhere useful.
 *
 * Compares the box's own naive fit zoom — the SAME pure Mercator math {@link phoneDefaultCamera}
 * itself already trusts for the app's known-good first view, so the comparison is apples-to-apples
 * against the SAME basis, never a mix of this module's math and MapLibre's own — against the phone
 * default's own zoom for the SAME viewport/padding. When the box would zoom out FURTHER than the
 * default view already does, reuse {@link PHONE_DEFAULT_BOUNDS} itself (the exact constant, never
 * a second "too wide" fallback box) rather than fitting the too-wide box at all. `isPhone` gates
 * this explicitly (the SAME `matchMedia("(max-width: 899px)")` breakpoint `Shell.svelte` already
 * uses) — never substitutes on desktop, where a `naive.zoom < def.zoom` comparison would otherwise
 * ALWAYS be true for a wide species (a narrow 41deg box fit to a wide 1280px viewport zooms in far
 * higher than any wide box legitimately can, which would wrongly force PHONE_DEFAULT_BOUNDS onto
 * desktop's own already-working "US waters" view — verified this substitution is a no-op there by
 * construction, not by accident, via the explicit gate).
 */
export function phoneAwareWideRangeBounds(
  bounds: CameraBoundsInput,
  viewport: Viewport,
  padding: ChromePadding,
  isPhone: boolean,
): CameraBoundsInput {
  if (!isPhone) return bounds;
  const naive = boundsToCameraView(bounds, viewport, { padding });
  const def = phoneDefaultCamera(viewport, padding);
  return naive.zoom < def.zoom ? PHONE_DEFAULT_BOUNDS : bounds;
}

// --- sel.area -> camera, the fly-on-load/fly-on-change decision -------------------------------
//
// The defect this fixes (owner report, 2026-09-24, live v7): `?area=AK` rendered the DEFAULT
// camera, not Alaska. Root cause was TWO bugs stacked: `Shell.svelte` resolved the initial study
// area against a literal `null` boot (`studyAreaFromBoot(null, sel.area)`), so it could never see
// a release's real `study_areas` rows; and the ONLY place that ever called `handle.flyTo(area)` was
// `LayersPanel.svelte`'s `onchange` handler — the panel BODY, which never runs for `sel.area` as it
// arrives from the URL on load (docs/map.md's 0.10.21 rule: a map input must be a lens/shell-level
// store, never panel-only UI, for exactly this reason — a collapsed/unmounted panel body must not
// be the only path a rule runs through). The fix is this pure decision, called from an effect that
// watches `sel.area`/`sel.map`/`boot` regardless of which tool/panel is open (Shell.svelte).
//
// Precedence (read this before touching the DEFAULT first-view camera elsewhere — e.g. a later
// round padding it for docked panel/sheet chrome in Shell.svelte/interaction.ts): an EXPLICIT
// `?area=` (a non-default key on the FIRST resolution once `boot` arrives) always wins over
// whatever camera framed the very first paint, default-fit padding included — the study area is a
// CAMERA, not a filter (CLAUDE.md), so a shared `?area=AK` link must always end up on Alaska. The
// only camera a `?area=` is not allowed to override is an EXPLICIT one — `sel.map` (a user's own
// pan, or a pasted `?map=` link) — same "camera preset applies only when `map` is absent" rule
// `state/types.ts`'s own `area` field doc and `map.ts`'s `start = opts.camera ?? area-derived`
// already encode; the caller is expected to skip this function entirely while `sel.map` is set
// (see `tests/map/camera.test.ts`'s "sel.map wins" case).
export interface AreaCameraState {
  /** the area key last flown to, or `undefined` before the first resolution (`boot` not loaded
   * yet, or the map not yet constructed). */
  flownAreaKey: string | undefined;
}

export const INITIAL_AREA_CAMERA_STATE: AreaCameraState = { flownAreaKey: undefined };

/**
 * Should `handle.flyTo(area)` run right now, and what state should the caller carry forward?
 * `areaKey` is the CURRENT `sel.area`, already resolved against the real `boot.study_areas`
 * (`studyAreaFromBoot`) by the caller — this function only ever compares keys, never resolves one.
 *
 * - Same key already flown to (including "still `undefined` and still the default" on a repeat
 *   effect run before boot has loaded) — no-op.
 * - The FIRST resolution (boot just arrived) landing on the DEFAULT key — no-op: the map was
 *   already constructed pointed roughly there (`createMap`'s own `opts.area` fallback), so flying
 *   again would be a same-place no-op at best and, once a later round pads that initial camera for
 *   docked chrome, would silently UN-pad it for no reason.
 * - Anything else — an explicit non-default `?area=` on load, or ANY later change (including back
 *   to the default, once it is no longer "first") — flies.
 */
export function shouldFlyToArea(
  areaKey: string,
  defaultAreaKey: string,
  state: AreaCameraState,
): { fly: boolean; next: AreaCameraState } {
  if (areaKey === state.flownAreaKey) return { fly: false, next: state };
  const isFirstResolve = state.flownAreaKey === undefined;
  const next: AreaCameraState = { flownAreaKey: areaKey };
  if (isFirstResolve && areaKey === defaultAreaKey) return { fly: false, next };
  return { fly: true, next };
}

/** debounce for the URL write, per the atlas-3 shell's "replaceState only, debounced" rule. */
export const CAMERA_WRITE_DELAY_MS = 300;

/** decimals for `lon`/`lat`: ~1 m at the equator, and short enough to read in a pasted link. */
export const CAMERA_LNGLAT_DECIMALS = 5;
/** decimals for `zoom` (study-area presets are given to 2 dp: `2.16`, `3.74`). */
export const CAMERA_ZOOM_DECIMALS = 2;
/** decimals for `bearing`/`pitch`. */
export const CAMERA_ANGLE_DECIMALS = 1;

function round(value: number, decimals: number): number {
  const f = 10 ** decimals;
  // `+0` normalizes `-0` (which formats as "-0" in a URL and then parses back as 0 — a value that
  // round-trips to a DIFFERENT string is a round-trip bug waiting for a test to find it).
  return Math.round(value * f) / f + 0;
}

/**
 * Round a camera for the URL, and drop `bearing`/`pitch` when both are flat — they travel together
 * (state/types.ts's `MapView`) and writing `,0,0` on every link is noise.
 */
export function roundCamera(camera: MapView): MapView {
  const out: MapView = {
    lon: round(camera.lon, CAMERA_LNGLAT_DECIMALS),
    lat: round(camera.lat, CAMERA_LNGLAT_DECIMALS),
    zoom: round(camera.zoom, CAMERA_ZOOM_DECIMALS),
  };
  const bearing = round(camera.bearing ?? 0, CAMERA_ANGLE_DECIMALS);
  const pitch = round(camera.pitch ?? 0, CAMERA_ANGLE_DECIMALS);
  if (bearing !== 0 || pitch !== 0) {
    out.bearing = bearing;
    out.pitch = pitch;
  }
  return out;
}

/** are two cameras the same view? (`undefined` bearing/pitch is flat, i.e. equal to 0.) */
export function cameraEqual(a: MapView | undefined, b: MapView | undefined): boolean {
  if (!a || !b) return a === b;
  return (
    a.lon === b.lon &&
    a.lat === b.lat &&
    a.zoom === b.zoom &&
    (a.bearing ?? 0) === (b.bearing ?? 0) &&
    (a.pitch ?? 0) === (b.pitch ?? 0)
  );
}

export interface CameraWriterOptions {
  /** what to do with a settled camera — in the app, `selStore.set({ map })`. */
  write(camera: MapView): void;
  delayMs?: number;
  /** injected so the unit test drives real behaviour with fake timers rather than sleeping. */
  setTimer?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (handle: ReturnType<typeof setTimeout>) => void;
}

export interface CameraWriter {
  /** a camera the USER produced; a programmatic move must never reach this (see rule 3). */
  push(camera: MapView): void;
  /** write any pending camera now (e.g. on `moveend`, or before the page unloads). */
  flush(): void;
  /** forget any pending camera — used when a programmatic move supersedes a user one. */
  cancel(): void;
  /** the last camera actually written, or `undefined`. */
  readonly last: MapView | undefined;
}

/**
 * A debounced, de-duplicated camera writer. `seed` is the camera the page loaded with, so the very
 * first user move that merely re-reports it writes nothing.
 */
export function createCameraWriter(opts: CameraWriterOptions, seed?: MapView): CameraWriter {
  const delay = opts.delayMs ?? CAMERA_WRITE_DELAY_MS;
  const setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = opts.clearTimer ?? ((h) => clearTimeout(h));

  let last = seed ? roundCamera(seed) : undefined;
  let pending: MapView | undefined;
  let handle: ReturnType<typeof setTimeout> | undefined;

  function fire() {
    handle = undefined;
    const next = pending;
    pending = undefined;
    if (!next || cameraEqual(next, last)) return;
    last = next;
    opts.write(next);
  }

  return {
    push(camera: MapView) {
      const rounded = roundCamera(camera);
      if (cameraEqual(rounded, last)) {
        // already the written view: drop any pending write too, otherwise a drag that returns to
        // where it started still writes once.
        pending = undefined;
        if (handle !== undefined) {
          clearTimer(handle);
          handle = undefined;
        }
        return;
      }
      pending = rounded;
      if (handle !== undefined) clearTimer(handle);
      handle = setTimer(fire, delay);
    },
    flush() {
      if (handle !== undefined) clearTimer(handle);
      fire();
    },
    cancel() {
      pending = undefined;
      if (handle !== undefined) {
        clearTimer(handle);
        handle = undefined;
      }
    },
    get last() {
      return last;
    },
  };
}
