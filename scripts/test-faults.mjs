#!/usr/bin/env node
// atlas-8 step 1: `npm run test:faults` -- the SOURCE-EDIT seeded faults, proven against a real
// throwaway checkout rather than a parallel copy inside a test file.
//
// Most of this repo's seeded faults (tests/GATES.md tallies them) already prove themselves on
// every ordinary `npm test`: a wrong implementation kept beside the right one in the SAME test
// file (tests/geo/rmod.test.ts's `noGuard`/`naive`), or a permanent fixture tree a scanner is
// pointed at (tests/fixtures/map/fitbounds-fault/). Neither needs this script.
//
// This script is for the other kind: a fault that has to be applied to the REAL exported
// function `src/` ships, not a copy, because the property under test ("the ratio gate catches an
// O(n^2) rewrite of cellsInPolygon itself", "the eviction order gate catches the literal order
// the plan's wording describes") is about that exact file. Applying it to the working tree even
// briefly would be a lie the moment two things happen at once in this shared repo, so each fault
// runs in its own `git worktree add --detach` copy under $TMPDIR, patched, tested, and discarded
// -- the working tree here never changes.
//
// Manifest: FAULTS below. Each entry names a small unified diff under tests/faults/ (generated
// once with `git diff` against a real edit, then the edit reverted -- see the patch files' own
// header comments) and the vitest invocation that must go from GREEN (unpatched HEAD) to RED
// (patched). A fault whose gate stays green with the patch applied fails this script -- "a check
// that cannot fail is not a check" (CLAUDE.md).
//
// Usage: npm run test:faults  (needs $TMPDIR exported, and a clean `git status` for HEAD to be
// meaningful -- it worktrees off HEAD, not the working tree, on purpose: see each patch's header).
// `node scripts/test-faults.mjs --only <id>` runs a single entry by its `id` field.
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// R3-D2: exported so scripts/check-faults-apply.mjs can read every patch path this manifest names
// without running a single gate -- the manifest itself stays the one place a fault's patch path is
// written (never duplicated into a second list that could drift).
export const FAULTS = [
  // --- WP3: the cell panel's species list and default camera ---------------------------------------
  {
    id: "species-group-case-sensitive",
    patch: "tests/faults/species-group-case-sensitive.patch",
    describe:
      "inGroup() compares the species' coarse group case-sensitively -- the cube's lowercase `shark` " +
      "never matches the table's `Shark`, so a group's species list comes back empty",
    gate: ["npx", "vitest", "run", "tests/catalog/species.test.ts", "-t", "inGroup"],
  },
  {
    id: "species-sort-ascending",
    patch: "tests/faults/species-sort-ascending.patch",
    describe:
      "speciesInCell() sorts by probability ascending -- the least likely species lead the list",
    gate: ["npx", "vitest", "run", "tests/catalog/species.test.ts", "-t", "speciesInCell"],
  },
  {
    id: "extent-antimeridian-wrapped",
    patch: "tests/faults/extent-antimeridian-wrapped.patch",
    describe:
      "extentBounds() stops re-expressing an antimeridian-crossing extent with east > 180 -- the default " +
      "camera of such a collection is rejected (or inverts)",
    gate: ["npx", "vitest", "run", "tests/catalog/extent.test.ts"],
  },
  {
    id: "coverage-quadratic-scan",
    patch: "tests/faults/coverage-quadratic-scan.patch",
    describe: "an O(n^2) all-pairs edge scan planted in cellsInPolygon's accumulate()",
    gate: ["npx", "vitest", "run", "tests/geo/coverage.test.ts", "-t", "WIDENED spread"],
  },
  {
    id: "rmod-guard-drop",
    patch: "tests/faults/rmod-guard-drop.patch",
    describe:
      "rmod()'s second (guard) pass dropped -- a tiny negative operand full-turns instead of 0",
    gate: ["npx", "vitest", "run", "tests/geo/rmod.test.ts"],
  },
  {
    id: "opfs-eviction-order",
    patch: "tests/faults/opfs-eviction-order.patch",
    describe:
      "planEviction() restored to the plan's literal 'tiles first' order (overruled by ruling 5)",
    gate: ["npx", "vitest", "run", "tests/engine/opfsPolicy.test.ts"],
  },
  {
    id: "feedback-location-href",
    patch: "tests/faults/feedback-location-href.patch",
    describe:
      "pageUrlFromLocation() ignores its argument and reads the live location.href instead " +
      "(atlas-8 Deliverable 4: leaks the hash into the 'Report a problem' link). This entry drives " +
      "the mechanical (vitest) leg; `e2e/feedback.spec.ts` goes red under the same patch too " +
      "(verified by hand -- see docs/feedback.md). It could now be a Playwright entry like the two " +
      "below, which landed after it; the vitest leg is kept because it is a second or two rather " +
      "than a minute, and the property under test is a pure function.",
    gate: ["npx", "vitest", "run", "tests/feedback/noHash.test.ts"],
  },
  // --- atlas-8 step 3: the two accessibility faults the plan's pyramid row names ------------------
  // These are the first PLAYWRIGHT gates in this manifest. They need a real browser against a real
  // build of the PATCHED tree, so each runs on its own `PW_PORT` (playwright.config.ts honours it
  // and, when it is set, never reuses a server it did not start -- otherwise a `vite preview`
  // already answering 4331 from the UNPATCHED checkout would serve the wrong bytes and the fault
  // would "pass"). One `npm run build` per fault, ~1 minute each.
  // U6/U2a (round 2): the load-bearing rule behind U2a's default-theme change -- DEFAULT_SEL.theme
  // reverting from "dark" to "auto" would silently undo the whole feature (a first-time visitor on
  // a light-OS system would see the paper theme again, docs/usability.md's original finding). This
  // patch is exactly that one-line revert and must turn tests/state/codec.test.ts's own "theme:
  // tri-state, default 'dark'" describe block red (5 assertions: the bare default, the garbage
  // fallback, and the now-flipped formatSel omit/write rules for "dark" vs "auto"). Proven RED
  // against this exact patch (vitest -- 5 failed, 75 passed) before being committed.
  {
    id: "theme-default-reverts-to-auto",
    patch: "tests/faults/theme-default-reverts-to-auto.patch",
    describe:
      'DEFAULT_SEL.theme reverts from "dark" to "auto" -- a first-time visitor on a light-OS ' +
      "system sees the paper theme again, undoing U2a's default-theme change",
    gate: ["npx", "vitest", "run", "tests/state/codec.test.ts"],
  },
  {
    id: "places-draw-style-drops-td-layers",
    patch: "tests/faults/places-draw-style-drops-td-layers.patch",
    describe:
      "applyStyle() stops preserving terra-draw's own td-* sources/layers across a recompose -- " +
      "MapLibre's diff silently deletes them again, the same uncaught crash P7 live-reproduced",
    gate: ["npx", "vitest", "run", "tests/map/style.test.ts", "-t", "preserves a live td-"],
  },
  {
    id: "species-camera-sibling-skipped",
    patch: "tests/faults/species-camera-sibling-skipped.patch",
    describe:
      "cameraFor()'s D8 'sibling' fallback step never runs -- selecting a model whose own input " +
      "and the merged surface both publish no bbox (the walrus am|ITS-Mam-180639 case) skips the " +
      "fly-to and stays on the whole study area",
    gate: ["npx", "vitest", "run", "tests/lens/species/camera.test.ts", "-t", "D8"],
  },
  {
    id: "species-wide-range-threshold-inverted",
    patch: "tests/faults/species-wide-range-threshold-inverted.patch",
    describe:
      "R3-A1's wide-range span check flips to `span < WIDE_RANGE_SPAN_DEG` -- a COMPACT model " +
      "(under the threshold) gets wrongly narrowed to a US intersection it was never supposed to " +
      "have, while a genuinely WIDE model (over the threshold, e.g. the leatherback-shaped " +
      "130-deg fixture) keeps its whole, un-narrowed range and the 'Zoom to' toggle never appears",
    gate: ["npx", "vitest", "run", "tests/lens/species/camera.test.ts", "-t", "R3-A1"],
  },
  {
    id: "species-cogbounds-widerange-skipped",
    patch: "tests/faults/species-cogbounds-widerange-skipped.patch",
    describe:
      "R3-rr fix 1 (Opus 5.5 eyes-on review round 3, second pass, 2026-09-25 -- regenerated from " +
      "the D1/round-2 fault of the same id, whose target code cogBoundsCamera() superseded): " +
      "cogBoundsCamera() (data/camera.ts) restores the early `return null` for a globe-spanning " +
      "frame BEFORE wideRangeAware() ever runs -- the leatherback's REAL live /cog/info bounds " +
      "([-180,-17.7,180,60.45]) again read as 'not a camera at all', so the whole-Pacific range " +
      "and no 'Zoom to' toggle are back",
    gate: ["npx", "vitest", "run", "tests/lens/species/camera.test.ts", "-t", "R3-rr fix 1"],
  },
  {
    id: "bounds-narrow-longitude-skipped",
    patch: "tests/faults/bounds-narrow-longitude-skipped.patch",
    describe:
      "createTitilerBoundsSource()'s narrowLongitude() call is skipped -- a degenerate " +
      "whole-360-degree-longitude /cog/info bbox (the real walrus v7 case) is handed straight to " +
      "the camera instead of narrowed by point-probe (D8 round 2's real-build defect: /cog/bounds " +
      "404s live, /cog/info's own bounds are honest but globe-wide)",
    gate: ["npx", "vitest", "run", "tests/raster/bounds.test.ts"],
  },
  {
    id: "species-popup-no-value-cellid",
    patch: "tests/faults/species-popup-no-value-cellid.patch",
    describe:
      "the species lens' popupHtml() shows 'Cell ID: ...' again for kind 'no-value' -- the D3 " +
      "fold-in regression (an internal id beside 'No scored cell here' reads as a lookup bug, not " +
      "'no data here')",
    gate: ["npx", "vitest", "run", "tests/lens/species/popup.test.ts"],
  },
  {
    id: "places-shareurl-substring-replace",
    patch: "tests/faults/places-shareurl-substring-replace.patch",
    describe:
      "shareUrl() reverts to a plain string substring-replace of pl=<oldPl> against href -- " +
      "silently no-ops against a REAL percent-encoded address bar (several places, or a name " +
      "with a space), so 'Copy link anyway' copies the full unsimplified original link",
    gate: [
      "npx",
      "vitest",
      "run",
      "tests/places/share.test.ts",
      "-t",
      "address-bar href -- P8 item 5",
    ],
  },
  {
    id: "geopackage-no-feature-table-check-dropped",
    patch: "tests/faults/geopackage-no-feature-table-check-dropped.patch",
    describe:
      "parseGeoPackage()'s feature-table existence check ('if (Number(...) === 0)') is neutered " +
      "to 'if (false)' -- a raster-tile/attribute-only .gpkg (no vector layer at all) falls " +
      "through to ST_Read's raw SQL error instead of the honest geopackageNoFeatureTable refusal " +
      "(Q2's own reader-returns-no-features fault)",
    gate: [
      "npx",
      "vitest",
      "run",
      "tests/geo/upload/parsers.test.ts",
      "-t",
      "refused by name, not with ST_Read's raw SQL error",
    ],
  },
  {
    id: "naming-option-ignored",
    patch: "tests/faults/naming-option-ignored.patch",
    describe:
      "normalizeParsed()'s nameProperty auto-detection (detectNameProperty()) is dropped -- " +
      "leaving nameProperty out again silently never uses a feature's own name/title/label, the " +
      "exact regression docs/upload.md's documented naming option was in since it was written " +
      "(Opus finding, Q2 fix)",
    gate: [
      "npx",
      "vitest",
      "run",
      "tests/geo/upload/rules.test.ts",
      "-t",
      "picks up a 'name' property with no nameProperty option at all",
    ],
  },
  {
    id: "analytics-logurl-unwired",
    patch: "tests/faults/analytics-logurl-unwired.patch",
    describe:
      "Shell.svelte's createAnalytics({...}) call drops its `logUrl: analyticsLogUrl()` line -- " +
      "the Sheet-log beacon goes back to a silent no-op no matter what VITE_LOG_URL is set to",
    gate: ["npx", "vitest", "run", "tests/analytics/logUrl.wiring.test.ts"],
  },
  {
    id: "hex-promoteid-dropped",
    patch: "tests/faults/hex-promoteid-dropped.patch",
    describe:
      "hexSource() drops `promoteId: FID` -- the vector features' ids are no longer the hex FID, so " +
      "setFeatureState({id}) keys on nothing and the whole hex layer silently paints transparent",
    gate: ["npx", "vitest", "run", "tests/map/hex.test.ts", "-t", "promoteId"],
  },
  {
    id: "catalog-base-accepts-http",
    patch: "tests/faults/catalog-base-accepts-http.patch",
    describe:
      "validateCatalogBase() stops requiring https -- a crafted ?catalog=http://... link could " +
      "redirect every catalog data read to an arbitrary plain-http origin",
    gate: ["npx", "vitest", "run", "tests/catalog/base.test.ts"],
  },
  {
    id: "dims-snap-ignores-changed",
    patch: "tests/faults/dims-snap-ignores-changed.patch",
    describe:
      "snapItem() no longer requires the dimension the viewer just changed to agree -- choosing a " +
      "taxon with no item at the current season could jump to a different taxon entirely",
    gate: ["npx", "vitest", "run", "tests/catalog/dims.test.ts", "-t", "snapItem"],
  },
  {
    id: "analytics-ga-id-baked",
    patch: "tests/faults/analytics-ga-id-baked.patch",
    describe:
      "createAnalytics() falls back to a built-in GA4 measurement id when none is configured -- " +
      "the GA leg is no longer OFF by default and an id ships in the repo again",
    gate: ["npx", "vitest", "run", "tests/analytics/analytics.test.ts", "-t", "GA is OFF"],
  },
  // --- V1 (P round, 2026-09-24, Opus eyes-on review on the real 0.10.55 build): five owner-facing ---
  {
    id: "category-label-raw-key-reverted",
    patch: "tests/faults/category-label-raw-key-reverted.patch",
    describe:
      "categoryLabel()'s known-category branch reverts to returning the raw string verbatim -- " +
      '"primprod"/"bird" show in the report\'s tables and the app\'s component/species tables ' +
      'again instead of "Primary producer"/"Bird"',
    gate: [
      "npx",
      "vitest",
      "run",
      "tests/ui/categories.test.ts",
      "-t",
      "resolves to its local table label",
    ],
  },
  {
    id: "health-5xx-treated-as-empty",
    patch: "tests/faults/health-5xx-treated-as-empty.patch",
    describe:
      "classifyMapTileError folds any status >= 500 into the 403/404 'empty' (missing-tile) " +
      "branch -- a real titiler-v8 outage would be silently ignored the same way a normal " +
      "release-side gap already is, instead of raising the health banner",
    gate: ["npx", "vitest", "run", "tests/health/mapError.test.ts"],
  },
  // --- P round V5 (Opus eyes-on follow-up on 0.10.59) --------------------------------------------
  {
    id: "species-card-category-raw-reverted",
    patch: "tests/faults/species-card-category-raw-reverted.patch",
    describe:
      "speciesCard()'s Category fact reverts to the raw sp_cat string -- the species lens sidebar " +
      'reads "Category: turtle"/"mammal" lowercase again (Opus eyes-on desktop-17/18)',
    gate: [
      "npx",
      "vitest",
      "run",
      "tests/lens/species/card.test.ts",
      "-t",
      "title-cases the Category fact",
    ],
  },
  {
    id: "health-probe-404-treated-as-down",
    patch: "tests/faults/health-probe-404-treated-as-down.patch",
    describe:
      "probeUrl() reverts to the pre-fix `!res.ok` gate -- any non-2xx (including the 403/404 a " +
      "hermetic fixture's own app/boot.json legitimately answers) is misclassified as `down` again, " +
      "not just a real 5xx/network-error/timeout",
    gate: ["npx", "vitest", "run", "tests/health/probe.test.ts"],
  },
  // --- P round, W2 (Ben's live-review of 0.10.62, 2026-09-24): the Layers panel's spatial-unit
  {
    id: "species-inputs-table-emptied",
    patch: "tests/faults/species-inputs-table-emptied.patch",
    describe:
      "inputsTableRows() (item 7: the species Table tool showed a permanent placeholder) returns " +
      "`[]` unconditionally instead of reshaping the LayerBar's own pills -- the Table tool goes " +
      "back to 'no inputs' for every species, real or not",
    gate: ["npx", "vitest", "run", "tests/lens/species/inputsTable.test.ts"],
  },
  // --- P round W5 (Opus 5.5 eyes-on review 5 of 0.10.66) ------------------------------------------
  {
    id: "desktop-panel-inset-gutter-dropped",
    patch: "tests/faults/desktop-panel-inset-gutter-dropped.patch",
    describe:
      "chromePadding.ts's desktopPanelPadding() reverts panelReserve to the bare geometry.size -- " +
      "the docked panel's own outer CSS inset (--space-3) and the fit's breathing gutter both drop " +
      "out, so the reserve no longer clears the panel's real DOM footprint (desktop-19). A plain " +
      "vitest gate (exact, deterministic) rather than the e2e pixel-margin check: GAA's own bbox " +
      "still lands with enough natural slack under either reserve in the hermetic fixture's " +
      "geometry for a fuzzy 5x5-grid/margin check to stay green either way, but the exact returned " +
      "dock-side value cannot -- see tests/map/chromePadding.test.ts's own 'W5 regression' case.",
    gate: [
      "npx",
      "vitest",
      "run",
      "tests/map/chromePadding.test.ts",
      "-t",
      "W5 regression: the dock-side reserve clears the panel's real outer edge",
    ],
  },
  {
    id: "phone-fit-gutter-dropped",
    patch: "tests/faults/phone-fit-gutter-dropped.patch",
    describe:
      "chromePadding.ts's phonePaddingFromMeasured() drops its left/right FIT_GUTTER_PX -- the " +
      "LIVE phone zone/species-model fit has no side gutter again, so a fitted outline can land " +
      "flush against the viewport's own edge (phone-19: GAA's east outline touching x 779 of 780). " +
      "A plain vitest gate (exact, deterministic): like the desktop entry above, GAA's own bbox in " +
      "the hermetic e2e fixture happens to clear 16px either way (a narrower/differently-placed " +
      "bbox would not), so the exact returned left/right values are the reliable catch.",
    gate: ["npx", "vitest", "run", "tests/map/chromePadding.test.ts", "-t", "a side gutter"],
  },
  {
    id: "svgwrapper-footer-text-dropped",
    patch: "tests/faults/svgwrapper-footer-text-dropped.patch",
    describe:
      "R3-W2: buildMapSvg() (src/lib/download/svgWrapper.ts) drops the two footer <text> elements " +
      "-- the Download menu's 'Map view · SVG' export keeps its background band but loses the " +
      "title/unit/app/version/share-URL line entirely, silently",
    gate: ["npx", "vitest", "run", "tests/download/svgWrapper.test.ts"],
  },
  // --- round 3, W3 (app nits with a known fix) ----------------------------------------------------
  // --- round 3, W6 (consistency slice A: shell + shared UI) ---------------------------------------
  // --- round 3, W7 (consistency + copy, Ben's popup-sparkline ask) --------------------------------
  {
    id: "sparkline-marker-unclamped",
    patch: "tests/faults/sparkline-marker-unclamped.patch",
    describe:
      "density.ts's markerX() drops its clamp to [0, 1] -- a clicked value outside the " +
      "legend axis's own range (a stale/rounding edge case) now places the legend " +
      "marker line OFF the chart instead of pinned to the nearest end (R4-A: retargeted from " +
      "the retired popup sparkline)",
    gate: ["npx", "vitest", "run", "tests/lib/map/density.test.ts"],
  },
  // --- round 3, W8 (species Layers pane: promote data selection, zoom-to-layer, Share reproduces
  // the UI arrangement) --------------------------------------------------------------------------
  // R4-C: Tabs' keyboard roving (`tabsKeys.ts`) -- arrows stop moving the selection.
  {
    id: "tabs-arrow-keys-dead",
    patch: "tests/faults/tabs-arrow-keys-dead.patch",
    describe:
      "tabsKeys.ts's tabsKeyTarget() returns null for every Arrow key -- Tabs.svelte's Left/Right " +
      "no longer move or select a tab (Home/End still do)",
    gate: ["npx", "vitest", "run", "tests/ui/tabsKeys.test.ts"],
  },
  {
    id: "ui-token-dock-dropped",
    patch: "tests/faults/ui-token-dock-dropped.patch",
    describe:
      "uiState.ts's formatUi() hardcodes the dock field to 'bottom' instead of encoding the " +
      "live panel dock it was handed -- a Share link built while docked left/right silently " +
      "reopens docked bottom instead of reproducing the arrangement the viewer actually saw",
    gate: ["npx", "vitest", "run", "tests/shell/uiState.test.ts"],
  },
  // R3-W8 item 4: the `ui=` token grew a 7th field (`tab`, version bumped 1 -> 2) for the Layers
  // pane's own two tabs -- same class of bug as `ui-token-dock-dropped` above, one field over.
  {
    id: "ui-token-tab-dropped",
    patch: "tests/faults/ui-token-tab-dropped.patch",
    describe:
      "uiState.ts's formatUi() hardcodes the tool field to 'layers' instead of encoding the live " +
      "tool (R4-B: regenerated from the retired `tab` field, whose info tab is now the Details " +
      "tool) -- a Share link built from Details silently reopens on Layers instead of " +
      "reproducing what was showing",
    gate: ["npx", "vitest", "run", "tests/shell/uiState.test.ts"],
  },
  // --- round 4, R4-A (the histogram moves into the legend) -------------------------------------
  {
    id: "legend-histogram-keyed-by-click",
    patch: "tests/faults/legend-histogram-keyed-by-click.patch",
    describe:
      "distribution.ts's layerHistogramKey() appends the clicked element -- every click on the " +
      "same layer builds its own histogram, so the legend's shape varies from click to click " +
      "(Ben: it must represent the whole layer; only the marker follows a click)",
    gate: ["npx", "vitest", "run", "tests/lib/map/distribution.test.ts"],
  },
  // --- WP4 (places: overlays, summaries, the inside-places filter) -------------------------------
  {
    id: "pip-antimeridian-unshifted",
    patch: "tests/faults/pip-antimeridian-unshifted.patch",
    describe:
      "pointInArea() stops trying a point at +/-360 -- a hex centroid at -175 is no longer inside an " +
      "unwrapped place spanning 170..190, so every antimeridian place summarises to zero cells",
    gate: ["npx", "vitest", "run", "tests/geo/pip.test.ts"],
  },
  {
    id: "summary-null-counted-as-zero",
    patch: "tests/faults/summary-null-counted-as-zero.patch",
    describe:
      "cellStats() reads a cell with no value as 0 -- the mean drops, the min becomes 0 and the " +
      "no-value share disappears (no data is not zero)",
    gate: ["npx", "vitest", "run", "tests/places/summary.test.ts"],
  },
  {
    id: "statistics-bidx-dropped",
    patch: "tests/faults/statistics-bidx-dropped.patch",
    describe:
      "the raster statistics source never sends the band (bidx) -- a multi-band COG is summarised " +
      "on band 1 whatever the map draws (the coefficient of variation shows the density's numbers)",
    gate: ["npx", "vitest", "run", "tests/raster/statistics.test.ts"],
  },
  {
    id: "overlay-card-cell-line-dropped",
    patch: "tests/faults/overlay-card-cell-line-dropped.patch",
    describe:
      "the overlay popup forgets the hex cell's value line -- a click on a place over a cell shows " +
      "the place only",
    gate: ["npx", "vitest", "run", "tests/map/clickInfo.test.ts"],
  },
  {
    id: "hex-hover-ignores-overlay",
    patch: "tests/faults/hex-hover-ignores-overlay.patch",
    describe:
      "the hex hover popup does not yield to an overlay feature over the same point -- two popups " +
      "stack (the gate: a hover over an overlay builds no hex popup)",
    gate: ["npx", "vitest", "run", "tests/map/clickInfo.test.ts"],
  },
  {
    id: "raster-source-bounds-dropped",
    patch: "tests/faults/raster-source-bounds-dropped.patch",
    describe:
      "a raster item's COG footprint never reaches the MapLibre source `bounds` -- every world tile " +
      "is requested again and the regional COG 404s the ones outside it",
    gate: ["npx", "vitest", "run", "tests/lens/collection/mstMapInputs.test.ts"],
  },
  {
    id: "vector-only-model-undrawable",
    patch: "tests/faults/vector-only-model-undrawable.patch",
    describe:
      "surfaceFor() never finds a PMTiles range for a model with no COG -- a vector-only v7 model shows " +
      "the 'cannot draw' notice again instead of a presence fill",
    gate: ["npx", "vitest", "run", "tests/catalog/mst/taxon.test.ts"],
  },
  {
    id: "collection-url-accepts-http",
    patch: "tests/faults/collection-url-accepts-http.patch",
    describe:
      "validateCollectionUrl() accepts plain http -- a ?collection= link can point the app's reads at an " +
      "unencrypted origin",
    gate: ["npx", "vitest", "run", "tests/catalog/unlisted.test.ts"],
  },
  {
    id: "markdown-html-passthrough",
    patch: "tests/faults/markdown-html-passthrough.patch",
    describe:
      "the README renderer stops escaping text -- raw HTML (a <script>) in a methods file is passed " +
      "through into the Methods dialog",
    gate: ["npx", "vitest", "run", "tests/lib/markdown.test.ts"],
  },
  {
    id: "markdown-javascript-links",
    patch: "tests/faults/markdown-javascript-links.patch",
    describe:
      "the README renderer lets a javascript: URL keep its href -- a [click](javascript:...) link " +
      "in a methods file runs script in the app's origin",
    gate: ["npx", "vitest", "run", "tests/lib/markdown.test.ts"],
  },
  {
    id: "layer-info-no-bucket-fallback",
    patch: "tests/faults/layer-info-no-bucket-fallback.patch",
    describe:
      "a place layer's collection.json is asked of the canonical host only -- the host's 302 has no CORS, so " +
      "the info dialog never gets the collection in a browser (no fallback to the bucket URL)",
    gate: ["npx", "vitest", "run", "tests/gazetteer/layerInfo.test.ts"],
  },
  {
    id: "ov-default-set-written",
    patch: "tests/faults/ov-default-set-written.patch",
    describe:
      "formatOv() writes the default overlay set into the URL -- the default view stops being an " +
      "empty link and a later change to the default silently changes old links",
    gate: ["npx", "vitest", "run", "tests/gazetteer/overlayUrl.test.ts"],
  },
  {
    id: "hex-inside-flag-inverted",
    patch: "tests/faults/hex-inside-flag-inverted.patch",
    describe:
      "the hex painter flags cells inside a place as outside -- 'Only inside places' dims exactly " +
      "the cells it should keep",
    gate: ["npx", "vitest", "run", "tests/map/hex.test.ts", "-t", "inside"],
  },
  {
    id: "centroid-null-key-is-cell-zero",
    patch: "tests/faults/centroid-null-key-is-cell-zero.patch",
    describe:
      "centroidsFromRows() reads a null FID as 0 (Number(null)) -- a bad row becomes a phantom cell 0 " +
      "that can be counted inside a place",
    gate: ["npx", "vitest", "run", "tests/places/summary.test.ts", "-t", "non-finite"],
  },
  // --- WP7 (registry-backed taxon collections: AquaMaps native 0.5 degree) --------------------------
  {
    id: "registry-item-template-ignored",
    patch: "tests/faults/registry-item-template-ignored.patch",
    describe:
      "registryItem() draws every row with a constant rescale and colormap instead of the collection's " +
      "item template -- a collection that rescales or colours differently is painted wrongly",
    gate: ["npx", "vitest", "run", "tests/catalog/registry/item.test.ts"],
  },
  {
    id: "registry-rep-005-ignored",
    patch: "tests/faults/registry-rep-005-ignored.patch",
    describe:
      "effectiveRep() never leaves native -- rep=005 and the Downscaled switch keep drawing the 0.5 " +
      "degree COG",
    gate: ["npx", "vitest", "run", "tests/catalog/registry/item.test.ts"],
  },
  // --- round 4, R4-B (the rail attaches to the panel; four tabs; left by default) ---------------
  // --- round 4, R4-D (the Report tool is one flow, no sub-tabs) ---------------------------------
  // --- round 4 CI-red follow-up (R4-ci): the globe's empty viewport query ----------------------
];

/** usability B1: a fault whose gate boots a real DuckDB-WASM needs the gitignored extension mirror
 * in its throwaway worktree, or the gate fails for a reason that has nothing to do with the fault. */
function provisionDuckdbExt(worktreeDir) {
  const mirror = join(ROOT, "public", "duckdb-ext");
  if (existsSync(mirror)) {
    cpSync(mirror, join(worktreeDir, "public", "duckdb-ext"), { recursive: true });
    return null;
  }
  const fetched = run("node", ["scripts/fetch-duckdb-extensions.mjs"], worktreeDir);
  return fetched.status === 0 ? null : `fetch-duckdb-extensions failed: ${fetched.stderr}`;
}

function run(cmd, args, cwd, env) {
  return spawnSync(cmd, args, {
    cwd,
    encoding: "utf8",
    env: env ? { ...process.env, ...env } : process.env,
    // a Playwright gate's own `webServer` build+preview can take a minute; the default 1 MB stdout
    // cap is also far too small for its output, and an exceeded cap kills the child (status null),
    // which would read as "went red" for the wrong reason.
    maxBuffer: 64 * 1024 * 1024,
    timeout: 10 * 60 * 1000,
  });
}

function runOne(fault) {
  const patchPath = join(ROOT, fault.patch);
  if (!existsSync(patchPath)) {
    return { ok: false, fault, reason: `missing patch file ${fault.patch}` };
  }

  const tmpBase = process.env.TMPDIR ?? tmpdir();
  const worktreeDir = mkdtempSync(join(tmpBase, `test-faults-${fault.id}-`));
  // mkdtempSync already created worktreeDir as an empty directory; `git worktree add` refuses a
  // non-empty target but is fine with an EMPTY one that already exists, so remove it first and
  // let git create it fresh at the same path.
  rmSync(worktreeDir, { recursive: true, force: true });

  try {
    const add = run("git", ["worktree", "add", "--detach", "--quiet", worktreeDir, "HEAD"], ROOT);
    if (add.status !== 0) {
      return { ok: false, fault, reason: `git worktree add failed: ${add.stderr || add.stdout}` };
    }

    // node_modules is not tracked by git, so the fresh worktree has none; symlinking the one this
    // checkout already has avoids an `npm ci` per fault (this script may run several times a day).
    symlinkSync(join(ROOT, "node_modules"), join(worktreeDir, "node_modules"));

    const apply = run("git", ["apply", patchPath], worktreeDir);
    if (apply.status !== 0) {
      return {
        ok: false,
        fault,
        reason: `git apply failed (patch does not apply to HEAD -- rebuild it): ${apply.stderr || apply.stdout}`,
      };
    }

    if (fault.duckdbExt) {
      const missing = provisionDuckdbExt(worktreeDir);
      if (missing) return { ok: false, fault, reason: missing };
    }

    const gate = run(fault.gate[0], fault.gate.slice(1), worktreeDir, fault.env);
    // status null = killed (timeout/signal), which is NOT the same thing as "the gate failed" --
    // report it as a fault that could not be judged rather than silently counting it as red.
    if (gate.status === null) {
      return {
        ok: false,
        fault,
        reason: `the gate was killed before it could report (${gate.error?.message ?? "signal"})`,
        output: (gate.stdout ?? "") + (gate.stderr ?? ""),
      };
    }
    const wentRed = gate.status !== 0;
    const output = gate.stdout + gate.stderr;
    // red for the RIGHT reason: every `redMatches` pattern must appear in the gate's output
    const wrongReason = wentRed ? (fault.redMatches ?? []).find((re) => !re.test(output)) : null;
    return {
      ok: wentRed && !wrongReason,
      fault,
      reason: !wentRed
        ? `the gate stayed GREEN with the fault applied -- it cannot fail, so it is not a check`
        : wrongReason
          ? `the gate went red, but not for this fault's reason (no match for ${wrongReason})`
          : undefined,
      output,
    };
  } finally {
    // --force: the worktree holds an applied-but-uncommitted patch, which a plain `remove` refuses.
    run("git", ["worktree", "remove", "--force", worktreeDir], ROOT);
    rmSync(worktreeDir, { recursive: true, force: true });
  }
}

// atlas-4 fix round 3: `--only <id>` runs a single named entry (its `id` field) instead of the
// whole manifest -- a fix round that adds one or two faults should be able to prove just those
// without paying for the other ~25 (a real browser build each), the same way a fresh round would
// want to verify its own work in isolation. `<id>` must be an exact match against a real entry;
// an unknown one fails loudly rather than silently running everything (a typo here would
// otherwise "pass" by running the wrong thing).
function faultsToRun() {
  const onlyIdx = process.argv.indexOf("--only");
  if (onlyIdx === -1) return FAULTS;
  const id = process.argv[onlyIdx + 1];
  const match = FAULTS.filter((f) => f.id === id);
  if (match.length === 0) {
    process.stderr.write(
      `test-faults: --only ${id ?? "<missing>"} matches no entry in FAULTS (known ids: ` +
        `${FAULTS.map((f) => f.id).join(", ")})\n`,
    );
    process.exit(1);
  }
  return match;
}

function main() {
  if (!process.env.TMPDIR) {
    process.stderr.write(
      "test-faults: TMPDIR is not set -- export it first (see CLAUDE.md/the dispatch instructions); " +
        "refusing to fall back to the system /tmp for a throwaway git worktree.\n",
    );
    process.exit(1);
  }

  const faults = faultsToRun();
  const head = execFileSync("git", ["rev-parse", "--short", "HEAD"], {
    cwd: ROOT,
    encoding: "utf8",
  }).trim();
  process.stdout.write(`test-faults: ${faults.length} fault(s), worktreed off HEAD (${head})\n\n`);

  const rows = [];
  let failed = false;
  for (const fault of faults) {
    const result = runOne(fault);
    rows.push(result);
    if (result.ok) {
      process.stdout.write(`✓ RED as expected — ${fault.id}: ${fault.describe}\n`);
    } else {
      failed = true;
      process.stderr.write(`✗ ${fault.id}: ${fault.describe}\n`);
      process.stderr.write(`    ${result.reason}\n`);
      if (result.output) {
        process.stderr.write(
          result.output
            .split("\n")
            .slice(-15)
            .map((l) => `    | ${l}`)
            .join("\n") + "\n",
        );
      }
    }
  }

  process.stdout.write(
    `\ntest-faults: ${rows.filter((r) => r.ok).length}/${rows.length} faults turned their gate red\n`,
  );
  if (failed) {
    process.stderr.write("\nA seeded fault did NOT turn its gate red: the gate is not a gate.\n");
  }
  process.exit(failed ? 1 : 0);
}

// R3-D2: only run the (expensive, gate-running) main() when this file is executed directly --
// `import { FAULTS } from "./test-faults.mjs"` (scripts/check-faults-apply.mjs) must be a plain,
// side-effect-free read of the manifest.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
