<script lang="ts">
  import Wordmark from "../lib/brand/Wordmark.svelte";
  // The hydrated shell. Reads and writes view state ONLY through src/lib/state (createSelStore ->
  // history.replaceState, never pushState -- CLAUDE.md "URL-is-the-view"; see
  // tests/shell/shell-invariants.test.ts's source-scan guard, the same technique
  // tests/state/invariants.test.ts already uses for sel.svelte.ts). The map is composed through
  // src/lib/map and nothing more; the legend and layers are the lenses' own composeStyle inputs
  // (docs/map.md).
  //
  // This file owns NO scoped CSS for the shell's own layout/topbar chrome -- it imports shell.css
  // as a plain global stylesheet (the SAME file index.html's inline critical CSS `@import`s), so
  // there is exactly one source for every geometry value the CLS gate depends on. The real
  // src/lib/ui/* components below (Rail, Panel, Sheet, Segmented, Announcer) bring their own scoped
  // styles and are used only by import.
  import { onMount, tick, type Component } from "svelte";
  import "./shell.css";
  import {
    buildRailItems,
    panelHeaderTitle,
    TOOL_BODY,
    toolTakesFullStage,
    type PanelContext,
    type ToolName,
  } from "./tools";
  import { PLACES_FLOW_TOOL, legacyToolFromParams } from "../lib/state/legacy";
  import { DETAILS_LINK_ATTR } from "../lib/map/popup";
  // R3-W8 item 3: the `ui=` token's parse/format core — see that module's own header for what it
  // carries and why it is a separate token from Sel's own query keys.
  import { formatUi, parseUi, type UiExpandedRow } from "./uiState";
  import type { LayerGroupId } from "../lib/map/layerStack";
  import Icon from "../lib/ui/Icon.svelte";
  import Rail from "../lib/ui/Rail.svelte";
  import Panel from "../lib/ui/Panel.svelte";
  import Sheet from "../lib/ui/Sheet.svelte";
  import Segmented from "../lib/ui/Segmented.svelte";
  import Announcer from "../lib/ui/Announcer.svelte";
  import Toast from "../lib/ui/Toast.svelte";
  import Honeycomb from "../lib/ui/Honeycomb.svelte";
  import LegendChip from "../lib/ui/LegendChip.svelte";
  import { announce, notify } from "../lib/ui/announcer";
  // V3 (Ben's report, 2026-09-24): titiler-v8/the API going dark for an hour with a perfectly
  // normal-looking, raster-less map -- src/lib/health/* is the probe state machine (Svelte-free,
  // per tests/state/invariants.test.ts's gate); createHealthStore is this file's own reactive
  // wrapper around it (co-located here, not under src/lib, for the same reason
  // src/lens/species/state.svelte.ts is co-located with its lens).
  import HealthBanner from "../lib/ui/HealthBanner.svelte";
  import { createHealthStore } from "./health.svelte";
  // R2 (docs/usability.md §7): About + Feedback + the phone ⋯ menu -- a NEW component, so this
  // file's own change is one mount line (see the template below) while U5/U6 touch the rail and
  // the Report/Help/theme controls in parallel. See TopBarActions.svelte's own header.
  import TopBarActions from "./TopBarActions.svelte";
  import {
    DEFAULT_PANEL_GEOMETRY,
    loadPanelGeometry,
    viewportBucket,
    type PanelGeometry,
  } from "../lib/ui/panelGeometry";
  import {
    DEFAULT_SHEET_DETENT,
    legendChipMode,
    loadSheetDetent,
    type SheetGeometry,
  } from "../lib/ui/sheetGeometry";
  import { createSelStore } from "../lib/state/sel.svelte";
  import { formatSel } from "../lib/state/codec";
  import {
    DEFAULT_SEL,
    INSTANCE_LENS,
    LENSES,
    defaultOut,
    resolveTheme,
    type LayerStackEntry,
  } from "../lib/state/types";
  import { createMap, type MapHandle } from "../lib/map/map";
  import { composeStyle, BASEMAP_LAYER_PREFIX } from "../lib/map/style";
  // R3 (round-2 plan §5 U4): the layer stack — resolved here (the SAME resolved object both
  // `composeStyleInput` and each lens's `LayersPanel` mount read, per this task's own instructions
  // to keep Shell.svelte's edits to exactly "the panel mount and the composeStyle input").
  import { defaultLayerStackEntries, isDefaultLayerStack } from "../lib/map/layerStack";
  import {
    warmBasemapStyles,
    BASEMAP_ATTRIBUTION,
    type CartoStyleLike,
  } from "../lib/map/layers/basemap";
  import { BRAND_CREDIT, BRAND_NAME, RELEASE, REPO } from "../lib/brand/instance";
  // build week 4: the instance module table (scripts/instance-modules.mjs). Each export is the module
  // this instance builds, a loader for it, or `null`: the Collections lens and its place summaries are
  // eager (their map inputs exist before any panel mounts); the Scores lens, the Report tool and the
  // release registry are lazy. A `null` module is never bundled.
  import {
    createCollectionLens,
    createPlaceSummaries,
    loadCollection,
    loadRelease,
    loadReport,
    loadScores,
  } from "virtual:instance-modules";
  import {
    FALLBACK_FULL_STUDY_AREA,
    studyAreaFromBoot,
    type StudyArea,
  } from "../lib/map/interaction";
  import { MST_SPECIES_VER, loadMstBoot } from "../lib/release/mst";
  import {
    INITIAL_AREA_CAMERA_STATE,
    phoneDefaultCamera,
    shouldFlyToArea,
    symmetricPadding,
    type AreaCameraState,
    type ChromePadding,
    type Viewport,
  } from "../lib/map/camera";
  import { fitReserve, insideStage, livePadding } from "../lib/map/livePadding";
  import {
    desktopPanelPadding,
    phonePadding,
    phoneLiveChromePadding,
  } from "../lib/map/chromePadding";
  import { createAnalytics } from "../lib/analytics/analytics";
  import { analyticsLogUrl } from "../lib/analytics/logUrl";
  import { analyticsGaId } from "../lib/analytics/gaId";
  // atlas-8 Deliverable 4 (beta feedback, zero backend -- CLAUDE.md/GATES.md's "the CalCOFI
  // zero-backend fallback"): both pure functions take a snapshot the caller builds -- neither ever
  // reads `location`/`window.location` itself (tests/feedback/noHash.test.ts's source-scan gate).
  import {
    feedbackIssueUrl,
    pageUrlFromLocation,
    type FeedbackContext,
  } from "../lib/feedback/issueUrl";
  // atlas-5: the species lens. Shell owns WHERE it mounts (the "layers" panel body, the topbar
  // search field, a legend region over the map) and the ONE composeStyle call; the lens owns what
  // to draw (docs/map.md / this file's own header comment). `state.svelte.ts` is the lens' pure
  // DATA/wiring layer (CLAUDE.md: "keep core logic in an exported function... a component calls
  // it") -- it never imports a `.svelte` file itself, so it stays a static import even though every
  // lens PANEL component below is now lazy (see "lazy lens/panel chunks" below).
  import { createSpeciesLens } from "../lens/species/state.svelte";
  // the Collections lens' reactive core (catalog -> collection -> item -> hex feature state) comes from
  // the instance module table above (eager, for the same reason as the species lens: its map inputs
  // must exist whether or not its panel, a lazy chunk below, has ever mounted). hyparquet stays a lazy
  // chunk INSIDE it (lib/catalog/values.ts).
  import { searchForAccess, viewAccess } from "../lib/catalog/access";
  // atlas-6 step 1: the Places panel mounts here (the shell's one reserved panel slot); it never
  // touches MapLibre directly -- `placesMap` is the reactive bridge this file's own composeStyle
  // effect (below) folds into the ONE `selection` input, per docs/map.md. `placesMap.svelte.ts` is
  // the reactive STORE (plain runes, no `.svelte` component inside it) and stays static for the
  // same reason `state.svelte.ts` does above: `placesSelection` (below) reads it unconditionally,
  // even when the Places PANEL itself (`../places/Places.svelte`, lazy) has never been opened.
  import { createPlacesMapStore } from "../places/placesMap.svelte";
  // WP4: summaries of the current item over the places, and the "Only inside places" filter (the lens
  // below reads `summaries.insideFids`): `createPlaceSummaries`, eager with the Collections lens in the
  // module table (a `?filter=places` link has to dim the map without any panel open); every heavy part
  // (hyparquet, the g1 codec, the place index) stays lazy inside it.
  // The Download menu -- `places/model.ts#placesFromHash` (never a second parser of `sel.pl`)
  // gives it the current places list for "Selected places · GeoJSON"'s enabled/disabled state, and
  // the Places tab's header its count.
  //
  // 0.10.79 size-budget fix round: `places/model.ts` pulls in the FULL `geo/placeCodec.ts` (the
  // g1 codec, incl. `simplify.ts`'s Douglas-Peucker + `unwrap.ts`) as a VALUE import -- that whole
  // chunk was landing on the static critical path (`placeCodec-*.js` in `size-budget.mjs`'s own
  // static-file list) because this file imported `addPlace`/`hashFromPlaces`/`placesFromHash`
  // statically, even though none of it is needed before the Places tab/Download menu/"Add to
  // places" click ever happens. Type-only import here (erased at build time); the runtime module
  // loads through `loadPlacesModel()` below, a dynamic import cached behind a `$state`.
  import type {
    addPlace as AddPlaceFn,
    hashFromPlaces as HashFromPlacesFn,
    placesFromHash as PlacesFromHashFn,
  } from "../places/model";
  // type-only (erased at build time) -- DownloadMenu.svelte's RUNTIME module is loaded dynamically
  // (see `openDownload()`, below, and that file's own "LAZY" header note): its map-capture/SVG/
  // COG-fetch logic pushed the static "before first interaction" budget to 449.9/450.0 KB gzip
  // when statically imported (measured) -- a download is never needed before first interaction,
  // the exact case `scripts/size-budget.mjs`'s rule exists for.
  import type DownloadMenu from "./DownloadMenu.svelte";
  import type { ResolvedTheme, ZoneUnitSpec } from "../lib/map/types";
  // the tour's step DATA (tour.ts, no driver.js) is small and dependency-free, so it stays an
  // ordinary static import; only the TOUR RUNTIME (tourRuntime.ts, which imports driver.js) is a
  // dynamic import() -- see `beginTour()` below and that file's own header.
  import { tourStepsForLens, type TourActions } from "./tour";
  import { LENS_LABEL } from "./lenses";
  import type { Lens } from "../lib/state/types";

  const selStore = createSelStore(location);
  const sel = selStore.sel;

  // R3-W8 item 3: a shared link's `ui=` token (Share's own writer, `onShare` below) — parsed ONCE,
  // synchronously, from the page's initial query string, so every chrome piece it restores
  // (`activeTool`, `expandedRow` below; `panelGeom`/`sheetGeom`'s own initial overrides, passed to
  // `<Panel>`/`<Sheet>` further down) gets its restored value from the very first render this
  // component makes — never a later `$effect` that would repaint after a visible default flash.
  // `ui=` is NEVER read again after this (no `$effect` watches `location.search` for it) and is
  // never written by `history.replaceState` (`selStore`/`formatSel` do not know it exists) — U1's
  // rule ("layout is chrome, never the URL") holds for every ORDINARY interaction exactly as
  // before; only Share's own one-shot link build touches this token at all.
  const initialUi = parseUi(new URLSearchParams(location.search).get("ui"));

  // V3: created once, up front -- trigger (a) (boot) fires from the `early.version` onMount below,
  // trigger (b) (a real tile failure) from the map's own onMount, trigger (c) from the banner's
  // Retry. It never polls on its own (brief: "Do not poll continuously while everything is fine").
  const health = createHealthStore();

  // the privacy-safe analytics module, OFF unless configured: with no `VITE_GA_ID` / `VITE_LOG_URL`
  // at build time `track()` is a no-op (docs/analytics.md).
  const analytics = createAnalytics({
    appVersion: __APP_VERSION__,
    preview: false,
    logUrl: analyticsLogUrl(),
    measurementId: analyticsGaId(),
  });

  // --- theme: the SAME rule as index.html's pre-paint script, kept live afterward -------------
  let prefersDark = $state<boolean | null>(null);
  onMount(() => {
    let mql: MediaQueryList | undefined;
    try {
      mql = matchMedia("(prefers-color-scheme: dark)");
      prefersDark = mql.matches;
      const onChange = (e: MediaQueryListEvent) => (prefersDark = e.matches);
      mql.addEventListener("change", onChange);
      return () => mql?.removeEventListener("change", onChange);
    } catch {
      prefersDark = null; // resolveTheme treats "unavailable" as navy, same as the pre-paint script
    }
  });
  const resolvedTheme = $derived(resolveTheme(sel.theme, prefersDark));
  $effect(() => {
    document.documentElement.dataset.theme = resolvedTheme;
  });
  function toggleTheme() {
    selStore.set({ theme: resolvedTheme === "navy" ? "light" : "dark" });
  }

  // --- phone breakpoint: spec.md §10's ONE matchMedia switch, no separate route or bundle ------
  let isPhone = $state(false);
  onMount(() => {
    const mql = matchMedia("(max-width: 899px)");
    isPhone = mql.matches;
    const onChange = (e: MediaQueryListEvent) => (isPhone = e.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  });

  // --- the tool rail: FOUR controls, the same four, in the same order, on every viewport and
  // every lens (R3-W8 item 4: "drop the Flower plot from the toolbar" -- it moved into the Layers
  // pane as that pane's own second tab, below). "activeTool" is chrome (which panel is open), not
  // URL view state.
  // R3-W8 item 3: restored from a shared link's `ui=` token when present (`initialUi`, above) —
  // "layers" (unchanged) otherwise.
  // a legacy `?tool=flower` / `?tool=report` (legacy.ts) opens Details / Places when no `ui=`
  // token supplied a tool.
  let activeTool = $state<ToolName>(
    initialUi?.tool ?? legacyToolFromParams(new URLSearchParams(location.search)) ?? "layers",
  );
  const railItems = $derived(buildRailItems());

  // the panel/sheet header says what is being SHOWN, not the spine entry's name --
  // `panelHeaderTitle` (tools.ts, unit-tested) is the one rule; the context it reads is assembled
  // below, where `phoneLegend` and `places` exist.

  // R3-W8 item 3: the Layers pane's own expanded row (`LibLayersPanel`'s controlled-row-expansion
  // pair) — lifted here (rather than left as that component's own internal state) so Share can read
  // it and a `ui=` link can restore it, matching `activeTool`'s own "chrome, restorable from a
  // link, never ordinary URL state" treatment. "data-raster" (the Data row) is the same default
  // `LayersPanel.svelte`'s own internal state used before this existed.
  // a shared link's `null` ("nothing expanded", `ui=...n`) must stay null: `??` would turn it back into the
  // default (the Data row open), so a collapsed arrangement never survived a share
  let expandedRow = $state<LayerGroupId | null>(initialUi ? initialUi.expandedRow : "data-raster");

  // fix list #5 (SC 2.4.3), WEBKIT ONLY: activating a rail tool that CHANGES the open tool drops
  // `document.activeElement` to `<body>` roughly 100ms later, once the newly-chosen tool's lazy
  // panel chunk resolves and the panel body swaps -- chromium and firefox never do this. Not
  // traced to one line inside that swap; instead of re-focusing once at a single known instant
  // (too early: the import has not resolved yet), a MutationObserver on `#panel-region` restores
  // focus to the rail button the user actually activated WHENEVER a mutation settles there, for
  // as long as this tool activation is still "pending" -- and only while focus has actually been
  // lost to `<body>` in the meantime, so a user who has since Tabbed into the panel on purpose is
  // never overridden (Panel.svelte's own collapse()/restore() re-establish focus the same way,
  // just for a swap that happens synchronously rather than on an async import's own schedule).
  let panelRegionEl: HTMLDivElement | undefined;
  // usability M3: the desktop `<Panel>` instance, bound below -- `selectTool()` calls its exported
  // `expand()` (the same instance-method pattern `Toast.svelte`'s own `push()` uses) so a rail
  // click always un-collapses it. Undefined on the phone, where `<Sheet>` renders instead.
  let panelRef = $state<ReturnType<typeof Panel> | undefined>(undefined);
  // R1: Panel.svelte is the source of truth for its own dock/size/maximized geometry (this shell
  // never sets it) -- it reports every change through `ongeometry`, and THIS mirror is what lets
  // shell.css position `#panel-region` (data-dock/data-maximized/`--panel-size`, below), per this
  // file's "the shell owns WHERE it floats" convention (docs/map.md's sibling rule for the map).
  let panelGeom = $state<PanelGeometry>(DEFAULT_PANEL_GEOMETRY);
  // P1 fix: Sheet.svelte's own mirror of `panelGeom` above -- its `ongeometry` reports the
  // sheet's current detent + REAL measured height (svh-based CSS, not a number this shell could
  // otherwise know), which is what lets the floating legend chip track the sheet's actual top
  // edge (`legendChipMode`, `.legend-chip-region`'s `--legend-chip-sheet-height`, below) instead
  // of sitting at a fixed offset that used to land on the sheet's own header controls at "peek"
  // and the last table row at "half" (Ben's phone report, 2026-09-24).
  let sheetGeom = $state<SheetGeometry>({ detent: DEFAULT_SHEET_DETENT, height: 0 });
  let railFocusObserver: MutationObserver | undefined;
  let railFocusDeadline = 0;
  // the observer below is created ONCE and lives for the shell's whole lifetime; this is what it
  // reads on every mutation, so a LATER call to armRailFocusRestore (a second tool switch) always
  // retargets the SAME observer rather than being silently ignored by an `if (railFocusObserver)`
  // early-return that would otherwise freeze it on whichever tool was activated first.
  let railFocusTarget: string | null = null;

  function focusRailButton(name: string): void {
    const label = railItems.find((i) => i.name === name)?.label;
    if (!label) return;
    const btn = document.querySelector<HTMLButtonElement>(
      `#rail-region button.railitem[aria-label="${CSS.escape(label)}"]`,
    );
    btn?.focus();
  }

  function armRailFocusRestore(name: string): void {
    railFocusTarget = name;
    railFocusDeadline = Date.now() + 1500;
    if (railFocusObserver || !panelRegionEl) return;
    railFocusObserver = new MutationObserver(() => {
      if (!railFocusTarget || Date.now() > railFocusDeadline) return;
      const active = document.activeElement;
      // measured on webkit: giving `#rail-region` its own `tabindex="-1"` (fix list #6) changed
      // WHERE this exact focus loss lands -- instead of falling all the way back to `<body>`, it
      // now settles on the nearest ancestor that IS focusable, `#rail-region` itself (the nav).
      // Both are "focus was lost, not deliberately moved" for this purpose.
      if (active === document.body || active?.id === "rail-region") {
        focusRailButton(railFocusTarget);
      }
    });
    railFocusObserver.observe(panelRegionEl, { childList: true, subtree: true });
  }

  onMount(() => {
    panelRegionEl = (document.getElementById("panel-region") as HTMLDivElement | null) ?? undefined;
    return () => railFocusObserver?.disconnect();
  });

  // R4-B: a click on a spine entry -- the ACTIVE one collapses the panel (the rail stays), any other
  // opens it. Desktop only: the phone's bottom bar keeps its sheet detents (`selectTool` alone).
  function onRailSelect(name: string) {
    if (!isPhone && name === activeTool && !panelGeom.collapsed) {
      armRailFocusRestore(name);
      void panelRef?.collapse(false);
      return;
    }
    selectTool(name);
  }

  function selectTool(name: string) {
    activeTool = name as ToolName;
    armRailFocusRestore(name);
    // usability M3: a rail click used to leave a collapsed desktop panel collapsed -- only the
    // pill's own label changed, so the tool the user just chose never actually rendered.
    // `panelRef` is undefined on the phone (Sheet.svelte has no collapsed state to un-collapse).
    panelRef?.expand();
  }

  // --- top bar: lens switch, search, Share / Help / theme --------------------------------------
  // the lens switch shows the lenses this instance builds (`LENSES`, instance.json `lenses`), in order,
  // labelled by `LENS_LABEL` (./lenses.ts)
  function onLensChange(value: string) {
    const lens = (LENSES as readonly string[]).includes(value) ? (value as Lens) : INSTANCE_LENS;
    // `out`'s default is per lens (state/types.ts `defaultOut`): an explicit lens switch also resets
    // it to the new lens' default, or the previous lens' default would linger and be written to the
    // link as if chosen (MarineSensitivity/atlas; a no-op where the instance draws no zones)
    selStore.set({ lens, out: defaultOut(lens) });
  }

  // R3-W8 item 3 (Ben, 2026-09-25): "when clicking Share, the link should include all the same UI
  // elements in their arrangement, eg on Layers pane." Everything ELSE Ben's example names (the
  // species input, its representation, the zoom-to-layer preference) is already ordinary `Sel`
  // query state by the time Share is clicked — `location.href` already carries it, same as
  // `unit`/`lyr`/`pal` for the scores lens. This appends ONLY the chrome `ui=` covers (see
  // `uiState.ts`'s own header): built fresh, here, from the shell's own live state — never written
  // by `selStore`/`history.replaceState`, so an ordinary drag/dock/tab change never touches the URL
  // (U1's rule, unchanged).
  // `expandedRow` (the shared Layers-pane row expander) is typed as the WIDER `LayerGroupId | null`
  // (it is also handed straight to `LibLayersPanel`'s `onExpandedRowChange`, which reports any
  // group id) even though only "data-raster"/"data-zones" are ever actually expandable rows
  // (`LayersPanel.svelte`'s own `EXPANDABLE_ROW_IDS`) — `uiState.ts`'s `UiExpandedRow` is the
  // narrower two-value shape the `ui=` token actually encodes, so this narrows explicitly rather
  // than widening the token's own type to match.
  function toUiExpandedRow(id: LayerGroupId | null): UiExpandedRow {
    return id === "data-raster" ? id : null;
  }

  function shareUrl(): string {
    const url = new URL(location.href);
    url.searchParams.set(
      "ui",
      formatUi({
        tool: activeTool,
        dock: panelGeom.dock,
        size: panelGeom.size,
        detent: sheetGeom.detent,
        expandedRow: toUiExpandedRow(expandedRow),
      }),
    );
    return url.toString();
  }

  async function onShare() {
    try {
      await navigator.clipboard.writeText(shareUrl());
      notify("Link copied to your clipboard.");
    } catch {
      notify("Couldn't copy the link automatically — copy it from the address bar.", {
        tone: "error",
      });
    }
  }

  // --- Help menu (U6, round 2) ---------------------------------------------------------------------
  // A non-modal disclosure (Popover.svelte's own dismiss-on-outside-click/Esc pattern, inlined here
  // rather than reused verbatim: Popover.svelte renders its OWN small round trigger button, and this
  // menu's trigger is the EXISTING top-bar "Help" button instead of a second, nested one). Tour,
  // keyboard shortcuts and a docs link; "Report a problem" stays bottom-left for now (U3 moves it).
  // Deliberately NOT a <dialog>/Modal.svelte: a modal's top-layer + focus trap would block the rest
  // of the page, and e2e/shell.a11y.spec.ts's interaction walk clicks Help and then every rail tool
  // in the same test -- a blocking modal left open would break that walk for no functional reason
  // (a menu, unlike a welcome/version dialog, is not meant to demand attention).
  let helpOpen = $state(false);
  let helpTriggerEl: HTMLButtonElement | undefined;
  let helpMenuEl: HTMLDivElement | undefined;

  function onHelp() {
    helpOpen = !helpOpen;
    if (helpOpen) analytics.track("open_help", {});
  }

  function closeHelp(returnFocus = true) {
    if (!helpOpen) return;
    helpOpen = false;
    if (returnFocus) helpTriggerEl?.focus();
  }

  function handleHelpDocumentPointerdown(event: PointerEvent) {
    if (!helpOpen) return;
    const target = event.target as Node;
    if (helpMenuEl?.contains(target) || helpTriggerEl?.contains(target)) return;
    helpOpen = false; // dismissed by clicking elsewhere -- focus was already elsewhere
  }

  // LOCAL, not document-level, for the same reason Popover.svelte's identical handler is: the
  // innermost open layer handles Esc first, before it can bubble to an ancestor's own Escape
  // handling (e.g. an enclosing Panel collapsing itself). Attached IMPERATIVELY, not a template
  // `onkeydown` on the (non-interactive) menu `<div>` -- Popover.svelte's own identical fix for
  // the same svelte-check a11y rule (a static element with a keydown handler needs a role a
  // plain disclosure region should not claim).
  function handleHelpKeydown(event: KeyboardEvent) {
    if (event.key === "Escape" && helpOpen) {
      event.preventDefault();
      event.stopPropagation();
      closeHelp();
    }
  }

  onMount(() => {
    document.addEventListener("pointerdown", handleHelpDocumentPointerdown);
    const el = helpMenuEl;
    el?.addEventListener("keydown", handleHelpKeydown);
    return () => {
      document.removeEventListener("pointerdown", handleHelpDocumentPointerdown);
      el?.removeEventListener("keydown", handleHelpKeydown);
    };
  });

  function onHelpTakeTour() {
    closeHelp(false);
    void beginTour();
  }

  // --- Tour (U6, round 2) ---------------------------------------------------------------------------
  // The step DATA (tour.ts) is a plain, dependency-free module and stays a static import above; the
  // RUNTIME (tourRuntime.ts, driver.js) is reached ONLY through this dynamic import(), so driver.js
  // never enters the static critical path (scripts/size-budget.mjs's 450 KB budget). `?tour=on`
  // (an EXPLICIT query value, checked directly -- `sel.tour` cannot distinguish that from the
  // default, both parse to "on") starts the tour once on load, same rule WelcomeModal.svelte's own
  // suppression now follows so the two overlays never stack.
  let tourActive = $state(false);

  function buildTourActions(): TourActions {
    let tourSnapshot: {
      lens: Lens;
      activeTool: ToolName;
    } | null = null;
    return {
      getLens: () => sel.lens,
      setLens: (lens) => onLensChange(lens),
      selectTool: (name) => selectTool(name),
      snapshot: () => {
        tourSnapshot = { lens: sel.lens, activeTool };
      },
      restore: () => {
        if (!tourSnapshot) return;
        if (sel.lens !== tourSnapshot.lens) onLensChange(tourSnapshot.lens);
        activeTool = tourSnapshot.activeTool;
        tourSnapshot = null;
      },
    };
  }

  async function beginTour() {
    if (tourActive) return;
    tourActive = true;
    const lens = sel.lens;
    const { startTour } = await import("./tourRuntime");
    const steps = tourStepsForLens(lens);
    const actions = buildTourActions();
    analytics.track("tour_start", { lens });
    startTour(steps, actions, {
      onStep: (step, index) => analytics.track("tour_step", { lens, step: step.id, index }),
      onEnd: (completed) => {
        analytics.track("tour_end", { lens, completed });
        tourActive = false;
      },
    });
  }

  onMount(() => {
    let explicitTourOn = false;
    try {
      explicitTourOn = new URLSearchParams(location.search).get("tour") === "on";
    } catch {
      /* location.search unavailable -- treat as absent, never as an error */
    }
    if (!explicitTourOn) return;
    // a beat for the shell's own first paint to settle before the tour overlay appears -- the
    // same reasoning tourRuntime.ts's BEFORE_SETTLE_MS uses between steps, just once, up front.
    const t = setTimeout(() => void beginTour(), 400);
    return () => clearTimeout(t);
  });

  // --- the release: the instance's registry, or the pinned MST release the Species lens reads -----
  // An instance with `release` (instance.json) resolves its release before any bundle parses: the
  // build writes the inline early-fetch script into index.html (`<!--instance:early-fetch-->`,
  // scripts/instance.mjs), which leaves its results on `window.__early` as promises -- the version
  // this host may render (the access gate, fail closed), its data base, versions.json, session.json,
  // the manifest and app/boot.json. The shell only ever READS those, never re-derives them.
  // An instance without one (OceanMetrics Atlas: no latest.txt / versions.json / session.json) has
  // the Species lens read one fixed MarineSensitivity release (`lib/release/mst.ts`) until the MST
  // collections are read through the STAC catalog.
  interface Early {
    version: Promise<string | null>;
    base?: Promise<string | null>;
    boot?: Promise<unknown>;
    manifest?: Promise<unknown>;
    versions?: Promise<EarlyVersionRow[] | null>;
    denied?: Promise<{ ver: string; reason: string } | null>;
    session?: Promise<{ preview: boolean }>;
  }
  // structurally the `versions.json` row `lib/release/access.ts` reads (`VersionRow`)
  interface EarlyVersionRow {
    ver?: string;
    status?: string;
    access?: string;
    released?: string;
  }
  let earlyVersion = $state<string | null>(RELEASE ? null : MST_SPECIES_VER);
  let boot = $state<unknown>(null);
  let manifest = $state<unknown>(null);
  let versions = $state<EarlyVersionRow[] | null>(null);
  let denied = $state<{ ver: string; reason: string } | null>(null);
  let versionPickerOpen = $state(false);
  function onVersionClick() {
    versionPickerOpen = true;
  }
  onMount(() => {
    // V3 trigger (a): the tiler origin is a fixed constant -- no need to wait on anything resolving
    // first; the data origin is probed once the release is known.
    health.probeTiler();
    if (!__RELEASE__) {
      health.probeData(MST_SPECIES_VER);
      // boot.json carries the species lens' dataset index and palettes; a missing/404 boot leaves
      // `boot` null and the species lens degrades (never an error).
      void loadMstBoot(MST_SPECIES_VER).then((b) => (boot = b));
      return;
    }
    const early = (window as unknown as { __early?: Early }).__early;
    early?.version
      .then((v) => {
        earlyVersion = v;
        // probe the SAME resolved base index.html's own fetch of app/boot.json used
        if (v) {
          const base = early.base ?? Promise.resolve(null);
          base.then((b) => health.probeData(v, b ?? undefined)).catch(() => health.probeData(v));
        }
      })
      .catch(() => {});
    early?.boot?.then((b) => (boot = b)).catch(() => {});
    early?.manifest?.then((m) => (manifest = m)).catch(() => {});
    early?.versions?.then((v) => (versions = v)).catch(() => {});
    // a denied version (the public host + ?ver=v9) opens the picker so the "why" is visible
    early?.denied
      ?.then((d) => {
        denied = d;
        if (d) versionPickerOpen = true;
      })
      .catch(() => {});
    // `analytics` was built with `preview: false` before the session answered: correct it now
    early?.session?.then((s) => analytics.updatePreview(s.preview === true)).catch(() => {});
  });

  // the lazy instance modules (the module table): each loads once, right after mount, when this
  // instance builds it; `null` until then (and always, for an instance that does not)
  type CollectionModule = Awaited<ReturnType<NonNullable<typeof loadCollection>>>;
  type ScoresModule = Awaited<ReturnType<NonNullable<typeof loadScores>>>;
  type ReportModule = Awaited<ReturnType<NonNullable<typeof loadReport>>>;
  type ReleaseModule = Awaited<ReturnType<NonNullable<typeof loadRelease>>>;
  let collectionMod = $state<CollectionModule | null>(null);
  let scoresMod = $state<ScoresModule | null>(null);
  let reportMod = $state<ReportModule | null>(null);
  let releaseMod = $state<ReleaseModule | null>(null);
  onMount(() => {
    loadCollection?.()
      .then((m) => (collectionMod = m))
      .catch(() => announceChunkFailure("the collections lens"));
    loadScores?.()
      .then((m) => (scoresMod = m))
      .catch(() => announceChunkFailure("the scores lens"));
    loadReport?.()
      .then((m) => (reportMod = m))
      .catch(() => announceChunkFailure("the report tool"));
    loadRelease?.()
      .then((m) => (releaseMod = m))
      .catch(() => announceChunkFailure("the release"));
  });

  // --- the map (atlas-map): mounted under the panels, one MapLibre instance ---------------------
  // This component NEVER touches MapLibre directly and never calls addLayer/setStyle: it computes
  // composeStyle() inputs and hands the result to the handle (docs/map.md). Every lens does the
  // same.
  let mapEl = $state<HTMLDivElement | undefined>(undefined);
  let mapHandle = $state<MapHandle | undefined>(undefined);
  // WP13: the stage's size (a ResizeObserver on #map) and whether a pointer is held down anywhere --
  // the live padding settles when a drag ends, never on every pointermove of a panel/sheet resize,
  // so the globe does not chase the pane (the obis-hex rule). `padEase` is false until the map's
  // first `load`: the first view is set, not eased.
  let stageW = $state(0);
  let stageH = $state(0);
  let stageTop = $state(0); // px from the viewport top: the top bar is a row ABOVE the stage
  let pointerHeld = $state(false);
  let padEase = false;
  // 0.10.21: `selStore` deps the store's own baseline outline-restore effect reads (see
  // placesMap.svelte.ts's header) -- unconditional/eager, same as `createSpeciesLens` above, so a
  // deep-linked selected place's outline restores regardless of which tool is active.
  const placesMap = createPlacesMapStore({
    selStore,
    mapHandle: () => mapHandle,
    // the "Place layers" list is mounted in the Layers panel of BOTH lenses, so `?ov=` works in either
  });

  // atlas-5: the species lens' reactive core. A plain call, not a component -- state.svelte.ts's
  // own header explains why (the same "wiring only, rules live in plain modules" split
  // src/lib/state/sel.svelte.ts already documents). `mapHandle`/`boot` are read through getters so
  // the closures below always see the CURRENT value, not the one captured at this call site (both
  // settle asynchronously, after this line runs).
  const speciesLens = createSpeciesLens({
    selStore,
    ver: () => earlyVersion,
    boot: () => boot,
    mapHandle: () => mapHandle,
    track: (name, params) => analytics.track(name as never, params as never),
    // V1 fix: the species camera's model-bounds fit pads for whatever chrome is covering the map
    // RIGHT NOW (see currentChromePadding's own header, below) instead of a flat 40px on every
    // edge -- a getter, called fresh on every fit, never a value captured at this line.
    chromePadding: () => currentChromePadding(),
    // R3-rr fix 1, round 5: a wide-range species' "US waters"/"Whole range" camera needs the
    // CURRENT viewport dimensions (`phoneAwareWideRangeBounds`/`boundsToCameraView`, both in
    // `lib/map/camera.ts`) -- read fresh on every call, never a captured snapshot. `isPhone` is
    // the SAME `matchMedia` breakpoint state this file already tracks (above), never a second
    // decision.
    viewport: () => ({ width: window.innerWidth, height: window.innerHeight }),
    isPhone: () => isPhone,
  });

  // the Collections lens: a plain call like the species lens above, when this instance builds it (the
  // module table's `createCollectionLens`; `null` otherwise, and every read below is null-safe). A
  // place pick/draw session owns map clicks while it is active (`placesMap.interactionOwned`), so a
  // hex click never fights it.
  type CollectionLens = ReturnType<NonNullable<typeof createCollectionLens>>;
  type PlaceSummaries = ReturnType<NonNullable<typeof createPlaceSummaries>>;
  const collectionLens: CollectionLens | null = createCollectionLens
    ? createCollectionLens({
        selStore,
        mapHandle: () => mapHandle,
        isOwned: () => placesMap.interactionOwned,
        chromePadding: () => currentChromePadding(),
        insideFids: (): ReadonlySet<number> | null => summaries?.insideFids ?? null,
      })
    : null;
  // WP4: one row per place for the CURRENT item (Places pane, Table tool) + the inside-places set
  const summaries: PlaceSummaries | null =
    createPlaceSummaries && collectionLens
      ? createPlaceSummaries({ selStore, lens: collectionLens, placesMap })
      : null;

  // the Scores lens' map-input store (raster, overlays, zone fills, selection, the floating legend),
  // instantiated whenever `(__LENS_SCORES__ && sel.lens === "scores")`, regardless of whether its panel ever mounts (the
  // MarineSensitivity/atlas 0.10.21 rule: map inputs belong to a lens-level store, the panel renders
  // UI only). `null` until the lazy module resolves; every read below is null-safe.
  let scoresLens = $state<ReturnType<ScoresModule["createScoresLens"]> | null>(null);
  $effect(() => {
    if (!__LENS_SCORES__ || sel.lens !== "scores" || scoresLens || !scoresMod) return;
    scoresLens = scoresMod.createScoresLens({
      selStore,
      boot: () => boot,
      manifest: () => manifest,
      ver: () => earlyVersion,
      mapHandle: () => mapHandle,
      chromePadding: () => currentChromePadding(),
    });
  });

  // --- page title: the ONE writer (tests/shell/documentTitle.test.ts's source scan pins that) -------
  $effect(() => {
    document.title =
      sel.lens === "species" && speciesLens.docTitle
        ? speciesLens.docTitle
        : __LENS_COLLECTION__ && sel.lens === "collection" && collectionLens?.itemTitle
          ? `${collectionLens.itemTitle} · ${BRAND_NAME}`
          : `${LENS_LABEL[sel.lens]} · ${BRAND_NAME}`;
  });

  // 0.10.79 size-budget fix round: the RUNTIME `places/model.ts` module (see the type-only import
  // above), loaded once, right after mount -- same lazy-import convention as the lens chunks below. `null`
  // until it resolves; every reader below falls back to "no explicit places yet", which is the same
  // state `sel.pl` being absent already produces, so there is no new empty-state to design for.
  let placesModel = $state<{
    addPlace: typeof AddPlaceFn;
    hashFromPlaces: typeof HashFromPlacesFn;
    placesFromHash: typeof PlacesFromHashFn;
  } | null>(null);
  async function loadPlacesModel() {
    if (!placesModel) {
      const mod = await import("../places/model");
      placesModel = {
        addPlace: mod.addPlace,
        hashFromPlaces: mod.hashFromPlaces,
        placesFromHash: mod.placesFromHash,
      };
    }
    return placesModel;
  }
  $effect(() => {
    void loadPlacesModel();
  });

  // the explicit places list (`placesFromHash(sel.pl)`), decoded fresh from the URL state -- never a
  // shared cache that could silently go stale against a later `sel.pl` write. Empty until the lazy
  // `places/model.ts` module resolves.
  const places = $derived(placesModel ? placesModel.placesFromHash(sel.pl) : []);

  // --- the Report tool's subject and the Scores lens' last click (an instance that builds them) -----
  // ONE `reportSubjects()` result the Report tool's Last-clicked row and sentence and the Table's
  // subject line all read (MarineSensitivity/atlas R3-W8 item 5); `null` without the Report tool.
  const reportSubject = $derived(reportMod ? reportMod.reportSubjects(sel, places) : null);
  // the Last-clicked slot is a SCORES-lens concept only (a clicked cell/Program Area); the Species
  // lens' own map click sets a different kind of selection entirely
  const lastClickedSelection = $derived(
    __LENS_SCORES__ && sel.lens === "scores" ? (scoresLens?.selection ?? null) : null,
  );
  const lastClickedRowLabel = $derived(
    scoresMod ? scoresMod.lastClickedLabel(lastClickedSelection, boot) : null,
  );
  // the Report tool's Last-clicked row shows only a click that is not already in the list
  const reportLastClickedLabel = $derived(
    reportMod && reportMod.lastClickedInPlaces(lastClickedSelection, places)
      ? null
      : lastClickedRowLabel,
  );

  // #10 (MarineSensitivity/atlas 0.10.93): a clicked CELL encoded as a one-place `#pl=` token -- the
  // same `Cell <id>` square "Add to places" appends -- so the Report pane's Open report can report on
  // it without the user adding it first. Read from `sel.sel` itself (either lens), not the
  // Scores-only `lastClickedSelection`.
  let lastClickedCellPl = $state<string | null>(null);
  $effect(() => {
    const mod = scoresMod;
    const selection = mod ? mod.parseScoresSelection(sel.sel) : null;
    const bootNow = boot;
    if (!mod || selection?.kind !== "cell" || !bootNow) {
      lastClickedCellPl = null;
      return;
    }
    let stale = false;
    void loadPlacesModel().then((model) => {
      if (stale) return;
      const place = mod.placeFromLastClicked(selection, bootNow);
      lastClickedCellPl = place ? (model.hashFromPlaces([place]) ?? null) : null;
    });
    return () => {
      stale = true;
    };
  });

  async function onAddLastClicked() {
    const selection = lastClickedSelection;
    if (!selection || !scoresMod) return;
    const model = await loadPlacesModel();
    const place = scoresMod.placeFromLastClicked(selection, boot);
    if (!place) return;
    // appends through the SAME generic `addPlace()` every other place goes through; writes ONLY
    // `pl` (never `sel`), so the Last-clicked row keeps showing the same subject afterwards
    const result = model.addPlace(places, place);
    if (!result.ok) {
      notify(result.reason ?? "Couldn't add that to places.", { tone: "error" });
      return;
    }
    selStore.set({ pl: model.hashFromPlaces(result.places) || undefined });
    notify("Added to places.");
  }

  // the Table's "open the places" button: the Places flow's own rail entry (Report, or Places)
  function openPlacesFlow() {
    selectTool(PLACES_FLOW_TOOL);
  }

  // a link that names an h3 layer's selected hexagon (`cell=`) opens on its Cell pane, once
  onMount(() => {
    if (__LENS_COLLECTION__ && sel.lens === "collection" && sel.cell) selectTool("details");
  });

  // R4-B: the popup's "Details" link opens the Details tool. The popup is a MapLibre-owned div
  // outside Svelte, so ONE delegated click handler on `document` covers every popup of either lens.
  onMount(() => {
    const onDocClick = (e: MouseEvent) => {
      const target = e.target instanceof Element ? e.target : null;
      if (!target?.closest(`[${DETAILS_LINK_ATTR}]`)) return;
      e.preventDefault();
      selectTool("details");
    };
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  });

  // P1 fix: hoisted out of the template (it used to be a `{@const}` inline where the legend chip
  // rendered) so BOTH the floating placement and the "full" detent's inline-in-sheet placement can
  // read the SAME value without recomputing it or duplicating the lens/kind branch.
  const phoneLegend = $derived(
    sel.lens === "species"
      ? speciesLens.mapInputs.legend
      : __LENS_COLLECTION__ && sel.lens === "collection"
        ? (collectionLens?.mapInputs.legend ?? null)
        : __LENS_SCORES__ && sel.lens === "scores"
          ? (scoresLens?.mapExtra.legend ?? null)
          : null,
  );

  // the header context (`panelHeaderTitle`, tools.ts): the panel/sheet header says what is being
  // SHOWN, not the spine entry's name. Species: the model's legend title alone.
  // Scores: the layer's short legend title and the spatial unit's label ("Score · Raster cells"),
  // the last click for Details, the Table's own subject line, the last click for Report.
  const panelContext = $derived<PanelContext>({
    layer: phoneLegend?.title ?? null,
    unit:
      __LENS_SCORES__ && sel.lens === "scores" && scoresLens && scoresMod
        ? (scoresMod.unitOptions(boot).find((o) => o.value === scoresLens?.unit)?.label ?? null)
        : null,
    subject:
      sel.lens === "species"
        ? speciesLens.card?.common || speciesLens.card?.sci || null
        : __LENS_SCORES__ && sel.lens === "scores"
          ? lastClickedRowLabel
          : (collectionLens?.itemTitle ?? null),
    tableSubject:
      sel.lens === "species"
        ? speciesLens.card?.common || speciesLens.card?.sci || null
        : __LENS_SCORES__ && sel.lens === "scores"
          ? reportSubject?.kind === "places" && scoresMod
            ? scoresMod.placesSubjectHeader(reportSubject.items.length)
            : lastClickedRowLabel
          : (collectionLens?.itemTitle ?? null),
    placeCount: places.length,
    lastClicked: lastClickedRowLabel,
  });
  const panelTitle = $derived(panelHeaderTitle(activeTool, panelContext));

  // UI-1 (round 3): `<Toast>`'s own phone bottom-offset PROP -- see its mount point (below) for why
  // this is a prop, never a wrapping `<div>`. Same "rail row + sheet's real height while floating"
  // formula `.map-attribution`/`.legend-chip-region` already use (shell.css), computed in PX here
  // since Toast.svelte sets it as a literal inline style, not a `calc()` string referencing tokens
  // this component does not import (64/8 mirror `chromePadding.ts#PHONE_RAIL_ROW_PX` and
  // `tokens.css`'s `--space-2`, the SAME "estimate, not import" convention that file's own header
  // explains).
  const toastPhoneBottomOffsetPx = $derived(
    64 +
      (phoneLegend && legendChipMode(sheetGeom.detent) === "floating" ? sheetGeom.height : 0) +
      8,
  );

  // the Download menu's per-lens context -- built from data every lens ALREADY resolves (the active
  // species pill/asset), never a second read of the state against a different rule than the one
  // that actually painted the map. `phoneLegend.title` is the SAME short label the legend chip
  // already shows, reused here so the download title can never drift from what the app displays.
  // Scores: `effectiveLyr` (never raw `sel.lyr`) is the SAME fallback the lens' own `lyr` applies, so
  // the download names what the raster actually paints
  const downloadLyr = $derived(scoresMod ? scoresMod.effectiveLyr(sel.lyr, boot) : null);
  const downloadTitle = $derived(
    sel.lens === "species"
      ? (speciesLens.card?.sci ?? "Species")
      : __LENS_SCORES__ && sel.lens === "scores"
        ? (phoneLegend?.title ?? downloadLyr ?? "Score")
        : (phoneLegend?.title ?? "Layer"),
  );
  const downloadLegendStops = $derived(
    phoneLegend && "stops" in phoneLegend ? phoneLegend.stops : [],
  );
  const downloadUnit = $derived(
    __LENS_SCORES__ && sel.lens === "scores"
      ? "score"
      : phoneLegend && "unit" in phoneLegend
        ? phoneLegend.unit
        : undefined,
  );
  const downloadCogUrl = $derived.by(() => {
    if (sel.lens === "species") {
      const asset = speciesLens.mapInputs.asset;
      return asset?.type === "cog" ? asset.url : null;
    }
    if (__LENS_SCORES__ && sel.lens === "scores") {
      const layer = scoresMod?.layerByKey(boot, downloadLyr) ?? null;
      return layer ? (scoresMod?.fullSubregion(layer)?.cog ?? null) : null;
    }
    return collectionLens?.mapInputs.cogUrl ?? null;
  });
  const downloadCogDisabledReason = $derived(
    downloadCogUrl
      ? undefined
      : sel.lens === "species"
        ? (speciesLens.mapInputs.notice ?? "no surface selected for this input")
        : __LENS_SCORES__ && sel.lens === "scores"
          ? "no COG published for this metric/subregion"
          : "no COG published for this layer",
  );
  const downloadMetricOrMdlKey = $derived(
    sel.lens === "species"
      ? (speciesLens.bar?.pills.find((p) => p.active)?.mdlKey ?? null)
      : __LENS_SCORES__ && sel.lens === "scores"
        ? downloadLyr
        : null,
  );
  const downloadPlaces = $derived(placesModel ? placesModel.placesFromHash(sel.pl) : []);
  // `typeof DownloadMenu` (not `Component<any>`, unlike the other lazy chunks below) -- this is the
  // ONE lazy chunk in this file `bind:this` calls a method on (`downloadMenuRef?.openPhoneModal()`);
  // `Component<any>`'s implicit empty Exports would make `bind:this` yield a shape lacking
  // `openPhoneModal` (svelte-check error, plain `tsc` does not see it -- CLAUDE.md's own note on
  // why `npm run check` is required for a `.svelte` edit), and would also make every prop this
  // component takes (including the inline `track` callback below) implicitly `any`.
  let DownloadMenuComp = $state<typeof DownloadMenu | null>(null);
  let downloadMenuRef = $state<ReturnType<typeof DownloadMenu> | undefined>(undefined);
  let downloadAutoOpen = $state<"desktop" | "phone" | undefined>(undefined);
  // desktop: Shell.svelte's own static placeholder button (below) calls this on its FIRST click
  // only -- once `DownloadMenuComp` loads, the placeholder is gone (`{#if}`-swapped for the real
  // component) and every later desktop click is handled by `Menu.svelte`'s own trigger, inside
  // DownloadMenu.svelte, without ever calling back here. phone: TopBarActions.svelte's ⋯
  // "Download…" item calls this EVERY time (there is no persistent phone trigger to hand off to),
  // so an already-loaded component reopens its Modal directly instead of re-importing.
  function openDownload(mode: "desktop" | "phone") {
    if (DownloadMenuComp) {
      if (mode === "phone") downloadMenuRef?.openPhoneModal();
      return;
    }
    downloadAutoOpen = mode;
    import("./DownloadMenu.svelte")
      .then((mod) => (DownloadMenuComp = mod.default))
      .catch(() => announceChunkFailure("the download menu"));
  }
  // the long description of the current layer, when it says something the legend title does not:
  // `null` for species (no per-model description published); the collection lens supplies its own.
  // Scores: the layer's own long description (`boot.layers[].label`) when it says something the
  // legend title does not (MarineSensitivity/atlas R3-B5)
  const phoneLegendDescription = $derived.by<string | null>(() => {
    if (__LENS_COLLECTION__ && sel.lens === "collection")
      return collectionLens?.itemDescription ?? null;
    if (sel.lens !== "scores" || !scoresLens || !scoresMod) return null;
    const desc = scoresMod.layerByKey(boot, scoresLens.lyr)?.label ?? null;
    if (desc === null) return null;
    return desc === (phoneLegend?.title ?? null) ? null : desc;
  });
  const downloadDescription = $derived(phoneLegendDescription);

  // usability M4: "the default camera frames Canada; panel/sheet cover the study area" -- the
  // FALLBACK study area's own center+zoom never accounted for the panel/sheet's own reserved
  // space, so the point it frames could render partly or wholly BEHIND the chrome. Applied only
  // when there is no explicit `?map=` (a real, user-chosen camera is never second-guessed): reads
  // the SAME localStorage keys Panel.svelte/Sheet.svelte themselves read (chromePadding.ts), so it
  // works before either component has mounted.
  //
  // WP13 reversal: this used to shift the centre by hand (`paddedStudyAreaCenter`) and NEVER use
  // MapLibre's persisted `padding`, for fear that it would reshape every later fit. The map now
  // carries the live padding (`livePadding.ts`, applied through `handle.setPadding`, so the globe is
  // centred in the open area as well), and the fits subtract it (`map.ts#flyToBounds`), so the manual
  // offset would shift the first view twice. The first camera is therefore UNSHIFTED (the study
  // area's own centre) and the estimated live padding is set, without easing, right after the map
  // is constructed; once the map has loaded it is re-measured the same way. docs/map.md "Camera
  // padding" has the numbers.
  function storage(): Storage | null {
    try {
      return window.localStorage;
    } catch {
      return null;
    }
  }

  function initialChromePadding(): ChromePadding {
    if (isPhone) {
      return phonePadding(loadSheetDetent(storage(), "shell"), window.innerHeight);
    }
    return desktopPanelPadding(
      loadPanelGeometry(storage(), "shell", viewportBucket(window.innerWidth)),
    );
  }

  // V1 fix (Opus eyes-on review, 2026-09-24): "the species camera fit sits under the sheet/legend
  // chip on the phone, and under an open panel on desktop" -- {@link initialChromePadding} above
  // reads a localStorage SNAPSHOT and is only ever called once, before Panel.svelte/Sheet.svelte
  // have even mounted; a species re-fit happens long after that, so it needs the LIVE geometry
  // this file already tracks (`panelGeom`/`sheetGeom`, this file's own `ongeometry` mirrors,
  // above). The actual padding math is `chromePadding.ts#phoneLiveChromePadding` (a plain,
  // testable function -- see its own header); this just feeds it the live state.
  function currentChromePadding(): ChromePadding {
    return fitReserve(chromeReserve(), stageTop);
  }
  function chromeReserve(): ChromePadding {
    if (isPhone) {
      // WP13: the collection lens always ends up with a legend, but its first fit runs BEFORE the
      // legend is known (measured: the extent landed 5-12 px under the chip), so a collection fit
      // reserves the chip band from the start
      const chipShowing =
        (!!phoneLegend || (__LENS_COLLECTION__ && sel.lens === "collection")) &&
        legendChipMode(sheetGeom.detent) === "floating";
      return phoneLiveChromePadding(
        sheetGeom.height,
        sheetGeom.detent,
        window.innerHeight,
        chipShowing,
      );
    }
    // V4 fix (owner phone report, 2026-09-24, desktop-18): `phoneLegend` (despite its name) is
    // already lens-agnostic -- "the legend value the current lens would draw", the same one the
    // desktop `.lens-legend-region` branch reads (species -> speciesLens.mapInputs.legend, scores
    // -> scoresLens?.mapExtra.legend) -- so it doubles as desktop's own "is a legend card actually
    // on screen right now" flag with no new derived state.
    return desktopPanelPadding(panelGeom, !!phoneLegend);
  }

  // P9 (Opus docs re-check appendix finding A2, live-verified on 0.10.48): P2 round 2's fix
  // (boost the zoom of the SAME `FALLBACK_FULL_STUDY_AREA` centroid the desktop camera uses, then
  // shift for chrome) still left the phone's free area on that centroid's own neighbourhood --
  // central North Dakota, on the Canada border, nowhere near a scored ocean cell. Measured live:
  // `lon -101.304, lat 33.509, zoom 3.01`, and the free area showed Canada/the Great Lakes, 0%
  // scored cells. `camera.ts#phoneDefaultCamera`'s own header has the full measurement and why a
  // DIFFERENT anchor (a real, hand-picked Gulf-of-Mexico/south-east-coast bbox), not a bigger boost
  // of the same wrong point, is the fix. Desktop's own free area is tall enough (topbar-only
  // padding, no sheet) that the FULL preset's own unboosted centroid already keeps real coastline
  // in frame, so only the phone branch changes here.
  function initialStudyArea(area: StudyArea): StudyArea {
    if (sel.map) return area; // an explicit URL camera is never second-guessed
    if (isPhone) {
      // this call always resolves to `FALLBACK_FULL_STUDY_AREA` regardless of `sel.area`
      // (`studyAreaFromBoot(null, sel.area)` cannot see a release's real rows before `boot`
      // arrives -- see the "study-area camera" effect's own comment below) -- i.e. this IS always
      // the default first view, never a real `?area=` pick caught mid-flight.
      const viewport: Viewport = { width: window.innerWidth, height: window.innerHeight };
      // WP13: the zoom still fits the free area (same total reserve), but the centre is the box's
      // own midpoint -- the live padding set below does the shifting
      const fit = phoneDefaultCamera(viewport, symmetricPadding(initialChromePadding()));
      return { ...area, lon: fit.center[0], lat: fit.center[1], zoom: fit.zoom };
    }
    return area;
  }

  // WP13: the live camera padding (livePadding.ts) -- keeps the map's centre, and the globe when the
  // sphere projection is on, in the part of the stage the panel and phone sheet leave open. The
  // reserve is the SAME chromePadding.ts number the fits use; the legend card/chip are not part of
  // it (small floating corner boxes, not a column to centre around), so a legend appearing never
  // moves the map. Before the map exists the estimate from localStorage stands in.
  function initialLivePadding(): ChromePadding {
    const r = mapEl?.getBoundingClientRect();
    const [w, h, top] =
      r && r.width > 0 ? [r.width, r.height, r.top] : [window.innerWidth, window.innerHeight, 0];
    return livePadding(w, h, insideStage(initialChromePadding(), top));
  }
  function currentLivePadding(stageW: number, stageH: number): ChromePadding {
    if (isPhone) {
      const chrome = phoneLiveChromePadding(sheetGeom.height, sheetGeom.detent, stageH, false);
      return livePadding(stageW, stageH, insideStage(chrome, stageTop));
    }
    const chrome = desktopPanelPadding(panelGeom, false);
    return livePadding(stageW, stageH, insideStage(chrome, stageTop), {
      maximized: panelGeom.maximized,
    });
  }

  // usability M4's OTHER half: a light loader over the map until the first raster/basemap tile
  // paints (the release's own load time, 8-21s measured, had NO loading indicator at all). Purely
  // an overlay (`pointer-events: none`, see the template) -- it never delays or blocks a click, and
  // being `position: absolute` over `.stage` it never shifts sibling boxes when it appears or
  // disappears (the shell.cls CLS gate's own budget is about elements that MOVE, not ones that are
  // added/removed on top of an unrelated canvas). "idle" is the map's OWN "every source has
  // settled" event -- the same backstop docs/map.md's styleQueue.ts uses elsewhere in this file --
  // plus a fixed safety timeout, so a spec/host that never actually loads a tile (most hermetic
  // e2e fixtures do not route one) still clears the loader rather than leaving it up forever.
  //
  // U1 fix round (CI run 35956406448): this used to announce "Map loading"/"Map ready" through
  // the ONE SHARED region (src/lib/ui/announcer.ts) -- but this loader is PERSISTENT and its own
  // "idle" can fire at any later, unpredictable moment, long after the page first painted,
  // clobbering the shared region's text out from under an unrelated feature's own announcement
  // made in between (a popup's description, a chunk-load failure) -- three real specs
  // (scores.popup, species-popup, shell.chunk-error) read a stale "Map ready" instead of their own
  // text. Fixed with its own DEDICATED `role="status"` region (`.map-loading-status` in the
  // template below, visually hidden) -- `Honeycomb`'s own mount-time announce is opted OUT
  // (`announceOnMount={false}`) so nothing here ever touches the shared region at all.
  let mapLoading = $state(true);
  const MAP_LOADING_TIMEOUT_MS = 8000;
  // the dedicated region's own text -- "Map loading" as soon as this component exists (mirroring
  // what Honeycomb's own mount-time announce used to say), "Map ready" once hidden. A real text
  // CHANGE either way (never re-set to the same value), which is what a polite region needs to
  // fire a screen reader announcement.
  let mapLoadingStatus = $state("Map loading");

  function hideMapLoader() {
    if (!mapLoading) return;
    mapLoading = false;
    mapLoadingStatus = "Map ready";
  }

  // the map's FIRST "idle" fires almost instantly, on the empty/blank style it is constructed
  // with (0.10.20's own basemap fix: the real CARTO style.json arrives later, asynchronously, and
  // recomposes -- see layers/basemap.ts#warmBasemapStyles / this file's own composeStyleInput
  // header). Hiding the loader on THAT idle would clear it before the basemap (or a raster) has
  // painted anything at all -- this listens on every idle and only clears once the CURRENTLY
  // applied style actually carries basemap/raster/range/overlay layers (`layers/basemap.ts`'s own
  // `basemap-` source prefix; `raster`/`range`/`overlay` are this file's own `LAYER_ORDER` roles).
  function onMapIdle(map: { getStyle(): { sources?: Record<string, unknown> } | undefined }) {
    const sources = Object.keys(map.getStyle()?.sources ?? {});
    // the blank CONSTRUCTION style has none; the FIRST composed style already has "background"
    // (style.ts) before the async CARTO fetch resolves -- so ">1" (basemap-* landed) is the real
    // signal, not merely ">0". `BASEMAP_LAYER_PREFIX` is the precise case; the count is the
    // fallback for a raster/range/overlay source (an arbitrary, model-specific id) landing first.
    if (sources.some((id) => id.startsWith(BASEMAP_LAYER_PREFIX)) || sources.length > 1) {
      hideMapLoader();
    }
  }

  onMount(() => {
    if (!mapEl) return;
    // `boot` (read a few lines up) is ALWAYS still `null` here regardless of what is passed below:
    // it settles from `early.boot.then(...)` above, a microtask that cannot run until this whole
    // synchronous mount pass (every `onMount` body in this component) has returned. Passed as `boot`
    // anyway, not a literal `null`, so this stays correct if that ordering ever changes — the
    // effect just below is what actually resolves the real `study_areas` row once `boot` arrives.
    const handle = createMap(mapEl, {
      theme: resolveTheme(sel.theme, prefersDark),
      camera: sel.map,
      // usability M4's padding applies to the FIRST paint only (before `boot` resolves -- see the
      // "study-area camera" effect just below for why `null` is passed here on purpose, and how a
      // later effect corrects an EXPLICIT `?area=` to its real, unpadded boot-resolved camera once
      // boot arrives -- the merged precedence this round's own CHANGELOG entry documents: an
      // explicit `area=` always wins over this padded default fit).
      // a release's `?area=` resolves against its boot.json once that arrives (the study-area effect
      // below); before then, and on an instance without a release, the fallback study area
      area: initialStudyArea(FALLBACK_FULL_STUDY_AREA),
      padding: initialLivePadding(),
      projection: sel.proj,
      // URL-is-the-view: the camera goes back through selStore, i.e. history.replaceState, and
      // only for user-driven moves (src/lib/map/camera.ts).
      onCamera: (map) => selStore.set({ map }),
    });
    mapHandle = handle;
    // WP13: re-measure once the map has loaded (the estimate above came from localStorage and the
    // window), without easing so the first view does not shift twice; later settles ease 250 ms.
    handle.map.once("load", () => {
      const r = mapEl?.getBoundingClientRect();
      if (r && r.width > 0) {
        stageW = Math.round(r.width);
        stageH = Math.round(r.height);
        stageTop = Math.round(r.top);
      }
      handle.setPadding(
        currentLivePadding(stageW || window.innerWidth, stageH || window.innerHeight),
      );
      padEase = true;
    });
    const stageObserver = new ResizeObserver(() => {
      const r = mapEl?.getBoundingClientRect();
      if (!r) return;
      stageW = Math.round(r.width);
      stageH = Math.round(r.height);
      stageTop = Math.round(r.top);
    });
    stageObserver.observe(mapEl);
    const holdPointer = () => (pointerHeld = true);
    const releasePointer = () => (pointerHeld = false);
    window.addEventListener("pointerdown", holdPointer, true);
    window.addEventListener("pointerup", releasePointer, true);
    window.addEventListener("pointercancel", releasePointer, true);
    window.addEventListener("blur", releasePointer);
    const handleMapIdle = () => onMapIdle(handle.map);
    handle.map.on("idle", handleMapIdle);
    // V3 trigger (b): a raster tile load failure. `health.reportMapError` classifies it itself --
    // a 403/404 (a release-side "no data here" gap, same convention as
    // `analysis/sources.ts#isMissingTileStatus`) is a no-op; anything else (5xx, a network error, a
    // timeout) is a real failure and kicks a backoff-gated re-probe of the tiler service. Every
    // failing tile fires this (dozens at once when the whole host is down), which is exactly why
    // the backoff/single-flight guard lives in the store, not here.
    const onMapError = (e: { error: unknown }) => health.reportMapError(e.error);
    handle.map.on("error", onMapError);
    const loaderTimeout = window.setTimeout(hideMapLoader, MAP_LOADING_TIMEOUT_MS);
    // the species click. The shared map's raw click event -- never a second map instance, never a
    // second `on("click")` owner; a non-species lens ignores its own clicks inside
    // `handleMapClick` itself (checks `sel.lens` first). The collection lens' hex layer owns its own
    // click (`lib/map/layers/hex.ts`), which only fires while no place pick/draw session has
    // claimed clicks (`placesMap.interactionOwned`).
    // the Scores lens' click (MarineSensitivity/atlas item M1) wires here too, the SAME shape (each
    // self-guards on `sel.lens`), skipped while a Places pick/draw session owns map clicks.
    const onMapClick = (e: {
      lngLat: { lng: number; lat: number };
      point: { x: number; y: number };
    }) => {
      void speciesLens.handleMapClick({ lng: e.lngLat.lng, lat: e.lngLat.lat }, e.point);
      if (!placesMap.interactionOwned) {
        void scoresLens?.handleMapClick({ lng: e.lngLat.lng, lat: e.lngLat.lat }, e.point);
      }
    };
    handle.map.on("click", onMapClick);
    // the map's public test/automation seam (docs/map.md): the handle plus the CURRENT composeStyle
    // inputs, so e2e/map.spec.ts and scripts/verify.mjs can drive the real map the way a lens will
    // -- compose a style, apply it -- instead of reaching into MapLibre. It exposes nothing a
    // viewer could not already read off the page.
    (window as unknown as { __atlasMap?: unknown }).__atlasMap = {
      handle,
      composeStyle,
      // item m6 (atlas-8 review round 2): `composeStyleInput` (below) is the SAME object the
      // reactive effect below applies -- reading it here (a plain closure, so referencing a
      // `const` declared later in this script is fine: it only runs once called, well after the
      // whole component has initialized) reproduces exactly what is on screen, including whether
      // the basemap has resolved yet (0.10.20), from the ONE place that object is built.
      inputs: () => composeStyleInput,
    };
    // the species lens' own test/automation seam, same spirit as __atlasMap just above: it exposes
    // only `selectSpecies`, exactly what clicking a picker option already does through the UI (used
    // by e2e/species.smoke.spec.ts to drive TWO rapid switches before the map's first "idle" --
    // the exact race styleQueue.ts's regression test covers at the unit level). `zoomToLayer` added
    // (D8 fold-in, orchestrator round 2, 2026-09-24) so e2e/species.camera.spec.ts can drive the
    // manual "re-fit" action the same way a future button will -- state.svelte.ts's own function is
    // the fix; this seam is only how a test reaches it before that button exists.
    (window as unknown as { __atlasSpecies?: unknown }).__atlasSpecies = {
      selectSpecies: (key: string) => speciesLens.selectSpecies(key),
      zoomToLayer: () => speciesLens.zoomToLayer(),
    };
    // no window `resize` listener here: createMap observes the CONTAINER, which also covers a
    // layout-driven resize (a panel opening, the phone sheet changing detent) that no window event
    // reports.
    return () => {
      stageObserver.disconnect();
      window.removeEventListener("pointerdown", holdPointer, true);
      window.removeEventListener("pointerup", releasePointer, true);
      window.removeEventListener("pointercancel", releasePointer, true);
      window.removeEventListener("blur", releasePointer);
      delete (window as unknown as { __atlasMap?: unknown }).__atlasMap;
      delete (window as unknown as { __atlasSpecies?: unknown }).__atlasSpecies;
      handle.map.off("click", onMapClick);
      handle.map.off("idle", handleMapIdle);
      handle.map.off("error", onMapError);
      window.clearTimeout(loaderTimeout);
      handle.destroy();
      mapHandle = undefined;
    };
  });

  // WP13: apply the live padding whenever the chrome it comes from settles -- the panel's dock, size,
  // collapse and maximize (`panelGeom`), the sheet's detent and measured height (`sheetGeom`), a
  // viewport resize (`stageW`/`stageH`) -- and only when it differs from what the map has
  // (`handle.setPadding` compares). While a pointer is held (a panel or sheet drag) it waits: the
  // effect re-runs when the pointer is released, with the final geometry. The ease is 250 ms.
  $effect(() => {
    const handle = mapHandle;
    if (!handle || pointerHeld) return;
    const w = stageW;
    const h = stageH;
    if (!(w > 0 && h > 0)) return;
    handle.setPadding(currentLivePadding(w, h), { animate: padEase });
  });

  // P2 round 2 (orchestrator, real-build eyes-on, 2026-09-24): "the fit must use the free area
  // above the sheet (its measured height at that detent, at load time), not [an estimated]
  // constant... re-fit once when the sheet's initial detent is known" -- `initialStudyArea` (map
  // construction, above) necessarily used `initialChromePadding()`'s pre-mount ESTIMATE of the
  // sheet's height (`phonePadding`'s own 46svh-derived fraction), because Sheet.svelte has not
  // mounted yet at that point. `sheetGeom` (this file's own `ongeometry` binding, P1's addition)
  // reports the sheet's REAL `offsetHeight` shortly after -- this effect re-applies the fit ONCE,
  // with that real number, purely for accuracy (`chromePadding.ts#phonePaddingFromMeasured`'s own
  // header: usually within ~15px of the estimate). Guarded to the DEFAULT view only and to fire at
  // most once (a user's own pan, or a pasted `?map=` link, always wins and this never touches it).
  //
  // P9: uses the SAME `phoneDefaultCamera` bbox fit `initialStudyArea` does above (never the old
  // boost-the-desktop-centroid math -- see that function's own comment for why it was replaced) --
  // just with the sheet's real measured height instead of the pre-mount estimate.
  //
  // D5 fix: this refit uses the SHEET's own measured height AND the floating legend chip's --
  // `currentChromePadding()` computes the SAME `chipShowing` boolean for every LATER (post-load)
  // re-fit.
  // --- the study-area camera (a release's `?area=`): `sel.area` drives it on load and on change,
  // never the panel body (MarineSensitivity/atlas 2026-09-24: `?area=AK` rendered the default camera,
  // because the map's first camera cannot see the release's `study_areas` before boot.json arrives).
  // The fly/no-fly decision is `camera.ts#shouldFlyToArea`. Only an instance with a release reads
  // `area` (state/types.ts `RELEASE_KEYS`).
  let areaCameraState: AreaCameraState = INITIAL_AREA_CAMERA_STATE;
  $effect(() => {
    if (!__RELEASE__ || !mapHandle || !boot) return; // nothing to resolve `sel.area` against yet
    if (sel.map) return; // an explicit camera (a user's pan, or a pasted `?map=` link) always wins
    const area = studyAreaFromBoot(boot, sel.area);
    const decision = shouldFlyToArea(area.key, DEFAULT_SEL.area, areaCameraState);
    areaCameraState = decision.next;
    if (decision.fly) mapHandle.flyTo(area);
  });

  let refitOnceForMeasuredSheet = false;
  $effect(() => {
    if (refitOnceForMeasuredSheet) return;
    if (!isPhone || !mapHandle || !boot) return;
    if (sheetGeom.height <= 0) return; // Sheet.svelte has not reported a real measurement yet
    if (sel.map || sel.area !== DEFAULT_SEL.area) return; // not the default padded first view
    if (__LENS_COLLECTION__ && sel.lens === "collection") return; // the collection lens fits its own extent (WP3)
    if (__LENS_SCORES__ && sel.lens === "scores" && !scoresLens) return; // the legend chip's own source not loaded yet
    refitOnceForMeasuredSheet = true;
    const area = studyAreaFromBoot(boot, sel.area);
    const viewport: Viewport = { width: window.innerWidth, height: window.innerHeight };
    const chipShowing = !!phoneLegend && legendChipMode(sheetGeom.detent) === "floating";
    // WP13: symmetric, as in `initialStudyArea` -- the live padding does the shifting
    const fit = phoneDefaultCamera(
      viewport,
      symmetricPadding(
        phoneLiveChromePadding(sheetGeom.height, sheetGeom.detent, window.innerHeight, chipShowing),
      ),
    );
    mapHandle.flyTo({ ...area, lon: fit.center[0], lat: fit.center[1], zoom: fit.zoom });
  });

  // one composed style, re-applied with setStyle(diff:true) whenever theme, projection, the
  // release's zone units, OR (species lens only) the layer on screen changes -- never addLayer()
  // piecemeal (CLAUDE.md). `raster`/`range` are the ONLY species-specific fields this shell ever
  // reads; every rule that produced them lives in the lens (mapInputs.ts), not here.
  // release's zone units, or places' own pick-mode highlight / "show analysis cells" toggle change
  // -- never addLayer() piecemeal (CLAUDE.md). `placesMap.{outline,cells}` are atlas-6's ONLY way
  // to reach the map: composeStyle `selection` inputs (docs/map.md), nothing imperative. Cells (a
  // place's own covered-cell squares) take priority over the pick-mode outline when both exist --
  // Deliverable 2 shows cells only for the place currently being inspected, so nothing else should
  // paint underneath it at the same time.
  const placesSelection = $derived(
    placesMap.cells
      ? { features: placesMap.cells, cellOpacity: true }
      : placesMap.outline
        ? { features: placesMap.outline }
        : null,
  );
  // atlas-map basemap fix: the basemap is CARTO's vector style.json now, fetched once per theme
  // and cached (layers/basemap.ts#loadBasemapStyle). composeStyle() itself stays SYNCHRONOUS -- it
  // takes the already-resolved style as a plain input.
  //
  // 0.10.20: that input is now REACTIVE STATE, and the fetch's own `.then()` writes it. Between
  // 0.10.11 and 0.10.19 nothing here forced a recompose when a fetch resolved; the comment that
  // stood in this spot argued "the effect below already re-runs on the very next unrelated
  // reactive change (zones/raster/selection all change within the first second of any real load)".
  // That is an assumption about a RACE, and under load it loses: when the style.json lands after
  // the last of those changes, the cache is warm and nothing ever reads it again -- the basemap
  // never paints, for the life of the page. Measured on Firefox (1 of 40 repeats of
  // `e2e/scores.firstpaint.spec.ts`'s raster probe at load ~11; deterministic with the style.json
  // answered 3 s late): ocean pixel `247,171,122` -- the score raster over the flat `--surface-map`
  // colour -- with ZERO `basemap-` layers in `getStyle()` ten seconds after the response arrived.
  // See `layers/basemap.ts#warmBasemapStyles`.
  //
  // The reason it was left out is real and is fixed at its own root: an extra `setStyle(diff:true)`
  // landing at a network-timed moment used to expose a MapLibre-level mis-ordering, because
  // `map/styleQueue.ts` only queued while `!map.isStyleLoaded()` and the map's first, source-less
  // `blankStyle()` is trivially "loaded". That queue now holds "at most one `setStyle` in flight"
  // unconditionally; since 0.10.22 a flight ends on the issued style's own "style.load" (not
  // "idle"), and a recompose identical to the last issued style -- the INACTIVE theme reporting
  // in -- is not issued at all, so this costs nothing measurable (see styleQueue.ts's header).
  //
  // BOTH themes are warmed unconditionally, on mount -- not reactively per `resolvedTheme` change.
  // A theme TOGGLE therefore never itself kicks off a fetch: it reads state that is already there.
  // Warming only the active theme (and fetching the other one AT the moment of the toggle instead)
  // measurably broke `e2e/map.spec.ts`'s theme-switch test: a network-driven callback landing
  // inside that critical window occasionally left the canvas's WebGL context unrenderable under
  // heavy parallel load (`getContext()` returning null).
  let basemapStyles = $state<Partial<Record<ResolvedTheme, CartoStyleLike>>>({});
  onMount(() => {
    // `warmBasemapStyles` never rejects and always reports every theme exactly once, so this
    // fire-and-forget call cannot leave `basemapStyles` half-written.
    warmBasemapStyles(["navy", "paper"], (theme, style) => {
      basemapStyles = { ...basemapStyles, [theme]: style };
    });
  });

  // item m6 (atlas-8 review round 2): this object used to be built TWICE -- once here for
  // `applyStyle`, once again (nearly identically) as the automation seam's `inputs()` above -- two
  // sites that could silently drift the moment `composeStyle` gained a new input. ONE `$derived`,
  // read at both: this recomputes on exactly the same dependencies the old inline object read
  // (`resolvedTheme`, `basemapStyles[resolvedTheme]`, `sel.proj`, `zonesForStyle`, the raster/
  // range/overlays/selection branches below), and being a `$derived` (not read lazily inside an
  // optional-chain call) means it is ALWAYS evaluated regardless of whether `mapHandle` happens to
  // be null yet -- the same "defensive belt" the old local `raster`/`range` statements existed
  // for, now structural rather than a comment to remember.
  // R3 (round-2 plan §5 U4): resolved ONCE here — `sel.layers` (URL deltas) filled in with the
  // release's default stack (`defaultLayerStackEntries()`, a no-op on `composeStyle`'s own default
  // when nothing has been customized). Both lens panels below and `composeStyleInput` read this
  // SAME value, so the panel's rows and what the map actually draws can never disagree.
  const layerStack = $derived<readonly LayerStackEntry[]>(sel.layers ?? defaultLayerStackEntries());
  function onLayerStackChange(next: readonly LayerStackEntry[]) {
    selStore.set({ layers: isDefaultLayerStack(next) ? undefined : next });
  }

  // --- the release's zone units (an instance with a release: `releaseMod`) ------------------------
  // the release's drawable units from boot.json (outline only), the Scores lens' richer copy (its
  // choropleth fills and the clicked zone's highlight) on a scores view, and `Sel.out`'s ONE effect on
  // the map (`zoneUnitsWithOutline`). The Places pick mode reads `zoneUnits` too. Empty without a
  // release, so nothing here draws on such an instance.
  const zoneUnits = $derived<ZoneUnitSpec[]>(releaseMod ? releaseMod.zoneUnitsFromBoot(boot) : []);
  const zonesForStyle = $derived<ZoneUnitSpec[]>(
    releaseMod
      ? releaseMod.zoneUnitsWithOutline(
          __LENS_SCORES__ && sel.lens === "scores"
            ? (scoresLens?.mapExtra.zones ?? zoneUnits)
            : zoneUnits,
          sel.out,
        )
      : [],
  );
  // the standalone ecoregion outline the release's MANIFEST publishes, drawn on every scores view
  // (decoration, not a selectable unit: `sel.out` never hides it); never twice when boot already
  // carries an "ecoregion" unit (the layer ids would collide)
  const ecoregionUnit = $derived(
    __LENS_SCORES__ &&
      sel.lens === "scores" &&
      scoresMod &&
      !zonesForStyle.some((u) => u.unit === "ecoregion")
      ? scoresMod.ecoregionZoneUnitFromManifest(manifest)
      : null,
  );
  const zoneStyle = $derived(
    releaseMod
      ? releaseMod.composeZoneStyle(
          ecoregionUnit ? [...zonesForStyle, ecoregionUnit] : zonesForStyle,
          resolvedTheme,
        )
      : null,
  );

  const composeStyleInput = $derived({
    theme: resolvedTheme,
    // the reactive half of the 0.10.20 basemap fix: reading this is what makes the effect below
    // re-run (and the basemap actually appear) when the CARTO fetch resolves late.
    basemapStyle: basemapStyles[resolvedTheme],
    projection: sel.proj,
    hex:
      __LENS_COLLECTION__ && sel.lens === "collection"
        ? (collectionLens?.mapInputs.hex ?? null)
        : null,
    h3:
      __LENS_COLLECTION__ && sel.lens === "collection"
        ? (collectionLens?.mapInputs.h3 ?? null)
        : null,
    zoneStyle,
    raster:
      sel.lens === "species"
        ? speciesLens.mapInputs.raster
        : __LENS_COLLECTION__ && sel.lens === "collection"
          ? (collectionLens?.mapInputs.raster ?? null)
          : __LENS_SCORES__ && sel.lens === "scores"
            ? (scoresLens?.mapExtra.raster ?? null)
            : null,
    range:
      sel.lens === "species"
        ? speciesLens.mapInputs.range
        : __LENS_COLLECTION__ && sel.lens === "collection"
          ? (collectionLens?.mapInputs.range ?? null)
          : null,
    overlays: __LENS_SCORES__ && sel.lens === "scores" ? (scoresLens?.mapExtra.overlays ?? []) : [],
    // WP4: the gazetteer collections toggled in the "Place layers" group
    placeOverlays: placesMap.overlays.specs,
    selection:
      placesSelection ??
      (__LENS_SCORES__ && sel.lens === "scores" ? (scoresLens?.mapExtra.selection ?? null) : null),
    // the Collections lens' clicked raster position (ring + the cell's square), above every layer
    highlight:
      __LENS_COLLECTION__ && sel.lens === "collection"
        ? (collectionLens?.mapInputs.highlight ?? null)
        : null,
    // gazetteer-places: the "Pick from gazetteer" tile polygons, only while that picker is on
    gazetteer: placesMap.gazetteer,
    layerStack,
  });

  $effect(() => {
    mapHandle?.applyStyle(composeStyle(composeStyleInput));
  });

  // the Help menu's Docs link and the About modal's "What changed": with a release, that release's own
  // Atlas chapter and release notes in the docs book (public, or on the preview host for a restricted
  // one; the book root while the release is unknown, `lib/release/docsUrl.ts`); otherwise the
  // instance repository's README and CHANGELOG.
  const currentVersionRow = $derived(versions?.find((v) => v.ver === earlyVersion) ?? null);
  // fail closed: no row, or anything but the literal "public", reads as restricted (access.ts#accessOf)
  const releaseRestricted = $derived(!!RELEASE && currentVersionRow?.access !== "public");
  const releaseAccess = $derived<"public" | "restricted" | "unknown">(
    !earlyVersion || !currentVersionRow ? "unknown" : releaseRestricted ? "restricted" : "public",
  );
  const docsHref = $derived(
    RELEASE
      ? (releaseMod?.atlasDocsUrl(earlyVersion, releaseAccess) ?? (RELEASE.docs || "#"))
      : `https://github.com/${REPO}#readme`,
  );
  const changelogHref = $derived(
    RELEASE
      ? (releaseMod?.releaseNotesUrl(earlyVersion, releaseAccess) ?? (RELEASE.docs || "#"))
      : `https://github.com/${REPO}/blob/main/CHANGELOG.md`,
  );

  // --- "Report a problem" -> a prefilled GitHub issue, zero backend -------------------------------
  // `viewport` is the one field with no existing reactive source (unlike lens/ver/theme, all read
  // off `sel`/`earlyVersion`/`resolvedTheme` below) -- tracked the same way `isPhone` above is.
  let viewportW = $state(0);
  let viewportH = $state(0);
  onMount(() => {
    function measure() {
      viewportW = window.innerWidth;
      viewportH = window.innerHeight;
    }
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  });

  // the page URL, fragment stripped, query kept: built from `formatSel(sel).search` (the SAME
  // string `selStore`'s own `history.replaceState` call just wrote), never `location.search`
  // directly -- reading it through `sel` is what makes this recompute on every lens/ver/theme
  // change instead of freezing at mount (plan D8's privacy rule: the hash, which carries a drawn
  // place, must never reach this at all -- `pageUrlFromLocation`'s own `PageLocationLike` has no
  // field for it).
  // 0.3.4 regression fix: a view of a collection under review (an unlisted `?collection=` link, an
  // `atlas:access: "restricted"` collection, or a `?catalog=` override) is RESTRICTED -- the dialog
  // then posts nothing that could become a public issue, and the page link (the zero-backend issue
  // link's `URL:` line too) never carries the share link (`catalog/access.ts`).
  // a release instance's restricted release (a pre-release under review) is restricted too
  const feedbackAccess = $derived(
    releaseRestricted && currentVersionRow
      ? "restricted"
      : viewAccess({
          lens: sel.lens,
          collectionParam: sel.collection,
          catalogParam: sel.catalog,
          entry:
            __LENS_COLLECTION__ && sel.lens === "collection"
              ? (collectionLens?.entry ?? null)
              : null,
        }),
  );
  // the release the view is drawn from: the instance's resolved release, or the pinned one the
  // Species lens reads (a collection names its own sources)
  const feedbackVer = $derived(
    RELEASE ? earlyVersion : sel.lens === "species" ? earlyVersion : null,
  );
  const feedbackCtx = $derived<FeedbackContext>({
    appVersion: __APP_VERSION__,
    appSha: __APP_SHA__,
    ver: feedbackVer,
    lens: sel.lens,
    pageUrl: pageUrlFromLocation({
      origin: location.origin,
      pathname: location.pathname,
      search: searchForAccess(formatSel(sel).search, feedbackAccess),
    }),
    userAgent: typeof navigator === "undefined" ? "" : navigator.userAgent,
    viewport: `${viewportW}x${viewportH}`,
    theme: resolvedTheme,
  });
  // kept as the anchor's plain `href` below: works with JS disabled/failed, and a middle-click /
  // "open in new tab" still lands on a sensible zero-backend issue link even though a plain left
  // click now opens the dialog instead (onclick below always preventDefault()s it).
  const feedbackHref = $derived(feedbackIssueUrl(feedbackCtx));

  // U3 (round 2): "Send feedback" -- the SAME action, now opening a real dialog
  // (src/lib/feedback/FeedbackDialog.svelte, lazy) instead of navigating straight to the GitHub
  // issue link above. `openFeedback()` is the ONE function every trigger calls (this deliverable's
  // brief) -- until U1 lands its own top-bar "Feedback" control, the existing bottom-left "Report a
  // problem" anchor below is the only caller; U1 wires a second one to the same function.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let FeedbackDialogComp = $state<Component<any> | null>(null);
  let feedbackOpen = $state(false);
  // snapshotted at the moment the control is used, never read reactively -- the hash is not
  // tracked anywhere else in this file (nothing needs it continuously; the dialog only needs the
  // value AS OF when it opens). Shell.svelte is allowed to read `location.hash` directly (the ban
  // is on src/lib/feedback/** doing so -- see FeedbackDialog.svelte's own header); this is the
  // exact same pattern `feedbackCtx.pageUrl` above already uses for `location.origin`/`.pathname`.
  let feedbackHash = $state("");
  function openFeedback(): void {
    feedbackHash = location.hash;
    feedbackOpen = true;
    if (!FeedbackDialogComp) {
      import("../lib/feedback/FeedbackDialog.svelte")
        .then((mod) => (FeedbackDialogComp = mod.default))
        .catch(() => announceChunkFailure("the feedback dialog"));
    }
  }

  // --- lazy lens/panel chunks (D13) ---------------------------------------------------------------
  // Every lens panel is its own dynamic `import()` chunk, chosen by `sel.lens` (Places by
  // `activeTool === "places"`) -- `scripts/size-budget.mjs` only walks STATIC `imports`, never
  // `dynamicImports`, so none of these bytes count against the 450 KB "before first interaction"
  // budget, and a species-only deep link never downloads the collection lens it does not render.
  // Each is a `Component<any>` held in `$state`, resolved by a `$effect`, rendered via
  // `{@const Comp = ...}` (`Component`'s real generic Props type is not importable from a plain
  // module). While a chunk is still in flight the template falls back to the EXISTING skeleton
  // markup (`TOOL_BODY[activeTool]`'s placeholder text, or simply omitting an overlay/modal that has
  // no visible closed state) so e2e/shell.cls.spec.ts's skeleton/hydrated geometry-equality gate
  // never sees a new box shape.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let CollectionLensPanelComp = $state<Component<any> | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let CollectionLegendComp = $state<Component<any> | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let SpeciesLensPanelComp = $state<Component<any> | null>(null);
  // the species lens' "Table" tool body -- lazy ON-DEMAND (activeTool==="table", below), same
  // convention as PlacesComp, not part of the eager species-UI-group effect further down (a species
  // session that never opens Table should not download it).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let SpeciesInputsTableComp = $state<Component<any> | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let SpeciesPickerComp = $state<Component<any> | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let SpeciesLegendComp = $state<Component<any> | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let NotFoundModalComp = $state<Component<any> | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let PlacesComp = $state<Component<any> | null>(null);
  // WP4: the Collections lens' "Table" tool (the places summary), lazy on first open
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let PlaceSummaryTableComp = $state<Component<any> | null>(null);
  // the phone-only search modal's own lazy chunk -- loaded on first tap of the phone search button
  // (below), the same "load on first open" idiom, rather than a preemptive `$effect`: a phone
  // visitor who never opens search never pays for it.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let ModalComp = $state<Component<any> | null>(null);
  let phoneSearchOpen = $state(false);
  let phoneSearchBodyEl: HTMLDivElement | undefined = $state();

  // none of the dynamic imports below is allowed to fail silently -- a chunk-load failure (a flaky
  // network, an ad blocker, a stale service worker) left the promise REJECTED with nothing handling
  // it and the target `Comp` `$state` null FOREVER, with no word to the user why the lens/tool never
  // rendered. `announceChunkFailure()` tells the user; the guard needs no explicit "reset" beyond
  // that -- `.then()` never runs on a rejection, so the `Comp` state stays null exactly as it
  // started, and the SAME `if (!Comp)` check already retries the next time this effect re-runs (a
  // lens/tool switch away and back, which re-reads `sel.lens`/`activeTool` -- both already this
  // effect's own trigger).
  function announceChunkFailure(what: string): void {
    notify(`Couldn't load ${what}. Try switching tools again.`, { tone: "error" });
  }

  // the topbar `.search-field` -- which hosts the species picker while the species lens is active
  // -- is `topbar-desktop-only` (shell.css), so a phone visitor needs a way in: this opens the SAME
  // content the desktop field renders, as a near-full-width modal, focused on open. Modal.svelte's
  // native <dialog> `showModal()` only auto-focuses a descendant carrying `autofocus`, which neither
  // the SpeciesPicker's own input nor the plain stub one below sets -- so focus is moved by hand,
  // after `tick()` flushes both this component's OWN re-render (the lazy `ModalComp` arriving) and
  // Modal.svelte's own mount effect that calls `showModal()`.
  async function openPhoneSearch(): Promise<void> {
    phoneSearchOpen = true;
    if (!ModalComp) {
      try {
        const mod = await import("../lib/ui/Modal.svelte");
        ModalComp = mod.default;
      } catch {
        announceChunkFailure("search");
        phoneSearchOpen = false;
        return;
      }
    }
    await tick();
    phoneSearchBodyEl?.querySelector<HTMLInputElement>("input")?.focus();
  }

  function closePhoneSearch(): void {
    phoneSearchOpen = false;
  }

  // the Scores lens' panel, legend and search chunks, through its module (the module table's
  // `loadScores`), together the moment the lens is selected; the welcome modal is app-wide chrome
  // of that instance and loads right after mount
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let ScoresLensComp = $state<Component<any> | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let ScoresLegendComp = $state<Component<any> | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let ScoresSearchComp = $state<Component<any> | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let WelcomeModalComp = $state<Component<any> | null>(null);
  $effect(() => {
    const c = scoresMod?.components;
    if (!__LENS_SCORES__ || !c) return;
    if (!WelcomeModalComp) {
      c.Welcome()
        .then((mod) => (WelcomeModalComp = mod.default))
        .catch(() => announceChunkFailure("the welcome dialog"));
    }
    if (sel.lens !== "scores") return;
    if (!ScoresLensComp) {
      c.Lens()
        .then((mod) => (ScoresLensComp = mod.default))
        .catch(() => announceChunkFailure("the scores panel"));
    }
    if (!ScoresLegendComp) {
      c.Legend()
        .then((mod) => (ScoresLegendComp = mod.default))
        .catch(() => announceChunkFailure("the scores legend"));
    }
    if (!ScoresSearchComp) {
      c.Search()
        .then((mod) => (ScoresSearchComp = mod.default))
        .catch(() => announceChunkFailure("the scores search"));
    }
  });

  // the release's version chip and picker (an instance with a release), right after mount
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let VersionBadgeComp = $state<Component<any> | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let VersionPickerModalComp = $state<Component<any> | null>(null);
  $effect(() => {
    const c = releaseMod?.components;
    if (!__RELEASE__ || !c) return;
    if (!VersionBadgeComp) {
      c.VersionBadge()
        .then((mod) => (VersionBadgeComp = mod.default))
        .catch(() => announceChunkFailure("the release chip"));
    }
    if (!VersionPickerModalComp) {
      c.VersionPicker()
        .then((mod) => (VersionPickerModalComp = mod.default))
        .catch(() => announceChunkFailure("the release picker"));
    }
  });

  // the Report tool's pane and its Places flow (an instance whose rail has Report), when it opens
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let ReportPaneComp = $state<Component<any> | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let ReportPlacesComp = $state<Component<any> | null>(null);
  $effect(() => {
    const c = reportMod?.components;
    if (!__TOOL_REPORT__ || !c || activeTool !== "report") return;
    if (!ReportPaneComp) {
      c.Pane()
        .then((mod) => (ReportPaneComp = mod.default))
        .catch(() => announceChunkFailure("the report tool"));
    }
    if (!ReportPlacesComp) {
      c.Places()
        .then((mod) => (ReportPlacesComp = mod.default))
        .catch(() => announceChunkFailure("the Places panel"));
    }
  });

  // the Collections lens' panel and legend chunks start together the moment the lens is selected
  $effect(() => {
    const c = collectionMod?.components;
    if (!__LENS_COLLECTION__ || sel.lens !== "collection" || !c) return;
    if (!CollectionLensPanelComp) {
      c.Lens()
        .then((mod) => (CollectionLensPanelComp = mod.default))
        .catch(() => announceChunkFailure("the collections panel"));
    }
    if (!CollectionLegendComp) {
      c.Legend()
        .then((mod) => (CollectionLegendComp = mod.default))
        .catch(() => announceChunkFailure("the collection legend"));
    }
  });

  // one trigger for the whole species UI group -- all four chunks start downloading together the
  // moment the lens becomes "species" (a deep link included, since `sel` resolves from the URL
  // synchronously before first render), well ahead of `NotFoundModal`'s own `open` ever going
  // true (that only happens after `state.svelte.ts` resolves a deep link over the network -- see
  // its own header comment, "the jigger guard").
  $effect(() => {
    if (sel.lens !== "species") return;
    if (!SpeciesLensPanelComp) {
      import("../lens/species/SpeciesLens.svelte")
        .then((mod) => (SpeciesLensPanelComp = mod.default))
        .catch(() => announceChunkFailure("the species panel"));
    }
    if (!SpeciesPickerComp) {
      import("../lens/species/SpeciesPicker.svelte")
        .then((mod) => (SpeciesPickerComp = mod.default))
        .catch(() => announceChunkFailure("species search"));
    }
    if (!SpeciesLegendComp) {
      import("../lens/species/SpeciesLegend.svelte")
        .then((mod) => (SpeciesLegendComp = mod.default))
        .catch(() => announceChunkFailure("the species legend"));
    }
    if (!NotFoundModalComp) {
      import("../lens/species/NotFoundModal.svelte")
        .then((mod) => (NotFoundModalComp = mod.default))
        .catch(() => announceChunkFailure("the species lens"));
    }
  });

  // Places is its own tool; its chunk loads whenever that tool opens, on either lens.
  $effect(() => {
    if (activeTool === "places" && !PlacesComp) {
      import("../places/Places.svelte")
        .then((mod) => (PlacesComp = mod.default))
        .catch(() => announceChunkFailure("the Places panel"));
    }
  });

  $effect(() => {
    const c = collectionMod?.components;
    if (
      __LENS_COLLECTION__ &&
      sel.lens === "collection" &&
      c &&
      summaries &&
      activeTool === "table" &&
      !PlaceSummaryTableComp
    ) {
      c.SummaryTable()
        .then((mod) => (PlaceSummaryTableComp = mod.default))
        .catch(() => announceChunkFailure("the places summary table"));
    }
  });

  // loaded only once the species lens' Table tool is actually opened -- same on-demand convention
  // as places above.
  $effect(() => {
    if (sel.lens === "species" && activeTool === "table" && !SpeciesInputsTableComp) {
      import("../lens/species/SpeciesInputsTable.svelte")
        .then((mod) => (SpeciesInputsTableComp = mod.default))
        .catch(() => announceChunkFailure("the species inputs table"));
    }
  });
</script>

<!-- spec.md §11: the shell's ONE polite live region (SC 4.1.3) -- every component (Rail's
     onAnnounce below, this file's own onShare/onHelp/onVersionClick, Honeycomb's own on-mount
     announcement) calls the shared `announce()` from src/lib/ui/announcer.ts; nothing else in the
     shell renders a region of its own. Mounted FIRST (document order governs onMount order): the
     honeycomb loader (below, inside `.stage`) announces "Map loading" in ITS OWN onMount, and a
     pub-sub subscriber that mounts AFTER a publisher's first call misses it -- announcer.ts's
     `getLastAnnouncerMessage()` covers a LATE mount reading history, never an announce() that
     fires before ANYONE has subscribed at all. -->
<Announcer />

<!-- UI-1 (round 3, Opus 5.5 eyes-on review): "the visible toast component exists but the app never
     mounts it" -- about 60 announce()-only messages (Share's copy confirmation, pick-mode on/off,
     draw hints, every "couldn't..." error) reached only a screen reader. ONE instance here
     (report.html mounts its own, separately -- see Report.svelte); every `notify()` call
     (announcer.ts) reaches it via `toastQueue.ts#subscribeToastPush`, no `bind:this` needed.
     `toastPhoneBottomOffsetPx` (script block) is the SAME "rail row + sheet's real height while
     floating, else just the rail row" formula `.map-attribution`/`.legend-chip-region` already use
     (shell.css) -- "the toast must never cover the phone sheet's buttons or the legend chip" --
     passed as a PROP (Toast.svelte sets it on its own root), never a wrapping `<div>`: an extra
     static block element ahead of the top bar, even with a `position: fixed` child, was found (real
     Playwright run) to intercept pointer events across the WHOLE page -- `elementFromPoint`
     resolved to `#shell.app` itself, nowhere near any toast, and every rail/panel click timed out. -->
<Toast phoneBottomOffsetPx={toastPhoneBottomOffsetPx} />

<header class="topbar" data-tour="topbar">
  <span data-tour="brand" style="display:flex;align-items:center;gap:var(--space-2)">
    <h1 class="brand-title" id="app-title">
      <Wordmark size="1.05em" />
    </h1>
  </span>

  <!-- an instance with a release: the version chip (the release picker); its skeleton twin is the
       empty `#sk-version-chip` the build writes into index.html for the same instance -->
  {#if __RELEASE__}
    <button
      type="button"
      class="chip"
      data-tour="version-chip"
      data-control="version-chip"
      aria-haspopup="dialog"
      onclick={onVersionClick}
    >
      {#if VersionBadgeComp}
        {@const Comp = VersionBadgeComp}
        <Comp />
      {/if}
      <Icon name="version" size={14} />
      <span class="visually-hidden">Change release version</span>
    </button>
  {/if}

  <div data-tour="lens-switch" data-control="lens-switch">
    <Segmented
      options={LENSES.map((l) => ({ value: l, label: LENS_LABEL[l] }))}
      value={sel.lens}
      ariaLabel="Lens"
      onchange={onLensChange}
    />
  </div>

  <label class="search-field topbar-desktop-only" data-tour="search" data-control="search">
    <Icon name="search" size={16} />
    {#if sel.lens === "species" && SpeciesPickerComp}
      {@const Comp = SpeciesPickerComp}
      <Comp
        index={speciesLens.taxaIndex}
        selected={sel.sp}
        usOnly={sel.us}
        onSelect={(key: string) => speciesLens.selectSpecies(key)}
        onSetUsOnly={(enabled: boolean) => speciesLens.setUsOnly(enabled)}
        onSearchLogged={(query: string) => analytics.track("search_species", { query })}
        onFocusIndex={() => speciesLens.ensureTaxaIndex()}
      />
    {:else if __LENS_SCORES__ && sel.lens === "scores" && ScoresSearchComp && scoresLens}
      <!-- the Scores lens' Program Area / coordinate / region search: resolves a match into the
           lens' own selectZone / selectCoordinate / selectRegion -->
      {@const SearchComp = ScoresSearchComp}
      <SearchComp
        {boot}
        onSelectZone={(unit: string, key: string) => scoresLens?.selectZone(unit, key)}
        onSelectCoord={(lon: number, lat: number) => void scoresLens?.selectCoordinate(lon, lat)}
        onSelectRegion={(key: string) => scoresLens?.selectRegion(key)}
      />
    {:else}
      <input
        type="search"
        aria-label="Search species and places"
        placeholder="Search species and places"
      />
    {/if}
  </label>

  <span class="spacer"></span>

  <!-- owner review item 5 (live 0.10.62, "let's drop words but add tooltip on hover: Share, Help,
       Feedback, Info"): icon-only, matching Help/About/Theme's existing convention -- `aria-label`
       keeps the SAME accessible name the visible text used to give (keyboard/screen-reader users
       see no change), and `data-tooltip` (shell.css) draws a hover/focus tooltip with the same
       text, CSS-only (no JS state), so it shows in a plain headless screenshot too. -->
  <!-- owner review item 3 (live 0.10.62, "Drop Report from upper right utility menu, since
       duplicative with left toolbar"): the desktop Report button (data-control report-top, no
       longer a real attribute anywhere in this file -- tests/shell/shell-invariants.test.ts scans
       for the literal `attr="value"` text, so this comment deliberately never spells it that way)
       that used to sit here is REMOVED -- the rail's own Report tool (data-tour rail-report,
       tour.ts) and the phone ⋯ menu's Report item (TopBarActions.svelte, unchanged) both stay. -->
  <button
    type="button"
    class="tool topbar-desktop-only"
    data-tour="share"
    data-control="share"
    aria-label="Share"
    data-tooltip="Share"
    onclick={onShare}
  >
    <Icon name="share" size={18} />
  </button>
  <!-- R3-W2: Download -- PNG/SVG of the current map view, GeoTIFF of the current data layer,
       GeoJSON of the current places selection. Lazy (see DownloadMenu.svelte's own header + this
       file's `openDownload()`): until the first click, this is a cheap static placeholder button
       carrying the real `data-tour`/`data-control`/`data-tooltip` (so the skeleton/hydrated
       round-trip and `tests/shell/shell-invariants.test.ts` see it exactly as they do Share);
       DownloadMenu.svelte's OWN `<Menu>`-driven button takes over once loaded, opening itself
       immediately via `autoOpen` so the click that triggered the import is not lost. See that
       file's own header for why the phone route is a Modal (TopBarActions.svelte's "Download…"
       item) rather than a nested Menu. -->
  {#if DownloadMenuComp}
    {@const Comp = DownloadMenuComp}
    <Comp
      bind:this={downloadMenuRef}
      autoOpen={downloadAutoOpen}
      lens={sel.lens}
      ver={feedbackVer}
      {mapHandle}
      title={downloadTitle}
      description={downloadDescription}
      unit={downloadUnit}
      metricOrMdlKey={downloadMetricOrMdlKey}
      cogUrl={downloadCogUrl}
      cogDisabledReason={downloadCogDisabledReason}
      legendStops={downloadLegendStops}
      places={downloadPlaces}
      placesGeoJson={releaseMod
        ? (ps: readonly import("../lib/geo/placeCodec").Place[]) =>
            releaseMod!.zonePlacesToGeoJson(
              ps,
              boot,
              releaseMod!.zonePolygonSourceFromMap(mapHandle, boot),
            )
        : undefined}
      track={(name, params) => analytics.track(name as never, params as never)}
    />
  {:else}
    <button
      type="button"
      class="tool topbar-desktop-only"
      data-tour="download"
      data-control="download"
      aria-label="Download"
      data-tooltip="Download"
      aria-haspopup="menu"
      aria-expanded="false"
      onclick={() => openDownload("desktop")}
    >
      <Icon name="download" size={18} />
    </button>
  {/if}
  <!-- U6 (round 2): the (?) Help menu -- tour, keyboard shortcuts, a docs link. Always rendered
       (never {#if helpOpen}), toggled with `hidden`, so `aria-controls` on the trigger names an
       element that actually EXISTS in the DOM (SC 4.1.2) -- Popover.svelte's identical fix. -->
  <!-- "topbar-desktop-only" on the WRAPPER too, not just the button inside it -- the skeleton
       (index.html) has no wrapping element around the help tool at all, so at phone width it
       contributes NOTHING to the topbar's flex layout. Without this class here, the wrapper stayed
       `display:inline-flex` (its child hidden, but the span itself still a flex ITEM), adding one
       extra gap the skeleton never has -- the CLS geometry-equality gate's phone-only mismatch.
       R2's phone ⋯ menu (below) therefore does NOT reuse this disclosure at phone width (it would
       be invisible, hidden along with this whole wrapper) -- its own "Help" item opens the docs
       link directly instead (`helpDocsHref`), a simpler but fully phone-visible equivalent. -->
  <span class="help-wrap topbar-desktop-only">
    <button
      type="button"
      class="tool topbar-desktop-only"
      data-tour="help"
      data-control="help"
      aria-expanded={helpOpen}
      aria-controls="help-menu"
      aria-label="Help"
      data-tooltip={helpOpen ? undefined : "Help"}
      bind:this={helpTriggerEl}
      onclick={onHelp}
    >
      <Icon name="help" size={18} />
    </button>
    <!-- an ordinary disclosure region (About.svelte's own aria-expanded/aria-controls pattern),
         NOT role="menu" -- a real ARIA menu widget promises arrow-key/Home/End roving focus this
         does not implement, which would be a WORSE a11y contract than none at all. Tab/Shift+Tab
         reaches "Take a tour" then "Docs" in document order, same as any other disclosure.
         role="group" (axe: aria-prohibited-attr -- a plain <div> has no role that permits
         aria-label at all; "group" is the same role the panel-size control group already uses). -->
    <div
      class="help-menu"
      id="help-menu"
      role="group"
      aria-label="Help"
      hidden={!helpOpen}
      bind:this={helpMenuEl}
    >
      <button type="button" class="help-menu-item" onclick={onHelpTakeTour}>Take a tour</button>
      <div class="help-shortcuts">
        <h3>Keyboard shortcuts</h3>
        <ul>
          <li>Tab / Shift+Tab — move between controls</li>
          <li>Esc — close the open panel or dialog</li>
          <li>↓ / ↑ / Home / End — move within the tool rail</li>
          <li>= — zoom the map in</li>
          <!-- UI-16 fix (round 3, Opus 5.5 eyes-on review): "lists '= — zoom the map in' but no
               zoom-out key" -- MapLibre's own default keyboard handler binds "-" (zoom out)
               alongside "="/"+" (zoom in); only the in-key was ever documented here. -->
          <li>- — zoom the map out</li>
        </ul>
      </div>
      <a
        class="help-menu-item"
        href={docsHref}
        target="_blank"
        rel="noopener"
        onclick={() => closeHelp(false)}
      >
        Docs
      </a>
    </div>
  </span>
  <!-- P1 (Opus eyes-on assessment, 2026-09-24): the desktop `.search-field` above is
       `topbar-desktop-only`, and nothing replaced it in the ⋯ menu -- a phone visitor could not
       search a place, nor (in the species lens) change species, at all. This phone-only button
       sits right beside the ⋯ trigger below (Feedback/About, TopBarActions.svelte's own first two
       controls, are themselves `topbar-desktop-only`, so nothing else renders between them at
       this width) and opens the SAME search content in a modal -- see `openPhoneSearch`'s own
       header comment. Desktop never renders this (`topbar-phone-only`, the same class the ⋯
       trigger itself carries). -->
  <button
    type="button"
    class="tool topbar-phone-only"
    data-tour="search-phone"
    data-control="search-phone"
    aria-label="Search species and places"
    onclick={openPhoneSearch}
  >
    <Icon name="search" size={18} />
  </button>
  <!-- R2 (docs/usability.md §7): About + Feedback + the phone ⋯ menu -- ONE mount line, per this
       round's own instructions (U5/U6 touch the rail and Report/Help/theme in parallel; see
       TopBarActions.svelte's header for why this stays a separate component). Its "Docs" item
       opens `docsHref` directly (`helpDocsHref`) rather than toggling the desktop Help disclosure
       just above, which is `topbar-desktop-only` and so invisible at the width the ⋯ menu itself
       only exists at -- see that disclosure's own comment. R2 round 2: its "Take a tour" item runs
       the SAME `onHelpTakeTour` the desktop Help menu's own button does (below) -- `closeHelp(false)`
       is a no-op when the desktop disclosure was never open, so this reuses that one function
       unchanged rather than wrapping it. -->
  <TopBarActions
    release={__RELEASE__
      ? {
          ver: earlyVersion,
          restricted: releaseRestricted,
          status: currentVersionRow?.status ?? null,
          released: currentVersionRow?.released ?? null,
        }
      : null}
    appVersion={__APP_VERSION__}
    {feedbackHref}
    onFeedbackClick={openFeedback}
    {onShare}
    helpDocsHref={docsHref}
    {changelogHref}
    onTakeTour={onHelpTakeTour}
    {resolvedTheme}
    onToggleTheme={toggleTheme}
    onOpenDownload={() => openDownload("phone")}
  />
  <!-- U2a (round 2): sun/moon, CalCOFI's convention (src/App.tsx's `.cc-theme-toggle`) -- the
       icon shown is the DESTINATION theme (a sun while dark invites switching to light, a moon
       while light invites switching to dark), and the accessible name states the action in ONE
       vocabulary (light/dark -- the URL's own words, docs/usability.md p3), never "navy"/"paper"
       (those stay internal token-set names only). R3-W2 fix (R3-B12): mdiBrightness7/mdiBrightness4
       read as a settings gear at 18px (the castellated ring both share) -- swapped for
       mdiWhiteBalanceSunny/mdiMoonWaningCrescent (icon-map.json), unambiguous sun/moon glyphs with
       no gear-like frame. Both pairs are Apache-2.0 (@mdi/js, already a project dependency -- see
       LICENSE.md / node_modules/@mdi/js/LICENSE).
       P5 fix round 2 (coordinator finding, 390px eyes-on evidence): this used to be the ONE
       control with no `topbar-desktop-only` -- with the new P1 search button added beside ⋯, the
       phone topbar's fixed content (mark hidden already, lens switch, search, ⋯, theme) no longer
       fit at 390px OR 360px: this button's own right edge landed ~20px/~2px past the viewport.
       `topbar-desktop-only` here, and a "Switch to light/dark theme" item in the ⋯ menu
       (TopBarActions.svelte, same as Feedback/About's own phone route) reclaims exactly one
       button's width instead of shaving pixels off every other control. -->
  <button
    type="button"
    class="tool topbar-desktop-only"
    data-tour="theme"
    data-control="theme"
    aria-label={resolvedTheme === "navy" ? "Switch to light theme" : "Switch to dark theme"}
    onclick={toggleTheme}
  >
    <Icon name={resolvedTheme === "navy" ? "themeSun" : "themeMoon"} size={18} />
  </button>
</header>

<main
  class="stage"
  id="stage"
  data-panel-dock={isPhone ? undefined : panelGeom.dock}
  data-panel-maximized={isPhone ? undefined : panelGeom.maximized}
  style={isPhone ? undefined : `--panel-size: ${panelGeom.size}px`}
>
  <!-- P round 2 fix (CI run 36070452831, Ben's report): this used to render OUTSIDE `.stage`, a
       `position: fixed` overlay pinned to the viewport's top edge -- which put it ON TOP of
       `.topbar` (z-index 20) and intercepted every click meant for a topbar control underneath
       (feedback, the lens switch, ⋯, Help > Docs, theme). Moved inside `.stage` (below the topbar
       ENTIRELY -- they are separate CSS Grid rows in `.app`, shell.css, so one can never cover the
       other) and scoped to `.stage`'s own box (HealthBanner.svelte's `position: absolute`, not
       `fixed`): the map may be overlapped, but the topbar/rail/panel/sheet/tab bar never are. -->
  <HealthBanner
    banner={health.banner}
    onretry={() => health.banner && health.retry(health.banner.def.id)}
  />
  <!-- D1 (Opus eyes-on assessment, 2026-09-24): `data-panel-dock`/`data-panel-maximized`/
       `--panel-size` above mirror `panelGeom` the SAME way `#panel-region` itself already does
       (its own comment just below) -- ScoresLegend.svelte/SpeciesLegend.svelte read them off THIS
       ancestor (`.stage`, their own positioned parent) to keep the floating legend clear of
       whichever corner the docked panel currently fills; see those two files' own header comments
       for why the legend used to render invisibly under it. -->
  <div
    bind:this={mapEl}
    id="map"
    class="map"
    role="img"
    aria-label="Map of marine data layers"
    aria-describedby="map-table-equivalent"
    data-tour="map"
  ></div>
  <!-- (SC 1.1.1): the map announces itself as an image and nothing more -- a sighted user reads
       colour-by-value on the map; the same numbers are in the Table tool and the cell panel. -->
  <p id="map-table-equivalent" class="visually-hidden">
    The values shown on the map are also available as text under the Table and Details tools.
  </p>

  <!-- usability M4: a light loader until the first raster/basemap tile paints (8-21s measured,
       previously with no indicator at all) -- `pointer-events: none` (shell.css) so it never
       blocks a click meant for the map underneath, and being `position: absolute` it never shifts
       a sibling box when it appears/disappears (the shell.cls CLS budget is about elements that
       MOVE, not ones added/removed on top of an unrelated canvas). -->
  {#if mapLoading}
    <div class="map-loading-overlay" data-testid="map-loading">
      <Honeycomb label="Map loading" announceOnMount={false} />
    </div>
  {/if}
  <!-- this loader's OWN dedicated live region (see `hideMapLoader`'s own header for why it is not
       the shared one `src/lib/ui/announcer.ts` provides) -- `data-testid`, not a bare
       `[role="status"]` selector, so a spec can target it unambiguously alongside the SHARED
       Announcer region, which carries the identical role. -->
  <div class="visually-hidden" role="status" aria-live="polite" data-testid="map-loading-status">
    {mapLoadingStatus}
  </div>

  <!-- map-chrome parity audit (2026-09-24): `attributionControl: false` (map.ts) means MapLibre
       injects nothing itself -- Shiny shows "MapLibre | © CARTO, © OpenStreetMap contributors" on
       the map and the Atlas showed neither. DECISION: a labelled region OUTSIDE `#map`, never a
       MapLibre-injected in-map control -- `#map` carries `role="img"` (a leaf image role; ARIA
       forbids a role=img element having any accessible descendants at all, controls included), so
       an attribution control living INSIDE it would itself be an axe violation. A plain sibling
       `<div>` in `.stage`, always visible (no interaction needed, per the audit's own ask), keeps
       `#map` clean. `BASEMAP_ATTRIBUTION` is the SAME string composeStyle()'s own basemap input
       carries (layers/basemap.ts) -- never a second, hand-typed copy of the CARTO/OSM credit. -->
  <div
    class="map-attribution"
    role="group"
    aria-label="Map data attribution"
    data-testid="map-attribution"
    style={`--legend-chip-sheet-height: ${
      legendChipMode(sheetGeom.detent) === "floating" ? sheetGeom.height : 0
    }px`}
  >
    <a href="https://maplibre.org/" target="_blank" rel="noopener">MapLibre</a>
    <span aria-hidden="true">|</span>
    {BASEMAP_ATTRIBUTION}
    <!-- WP5: the atlas' own credit line, with the basemap credit. Dropped on the phone (shell.css)
         so the ODbL credit stays whole there; the About dialog and the catalog footer carry it. -->
    <span class="brand-credit" data-testid="map-attribution-brand"
      ><span aria-hidden="true">|</span> {BRAND_CREDIT}</span
    >
    <!-- gazetteer-places, per-source credits: the Ocean Metrics gazetteer's own attribution, present
         exactly while gazetteer polygons are on the map (the picker's collection, or a `p.` place
         in the list that has loaded) -- placesMap.credits is empty otherwise. -->
    {#if placesMap.credits}
      <span aria-hidden="true">|</span>
      <span data-testid="map-attribution-gazetteer">{placesMap.credits}</span>
    {/if}
    <!-- WP7: a layer with terms of its own (AquaMaps native, CC BY-NC) is credited here while it is on
         the map; `collectionLens.attribution` is null for every other layer. -->
    {#if __LENS_COLLECTION__ && sel.lens === "collection" && collectionLens?.attribution}
      <span aria-hidden="true">|</span>
      <span data-testid="map-attribution-layer">{collectionLens.attribution}</span>
    {/if}
  </div>

  <!-- fix list #6 (SC 2.4.1), FIREFOX: `tabindex="-1"` on the skip targets -- without it,
       activating "Skip to the tools" only moved the sequential-focus STARTING POINT to this
       `<nav>`, and Firefox (unlike chromium/webkit) places that point AFTER the target's whole
       subtree, so the next Tab landed on the panel's "Collapse to a pill" and skipped the rail
       entirely. With `tabindex="-1"` the target itself becomes the thing that takes focus, so
       every engine agrees on where the next Tab starts from -- the usual remedy for a skip link
       whose target is not natively focusable. -->
  <nav
    class="rail-region"
    id="rail-region"
    aria-label="Tools"
    tabindex="-1"
    data-tour="rail"
    data-control="rail"
    data-dock={isPhone ? undefined : panelGeom.dock}
  >
    <Rail
      items={railItems}
      active={activeTool}
      orientation={isPhone ? "horizontal" : "vertical"}
      onSelect={onRailSelect}
      onAnnounce={announce}
    />
  </nav>

  <!-- fix list #6 (SC 2.4.1): the "Skip to the details panel" link's own target -- same
       `tabindex="-1"` remedy as #rail-region above, for the same reason.
       R1: `data-dock`/`data-maximized`/`--panel-size` mirror Panel.svelte's own reported geometry
       (`panelGeom`, above) -- shell.css's `.panel-region[data-dock=...]`/`[data-maximized]` rules
       read them. Absent on the phone (Panel never mounts there; Sheet.svelte keeps its own
       detents), which is also why the desktop-only CSS rules never need an `isPhone` guard of
       their own. -->
  <!-- P1 fix: declared here, as a sibling of BOTH `#panel-region` (below) and the floating legend
       region (further below, after `#panel-region` closes) -- a snippet is only in scope within
       the block it is declared in, so it has to live at THIS level to be referenced from both
       `<Sheet>`'s `headerExtra` prop (inside `#panel-region`) and the floating placement (a
       sibling of `#panel-region`, outside it). Exactly one `<LegendChip>` instance exists no
       matter which placement is active -- switching between them (the sheet crossing the "full"
       boundary) unmounts/remounts it, which simply closes an open modal rather than leaving two
       chips live at once. -->
  {#snippet legendChipContent()}
    {#if phoneLegend}
      <LegendChip title={phoneLegend.title} description={phoneLegendDescription}>
        {#if sel.lens === "species" && SpeciesLegendComp}
          {@const Comp = SpeciesLegendComp}
          <Comp legend={phoneLegend} tilesDown={health.isDown("tiler")} />
        {:else if __LENS_COLLECTION__ && sel.lens === "collection" && collectionLens && CollectionLegendComp}
          {@const Comp = CollectionLegendComp}
          <Comp
            legend={phoneLegend}
            tilesDown={health.isDown("tiler")}
            isRaster={!!collectionLens.mapInputs.raster}
            onZoom={() => collectionLens.zoomToLayer()}
            zoomDisabled={!collectionLens.canZoomToLayer}
          />
        {:else if __LENS_SCORES__ && sel.lens === "scores" && ScoresLegendComp}
          {@const Comp = ScoresLegendComp}
          <Comp legend={phoneLegend} tilesDown={health.isDown("tiler")} />
        {/if}
      </LegendChip>
    {/if}
  {/snippet}
  <div
    class="panel-region"
    id="panel-region"
    tabindex="-1"
    data-tour="panel"
    data-control="panel"
    data-dock={isPhone ? undefined : panelGeom.dock}
    data-maximized={isPhone ? undefined : panelGeom.maximized}
    style={isPhone ? undefined : `--panel-size: ${panelGeom.size}px`}
  >
    <!-- the ONE panel body: Places owns its tool on either lens; otherwise the active lens decides
         what the tool's panel shows (the species lens takes "layers" and "details", plus its own
         "table"). -->
    {#snippet panelBody()}
      {#if __TOOL_REPORT__ && activeTool === "report"}
        <!-- the Report tool (an instance whose rail has it, MarineSensitivity/atlas R4-D): ONE flow
             on either lens -- the Places flow, Add a place, and a pinned footer (the subject
             sentence, Open report, Share, Download places). `ReportPane` hands the Places flow the
             footer lead and the recent reports as snippets. -->
        {#snippet placesContent(slots: {
          lastClickedLabel: string | null;
          onAddLastClicked: () => void;
          footerLead: import("svelte").Snippet;
          recentsExtra: import("svelte").Snippet;
        })}
          {#if ReportPlacesComp}
            {@const Comp = ReportPlacesComp}
            <Comp
              {sel}
              {selStore}
              {boot}
              {manifest}
              {mapHandle}
              {zoneUnits}
              mapStore={placesMap}
              lastClickedLabel={slots.lastClickedLabel}
              onAddLastClicked={slots.onAddLastClicked}
              footerLead={slots.footerLead}
              recentsExtra={slots.recentsExtra}
            />
          {:else}
            <p>{TOOL_BODY[activeTool]}</p>
          {/if}
        {/snippet}
        {#if ReportPaneComp && reportSubject}
          {@const Pane = ReportPaneComp}
          <Pane
            {sel}
            ver={earlyVersion}
            places={placesContent}
            subject={reportSubject}
            lastClickedLabel={reportLastClickedLabel}
            onAddLastClicked={() => void onAddLastClicked()}
            lastClickedPl={lastClickedCellPl}
          />
        {:else}
          <p>{TOOL_BODY[activeTool]}</p>
        {/if}
      {:else if activeTool === "places"}
        {#if PlacesComp}
          {@const Comp = PlacesComp}
          <Comp
            {sel}
            {selStore}
            {mapHandle}
            mapStore={placesMap}
            summaries={summaries ?? undefined}
          />
        {:else}
          <p>{TOOL_BODY[activeTool]}</p>
        {/if}
      {:else if __LENS_SCORES__ && sel.lens === "scores"}
        <!-- the Scores lens takes every other tool (Layers, Details with the flower, Table with the
             zones and species tables) and falls back to the tool's own text -->
        {#if ScoresLensComp && scoresLens}
          {@const Comp = ScoresLensComp}
          <Comp
            {sel}
            {selStore}
            {boot}
            {manifest}
            ver={earlyVersion}
            {mapHandle}
            {activeTool}
            fallbackBody={TOOL_BODY[activeTool]}
            lens={scoresLens}
            {layerStack}
            {onLayerStackChange}
            compactFlower={isPhone && sheetGeom.detent === "half"}
            {expandedRow}
            onExpandedRowChange={(id: LayerGroupId | null) => (expandedRow = id)}
            lastClickedLabel={lastClickedRowLabel}
            onAddLastClicked={() => void onAddLastClicked()}
            onOpenTable={() => selectTool("table")}
            onOpenPlaces={openPlacesFlow}
          />
        {:else}
          <p>{TOOL_BODY[activeTool]}</p>
        {/if}
      {:else if __LENS_COLLECTION__ && sel.lens === "collection" && collectionLens && (activeTool === "layers" || activeTool === "details")}
        {#if CollectionLensPanelComp}
          {@const Comp = CollectionLensPanelComp}
          <Comp
            lens={collectionLens}
            {layerStack}
            {onLayerStackChange}
            {sel}
            {selStore}
            {mapHandle}
            {expandedRow}
            onExpandedRowChange={(id: LayerGroupId | null) => (expandedRow = id)}
            part={activeTool === "details" ? "details" : "layers"}
            overlays={placesMap.overlays}
          />
        {:else}
          <p>{TOOL_BODY[activeTool]}</p>
        {/if}
      {:else if __LENS_COLLECTION__ && sel.lens === "collection" && activeTool === "table"}
        <!-- WP4: the places summary of the current item (one row per place), with CSV download -->
        {#if PlaceSummaryTableComp && summaries}
          {@const Comp = PlaceSummaryTableComp}
          <Comp {summaries} />
        {:else}
          <p>{TOOL_BODY[activeTool]}</p>
        {/if}
      {:else if sel.lens === "species" && (activeTool === "layers" || activeTool === "details")}
        {#if SpeciesLensPanelComp}
          {@const Comp = SpeciesLensPanelComp}
          <!-- P round deliverable 1 / orchestrator hand-off (2026-09-25): `boot` used to feed
               SpeciesLens.svelte's own disabled "Raster cells | Program Areas" toggle -- that
               toggle is now HIDDEN for species entirely (there is no spatial-unit CHOICE to make
               in this lens), so `boot` is unused there today; kept as a prop rather than a second
               Shell.svelte branch dropping it (SpeciesLens.svelte's own header explains why).
               R3 deliverable 6/7: `sel`/`selStore`/`mapHandle` are new here -- the shared panel's
               "Outlines" and "Sphere" rows are lens-independent (`Sel.out`/`Sel.proj`), and this
               lens previously had no reason to read either. -->
          <Comp
            lens={speciesLens}
            rep={sel.rep}
            {layerStack}
            {onLayerStackChange}
            {boot}
            {sel}
            {selStore}
            {mapHandle}
            {expandedRow}
            onExpandedRowChange={(id: LayerGroupId | null) => (expandedRow = id)}
            part={activeTool === "details" ? "details" : "layers"}
            overlays={placesMap.overlays}
          />
        {:else}
          <p>{TOOL_BODY[activeTool]}</p>
        {/if}
      {:else if sel.lens === "species" && activeTool === "table"}
        <!-- owner review item 7 (live 0.10.62): the placeholder text below used to be the WHOLE
             body here ("The species and zone tables arrive in a later phase.") -- now the selected
             model's own inputs, reshaped from the SAME `speciesLens.bar` the layer bar already
             computes (SpeciesInputsTable.svelte's own header). -->
        {#if SpeciesInputsTableComp}
          {@const Comp = SpeciesInputsTableComp}
          <Comp
            bar={speciesLens.bar}
            loading={speciesLens.loading}
            cardError={!!speciesLens.cardError}
          />
        {:else}
          <p>{TOOL_BODY[activeTool]}</p>
        {/if}
      {:else}
        <p>{TOOL_BODY[activeTool]}</p>
      {/if}
    {/snippet}
    {#if isPhone}
      <Sheet
        id="shell"
        title={panelTitle}
        ongeometry={(g) => (sheetGeom = g)}
        headerExtra={phoneLegend && legendChipMode(sheetGeom.detent) === "inline"
          ? legendChipContent
          : undefined}
        initialDetentOverride={initialUi?.detent ?? null}
      >
        {@render panelBody()}
      </Sheet>
    {:else}
      <Panel
        id="shell"
        title={panelTitle}
        fullStage={toolTakesFullStage(activeTool)}
        bind:this={panelRef}
        ongeometry={(g) => (panelGeom = g)}
        initialGeometryOverride={initialUi ? { dock: initialUi.dock, size: initialUi.size } : null}
      >
        {@render panelBody()}
      </Panel>
    {/if}
  </div>

  <!-- atlas-4 defect fix, R2 (usability M14): ONE floating "lens legend" region, keyed on
       `sel.lens` -- spec.md's "one legend on screen at a time". Species used to be the only lens
       with a floating legend at all; the scores lens' copy used to live INSIDE LayersPanel.svelte
       (only visible with that tool open, and never for the zone-choropleth branch) -- both
       branches render here, lazy, the same way every other lens component in this file is. On the
       phone the desktop-only floating legends (`display:none` below 900px, "no room beside the
       sheet") are replaced by ONE compact chip (LegendChip.svelte) sharing the SAME legend object
       -- `isPhone` gates the two branches, so exactly one ever renders, never both.

       P1 fix (Ben's phone report, 2026-09-24): the chip used to float here at a FIXED offset
       regardless of the sheet's detent, which put it on top of the sheet's own header controls at
       "peek" and the last table row at "half"/"full". It now only floats here while
       `legendChipMode` says "floating" (peek/half, or any future drag-resized height in between
       -- see sheetGeometry.ts); at "full" it moves INSIDE the sheet instead (`headerExtra`,
       above), so this region renders nothing then. `--legend-chip-sheet-height` (read by
       shell.css's `.legend-chip-region`) is the sheet's REAL measured height (`sheetGeom.height`),
       so the chip tracks the sheet's actual top edge -- the CSS fallback (`0px`, shell.css) is
       what "no sheet mounted yet" degrades to, the same position the chip has always had. -->
  {#if isPhone}
    {#if phoneLegend && legendChipMode(sheetGeom.detent) === "floating"}
      <div class="legend-chip-region" style={`--legend-chip-sheet-height: ${sheetGeom.height}px`}>
        {@render legendChipContent()}
      </div>
    {/if}
  {:else if sel.lens === "species" && SpeciesLegendComp}
    {@const Comp = SpeciesLegendComp}
    <div class="lens-legend-region">
      <Comp legend={speciesLens.mapInputs.legend} tilesDown={health.isDown("tiler")} />
    </div>
  {:else if __LENS_SCORES__ && sel.lens === "scores" && ScoresLegendComp}
    {@const Comp = ScoresLegendComp}
    <div class="lens-legend-region">
      <Comp legend={scoresLens?.mapExtra.legend ?? null} tilesDown={health.isDown("tiler")} />
    </div>
  {:else if __LENS_COLLECTION__ && sel.lens === "collection" && collectionLens && CollectionLegendComp && collectionLens.mapInputs.legend}
    {@const Comp = CollectionLegendComp}
    <div class="lens-legend-region">
      <Comp
        legend={collectionLens.mapInputs.legend}
        tilesDown={health.isDown("tiler")}
        isRaster={!!collectionLens.mapInputs.raster}
        onZoom={() => collectionLens.zoomToLayer()}
        zoomDisabled={!collectionLens.canZoomToLayer}
      />
    </div>
  {/if}
</main>

{#if FeedbackDialogComp}
  {@const Comp = FeedbackDialogComp}
  <Comp
    open={feedbackOpen}
    onclose={() => (feedbackOpen = false)}
    ver={sel.lens === "species" ? earlyVersion : null}
    access={feedbackAccess}
    lens={sel.lens}
    appVersion={__APP_VERSION__}
    appSha={__APP_SHA__}
    viewport={`${viewportW}x${viewportH}`}
    theme={resolvedTheme}
    userAgent={typeof navigator === "undefined" ? "" : navigator.userAgent}
    pageUrl={feedbackCtx.pageUrl}
    hash={feedbackHash}
    track={(name: string, params: Record<string, unknown>) =>
      analytics.track(name as never, params as never)}
  />
{/if}

{#if NotFoundModalComp}
  {@const Comp = NotFoundModalComp}
  <Comp
    open={speciesLens.notFound !== null}
    reasons={speciesLens.notFound?.reasons ?? []}
    onclose={() => speciesLens.dismissNotFound()}
  />
{/if}

<!-- an instance with a release: the release picker; with the Scores lens: the first-visit welcome.
     App-wide chrome (either lens), each its own lazy chunk; a closed modal has no visible box, so
     the skeleton/hydrated geometry gate has nothing to compare here. -->
{#if __RELEASE__ && VersionPickerModalComp}
  {@const Comp = VersionPickerModalComp}
  <Comp
    open={versionPickerOpen}
    onclose={() => (versionPickerOpen = false)}
    {versions}
    {denied}
    currentVer={earlyVersion}
    loc={{ search: location.search, hash: location.hash }}
  />
{/if}
{#if __LENS_SCORES__ && WelcomeModalComp}
  {@const Comp = WelcomeModalComp}
  <Comp
    tour={sel.tour}
    onTakeTour={() => void beginTour()}
    onSwitchToSpecies={() => onLensChange("species")}
    {docsHref}
    ver={earlyVersion}
  />
{/if}

<!-- P1 (Opus eyes-on assessment, 2026-09-24): the phone-only search modal -- see
     `openPhoneSearch`'s own header comment above. Content mirrors the desktop `.search-field`
     exactly (same SpeciesPickerComp instance/props in the species lens, the same plain stub input
     otherwise), just laid out for the modal's own width/touch target (`.search-field-phone` /
     `.search-field-phone-input`, shell.css) instead of the topbar's fixed 32px pill.

     `search-field-phone--species` (species lens only): eyes-on evidence caught Modal.svelte's
     `.modal-body { overflow: auto }` -- entirely reasonable for ordinary text content -- clipping
     SpeciesPicker's own results list, which is `position: absolute` (so it contributes NOTHING to
     the dialog's natural, content-driven height): the dialog shrank to the search row's own ~50px
     and the dropdown rendered past that box's bottom edge. A first fix (a fixed min-height guess)
     still let it render past the dialog's own bottom edge on review -- shell.css's own
     `.search-field-phone--species .picker-dropdown` override forces it into NORMAL FLOW instead
     (`position: static`), so the dialog's real height always includes it, growing/scrolling
     (`.modal-body`'s own `overflow: auto`) to hold whatever it actually is, not a guessed number. -->
{#if ModalComp}
  {@const ModalC = ModalComp}
  <ModalC open={phoneSearchOpen} title="Search" onclose={closePhoneSearch}>
    <div
      class="search-field-phone"
      class:search-field-phone--species={sel.lens === "species"}
      class:search-field-phone--scores={__LENS_SCORES__ && sel.lens === "scores"}
      bind:this={phoneSearchBodyEl}
    >
      <Icon name="search" size={16} />
      <div class="search-field-phone-control">
        {#if sel.lens === "species" && SpeciesPickerComp}
          {@const PickerComp = SpeciesPickerComp}
          <PickerComp
            index={speciesLens.taxaIndex}
            selected={sel.sp}
            usOnly={sel.us}
            onSelect={(key: string) => {
              speciesLens.selectSpecies(key);
              closePhoneSearch();
            }}
            onSetUsOnly={(enabled: boolean) => speciesLens.setUsOnly(enabled)}
            onSearchLogged={(query: string) => analytics.track("search_species", { query })}
            onFocusIndex={() => speciesLens.ensureTaxaIndex()}
          />
        {:else if __LENS_SCORES__ && sel.lens === "scores" && ScoresSearchComp && scoresLens}
          <!-- the SAME content as the desktop field, closing the modal once a result is picked -->
          {@const SearchComp = ScoresSearchComp}
          <SearchComp
            {boot}
            onSelectZone={(unit: string, key: string) => {
              scoresLens?.selectZone(unit, key);
              closePhoneSearch();
            }}
            onSelectCoord={(lon: number, lat: number) => {
              void scoresLens?.selectCoordinate(lon, lat);
              closePhoneSearch();
            }}
            onSelectRegion={(key: string) => {
              scoresLens?.selectRegion(key);
              closePhoneSearch();
            }}
          />
        {:else}
          <input
            type="search"
            class="search-field-phone-input"
            aria-label="Search species and places"
            placeholder="Search species and places"
          />
        {/if}
      </div>
    </div>
  </ModalC>
{/if}
