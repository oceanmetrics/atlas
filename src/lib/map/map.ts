// The ONE MapLibre instance, and the only file in the app that constructs one.
//
// Every line of the wiring below is a rule from docs/spikes/S2.md's verdict (CLAUDE.md "The spike
// pins"), and each one has a measured failure mode behind it:
//
//  - NAMED imports. maplibre-gl 6.x has no default export; a default import is a hard Rolldown
//    `[MISSING_EXPORT]` build failure, not a style preference.
//  - `maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url` + `setWorkerUrl()`. Plain `?url` emits a
//    worker whose 514 KB shared chunk 404s — rasters still paint and VECTOR TILES SILENTLY NEVER
//    PARSE. That is why every map spec asserts a rendered vector feature, not just pixels.
//  - `canvasContextAttributes: { preserveDrawingBuffer: true }`. The bare top-level key is silently
//    ignored in 5.x/6.x and every out-of-process `readPixels` then reads (0,0,0,0) while the map
//    visibly renders.
//  - `map.resize()` immediately after construction: without it raster tile requests were measurably
//    non-deterministic under headless Chromium.
//  - ONE composed style, applied with `setStyle(style, {diff:true})` — see style.ts. This file
//    never calls `addLayer`, `addSource` or `moveLayer`.
//
// The camera rule (CLAUDE.md "URL-is-the-view") lives in camera.ts: rounded, de-duplicated,
// debounced ~300 ms, `history.replaceState` only (through the caller's `onCamera`, which is
// `selStore.set` in the shell), and NEVER for a programmatic move — MapLibre's own `eventData`
// pass-through carries `atlasProgrammatic: true` from every `flyTo`/`jumpTo` this module makes, so
// there is no mutable flag to get out of sync.
import { Map as MapLibreMap, addProtocol, setWorkerUrl } from "maplibre-gl";
import { Protocol } from "pmtiles";
import maplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import "maplibre-gl/dist/maplibre-gl.css";
import {
  boundsToCameraView,
  createCameraWriter,
  type CameraBoundsInput,
  type CameraWriter,
  type ChromePadding,
} from "./camera";
import { FALLBACK_FULL_STUDY_AREA, PROGRAMMATIC_EVENT_DATA, type StudyArea } from "./interaction";
import { paddingEqual, residualFitPadding } from "./livePadding";
import { applyStyle } from "./style";
import { createStyleApplier } from "./styleQueue";
import type { MapView, Projection, ResolvedTheme, StyleSpecification } from "./types";

/** the empty style the map is constructed with; the real one arrives via `applyStyle` one tick
 * later, so construction never blocks on boot.json. The projection travels IN it: `setProjection()`
 * before the first style has loaded throws "Style is not done loading" (measured, atlas-map). */
function blankStyle(projection: Projection): StyleSpecification {
  return { version: 8, projection: { type: projection }, sources: {}, layers: [] };
}

let wired = false;

/**
 * Process-wide, once: the worker URL and the `pmtiles://` protocol. Both are global MapLibre state,
 * so registering them per map would re-register the protocol and throw on the second map (the
 * report page builds its own).
 */
export function wireMapLibreOnce(): void {
  if (wired) return;
  setWorkerUrl(maplibreWorkerUrl);
  addProtocol("pmtiles", new Protocol().tile);
  wired = true;
}

export interface CreateMapOptions {
  theme: ResolvedTheme;
  /** the URL's camera (`?map=`); when absent, `area` decides. */
  camera?: MapView;
  /** the study area to open on when there is no `?map=` — `boot.study_areas[sel.area]`. */
  area?: StudyArea;
  projection?: Projection;
  /** WP13: the standing camera padding at construction (the shell's estimate of what the panel
   * covers), set before the first frame so the first view is already centred in the open area. */
  padding?: ChromePadding;
  /** called with a settled, rounded, user-driven camera. The shell passes `selStore.set({map})`. */
  onCamera?: (camera: MapView) => void;
  /** override only in a test. */
  cameraDelayMs?: number;
}

export interface MapHandle {
  /** the raw MapLibre map — for `on`/`off` and `queryRenderedFeatures`; never for `addLayer`. */
  readonly map: MapLibreMap;
  /** apply a composed style (`composeStyle`) — the one `setStyle(diff:true)`. */
  applyStyle(style: StyleSpecification): void;
  /** globe ⇄ mercator. Also expressible as `composeStyle({projection})`; this is the imperative
   * twin for a control that flips it without recomposing anything else. */
  setProjection(projection: Projection): void;
  /** fly to a study area's centre + zoom. Never `fitBounds` (see interaction.ts). */
  flyTo(area: StudyArea): void;
  /**
   * Fly to an EXTENT — atlas-5's species camera (`src/lens/species/data/camera.ts`'s
   * `BoundsCamera`). `bounds[1][0]` (east) may exceed 180 (an unwrapped, re-expressed frame).
   *
   * V1 fix (Opus eyes-on review, 2026-09-24): `padding` accepts an asymmetric {@link ChromePadding}
   * (a docked panel/phone sheet/legend chip occluding one side of the map), not just a uniform
   * number — this method's own type signature used to be narrower than what it needed to pass
   * through, so the species lens had no way to hand one through.
   *
   * V4 fix (owner phone report, 2026-09-24): the camera is computed through the projection the
   * renderer itself uses (mercator or globe). WP13: that is now `solveFit` below (it projects the
   * extent's outline with the live padding in place); `cameraForBounds` + `boundsToCameraView` remain
   * only as the zero-size fallback. Deliberately NOT `fitBounds` (docs/map.md, no-fitbounds.test.ts).
   *
   * WP13: `padding` as a {@link ChromePadding} is the chrome reserve measured from the viewport edge;
   * the live padding the map already carries (`setPadding`) covers part of it, and MapLibre's
   * `cameraForBounds` adds an option padding ON TOP of `transform.padding`, so only the remainder is
   * passed on (`residualFitPadding`): with the panel open, just the breathing gutter. A bare number
   * is extra breathing room and passes through unchanged.
   */
  flyToBounds(bounds: CameraBoundsInput, opts?: { padding?: number | ChromePadding }): void;
  /**
   * WP13: set the map's standing camera padding, the part of the stage the panel and phone sheet
   * cover, so the centre (and a globe) is drawn in the middle of what stays open. The geographic
   * centre does not move; only where it is drawn does. `animate` eases it over 250 ms (the shell's
   * settle after a panel change); without it the padding is set at once (the first view, so nothing
   * shifts twice). A no-op when it is already the padding. While a programmatic fly is in flight the
   * change waits for its `moveend` rather than cutting the flight short. Never written to the URL.
   */
  setPadding(padding: ChromePadding, opts?: { animate?: boolean }): void;
  /** the padding the map is on, or is easing to, for the shell to compare against. */
  padding(): ChromePadding;
  /** the current camera, rounded for the URL. */
  camera(): MapView;
  resize(): void;
  /** write any pending camera immediately (the shell calls this on unload). */
  flushCamera(): void;
  destroy(): void;
}

/** does this move event come from the app rather than the user? */
function isProgrammatic(e: unknown): boolean {
  return !!(e as { atlasProgrammatic?: boolean } | undefined)?.atlasProgrammatic;
}

export function createMap(container: HTMLElement, opts: CreateMapOptions): MapHandle {
  wireMapLibreOnce();

  const start = opts.camera ?? {
    lon: (opts.area ?? FALLBACK_FULL_STUDY_AREA).lon,
    lat: (opts.area ?? FALLBACK_FULL_STUDY_AREA).lat,
    zoom: (opts.area ?? FALLBACK_FULL_STUDY_AREA).zoom,
  };

  const map = new MapLibreMap({
    container,
    style: blankStyle(opts.projection ?? "globe"),
    center: [start.lon, start.lat],
    zoom: start.zoom,
    bearing: start.bearing ?? 0,
    pitch: start.pitch ?? 0,
    // the on-map About card carries the attribution (spec.md §9); MapLibre's own control would be
    // a second, unstyled copy of it floating over the map.
    attributionControl: false,
    canvasContextAttributes: { preserveDrawingBuffer: true },
  });
  // S2 consequence 6: without this, raster tile requests are non-deterministic headless.
  map.resize();
  // WP13: the centre stays the camera's centre; only where it is drawn moves. Set before the first
  // frame, with no easing, and marked programmatic (the URL never records it).
  if (opts.padding) map.setPadding({ ...opts.padding }, { ...PROGRAMMATIC_EVENT_DATA });

  // ...and this one keeps it right afterwards. The `resize()` above runs before the shell's grid
  // has laid out, so the canvas can latch a wrong height and never correct it (measured: a 1280×800
  // viewport produced a 300 px-tall canvas, putting a probe point off the bottom edge). A
  // ResizeObserver on the container is the only signal that covers BOTH a window resize and a
  // layout-driven one — a panel opening, the phone sheet changing detent — neither of which fires a
  // window `resize` event.
  let observer: ResizeObserver | undefined;
  if (typeof ResizeObserver !== "undefined") {
    observer = new ResizeObserver(() => map.resize());
    observer.observe(container);
  }

  function currentCamera(): MapView {
    const c = map.getCenter();
    return {
      lon: c.lng,
      lat: c.lat,
      zoom: map.getZoom(),
      bearing: map.getBearing(),
      pitch: map.getPitch(),
    };
  }

  // WP13: the standing padding and how it is applied. `wanted` is the latest request; `flying` is
  // true from a programmatic fly until its `moveend` (an `easeTo({padding})` issued mid-flight
  // would cut the flight short and strand the fit), so a request made in that window waits.
  let wanted: ChromePadding = readPadding();
  let flying = false;
  function readPadding(): ChromePadding {
    const p = map.getPadding();
    return { top: p.top ?? 0, right: p.right ?? 0, bottom: p.bottom ?? 0, left: p.left ?? 0 };
  }
  function applyWanted(animate: boolean) {
    if (paddingEqual(readPadding(), wanted)) return;
    if (animate) map.easeTo({ padding: wanted, duration: 250 }, { ...PROGRAMMATIC_EVENT_DATA });
    else map.setPadding(wanted, { ...PROGRAMMATIC_EVENT_DATA });
  }
  const onFlightEnd = () => {
    if (solving) return;
    flying = false;
    applyWanted(true);
  };
  map.on("moveend", onFlightEnd);
  /** a fit computes its camera from `transform.padding`, so it must be the padding the shell asked
   * for, not an ease caught half way. */
  function settlePadding() {
    if (!paddingEqual(readPadding(), wanted))
      map.setPadding(wanted, { ...PROGRAMMATIC_EVENT_DATA });
  }

  // WP13: the fit solver. Frames `bounds` inside the region the chrome leaves free, using the
  // map's own projection (mercator or globe) with the live padding in place: the extent's outline is
  // projected at a candidate camera, and the camera is corrected until the outline's screen box fills
  // the region and is centred in it. `jumpTo` moves the camera synchronously (nothing is drawn
  // between) and the original camera is restored before returning; every move is marked
  // programmatic, and `solving` keeps `onFlightEnd` out of it. Returns undefined when the stage has
  // no size or the solve does not converge to something finite (the caller falls back).
  let solving = false;
  function outline(bounds: CameraBoundsInput): [number, number][] {
    const [[w, s], [e, n]] = bounds;
    const pts: [number, number][] = [];
    const STEPS = 12;
    for (let i = 0; i <= STEPS; i++) {
      const t = i / STEPS;
      const x = w + t * (e - w);
      const y = s + t * (n - s);
      pts.push([x, s], [x, n], [w, y], [e, y]);
    }
    return pts;
  }
  function solveFit(
    bounds: CameraBoundsInput,
    request: number | ChromePadding | undefined,
  ): { center: [number, number]; zoom: number } | undefined {
    const W = map.getCanvas().clientWidth;
    const H = map.getCanvas().clientHeight;
    if (!(W > 0 && H > 0)) return undefined;
    const L = wanted;
    // the free region, in canvas px: a ChromePadding is the chrome reserve from the stage edge, a
    // bare number is breathing room inside the open area, and nothing is the open area itself
    const edge = (want: number | undefined, have: number, bare: number) =>
      typeof request === "number" ? have + bare : Math.max(have, want ?? 0);
    const c = typeof request === "object" ? request : undefined;
    const region = {
      l: edge(c?.left, L.left, request as number),
      r: W - edge(c?.right, L.right, request as number),
      t: edge(c?.top, L.top, request as number),
      b: H - edge(c?.bottom, L.bottom, request as number),
    };
    if (!(region.r - region.l > 1 && region.b - region.t > 1)) return undefined;
    const pts = outline(bounds);
    const before = {
      center: map.getCenter(),
      zoom: map.getZoom(),
      bearing: map.getBearing(),
      pitch: map.getPitch(),
    };
    const rect = { width: W, height: H };
    const start = boundsToCameraView(bounds, rect, {
      padding: {
        top: region.t,
        right: W - region.r,
        bottom: H - region.b,
        left: region.l,
      },
      maxZoom: map.getMaxZoom(),
    });
    let center: [number, number] = [
      (bounds[0][0] + bounds[1][0]) / 2,
      (bounds[0][1] + bounds[1][1]) / 2,
    ];
    let zoom = start.zoom;
    const maxZoom = map.getMaxZoom();
    solving = true;
    try {
      for (let i = 0; i < 14; i++) {
        map.jumpTo({ center, zoom }, { ...PROGRAMMATIC_EVENT_DATA });
        let x0 = Infinity;
        let x1 = -Infinity;
        let y0 = Infinity;
        let y1 = -Infinity;
        for (const pt of pts) {
          const q = map.project(pt);
          if (!Number.isFinite(q.x) || !Number.isFinite(q.y)) return undefined;
          x0 = Math.min(x0, q.x);
          x1 = Math.max(x1, q.x);
          y0 = Math.min(y0, q.y);
          y1 = Math.max(y1, q.y);
        }
        const dx = (region.l + region.r) / 2 - (x0 + x1) / 2;
        const dy = (region.t + region.b) / 2 - (y0 + y1) / 2;
        const scale = Math.min(
          (region.r - region.l) / (x1 - x0),
          (region.b - region.t) / (y1 - y0),
        );
        const settled =
          Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5 && Math.abs(Math.log2(scale)) < 0.002;
        if (settled) break;
        if (!Number.isFinite(scale) || scale <= 0) return undefined;
        // move the box by (dx, dy): the camera's centre is the point now drawn at (dx, dy) away
        const cp = map.project(map.getCenter());
        const next = map.unproject([cp.x - dx, cp.y - dy]);
        if (!Number.isFinite(next.lng) || !Number.isFinite(next.lat)) return undefined;
        // keep the longitude continuous with the bounds (east may exceed 180)
        const mid = (bounds[0][0] + bounds[1][0]) / 2;
        let lng = next.lng;
        while (lng - mid > 180) lng -= 360;
        while (lng - mid < -180) lng += 360;
        center = [lng, next.lat];
        zoom = Math.min(maxZoom, Math.max(0, zoom + Math.log2(scale)));
      }
      return Number.isFinite(zoom) ? { center, zoom } : undefined;
    } finally {
      map.jumpTo(before, { ...PROGRAMMATIC_EVENT_DATA });
      solving = false;
    }
  }

  const applyQueuedStyle = createStyleApplier(map, (s) => applyStyle(map, s));
  let writer: CameraWriter | undefined;
  const onMove = (e: unknown) => {
    if (!writer || isProgrammatic(e)) return;
    writer.push(currentCamera());
  };
  if (opts.onCamera) {
    writer = createCameraWriter({ write: opts.onCamera, delayMs: opts.cameraDelayMs }, start);
    map.on("move", onMove);
    map.on("moveend", onMove);
  }

  return {
    map,
    // see styleQueue.ts's own header: a parked style waits for "idle" (never for the initial
    // style's one-off "style.load"), while an ISSUED style settles on its own "style.load"
    // (0.10.22); tests/map/styleQueue.test.ts holds the regression tests for both.
    applyStyle: applyQueuedStyle,
    setProjection(projection: Projection) {
      // deferred until a style exists: `setProjection` on a map whose first style has not loaded
      // throws "Style is not done loading" (measured, atlas-map — it is why the constructor above
      // carries the projection in its blank style instead of calling this). `"idle"`, not
      // `"style.load"` — see `applyStyle`'s comment just above: the latter fires only once, ever.
      if (map.isStyleLoaded()) map.setProjection({ type: projection });
      else map.once("idle", () => map.setProjection({ type: projection }));
    },
    setPadding(padding: ChromePadding, opts?: { animate?: boolean }) {
      wanted = { ...padding };
      if (flying) return; // applied by onFlightEnd
      applyWanted(opts?.animate ?? false);
    },
    padding: () => ({ ...wanted }),
    flyTo(area: StudyArea) {
      // a programmatic move supersedes whatever the user's last gesture was still holding.
      writer?.cancel();
      map.flyTo({ center: [area.lon, area.lat], zoom: area.zoom }, { ...PROGRAMMATIC_EVENT_DATA });
      flying = true; // after the call: flyTo stops a flight in progress, and that moveend must not clear this
    },
    flyToBounds(bounds: CameraBoundsInput, opts?: { padding?: number | ChromePadding }) {
      writer?.cancel();
      settlePadding();
      // WP13: solved against the REAL transform, with the live padding in place (`solveFit` below).
      // MapLibre's own `cameraForBounds` ADDS an option padding to `transform.padding` (6.10 source:
      // availableWidth = width - (transform.padding + padding)), which would be right for a flat map,
      // but its globe branch tests the extent against clip-space limits built from the option padding
      // ALONE while projecting with the padded transform, so with a standing padding the globe fit
      // lands off (measured: the phone's BioTrack extent clipped at the left edge and tucked under
      // the legend chip, zoom 2.01 vs the unpadded 2.33). Solving the fit here, by projecting the
      // extent's own outline, is exact for both projections and cannot pad twice. It is still not
      // `fitBounds`, and the bounds stay continuous (east may exceed 180), never wrapped.
      const solved = solveFit(bounds, opts?.padding);
      if (solved) {
        map.flyTo({ center: solved.center, zoom: solved.zoom }, { ...PROGRAMMATIC_EVENT_DATA });
        flying = true;
        return;
      }
      // WP13: only what the live padding does not already cover (header on `MapHandle.flyToBounds`)
      const fitPadding =
        opts?.padding === undefined ? undefined : residualFitPadding(opts.padding, wanted);
      // fallback: a zero-size container (a test, a not-yet-laid-out map) is the one case the solve
      // cannot run in — the old hand math still holds for it (with only the padding not yet applied).
      const rect = map.getContainer().getBoundingClientRect();
      const view = boundsToCameraView(
        bounds,
        { width: rect.width, height: rect.height },
        { padding: fitPadding },
      );
      map.flyTo({ center: view.center, zoom: view.zoom }, { ...PROGRAMMATIC_EVENT_DATA });
      flying = true;
    },
    camera: currentCamera,
    resize() {
      map.resize();
    },
    flushCamera() {
      writer?.flush();
    },
    destroy() {
      writer?.cancel();
      observer?.disconnect();
      map.off("move", onMove);
      map.off("moveend", onMove);
      map.off("moveend", onFlightEnd);
      map.remove();
    },
  };
}
