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
  // --- 0.3.4: feedback from a collection under review never reaches a public place -----------------
  {
    id: "feedback-unlisted-not-restricted",
    patch: "tests/faults/feedback-unlisted-not-restricted.patch",
    describe:
      "collectionAccess() stops treating the unlisted picker group as restricted -- a report sent from a " +
      "?collection= share link is filed as a public GitHub issue with a screenshot again",
    gate: [
      "npx",
      "vitest",
      "run",
      "tests/feedback/restrictedCollection.test.ts",
      "-t",
      "regression 0.3.4",
    ],
  },
  {
    id: "feedback-restricted-posted",
    patch: "tests/faults/feedback-restricted-posted.patch",
    describe:
      "sendFeedback() drops its restricted guard -- a restricted report is POSTed even while restricted " +
      "reports are held back (RESTRICTED_MAY_SEND false)",
    gate: [
      "npx",
      "vitest",
      "run",
      "tests/feedback/restrictedCollection.test.ts",
      "-t",
      "never POSTed",
    ],
  },
  {
    id: "feedback-access-unwired",
    patch: "tests/faults/feedback-access-unwired.patch",
    describe:
      "Shell.svelte stops passing access={feedbackAccess} to the feedback dialog -- the 0.3.4 bug itself: " +
      "every report reads as public",
    gate: [
      "npx",
      "vitest",
      "run",
      "tests/feedback/restrictedCollection.test.ts",
      "-t",
      "wires the view's access",
    ],
  },
  // --- 0.3.5: restricted reports are filed publicly, so the share link must stay out of them ------
  {
    id: "feedback-share-link-in-issue",
    patch: "tests/faults/feedback-share-link-in-issue.patch",
    describe:
      "searchForAccess() keeps `collection`/`catalog` -- a report from a collection under review, filed as " +
      "a public issue since 0.3.5, carries the unlisted share link and so the data",
    gate: [
      "npx",
      "vitest",
      "run",
      "tests/feedback/restrictedCollection.test.ts",
      "-t",
      "never carries the share link",
    ],
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
      "the instance's defaults.theme (DEFAULT_SEL.theme, instances/oceanmetrics/instance.json since " +
      '0.4.0) reverts from "dark" to "auto" -- a first-time visitor on a light-OS system sees the ' +
      "paper theme again, undoing U2a's default-theme change",
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
  // --- WP13: the live camera padding ----------------------------------------------------------------
  {
    id: "live-padding-open-share-dropped",
    patch: "tests/faults/live-padding-open-share-dropped.patch",
    describe:
      "livePadding() stops enforcing MIN_OPEN_SHARE on the sides -- a panel wide enough to leave under " +
      "40% of the stage open still pads sideways, so the map's centre (and the globe) is pushed into a " +
      "sliver and off screen (the obis-hex rule this was copied from). A plain vitest gate on exact " +
      "values.",
    gate: ["npx", "vitest", "run", "tests/map/livePadding.test.ts", "-t", "less than 40%"],
  },
  {
    id: "live-padding-bottom-share-dropped",
    patch: "tests/faults/live-padding-bottom-share-dropped.patch",
    describe:
      "livePadding() pads the bottom for a full-height phone sheet -- it leaves under 40% of the " +
      "height, so the centre is drawn in a sliver at the top of the stage.",
    gate: ["npx", "vitest", "run", "tests/map/livePadding.test.ts", "-t", "full height"],
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
  // --- WP14 (the legend histogram of raster items) -----------------------------------------------
  {
    id: "raster-histogram-empty-kept",
    patch: "tests/faults/raster-histogram-empty-kept.patch",
    describe:
      "parseTitilerStatistics() keeps a histogram whose counts are all zero -- a raster layer with no " +
      "pixel inside the legend range draws an empty chart instead of none",
    gate: [
      "npx",
      "vitest",
      "run",
      "tests/raster/histogram.test.ts",
      "-t",
      "empty: no counted pixel",
    ],
  },
  {
    id: "raster-histogram-key-drops-band",
    patch: "tests/faults/raster-histogram-key-drops-band.patch",
    describe:
      "rasterHistogramKey() leaves the band out of the key -- band 2 (the CV) of a multi-band COG is " +
      "served band 1's cached histogram",
    gate: [
      "npx",
      "vitest",
      "run",
      "tests/raster/histogram.test.ts",
      "-t",
      "the key separates bands",
    ],
  },
  {
    id: "autozoom-map-param-ignored",
    patch: "tests/faults/autozoom-map-param-ignored.patch",
    describe:
      "shouldAutoZoom() ignores a `map=` in the opening link -- the first layer flies the camera away " +
      "from a shared view on load",
    gate: ["npx", "vitest", "run", "tests/map/autoZoom.test.ts", "-t", "map= wins on load"],
  },
  {
    id: "dim-note-taxon-not-first",
    patch: "tests/faults/dim-note-taxon-not-first.patch",
    describe:
      "unavailableNote() stops asking the taxon-like sibling first -- 'Atlantic' with a Pacific-only " +
      "species is blamed on the first sibling instead of 'no <species> model'",
    gate: [
      "npx",
      "vitest",
      "run",
      "tests/catalog/dimNotes.test.ts",
      "-t",
      "the taxon is blamed first",
    ],
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
    id: "cog-tile-url-drops-band",
    patch: "tests/faults/cog-tile-url-drops-band.patch",
    describe:
      "the browser COG's tile url loses the package's band key (`?b=<bidx>`) -- the eight EOV items are " +
      "bands of one file, so MapLibre serves one band's cached tiles for another",
    gate: ["npx", "vitest", "run", "tests/raster/cog.test.ts"],
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
  // --- WP12 (AquaMaps from MarineSensitivity v8: both boxes in the row, v7 keys mapped) ------------
  {
    id: "registry-005-uses-native-bbox",
    patch: "tests/faults/registry-005-uses-native-bbox.patch",
    describe:
      "registryItem() bounds the 0.05 degree surface with the native box -- tiles of the global " +
      "downscale outside the native footprint are never requested",
    gate: ["npx", "vitest", "run", "tests/catalog/registry/item.test.ts"],
  },
  {
    id: "registry-v7-key-unmapped",
    patch: "tests/faults/registry-v7-key-unmapped.patch",
    describe:
      "resolveRegistryKey() never maps a v7 key through sp_key_v7 -- an old ?sp= link lands on " +
      "'not in this collection's registry'",
    gate: ["npx", "vitest", "run", "tests/catalog/registry/item.test.ts"],
  },
  // --- round 4, R4-B (the rail attaches to the panel; four tabs; left by default) ---------------
  // --- round 4, R4-D (the Report tool is one flow, no sub-tabs) ---------------------------------
  // --- round 4 CI-red follow-up (R4-ci): the globe's empty viewport query ----------------------
  // --- build week 4: moved with the MarineSensitivity modules (MarineSensitivity/atlas 0.10.93) ------
  // the vitest-gated faults of the Scores lens, the Report, the release registry and the zone places;
  // each gate runs under the instance that builds the module (vitest.config.ts, one project per
  // instance). Their e2e-gated twins stay with the MST Playwright specs, not moved this week.
  {
    id: "scores-footnote-floor-reverted",
    patch: "tests/faults/scores-footnote-floor-reverted.patch",
    describe:
      "scores.ts#COVERAGE_FOOTNOTE_FLOOR_PCT reverted from 99 to 100 -- a component at 99.9% " +
      "coverage footnotes again, and a fully-covered place with one component at 99.9% gets a " +
      "footnote it should not (the original 'footnotes almost every cell' bug, replayed)",
    gate: ["npx", "vitest", "run", "tests/lib/report/scores.test.ts"],
  },
  {
    id: "popup-no-value-cellid-title",
    patch: "tests/faults/popup-no-value-cellid-title.patch",
    describe:
      "cellPopupText() drops its no-value branch -- a click outside the scored area is back to " +
      "'Cell {id} ... {long layer title}: 0' instead of 'No scored cell here' (D3, the owner's " +
      "original Utah-click defect)",
    gate: ["npx", "vitest", "run", "tests/lens/scores/popup.test.ts"],
  },
  {
    id: "places-missing-tile-treated-as-error",
    patch: "tests/faults/places-missing-tile-treated-as-error.patch",
    describe:
      "isMissingTileStatus() always returns false -- a release-side gap (a tile the release " +
      "never generated, 403/404) is treated as a real failure again, so a place spanning a " +
      "missing tile rejects instead of showing a composite from the tiles that DID exist",
    gate: ["npx", "vitest", "run", "tests/analysis/missingTile.test.ts"],
  },
  {
    id: "places-zonestats-flat-composite",
    patch: "tests/faults/places-zonestats-flat-composite.patch",
    describe:
      "compositeOf() stops reading metrics[compositeMetricKey] -- a Program-Area row falls back " +
      "to the flat composite/score fields no real release publishes, so it reads 'not published' " +
      "forever even when the release DID publish a composite",
    gate: [
      "npx",
      "vitest",
      "run",
      "tests/places/zoneStats.test.ts",
      "-t",
      "REAL v7 boot.json shape",
    ],
  },
  {
    id: "scores-search-matcher-empty",
    patch: "tests/faults/scores-search-matcher-empty.patch",
    describe:
      "matchZones() reads zoneRows(boot, '') instead of the real unit -- the top-bar Scores " +
      "search matcher against Program Areas/subregions/ecoregions always finds nothing, for " +
      "any query (Q1 round, owner-reported: the search box did nothing at all)",
    gate: ["npx", "vitest", "run", "tests/lens/scores/search.test.ts"],
  },
  {
    id: "programarea-names-fallback-dropped",
    patch: "tests/faults/programarea-names-fallback-dropped.patch",
    describe:
      "paLabel() reverts to its pre-V1 shape -- no PROGRAM_AREA_NAMES fallback, no `unit` " +
      "scoping -- so a Program Area key with no bundle-published `name` (every real release " +
      "through v9) falls straight back to the bare acronym, exactly Ben's live complaint",
    gate: [
      "npx",
      "vitest",
      "run",
      "tests/places/zoneStats.test.ts",
      "-t",
      "PROGRAM_AREA_NAMES fallback",
    ],
  },
  {
    id: "report-common-name-casing-dropped",
    patch: "tests/faults/report-common-name-casing-dropped.patch",
    describe:
      "formatCommonName() stops sentence-casing and prints a source common name verbatim again -- " +
      '"great hammerhead shark" reappears lowercase in the Top-20 table (Opus eyes-on desktop-15)',
    gate: ["npx", "vitest", "run", "tests/lib/report/format.test.ts", "-t", "formatCommonName"],
  },
  {
    id: "scores-search-name-fallback-lost",
    patch: "tests/faults/scores-search-name-fallback-lost.patch",
    describe:
      "matchZones()'s rank call reverts to the bundle's raw z.name, dropping resolvedZoneName()'s " +
      "PROGRAM_AREA_NAMES fallback -- on a real release (no published zones.programarea[*].name), " +
      'typing a Program Area\'s full name ("Aleutian", "Gulf of Alaska") finds nothing again, ' +
      'even though the dropdown\'s own option still reads "Aleutian Arc (ALA)" (V6 round, ' +
      "owner-reported: found while shooting the Program Area harness state)",
    gate: ["npx", "vitest", "run", "tests/lens/scores/search.test.ts"],
  },
  {
    id: "zonebbox-rings-dropped",
    patch: "tests/faults/zonebbox-rings-dropped.patch",
    describe:
      "zoneBboxFromFeatures() (zoneStats.ts, item 1: the Scores search field never flew the camera " +
      "to a chosen Program Area) hardcodes `polygons: Ring[][] = []` instead of calling " +
      "ringsFromFeatures() -- always returns null, so a zone search pick falls straight through to " +
      "the (currently unpublished) label_pt fallback again",
    gate: ["npx", "vitest", "run", "tests/places/zoneStats.test.ts"],
  },
  {
    id: "aquamaps-citation-spacing-not-fixed",
    patch: "tests/faults/aquamaps-citation-spacing-not-fixed.patch",
    describe:
      "fixKnownCitationTypos() (cite.ts, W3 item 6) becomes a no-op -- the AquaMaps dataset's own " +
      "published citation runs 'UnportedLicense' together again in the report's Sources list",
    gate: ["npx", "vitest", "run", "tests/release/cite.test.ts"],
  },
  {
    id: "metric-key-label-reverted",
    patch: "tests/faults/metric-key-label-reverted.patch",
    describe:
      "R3-W1 (round-3 plan, R3-B1, fix round): boot.ts's metricKeyLabel() drops its `label` " +
      "argument entirely (back to a bare 'title-case the key' pass-through) -- a REAL, curated " +
      "label (e.g. primprod's real manifest.metrics text) is no longer returned verbatim, " +
      "overwritten by the title-cased key instead; the degenerate-label case ('score' curated as " +
      "'score') keeps working by coincidence (title-casing the key either way), so this exercises " +
      "the OTHER half of the same function -- a real label must win over the key, not just an " +
      "absent one must fall back to it.",
    gate: ["npx", "vitest", "run", "tests/lens/scores/boot.test.ts", "-t", "metricKeyLabel"],
  },
  {
    id: "docsurl-always-root",
    patch: "tests/faults/docsurl-always-root.patch",
    describe:
      "atlasDocsUrl() reverts to unconditionally returning DOCS_ROOT (P10: Help > Docs used to " +
      "open the book's Preface instead of the release's Atlas chapter) -- a pure function, so " +
      "this is a plain vitest gate like rmod-guard-drop above; the real-browser property (the " +
      "rendered Shell.svelte href) is covered separately by e2e/shell.chrome.spec.ts's " +
      "'P10: Help > Docs' block, proven red-first by hand against the pre-fix Shell.svelte.",
    gate: ["npx", "vitest", "run", "tests/release/docsUrl.test.ts"],
  },
  {
    id: "out-outline-ignored",
    patch: "tests/faults/out-outline-ignored.patch",
    describe:
      "zoneUnitsWithOutline() stops reading `out` -- G-25's exact regression (out=none no " +
      "longer hides the zone outline), replayed against the real function",
    gate: ["npx", "vitest", "run", "tests/map/style.mst.test.ts", "-t", "G-25"],
  },
  {
    id: "report-map-summary-coloured-reverted",
    patch: "tests/faults/report-map-summary-coloured-reverted.patch",
    describe:
      "describeMap()'s summary sentence reverts to \"coloured\" -- the same report's map caption " +
      "and desktop map intro spell the word two different ways again (Opus eyes-on)",
    gate: ["npx", "vitest", "run", "tests/lib/report/model.test.ts", "-t", "spells 'colored'"],
  },
  {
    id: "report-species-counts-category-raw-reverted",
    patch: "tests/faults/report-species-counts-category-raw-reverted.patch",
    describe:
      "describeCounts()'s largest-category clause reverts to the raw sp_cat string -- the report's " +
      'species summary sentence reads "largest turtle 1" again instead of "largest Turtle 1"',
    gate: [
      "npx",
      "vitest",
      "run",
      "tests/lib/report/model.test.ts",
      "-t",
      "names the largest category through categoryLabel",
    ],
  },
  {
    id: "modeled-spelling-reverted",
    patch: "tests/faults/modeled-spelling-reverted.patch",
    describe:
      "model.ts's SOURCES_TEXT (W3 item 6) reverts 'modeled' back to the UK spelling 'modelled', " +
      "the one holdout in this app's otherwise-US-spelling report copy",
    gate: ["npx", "vitest", "run", "tests/lib/report/model.test.ts", "-t", "US spelling"],
  },
  {
    id: "flower-ring-fixed-at-100",
    patch: "tests/faults/flower-ring-fixed-at-100.patch",
    describe:
      "flowerGeometry.ts's computeFlowerReferenceRing() ignores maxScore and always returns the " +
      "FLOWER_MAX_FALLBACK (100) ring -- a release with a real, smaller published maximum still " +
      "draws its reference ring at the fixed outer edge",
    gate: ["npx", "vitest", "run", "tests/ui/flowerGeometry.test.ts", "-t", "a real maxScore"],
  },
  {
    id: "flower-category-label-reverted",
    patch: "tests/faults/flower-category-label-reverted.patch",
    describe:
      "computeFlowerGeometry() (flowerGeometry.ts, item 9: v1's real 'reptile' component rendered " +
      "as a flower petal literally labelled 'No data') drops the categoryLabel() override and goes " +
      "back to bare categoryFor(c.key) -- any unrecognized-but-real category is 'No data' again",
    gate: ["npx", "vitest", "run", "tests/lens/scores/flower.test.ts"],
  },
  {
    id: "places-geojson-name-fallback-reverted",
    patch: "tests/faults/places-geojson-name-fallback-reverted.patch",
    describe:
      "zoneDownload.ts's zoneFeature() reverts to the bare `p.keys.join(\", \")` for a zone place's " +
      "name (item 2: 'Download places' wrote the bare acronym instead of the release's full 'Name " +
      "(KEY)' label) instead of zoneDisplayName(zoneStatsFor(...))",
    gate: ["npx", "vitest", "run", "tests/places/zoneDownload.test.ts"],
  },
  {
    id: "pages-feedback-url-dropped",
    patch: "tests/faults/pages-feedback-url-dropped.patch",
    describe:
      "build-instance.yml's `vite build` step (the ONE build, which the thin MarineSensitivity " +
      "repo calls) loses its `VITE_FEEDBACK_URL` line -- the published build never picks up the " +
      "Apps Script endpoint no matter what the repository variable says, and 'Send feedback' can " +
      "never actually send",
    gate: ["npx", "vitest", "run", "tests/release/pagesEnvVars.wiring.test.ts"],
  },
  // --- build week 4: the instance module table and the release capability ----------------------
  {
    id: "instance-dist-unselected-marker-ignored",
    patch: "tests/faults/instance-dist-unselected-marker-ignored.patch",
    describe:
      "check-instance-dist stops looking for the markers of the modules an instance does NOT build -- " +
      "an oceanmetrics dist carrying the Scores lens (or a marinesensitivity dist carrying the " +
      "Collections lens) would pass the CI build check",
    gate: ["npx", "vitest", "run", "tests/instance-modules.test.ts"],
  },
  {
    id: "nav-false-selects-bar",
    patch: "tests/faults/nav-false-selects-bar.patch",
    describe:
      "a capability declared as `false` (`nav: false`) counts as turned on -- the marinesensitivity " +
      "instance would be held to the Ocean Metrics bar's markers and the dist check could not tell " +
      "a bar-less build from a broken one",
    gate: ["npx", "vitest", "run", "tests/instance-modules.test.ts"],
  },
  {
    id: "early-fetch-not-written",
    patch: "tests/faults/early-fetch-not-written.patch",
    describe:
      "renderInstanceHtml writes nothing at <!--instance:early-fetch--> -- an instance with a release " +
      "registry ships index.html and report.html with no access gate, and the app never resolves a release",
    gate: ["npx", "vitest", "run", "tests/release/inline-early-fetch.test.ts"],
  },
  // --- build week 4, step 5: the OBIS layer ---------------------------------------------------------
  {
    id: "obis-records-linear",
    patch: "tests/faults/obis-records-linear.patch",
    describe:
      "the OBIS layer paints records (`n`) on a linear ramp again -- 1 to 6.9 million records at res 2, " +
      "so almost every hexagon takes the bottom colour",
    gate: ["npx", "vitest", "run", "tests/obis/legend.test.ts", "-t", "log scale"],
  },
  {
    id: "obis-species-children-skipped",
    patch: "tests/faults/obis-species-children-skipped.patch",
    describe:
      "the Cell pane asks `speciesForCell` for the hexagon's own resolution instead of the table's (res 3) -- " +
      "a res-1 or res-2 hexagon is read as its own id, not its children's range, and lists no species",
    gate: ["npx", "vitest", "run", "tests/obis/cellSpecies.test.ts", "-t", "sum to the cell"],
  },
  {
    id: "obis-subtree-es-small-term-dropped",
    patch: "tests/faults/obis-subtree-es-small-term-dropped.patch",
    describe:
      "the subtree's ES(50) gives 0, not 1, to a species that leaves fewer than 50 records (obisindicators' " +
      "`WHEN t.n >= esn THEN 1`) -- a cell of two names at 30 records each has ES(50) 0 instead of 2",
    gate: ["npx", "vitest", "run", "tests/obis/subtree.test.ts", "-t", "hand-computed"],
  },
  {
    id: "obis-subtree-sp-counts-aphiaids",
    patch: "tests/faults/obis-subtree-sp-counts-aphiaids.patch",
    describe:
      "the subtree counts aphiaids instead of names (`name_key`, as h3t and the release do) -- a name " +
      "recorded under two AphiaIDs is two species, and the Animalia cell no longer equals the head",
    gate: ["npx", "vitest", "run", "tests/obis/subtree.test.ts", "-t", "two aphiaids"],
  },
  {
    id: "obis-lookup-read-twice",
    patch: "tests/faults/obis-lookup-read-twice.patch",
    describe:
      "the shared species lookup is not kept: the Cell pane's names after a subtree (or before) fetch the 4 MB " +
      "file again, two requests for one page",
    gate: ["npx", "vitest", "run", "tests/obis/subtreeCache.test.ts", "-t", "read once per page"],
  },
  {
    id: "obis-subtree-drops-held",
    patch: "tests/faults/obis-subtree-drops-held.patch",
    describe:
      "the class-file cache drops the least recently used file whether or not a computation holds it -- the " +
      "taxon and resolution on screen (or a run in flight) lose the table they are reading past the cap",
    gate: ["npx", "vitest", "run", "tests/obis/subtreeCache.test.ts", "-t", "class files kept"],
  },
  // --- build week 6 step 5: the species and Scores lenses draw release COGs from their 3857 copies ------
  {
    id: "release-cog-pending-titiler",
    patch: "tests/faults/release-cog-pending-titiler.patch",
    describe:
      "a species COG whose side-table answer is pending is drawn by titiler -- every v7 view asks titiler " +
      "for the first tiles of a COG the browser is about to draw",
    gate: ["npx", "vitest", "run", "tests/lens/species/mapInputs.test.ts", "-t", "pending"],
  },
  {
    id: "outside-pra-mask-titiler",
    patch: "tests/faults/outside-pra-mask-titiler.patch",
    describe:
      "the outside-Program-Area mask ignores its resolved 3857 copy and stays on titiler's colormap template",
    gate: [
      "npx",
      "vitest",
      "run",
      "tests/lens/scores/mapInputs.test.ts",
      "-t",
      "mask COG's own 3857 copy",
    ],
  },
  {
    id: "raster-tally-counts-hidden",
    patch: "tests/faults/raster-tally-counts-hidden.patch",
    describe:
      "the About tally counts a hidden layer (the mask switched off) as a raster drawn -- by titiler, " +
      "though it asks for no tile",
    gate: ["npx", "vitest", "run", "tests/raster/drawTally.test.ts", "-t", "hidden layer"],
  },
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
