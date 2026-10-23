<script lang="ts">
  // atlas-7 step 2 — the report document itself: header band, intro, parameters, map, one flower
  // per place, the table of scores, the species summary per place, sources/method, provenance.
  // Progressive rendering (spec: "sections appear as their data lands, with ONE progress line"):
  // `placeInputs` starts with every place's `scores`/`species` at `null`, `buildReport()` is
  // re-run every time one more place's data lands (it is pure and cheap, per its own header), and
  // every section below simply renders whatever the model currently holds.
  //
  // The access gate is index.html's inline early-fetch script, duplicated verbatim into
  // report.html (see that file's header) — this component only ever reads the ALREADY-GATED
  // `window.__early`, exactly like Shell.svelte does, so a restricted release is refused here in
  // the same place it is refused there: before this component's own script ever runs.
  import { onMount } from "svelte";
  import { categoryLabel } from "../lib/ui/categories";
  import Announcer from "../lib/ui/Announcer.svelte";
  import { announce } from "../lib/ui/announcer";
  import Legend from "../lib/ui/Legend.svelte";
  import { nextRovingIndex } from "../lib/ui/roving";
  import { scrollAffordance } from "../lib/ui/scrollAffordance";
  import { agencyDisplayName, shouldShowSeal } from "../lib/ui/sealVisibility";
  import { SEAL } from "../lib/brand/instance";
  import { createAnalytics } from "../lib/analytics/analytics";
  import { analyticsLogUrl } from "../lib/analytics/logUrl";
  import { parseSel } from "../lib/state/codec";
  import { decodePlaces, type Place } from "../lib/geo/placeCodec";
  import {
    buildReport,
    expandPlaces,
    DEFAULT_TITLE,
    type ReportModel,
    type ReportPlaceInput,
  } from "../lib/report/model";
  import { paletteStopsFromBoot } from "../lib/raster/ramps";
  import { formatScore } from "../lib/format";
  import {
    formatCommonName,
    formatCoveragePct,
    formatCount,
    formatErScore,
    formatScore0,
  } from "../lib/report/format";
  import { bootEngine, loadPlaceData, sqlRunFor, tablesReadFor, DUCKDB_WASM_VERSION } from "./data";
  import { permalinkQrDataUrl } from "./qr";
  import { downloadStandaloneHtml, fetchAsDataUrl } from "./exportHtml";
  import { downloadDataPackage } from "./exportZip";
  import { speciesCsv } from "./exportFiles";
  import "./report.css";
  import { REPORT_COLOR_UNRESOLVED } from "./colors";
  // the instance's mark (lib/brand/Mark.svelte). report.html is always `data-theme="paper"` (this
  // file's own head comment), so the mark reads the paper theme's tokens without extra logic here.
  import Mark from "../lib/brand/Mark.svelte";
  import type { DataEngineContext } from "../places/dataEngine";
  import type { PlaceStub } from "../lib/report/model";
  import { erColumnParts } from "../lib/report/er";

  // ---- window.__early (report.html's own copy of index.html's inline early-fetch script) -----
  interface Early {
    version: Promise<string | null>;
    boot?: Promise<unknown>;
    denied?: Promise<{ ver: string; reason: string } | null>;
    session?: Promise<{ preview: boolean; raw: unknown }>;
  }
  let ver = $state<string | null>(null);
  let boot = $state<unknown>(null);
  let preview = $state(false);
  let denied = $state<{ ver: string; reason: string } | null>(null);
  let earlySettled = $state(false);

  onMount(() => {
    const early = (window as unknown as { __early?: Early }).__early;
    if (!early) {
      earlySettled = true;
      return;
    }
    Promise.allSettled([
      early.version.then((v) => (ver = v)),
      early.boot?.then((b) => (boot = b)) ?? Promise.resolve(),
      // R3-B15: the SAME resolved session this `preview` state already drives the watermark/banner
      // from -- `analytics.updatePreview()` corrects `content_group` (constructed as a `preview:
      // false` guess below, same reason `Shell.svelte`'s own comment gives) once it is known.
      early.session?.then((s) => {
        preview = s.preview === true;
        analytics.updatePreview(preview);
      }) ?? Promise.resolve(),
      early.denied?.then((d) => (denied = d)) ?? Promise.resolve(),
    ]).then(() => (earlySettled = true));
  });

  // ---- the URL: places + title (D8/CLAUDE.md: never re-derived, only decoded) ------------------
  const sel = parseSel(location);
  const places: Place[] = decodePlaces(sel.pl ?? "");
  const title = sel.t?.trim() || DEFAULT_TITLE;
  const now = new Date(); // captured ONCE — a model that re-reads the clock on every progressive
  // re-render would tick the "generated" stamp and the permalink while the page is still loading.
  const appSha = __APP_VERSION__; // package version stands in for a git SHA until CI wires one in

  // `preview: false` here is a necessary GUESS, same as Shell.svelte's own -- the session fetch
  // has not resolved yet at construction time. The component's OWN `preview` state (below) drives
  // the document's watermark/banner and is corrected the instant `early.session` resolves (see the
  // `onMount` above); `analytics.updatePreview()` there keeps `content_group` in step with it
  // (R3-B15) -- the GA4 loader tag itself is a separate, still-open gap (not this fix's job).
  // round 2, Q7 fix: `logUrl` was never passed here either -- see Shell.svelte's own comment and
  // src/lib/analytics/logUrl.ts.
  const analytics = createAnalytics({
    appVersion: __APP_VERSION__,
    preview: false,
    logUrl: analyticsLogUrl(),
  });

  // ---- progressive data load --------------------------------------------------------------
  let placeInputs = $state<ReportPlaceInput[] | null>(null);
  let stubs = $state<PlaceStub[]>([]);
  let progressLabel = $state("Resolving the release…");
  let progressDone = $state(0);
  let engineCtx: DataEngineContext | null = null;
  let engineBooted = $state(false);
  let started = false;

  $effect(() => {
    if (started || !earlySettled || ver === null || boot === null) return;
    started = true;
    void run();
  });

  async function run() {
    if (places.length === 0) {
      progressLabel = "No places in this link.";
      placeInputs = [];
      return;
    }
    // gazetteer-places: a `p.` place_id token is fetched here and analysed as a geometry place
    // (report/gazPlaces.ts); a place that cannot be loaded is left out and said so, never guessed.
    let reportPlaces: Place[] = places;
    let tokenOverride: Map<Place, string> | undefined;
    if (places.some((p) => p.kind === "gaz")) {
      progressLabel = "Loading places from the gazetteer…";
      const [{ resolveGazForReport }, { resolveGazPlace }] = await Promise.all([
        import("./gazPlaces"),
        import("../lib/gazetteer/resolve"),
      ]);
      const r = await resolveGazForReport(places, (id) => resolveGazPlace(id));
      reportPlaces = r.places;
      tokenOverride = r.tokens;
      if (r.failed.length) {
        announce(
          `Left out ${r.failed.length} gazetteer place${r.failed.length === 1 ? "" : "s"} that could not be loaded: ${r.failed.map((f) => f.id).join(", ")}.`,
        );
      }
      if (reportPlaces.length === 0) {
        progressLabel = "The gazetteer places in this link could not be loaded.";
        placeInputs = [];
        return;
      }
    }
    const expanded = expandPlaces(reportPlaces, boot, tokenOverride);
    stubs = expanded;
    let inputs: ReportPlaceInput[] = expanded.map((s) => ({
      place: s.place,
      zoneKey: s.zoneKey,
      token: s.token,
      name: s.name,
      geometry: s.place.kind === "geom" ? s.place.geometry : undefined,
      scores: null,
      species: null,
    }));
    placeInputs = inputs;

    if (expanded.length > 0) {
      progressLabel = "Starting the data engine…";
      engineCtx = await bootEngine(ver!, boot as Record<string, unknown>).catch(() => null);
      engineBooted = engineCtx !== null;
    }

    for (let i = 0; i < expanded.length; i++) {
      progressLabel = `Scoring ${inputs[i].name} (${i + 1} of ${expanded.length})…`;
      const result = await loadPlaceData(
        engineCtx,
        boot,
        expanded[i],
        inputs[i].geometry,
        (done, total) => {
          progressLabel = `${inputs[i].name}: species tiles ${done}/${total}`;
        },
      );
      inputs = inputs.map((p, j) =>
        j === i ? { ...p, scores: result.scores, species: result.species ?? [] } : p,
      );
      placeInputs = inputs;
      progressDone = i + 1;
      announce(`${inputs[i].name} scored${result.error ? ` — ${result.error}` : ""}.`);
    }
    progressLabel = `Done — ${expanded.length} place${expanded.length === 1 ? "" : "s"}.`;
    analytics.track("report_open", {
      n_places: expanded.length,
      kinds: [...new Set(expanded.map((s) => s.place.kind))].sort().join(","),
    });
  }

  const model = $derived<ReportModel | null>(
    placeInputs && ver
      ? buildReport({
          ver,
          boot,
          places: placeInputs,
          tables: tablesReadFor(boot, stubs, engineBooted),
          now,
          appSha,
          title,
          preview,
          permalink: { origin: location.origin, path: location.pathname },
          duckdbWasm: engineBooted ? DUCKDB_WASM_VERSION : null,
          sql: sqlRunFor(engineCtx, stubs),
        })
      : null,
  );

  // ---- header band: agency lockup, QR, preview banner -------------------------------------
  // the instance's seal (`seal` in instance.json: agency and image), shown only on a build with
  // `VITE_SEAL=1` (fail closed, sealVisibility.ts)
  const sealFlag = import.meta.env.VITE_SEAL;
  const agency = SEAL?.agency;
  const sealUrl = SEAL?.src ?? "";
  const showAgencyLockup = shouldShowSeal(sealFlag, agency);
  const agencyName = agencyDisplayName(agency);

  let qrDataUrl = $state<string | null>(null);
  $effect(() => {
    const href = model?.header.permalink.href;
    if (!href) return;
    void permalinkQrDataUrl(href).then((url) => (qrDataUrl = url));
  });

  // fix round 2, item 3: the printed running footer's real content (permalink · release · page N
  // of M) has to reach the `@page { @bottom-center }` margin box, which is generated content with
  // no element of its own to read a prop off of -- CSS custom properties are the one channel that
  // both (a) carries an arbitrary runtime string and (b) inherits down into a page margin box
  // (Chromium does render `@bottom-center`; the plan's earlier note that it doesn't was wrong --
  // measured false). `report.css`'s own `content:` reads these two vars; `counter(page)`/
  // `counter(pages)` supply the page numbers, which need no JS at all.
  $effect(() => {
    if (!model) return;
    const root = document.documentElement.style;
    root.setProperty("--report-footer-permalink", JSON.stringify(model.header.permalink.href));
    root.setProperty("--report-footer-release", JSON.stringify(model.header.releaseChip));
  });

  // ---- the map (lazy maplibre, per this module's own budget note) --------------------------
  let mapEl = $state<HTMLDivElement | undefined>(undefined);
  let mapPngUrl = $state<string | null>(null);
  let mapCaptureFailed = $state(false);
  let mapStarted = false;

  $effect(() => {
    // P4: dropped the old `model.map.places.length === 0` exclusion -- a report with NO places
    // (reachable only by hand-editing the URL today, but the brief's own rule: "the study-area-wide
    // report fits the study area") used to leave `mapEl` permanently unmounted, an inert empty box
    // forever. `mountMap()` itself now branches on an empty `stubs` to fly to the full study area
    // with no place layers, rather than this effect silently skipping the section altogether.
    //
    // W4 fix (Ben, phone, live 0.10.64: two Program Areas both filled the same neutral grey-blue,
    // no colour at all): `model` turns non-null the INSTANT `run()` sets `placeInputs` --
    // SYNCHRONOUSLY, with every place's `score` still `null`, before `run()` even awaits
    // `bootEngine()` (let alone the per-place scoring loop, which is sequenced AFTER that await).
    // This effect used to fire right then, so `mountMap()` (a deliberate ONE-SHOT build --
    // reportMap.ts's own header: "never a reactive re-compose") always painted every place -- the
    // zone `match` (zoneKeyColors) AND the drawn-place `interpolate` (scoreColorExpression) alike --
    // with `REPORT_NODATA_COLOR`, and NEVER repainted once the real scores landed: the caption/
    // legend are reactive template bindings that kept tracking `model`, but the imperative map
    // style built once and never again. Every hermetic gate missed it because `blockWasm()` makes
    // `bootEngine()` REJECT before `mountMap()`'s own dynamic imports resolve, so in every test the
    // race quietly ran the other way. Wait for every place's data to have actually landed (or for
    // there to be no place to score at all) before the one-shot build runs, so it captures the same
    // model the caption/legend already show.
    const mapDataReady = stubs.length === 0 || progressDone >= stubs.length;
    if (mapStarted || !mapEl || !model || !mapDataReady) return;
    mapStarted = true;
    void mountMap();
  });

  /** the map's fitted bounds, written to `mapEl.dataset.fittedBounds` once the camera settles on
   * its FINAL view -- the e2e seam `e2e/report.map.spec.ts` reads instead of racing the `flyTo`
   * animation itself (P4). `null` (as the JSON literal `"null"`) when nothing to fit. */
  function writeFittedBoundsAttr(bounds: [[number, number], [number, number]] | null) {
    if (mapEl) mapEl.dataset.fittedBounds = JSON.stringify(bounds);
  }

  async function mountMap() {
    if (!mapEl || !model) return;
    // fix round 1 (Opus review, item 1): `createMap()`/`flyToBounds()` are `lib/map/map.ts`'s own
    // -- reused, not restated (see reportMap.ts's header) -- which is also what gives this map
    // the app's real antimeridian-aware bounds fitting instead of MapLibre's own `fitBounds`
    // (m8, atlas-8 review round 2: no trailing "()" here on purpose -- `no-fitbounds.test.ts`'s
    // scan now covers this directory too, and its regex would otherwise flag this comment).
    const [mapMod, { createMap }, zonesMod, interactionMod] = await Promise.all([
      import("./reportMap"),
      import("../lib/map/map"),
      import("../lib/map/layers/zones"),
      import("../lib/map/interaction"),
    ]);
    const paletteStops = paletteStopsFromBoot(boot as { palettes?: unknown }, "spectral_r");
    const features = stubs.map((s, i) => ({
      name: model!.map.places[i]?.name ?? s.name,
      score: model!.map.places[i]?.score ?? null,
      geometry: s.place.kind === "geom" ? s.place.geometry : undefined,
      point:
        s.place.kind === "zone"
          ? (mapMod.zonePointFromBoot(boot, s.unit ?? s.place.set, s.zoneKey ?? "") ?? undefined)
          : undefined,
    }));

    // P4 (B1, "the report map draws no place"): a zone place's REAL Program-Area polygon, from the
    // release's own PMTiles archive -- grouped by unit, each unit carrying only the keys THIS
    // report asked about, coloured with this report's OWN ramp (never the release's).
    const zoneUnits = zonesMod.zoneUnitsFromBoot(boot);
    const zoneGroups = zoneUnits
      .map((unit) => {
        const entries = stubs
          .map((s, i) => ({ s, i }))
          .filter(({ s }) => s.place.kind === "zone" && (s.unit ?? s.place.set) === unit.unit)
          .map(({ s, i }) => ({
            key: s.zoneKey ?? (s.place.kind === "zone" ? s.place.keys[0] : ""),
            score: model!.map.places[i]?.score ?? null,
          }));
        return { unit, keyColors: mapMod.zoneKeyColors(entries, model!.map.domain, paletteStops) };
      })
      .filter((g) => Object.keys(g.keyColors).length > 0);

    const { style } = await mapMod.buildReportMapStyle({
      places: features,
      domain: model.map.domain,
      paletteStops,
      zoneGroups,
    });
    const handle = createMap(mapEl, { theme: "paper", projection: "mercator" });
    handle.applyStyle(style);
    // the map's public test/automation seam (docs/map.md's convention -- Shell.svelte's own
    // `window.__atlasMap`, mirrored here): exposes nothing a viewer could not already read off the
    // page.
    (window as unknown as { __reportMap?: unknown }).__reportMap = { handle };

    const geomBounds = mapMod.combinedBbox(features.filter((f) => f.geometry));
    if (zoneGroups.length === 0 && stubs.length > 0) {
      // no zone place needs its polygon queried (custom/drawn places only, or a zone place whose
      // point-only fallback is all `combinedBbox` can offer) -- the OLD one-shot path, unchanged.
      const bounds = geomBounds ?? mapMod.combinedBbox(features);
      if (bounds) handle.flyToBounds(bounds, { padding: 40 });
      writeFittedBoundsAttr(bounds);
    } else {
      // a zone place (or no place at all -- "the study-area-wide report fits the study area"):
      // fly PROVISIONALLY to the full study area first, wide enough that every unit's low-zoom
      // tiles are guaranteed to cover it, then refine to the REAL rendered polygon bbox once the
      // pmtiles source has settled.
      const full = interactionMod.studyAreaFromBoot(boot, "FULL");
      handle.flyTo(full);
      // TWICE, with a real wall-clock gap between -- the SAME pattern `captureMapPng` (reportMap.ts)
      // already needs and documents: "idle" fires once a tile's NETWORK FETCH resolves, not once a
      // vector tile's WORKER-SIDE PARSE finishes, so a query fired the instant the first "idle"
      // lands can still read a layer with zero features even though the matching data is already in
      // flight -- measured directly (report.map.spec.ts's own red run against a single wait).
      await mapMod.waitForIdle(handle.map as never);
      await new Promise((r) => setTimeout(r, mapMod.CAPTURE_DECODE_SETTLE_MS));
      await mapMod.waitForIdle(handle.map as never);
      let finalBounds = geomBounds;
      if (zoneGroups.length > 0) {
        const layers = zoneGroups.map((g) => `report-zone-fill-${g.unit.unit}`);
        const rendered = (
          handle.map as unknown as {
            queryRenderedFeatures(opts: {
              layers: string[];
            }): { geometry: { type: string; coordinates: unknown } }[];
          }
        ).queryRenderedFeatures({ layers });
        const zoneBounds = mapMod.bboxFromRenderedFeatures(rendered);
        finalBounds = mapMod.unionBounds(geomBounds, zoneBounds ?? mapMod.combinedBbox(features));
      }
      if (finalBounds) handle.flyToBounds(finalBounds, { padding: 40 });
      writeFittedBoundsAttr(finalBounds);
    }

    try {
      const png = await mapMod.captureMapPng(handle.map as never);
      mapPngUrl = png.dataUrl;
    } catch {
      mapCaptureFailed = true;
    }
  }

  // ---- flowers: tabs on screen, sequential in print -----------------------------------------
  let activeFlower = $state(0);

  // fix list #13 (SC 4.1.2): the tabs were named correctly and aria-selected was right, but there
  // was no role="tabpanel", no aria-controls/aria-labelledby linking a tab to its figure, and no
  // Arrow-key navigation -- a screen reader announced "tab, 1 of 2", Arrow Right (the role's own
  // promise) did nothing, and there was no way to jump from a tab to the figure it controls.
  // `nextRovingIndex` (roving.ts) is the SAME wrap-at-both-ends math the tool rail already uses,
  // horizontal orientation (a row of place tabs, like the rail's phone layout).
  function selectFlower(i: number) {
    activeFlower = i;
  }

  function handleFlowerTabsKeydown(event: KeyboardEvent) {
    const container = event.currentTarget as HTMLElement;
    const tabs = [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    const next = nextRovingIndex(activeFlower, tabs.length, event.key, "horizontal");
    if (next === null) return;
    event.preventDefault();
    activeFlower = next;
    tabs[next]?.focus();
  }

  // ---- disclosures ---------------------------------------------------------------------------
  let parametersOpen = $state(false);
  let provenanceOpen = $state(false);

  // ---- species CSV download (client-side Blob, §6c) -----------------------------------------
  function downloadSpeciesCsvFor(i: number) {
    if (!model) return;
    const csv = speciesCsv(model, i);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = model.species[i].csvFilename;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ---- species counts table scroll affordance (V5 fix) --------------------------------------
  // Opus eyes-on, 2026-09-24: the counts table hid columns inside `.table-scroll` with no cue.
  // Keyed by place index `i` (one counts table per place, same as `downloadSpeciesCsvFor` above);
  // `report.css`'s `data-scrollable` selectors read this per-table via the attribute it sets below.
  let countsOverflow = $state<boolean[]>([]);
  function setCountsOverflow(i: number, overflows: boolean) {
    countsOverflow[i] = overflows;
  }

  // ---- exports --------------------------------------------------------------------------------
  function resolveColorVar(name: string): string {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || REPORT_COLOR_UNRESOLVED;
  }

  function onPrint() {
    window.print();
  }

  async function onDownloadHtml() {
    if (!model) return;
    await downloadStandaloneHtml(model.header.fileStem, model.header.title, {
      transform: async (clone) => {
        clone
          .querySelectorAll<HTMLElement>(".map-live")
          .forEach((el) => (el.style.display = "none"));
        clone
          .querySelectorAll<HTMLElement>(".map-print")
          .forEach((el) => (el.style.display = "block"));
        clone.querySelectorAll<HTMLElement>(".export-bar").forEach((el) => el.remove());
        clone
          .querySelectorAll<HTMLElement>(".disclosure-body")
          .forEach((el) => el.removeAttribute("hidden"));
        clone
          .querySelectorAll<HTMLElement>(".flower-panel")
          .forEach((el) => el.removeAttribute("hidden"));
        // B5 fix: `sealUrl` (above) is a REMOTE URL -- `cloneNode()` copies that same `src`
        // attribute verbatim (and copies no event listener, so the live `<img>`'s own `onerror`
        // fallback never comes along either), so the downloaded file showed a broken image the
        // moment it was opened without network access. Inline it as a data URI instead; a failed
        // fetch (offline, CORS) removes the image rather than shipping a dead `src` -- same
        // "degrade, don't break" spirit as the live page's `onerror` handler. `showAgencyLockup`
        // already gates whether `.agency-lockup` exists in the DOM at all (it wraps `VITE_SEAL` +
        // the agency check, sealVisibility.ts), so this naturally does nothing when the seal is
        // off -- no separate flag check needed here.
        const sealImg = clone.querySelector<HTMLImageElement>(".agency-lockup img");
        if (sealImg) {
          const dataUrl = await fetchAsDataUrl(sealUrl);
          if (dataUrl) sealImg.src = dataUrl;
          else sealImg.remove();
        }
      },
    });
    analytics.track("report_export", { format: "html" });
  }

  async function onDownloadZip() {
    if (!model || !placeInputs) return;
    await downloadDataPackage(model, placeInputs);
    analytics.track("report_export", { format: "zip" });
  }

  async function onDownloadDocx() {
    if (!model) return;
    const { downloadDocx } = await import("./exportDocx");
    let mapPng: { bytes: Uint8Array; width: number; height: number } | null = null;
    if (mapPngUrl) {
      const buf = await (await fetch(mapPngUrl)).arrayBuffer();
      const img = new Image();
      const dims = await new Promise<{ w: number; h: number }>((resolve) => {
        img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
        img.src = mapPngUrl!;
      });
      mapPng = { bytes: new Uint8Array(buf), width: dims.w, height: dims.h };
    }
    await downloadDocx(model, { mapPng, resolveColor: resolveColorVar });
    analytics.track("report_export", { format: "word" });
  }
</script>

<Announcer />

<div class="export-bar no-print">
  <button type="button" onclick={onPrint}>Print</button>
  <button type="button" onclick={onDownloadHtml} disabled={!model}>Download HTML</button>
  <button type="button" onclick={onDownloadZip} disabled={!model}>Data package (ZIP)</button>
  <button type="button" onclick={onDownloadDocx} disabled={!model}>Word document</button>
</div>

<!-- fix list #4 (SC 4.1.3): an explicit aria-live="off" used to OVERRIDE the implicit `polite`
     role="status" carries, so the one message telling a screen-reader user the document is
     building, and then that it finished, was announced to nobody. Dropping it (role="status"'s
     own implicit polite is exactly what this needs) also means this page now has TWO polite
     regions -- the shared Announcer below and this line -- which is accepted, not routed through
     announce() instead, because they say different things (this is the build's OWN progress; the
     Announcer's per-place messages are separate events). -->
<p class="progress-line" role="status" aria-atomic="true">{progressLabel}</p>

{#if model}
  <header class="report-header">
    <Mark size="40px" />
    {#if showAgencyLockup}
      <div class="agency-lockup">
        <img
          src={sealUrl}
          alt=""
          onerror={(e) => ((e.currentTarget as HTMLImageElement).style.display = "none")}
        />
        <span>{agencyName}</span>
      </div>
    {/if}
    <div class="titles">
      <h1>{model.header.title}</h1>
      <span class="report-chip">{model.header.releaseChip}</span>
      <div>Generated {model.header.generatedLabel}</div>
      <div>
        <!-- V4 fix (owner phone report, 2026-09-24): `report.css`'s `overflow-wrap: anywhere` used
             to apply to EVERY `<a>` in the report (`#report-root a`), so a short common-name link
             ("Leatherback") could break mid-word for no reason -- `.report-url` scopes it to just
             the links whose visible TEXT is the raw URL itself (this permalink line, and a
             citation's own href below), the one case that genuinely needs it. -->
        <a class="report-url" href={model.header.permalink.href}>{model.header.permalink.href}</a>
      </div>
    </div>
    {#if qrDataUrl}
      <img class="report-qr" src={qrDataUrl} alt="" aria-hidden="true" />
    {/if}
  </header>
  <div class="wave-footer" aria-hidden="true"></div>

  {#if model.header.previewBanner}
    <p class="preview-banner">{model.header.previewBanner}</p>
  {/if}
  <p class="print-watermark" aria-hidden="true">{model.header.previewBanner ? "PREVIEW" : ""}</p>

  {#if denied}
    <p class="progress-line">
      Note: {denied.ver} is not available on this host; showing {model.header.ver} instead.
    </p>
  {/if}

  <section aria-labelledby="s-intro">
    <h2 id="s-intro">Introduction</h2>
    <p>{model.intro.text}</p>
    <p>
      <a href={model.intro.appHref}>Open this release in the Atlas</a> ·
      <a href={model.intro.docsHref}>Documentation for {model.intro.ver}</a>
    </p>
  </section>

  <section aria-labelledby="s-params" class="disclosure">
    <h2 id="s-params">
      <button
        type="button"
        aria-expanded={parametersOpen}
        onclick={() => (parametersOpen = !parametersOpen)}
      >
        Parameters {parametersOpen ? "▾" : "▸"}
      </button>
    </h2>
    <div class="disclosure-body" hidden={!parametersOpen}>
      <!-- V1 fix (Opus eyes-on review, 2026-09-24, phone 390px): wraps every table in its own
           horizontal scroll container -- see report.css's `.table-scroll` header for why.
           V4 fix (owner phone report, 2026-09-24): the caption moved ABOVE the scroll container
           (report.css's `.table-caption` header) -- see that header for why. -->
      <p class="table-caption" id="parameters-caption">Report parameters, per place.</p>
      <div class="table-scroll">
        <table aria-labelledby="parameters-caption">
          <thead>
            <tr>
              <th scope="col">Place</th>
              <th scope="col">Kind</th>
              <th scope="col">Zone keys / vertices</th>
              <th scope="col" class="num">Area (km²)</th>
              <th scope="col" class="num">N cells</th>
              <th scope="col" class="num">Study-area share</th>
              <th scope="col">Token</th>
            </tr>
          </thead>
          <tbody>
            {#each model.parameters as p (p.token)}
              <tr>
                <td>{p.name}</td>
                <td>{p.kind}</td>
                <td>{p.zoneKeys ? p.zoneKeys.join(", ") : (p.vertexCount ?? "—")}</td>
                <td class="num">{p.areaKm2 === null ? "—" : formatCount(p.areaKm2)}</td>
                <td class="num">{formatCount(p.nCells)}</td>
                <td class="num"
                  >{p.studyAreaPct === null ? "—" : formatCoveragePct(p.studyAreaPct / 100)}</td
                >
                <td><code>{p.token}</code></td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
      <!-- fix round 2, item 2: D7b's own disclosure, per drawn place -- a zone place has none
           (d7bNote is null: a published zone IS the study area, nothing to disclose). -->
      {#each model.parameters as p (p.token)}
        {#if p.d7bNote}
          <p class="d7b-note">{p.name}: {p.d7bNote}</p>
        {/if}
      {/each}
    </div>
  </section>

  <section aria-labelledby="s-map">
    <h2 id="s-map">Map</h2>
    <p class="narrative">{model.map.narrative}</p>
    <figure aria-describedby="map-summary">
      <div bind:this={mapEl} class="map-live no-print" style="height: 360px;"></div>
      <div class="map-print">
        {#if mapPngUrl}
          <img src={mapPngUrl} alt="" style="max-width: 100%;" />
        {:else if mapCaptureFailed}
          <p>Map unavailable for print/export.</p>
        {:else}
          <p>Map rendering…</p>
        {/if}
      </div>
      {#if model.map.single}
        <!-- W4 fix (design call noted twice by reviewers, then Ben's phone report): ONE place has
             no range to show a two-ended gradient for -- "ramp 33 to 34" around a single value is
             fake precision. A single swatch + its own value, not `<Legend>`'s gradient. -->
        {@const single = model.map.single}
        <div
          class="legend-single"
          role="img"
          aria-label={`${model.map.legendTitle}: ${single.name} ${formatScore0(single.score)}`}
        >
          <span class="legend-single-swatch" style={`background-color:${single.color}`}></span>
          <span>{model.map.legendTitle}: {formatScore0(single.score)}</span>
        </div>
      {:else if model.map.domain}
        {@const stops = paletteStopsFromBoot(boot as { palettes?: unknown }, "spectral_r")}
        {#if stops}
          <Legend
            title={model.map.legendTitle}
            stops={stops.map((c, i) => ({
              color: c,
              value:
                model!.map.domain![0] +
                (i / (stops.length - 1)) * (model!.map.domain![1] - model!.map.domain![0]),
            }))}
            unit="score"
            formatValue={(v) => formatScore0(v)}
          />
        {/if}
      {/if}
      <figcaption id="map-summary">{model.map.summary}</figcaption>
    </figure>
    <p class="attribution">© OpenStreetMap contributors © CARTO</p>
  </section>

  <section aria-labelledby="s-flowers">
    <h2 id="s-flowers">Plot of Scores</h2>
    <!-- tabindex="-1" on the CONTAINER (role="tablist") is not a real tab stop -- same as
         Rail.svelte's own role="toolbar" div; only the tabs inside it are (roving tabindex,
         below) -- but svelte-check's a11y rule wants an explicit value on any interactive role.
         R3-B7 (Opus eyes-on review, 2026-09-25): a SINGLE place rendered one tab -- a pill reading
         "GOA Program Area A (GAA)" -- directly above the panel's OWN `<figcaption>`, the same
         text again as a heading line right under it. A one-item tablist has nothing to navigate
         between, so it is hidden entirely (never rendered) when there is exactly one place; the
         figcaption is then the ONE visible name, and the figure's `aria-labelledby` points at it
         directly instead of a tab that no longer exists. Two or more places keep the tabs exactly
         as before (each tab's own text differs from every other place's, so nothing repeats). -->
    {#if model.flowers.length > 1}
      <div
        class="flower-tabs no-print"
        role="tablist"
        aria-label="Places"
        tabindex="-1"
        onkeydown={handleFlowerTabsKeydown}
      >
        {#each model.flowers as f, i (f.name)}
          <button
            type="button"
            id={`flower-tab-${i}`}
            role="tab"
            aria-selected={activeFlower === i}
            aria-controls={`flower-panel-${i}`}
            tabindex={activeFlower === i ? 0 : -1}
            onclick={() => selectFlower(i)}
          >
            {f.name}
          </button>
        {/each}
      </div>
    {/if}
    <div class="flower-panels">
      {#each model.flowers as f, i (f.name)}
        <figure
          id={`flower-panel-${i}`}
          class="flower-panel"
          role="tabpanel"
          aria-labelledby={model.flowers.length > 1 ? `flower-tab-${i}` : `flower-caption-${i}`}
          hidden={activeFlower !== i}
          aria-describedby={`flower-summary-${i}`}
        >
          <figcaption id={`flower-caption-${i}`}>{f.name}</figcaption>
          <p class="narrative">{f.narrative}</p>
          <svg
            viewBox="0 0 200 200"
            width="200"
            height="200"
            role="group"
            aria-label={`Composite mean ${f.centre ?? "no data"}`}
          >
            <!-- atlas-4 fix round 2 (2026-09-24 defect): petals are an ANNULAR sector from
                 `f.geometry.innerRadius` (the SAME shared geometry `computeFlowerGeometry` builds
                 for the live app, `src/lib/ui/flowerGeometry.ts`'s header), never a pie slice from
                 the true centre -- this file used to draw a hub circle of a hardcoded `r="24"` ON
                 TOP of full pie slices, which covered any component scoring <= 24 exactly the way
                 the live app's own bug did. V2 (2026-09-24 eyes-on): no `opacity="0.5"` --
                 the petals must render the SAME `--cat-*` colour as the `.flower-legend .swatch`
                 swatches below them (Flower.svelte's own full-opacity rule). -->
            {#each f.geometry.petals as p (p.key)}
              <path
                d={p.path}
                style={`fill: var(${p.category.color})`}
                stroke="white"
                stroke-width="1"
              >
                <title>{p.category.label}: {formatScore(p.score)}</title>
              </path>
            {/each}
            <circle
              cx="100"
              cy="100"
              r={f.geometry.innerRadius}
              class="hub"
              fill="var(--surface-raised)"
              stroke="var(--border-control)"
            />
            <text x="100" y="100" text-anchor="middle" dy="0.35em" font-weight="700"
              >{f.centre ?? "—"}</text
            >
          </svg>
          <!-- a legend BENEATH the flower (docs/parity/checklists/atlas-7-report.md:24): this
               page's petals carry a `<title>` tooltip, but a printed page and the exported
               docx/HTML snapshot show neither hover state nor JS, so color alone would be the
               ONLY cue to which petal is which component -- exactly what spec.md's "no
               information by color alone" forbids. One swatch + label per DRAWN petal, in the
               same order the ring lays them out. -->
          <ul class="flower-legend" aria-label={`${f.name} flower components`}>
            {#each f.geometry.petals as p (p.key)}
              <li>
                <span class="swatch" style={`background: var(${p.category.color})`}></span>
                {p.category.label}
              </li>
            {/each}
          </ul>
          <p id={`flower-summary-${i}`}>{f.summary}</p>
        </figure>
      {/each}
    </div>
  </section>

  <section aria-labelledby="s-scores">
    <h2 id="s-scores">Table of Scores</h2>
    <p class="narrative">{model.scores.narrative}</p>
    <!-- V4 fix (owner phone report, 2026-09-24): caption moved above the scroll container -- see
         report.css's `.table-caption` header for why. -->
    <p class="table-caption" id="scores-caption">Mean component and overall scores per area.</p>
    <div class="table-scroll">
      <table aria-labelledby="scores-caption" aria-describedby="scores-summary">
        <thead>
          <tr>
            <th scope="col">Area</th>
            <th scope="col" class="num">N cells</th>
            {#each model.scores.components as c (c)}
              <th scope="col" class="num">{categoryLabel(c)}</th>
            {/each}
            <th scope="col" class="num">Overall</th>
          </tr>
        </thead>
        <tbody>
          {#each model.scores.rows as row (row.name)}
            <tr>
              <th scope="row">{row.name}</th>
              <td class="num">{formatCount(row.nCells)}</td>
              {#each row.cells as cell (cell.component)}
                <td class="num">
                  {cell.score === null ? "—" : formatScore0(cell.score)}
                  {#each cell.footnotes as id (id)}<sup>{id}</sup>{/each}
                </td>
              {/each}
              <td class="num"
                ><strong>{row.overall === null ? "—" : formatScore0(row.overall)}</strong></td
              >
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
    {#if model.scores.footnotes.length}
      <ol class="footnotes">
        {#each model.scores.footnotes as fn (fn.id)}
          <li id={`footnote-${fn.id}`}>{fn.text}</li>
        {/each}
      </ol>
    {/if}
    <p id="scores-summary" class="sr-only-note">{model.scores.summary}</p>
  </section>

  <section aria-labelledby="s-species">
    <h2 id="s-species">Summary of Species</h2>
    <p class="narrative">{model.speciesNarrative}</p>
    {#each model.species as species, i (species.name)}
      <div class="species-section">
        <h3>{species.name}</h3>
        {#if species.counts === null}
          <p>{species.empty ?? "Loading species…"}</p>
        {:else}
          <!-- V4 fix (owner phone report, 2026-09-24): caption moved above the scroll container --
               see report.css's `.table-caption` header for why. -->
          <p class="table-caption" id={`species-counts-caption-${i}`}>{species.caption}</p>
          <!-- V5 fix (Opus eyes-on: the counts table hid columns with no scroll cue) --
               `data-scrollable` and the `.scroll-hint` sibling right below are both driven by the
               REAL measured overflow (scrollAffordance.ts), never a guess at column count. -->
          <div
            class="table-scroll"
            data-scrollable={countsOverflow[i] ? "true" : "false"}
            use:scrollAffordance={{ onOverflow: (v) => setCountsOverflow(i, v) }}
          >
            <table
              class="counts-table"
              aria-labelledby={`species-counts-caption-${i}`}
              aria-describedby={`species-summary-${i}`}
            >
              <thead>
                <tr>
                  <th scope="col">Category</th>
                  {#each species.counts.columns as col (col)}
                    {@const parts = erColumnParts(col)}
                    <th scope="col" class="num" aria-label={col}
                      >{parts.code}{#if parts.weight}<br /><span class="er-weight"
                          >{parts.weight}</span
                        >{/if}</th
                    >
                  {/each}
                  <th scope="col" class="num">Total</th>
                </tr>
              </thead>
              <tbody>
                {#each species.counts.rows as row (row.category)}
                  <tr>
                    <th scope="row">{categoryLabel(row.category)}</th>
                    {#each row.counts as c, j (j)}
                      <td class="num">{formatCount(c)}</td>
                    {/each}
                    <td class="num">{formatCount(row.total)}</td>
                  </tr>
                {/each}
                <tr>
                  <th scope="row">Total</th>
                  {#each species.counts.totalRow.counts as c, j (j)}
                    <td class="num">{formatCount(c)}</td>
                  {/each}
                  <td class="num">{formatCount(species.counts.totalRow.total)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <!-- must stay the IMMEDIATE next sibling of the .table-scroll div above -- report.css's
               `+ .scroll-hint` selector is what keeps this hidden when the table already fits. -->
          <p class="scroll-hint" aria-hidden="true">Scroll right for more columns &rarr;</p>

          {#if species.top}
            <!-- V4 fix (owner phone report, 2026-09-24, phone-15): caption moved above the scroll
                 container -- see report.css's `.table-caption` header for why (this is the exact
                 caption that used to read "…habitat-weighted exti" clipped mid-word). -->
            <p class="table-caption" id={`species-top-caption-${i}`}>
              Top 20 highest-scoring species (by habitat-weighted extinction risk).
            </p>
            <div class="table-scroll">
              <table aria-labelledby={`species-top-caption-${i}`}>
                <thead>
                  <tr>
                    <th scope="col">Category</th>
                    <th scope="col">Common</th>
                    <th scope="col">Scientific</th>
                    <th scope="col">ER code</th>
                    <th scope="col" class="num">ER score</th>
                    <th scope="col" class="num">Score</th>
                  </tr>
                </thead>
                <tbody>
                  {#each species.top.rows as row, j (row.mdl_key)}
                    <tr>
                      <td>{categoryLabel(row.sp_cat)}</td>
                      <td>
                        {#if row.sp_common}
                          <!-- P round V5 fix (Opus eyes-on desktop-15: lowercase "great hammerhead
                               shark"/"sicklefin devil ray") -- DISPLAY only; the href below still
                               keys on row.mdl_key, never this sentence-cased text. -->
                          <a href={species.top.hrefs[j]}>{formatCommonName(row.sp_common)}</a>
                        {:else}
                          —
                        {/if}
                      </td>
                      <td><em>{row.sp_scientific}</em></td>
                      <td>{row.er_code ?? "—"}</td>
                      <td class="num"
                        >{row.er_score === null ? "—" : formatErScore(row.er_score)}</td
                      >
                      <td class="num">{formatCount(row.suit_er_area)}</td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
          {/if}

          <p>
            <button type="button" class="no-print" onclick={() => downloadSpeciesCsvFor(i)}>
              Download full species list (CSV — {formatCount(species.counts.nSpecies)} species)
            </button>
          </p>
        {/if}
        <p id={`species-summary-${i}`} class="sr-only-note">
          {species.summary ?? ""}
          {species.top?.summary ?? ""}
        </p>
      </div>
    {/each}
  </section>

  <section aria-labelledby="s-sources">
    <h2 id="s-sources">Sources and Method</h2>
    {#each model.sources.text as p (p)}
      <p>{p}</p>
    {/each}
    <p><a href={model.sources.docsHref}>Documentation for {model.header.ver}</a></p>
    {#if model.sources.citations.length}
      <ul>
        {#each model.sources.citations as c (c.dsKey)}
          <li>
            {c.label}: {c.citation}
            {#if c.href}<a class="report-url" href={c.href}>({c.href})</a>{/if}
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  <section aria-labelledby="s-provenance" class="disclosure provenance">
    <h2 id="s-provenance">
      <button
        type="button"
        aria-expanded={provenanceOpen}
        onclick={() => (provenanceOpen = !provenanceOpen)}
      >
        Provenance {provenanceOpen ? "▾" : "▸"}
      </button>
    </h2>
    <div class="disclosure-body" hidden={!provenanceOpen}>
      <p>
        Release {model.provenance.ver} · {model.provenance.status ?? "—"} · {model.provenance
          .access ?? "—"}. Generated {model.provenance.generatedAt}. App {model.provenance.appSha}.
        DuckDB-WASM
        {model.provenance.duckdbWasm ?? "—"}.
      </p>
      <!-- V4 fix (owner phone report, 2026-09-24): caption moved above the scroll container -- see
           report.css's `.table-caption` header for why. -->
      <p class="table-caption" id="provenance-tables-caption">Tables read.</p>
      <div class="table-scroll">
        <table aria-labelledby="provenance-tables-caption">
          <thead>
            <tr>
              <th scope="col">Table</th>
              <th scope="col">Digest</th>
            </tr>
          </thead>
          <tbody>
            {#each model.provenance.tables as t (t.name)}
              <tr>
                <td>{t.name}</td>
                <td><code>{t.digest ?? "—"}</code></td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
      {#each model.provenance.sql as run (run.name)}
        <details>
          <summary>{run.name}.sql</summary>
          <pre>{run.sql}</pre>
        </details>
      {/each}
      <h3>Reproduce in R</h3>
      {#each model.provenance.reproduceInR as snippet, i (i)}
        <pre>{snippet}</pre>
      {/each}
    </div>
  </section>
{:else if progressDone === 0 && places.length === 0 && earlySettled}
  <!-- UI-7 (round-3 review): an empty report (no places in the link) used to be a dead end -- add
       the SAME "open the Atlas" escape hatch the populated report's header already offers, so a
       reader who lands here from a stale/malformed link has somewhere to go. -->
  <p>
    No places in this link — nothing to report on. <a
      href={ver ? `./index.html?ver=${ver}` : "./index.html"}>Open the Atlas</a
    >.
  </p>
{/if}

<style>
  .sr-only-note {
    font-size: 0.85rem;
    color: var(--text-secondary);
  }
  .attribution {
    font-size: 0.75rem;
    color: var(--text-secondary);
  }
  .export-bar {
    display: flex;
    gap: 0.5rem;
    padding: 0.75rem 0;
    flex-wrap: wrap;
  }
  .export-bar button {
    padding: 0.4rem 0.8rem;
    border: 1px solid var(--border-control);
    border-radius: 6px;
    background: var(--fill-control);
    cursor: pointer;
  }
</style>
