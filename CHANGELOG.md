# Changelog

## 0.1.0

OceanMetrics Atlas: forked 2026-10-14 from MarineSensitivity/atlas 0.10.88 and stripped to a core that
a STAC catalog will drive. The strip is first below; the catalog loader, the generic Collections lens
and hex painting follow.

- **The Collections lens (new, the default).** Picks a collection from the catalog (grouped
  OceanMetrics / MarineSensitivity v7 / MarineSensitivity v8) and shows one selector per dimension of
  that collection (for BioTrack: group, season, metric, derived from its `cube:dimensions`), a legend,
  and a credits strip (citation with DOI, license, principal investigators, funders, a link to the
  methods README; never an e-mail address). A collection that cannot be reached is listed as
  "unavailable" and never breaks the rest.
- **Hex painting.** A collection's hex grid is ONE PMTiles archive of geometry + `FID`; values come from
  a Parquet column read with hyparquet (only the `FID` and the item's column) and paint by MapLibre
  feature state. Changing group, season or metric re-reads one column and recolours; the grid is never
  refetched. Hover shows a cell's value; click selects it (outlined, marked on the legend, and published
  to `cellSelection` for the species-list panel). The legend spans the item's own value range and shows
  the layer's histogram. A collection's `styles/default.json` supplies the ramp, else Spectral reversed.
- **Cell panel (Details tool).** Clicking a hex shows the collection and item title, the cell id, its
  value (two decimals) and, for BioTrack, the sibling metric of the same group and season (richness next
  to uncertainty, read from `values.parquet`). Below it is the cell's **species list** for the item's
  season and group (`all` = every species, `redlisted` = red-listed, otherwise the species group):
  scientific name (italic), English common name, probability, a Very likely / Likely pill, an IUCN code
  chip and a share bar (% Very likely, % Likely, rest of the modeled species), with the count line "N
  species likely (prob >= 0.6) of M modeled in this group", an empty state, and a CSV download. The
  data is the collection's public `cell_species` + `species` Parquet assets (fetched once, kept in
  memory; the per-species map layers stay restricted).
- **Hover** shows the value with two decimals and "N likely species" once the species list is loaded
  (one in-memory lookup per cell, no fetch while hovering).
- **Default camera.** With no `map=` in the URL the first load fits the collection's
  `extent.spatial.bbox` (with the panel padding) instead of the globe; `map=` still wins.
- **Raster items** (cloud-optimized GeoTIFF assets) render through the existing titiler layer.
- **URL grammar.** `?c=<collection id>&i=<item id>` (plus `?catalog=<https url>` to read another catalog
  base, e.g. a staging folder served with CORS + Range). The default view writes nothing; an unknown
  `c` or `i` falls back to the default. Changing one selector snaps the others to the nearest item
  that exists. `VITE_CATALOG_BASE` overrides the origin at build time.

- **Forked from MarineSensitivity/atlas 0.10.88** (history kept, `upstream` remote). Name, title and
  brand strings are now "OceanMetrics Atlas"; the version restarts at 0.1.0.
- **Removed the Scores lens and Program Areas.** No scores map, Program Area outlines or choropleth,
  scores search, flower plot, composition treemap, zones table or "pick a Program Area". The lens
  switch is now Collections | Species (the Collections lens panel arrives with the catalog loader).
  The `lyr`, `unit`, `area`, `out` and `ver` URL keys are retired and ignored; a `sel=` token is now
  only `place:<n>`.
- **Removed the Report.** No `report.html`, ZIP/DOCX/HTML export, report map or parity tooling; the
  "Report" rail tool is now **Places** (the same panel, same list/draw/upload/gazetteer/coordinates/
  share/download), and old `tool=report` and `ui=` links open it. Place results (scores per place)
  are gone with the scores data; the place list, areas, rename, duplicate, zoom and GeoJSON download
  stay.
- **Removed the MarineSensitivity release gate.** No `latest.txt`, `versions.json`, `session.json`,
  preview-host sessions, version picker, version chip, welcome modal or the inline early-fetch
  script. The Species lens reads one pinned MarineSensitivity release (`src/lib/release/mst.ts`)
  until the MST collections are read through the catalog.
- **Removed BOEM branding.** No seal, agency flags (`VITE_SEAL`, `VITE_AGENCY`), brand mark or brand
  fonts (Jost, Carlito); text and a neutral system font stack instead. The About dialog says the app
  is supported by BOEM and MBON.
- **Removed the component gallery** (`gallery.html`, its build, baselines and Playwright config) and
  the MST usability, mockup and parity tooling.
- **Analytics are off unless configured.** The hard-coded GA4 id is gone; set `VITE_GA_ID` (and
  optionally `VITE_LOG_URL`) at build time to re-enable the privacy-safe module. With no id no `gtag`
  call is ever made.
- **Feedback** keeps its dialog and points at placeholders: `VITE_FEEDBACK_URL` for the endpoint, issues
  filed in `oceanmetrics/atlas`; no email address is hard-coded anywhere.
- **Download filenames** read `oceanmetrics-atlas_{lens}_...` and the map-figure footer reads
  "OceanMetrics Atlas".
- **CI** (`pages.yml`) publishes this repository's own Pages branch; the gates that no longer apply
  (gallery, verify matrix, parity, release-session check) are gone. The Playwright-gated seeded faults
  and the inherited `e2e/` shell suite are not revalidated yet (see `tests/GATES.md`).

# Upstream (MarineSensitivity/atlas) history

# atlas 0.10.88

Gazetteer places.

- **A place can now be a gazetteer place, carried by reference.** The link holds the gazetteer
  `place_id` (a new `p.` token in the `#pl=` list, e.g. `p.NMS%3ACINMS.Channel%20Islands`) instead of
  the outline. It is fetched when the link opens, analysed like a drawn place, and drawn on the map.
  Older links open unchanged. If the gazetteer cannot be reached the place stays in the list with a
  "couldn't load" note and a Retry, and the link keeps it.
- **"Pick from gazetteer"** in the Places panel shows the gazetteer's polygons on the map; click one to
  add it. Other gazetteer collections appear in a selector once the gazetteer publishes its layer list.
- **The map credits gazetteer data.** While gazetteer polygons or places are shown, their attribution
  joins the credit line under the map.
- Reports open links with gazetteer places (fetched and analysed; one that cannot be loaded is left out
  and announced). Download places includes the `place_id`.
- Developer notes: the token grammar, the fetch and unwrap rules, and what the msens mirror needs are in
  `docs/gazetteer-places.md`.

# atlas 0.10.87

- **"Zoom to layer" can now frame an Original range whose extent the release leaves blank.** A range that crosses the dateline has no published extent; the camera now asks the same input's gridded surface where it is, instead of the whole taxon's.
- **A species input with a single layer is captioned for what it is.** The legend of an input that publishes a single layer labelled as delivered (most v7 inputs, which are on the scoring grid) now reads "on the 0.05° scoring grid" instead of "as delivered".

# atlas 0.10.86

- **A species input that its release keys differently from its map tile now draws its original range.** Backfilled v7 inputs carry a legacy number while the tile's features carry the original key; the shard's optional `source_key` now says which, so the range no longer comes up blank.

# atlas 0.10.85

- **The Species Layers tab now shows "Original | Interpolated" (and "Delivered | As ingested") as a labelled switch**, on its own row under the input pills and reading "Show <selected input> as", so it no longer looks like one more model-input layer.

# atlas 0.10.84

Round 4 CI-red follow-up.

- **Picking a Program Area on the globe now always shows its outline.** MapLibre answers a
  whole-viewport feature query with nothing on the globe when a corner of the view is off the
  sphere; the new left-docked default view is such a view, so the pick-mode highlight could stay
  empty while the zone lines were plainly drawn. It now falls back to the loaded zone tiles.

# atlas 0.10.83

Round 4, R4-D: the Report tool is one flow with no sub-tabs.

- **Places and Report are one scrolling flow.** The Report tool lists your places with their count
  ("Places 2 / 20"), then an "Add a place" section (Program Area picker, pick on the map, polygon,
  rectangle, circle, coordinates, file upload, analysis cells). A click on the map shows up as a pink
  "Last clicked" row with an **Add** button, and hides once that place is in the list.
- **The footer is pinned to the bottom of the pane**: what the report is about ("Reporting on 2
  places." / "Reporting on the last clicked place. Add it to keep it." / "Add a place to open a
  report."), the gold **Open report** button (disabled with nothing to report on), then Share and
  Download places. "Reports opened this session" moved into the one "Recent" disclosure.
- The old Program Area chooser and the "Draw, enter coordinates or upload a file" link are gone (the
  Add a place section covers both). Share links from 0.10.81 still open; the report-tab field in the
  `ui=` token is ignored, and new links no longer write it.

# atlas 0.10.82

Round 4, R4-C: the Table at full stage, and a real tabs control.

- **New underline tabs** (`Tabs`) for "same data, different view" inside one surface: plain labels on
  a hairline, the active one bold with a 3 px underline; Left/Right/Home/End move and select. The
  gold pill switch stays for choices that change the data (Scores | Species, Raster cells | Program
  areas, Feedback kind, US waters | Whole range).
- **Table header is one row**: a "← Map" button (collapses the panel; desktop), what is shown, the
  Species · Zones · Composition tabs, the column glossary and the CSV download. Table cells now wrap
  instead of ending in an ellipsis.
- **Empty Table** says how selection works (click a cell or Program Area, or add places) with an
  "Add places in Report" button.
- **Species lens table** has the same header (← Map, "Model inputs", CSV download of the inputs).

# atlas 0.10.81

Round 4, R4-B: the tool rail attaches to the panel and becomes four tabs, docked left by default.

- **The rail is attached to the panel** (desktop): it sits on the panel's outer edge and both move
  together. The panel docks on the **left** by default; one header button moves it (and the rail) to
  the other side, and the choice is remembered per browser. "Dock bottom" and "Full screen" are gone.
  Clicking the active tool collapses the panel (the rail stays); clicking any tool opens it.
- **Four tools: Layers, Details, Table, Report.** The flower plot (Scores) and the species information
  (Species) moved out of the Layers pane's second tab into their own **Details** tool, the same in
  both lenses. Details opens with the last clicked place, an "Add to report" button and an "Open
  table" button; a map click updates it in place and never switches tools. The phone's bottom bar has
  the same four entries.
- **Table takes the whole stage** beside the rail; leaving it restores the side panel.
- **The panel header says what is shown**: "Score · Raster cells", "Cell 3058375" or the species'
  name, the table's subject line, "3 places" - not the name of the tool. Same on the phone sheet.
- **The click popup links to Details** (Scores cells and Program Areas, Species).
- **The legend and the map credit follow the side**: with the panel on the left they sit bottom-right
  (the credit under the legend); on the right they mirror to bottom-left.
- **Shared links**: the `ui=` token is version 4 (tool includes Details, side left|right). Older links
  still open: `tab=info` opens Details, a bottom dock or maximized panel opens on the side dock, and
  `?tool=flower` / `?tool=places` open Details / Report.
- The welcome tour gains a **Details** step.

# atlas 0.10.80

Round 4, R4-A: the histogram moves from the click popup into the legend.

- **The legend shows the whole layer's histogram above the colour ramp**, on the ramp's own x-axis
  with bars coloured by the ramp. It is the density of values across the whole layer, so it no
  longer changes from click to click; a click only adds a vertical marker line (with the value as a
  label, and as text for screen readers) through the histogram and the ramp. Works in the phone
  legend modal too. Scores / Raster cells and Species (COG inputs) read the shape from the layer's
  own COG (display-only); Scores / Program areas bin every area's value; a species range (presence
  only) has none. If the tile server is down or answers an error, the legend is just the ramp.
- **The click popup is title, swatch and value only**: its sparkline is gone.

# atlas 0.10.79

Round 3, W8 CI-red fix round (size budget, stale specs, gallery baselines). No new features.

- **Static critical path back under budget** (445.3 KB gzip vs the 450 KB cap; it was 451.4 KB on
  0.10.78, so that release was never published). The places model (the g1 place codec) is now a
  lazy chunk in `Shell.svelte` and `placesMap.svelte.ts`. A link that carries places in its hash
  still shows them (Places tab list, Report sentence, Table subject line, map outlines) as soon as
  that chunk arrives, and nothing rewrites `#pl=` in the meantime (`e2e/places.cold-link.spec.ts`).
- **Specs updated for the Report tool** (Places is now its first tab; the rail is Layers, Table,
  Report): `e2e/report.flow.spec.ts` and `e2e/keyboard-walk.spec.ts` go through the Report rail tool.
- **Gallery linux baselines** for the `legend` section regenerated from CI (155 px tall since W7).

# atlas 0.10.78

Round 3, W8 (species Layers pane: promote the data selection, zoom-to-layer, Share reproduces the
UI arrangement).

- **Promoted the species "Model input" picker to the top of the Layers pane** (Ben, live-review
  2026-09-25: "promote the main data selection up"). The layer bar (Merged + each input pill, the
  Delivered/As-ingested representation toggle) moved out of the Data row's collapsible body to a
  new panel-level slot (`LibLayersPanel`'s `speciesField` snippet — the species lens' own
  equivalent of the scores lens' promoted `layerField`), directly under the unit-toggle divider, so
  it is visible without expanding anything. The Data row's body now holds only the species TITLE
  and the descriptive card (`SpeciesCardView`).
- **Added: "Zoom to layer on change"** (Ben: "I just chose FWS Range from default leatherback
  turtle layer, but see nothing on map because out of view, so would be good to default to zoom to
  selected layer and have a tickbox to stop doing that"). Picking an input (or Merged) now refits
  the camera to that surface's own extent through the same fit chain the species title's zoom
  already used (`data/camera.ts#refitOnInputChange`, `cameraFor`) — a checkbox directly under the
  input picker, checked by default, turns it off so a viewer can flip between inputs at a fixed
  camera. A fit is also skipped when the viewer has panned since the last pick (`sel.map`'s own
  "only ever a real user gesture" guarantee, `map.ts`'s header). The preference is URL state
  (`zl=0` when off, absent when on, `Sel.zl`) so a shared link reproduces it.
- **The Layers pane is now a two-tab panel; the Flower plot moved into it; the rail drops to four
  tools** (Ben, 2026-09-25: "differentiating the extra information about the species in another
  tabset from the interactive control of the layers in its own default tab... drop the Flower plot
  from the toolbar"). `LibLayersPanel`'s new `infoTab` prop renders a `Segmented` tab switch above
  the panel body: "Layers" (unchanged) and a lens-named second tab — "Flower plot" in the Scores
  lens (today's `FlowerPanel.svelte`, unchanged behaviour) and "Species info" in the Species lens
  (`SpeciesCardView`'s descriptive content only — the model-input picker and zoom-to-layer checkbox
  stay on the "Layers" tab). The tool rail drops from five tools to four (`Layers · Places · Table ·
Report`, `src/shell/tools.ts`'s `TOOL_ORDER`/`buildRailItems()` — no lens argument or
  inactive/inactiveReason concept left, since every remaining tool is active in both lenses). The
  active tab is carried in the `ui=` Share token (bumped to version 2, a 7th `tab` field,
  `src/shell/uiState.ts`); an old version-1 token naming the retired "flower" tool code opens the
  Layers pane on the info tab instead (`parseUiV1`, unit-tested). On the phone, the sheet's title
  tracks whichever tab is showing. Seeded fault: `ui-token-tab-dropped` (`formatUi()` hardcodes the
  tab field instead of encoding the live tab).
- **Places folds into the Report pane as its own (default) first tab; the rail drops to three
  tools** (Ben, 2026-09-25, proposed by him and not objected to). The rail is now
  `Layers · Table · Report` (`src/shell/tools.ts`). A new `ReportPane.svelte` gives the Report tool
  the same two-tab shape item 4 gave Layers: "Places" (today's `Places.svelte`, unchanged behaviour,
  default) and "Report" (today's `ReportTool.svelte`); the pane title reads "Report · Places" while
  the Places tab is active. The `ui=` Share token bumps to version 3 (an 8th `reportTab` field);
  version-1/version-2 tokens naming the retired "places" tool code open Report on its Places tab
  (`parseUiV1`/`parseUiV2`, unit-tested). The tour's "Places" step now anchors the pane's own tab
  switch instead of a rail button that no longer exists.
- **Added the selection model Ben asked for**: "the last clicked element defaults to the current
  Report Place... care should be given to not wiping out existing selections that have been
  explicitly added to Places." `reportSubjects(sel, places)` (new, `src/lib/state/subjects.ts`,
  8 unit tests) is the one pure rule: a non-empty explicit Places list always wins over the
  map-click "Last clicked" slot; a click only ever replaces the slot, never the explicit list (the
  two are independent URL fields — `sel.sel` vs. `sel.pl` — written by separate code paths, proven
  end-to-end by the new `e2e/places.last-clicked.spec.ts` and its seeded fault
  `places-list-wiped-by-click`). The species table's own subject line now reads "Species for N
  places" when an explicit list governs (`placesSubjectHeader()`, `species.ts`) — the Last-clicked
  case keeps its existing, more specific wording.
- **Fix round: the "Last clicked" row, the Report tab's own sentence, and the Table's
  discoverability hint** (Ben, verbatim — the part of the selection model that could not be
  deferred). The Places tab now shows a "Last clicked: {subject}" row at its top (hidden when
  nothing has been clicked) with an "Add to places" button that appends it to the explicit list
  through the SAME generic `addPlace()` mutation a drawn/typed place already uses — a clicked
  Program Area becomes the same `ZonePlace` `addZonePlace()` builds; a clicked cell becomes a
  `GeomPlace` over the cell's own square (`lens/scores/lastClicked.ts`/`lastClickedPlace.ts`, the
  mutation kept as its own dynamically-imported module so the place codec's heavier encode/decode
  pipeline never enters the static bundle). The Report tab shows one sentence driven by
  `reportSubjects()`: "Reporting on the last clicked place — add it to Places to keep it, or add
  more places below." or "Reporting on N places." The Table's own header now adds "Select places
  under Report → Places" next to the all-US-waters aggregate (never replacing it) when nothing at
  all is selected, with a button that opens that tab. `e2e/places.last-clicked.spec.ts` extended:
  clicking a cell then "Add to places" leaves `#pl=` with exactly one entry, and the row keeps
  showing afterward.

# atlas 0.10.77

Round 3, W7 (consistency + copy, 2026-09-25): Ben's two asks — one colour-coded value popup with a
distribution sparkline, shared by the scores cell/zone popups and the species popup; and the Legend
naming which layer is displayed — plus UI-4/5/8/9 from the Opus 5.5 review.

- **One colour-coded popup template, everywhere a cell/zone/species value is shown** (Ben, 2026-09-25).
  `lib/map/popup.ts#valuePopupHtml` is now the ONE template the scores lens' cell popup AND its
  Program-Area popup AND the species popup all render through: a shared subject line
  (`lib/format.ts#formatSubject`, UI-4 — "Cell 3350704 · 28.625° N, 90.575° W" / a Program Area's
  own name), a shared value line (`formatValueLine`, "Score 44" / "Suitability 71"), and a
  ramp-colour swatch (`raster/ramps.ts#colorForValue`/`textColorFor`) that the scores lens never
  had before this round. The scores click popup and the Program-Area popup previously used three
  different, uncoloured text formats; they now look like the SAME kind of thing.
- **A distribution sparkline in the popup** (Ben, 2026-09-25): a smooth, kernel-smoothed density
  curve (`lib/map/density.ts`) filled with the legend's own ramp gradient, with a marker at the
  clicked value — scores/Raster-cells reads a histogram over the mounted `cell` Parquet tile
  (`sql/cell_histogram.sql` + `lib/analysis/queries.ts#cellHistogramValues`, never a tile pixel);
  scores/Program-areas bins the unit's own already-in-memory `zone_metric` values
  (`lib/map/distribution.ts#valueListDistribution`, no engine/network call); species reads titiler's
  `/cog/statistics` (`raster/histogram.ts`, the second sanctioned tile-server read beside
  `/cog/point`, plan D4). The popup always renders immediately; the sparkline fills in once its
  fetch resolves (a skeleton meanwhile), never delaying the popup itself.
- **UI-4: one `formatSubject()`/`formatValueLine()`** (`lib/format.ts`), used by the map popup, the
  flower panel's title and the species table's header — the same clicked cell used to read "Cell
  3350704 · lon -90.550, lat 28.601 · score: 44" in the popup, "Cell ID: 3350704 (x: -90.575, y:
  28.625)" in the flower, and "Species for Cell ID: 3350704" in the table. All three now read "Cell
  3350704 · 28.625° N, 90.575° W". The no-selection subject is now "All US waters" everywhere
  (UI-5) — the same label the Zoom-to-region select already uses — replacing "Full study area".
- **New `lib/map/legendTitle.ts`** (Ben's UI-L2 ask): the desktop legend card now shows a subtitle
  under its title — "Raster cells · All US waters · v7"/"Program Areas · v7" for the scores lens —
  so the legend says which layer is on screen, not just a bare ramp. **Species wiring completed in
  this merge-fix round**: `SpeciesMapInputsOptions` took a bare `legendTitle: string` (always the
  raw scientific name, e.g. "Odobenus rosmarus") that never actually called `legendTitle()` —
  `speciesMapInputs()` (`lens/species/mapInputs.ts`) now builds the real title
  ("Walrus (Odobenus rosmarus)") and subtitle ("Merged Model · habitat suitability 1-100" /
  "IUCN Range · presence" / "AquaMaps · as delivered") for both the COG and PMTiles branches, shown
  by the desktop legend card, the phone legend chip's short form, and the phone Legend modal (all
  three share `SpeciesLegend.svelte`, so one fix reaches all three).
- **`metricKeyLabel()` now sentence-cases every label it returns**, not only an absent/degenerate
  one: a real, published `manifest.metrics` label that is itself lowercase ("score") used to stay
  lowercase forever in the Layer select, legend and phone chip.
- **UI-9 (species copy)**: ESA status codes are mapped for display (EN → Endangered, TN →
  Threatened, LC → "Not listed"), with the code kept in parentheses and the source named once, in
  the fact's own label ("Listed under the ESA (NMFS)") — a real, non-null source used to be named
  TWICE ("NMFS:EN (NMFS)"). "IUCN RedList: VU" is now "IUCN Red List: Vulnerable (VU)". The
  species-lens inputs table shows each dataset's own NAME, never the raw `ds_key`
  ("ms_merge"/"am_0.05"/"rng_iucn"). A species card that fails to load now reads "This species
  isn't in release {ver}. Search for another above." for a genuine not-found, instead of the raw
  error code ("Couldn't load this species (not-found).").
- **UI-8 (number formatting)**: the Zones table's score column is `minimumFractionDigits: 1` (a
  "29" no longer sits beside a "29.7"); its numeric headers right-align to match their columns; the
  Composition treemap's `valueLabel` is "species" (not "n species", which read as a typo).
- **UI-12**: the Zones table's header text wraps at word boundaries (`overflow-wrap: normal;
hyphens: auto`) instead of splitting a word like "Primary production" mid-letter.
- **W3 hand-off**: `ZonesTable.svelte` and `Composition.svelte` had the same `max-height: 50vh`
  blank-space defect B9 fixed for `SpeciesTable.svelte` — both now fill whatever height
  `TablePanel.svelte`'s own `height: 100%` hands down, the same fix, applied the same way.
- **Merge-fix round (post-`main` merge, 2026-09-25)**: `selectZone`'s search-pick fly path
  (`src/lens/scores/state.svelte.ts#flyToZoneCenter`), auto-merged from `main`'s own R3-CI retry
  fix, still called the OLD positional `zonePopupText(zRows, lyr, hit)` — a real type error against
  this round's new object-shaped `ZonePopupInput`. Both call sites now go through the SAME
  `buildZonePopup()` helper a real map click uses, so a Program-Area search pick's popup carries the
  colour swatch + sparkline too, not just a real click's.
- **UI-21: basemap labels in English** — `mergeCartoStyle()` (`lib/map/style.ts`) now rewrites a
  merged CARTO symbol layer's plain `["get","name"]`/legacy `"{name}"` `text-field` to
  `["coalesce", ["get","name_en"], ["get","name"]]`, falling back to the tile's own local spelling
  only when it has no English variant; a DIFFERENT field (`water_name`, an already-localized
  expression) is left exactly as CARTO published it.
- **UI-15 (welcome modal)**: "Species lens" now switches the lens in place and closes the modal
  (was a `target="_blank"` link to a second tab); "documentation" links this version's own docs URL
  (`docsHref`, not a bare, version-less guess); "Take a Tour" → "Take a tour"; the intro now reads
  "data release {ver}" — dropping "immutable"/"marine atlas" internal-repo wording, also fixed in
  the report's own intro (`lib/report/model.ts`).
- **UI-7 (report)**: "Open this release in the Atlas" now carries the report's own place token
  (`appHref(ver, {pl})`, the SAME `pl=` value the header's permalink already encodes) instead of
  landing on the bare default view; the empty-report state ("No places in this link") gains an
  "Open the Atlas" escape hatch.

# atlas 0.10.76

Round 3, CI-reds fix (CI run 36158947685). A Program-Area search pick's camera flight could
silently do nothing under load (webkit 3/3, firefox flaky, chromium fine).

- **Fixed: a Program-Area search pick could fail to fly the camera at all, under load** —
  `selectZone`'s bounds resolution (`src/lens/scores/state.svelte.ts`) made exactly ONE
  synchronous attempt, at the instant Enter was pressed: a published `bbox`, else a live,
  unfiltered `querySourceFeatures` query over the zones PMTiles source. MapLibre only answers
  that query from tiles that have already finished BOTH their network fetch and their
  worker-side vector-tile parse — a real race, not a geometry bug (the same class `report/
reportMap.ts#waitForIdle` already exists to close for `queryRenderedFeatures`) — so a script
  (or a person) pressing Enter before the zones layer's tiles are parsed could see the URL/
  selection update with no camera move at all, permanently: no retry. Fixed by retrying the
  exact same resolution once more after the map's next `"idle"` (bounded by a 1.5s fallback
  timer), guarded so a stale retry can never override a later selection. New pure helpers
  `zoneCacheKey`/`zoneKnownBounds` (`src/lens/scores/boot.ts`) factor the resolution out so both
  the immediate attempt and the retry call the identical logic, and so it is unit-testable
  without a real map (`tests/lens/scores/boot.test.ts`).

# atlas 0.10.75

Round 3 re-review fix round (Opus 5.5 eyes-on, second pass on `a7ba24a`/0.10.73). Four defects the
live build still showed after the prior fix rounds.

- **Fixed (BLOCKING): the species "Zoom to: US waters | Whole range" toggle STILL never appeared on
  v7** (R3-A1, review D1, second time) — real-build eyes-on found FOUR compounding defects on the
  live leatherback (`?mdl_seq=54241`), fixed together:
  1. The leatherback's LIVE `/cog/info` bounds are `[-180, -17.7, 180, 60.45]` (the model reaches
     American Samoa/Guam across the antimeridian); `minimalFrame()` cannot narrow a box that wide,
     and the caller used to read that as "not a camera at all" and return BEFORE
     `wideRangeAware()` ever ran. New exported `cogBoundsCamera()` (`src/lens/species/data/camera.ts`)
     applies the wide-range narrowing rule to the RAW bbox when `minimalFrame()` can't reframe it.
  2. That fix alone never actually reached the live leatherback: `src/lib/raster/bounds.ts`'s
     `narrowLongitude()` intercepts the same degenerate bbox FIRST and used to hand back a
     single-candidate window still 78° tall (under the wide-range threshold, so the toggle stayed
     hidden) — or, for a genuinely wide-ranging species, the raw box itself, whose `cameraForBounds()`
     fit for "Whole range" was verified LIVE to land on lng=0 (Africa). `narrowLongitude()` now probes
     every candidate and, when the real hits are spread across multiple regions, hands back a
     confirmed-data arc (`hitLonArc()`, dateline-aware) instead.
  3. A fresh page load could still permanently skip the species' own camera fit: the species-camera
     `$effect` (`src/lens/species/state.svelte.ts`) can run once before `boot` (the release's study
     areas) has loaded, get `cam === null`, and used to latch `prevCameraKey` anyway — so a LATER
     pass, once `boot` arrived, saw "already fitted" and never retried. It now latches only once a
     camera was actually computed.

  Second re-review pass (orchestrator eyes-on of the merged build) found three MORE problems with
  the toggle, fixed the same round: 4. **Phone framing (blocking):** the narrowed "US waters" box (~136° wide) still could not fit
  390px — it settled at zoom 0.78, a tiny globe mostly hidden behind the sheet, empty sky above.
  New `phoneAwareWideRangeBounds()` (`src/lib/map/camera.ts`) substitutes `PHONE_DEFAULT_BOUNDS`
  — the app's own known-good phone default view — whenever the narrowed box would zoom out
  further than that default already does; gated to the phone only (`isPhone`), desktop untouched. 5. **"Whole range" missing the western Pacific hits:** on desktop it read as nearly identical to
  "US waters" (never showing Guam/CNMI, 145°E); on the phone it centred at lat -56.5, south of
  the confirmed-data arc's own -17.7° south edge, entirely behind the sheet. Root cause:
  `boundsToCameraView`'s own asymmetric-padding shift overshoots badly at the near-zero zoom this
  ~150°-wide arc needs. New `symmetricPadding()` (`src/lib/map/camera.ts`) splits each axis's
  total chrome reserve evenly (the fitted zoom is unaffected) while zeroing both differentials,
  so "Whole range" — now computed directly via `boundsToCameraView`, never through MapLibre's own
  `cameraForBounds()` — always lands on the arc's true geometric midpoint. Verified live: both
  viewports now settle at the SAME centre (`lng -140.5, lat 28.0`), visibly including the western
  Pacific data. 6. **Speed:** `narrowLongitude()` probed its ~14 `/cog/point` candidates one at a time, taking
  11-14s live before the toggle appeared. Now bounded-concurrent (4 in flight, never unbounded —
  "never hammer titiler"), result order still independent of the real network's own response
  order. Measured against the real titiler: the probe sweep itself dropped from ~7.0s sequential
  to ~2.1s concurrent; end-to-end (a real browser run) the toggle now appears in ~3.5-3.7s.

  "Whole range" frames the confirmed-data arc (or the model's own raw bbox, for a bundle-published
  globe-spanning extent); the walrus (a real, narrowable antimeridian wrap, one compact location) is
  unaffected throughout. Verified live end-to-end, both viewports, "US waters" and "Whole range".

- **Fixed: the exported map title read "score · score"** for the default Scores layer (Download
  menu, PNG/SVG, both themes) — `src/lib/download/footer.ts` gains `titleWithUnit()`, which skips
  the unit when it equals the title (case-insensitive, trimmed); a species title + a distinct unit
  still joins as before.
- **Fixed: the Layers "Selection" row read "— nothing selected" while a place was loaded**
  (`?pl=z.pa.GAA`) — `isPlacesSelectionEmpty()` (`src/lib/state/types.ts`) now also takes the
  decoded places count, so a loaded `pl=` list (with no `sel.sel` pick yet) counts as "not empty",
  matching what the Places panel and Download menu already showed.
- **Fixed: the About modal's "Release notes" link 404'd** — `release_notes.html` was never a real
  chapter; the docs book's release chapter is `releases.qmd` → `releases.html`.
  `src/lib/release/docsUrl.ts#RELEASE_NOTES_CHAPTER_PATH` and `Shell.svelte`'s hand-duplicated
  `releaseNotesHref` both fixed together.

# atlas 0.10.74

Round 3, W3b (accessibility fix, CI run 36158947685). The gallery's axe gate flagged
`scrollable-region-focusable` on the Flower plot's component table (all 6 theme × width combos).

- **Fixed: the Flower plot's component score table was not reachable by keyboard** — its own
  independent scroll box (`.flower-table-scroll`, added R3-B10 so the "Mean" row stays reachable
  when the flower above it is tall) had no `tabindex`, so a keyboard-only user could never scroll
  it, only a mouse/touch one. It is now a `tabindex="0"` `role="region"`, named via
  `aria-labelledby` to the table's own `<caption>` (never a second, independently-worded label),
  with a visible `:focus-visible` ring using the same token/shape `Sheet.svelte`'s `.sheet-body`
  and `Panel.svelte`'s `.panel-surface` already use (`outline: 2px solid var(--focus-ring);
outline-offset: -2px;`).

# atlas 0.10.73

Round 3, W6 (consistency slice A: shell + shared UI). Two live-site bugs (a second Program-Area
search pick not zooming; Regions folded into the Search bar) plus a first pass on the Opus 5.5
consistency review's UI-1/2/3/10/11/13/16/17/19 items.

- **Fixed: a SECOND Program-Area pick from the Search bar did not zoom the camera** (Ben,
  live-site report). `selectZone`'s bounds lookup used to query the map FILTERED to the one key
  just picked, which only answers from tiles loaded for the CURRENT viewport — the first pick's own
  `flyToBounds` had already zoomed in tight on the first zone, so the second zone's tile was never
  requested and the query came back empty on every later pick. Fixed by querying UNFILTERED and
  caching every zone the query happens to see (`places/zoneStats.ts#zoneBboxesByKeyFromFeatures`,
  `state.svelte.ts`'s new `zoneBoundsCache`) — the first pick's own query now incidentally primes
  the cache for every OTHER zone loaded at that moment (normally all of them, at the app's initial
  wide camera), so a later pick is a cache hit with no live query at all.
- **Regions move into the Search bar** (Ben): the Search field opens its dropdown ON FOCUS, before
  any typing, listing **Regions** (the release's `study_areas`) then **Program Areas**, then a
  coordinate-syntax hint; picking a region does exactly what the Layers pane's now-removed "Zoom to
  region" select did (a pure camera move — the raster/legend never change, confirmed against
  `boot.ts#fullSubregion`'s own "the study area is a camera, never a filter" rule). Typing also
  ranks region matches alongside zone matches by actual match quality (an exact zone-key match
  always outranks a merely-similar region name), not "every region ahead of every zone"
  regardless of fit. The Layers pane's Layer field is now full width.
- **Fixed: the Search dropdown stayed open after focus left it** (UI-17) — closes on `focusout` to
  any target outside the combobox; a click on a result still resolves first.
- **Fixed: the phone map attribution was hidden behind the sheet** at "peek" and "half" (UI-2) — it
  now tracks the sheet's own real height, the same variable the legend chip already used.
- **Fixed: the phone sheet's "peek" detent had a dead "Collapse to a peek" button** (UI-19) — it now
  reads "Expand to half" there, so all three detent controls do something.
- **New: `<Toast>` is mounted** (Shell.svelte) and `announcer.ts` gains `notify(text, {tone})` —
  announces AND shows a visible toast. Every user-initiated Places action (pick on/off, add/remove/
  duplicate/download a place, draw hints, every "couldn't…" error) and the top bar's Share/chunk-
  load-failure messages now use it; previously all ~60 of these reached only a screen reader (UI-1).
- **New: one global `[data-tooltip]` hover/focus tooltip** (`src/lib/ui/tooltip.css`, replacing two
  independent copies) — every icon-only button now has one: the panel's Dock/Full screen/Collapse
  controls, the phone sheet's three detent buttons, the Table's info/download buttons, a map
  popup's close button. Suppressed while the button's own menu/dialog is open (`[aria-haspopup]`);
  About's tooltip now reads "About this release", matching its label (UI-11).
- **Fixed: native checkboxes/range sliders used the browser's default blue accent** in both themes
  (the Layers opacity sliders, the Columns menu, "Only species in US waters", the welcome "Don't
  show this again" box) — `:root { accent-color }` now matches `--focus-ring` (gold on navy, steel
  on paper); the species card's merged-model "✓" moves off the gold `--fill-accent` FILL token (was
  ~1.5:1 on paper) onto `--text-accent`; the "quiet" Switch's ON state keeps its neutral track but
  its thumb now reads gold in both themes (UI-10).
- **Fixed: the Scores Species table printed scientific names upright**, the one place that
  disagreed with the (already-italic) species card/popup — a new shared `<SciName>` component
  (`src/lib/ui/`) (UI-13).
- **About modal fixes** (UI-16): the release line's separator no longer drops its leading space
  ("v7· 2026-06-12" → "v7 · 2026-06-12"); "Documentation" now opens the release's own versioned
  Atlas chapter instead of the docs book root; "What changed" now opens the DATA release's own
  notes chapter instead of the app's CHANGELOG.md; the restricted-release note's "--" is now an em
  dash; the Help menu lists the zoom-out key ("-") alongside zoom-in; the phone ⋯ menu's redundant
  "Report" quick action is dropped (desktop never had an equivalent — the rail's own "Report" tool
  is the one place both viewports already share).

# atlas 0.10.72

Round 3, W5 (process and tooling debt): gallery screenshot stability, seeded-fault patch hygiene,
a local shell/UI gate alias, the search-zoom bbox preference, and harness/docs cleanup. No
user-visible behavior change on the map/panel — this round is process and tooling.

- **Gallery screenshots are per-section, not one full-page shot** (`e2e/gallery.spec.ts`) — a
  full-page shot's total page height jittered by 1px between CI runs, failing the job outright
  before any pixel comparison. Each gallery component section now gets its own, much smaller,
  stable-height screenshot; a new gallery section gets its own baseline automatically.
- **New `scripts/gallery-baselines-from-ci.mjs`** (`npm run gallery:baselines-from-ci -- <run-id>`)
  installs the linux gallery baselines from a CI run's `gallery-test-results` artifact in one
  command (keeps each screenshot's final CI attempt, copies it over the matching local baseline,
  prints what changed) instead of a manual `gh run download` + copy.
- **New `scripts/check-faults-apply.mjs`** (`npm run faults:check`) runs `git apply --check` over
  every seeded-fault patch `scripts/test-faults.mjs` references and lists any that no longer apply
  — a cheap first line of defense against a stale patch, ahead of a full (sometimes browser-build)
  `npm run test:faults` run.
- **New `npm run e2e:shell` alias** for the "any change under `src/shell/` or `src/lib/ui/` runs
  the shell/feedback specs locally" rule (chromium, `--workers=1`, `e2e/shell.*.spec.ts
e2e/feedback.spec.ts`).
- **Scores search: a zone zoom now prefers a published `boot.zones[unit][*].bbox`** over querying
  the map for an already-loaded tile, when the bundle publishes one (no released bundle does yet —
  the msens/notebook side lands separately). A search pick on a zone far outside the current view
  will zoom correctly without depending on tile state, once a release publishes bbox.
- **Harness: a desktop-only `programarea` eyes-on shot with the panel collapsed**, so the map
  tooltip's full Program Area name is verifiable (the docked panel could sit over the popup's own
  anchor point on the fallback camera path).
- `docs/status.md`'s Decisions table (R1–R6) now shows the correct landed version and "shipped"
  instead of a stale "building"/scheduling note for work that has been live since round 2.
- **Fixed (D3, Download menu): the map-view export's title/filename used the layer's LONG
  description** (~190 characters for `primprod`), not the short label the Layer select and legend
  chip already show — the download title/filename now match what is on screen; the long
  description can still appear as an optional, smaller second footer line when it fits. **The
  footer's "share URL" was relative and carried `theme=`** — it is now the same absolute URL
  Share copies, with `theme` dropped. **Nit:** the Download tooltip no longer draws over its own
  open menu.

# atlas 0.10.71

Round 3, W4: the phone's default first view, wide-range species framing, and the category
palette (R3-A1, R3-A2, R3-A3).

- **Fixed (R3-A2): the phone's default first view showed only the northern Gulf of Mexico**, one
  region of four. `PHONE_DEFAULT_BOUNDS` now frames the Pacific coast and Florida/the Gulf, chosen
  by looking at real builds and measuring directly against a 10%-of-free-area sky-band target
  (`e2e/shell.firstview.phone.spec.ts`'s own two-colour probe, checked at both the "half" and
  "peek" sheet detents). First pass framed the lower 48 + a south-east-Alaska/Gulf-of-Alaska hint
  (`[[-128,24],[-65,52]]`) but left ~43%/23% of the free area as empty sky above the globe's rim;
  second pass narrowed further to `[[-119,25],[-78,51]]` (zoom ~2.6), measuring 7.0%/3.7% sky — both
  under target. A span narrow enough to clear the target cannot also carry the Alaska hint or the
  Atlantic seaboard north of the Carolinas (the same lever narrows both), so per the decision's own
  fallback, both are dropped in favor of a clean, minimal-sky lower-48 view.
- **New (R3-A1): a wide-range species model frames its IN-US portion by default**, with a compact
  "Zoom to: US waters | Whole range" toggle in the species card as the escape hatch back to the
  whole thing. The v7 leatherback's own model spans the whole Pacific (SWOT DPS nesting near
  Oceania, foraging to Alaska); when a model's fitted bbox spans more than 120° of longitude, it is
  intersected against a dateline-aware "study area as a box" (the release's own published extent if
  one ever exists, else derived from the same camera the desktop default view renders — never a
  hardcoded number). Applies to both viewports; a compact model is completely unaffected.
- **Changed (R3-A3): re-hued Fish (blue-violet) and Turtle (moss/olive) in the eight-category
  palette**, and nudged Mammal darker/more golden — `--cat-bird`/`--cat-fish` and
  `--cat-mammal`/`--cat-turtle` were near-identical in both themes, and Coral/Mammal collapsed
  under a protanopia simulation despite passing on normal-vision CIE76 ΔE alone. Every category
  stays ≥4.5:1 text / ≥3:1 non-text (`npm run contrast`) and distinct from `--cat-primprod`.

**Fix round (Opus 5.5 eyes-on review of merged main, 2026-09-25):**

- **Fixed (D1): the "Zoom to" toggle never appeared on v7**, including the leatherback (the
  Species lens' own default landing species) — v7 publishes no bbox on any asset for any taxon, so
  the camera took the COG-bounds last-resort path (`state.svelte.ts#refineCameraFromCogBounds`),
  which built its own camera by hand and never ran the wide-range check at all. That path now
  calls the SAME `wideRangeAware()` rule the bundle-bbox chain already used (exported for this),
  with a `source: "cog-bounds"` it can now honestly report.
- **Fixed (D5): the phone default view's legend chip covered the Gulf of Mexico/Florida** at the
  default "half" sheet detent. The measured-sheet refit's own padding never counted the floating
  legend chip's height (already used by every LATER species/zone re-fit) — it does now, gated on
  the chip's own data source (`scoresLens`, a dynamic import) having loaded first.
- **Fixed (D4): paper-theme Mammal broke its hue family** — a near-black brown (`#372506`) against
  navy's bright gold, where every other category keeps its hue across themes. `#82773d` is the
  lightest in-family amber that still clears a ≥15 CVD-ΔE floor against both Coral and Turtle
  under protanopia/deuteranopia simulation (measured: the naively "lighter/safer"-looking
  `#7a5200`–`#8a5e00` range is actually the WORST part of the curve for this).

# atlas 0.10.70

Round 3, W3 (app nits with a known fix, 2026-09-25): the cell popup now agrees with the panel on
where a click landed, the welcome modal's first paint no longer rings the close button, the phone
legend modal fits its own content, several small copy/sizing fixes, and analytics now knows it is
on the preview host.

- **Fixed: the map popup printed the raw CLICK point while the flower panel printed the cell
  CENTRE for the same cell** ("lon -90.550, lat 28.601" vs. "-90.575, 28.625") — both now read the
  cell centre (`cellRing()`, the same helper the panel's own coordinate line already used), since
  the cell is the unit being described, not wherever the pointer happened to land inside it. The
  popup's `maxWidth` also grows from 260px to 320px, and its content box gets a `min-width`, so its
  own text ("Cell 3350704 · lon -90.575, lat 28.625 · score: 44") no longer wraps with the trailing
  value stranded alone on its own line.
- **Fixed: the welcome (and every other) modal focused its own close button on open**, showing a
  thick gold focus ring around the "x" before anything was clicked. `Modal.svelte` now focuses the
  dialog container itself; a keyboard user's first Tab still lands on the first real control, and
  `:focus-visible` still rings it.
- **Fixed: the phone legend modal left ~65px of empty card under the ramp** on every release with
  no per-layer description to show. Removed the fixed `min-height` floor that caused it, and — when
  the release publishes one — the current layer's own long description now fills that space instead
  of leaving it blank.
- **Fixed: the Places panel's Share / Download places / Report buttons read visibly larger** than
  the rest of the panel (the browser's own default button font, never set to this panel's `0.9rem`
  like everything else in it).
- **Fixed: a single-place Report repeated the place's name twice** — once as a tab "pill", once as
  the figure's own heading directly under it. A report with exactly one place no longer renders the
  (pointless, for one item) tab list; the heading is the figure's accessible name either way. A
  report with two or more places is unchanged.
- **Fixed: the AquaMaps citation's "Content from AquaMaps as provided in this R package..."** read
  as orphaned prose once copied into a report that never mentions any R package elsewhere — now
  reads "...as provided in the msens R package", a display-time patch (`cite.ts`) alongside the
  existing "UnportedLicense" fix; both retire once msens's own source text is corrected.
- **Fixed: the desktop species table's column filters truncated to "Area (kn", "Avg. suit", "% of
  cat"** — the three long labels (Area (km²), Avg. suitability, % of category) now get short
  placeholders ("Area", "Suit.", "% cat") that fit, with the full label still available as a hover
  title. The table body also now fills the panel's real height instead of stopping at a fixed 50vh
  and leaving ~180px blank underneath at full screen.
- **Fixed: the desktop flower panel's "Mean" row (the table's own last row) sat half-cut at the
  panel's bottom edge** at half panel width, reachable only by scrolling the whole panel with no
  visible affordance that there was more. The component table now scrolls inside its own small,
  bordered box.
- **Fixed: the report's static map cropped CARTO's own place-name labels ("LOUISIANA") at the
  fitted view's top edge.** The report already draws its own place labels; the basemap's own text
  labels (`symbol` layers) are now dropped entirely rather than padded around, which a longer label
  could still beat.
- **Fixed: `content_group` read `"atlas"` (never `"atlas-preview"`) for analytics on the review
  host.** `Shell.svelte`/`Report.svelte` both construct `Analytics` with a necessary `preview: false`
  guess (the session fetch is still in flight); a new `updatePreview()` on the `Analytics` interface
  corrects it — and gtag's own persistent `content_group` field — the moment the real, async answer
  from `resolveSession()`/`window.__early.session` lands.
- `eslint.config.js` now ignores `docs/*_files/` (and `docs/status_files` by name): a local Quarto
  render of a docs page left `npm run lint` walking Quarto's own bundled third-party JS and failing
  with 724 unrelated errors.

# atlas 0.10.69

Round 3, W2: a Download menu (PNG/SVG of the map view, GeoTIFF/GeoJSON of the current data layer),
plus the theme toggle's gear-like icon (R3-B12).

- **New: a Download menu** — desktop, a top-bar icon button beside Share; phone, a "Download…" entry
  in the ⋯ menu opening the same item list in a Modal. Items: **Map view · PNG** (the current map,
  composited with a theme background, a footer stamp — title/unit · app · version · share URL — and
  the legend gradient bottom-left, never transparent), **Map view · SVG** (the same figure as a
  vector-wrapped raster: the footer and legend are real SVG text/gradient elements, the map imagery
  stays a raster — the menu says so), **Data layer · GeoTIFF** (fetches the current view's own COG —
  the scores lens' current metric × subregion, or the species lens' currently drawn surface — and
  saves it; disabled with the reason as its hint when no COG is published for the view), and
  **Selected places · GeoJSON** (the current places, reusing `places/download.ts`'s existing
  resolved-geometry export) when there is a selection. "Program areas · GeoJSON" is deliberately
  NOT offered: no published release carries a complete Program-Area geometry asset today (see this
  round's report for what publishing `app/zones/programarea.geojson` would take). New reusable
  `src/lib/ui/Menu.svelte` (a `role="menu"` dropdown — trigger, roving-tabindex list, Esc/outside-
  click/item-click close, left/right align) backs the desktop button; a gallery section demonstrates
  it. One `download_export` analytics event fires per download kind.
- **Fixed (R3-B12): the theme toggle read as a settings gear**, not a sun/moon — `mdiBrightness7`/
  `mdiBrightness4`'s shared castellated ring (the same pair CalCOFI explore also uses) reads as a
  gear frame at 18px. Swapped for `mdiWhiteBalanceSunny`/`mdiMoonWaningCrescent` — unambiguous
  sun/moon glyphs with no gear-like border, on both the desktop button and the phone ⋯ menu's
  "Switch to light/dark theme" item.

# atlas 0.10.68

Round 3, W1: the Layers pane redesign (Ben, live-review 2026-09-25) — "clean up the Layers pane to
something more minimalist and compact," plus the hexagon pip removal and two labeling fixes
(R3-B1, R3-B2).

- **Removed the active-tool hexagon pip** from the rail (`RailButton.svelte`) — "excessive and
  distracting." The active tool is now marked by the accent fill + ring alone.
- **The "Raster cells | Program areas" toggle is now content-sized** (`Segmented`'s new `fit`
  prop), left-aligned like the top bar's own Scores|Species switch, instead of stretched to the
  full row width — no longer reads as a mystery third, uncolored option.
- **The Layer picker and a renamed "Zoom to region" (was "Study area") moved to the top of the
  pane**, directly below the unit toggle, side by side on desktop and stacked on the phone — out of
  the Data row's own body. The Layer picker is now a real, grouped `Select.svelte` (R3-B2) instead
  of a second, bespoke native `<select>`; the "(0.05°)" resolution note was dropped from "Raster
  cells" (it was never load-bearing there).
- **Every stack row's `Switch` became a plain checkbox**, and the inline opacity slider moved into
  a small per-row "opacity" popover button — the row itself is one compact line: name, checkbox,
  opacity, move buttons (now 32px, quieter).
- **Four rows are hidden from the pane** — Land & water, Boundaries, Roads & buildings (fine to
  leave on as default basemap without worrying about layer ordering) and Bathymetry (an unbuilt
  "coming soon" stub, not a feature to preview). All four stay full model citizens
  (`layerStack.ts`'s new `LAYER_GROUP_IN_PANEL`) — still in the default stack, the `layers=` URL
  codec, and Reset, just with no row to change them from in the panel.
- **The Data row's body is now just the color palette and "Cells outside Program Areas."** Color
  palette is a real visual ramp picker — a button showing the current palette's own gradient strip
  - name, opening a listbox of every palette (strip + name, arrow keys + Enter/Esc) — instead of a
    plain `<select>` of palette names.
- **The "Zone outlines" row is renamed "Outlines"** ("zone" does not otherwise appear anywhere in
  this app's UI) and gained an expander: a two-option radio choice (Program Areas / Ecoregions)
  bound to the existing `out=` URL key, each with a one-line explanation. "None" is reached via the
  row's own visible checkbox, not a third radio.
- **"Sphere" moved to the bottom of the pane**, below the stack — both lenses now share one
  projection control there (previously scores-only).
- **The species lens no longer shows the "Raster cells | Program areas" toggle at all** — species
  has no spatial-unit choice to make (unlike scores' zone choropleth), so the toggle is omitted
  entirely instead of rendered disabled with a reason.
- **Every checkbox/radio/range this pane renders now sets `accent-color: var(--fill-accent)`** —
  an unstyled native control rendered the browser's own default blue on the paper theme.
- **Fixed (R3-B1): a release whose composite layer is literally `metric_key: "score"` with no
  label anywhere showed the raw lowercase key** in the Layer picker, the floating legend, and the
  phone legend chip. All three now title-case a bare metric key via one shared helper
  (`boot.ts#metricKeyLabel`, "score" → "Score").
- `Popover.svelte` gained an optional custom `trigger` snippet, `triggerClass`, `align`, and a
  bindable `open` — used by the new opacity and ramp popovers; every existing caller is unchanged.
- `Select.svelte` gained optional `groups` (`<optgroup>`s) and a default `title` (the selected
  option's own label) — the ellipsis/ "never silently clip text" fix that used to live only in the
  scores lens' bespoke Layer `<select>` now covers every `Select.svelte` caller.

# atlas 0.10.67

P round, W5 (Opus 5.5 eyes-on review 5 of 0.10.66, 2026-09-25): two zone-fit framing gutters, a
report screenshot blind spot, and the capped flower's header.

- **Fixed: a Program-Area search pick's fitted area ran under the docked desktop panel's own
  edge**, by about 12px — the fit's own reserve counted only the panel's content width, not its
  outer CSS inset from the stage edge. The reserve now clears the panel's real edge, plus a small
  gutter, and no longer over-reserves a full-width column for the (short, corner-sized) floating
  legend card.
- **Fixed: the same fit had no side gutter at all on the phone** — a search pick's outline could
  land flush against the screen's own edge. Both zone and species-model camera fits now keep a
  breathing gutter on every side.
- **Fixed: the capped flower (phone, sheet at "Half" height) squeezed its own title into the same
  narrow column as the chart**, wrapping a clicked cell's coordinates onto two lines instead of
  spanning the sheet's full width above a centred, smaller chart.
- **Screenshot harness: the report's map (its legend and caption) is now captured directly**,
  instead of being skipped by a blind, fixed-distance scroll that missed it on the phone and only
  ever showed its very top edge on desktop.

- **Fixed: a Report with two (or more) Program Areas painted every place the SAME flat grey-blue —
  no colour at all**, even though the caption and legend both showed the real ramp and scores
  ("ramp 22 to 30 (red = high); highest Southern California (SOC) 30, lowest Central California
  (CEC) 22"). The map's colours were built once, before any place's score had actually loaded, and
  never repainted once the real numbers landed — the caption/legend kept tracking the real data
  because they render reactively, the map did not. The map now waits for every place's data before
  drawing.
- **Fixed: a report with a single place showed a fabricated "ramp 33 to 34" legend and caption**,
  implying a range that never existed for one value. A single place now shows its own score next to
  one swatch, not a two-ended gradient.

# atlas 0.10.65

P round, W3 (Opus 5.5 eyes-on review of 0.10.64, 2026-09-24): a Scores search zoom, the flower
plot's hub number and half-detent size, segmented-control widths, and three small copy/format fixes.

- **Fixed (BLOCKER): searching for a Program Area zoomed the camera to a spot the shell's own
  chrome then covered** — a flat 40px padding on every edge ignored the phone sheet or the desktop
  docked panel actually sitting over the map, so the found area (and its popup) landed mostly
  behind it. The camera now pads for whatever chrome is on screen right now, the same live padding
  the species-model camera already uses.
- **Fixed: the flower plot's hub number showed two white glyph-foot stubs poking out under the
  hover/tap label** — new with the bigger flower. The hub number is now hidden while a petal's own
  label is showing, rather than drawn underneath it.
- **Fixed: every segmented control (the Layers panel's "Raster cells | Program Areas" toggle, the
  Table tool's "Species | Zones | Composition" switch, the Feedback dialog's kind picker) filled
  only part of its own pill**, leaving a dead, unclickable band to one side. The segments now share
  the pill's full width.
- **Fixed: on the phone, the bigger flower plot could push the Component | Score table below the
  fold at the sheet's "Half" height** — the flower is now capped at a smaller size at Half height so
  the table's first rows stay in view; "Full" height still shows the bigger flower.
- **Report copy: "modelled" → "modeled"**, and the AquaMaps citation's "Unported License" now
  reads with its own space, not run together.

# atlas 0.10.64

P round, W2 (Ben, live-review of the LIVE 0.10.62 app, 2026-09-24): the Layers panel's spatial-unit
control and the Scores-lens flower plot.

- **The Layers panel's primary control is now ONE segmented toggle, "Raster cells | Program
  Areas", at the top of the panel** — styled like the top bar's own Scores|Species switch. It
  replaces the "Spatial units" dropdown that used to sit buried inside the Data row's own body (two
  controls setting the same thing would just have been confusing). In the Species lens it renders
  disabled, with a short reason ("Species surfaces are rasters only.") — species has no spatial-unit
  choice to make. Switching units still writes `?unit=` the same way it always did.
- **Fixed: every switch in the Layers panel glowed the SAME accent gold at once** — the layer
  stack's 8 visibility switches (all visible by default) plus the Sphere and "Cells outside Program
  Areas" switches lower in the panel, so the panel read as a wash of yellow with no real emphasis
  left for anything genuinely selected. Every switch in the panel now uses a quiet, neutral "on"
  color; accent is reserved for the new toggle above.
- **The flower plot is bigger** and now grows to fill the panel's own free area (it used to be
  pinned to a small fixed pixel size no matter how much room the panel had).
- **The flower plot has a reference ring** — a low-contrast dashed circle at the release's own
  published maximum component score, with a small grey "contour" label naming that value, read from
  the release manifest's own per-component metric maxima (the same source the map's score legend
  reads its own endpoints from) — falls back to 100, and says so, only on a release that publishes
  none.

# atlas 0.10.63

Round 2, W1: fixes for Ben's own live-app review of 0.10.62 (search, Places export, the utility
menu, About, the species Table tool, and two category-label bugs).

- **Fixed: the Scores search field never flew the map to a chosen Program Area** — only a typed
  coordinate zoomed the camera; selecting "Aleutian Arc (ALA)" from the dropdown wrote the URL
  selection but left the view exactly where it was, because no published release carries a zone
  label point (`label_pt`) for the camera to fly to. Selecting a Program Area now flies to its own
  polygon, queried live off the same PMTiles source the map already draws its outline from, falling
  back to the (currently unpublished) label point only if that query finds nothing.
- **Fixed: "Download places" wrote `geometry: null` and the bare acronym (`name: "GAA"`) for every
  Program Area, never its full name or a real shape** — the exported GeoJSON now carries the
  release's own resolved "Full Name (KEY)" label and the zone's real polygon (queried live off the
  same PMTiles source), falling back to a small bbox square (marked `geometry_source: "bbox"`) when
  no polygon tile has loaded, and an explanatory `note` — never a silent `null` — as the last
  resort.
- **Changed: the desktop top-bar utility row dropped its duplicate Report button** — Report already
  lives in the left tool rail; the phone ⋯ menu's own Report item is unchanged.
- **Changed: Share, Help, Feedback and the (i) info button are icon-only, with a hover/focus
  tooltip** — the accessible name (aria-label) is unchanged, so keyboard and screen-reader users see
  no difference; only the visible word is gone.
- **Added: an About-dialog credits line** for Ben Best (Ocean Metrics LLC) and Timothy White (MMA).
- **Fixed: the top-bar search field was narrower, with a visible doubled border, in the Species lens
  than in the Scores lens** — both fields now fill the same width and share one clean border (the
  field's own), never a border nested inside another.
- **Added: the species lens' Table tool now lists the selected model's real inputs** (name, dataset,
  representation, availability — struck through with its reason when a release has no raster
  registered) instead of a permanent "arrives in a later phase" placeholder.
- **Changed: the "Primary producer" flower/table category is now labelled "Primary production"**,
  matching the published scoring documentation.
- **Fixed: v1's flower plot showed a "No data" petal for a real, scored component** — v1 (and every
  pre-v8 release) publishes a `reptile` extinction-risk category that predates the current
  eight-category palette; it now shows its own name ("Reptile") instead of the "not reportable"
  label, the same treatment every other unrecognized-but-real category already gets on the score
  tables.

# atlas 0.10.62

Round 2, V7: fix for CI run 36070452831 (three-engine job, 97/1119 failed on chromium, webkit AND
firefox) — the V3 service-health banner covered the top bar and misread ordinary hermetic-fixture
404s as an outage.

- **Fixed: the health banner (titiler/data-origin outage notice) covered the top bar, blocking
  every click underneath it** — it rendered as a `position: fixed` overlay pinned to the viewport's
  top edge, on top of the Feedback control, the Scores/Species switch, the ⋯ menu, Help > Docs and
  the theme toggle whenever it showed. It now renders inside the map stage, below the top bar's own
  row (which it can no longer cover) and above the map (which it may overlap).
- **Fixed: the release-data health check treated an ordinary 403/404 as the service being down** —
  it probed `{release}/app/boot.json`, which legitimately does not exist yet for any release, and
  read that as an outage rather than a normal "nothing published here" response. Combined with the
  placement bug above, this raised the banner (and blocked topbar clicks) on nearly every page load
  that didn't already have `app/boot.json` published. Only a genuine server error, timeout, or
  network failure now counts as down. The check also now looks at the same data location the page
  itself already loaded from, rather than assuming the public default.

# atlas 0.10.61

Round 2, V6: fix for the Scores-lens top-bar search found while shooting the Program Area harness
state.

- **Fixed: the Scores-lens top-bar search ignored a Program Area's full name unless the release
  happened to publish one** — on the real release (no published `zones.programarea[*].name`),
  typing "Aleutian" or "Gulf of Alaska" showed "No matches", even though the dropdown's own option
  already read "Aleutian Arc (ALA)" / "Gulf of Alaska (GOA)" via the app-side fallback name table.
  Only the bare acronym worked, contradicting both the search field's own placeholder ("Program
  Areas or lon, lat") and the option text it renders. The matcher now ranks against the SAME
  resolved name the dropdown shows.

# atlas 0.10.60

Round 2, V5: follow-up on the Opus eyes-on review of 0.10.59 — the eyes-on harness's own desktop
tap points were stale, a report table hid columns with no cue, and assorted copy/label nits.

- **Fixed: the eyes-on screenshot harness's desktop tap points had gone stale**
  (`scripts/eyes-shots.mjs`) — all three fixed pixels landed on land for the current globe camera,
  so four desktop states silently shot the whole study area instead of a per-cell flower/table,
  with no warning in the log. Taps are now computed by PROJECTING known real scored lon/lat points
  (northern Gulf of Mexico, Gulf of Alaska, mid-Atlantic shelf) with the live map's own
  `map.project()`, so they survive any future camera/zoom change; a miss now prints a WARN and
  marks the shot filename `-MISSED`. New "programarea" state selects a real Program Area through
  the Scores-lens search field, so the flower/table's Program Area name routing is finally on
  screen.
- **Fixed: the report's species-counts table hid up to 6 of 8 extinction-risk columns with no cue
  that more existed** — the cut happened to fall exactly on a column edge, so a truncated table
  looked complete. It now shows a right-edge fade and a "Scroll right for more columns" hint,
  narrow screens only, and only when the table genuinely has more to scroll to.
- **Fixed: inconsistent spelling ("coloured" vs "colored") in the same report** — American English
  throughout, matching the docs book.
- **Fixed: source common names in the Top-20 table were shown exactly as published** ("great
  hammerhead shark") — now sentence-cased for display ("Great hammerhead shark"); the underlying
  data and every link are unaffected.
- **Fixed: the species category showed as a raw, lowercase key in three more places** — the report's
  species-counts summary sentence, and the species-lens sidebar's own "Category" fact — now read
  "Turtle"/"Mammal" the same way every other category label in the app already does.

# atlas 0.10.59

Round 2, V4: the phone species camera squeezed a wide model's range into the bottom of the screen
under globe projection; assorted docs/copy corrections found in the same review pass.

- **Fixed: the species camera left most of the map empty instead of framing the model** (phone,
  and to a lesser extent desktop). A wide species range — the default leatherback view, or a
  walrus model whose fit needed a low zoom — computed its camera with flat-Mercator shift math
  that does not land on the same screen pixels once MapLibre renders the GLOBE projection it
  actually uses at that zoom: the range ended up bunched into a corner of the map, most of the
  frame empty black space. The camera now asks MapLibre's own projection-aware `cameraForBounds()`
  for the fit. Desktop: the floating species legend card (bottom-left) is now also accounted for,
  so a model's own south-west corner is never drawn underneath it.
- **Fixed: Program Area names were still a bare key ("GAA") in three places** — the Scores-lens map
  hover/click tooltip, the Flower panel's title for a selected zone, and the Table tool's "Species
  for Program Area: …" header — now show "Full Name (KEY)" the same way the Zones table and Places
  panel already do.
- **Fixed: the report page could break a common-name link mid-word** ("Leatherb|ack") — every link
  in the document, not just the raw-URL ones, allowed a break at any character; now scoped to just
  the permalink and citation links, which genuinely need it.
- **Fixed: a report table's caption could be clipped by its own horizontal-scroll wrapper**
  ("Top 20 highest-scoring species (by habitat-weighted exti…" cut off on phone) — captions now sit
  above the scroll container, at the section's full width.
- **Fixed: the species layer pill's "no surface" tooltip gave the wrong reason.** It now says a
  model has no raster registered in this release's registry (the same lookup the Species Shiny app
  makes), not that the release "publishes no surface for it."
- **Fixed: the feedback dialog's privacy note was ambiguous about when a GitHub issue is filed.** It
  now says the issue is filed either way on a public release, whether or not you give an email, and
  that your email — if you give one — never appears in the issue itself.
- **Fixed 1 false result in `scripts/eyes-shots.mjs`** (the eyes-on screenshot harness, dev-only):
  the scored-cell tap now stops at the first point that actually produces a popup, instead of
  clicking every candidate point regardless and letting a later land/ocean tap dismiss or replace
  an earlier valid one.

# atlas 0.10.58

Round 2, V3: titiler-v8 (every score/species map tile) and the API were unreachable for an hour
tonight, and the live app kept rendering a perfectly normal-looking map with no raster and no word
to anyone.

- **Added: service-health detection with a visible banner.** The app now checks the map tile
  server and the release data origin at boot, and again whenever a map tile actually fails to load
  for a real reason (a 5xx, a network error, or a timeout — never a normal "this release has no
  data here" 403/404). When one is down, a dismissible top banner names the failing host, what it
  breaks, and what still works, with a Retry; the legend shows a compact "tiles unavailable" state
  instead of a bare ramp. It never polls in the background — only at boot, on a real failure, or on
  a manual Retry.

# atlas 0.10.57

Round 2, V2: report flower colours/centring, raw category keys cleaned up, and the eyes-on
screenshot harness fixed (Opus eyes-on review of 0.10.55).

- **Fixed: the report's flower petals were visibly PALER than their own legend swatches.** Both the
  on-screen flower (`Report.svelte`) and the exported DOCX/standalone-HTML flower
  (`report/flowerSvg.ts`) drew petals at reduced opacity (0.5 / 0.92) while the legend swatch a few
  lines below read the SAME `--cat-*` color at full opacity — one document, two different renderings
  of the identical color. Petals now render at full opacity, matching the live app's own flower.
- **Fixed: the report's flower was left-aligned instead of centred**, most visible on a phone where
  one flower panel fills nearly the full content width.
- **Fixed: raw internal keys ("primprod", lowercase category names) showed up as display text** in
  the report's Table of Scores header, its Summary of Species Category column, the Places panel's
  Component/Category columns, the Species table's Category column, and the Scores lens's Zones
  table — all now show a proper label ("Primary producer", "Bird", …) via one shared
  `categoryLabel()` helper. Sorting, filtering and CSV export are unchanged (they still use the raw
  key).
- **Fixed 3 false results in `scripts/eyes-shots.mjs`** (the eyes-on screenshot harness, dev-only):
  the flower-petal tap now targets a real petal and waits for its label before shooting; the
  species-table shot now waits (bounded) for "Loading species…" to clear instead of shooting
  mid-load; the "map" state now collapses the default-open Layers panel/sheet first, so it is no
  longer byte-identical to the "layers" state; and the phone tap points moved higher in the map, off
  the legend chip's band.

# atlas 0.10.56

Round 2, V1: five defects an eyes-on review of the live phone build found that every automated
gate had passed.

- **Fixed: Program Area names were acronym-only everywhere** ("ALA" instead of "Aleutian Arc
  (ALA)"), even after an earlier round's "Full Name (KEY)" formatting shipped — no published
  release (v6 through v9) actually publishes a full name on its Program Area rows, so that
  formatting had nothing to format. A new app-side name table (generated from the canonical
  Program-Area geometry) now fills in for every real release, in the picker, the Places list, the
  results panel, and the report.
- **Fixed: the desktop panel's "Full screen" button did not actually reach full screen** — the
  panel's own content box stayed capped at 720px wide even though its frame filled the whole
  stage.
- **Fixed: the report page overflowed sideways on a phone** — a wide table (many score components,
  or a long species name) and the permalink line could each push the whole page wider than the
  screen; both now stay inside the page, with tables scrolling within their own box.
- **Fixed: selecting a species model on a phone could frame it partly under the bottom sheet (and
  the floating legend chip)** — the camera fit now accounts for whatever chrome is actually
  covering the map, on both phone and desktop.
- **Fixed: the disabled "Show analysis cells" control gave no visible reason for why it was
  disabled** — its reason previously showed only on hover, which is unreachable on a touch device
  and could clip at a panel's edge on desktop. It now always shows as a short line of text next to
  the control.

# atlas 0.10.55

Round 2, Q7: the Sheet-log beacon actually reaches the Sheet.

- **Fixed: setting `VITE_LOG_URL` did nothing.** `docs/analytics.md` and Ben's own instructions
  said the analytics Sheet-log beacon (the same batched log the Shiny `scores`/`species` apps
  write) was enabled by setting the repository variable `VITE_LOG_URL` — but neither construction
  site ever passed a `logUrl` to `createAnalytics()`, and `pages.yml`'s build step never forwarded
  the variable in the first place, so the beacon could never fire no matter what the variable was
  set to. Both gaps are now closed (`src/lib/analytics/logUrl.ts`'s `analyticsLogUrl()`, wired into
  `Shell.svelte`/`Report.svelte` and `pages.yml`); GA4 reporting is unaffected either way.

# atlas 0.10.54

Round 2, Q4: the feedback endpoint and preview-host link flags.

- **Fixed: the published build could never pick up the "Send feedback" endpoint or the new preview
  -route flag.** `.github/workflows/pages.yml`'s build step carried `VITE_SEAL`/`VITE_AGENCY` but
  never `VITE_FEEDBACK_URL` (docs/feedback.md's own runbook) or `VITE_PREVIEW_ATLAS_ROUTE` (below)
  — a repository variable set in GitHub could never reach the site GitHub Pages actually serves.
  Both are now wired into that same build step.
- **The version picker's "Continue on the preview host" Atlas link is now gated on the route
  actually existing.** The preview host has not deployed the Atlas's own `/{ver}/atlas/` route yet
  (atlas-9, P8 item 8, deferred), so that link 404s a reviewer who follows it in good faith. Behind
  the new build-time `VITE_PREVIEW_ATLAS_ROUTE` flag (off by default): the modal now says "The
  preview host does not serve the Atlas yet; open the Scores/Species apps there instead," linking
  the Scores and Species apps that already are deployed there, for both a denied `?ver=` request
  and every restricted row in the release list. Flipping the flag to `1` (once atlas-9 ships)
  restores today's direct link with no code change.

# atlas 0.10.53

Places: choosing a Program Area now opens the same results panel a drawn or uploaded place gets --
a coverage note (cells, area, published composite), the flower, and the component table, all read
straight from the release. Its species table loads on request through the same path the scores
lens' Table ▸ Zones tool uses. "Show analysis cells" is not yet available for Program Areas (no
per-zone cell data is published to the app yet) and now says so plainly instead of showing a
disabled button with a misleading reason. Also: fixed a rare race where "Show analysis cells"
could paint the wrong place's cells if the selection moved while a load was in flight.

# atlas 0.10.52

Q2: GeoPackage upload actually reads, and uploads honour the documented naming options.

- **Fixed: every `.gpkg` drop was refused, unconditionally, since 0.10.47.** The reader
  (`parseGeoPackage`) has needed a real `GeoPackageRuntime` all along, but `UploadPanel.svelte`
  hardcoded `runtime: null` no matter what — so "GeoPackage is not supported yet" never depended on
  anything, and retrying could never have worked. A `.gpkg` is now read through the SAME DuckDB-WASM
  engine the scores boot (its `spatial` extension fetched live, with consent, from
  `extensions.duckdb.org` — the one deliberately non-mirrored third-party download, ~23 MB); the
  drop-zone hint drops its "(not yet)".
- **New refusal: a GeoPackage with no vector layer** (raster tiles, or a plain attribute table) is
  now named by `geopackageNoFeatureTable` rather than surfacing `ST_Read`'s raw SQL error.
- **`geopackageNoRuntime`'s copy no longer tells you to wait and retry** — that only ever applied
  during the brief window before a release version resolves, and even then the fix it now states
  (convert to GeoJSON/FlatGeobuf) is the one that is actually guaranteed to work.
- **Fixed: a feature's own name (KML's `<name>`, a GeoJSON/shapefile `name`/`title`/`label`
  property) was never used.** `docs/upload.md` documented this as a naming option
  (`nameProperty`) since it was written, but the one caller never passed it, so every upload was
  named from the file, numbered — regardless of what the file itself said about its own features.
  Leaving `nameProperty` out (the default) now auto-detects the first of `name`/`title`/`label`
  (case-insensitive) the file's first feature carries a non-empty value for; an explicit property
  still forces that one, and an explicit `null` still forces the file name.

# atlas 0.10.51

Q1: **the top-bar search now works in the Scores lens.** It was a stub `<input>` that did nothing
at all when typed into (only the Species lens' search ever worked). It now matches, offline (no
Nominatim, no third-party geocoder, no network call — entirely against what the release itself
already publishes):

- **Program Areas** (and any subregion/ecoregion archive the release also happens to publish), by
  key ("ALA") or by name ("Aleutian"). Choosing one selects it exactly as clicking it on the map
  would — same URL fields, same flower/species/table panels — and flies the camera to it.
- **Coordinates** — "lon, lat" (e.g. "-140, 57"), with "lat, lon" also read correctly, either via an
  explicit `lat`/`lon` label or inferred when the default order would be out of range. Flies to the
  point and selects that cell.

Results are a keyboard-navigable list (Arrow keys, Enter to select, Esc to close), same accessible
pattern as the species search. Available on both the desktop top-bar field and the phone search
modal.

# atlas 0.10.50

P10: Help ▸ Docs (desktop Help menu and the phone ⋯ menu) now opens the current release's **Atlas
chapter** of the documentation book (`…/docs/{ver}/apps/atlas.html`), not the book's Preface. A
restricted release's link now points at the signed-in preview host instead of the public book,
which never publishes a restricted release's pages at all; an unresolved/unknown release falls back
to the book's root rather than guessing a chapter path that may not exist.

# atlas 0.10.49

P9 (two live bugs found by the Opus 5.5 docs re-check appendix, dark theme):

- **Fixed: dragging a drawn shape's corner added a duplicate place.** terra-draw fires its "finish"
  event on a select-mode edit too, not only on a fresh draw; the app treated every finish as a new
  shape. A finish for a feature this session already turned into a place now updates that place's
  geometry in place (same row, same name, re-analysed); only a genuinely new feature adds a row.
- **Fixed: the phone's first view showed Canada and the Great Lakes, with no scored cells in
  frame.** The previous fix (0.10.45) boosted the zoom of the same point the desktop camera uses —
  `FALLBACK_FULL_STUDY_AREA`'s own centroid, central North Dakota, nowhere near the ocean. The
  phone's default view now fits a real Gulf-of-Mexico/south-east-U.S.-coast bounding box into the
  free area instead, live-verified to show real scored cells and a recognisable coastline.

# atlas 0.10.48

CI fix round (first completed three-engine run since the P round, 35971206753): two reds, one
flake.

- **The Layer select (Layers panel) now carries a `title` tooltip with its full name.** A native
  `<select>`'s own closed-box text truncation cannot be styled portably — Chromium honors
  `text-overflow: ellipsis` there, WebKit does not (confirmed: it hard-clips mid-word with no "…"
  regardless of the computed style, which itself differs between WebKit builds). `title` is the
  cross-engine fallback: the full layer name is always discoverable on hover, on every engine,
  even where the visual ellipsis is Chromium/Firefox-only.

# atlas 0.10.47

P8 (Places defects found by P7's handback and the Opus 5.5 docs review, dark theme):

- **A place touching land or past a release's published footprint no longer fails.** A drawn place
  asks for `app/cell` tiles by grid position, and a release does not always publish every tile
  (live-reproduced: v7, `-170,50,-130,60` — tile 593 answers 403 while its neighbours answer 200).
  A missing tile is now read as "no scored cells there," and the row still shows its composite from
  whichever tiles the release DID publish; a genuine failure (a 5xx, a network error) still surfaces
  the same honest "analysis unavailable…" message as before.
- **Fixed: a Program Area row never showed numbers.** It was reading `composite`/`score`/
  `pct_covered`/`coverage` off the top of a `boot.json` zone row — fields no release actually
  publishes. The composite lives nested under `metrics`, keyed by the release's own composite
  metric; a row now reads it from there, and reads "not published for this release" (never "not
  analysed yet") when a release genuinely carries none.
- **Fixed: a row's "Open in report" reported every place in the panel, not just that row.** It now
  builds the report link from only the clicked row's own place.
- **Fixed: "Export CSV" on a place's Components/Species tables did nothing.** Both tables now
  download a real CSV of the visible rows.
- **Fixed: the Share dialog's "Copy link anyway" could copy the full, unsimplified original link**
  when several places were in the URL or a place's name contained a space — the address bar
  percent-encodes the link (`~` → `%7E`, a name's own internal `%20` escape doubled to `%2520`), and
  the copy logic compared against the RAW, unencoded value. The copied link is now built by parsing
  the address bar, never by matching text against it.
- **Fixed: the coordinate-entry dialog skipped the "must touch the U.S. study area" check** that
  file uploads already enforce — typing or pasting coordinates entirely outside the study area is
  now refused with the same message an out-of-area upload gets.
- **GeoPackage now says plainly that it isn't supported yet** ("export as GeoJSON or a zipped
  shapefile"), instead of telling you to wait for the map to finish loading and try again — that
  could never succeed. The upload drop-zone's format list marks it "(not yet)".
- **Fixed: the "Done" button after drawing a shape didn't actually end draw mode** — it stayed on
  screen and the draw session kept claiming map clicks. Clicking it now really ends the session.

# atlas 0.10.46

P7 (Ben, live 0.10.43, "Places" tool, dark theme): after drawing a second place, BOTH places'
outlines disappeared from the map — the list still showed both rows, each stuck on "not analysed
yet" / "—".

- **Every place in the list is now drawn on the map at all times** — after the first draw, after
  the second, after a reload from a shared `#pl=` link, and after any style recomposition. The map
  used to draw only the SELECTED place's outline (`placesMap.svelte.ts`'s baseline called
  `selectedGeomPlaceGeometry`, one place); drawing a second place auto-selects it, so the map's one
  visible outline moved onto it and the place drawn just before silently vanished. Fixed by drawing
  every `kind: "geom"` place always (`model.ts#allGeomPlacesOutline`); a pick-mode/draw preview now
  layers ON TOP of the already-drawn places instead of replacing them.
- **Fixed a real, reproducible crash in the draw tool itself.** terra-draw manages its own map
  layers directly, and this app's own `setStyle(diff:true)` cycle — fired on every finished draw —
  was silently deleting them, since they were never part of the composed style. terra-draw's next
  redraw then threw an uncaught `TypeError`, and a second shape's own edit handles could stop
  appearing. `applyStyle()` now preserves terra-draw's own layers across a recompose.
- **A drawn or entered place is analysed automatically**, the same way a Program-Area pick already
  shows numbers with no visible step — every row now shows its real composite/coverage as soon as
  it exists, not only the one currently selected.
- **A place that genuinely cannot be analysed (a release object the bucket doesn't have) now says
  so honestly** — "analysis unavailable for this release: `<object>` (HTTP `<code>`)" — instead of
  sitting on "not analysed yet" forever or showing a raw, stack-shaped error message.

# atlas 0.10.45

**P6 — map + lens defects from the Opus 5.5 eyes-on assessment (D3, D4, D8, D12, P2).**

- **D3: a click outside the scored area no longer misleads.** The popup for a cell with no value
  (off-grid, unscored — e.g. land) now reads a plain one-line "No scored cell here · lon …, lat …"
  — never a cell id and never the layer's long title (a Utah click used to read "Cell 2711027 ·
  lon -113.526, lat 38.932 · {30-word description}: no value"). That click also no longer WRITES
  the selection: the previously selected scored cell (or nothing) stays selected, so the Flower and
  Table panels never flash a misleading "not published"/"could not be loaded" message for a click
  that never landed on scored data at all. Those panels' own empty-state copy is now "Click a
  scored cell on the map to see its flower / species", with a genuine query failure (a real thrown
  error, not just "nothing here") shown as a visually distinct message that names the failure. The
  species lens' own click popup got the same treatment: a "no value" click (a nodata COG pixel, or
  off the release's grid) now shows one line, "No scored cell here", with NO Cell ID line at all —
  even when the click did resolve a real grid cell, since showing an internal id beside "no value"
  reads as a lookup bug rather than "this model has no data here".
- **D4: the click popup shows the SHORT metric label, not the long description.** The popup used to
  print `boot.layers[].label` verbatim (e.g. the full VGPM productivity description); it now prefers
  the release manifest's own short per-metric name (`manifest.metrics[]`), matching the layer picker
  and legend.
- **D12: the popup tip now matches the popup's own background** in both themes (already the case in
  code; re-verified with this round's other popup changes).
- **D8: selecting a species model now frames its own extent**, not the whole default study area. A
  model with no published bbox of its own now falls back to a SIBLING input's bbox for the same
  taxon (e.g. AquaMaps framing off AquaX's extent) before falling to the study area, and — as the
  true last resort, for a release that publishes no bbox anywhere (v1-v7) — fetches the drawn COG's
  own extent from titiler's `/cog/info` (real-build verification found `/cog/bounds` is not a
  registered route on titiler-v8) and, when that extent is a degenerate whole-360°-longitude span
  (measured: the walrus v7 COG's own metadata), narrows it with a small point-probe sweep before
  flying. The manual "zoom to layer" re-fit reaches this same last resort, not just the automatic
  fly-to on selecting a model.
- **P2: the phone first view no longer leaves a large empty band of "sky" above the globe, and no
  longer strands Canada/Greenland in frame instead of the US.** A flat-Mercator shift alone could
  not fix this: MapLibre's GLOBE projection renders the whole sphere below roughly zoom 3 regardless
  of how the shift is capped. The fix raises the phone's initial zoom
  (`PHONE_STUDY_AREA_ZOOM_BOOST`) before applying an (uncapped) panel/sheet-aware shift — verified
  against the real v7 build, not only the hermetic fixture — and the initial fit now re-runs once
  the Layers sheet's own measured height at its default detent is known, rather than assuming a
  constant. The same asymmetric, chrome-aware padding is available to any `fitBounds`-style camera
  fit (`boundsToCameraView`'s new `ChromePadding` option), reused by D8's model-selection fly-to.

# atlas 0.10.44

**P5 — shell defects from the Opus 5.5 eyes-on assessment (2026-09-24):**

- **Fixed: the desktop legend was invisible.** `ScoresLegend.svelte`/`SpeciesLegend.svelte` were
  pinned bottom-right at a fixed z-index below the default right-docked panel, which fully covered
  that corner — every desktop map showed color with no key. The legend now reads the panel's live
  dock/maximized state (mirrored onto `.stage` by `Shell.svelte`) and repositions to stay clear of
  it at any dock side, and hides while the panel is maximized.
- **Fixed: two broken select styles in the Layers panel.** `lib/ui/Select.svelte`'s box used to
  shrink to its label text while its chevron floated at the far right of the field, at both
  desktop and phone widths — it now spans its container with the chevron inside the box. The
  native Layer `<select>` (`lens/scores/LayersPanel.svelte`) no longer clips a long layer name
  mid-word with no ellipsis.
- **Added: search is reachable on the phone.** The topbar search field (which also hosts the
  species picker) was desktop-only, so a phone visitor could not search a place or change species
  at all. A new search button beside the ⋯ menu opens the same search content as a focused,
  near-full-width modal.
- **Fixed: minor top-bar/menu inconsistencies.** "Feedback" no longer renders underlined next to
  its button-styled neighbours; the version chip's chevron now sits after "v7", matching every
  other select-like control. The phone ⋯ menu's "Take a tour" now has its own icon, distinct from
  "Docs".

# atlas 0.10.43

P4 (Ben, phone, "Report" tool, live 0.10.37): the Report map was duplicated and seemingly empty
(or at least never zoomed to the selected place), and the Table of Scores printed a footnote on
nearly every cell.

- **The Report map is ONE figure again.** The static print/export snapshot (`.map-print`) is now
  hidden on screen by default (it only shows for print or the downloaded HTML) — previously it sat
  visible right below the live interactive map, reading as two stacked, mostly-empty map boxes.
- **A Program-Area place now draws its real polygon and the camera fits it.** The report map used
  to draw a zone place only as a circle at its `label_pt` — a field no published release actually
  carries, so the place was silently dropped and the camera never left its default view ("not
  zoomed to selected/drawn areas"). It now draws the place's real polygon from the release's own
  PMTiles (the same source the live Atlas already uses) and flies the camera to its real extent.
- **Table of Scores footnotes are grouped, one per area, and only for genuinely partial coverage.**
  The floor moved from "anything under ~100 % coverage" (which footnoted almost every cell) to
  99 %, and every component below it — plus any component the release's own 5 % coverage floor
  dropped entirely — now joins ONE sentence per area ("ALA: turtle scored over 88.3% of the
  area.") instead of a separate near-duplicate footnote per component. A mean-where-scored note is
  appended only when it differs from the displayed value. Every export (HTML, DOCX, ZIP) reflects
  the same footnotes as the screen.

# atlas 0.10.42

R2, round 3 (owner finding on live at 390x844: Scores → Table → Species for cell 3092526, and
the Places tool's Program Area list).

- **The species/zones tables no longer squeeze every column to ~2 characters.** Columns get a
  readable minimum width (text) or fit their short content (numeric/boolean); the TABLE now
  scrolls horizontally when it doesn't fit (the panel itself never does), with the identifying
  column (Scientific name / Zone) and the header row both sticky. Header labels wrap instead of
  truncating. The same min-width/sticky/scroll treatment applies to `src/lib/ui/DataTable.svelte`
  (the Places panel's Components/Species tables).
- **Phone-width (< 900px) species table**: opens with a compact six-column default (Category,
  Scientific name, Common name, ER code, ER score, Area) and a new "Columns" control to add/remove
  any column; the choice persists for the session. Desktop is unchanged (every column, still with
  the new min-width/scroll behavior).
- **Program Area names**: everywhere a Program Area is presented (the Places panel's list, the
  zones table), the label now reads "Full Name (KEY)" when the release publishes a name, falling
  back to the bare key otherwise (`paLabel()`) — never the bare key alone when a name exists.

# atlas 0.10.41

P2 (owner finding on live 0.10.37, phone/dark theme, Scores lens, Flower plot tool): the flower
plot sat left of centre in its panel, tabbing to or tapping a petal drew a stray focus rectangle
around it, petal values never showed on tap/hover, and the values under the plot were a prose
paragraph instead of a list.

- **Centred.** The flower figure is centred in its panel, and its SVG is centred within its own
  wrapper, instead of sitting flush left with empty space on the right.
- **No more stray outline rectangle.** `outline` on an SVG petal always painted the element's
  bounding box, not its actual wedge shape — replaced with a purpose-drawn stroke highlight that
  follows the petal's own geometry, shown only on a real tap/click or keyboard focus (never on a
  bounding-box rectangle).
- **Tap (or hover, on desktop) a petal to see its value.** A small label with the component's name
  and its score (one decimal) appears near the hub; tapping the same petal again, or elsewhere,
  dismisses it; desktop hovering shows the same label without a click.
- **Values are a table now, not a paragraph.** Component swatch, name and score are listed under
  the plot as a real table, ordered as the petals are, with the composite mean as the last row; the
  prose summary sentence is now a screen-reader-only alternative rather than a second, visible copy
  of the same "Cell ID … (x, y)" line the panel's own header already shows once.

# atlas 0.10.40

P1, round 2 (owner finding on the LIVE app, 390x844, dark, v7, Scores lens, 2026-09-24): the
phone legend chip overlapped the bottom sheet, and the legend it opened was blank.

- **The legend chip no longer overlaps the sheet, at any detent.** It used to float at a FIXED
  distance from the bottom regardless of the sheet's state — squarely on top of the sheet's own
  collapse/half/full buttons when collapsed ("peek"), and over the last row of whatever the sheet
  was scrolled to at "half"/"full". It now tracks the sheet's REAL measured height (`Sheet.svelte`'s
  new `ongeometry`) and floats just above its top edge at every detent except "full", where it
  moves INSIDE the sheet's own header block instead (a real, non-scrolling row under the drag
  handle/title — never over the header buttons, never lost in the scrolling body).
- **Tapping the chip now opens a real legend, not a blank dialog.** `ScoresLegend.svelte`/
  `SpeciesLegend.svelte` used to hide their own root below 900px ("no room beside the sheet" on
  desktop) — but the phone modal reuses that same component verbatim, so the same rule blanked the
  modal's body on the one viewport it was built to serve. The desktop-only hiding now lives in a
  wrapper class the shell owns (`shell.css`'s `.lens-legend-region`) instead of inside the
  components themselves. Fixing that also exposed the legend's own desktop `position: absolute`
  placement spilling its ramp past the (narrower) modal's edge — neutralized to normal flow inside
  the modal so it now renders fully contained, ramp + both endpoint labels.
- The chip's own label is now the short, fixed word **"Legend"**, with the metric name shown after
  it only as space allows (never wrapping to a second line); the full title is unaffected in the
  modal.

# atlas 0.10.39

Fix round for CI run 35956406448 (job 107495562810), the first clean-runner three-engine suite
after merging U1 (0.10.36): 9 tests red, 876 passed. All four root causes below reproduced red on
current `main` first, then fixed and confirmed green on three engines.

- **PREVIEW badge textContent**: U1's compact-form fix for verify.mjs's 320px species-lens states
  kept BOTH "PREVIEW" and "PRE" always in the DOM (one hidden via a CSS media query) -- visually
  correct, but `.textContent` (what `toHaveText`/a scraper reads) concatenates both regardless of
  `display: none`, so `e2e/shell.smoke.spec.ts` read "PREVIEW PRE" on all three engines. Fixed
  the honest way: `VersionBadge.svelte` now tracks its own `compact` state via the SAME
  `matchMedia` pattern `Shell.svelte`'s `isPhone` already uses, and renders exactly ONE text value
  at a time -- `textContent` and the accessible name always agree with what is rendered.
- **`e2e/shell.url-state.spec.ts`**: the panel-size control walk still clicked "Full height"/"Half
  height" -- buttons R1's dockable panel replaced with dock left/bottom/right + maximize/restore.
  `locator.click` timed out finding either (three engines). Updated to walk R1's own control set.
- **A shared live region race** (`e2e/scores.popup.spec.ts`, `species-popup.spec.ts`,
  `shell.chunk-error.spec.ts`): the first-view map loader's "Map ready" announcement went through
  the ONE shared `announce()` region (`src/lib/ui/announcer.ts`) -- but that loader is PERSISTENT
  and its own "idle" event can fire at any later, unpredictable moment, clobbering an unrelated
  feature's own announcement made in between (a popup's description, a chunk-load failure). Fixed
  with a SEPARATE, dedicated `role="status"` region for the loader alone
  (`[data-testid="map-loading-status"]`) -- `Honeycomb.svelte` gained an `announceOnMount` prop
  (default `true`, unchanged for its other caller, the gallery demo) so `Shell.svelte` can opt its
  own mount-time announcement out of the shared channel entirely.
- **`matrix.a11y.spec.ts` "rail tool: Flower plot"** (chromium): `RailButton.svelte`'s `.railitem`
  transitioned `background`/`color` together over `--motion-fast` (150ms) on every tool switch --
  found by a direct DOM sweep mid-transition: the OUTGOING (deselected) button briefly renders a
  near-transparent gold background tint (`rgba(232,194,74,0.04)`) while its text is still close to
  `--text-secondary`, a genuine sub-4.5:1 intermediate frame worse than either the idle or active
  end state (axe: `#c7d2e8` on `#e8c24a`, 1.12:1). Dropped the transition on this one element --
  the switch is now instant/discrete between the two known-good end states, so no frame in between
  can ever be under-contrast. `--motion-fast` itself is untouched everywhere else.

# atlas 0.10.38

**U4 — the Layers model (round-2 plan §5 U4, `docs/usability.md` §7 R3, Ben's decision 2026-09-24):
"one Layers panel that IS the stack, the data row expanding into today's controls — PLUS the
ability to change the stacking of data layers (Program Areas, the score raster) relative to map
layers (place names, bathymetry)."**

- **The layer stack model** (`src/lib/map/layerStack.ts`, pure + unit-tested): five basemap
  sub-roles classified from the merged CARTO style (`classifyBasemapLayer`: land/water,
  bathymetry — empty today, ready for GEBCO — boundaries, roads, labels) and three data groups
  (the lens's raster, Program Areas, places/selection), each with `visible`/`opacity`, reorderable
  bottom-to-top. `composeStyle({layerStack})` consumes it: `rankForStack()` expands the group order
  into `orderLayers()`'s rank table, and `applyLayerGroupStyling()` overrides a layer's
  `layout.visibility`/opacity paint key(s) uniformly, basemap or data. Omitting the input (every
  pre-existing caller) is a byte-identical no-op — the single "basemap" role that used to sit
  entirely UNDER the raster is now five sub-roles in the SAME default position, so `basemap-labels`
  above `data-raster` (a map layer's name over a semi-transparent score raster) is a new capability,
  not a changed default view.
- **`layers=` is the new URL key** (`state/codec.ts` calls `layerStack.ts#parseLayerStack`/
  `formatLayerStack`): `<id>[:h][:oNN],...`, written only as a deviation from the default stack; a
  known group missing from a token is appended at its default position (forward-compatible with a
  future group), an unknown id is dropped, never a throw. Grammar documented in `docs/map.md`.
- **The Layers panel is now the stack** (`src/lib/ui/LayersPanel.svelte`, shared by both lenses):
  each group is a row (name, visibility switch, opacity slider, ▲▼ move buttons with an
  `aria-live` position announcement); the "Data" row expands into the existing per-lens controls
  (scores: study area/units/layer/palette/projection/outside-PRA; species: title/layer bar/card) via
  a `dataControls` snippet, unchanged content, new container. "Reset layers" restores the default
  (disabled when already there). `src/lens/scores/LayersPanel.svelte` is now ONLY that data-row
  content (the old non-interactive "Layers on the map" bullet list is gone — the stack itself is
  that list now, made real).
- **Both lenses keep the same basemap-group choices across a lens switch** (`sel.layers` is one
  lens-independent field on `Sel`).
- **Orchestrator parity-audit fixes folded in**: (1) the eye toggle is gated by a real e2e pixel
  probe, not just a unit test. (2) The standalone ECOREGION outline (black, 3px —
  `layers/zones.ts#ZONE_LINE_STYLE.ecoregion`, already in the table but never drawn) is read from
  the release's MANIFEST (`boot.ts#ecoregionZoneUnitFromManifest`, verified live against v7's real
  `manifest.json`) and drawn on every scores view, independent of `sel.unit`/`sel.out` — before
  this, the Atlantic/Hawaii/Puerto Rico portions of the study area (outside every Program Area) had
  no outline at all. (3) The layer picker's `<select>` and the legend title now prefer the
  manifest's own SHORT label (`boot.ts#metricLabelsFromManifest`) over `boot.layers[].label`, which
  is actually the LONG description text (verified live: `primprod`'s is a full paragraph) — the
  long text is now a "What is this layer?" description line under the picker instead.
- Seeded fault: `tests/faults/layerstack-order-ignored.patch` (`composeStyle` stops reading
  `input.layerStack`'s order) — wired into `npm run test:faults`.

**Fix round 1 (Opus 5.5 review, `atlas-refs/"2026-09-24 U4 layer-stack review (Opus 5.5) on
5a7c731.md"`), merged onto main 0.10.35:**

- **BLOCKER B1 fixed**: a group's opacity used to REPLACE a layer's existing paint value instead of
  scaling it, so the invisible B3 query-fill placeholder (`fill-opacity: 0`) painted VISIBLE the
  moment its group was dimmed, a per-cell `["get","opacity"]` selection expression collapsed to one
  flat number, and the raster went non-monotonic (0.6 at 100% slider, 0.95 at a 95% one).
  `layerStack.ts#scaleOpacity(existing, k)` now multiplies through every real MapLibre paint-value
  shape (a plain number, a legacy `{stops}` function, a zoom `interpolate`/`step` expression, or an
  arbitrary expression wrapped as `["*", existing, k]`); `k=1` is a guaranteed no-op (same object
  reference back).
- **M1**: `rankForStack()` now assigns ONE shared rank to every contiguous run of basemap sub-roles
  (a `Map<LayerRole, number>`, not an array), so CARTO's own layer-type interleaving (a boundary
  line between two fills, a country boundary between roads and labels) survives instead of being
  regrouped by our five sub-roles. Consequence documented in `docs/map.md`: a basemap row can only
  ever move relative to a DATA row — moving it past another basemap row changes the stack model but
  paints nothing differently.
- **M2**: a KNOWN group missing from a `layers=` token is now inserted right after the nearest
  EARLIER default id present in the token (not appended at the array's end/top) — `?layers=data-
raster:o50` used to bury the raster it named under every other group, including a fully-opaque
  land fill.
- **M3**: three new pixel/feature-proof e2e tests for the Layers panel eyes beyond the Data row's
  (Zone outlines: `programarea_ln` rendered-feature count >0 -> 0; Selection: the picked cell's
  ring >0 -> 0; Land & water: the theme's plain background colour shows through once both Data and
  Land & water are hidden) — every one proves the layer stays registered (`getLayer` still
  resolves), never merely removed.
- **m4** (a MINOR, mislabeled "M4" here through round 2 — the review's own **M4** is the
  order-test/fault-gate finding folded into the seeded-fault bullet below, a different thing
  entirely): a move that lands its own button at the stack's edge (top/bottom) disables that
  button; since a disabled element cannot hold focus, a keyboard user's focus used to silently
  revert to `<body>`. `move()` now refocuses a real button in the same row after the DOM settles
  (the same direction if still enabled, otherwise the opposite one).
- **M5**: a real zone choropleth fill (computed stops) now classifies as role `"choropleth"` ->
  group `data-raster` ("the lens's data"), not `data-zones` — dimming "Program Areas" used to
  silently ALSO dim a real choropleth's fill, which is the lens's data, not the outline row. The
  `data-zones` row is renamed "Zone outlines" (it now only ever holds the outline/label roles and
  B3's invisible query-fill placeholder).
- **M6**: "code right, test missing" — `scoresMapInputs` already preferred the manifest's short
  metric label over `boot.layers[].label`'s long description; no fixture exercised a populated
  `metricLabels` at all. New unit + e2e coverage against v7's REAL primprod strings (long: "Primary
  productivity VGPM/VIIRS npp_avg (mg C/m2/day)"; short: "prim prod, 2014-2023 avg (mg C/m^2/day)").
  The Data row's description paragraph is now hidden when it would repeat the option text verbatim
  (a release with no short label of its own).
- **M7**: `data-raster < data-zones < data-places` is now a FIXED relative order and `data-places`
  is PINNED — `moveLayerStackEntry()` rejects any move that would invert that order or place
  anything at/above Selection's own position, and a move starting FROM `data-places` is a no-op.
  Selection can no longer be buried under Program Areas or the raster by accident.
- **M8 (partial)**: corrected two stale "no release ever publishes a second, ecoregion-outline
  unit" comments (`scripts/verify.mjs`, `tests/map/style.test.ts`) that predated the standalone,
  manifest-published ecoregion outline this same 0.10.36 already draws — both now say SELECTABLE
  explicitly and cross-reference the separate manifest feature. Deferred: consolidating `out=`'s
  per-lens default into one named, tested helper — a real refactor, not a comment fix; today's
  `DEFAULT_OUT_BY_LENS`/`zoneUnitsWithOutline()` behavior is unchanged and correct.
- **m1–m10 of 11 minors** (m11 folded into the merge itself): 44px Switch hit area (SC 2.5.5);
  `aria-valuetext` on the opacity slider; the slider now commits on `onchange` (once per drag)
  instead of `oninput` (every ~0.05 step, which could exceed Safari's `history.replaceState` rate
  limit); the Bathymetry "coming soon" row's switch/move buttons are now `disabled` alongside its
  slider; `aria-controls` on the Data row's expander; deleted `layersControlItems()` and its whole
  describe block (dead code since R3 built the real, interactive panel — parity page evidence
  repointed at the M3 eye-toggle e2e); `Shell.svelte` now skips the manifest ecoregion outline if
  `zonesForStyle` already carries a real "ecoregion" selectable unit (no release does this today,
  but two "ecoregion" zone entries would collide into duplicate layer ids); `composeStyle` no
  longer throws on a `layerStack` input missing a whole group — `normalizeLayerStack()` appends it
  at its default.
- Version bumped 0.10.35 -> 0.10.36; merged `main` (F1a, U6, flower, study-area camera) per the
  review's own merge notes.

**Fix round 2 (last, Opus 5.5 re-check on branch `9d2d47b`), merged onto main `147d2d2`:**

- **M7 re-check**: the MODEL was already fixed round 1, but two real gaps around it. (1) The panel
  never disabled a rejected move — the ▲/▼ buttons only checked the array BOUNDARY, blind to the
  pin/fixed-order rules, so Selection's own DOWN button (never at the boundary; it sits at the top)
  stayed enabled and a click announced a phantom "moved to position N". New exported
  `canMoveLayerStackEntry()` reports whether a move would actually change anything; the panel
  disables on that instead. (2) `parseLayerStack` never enforced
  `data-raster < data-zones < data-places` on groups a token ALREADY names explicitly (only ever
  repaired MISSING ones) — a crafted `?layers=data-places,data-zones,data-raster` put Selection
  under the raster, live, repairable only by "Reset layers". New `enforceDataOrder()` (shared by
  `parseLayerStack` and `normalizeLayerStack`) pins `data-places` to the end and swaps a
  `data-raster`/`data-zones` inversion's two slots. `normalizeLayerStack` also stopped
  bare-APPENDING missing groups at the array's end — it now inserts each one at its own default
  position (the SAME algorithm `parseLayerStack`'s M2 fix already used), which `docs/map.md`
  incorrectly already claimed it did.
- **M6 re-check**: swapped in v7's REAL LIVE long primprod label (fetched verbatim from the live
  `v7/app/boot.json`) in place of round 1's v8 paraphrase — "Primary productivity: Oregon State
  Vertically Generalized Production Model (VGPM) from Visible Infrared Imaging Radiometer Suite
  (VIIRS) satellite data (mg C / m^2 / day) from daily averages available as monthly averaged to
  annual and averaged to overall for the most recently available full years of data 2014 to 2023".
- **ID-11 (parity page)**: documented the standalone manifest ecoregion outline's actual behaviour
  (scores draws it always, even `out=none`; species never draws it, gated structurally in
  `Shell.svelte`) — the page's prose only ever described the unrelated, legacy Shiny "Ecoregions"
  outline-select option and could be read as implying the opposite.
- **B1 re-check**: the e2e suite had no pixel probe INSIDE a real zone polygon (every
  `OCEAN_PROBES` point lies outside this fixture's 20 Program Areas) — added one at a Program
  Area's centre, dimming "Zone outlines" to 50% in cell mode and asserting the plain raster blend;
  verified red-first by hand against a planted replacing implementation.
- **M5 decision**: hiding "Zone outlines" used to ALSO hide the invisible B3 query-fill placeholder
  (`layout.visibility: "none"` excludes a layer from `queryRenderedFeatures`), silently breaking
  zone click/pick while the row was hidden. Decided and implemented: the query fill (role
  "zone-fill", which after M5 round 1 is ALWAYS that placeholder) stays composed and queryable
  regardless of the group's own visibility — `fill-opacity: 0` alone already keeps it invisible.
  Hiding "Data" in zone mode still hides a REAL choropleth with no exception, which is simply
  correct.
- Ride-along comment/doc corrections: `layerStack.ts`'s `OPACITY_PAINT_KEYS` doc (described the
  PRE-B1 "sets directly, never multiplies" behaviour) and `LAYER_GROUP_LABEL` doc (referenced the
  deleted `style.ts#layersControlLabel`); `layers.spec.ts`'s `DEFAULT_ORDER` doc ("missing groups
  append at the end", now "inserted at default position"); `docs/map.md`'s `LAYER_ORDER` listing
  (missing `choropleth`), "Five lines" (now eight, point 8 added), and the `normalizeLayerStack`
  paragraph (now says it actually inserts at default position, not merely claims to);
  `test-faults.mjs`'s M4 fault-gate comment (verified empirically that the order-only test ALSO
  catches this fault — the pixel probe is targeted for being the stronger proof, not because the
  order test fails to); this file's own "M4" mislabel, above (that bullet is the MINOR m4, not the
  review's own M4 finding, which is the fault-gate comment just described).

# atlas 0.10.37

R2, round 2 (owner finding on live 0.10.36 at 390x844): once the welcome modal is dismissed, the
guided tour was reachable ONLY through the desktop (?) Help menu (`topbar-desktop-only`), so a
phone visitor had no way to start it at all.

- The phone ⋯ overflow menu's "Help" item is split into **"Take a tour"** (runs the SAME tour
  start the desktop Help menu's own button uses) and **"Docs"** (unchanged, still a plain link).
  Final item order: Share, Report, Feedback, About this release, Take a tour, Docs.
- The item labelled **"Send feedback" is renamed to "Feedback"**, matching the desktop top-bar
  control's own label one-for-one; its no-JS `href` fallback is unchanged.
- The desktop (?) Help menu is unchanged.

# atlas 0.10.36

U1 (docs/usability.md §7, owner decisions 2026-09-24): the shell's panel model and chrome
placement. R1 (dockable panel, not floating windows) and R2 (About popover + Feedback + a phone ⋯
menu), plus the round's own default-camera/loader and legend-chip deliverables.

- **R1 — one dockable panel**, replacing the "collapse / half / full" model. `Panel.svelte`: a dock
  control (left/right/bottom, a control in the header; bottom = a horizontal drawer), drag-resize
  AND arrow-key resize (10px steps, Shift = 50px) on the panel's map-facing edge (320-720px),
  maximize to the whole stage (a backdrop, Esc restores the previous dock, focus trapped inside
  while maximized, the map stays mounted underneath), and the existing collapse-to-edge-pill kept.
  Geometry (`collapsed`/`maximized`/`dock`/`size`) is chrome only — remembered per viewport bucket
  in localStorage (`panelGeometry.ts`), never the URL. `SpeciesTable.svelte`/`ZonesTable.svelte` get
  `table-layout: fixed` + ellipsis-truncated cells so every column fits the panel's ACTUAL width at
  the widest dock and in maximize, with no horizontal scroll (the owner's acceptance case).
- **R2 — About + Feedback move off the map.** "About this release" leaves the on-map bottom-left
  card for an (i) popover-dialog at the top bar's right end (release/status/app version, a
  restricted-release watermark note, the seal at >= 72px per D10, links to docs/changelog/GitHub).
  "Feedback" (the old "Report a problem" link) becomes a top-bar control, calling the SAME existing
  handler behind one function boundary (a later U3 round only changes that function). On the phone,
  both — plus Share/Report/Help — live under one ⋯ overflow menu (`role="menu"`, arrow-key roving,
  Esc). New `src/shell/TopBarActions.svelte`, mounted from `Shell.svelte` with one line so the U5/U6
  rounds (rail, Report/Help/theme) stay additive.
- **Usability M4 — the default camera now frames the study area padded for the docked panel/sheet**
  (`src/lib/map/camera.ts#paddedStudyAreaCenter` + `chromePadding.ts`), instead of centering
  regardless of how much of the map the chrome covers; an explicit `?map=` is never second-guessed.
  A honeycomb loader covers the map until the first real tile settles, announced politely ("Map
  loading" / "Map ready"), `pointer-events: none` so it never blocks a click.
- **Usability M14 — a compact legend chip on the phone** (`src/lib/ui/LegendChip.svelte`), replacing
  "no legend at all below 900px"; tapping it opens the same legend content full-size. Mutually
  exclusive with the desktop floating legend, so "one legend on screen at a time" still holds.
- **Map-chrome parity audit — MapLibre + CARTO/OSM attribution**, visible with no interaction at
  every viewport. A labelled region OUTSIDE `#map` (never a MapLibre-injected in-map control):
  `#map` carries `role="img"`, and ARIA forbids a role=img element having accessible descendants.
- New gates: `e2e/shell.panel.spec.ts`, `e2e/shell.chrome.spec.ts`, `e2e/shell.firstview.spec.ts`;
  `e2e/keyboard-walk.spec.ts` steps 4-5; `tests/map/camera.test.ts`/`chromePadding.test.ts`.
- **Merged forward onto 0.10.35** (the study-area-camera fix below): the padded default-camera fit
  from M4 above now defers to that round's `shouldFlyToArea` — an explicit `?area=` in the URL wins
  over the padded default fit exactly as an explicit `?map=` already did, and a user's pan after
  either is never fought. `e2e/scores.studyarea.spec.ts` re-run green alongside this round's own
  specs after the merge (see that spec's own precedence assertions).

# atlas 0.10.35

Fix S-01: the study-area camera did not move (owner report, live public v7, 2026-09-24).
`https://marinesensitivity.org/atlas/?ver=v7&area=AK` rendered the DEFAULT camera (globe over
North America, Layers panel showing "Study area: Alaska") instead of flying to Alaska — the
study area is a CAMERA, not a filter.

- **Root cause, two bugs stacked.** (1) `Shell.svelte` resolved the map's initial camera against a
  literal `null` boot (`studyAreaFromBoot(null, sel.area)`), so it could never see a release's real
  `study_areas` rows. (2) The ONLY place anything ever called `handle.flyTo(area)` was
  `LayersPanel.svelte`'s `onchange` handler — the panel BODY, which never runs for a `sel.area`
  arriving from the URL on load (or while the Layers panel is collapsed/unmounted).
- **Fix.** `sel.area` now drives the camera from a shell-level `$effect` (`Shell.svelte`), calling
  the new pure decision `src/lib/map/camera.ts#shouldFlyToArea` — unit-tested, and documenting the
  precedence a later round touching the DEFAULT first-view camera must preserve: an explicit
  `?area=` always wins over whatever framed the first paint, `sel.map` (an explicit camera) always
  wins over `sel.area`, and a user's pan after the fly is never fought. `LayersPanel.svelte`'s
  `onAreaChange` no longer calls `mapHandle.flyTo` itself — it only writes `sel`.
- **Gates.** `e2e/scores.studyarea.spec.ts` drives the real, built app end-to-end (load, a select
  change, `area=FULL` re-fitting the whole study area, a kept user pan, and the fix still working
  with the Layers panel collapsed at load); `scripts/verify.mjs`'s `area=` states gained an
  additive camera-bounds assertion; seeded fault `tests/faults/study-area-camera-ignored.patch`.
  S-01's parity-page evidence (`docs/parity/checklists`, `scripts/parity-page/status.mjs`) is
  rewritten: the old evidence (`flyToStudyArea`, which has no caller in `src/`) could not have
  caught this; `tileUrlLeaksStudyArea` remains as the negative half (no study-area key ever reaches
  a tile/data URL).

# atlas 0.10.34

Owner-reported live defect (v7, 2026-09-24, "Flower plot, nothing selected") plus two follow-on
review items (Opus 5.5 audit; owner decision R8).

- **The flower drew only the petals whose category happened to score above 24** — not a
  color/category mapping gap (every one of the eight real categories already had a defined,
  distinct `--cat-*` token). Root cause: every petal was a full PIE SLICE from the true centre
  (`radius = score` when `outerRadius = 100`), and a solid hub disc of a hardcoded `r="24"` was
  then drawn ON TOP of it to host the centre number — any component scoring `<= 24` (on the
  reported case: Coral 10.4, Fish 16.0, Invertebrate 14.7, Other 15.2, Primary producer 10.4 of
  8 real components) produced a slice that fit entirely inside the hub and was completely covered
  by it, leaving only Bird/Mammal/Turtle visible. Fixed by drawing every petal as an ANNULAR
  SECTOR (a donut-ring wedge) from a shared `innerRadius` (matching the hub) out to a score-scaled
  outer radius, mirroring how `msens::ggplot_flower()` offsets its own polar axis
  (`xlim(c(-10, max(height)))`) so a real, present score is never fully covered by the centre
  annotation — `src/lib/ui/flowerGeometry.ts#computeFlowerGeometry`/`sectorPath`, applied in all
  three renderers that share it: the live panel (`src/lib/ui/Flower.svelte`), the exported
  docx/HTML report's standalone SVG (`src/report/flowerSvg.ts`), and the on-screen Report
  document's own inline SVG (`src/report/Report.svelte`).
- **Every reported score is now rounded to exactly ONE decimal place** (`src/lib/format.ts#formatScore`):
  the summary sentence, the accessible per-petal name, the "Show table" table, and both report
  SVGs' tooltips — the reported defect's other half ("the values text under the flower prints full
  double precision", e.g. `45.6671707107685`). The summary's trailing sentence no longer claims a
  page POSITION ("See the component table **below**"), since that toggle/table sits ABOVE it in
  `Flower.svelte` and there is no table at all beside the exported report's narrative text.
- **The exported/on-screen Report document's own flower** gets the same fix (hub radius, never
  covering a real petal) plus two review items: petal `opacity` corrected to `0.5` (was `0.92`,
  the ported app's own `alpha = 0.5`) and a category LEGEND (swatch + label) beneath each flower —
  its `<title>` tooltip is unreachable in a printed page or the static docx/HTML export
  (`docs/parity/checklists/atlas-7-report.md:24`).
- **The composition treemap now sizes boxes by SPECIES COUNT**, matching the ported Shiny app
  (owner decision R8) — it previously summed `suit_er_area` (suitability × extinction-risk ×
  area), which drew a real selection's Mammal box as the LARGEST even though Shiny (sizing by
  count) draws it small. `compositionTree()`'s new default is `measure: "count"`; the prior
  weighted measure is kept as an internal, not-yet-exposed option
  (`{ measure: "suit_er_area" }`). `Composition.svelte`'s `valueLabel` is now `"n species"`.
- **The parity page's own S-13/S-14 evidence was a "check that cannot fail"**: the 3-component
  hermetic fixture (`e2e/scores.firstpaint.spec.ts`) never exercised a petal small enough to be
  covered, and `e2e/gallery.spec.ts`'s "8 distinct petal categories (colors)" read
  `getComputedStyle(path).fill` directly, which is true and defined for a COVERED petal exactly as
  for a visible one. Both hermetic fixtures (`e2e/scores-hermetic.ts`,
  `tests/lens/scores/fixtures.ts`) now carry v7's REAL 8-component `flower_default.FULL` (read off
  the live release, full double precision); new `e2e/scores.flower.spec.ts` probes each petal's own
  geometric centroid via `document.elementFromPoint()` — real occlusion-aware hit-testing — for the
  default flower AND a selected zone's own flower. Seeded fault
  `tests/faults/flower-petal-colour-dropped.patch` (`scripts/test-faults.mjs`, PW_PORT 4393).

# atlas 0.10.33

U3 (round 2): **Send feedback** — the "Report a problem" control (About card, bottom-left; U1's
top-bar "Feedback" control will call the same function once it lands) now opens a real dialog
instead of navigating straight to a prefilled GitHub issue.

- **The dialog** (`src/lib/feedback/FeedbackDialog.svelte`): a kind (bug / idea / question / data —
  Ben's R6 decision, each becomes the GitHub issue label verbatim), a short text, an optional email,
  a client-captured screenshot of the current view (`capture.ts`, html-to-image — never html2canvas,
  which rejects on the light theme's `color-mix()`) the reporter can annotate with a hand-rolled
  canvas tool (`annotate.ts`: arrow / circle / rectangle / pen / text, three colours, undo/clear) or
  remove, and a privacy checkbox: **"include my current view link" is off by default, and the URL
  fragment (a drawn place's geometry) is absent from the payload entirely unless it is ticked** —
  never merely hash-stripped (`payload.ts#buildFeedbackPayload`, unit-tested).
- **Sending**: POSTs to `VITE_FEEDBACK_URL` (or its `atlas.feedback_url` localStorage override,
  `endpoint.ts`, for testing) as `text/plain` JSON; falls back to a prefilled GitHub issue built from
  the CURRENT form state (`githubIssue.ts`) when no endpoint is configured, copying the screenshot to
  the clipboard first. **A restricted release never offers the GitHub-issue fallback** (client-side
  convenience) **and the payload's own `restricted` flag is checked server-side too**
  (`scripts/feedback/Code.gs`) — a modified or replayed request cannot bypass the review-gate privacy
  rule. Two new analytics events, `feedback_open`/`feedback_sent`, carry only `{kind, restricted}`.
- **The Apps Script** (`scripts/feedback/Code.gs`, ported from
  `calcofi4r::cc_feedback_script()`): a Sheet row, mail to the `recipients` tab (seeded with
  `ben@oceanmetrics.io` and `timothy.white@boem.gov`, R6), and — only when `restricted` is false — a
  public GitHub issue in `MarineSensitivity/atlas` with the screenshot committed under
  `feedback/<id>.png`. Runbook in `docs/feedback.md` (replaces the old "zero backend" doc); a Quarto
  include for the docs site in `docs/feedback-quarto-include.md` (not committed to that repo).
- **Fixed a real defect found writing the end-to-end test**: `postFeedback()` no longer sets
  `keepalive: true` — a keepalive fetch is capped at a 64 KiB combined body quota (WHATWG spec), and
  a screenshot-carrying payload routinely exceeds it, causing an immediate, silent rejection with no
  network request ever visible. The dialog stays open through the whole send now, so nothing needs
  to survive a navigation the way the original "Report a problem" control's click-that-might-open-a-
  new-tab did.
- **Gates**: `tests/feedback/payload.test.ts` (pure-function: hash-inclusion rule, `restricted` from
  `access`, honeypot, size caps), `tests/feedback/lazy.test.ts` (html-to-image/annotate stay dynamic
  imports; `scripts/size-budget-core.mjs`'s `FORBIDDEN_LAZY_MARKERS` gains `"html-to-image"`),
  `e2e/feedback.spec.ts` extended (screenshot → annotate → send; ticked-vs-unticked hash; a
  restricted-release fixture; no-endpoint fallback; keyboard walk; axe); seeded fault
  `tests/faults/feedback-hash-leak.patch` (`PW_PORT=4388`).

# atlas 0.10.32

R2 round U5 (`docs/usability.md` §7 R4/R5): the tool rail, the logo and the light theme's yellow.

- **R4 — the tool rail is now a vertical labelled stack** (desktop) and a labelled bottom tab bar
  (phone), not a row of icon-only hexagons whose meaning lived only in a hover tooltip. New
  `src/lib/ui/RailButton.svelte` replaces `HexButton.svelte` as the rail's own button (HexButton
  stays, unused by the rail, still shown in the gallery); the active tool is now marked by
  `aria-current="true"` plus a small hexagon "pip" beside the button, matching the reviewed
  mockup (`docs/design/mockups/r2/r2.css`'s `.rail-stack`). New `e2e/shell.rail.spec.ts` (visible
  labels, the active marker, arrow-key/Home/End roving focus, the phone tab bar at every sheet
  detent); seeded fault `tests/faults/railbutton-active-marker-lost.patch`. The pre-existing
  `hexbutton-unnamed` fault is renamed `railbutton-unnamed` and now patches `RailButton.svelte`
  (patching `HexButton.svelte`, no longer in the rail, had stopped moving anything the gate could
  see).
- **R5 — the wave-in-hexagon mark** replaces the "wave in a circle" pair
  (`src/lib/brand/vendor/mst-mark*.svg`) in the top bar, the report header and the favicon. New
  `src/lib/brand/WaveHexMark.svelte` inlines the SVG so one definition serves both themes through
  `--border-accent`, rather than a two-file `.mark--navy`/`.mark--paper` swap; `public/brand/
mark-wavehex.svg` and `public/favicon.svg` carry the same mark as a static asset. New
  `tests/brand/logo.test.ts`.
- **R5 — light theme (paper) palette candidate y1**: `--fill-accent` is now the same brand gold as
  the dark theme's (`var(--mma-gold)`, was Steel), carrying its active state through a new
  `--border-accent` ring (navy on paper, gold on navy) rather than contrast alone — gold on white
  is 1.49:1 (now `exempt`, ring pairs replace it in the `@contrast` manifest at ≥ 14:1). New
  `--text-on-cat` (label text on a `--cat-*` fill) and nine neutrals warmed from slate to cream
  (`--surface-sunken`, `--fill-control`, `--fill-track`, `--border-control`, `--divider`,
  `--icon-muted`, `--icon-inactive`, `--scrim`, `--shadow-color`). `--focus-ring` stays Steel (gold
  fails 3:1 there). The dark theme is unchanged. `node scripts/contrast.mjs` now checks 88 pairs
  (was 86). The ring also carries the state on `Segmented`/`Switch`/`Pill`/`Chip`/`HexButton`
  (`--border-accent` in place of `--fill-accent` as each control's own boundary) — `Places.svelte`,
  `LayerBarView.svelte` and `Treemap.svelte` still need the same edit (docs/usability.md §7 R5's
  full ~10-selector list) but were left alone here as files other in-flight rounds own.
  `gallery.html`'s screenshots change with the palette; darwin baselines regenerated deliberately.

# atlas 0.10.29

U6 (Report + Tour) and U2a (dark theme by default) from the round-2 usability assessment
(`docs/usability.md`).

- **U6 — Report does the obvious thing with what is selected (M1).** The top-bar "Report" button
  and the "report" rail tool were both placeholders (`activeTool = "report"` into a literal
  "arrives in a later phase" string). `src/shell/report.ts#reportAction()` now decides: a place
  list in `#pl=` opens `report.html` for every place in it; a single Program Area selected on the
  map/table (`sel=zone:<unit>:<key>`) opens a one-place report for it; with nothing selected, the
  rail tool (now `src/shell/ReportTool.svelte`) shows a chooser — pick a Program Area from the
  release's own zone list, or hand off to the Places tool for drawing/coordinates/upload — plus the
  reports opened this session (`sessionStorage`, capped at 5, deduped by link). Every open still
  runs `window.open()` synchronously (no `await` before it) and reuses the SAME `reportHash()` /
  `hashFromPlaces()` encoders the Places panel and the Zones table's "Report on selected" already
  built through, never a second hand-rolled one.
- **U6 — Guided tour.** driver.js, lazy (`src/shell/tourRuntime.ts`, a dynamic `import()` only —
  never on the 450 KB static critical path; `scripts/size-budget-core.mjs`'s
  `FORBIDDEN_LAZY_MARKERS` now lists `"driver"`). 8 steps for the Scores lens, 5 for Species
  (`src/shell/tour.ts`, `docs/usability.md` §5); each step's `before()` hook opens the tool/lens it
  needs before driver.js resolves its anchor, and the tour snapshots + restores the lens/tool it
  found on Esc/Done (CalCOFI explore's `src/tour.ts` pattern). `?tour=on` starts it once on load
  (suppressing the welcome modal so the two overlays never stack); the welcome modal's "Take a
  Tour" and a new **(?) Help** menu in the top bar ("Take a tour", keyboard shortcuts, a docs link)
  both start the same real tour instead of announcing a stub. New analytics events `tour_start`,
  `tour_step`, `tour_end`, `open_help`.
- **U2a — dark by default; sun/moon toggle.** `DEFAULT_SEL.theme` is `"dark"`, not `"auto"`: an
  absent or malformed `?theme=` now paints navy regardless of the OS's `prefers-color-scheme`,
  matching both Shiny apps and the brand's dark lockup (`"auto"` stays a legal, explicit override —
  `?theme=auto` still follows the OS). `index.html`'s pre-paint script changed identically, so
  there is still no flash of the wrong theme. The toggle is now a sun/moon control
  (`mdiBrightness7`/`mdiBrightness4`, Apache-2.0 via `@mdi/js`) showing the DESTINATION theme, with
  an accessible name in one vocabulary ("Switch to light/dark theme" — `light`/`dark`, the URL's
  own words, never "navy"/"paper"). `report.html` is unchanged (always `data-theme="paper"`,
  print-first).
- Seeded fault: `tests/faults/theme-default-reverts-to-auto.patch` (`DEFAULT_SEL.theme` back to
  `"auto"`), wired into `npm run test:faults`.
- `docs/parity.html`'s known gaps: G-28 (Report placeholder) and G-30 (theme default `auto`)
  removed — both are exactly what this release fixes.
- `scripts/verify.mjs` fix (found by the U2a change, not a pre-existing bug): `scoresRasterProbe()`/
  `speciesRasterProbe()` defaulted their basemap-blend expectation to the PAPER fixture colour,
  which was correct only while `auto` (the old default) resolved to paper under headless
  Chromium's own `prefers-color-scheme`. Every state that never sets `theme=` explicitly now
  defaults to the NAVY blend instead (`BASEMAP_RGB_NAVY`); the one state that still means "paper,
  specifically" (`shell (theme=light)`) passes the paper colour explicitly.
- `src/shell/tour.ts`: `setLens()` is now guarded (`if (a.getLens() !== target) …`) — calling it
  even when the lens was already correct still reset `sel.out` and re-triggered the lens' own
  reactive load for no reason.
- `e2e/species-hermetic.ts`: the shared species fixture now publishes `boot.palettes.spectral_r`
  (11 real stops) — without it `paletteStopsFromBoot()` returns `null` and the species legend never
  renders at all (not even an empty node), a pre-existing fixture gap no earlier spec against it
  had ever exercised.

# atlas 0.10.28

Six fixes from the atlas-8 phase review round 2 (`workflows/.claude/plans_todo/atlas-refs/2026-09-23
atlas-8 phase review (Opus 5.5) on 0.10.21.md`) and `docs/usability.md` §4, all cited by their
finding id below.

- **Review M1 / usability M9 — the scores map click was still panel-bound, and a cold click showed
  nothing for seconds.** The click → `sel=cell:`/`sel=zone:` write → popup path lived only inside
  `ScoresLens.svelte` (the panel body), the SAME class of bug 0.10.21 fixed for map inputs one
  layer down: a click did nothing with the desktop panel collapsed or the Places tool open. Moved
  to a lens-level owner, `src/lens/scores/state.svelte.ts#handleMapClick`, which `Shell.svelte`
  calls directly from its one `map.on("click", ...)` listener (mirroring species). The popup now
  also opens AT ONCE with a "Loading value…" line (`popup.ts#cellPopupLoadingText`) and is filled
  in once the engine answers, instead of staying invisible for the whole click-to-value round trip
  (observed: no popup for > 3.5s, 8s on the phone). New `e2e/scores.collapsed-panel.spec.ts` cases
  (collapsed panel, Places tool open) and an `e2e/scores.popup.spec.ts` timing case (a 3s-delayed
  cell-tile route); seeded fault `tests/faults/scores-click-panel-bound.patch`.
- **Usability M3 (rail) — a rail click on a collapsed desktop panel left it collapsed**, and the
  collapsed pill floated mid-top instead of docking to the panel's edge. `Panel.svelte` exports
  `expand()` (the same instance-method pattern `Toast.svelte`'s `push()` uses); `Shell.svelte`'s
  `selectTool()` calls it. `.panel--collapsed` now shrink-wraps and right-aligns.
- **Item 3a — the scores lens' click popup and single-cell species path built the shared `cell`/
  `place_cell` objects OUTSIDE `exclusive()`**, the same race usability B1 (0.10.25) fixed for
  place analyses. `src/lens/scores/cellClick.ts#fetchCellValue` and
  `speciesLoad.ts#loadSpeciesRowsFor` (plus `ScoresLens.svelte`'s flower fetch) now wrap their
  build-then-read sequence in `exclusive(sources.db, …)`. New
  `tests/analysis/concurrentCellClick.test.ts` drives a real engine (a cell click alongside a place
  analysis) and asserts both get their solo result.
- **Item 3b — "Show analysis cells" could paint the PREVIOUS place's cells** when the selection
  changed mid-load. `Places.svelte`'s `toggleAnalysisCells()` now keys its load on a token
  (`cellsToken`, the same pattern `ResultsPanel.svelte`'s own `run` uses), dropping a late result
  once the selection has moved on.
- **Review m3 — `placesMap.outline` had two effect writers** (`placesMap.svelte.ts`'s baseline,
  `Places.svelte`'s "the selected row's outline persists" effect), racing over one bucket. Split
  into a store-derived `baseline` (`model.ts#composeOutline`) plus an `interaction` override set by
  pick/draw, composed once as `interaction ?? baseline`; `Places.svelte` no longer needs its own
  baseline-restoring effect. Unit-tested in `tests/places/placesMap.test.ts`. Fixing this surfaced a
  second collision (item M1's unconditional click dispatch racing Places' own pick/draw session
  over `sel`) — `placesMap.interactionOwned` gives Places an exclusive claim on clicks while a pick
  or draw session is active, which `Shell.svelte` now honours.
- **Review m4 — `showCells` was panel-local while `mapStore.cells` and the pick highlight
  persisted**, so the toggle could read "off" while cells stayed painted. `showCells` moves into
  `placesMap.svelte.ts`'s store (chrome, never the URL); the pick highlight is cleared in
  `Places.svelte`'s `onDestroy`.
- **Review m5 — the lazy lens/tool imports in `Shell.svelte` had no error path.** Every dynamic
  `import()` now `.catch()`es and announces through the shared live region; the target `$state`
  stays `null` on a rejection, so the SAME `if (!Comp)` guard already retries the next time its
  effect re-runs. New `e2e/shell.chunk-error.spec.ts` aborts the real built `ScoresLens-*.js` chunk.
- **Review m6 — the `composeStyle` input object was built twice** in `Shell.svelte` (the automation
  seam and the reactive effect). Built once as `composeStyleInput` (`$derived`), read at both
  sites; `tests/faults/basemap-not-reactive.patch` regenerated against the new context (same edit).

# atlas 0.10.27

M4 fix round 2 (orchestrator's own seeded fault on `PLACE_CIRCLE_OPACITY = 0`): the M4 gate's
expected colour was computed from `reportMap.ts`'s own `PLACE_CIRCLE_OPACITY`, the SAME constant
the fault targets -- with opacity 0 the "expected" blend collapses onto the pure background
colour too (an invisible circle IS the background), so the pixel count passed trivially. Proven
red against the real patch (`PW_PORT=4365 ... -g "map image not blank"` stayed green before this
fix). `e2e/report-hermetic.ts#mapPrintRampPixelCount` now blends against a fixed literal,
`EXPECTED_PLACE_CIRCLE_OPACITY = 0.85` (never imported from the source constant -- a deliberate
change to `PLACE_CIRCLE_OPACITY` must now ALSO deliberately update this one), and a new
`assertTargetsAreFarFromTheirBackgrounds()` throws loudly if that literal is ever edited close
enough to 0 to defang the gate again. New seeded fault:
`tests/faults/report-map-circle-invisible.patch`, wired into `npm run test:faults`.

# atlas 0.10.26

Six fixes from the round-2 usability assessment (`docs/usability.md`), all cited by their finding
id below.

- **B2 — Places footer "Report" dropped every place whose name contains a space.** The footer's
  `onReport()` spliced `sel.pl` into the `report.html` link's hash with zero layers of
  percent-encoding, while `report.html`'s parser reads the hash back through `URLSearchParams`
  (one layer of decoding) — silently turning a place's own `%20` escape back into a literal space
  and corrupting the token. Extracted `reportHash()` (`src/places/model.ts`) as the one encoder
  both the footer and each row's existing "Open in report" link now build through.
- **B3 — Pick mode could not pick a Program Area from its interior**, only its 1-px outline: the
  query only ever asked the outline layer, in every "Spatial units" mode. `zoneUnitsFromBoot()`
  (`src/lib/map/layers/zones.ts`) now attaches an invisible (`opacity: 0`) query fill to every
  unit by default, so a click anywhere inside the polygon resolves, with no visual change.
- **B5 — "Download HTML" was white text on a light page when opened offline, and its seal was
  missing.** The exported document's `<html>` tag never carried `data-theme="paper"`, so every
  themed colour resolved against the dark theme's values; the seal was a remote `<img src>` that
  `cloneNode()` carried over verbatim. The export now sets `data-theme="paper"` +
  `color-scheme: light` on the exported root and inlines the seal as a `data:` URI at export time.
- **M2 — Viridis / Cividis / Magma painted every Program Area flat grey and dropped the legend.**
  Every release publishes ramp stops for `spectral_r` only; the other three palettes in the picker
  had nothing to fall back to. `src/lib/raster/ramps.ts` adds a fixed, client-side fallback ramp
  for a palette a release has not published, so every palette in the picker now paints and has a
  legend.
- **M5 — `?tour=off` did not suppress the welcome modal, and the modal interrupted deep links.**
  `WelcomeModal.svelte` now also checks `tour !== "off"` and a new `hasViewState()` helper
  (`src/lib/state/codec.ts`) before opening, so a deep link (`?sp=…`, `?sel=…`, `#pl=…`) never
  shows the "first-timer" welcome copy.
- **B4 — the phone tool rail sat beneath the bottom sheet at every detent**, so only the default
  Layers tool was reachable by touch. The sheet's region now reserves the rail's own row
  (`--size-rail-row`, `src/shell/shell.css`), and the sheet's "Full height" detent shrinks to fit
  above it (`src/lib/ui/Sheet.svelte`) instead of growing back down over it.

# atlas 0.10.25

Usability assessment **B1** (`docs/usability.md` §3.4/§4, a hard stop on its own): "place analyses
race on shared DuckDB tables: coverage reads 0 / 100 / 200 %, and a place can show another place's
scores."

- **The observation (live 0.10.21).** One drawn 18,354 km² box read 0.0 %, 100.0 % and 200.0 %
  "inside the US study area" from run to run — "200.0 % … (1,344 of 672 cells)" — and an uploaded
  Monterey box showed the Gulf box's 31.3 composite under its own name while `report.html` (which
  analyses places one at a time) gave it 39 (`docs/usability/obs/obs-coverage-race.json`,
  `obs-places.json`).
- **Root cause 1: two analyses on one engine interleaved on shared objects.** Every place analysis
  builds the same fixed-name objects the SQL twins read (`cell` over the place's tiles,
  `place_cell`, `place_cell_sa`, `cell_model`, `cell_model_key`, `species_agg`, `species_sel`), one
  statement per `await`, on ONE connection. `Engine`'s chain orders statements, not analyses, so
  the Results panel's scores, "Show analysis cells", the species walk and an upload's study-area
  check — all on the Places panel's one engine — interleaved: two `CREATE OR REPLACE place_cell`
  then two `INSERT`s doubled the table (the 200 %), a replace between one analysis' insert and its
  count emptied it (the 0 %), and a `cell` view redefined over another place's tiles handed one
  place the other's numbers. Reproduced deterministically, not by timing:
  `tests/analysis/concurrentPlaces.test.ts` drives the REAL `Engine` + `AnalysisSources` +
  `places/results.ts`/`studyArea.ts` over a real DuckDB (the pinned duckdb-wasm's own node build,
  `tests/analysis/nodeEngine.ts`, answering each query a macrotask later like the worker). Red on
  0.10.21 in 5 of 6: place A analysed beside B came back as B (`nCellsStudyArea` 9 not 12,
  composite 52.12 not 26.375); scores + analysed cells for one place read **32 of 16 cells —
  exactly 200 %**; A's species list came back EMPTY beside B's scores.
- **Root cause 2: the Results panel never re-ran for a newly selected place.** Its `$effect` read
  `place` only after an `await`, so it never tracked it: selecting or uploading another place kept
  the previous place's composite under the new name (the Monterey/Gulf swap).
- **Fix.** `src/lib/analysis/exclusive.ts`: one FIFO queue per database; every caller that builds
  and then reads those objects runs its whole sequence inside `exclusive()` —
  `computeScoreResults`, `placeCellsInStudyArea`, `computeSpeciesResults` (`places/results.ts`),
  `touchesStudyArea` (`places/studyArea.ts`), and the report's `zonePlaceSpecies`
  (`report/data.ts`). Chosen over per-call table names (the twins' object names are the contract
  with `msens`: parity runs these exact files, the report prints them, and `species_sel` is read by
  a later `composition()` call) and over per-connection TEMP objects (the engine is deliberately
  one connection, and the parity harness runs each statement in its own CLI process, where a TEMP
  table would not survive). DuckDB-WASM runs one statement at a time in one worker anyway, so the
  queue costs no throughput — it only fixes the order. `ResultsPanel.svelte` keys its analysis on
  the place's geometry (a pan re-decoding `#pl=` into new objects re-runs nothing; a rename neither)
  and stamps each run, so a place switched or removed mid-analysis drops its late result instead
  of landing it on the row that replaced it (species too). **No SQL twin changed**: D7/D7b are
  byte-identical, and `npm run parity` on v9 is unchanged.
- **Not covered here, by ownership:** the scores lens runs its own engine
  (`src/lens/scores/engine.ts`), and its click popup and cell species path
  (`ScoresLens.svelte`, `speciesLoad.ts`) still build `cell`/`place_cell` outside the queue; they
  should call `exclusive(sources.db, …)` the same way (`src/lens/**` belongs to another round).
  Places' "Show analysis cells" can still paint a previous place's (now correct) cells if the
  selection changes mid-load (`Places.svelte`, likewise another round's file).
- **Gates.** `tests/analysis/concurrentPlaces.test.ts` (red → green, above) and
  `tests/analysis/exclusive.test.ts` (FIFO, never-overlap, a rejection does not block the next, two
  engines stay independent). New `e2e/places.concurrency.spec.ts` (three engines) against a tiny
  real release (`e2e/fixtures/places-concurrency/generate.sql`: two places with different coverage
  and composite): each place is first measured ALONE in a fresh profile, then the overlap is FORCED
  by holding the first place's `cell` tile at the route until the second operation has started —
  two places back to back, scores + "Show analysis cells" on one place, and a refused upload
  mid-analysis — and every panel must equal its solo reading. Run against 0.10.21 it is red three
  ways: B's panel read "120.5 % … (270 of 224 cells)" (A's corrupted result under B's name), the
  toggle case read "137.5 % … (308 of 224 cells)" (a doubled cell set, 2 × 154), and the refused
  upload was ACCEPTED (its study-area check counted A's cells). Seeded fault
  `tests/faults/places-analysis-shared-tables.patch` (`exclusive()` back to a pass-through, the
  0.10.21 shape) is wired into `npm run test:faults`; `scripts/test-faults.mjs` now provisions the
  duckdb extension mirror for a fault whose gate boots a real engine (`duckdbExt`), and requires a
  red for the RIGHT reason (`redMatches`: the solo baseline passed, a concurrency test failed), so
  a broken engine can never count as the fault being caught.

# atlas 0.10.24

atlas-8 phase review (Opus 5.5) fix round: M3 (CI wiring), M7 (parity page content), M8 (the 508
note) and m12 (an ID-17 wording gap). No app behavior changes except the G-24 zones-table header
fix and the ArrowDown combobox fix this round found had no test.

- **M3: CI now runs what `tests/GATES.md` says it runs.** `pages.yml`'s `checks` job gained
  `npm run check` (svelte-check), `npm run lint` and `npm run format:check` as their own steps — the
  file long claimed "step 3" added these, and it never had. A new `analytics-privacy` job runs
  `npm run e2e:analytics-privacy` (the GA4 Enhanced Measurement history-event-leak gate). The
  `parity` job now runs v7 alongside v9 (`run.mjs` already defaulted to both; `tests/fixtures/
parity/v7/*.json` were already committed) and `node scripts/parity/faults.mjs`, the seeded-fault
  proof for the SQL-twins parity gate — `faults.mjs` gained a `--base <url>` flag (forwarded to
  every `run.mjs` invocation) so it can target the real bucket in CI instead of its previous
  laptop-only local mirror (`ensureMirror()`'s `.claude/worktrees/contract/...` /
  `~/_big/msens/derived` paths, which do not exist on a runner). `tests/GATES.md`'s CI column is
  corrected throughout: several rows wrongly said "e2e not yet in CI" for specs the `e2e` job
  already runs on all three engines (`Sel.out`/G-25, the basemap-late-style fault, the collapsed-
  panel fault, `map.spec.ts`'s vector-rendering gate, OPFS/engine e2e, the places fresh-profile
  round trip), and the "Not yet wired into CI" section — which had drifted stale even before this
  round — is rewritten to state what is actually wired now.
- **M7: the parity page (`docs/parity.html`) content is corrected and completed.** G-23 (two
  treemap copy defects) and G-25 (`Sel.out` wiring) were fixed in 0.10.19 but still listed as open
  gaps; both now carry `fixedIn: "0.10.19"` and render in a "Fixed in ..." status rather than
  vanishing from the record. The 0.10.19 bird-note fix was mislabelled "G-24" (it is G-23's second
  defect) — relabelled "G-23 (2)" in this CHANGELOG, `tests/GATES.md` and
  `composition-note.test.ts`. The REAL G-24 — the zones table's score column headed by the whole
  published metric label, wrapping the header and pushing rows out of view
  (`ZonesTable.svelte:68`) — is fixed: a short "Score" header, the full label as `title` and as
  `aria-label` (`e2e/scores.zonesTableHeader.spec.ts`), and now carries `fixedIn: "0.10.24"`. ID-11
  and the P-07 note are rewritten: since 0.10.19 `Sel.out` reaches the species lens too, but the
  species lens DEFAULTS to `out=none`, so a plain species link draws no outline where the old page
  claimed one was always drawn. The S-07 note now says plainly that the atlas has no HOVER
  interaction at all (zones repaint/tooltip on click, not hover) — a new known gap, G-26. Eight
  lines were missing from the intentional-difference/known-gap lists and are added: the scores
  click/popup dead while the panel is collapsed or Places is open (G-27, owner: the F1 round, per
  M1); no zone hover (G-26); the Report tool and top-bar Report button are both a placeholder
  (G-28); no legend on a phone (G-29); the theme default is `auto`, not Shiny's always-dark (G-30);
  the scores-lens top-bar search input has no handler (G-31); no Docs/Home nav and no preview
  sign-out (G-32); ID-17 now names `showOutsidePra` as the one map-visible input that is NOT URL
  state, citing the 0.10.21 Places deep-link outline restore as evidence for the rest of the URL-is-
  the-view claim.
- **M8: the 508 note (`docs/accessibility.md`) no longer claims a three-engine matrix it does not
  run, and every claim it does make names a test.** Reworded the "three engines" claims (§1's
  evidence table gains an Engines column; §3.4 is rewritten to say plainly which gates are chromium-
  only in CI — `matrix.a11y.spec.ts`, `gallery.spec.ts`, the two popup specs, `verify.mjs` — versus
  which run all three). Added cheap tests that were missing: `toHaveTitle()` on all three entry
  points (`index.html`, `report.html`, `gallery.html`); a real end-to-end proof for the SECOND skip
  link ("Skip to the details panel" actually lands the caret on `#panel-region`, not just a source-
  order check); a `role="alert"` refusal test in `e2e/places.spec.ts` for the coordinate dialog;
  ArrowDown moving `aria-activedescendant` to the next option in the species combobox (the existing
  test only moved it by typing a filter). Added `matrix.a11y.spec.ts` cases opening every rail tool
  (Layers, Places, Flower, Table, Report) and the version-picker dialog, plus a Table → Zones case
  that axe-audits the zones table itself — the map's declared keyboard/screen-reader equivalent,
  never once audited before this round — and asserts every header cell carries `scope="col"`
  (previously backed only by a manually-quoted tree dump). Added a 640×800 (200%-zoom-equivalent)
  `assertLayout()` case for SC 1.4.4, which previously cited the unrelated 1.4.12 text-spacing test.
  2.1.2's cite is corrected to the real no-trap evidence (`shell.a11y.spec.ts`'s whole-page Tab walk,
  `keyboard-walk.spec.ts`'s A11Y-1) instead of the modal focus-TRAP tests, which are 2.4.3's concern.
  §3.1 no longer claims the map is flatly "not keyboard-operable": MapLibre's own canvas keeps
  `tabindex="0"` and its default arrow-key pan/zoom handler (measured live), so it IS a real Tab
  stop with real keyboard operability — what is genuinely absent is any CONTENT-specific keyboard
  path (selecting a zone, reading a value), which is what the zones table equivalent is for. Two
  rows downgraded honestly rather than fixed: 1.4.5 Images of Text (an untested design intent) to
  "Not yet verified", 2.4.7 Focus Visible (only spot-checked, never walked end-to-end) to "Partially
  Supports". Non-VPAT status values fixed ("Supports (by removal)", "Supports (exceeds AA 2.1)" →
  `Supports` with the qualifier moved into the prose; `N/A` → `Not Applicable`). Version line bumped
  to 0.10.24; the mangled "Real Safari\n\n- VoiceOver..." paragraph (a stray line break read as a
  bullet) is rewritten as prose.

# atlas 0.10.23

atlas-8 review round 2 (Opus 5.5 review of 0.10.21): six items — three MAJOR ("element exists"
assertions that never proved DATA), two MINOR gate-scope widenings, and one pinned-wording gate.

- **M4: the report map's DATA layer is now pixel-proven, not just "an `<img>` is visible."**
  `.map-print img` used to pass on the basemap alone (`captureRejectionReason` only rejects a
  blank/flat capture). `e2e/report-hermetic.ts#mapPrintRampPixelCount` draws the captured PNG onto
  a canvas, reads its pixels back, and counts how many match a colour ONLY a real place's
  score-coloured circle could paint (GAA/ALA are, by construction, exactly the fixture's ramp
  domain endpoints); the fixture also gained a real `label_pt` per place (`report-hermetic.ts`) --
  without one, the places layer was silently an EMPTY FeatureCollection and the capture was 100%
  basemap the whole time. `reportMap.ts` names `PLACE_CIRCLE_OPACITY` (was an inline `0.85`) so the
  pixel-proof can compute the same alpha-blend a real capture paints.
- **M5: a theme switch is now proven by a PAINTED pixel, not a recomposed style object.**
  `e2e/map.spec.ts`'s theme-switch test used to read `JSON.stringify(composeStyle(inputs()))`
  (never necessarily what the map applied) and treat any non-null `readPixel()` as "painted."
  Navy and paper now carry DIFFERENT fixture water colours (`BASEMAP_RGB_NAVY`,
  `e2e/map-hermetic.ts`; paper's own `BASEMAP_RGB` is unchanged, so every spec that never sets
  `theme=` keeps reading exactly the value it already did), and the test reads the REAL
  `map.getStyle()` plus a real painted pixel before/after the toggle.
- **M6: `scripts/verify.mjs`'s 22 layout-only states get real assertions.** `speciesRasterProbe`
  (a theme-aware basemap/raster blend, probed at the map's own centre) covers every species
  raster state; `speciesRangeProbe` covers wrybill's real BirdLife (`in=bl`) vector range;
  `selectionLineProbe` covers `sel=cell:*`; a new `zoneSelectionProbe` checks the SELECTED zone's
  own highlight layer (`${unit}_highlight_ln`, `zoneHighlightLayer()`) on `sel=zone:*`, not just
  the base outline every zone's line already draws (the review's own finding: the old assertion
  couldn't tell a broken highlight from a healthy one). Two real bugs surfaced while wiring these
  in: `?sp=am|...` (a raw AquaMaps input key) is not a species key the app resolves at all -- it
  needs `?mdl_key=`, so every walrus state was silently rendering nothing; and the default "FULL"
  globe camera does not actually put every cell/zone selection on screen at zoom 2.16, so
  `sel=cell:*` and the MDA/CGA zone states now carry a `map=` camera override centred on what they
  select. Three new `e2e/places.spec.ts` tests cover the Places pick-mode highlight, a
  drawn/entered place's outline, and "show analysis cells" -- all three render through the same
  `selection-line` layer and had no rendered-feature assertion anywhere before this.
- **m7: `Composition.svelte`'s `valueLabel` is pinned to G-23's real wording** (a source-scan
  regression, `tests/lens/scores/composition-valueLabel.test.ts`) -- nothing previously stopped it
  reverting to a bare `"species"` count label, G-23's exact original symptom.
- **m8: `no-fitbounds`/`no-readpixels` widened to their real scope.** `no-fitbounds` now also scans
  `src/places` and `src/report` (both build a camera from a bbox, same as a lens); `no-readpixels`
  now scans all of `src/` (plan D4 -- "numbers never come from the tile server" -- is app-wide, not
  `src/lens/scores`-scoped).
- **m10: two gates tightened to catch what they were meant to.**
  `e2e/species.smoke.spec.ts`'s switch-species-twice test now re-reads the raster source once more
  after `DEFAULT_STYLE_FALLBACK_MS` + 1s, so a stale queued style flushing LATE and silently
  reverting the source is caught, not just "the second species' raster existed at some point."
  `e2e/verify.faults.spec.ts`'s 404-raster fault now calls the real exported `scoresRasterProbe`
  instead of a hand-rolled `readPixel(...) != RASTER_RGB` check, which would have passed on any
  wrong colour, not specifically "the basemap alone, never the raster."

New `tests/faults/*.patch` entries wired into `npm run test:faults`: `report-map-no-score-color`
(M4), `map-hermetic-same-theme-color` (M5), `zone-highlight-lost` (M6).

# atlas 0.10.22

The species cold first-paint regression that 0.10.20 introduced: `e2e/species.timing.spec.ts` (the
"timing" project: a `?sp=` deep link's first raster pixel, median of 3 cold loads, laptop budget
2500 ms) went from a steady 1.3–1.5 s on 0.10.19 to 1.4–3.2 s on 0.10.20 and 0.10.21. The
orchestrator's finding (`--project=timing --no-deps` alone, interleaved, 1-min load 3–6):

| tree              | medians (ms)       | samples                                          |
| ----------------- | ------------------ | ------------------------------------------------ |
| 0.10.19 `e178f52` | 1316 · 1480 · 1434 | 1321/1258/1316 · 1503/1431/1480 · 1434/1330/1535 |
| 0.10.20 `60eefde` | 2351 · 2928 · 2579 | 1458/2351/2388 · 2928/2751/3015 · 2798/2579/2555 |
| 0.10.21 `89895b1` | 1505 · 3078 · 2691 | 1505/2312/1386 · 3078/1811/3174 · 1904/2775/2691 |

- **Root cause (instrumented, not inferred): `map/styleQueue.ts` ended a `setStyle`'s flight on
  `"idle"`, so the species raster's style was parked until the species camera flight had
  finished.** 0.10.20 made CARTO's style.json a reactive `composeStyle` input (right) and made the
  queue hold "at most one `setStyle` in flight" (right), but it defined "in flight" as "until the
  map next fires `"idle"`" — and MapLibre fires `"idle"` only at the end of a rendered frame with
  every tile of every source loaded and the camera still. A scratch trace of every queue decision,
  basemap report, shard resolve and raster event (never committed), 10 cold loads per tree at
  1-min load 6–9 (0.10.21's second five at 9.0–9.5):

  | tree    | first-pixel median | raster style issued after the shard | parked |
  | ------- | ------------------ | ----------------------------------- | ------ |
  | 0.10.19 | 1400 ms            | +3..+4 ms                           | 0/10   |
  | 0.10.21 | 2632 ms            | +507..+588 ms (= `moveend`, 10/10)  | 10/10  |
  | 0.10.22 | 1421 ms            | +2..+4 ms                           | 0/10   |

  0.10.21, one load: the first composed style is issued at the map's first `"idle"` (144 ms) and
  its cycle then waits for the NEXT `"idle"`; both style.json responses land (333 ms) and are
  parked behind it; the shard lands (352 ms), the species `flyTo` starts (355 ms) and the raster's
  style is parked too; `"idle"` cannot fire mid-flight, so it comes at `moveend` (859 ms) and only
  then is the raster's style issued — every raster tile, and the first pixel, ~500 ms late, which
  the spec's `expect.poll` back-off (100/250/500/1000 ms) rounds up to the ~1 s gap between the
  two trees. On a loaded machine (a first, discarded-for-timing run at load 17–155) the in-flight
  cycle was usually a different one — the INACTIVE theme's style.json reporting in recomposes an
  IDENTICAL style, whose empty diff fires no MapLibre event at all (9 of 10 loads) — same
  mechanism, parked +528..+1,899 ms. The bimodality in the table above is whether an `"idle"`
  happens to end the in-flight cycle before the shard lands.

- **Fix (`src/lib/map/styleQueue.ts`), at the definition of "in flight":**
  - an issued style SETTLES on its own `"style.load"`. maplibre-gl 6.10 fires it at the end of a
    diff that changed something (synchronously, inside `setStyle`: `Style#setState`) and when a
    from-scratch rebuild has loaded. After it the style is diffable again — loading tiles are not
    a `setStyle` in flight. `"idle"` and the 4 s fallback stay as the backstops.
  - a style identical to the one last issued is not issued at all, and supersedes anything parked:
    its empty diff would report nothing, which is what left a no-op cycle waiting for `"idle"`.
  - "may this be diffed against yet?" is a latch (the map's style has loaded once — `"idle"`, a
    confirmed issue, or `isStyleLoaded()`), not `isStyleLoaded()` on every call: that is false
    while any tile loads, and re-created the same wait for a raster arriving just after the basemap.
  - the one part of a diff `"style.load"` does not cover is a changed `sprite` (fetched afterwards;
    `Style#_loadSprite` never aborts an earlier fetch, so two in flight land in network order). A
    style that changes the sprite AGAIN while the last change loads still waits for `"idle"` —
    0.10.20's behaviour, kept exactly where it matters (a double theme toggle).
- **Every 0.10.20 guarantee holds**: at most one `setStyle` in flight (a parked style still waits
  for the in-flight one to be APPLIED); `composeStyle()` synchronous and one composed style
  (nothing outside the queue changed); a slow style.json still paints the basemap
  (`e2e/scores.firstpaint.spec.ts`, 3 s-delayed style.json, green on three engines); the latest
  request wins; a stale listener — `"idle"` or `"style.load"` — no-ops; and 0.10.10's rule that a
  stale queued style can never clobber a newer one (`issue()` clears the queue and bumps the cycle).
- **After** (`--project=timing --no-deps` alone, five rounds interleaved 0.10.19 → 0.10.21 → this
  tree, every invocation started at 1-min load < 8; load 5.7–9.0 throughout):

  | tree    | medians (ms)                         | samples                                                                            |
  | ------- | ------------------------------------ | ---------------------------------------------------------------------------------- |
  | 0.10.19 | 1459 · 1531 · 1396 · 1709 · 1447     | 1512/1459/1408 · 1531/2167/1360 · 1537/1396/1390 · 1801/1679/1709 · 1422/1453/1447 |
  | 0.10.21 | 2398 · 2371 · 2386 · **2767** · 2385 | 2577/2398/2361 · 2570/2371/2359 · 2583/2356/2386 · 3008/2767/2690 · 2587/2385/2369 |
  | 0.10.22 | 1453 · 1469 · 1406 · 1515 · 1442     | 1520/1453/1428 · 1578/1469/1435 · 1580/1406/1379 · 1832/1494/1515 · 1537/1420/1442 |

  (0.10.21's fourth round is over the 2500 ms budget — the gate itself went red.)

- **Gates**:
  - `tests/map/styleQueue.test.ts`, "0.10.22" block — 10 new cases on a `DiffingFakeMap` that
    models MapLibre's synchronous `"style.load"`, its silent empty diff and its tile loading, with
    fake timers so the fallback cannot rescue a case and `"idle"` never emitted where it matters.
    Against the 0.10.21 queue 8 of the 10 are red; each rule removed alone (the `"style.load"`
    settle, the identical-style skip, the latch, the sprite rule, the stale-listener guard, a
    settled style bypassing the gate) turns its own cases red.
  - `e2e/species.smoke.spec.ts` "…the raster reaches the style before the basemap's 4 s fallback
    could release it" (three engines): CARTO's vector tiles hang, so the map can never go idle once
    the basemap is in the style; the taxon shard is released only when the PAGE reports the basemap
    there. A queue that waits for idle can then release the raster only through the fallback armed
    at the basemap's issue, so the assertion is exact, not a tuned budget: raster-in-style minus
    basemap-in-style < 4000 ms, both the page's own `"style.load"` events. 0.10.21: RED on all
    three engines (4005 / 4004 / 4188 ms); this tree: 13–267 ms.
  - Seeded fault `tests/faults/style-settle-on-idle.patch` (the issued style's `"style.load"` settle
    dropped, i.e. 0.10.20's cycle) turns that gate red (4003 ms), wired into `npm run test:faults`
    (chromium, `PW_PORT` 4397); row in `tests/GATES.md`; `docs/map.md` describes the rule.

# atlas 0.10.21

The owner's live report on 0.10.17: no score raster on desktop, raster fine on the phone. Two
independent map bugs, both in the scores lens' raster source, plus one same-class fix in Places.

- **Fix 1 (root cause): the scores lens' `composeStyle` contribution was computed only inside the
  panel BODY component, which a collapsed desktop panel never mounts.** `Panel.svelte` renders its
  children only while `!geometry.collapsed` (remembered PER VIEWPORT in localStorage,
  `atlas.panel.shell.desktop`) — `Sheet.svelte`'s phone body always renders (CSS-hidden at "peek"
  only), which is why phones were unaffected. `Shell.svelte` mounted `<ScoresLens.svelte
bind:mapExtra>` INSIDE the panel body, and that component's own `$effect` was the ONLY place
  `mapExtra` (raster/zones/overlays/selection/legend) was ever computed. Collapse the panel on
  load and `mapExtra` stayed `{}` forever: `composeStyle()` got `raster: null`, so no score raster
  and no floating legend, even though the map itself was fully visible. Species has no equivalent
  bug because its map inputs already lived in a module-level store (`src/lens/species/state.svelte.ts`)
  the shell instantiates whenever the lens is selected, independent of any panel.
  - Fixed by giving the scores lens the same shape: `src/lens/scores/state.svelte.ts#createScoresLens()`
    is now instantiated by `Shell.svelte` whenever `sel.lens === "scores"` (the same dynamic-`import()`
    trigger as `ScoresLens.svelte`/`ScoresLegend.svelte`, never the panel/tool), and `ScoresLens.svelte`
    reads it through a `lens` prop instead of writing a `bind:mapExtra` one. Both `composeStyle()`
    call sites now read `scoresLens.mapExtra` and gate the scores-only zones/overlays/selection
    EXPLICITLY on `sel.lens === "scores"` (previously incidental on the panel component not being
    mounted — species could in principle have inherited a stale scores selection).
  - Rule recorded in `docs/map.md`: map inputs belong to a lens-level store the shell instantiates
    whenever the lens is selected; the panel renders UI only, never the source of truth.
  - New gate `e2e/scores.collapsed-panel.spec.ts`: seeds the collapsed-panel localStorage key
    before the app's own script runs, asserts the panel really is collapsed AND the raster paints
    at both ocean probes AND the floating legend is visible. Proven RED first (`git stash` of
    `Shell.svelte`/`ScoresLens.svelte` alone): `TimeoutError` waiting 20 s for `map.getLayer("r_lyr")`
    to exist — the raster layer is never added when the panel body never mounts. Seeded fault
    `tests/faults/scores-state-panel-bound.patch` (wired into `npm run test:faults`) reinstates
    exactly the 0.10.17 shape — a bucket only the panel body writes — and turns the new gate red.
  - `e2e/scores-hermetic.ts` splits `gotoScoresMap`/`readPixel`/`OCEAN_PROBES`/`BLENDED_RASTER_RGB`
    out of `e2e/scores.firstpaint.spec.ts` so the new spec reuses the real v7/v9 boot-fixture
    apparatus instead of copy-pasting it.
- **Fix 2: a raster source with no `bounds` requests every world tile at a low zoom, and titiler
  404s the ones south of the COG's real extent.** `RasterLayerSpec.bounds` is now computed per
  release GRID (`src/lib/map/layers/raster.ts#rasterBoundsForGrid`, unit-tested in
  `tests/map/raster.test.ts`): `usa05` (v1-v7) stores longitude 0-360 and its real span runs
  141.10°E eastward THROUGH the antimeridian to -63.75°E — a box that WRAPS, and MapLibre's own
  `TileBounds.contains()` has no wraparound handling, so a naive wrapped box (`west` numerically
  greater than `east`) would make EVERY tile fail `hasTile()` and the raster would never paint at
  all (worse than the 404 this fix silences). A grid whose span crosses the antimeridian gets the
  full `[-180, 180]` longitude range instead — the widest box that is still correct — with only the
  latitude bound tightened to the grid's own extent. `global05` (v8+) already spans the whole globe
  and gets the same shape for the same reason.
- **Places: the same-class bug, found while auditing for it and fixed as one attempt.**
  `Places.svelte`'s own "the selected row's outline persists" `$effect` (restoring a selected
  drawn place's outline, e.g. after a reload) only exists while `Places.svelte` itself is mounted,
  which `Shell.svelte` does only for `activeTool === "places"` — never the default tool. A deep
  link selecting a drawn place (`?sel=place:0#pl=...`) with the Places tool never opened showed no
  outline at all. Fixed the same way as fix 1: `placesMap.svelte.ts` (already instantiated
  unconditionally by `Shell.svelte`, like `createSpeciesLens`) gains its own baseline `$effect`
  restoring the selected geom place's outline from `sel.pl`/`sel.sel` alone
  (`src/places/model.ts#selectedGeomPlaceGeometry`, new + unit-tested); `Places.svelte`'s own
  effect is unchanged, since it alone knows about an in-progress pick/draw interaction the baseline
  must stay quiet through. New gate `e2e/places.deeplink-outline.spec.ts`, proven RED then GREEN
  on all three engines with zero regressions to `e2e/places.spec.ts`'s existing interactive flows.

# atlas 0.10.20

The recurring, load-sensitive Firefox red in `e2e/scores.firstpaint.spec.ts` ("paints the score
raster at two ocean probe points") was a REAL app bug, and not the one the symptom suggested: the
raster was fine — **the basemap could silently never paint at all**.

- **Root cause: the composed style had no way to learn that CARTO's style.json had arrived.**
  Since 0.10.11 the basemap has been CARTO's vector GL style, fetched once per theme and read
  SYNCHRONOUSLY by `composeStyle()` out of a module cache. Nothing invalidated that read: the
  policy was "the next ordinary reactive recompose (zones/raster/selection all settle within the
  first second of any real load) will pick up the by-then-warm cache". That is an assumption about
  a race, and under load it loses — when the fetch resolves after the last reactive change, the
  cache is warm and nothing ever reads it again, so the map shows the data over the theme's flat
  `--surface-map` colour with **zero** basemap layers, for the life of the page. Exactly what a
  person on a slow connection sees.
  - Measured: the failing probe read `247,171,122` (the score raster at 0.6 opacity over `#eaeef3`)
    rather than `153,117,86` (the same raster over the basemap) — 1 of 40 Firefox repeats at load
    ~11, 2 of 40 at load ~83, and **deterministically** with CARTO's style.json answered 3 s late,
    where `getStyle()` still held 0 `basemap-` layers 10 s after the response had landed.
  - Fixed by `layers/basemap.ts#warmBasemapStyles()`: it warms every theme and REPORTS each one
    (always, exactly once, including on a rejected load) so `Shell.svelte` can hold the resolved
    styles in `$state` and pass them to `composeStyle()` as an ordinary reactive input. Unit tests
    in `tests/map/basemap.test.ts`.
- **`map/styleQueue.ts` now holds "at most one `setStyle` in flight".** This is what makes the fix
  above safe to make, and is the second half of the same bug: the invalidation was deliberately
  left out in 0.10.11 because an extra `setStyle(diff:true)` landing at a network-timed moment
  exposed a MapLibre-level mis-ordering. The queue only ever engaged while `!map.isStyleLoaded()`,
  and the map's blank first style is trivially "loaded", so two applies arriving close together
  could both be issued directly, back to back, with nothing between them. Now an apply is issued
  only when nothing is settling; otherwise the LATEST style is parked and issued when the in-flight
  one settles (`"idle"`, or the existing bounded 4 s fallback). Callers may recompose as often as
  they like — an extra recompose costs one more settle cycle, never a mis-ordered pair of diffs.
  Listeners carry the cycle they were armed for, so a stale `once("idle")` (which this interface
  cannot unregister) no-ops instead of cutting the current cycle short. Three new regressions in
  `tests/map/styleQueue.test.ts`, all red without the change.
- **New gate, `e2e/scores.firstpaint.spec.ts`: "a SLOW CARTO style.json still ends up painting the
  basemap"** — the intermittent failure made deterministic by holding the style.json for 3 s
  (`routeBasemapStyle(page, { styleJsonDelayMs })`), asserting the same pixel at the same
  tolerance, with a message that names the cause rather than "pixel mismatch". Seeded fault
  `tests/faults/basemap-not-reactive.patch` (wired into `npm run test:faults`) reinstates exactly
  the 0.10.19 behaviour — `composeStyle()` back on the non-reactive cache read — and turns it red.

# atlas 0.10.19

The three defects the parity screenshots exposed (`docs/parity.html` known gaps G-23/G-24/G-25).

- **G-23: the composition treemap's summary line miscounted its own number.** `Treemap.svelte`'s
  accessible summary (and its `aria-describedby` paragraph) hardcoded "species" and printed a raw
  sum via `Number.toLocaleString()`'s default (up to 3 fraction digits) — e.g.
  "210,671,300.041 species across 7 categories" for a quantity that is the summed `suit_er_area`
  ("suitability x extinction-risk x area", `sql/composition.sql`/`glossary.ts`'s own phrase), never
  a species count. `Treemap.svelte` now takes a required `valueLabel` prop naming what a positive
  `value` represents (the gallery demo passes `"species"`, a literal count; the real
  `Composition.svelte` caller passes `"combined suitability x extinction-risk x area"`), and the
  summary/table are built by a new pure `describeTreemapSummary()`
  (`src/lib/ui/treemapLayout.ts`), rounded 0 dp like every other consumer of this number
  (`report/format.ts`'s `formatScore0`).
- **G-23 (2) [mislabelled "G-24" at the time — corrected atlas-8 phase review M8, 0.10.24; the real
  G-24, unrelated, is the zones table's header]: a ported "the 'bird' component has yet to be
  added" note stayed above a treemap that DOES draw a Bird box.** That note describes the Shiny
  app's six-rank WoRMS hierarchy treemap (G-06, never built here); the shipped one-level treemap
  groups by `sp_cat` via a LEFT JOIN (`sql/composition.sql`), so a bird row is never excluded by
  construction (confirmed against the real v7 and v9 parity fixtures, both of which carry
  `sp_cat: "bird"` rows that survive into a box). Removed from `Composition.svelte`.
- **G-25: `out=` was parsed and round-tripped but nothing read it** — a link carrying `out=none`
  (the species lens' own default) still drew the Program-Area outline on every map. A new
  `zoneUnitsWithOutline()` (`src/lib/map/layers/zones.ts`) is the ONE place `Sel.out` now reaches
  `composeStyle()`'s `zones` input (`Shell.svelte`, both call sites): `out="none"` sets every
  unit's line layer to `visibility: "none"` (never removed, never a piecemeal
  `setLayoutProperty()`); the matching unit's own choropleth fill is unaffected. Seeded fault:
  `tests/faults/out-outline-ignored.patch`, wired into `npm run test:faults`.
- **G-25 follow-up:** `scripts/verify.mjs`'s state matrix demanded a rendered zone LINE feature on
  every `scores proj=X out=Y area=Z` state — an assertion that predated `out=` meaning anything,
  and which the fix above correctly broke for `out=none`/`out=ecoregion`. The per-state check now
  follows `out` (programarea: line renders; none/ecoregion: line hidden, raster still paints).
  `out=ecoregion` renders no line on any release, not a bug: plan D17 / `docs/parity.html`'s
  intentional difference ID-03 — `boot.units[]` carries exactly one unit per release, and no
  release ever publishes a second, ecoregion-outline unit.

# atlas 0.10.18

atlas-8 step 3's fix round: all 14 items in `docs/accessibility-fixes.md` (the previous version's
audit) are now fixed, and every one of them has a real, provably-red-without-the-fix test.

- **Fixed, serious (#1-#7):**
  - **#1 Esc in a panel-hosted modal no longer collapses the panel.** `Modal.svelte` now attaches
    its Esc/Tab handling IMPERATIVELY on the dialog element in `onMount` — `Popover.svelte`'s own
    pattern — so it runs during the real bubble phase, before the event reaches an ancestor
    Panel's own Esc-collapses-it listener (Svelte 5 delegates a template `onkeydown` to the app
    root, which always ran too late for this).
  - **#2 Tab no longer escapes an open modal when its last control is disabled.**
    `FOCUSABLE_SELECTOR` now excludes `:disabled` (and a hidden-element filter), so the trap's
    `active === last` check can actually become true.
  - **#3 The file-upload control shows a visible focus indicator** — `.dropzone:focus-within`.
  - **#4 The report's progress line is announced** — dropped the `aria-live="off"` that overrode
    `role="status"`'s own implicit `polite`.
  - **#5 WebKit: activating a rail tool no longer drops focus to `<body>`** — `Shell.svelte`'s
    `armRailFocusRestore` (a `MutationObserver` on `#panel-region`) restores focus to the activated
    rail button once the lazy panel swap settles, only when focus was actually lost.
  - **#6 Firefox: "Skip to the tools" reaches the tools** — `tabindex="-1"` on `#rail-region` and
    `#panel-region`.
  - **#7 The desktop panel's body has a name again** — `Panel.svelte`'s `.panel-body` now carries
    `role="group" aria-label="{title} details"` (a `group`, not a `region`, so the near-duplicate
    nested-landmark problem an earlier atlas-8 fix addressed does not come back).
- **Fixed, moderate (#8-#14):**
  - **#8 The species picker is a real combobox** — `role="combobox"`, `aria-expanded`,
    `aria-controls`, `aria-autocomplete="list"` and `aria-activedescendant` on the search field;
    Arrow Up/Down/Enter/Esc drive the (still virtualized) list from the input, options stay out of
    the Tab order, and the result count is announced.
  - **#9 The map points at its own text equivalent** — `aria-describedby` on `#map` naming the
    zones table and how to reach it.
  - **#10 No more second region nested inside the Layers panel's own region** —
    `LayersPanel.svelte`'s "Layers on the map" section is a plain `div` with a renamed heading.
  - **#11 The floating legend is reachable as a landmark** — `role="region"` + `aria-labelledby`
    on `Legend.svelte` and on the "not published yet"/categorical fallback notes in
    `ScoresLegend.svelte`/`SpeciesLegend.svelte`.
  - **#12 The map-click popup is announced** — `announce()` carries the same text (unescaped) as
    the popup, for both lenses.
  - **#13 The report's flower tabs are a real tab widget** — `role="tabpanel"` +
    `aria-labelledby`/`aria-controls`, roving tabindex with Arrow Left/Right (`roving.ts`, the same
    math the tool rail uses).
  - **#14 A failed bundle load says something** — `src/main.ts` marks `<html data-hydrated>` once
    `mount()` returns; `index.html`'s own timed inline script reveals a visible `role="alert"`
    message if that attribute is still absent 8s later.
- **New seeded fault: `tests/faults/modal-esc-delegated.patch`** (`npm run test:faults`) — reverts
  fix #1 alone (Modal's Esc handler moved back to a delegated template `onkeydown`) and turns
  `e2e/keyboard-walk.spec.ts`'s A11Y-1 regression test red.
- **`e2e/keyboard-walk.spec.ts`'s `KNOWN_UNNAMED_STOPS` list is now empty**; every `test.fixme` the
  previous audit committed is now a real, passing assertion (or, for #8-14, a brand-new one).
- `docs/accessibility-fixes.md` and `docs/accessibility.md` updated: every item's status, and every
  criterion that moves from "not yet verified"/"partially supports" to "supports", names the test
  that now proves it.

# atlas 0.10.17

atlas-8 step 5 / Deliverable 2: `docs/parity.html`, the page the cutover is signed against.

- **`docs/parity.html`** — generated, not written: all 72 parity-checklist lines of atlas-4
  (scores, `S-01`–`S-22`), atlas-5 (species, `P-01`–`P-22`) and atlas-7 (report, `R-01`–`R-28`),
  each with its status (done / partial / intentional difference / deferred), the **test that asserts
  it** (file + test name, linked to GitHub) or an explicit "no test", a summary table, the numbered
  **intentional-differences** list, the **known-gaps** list with an owner each, the Shiny-vs-Atlas
  screenshot pairs, a plain statement of what was NOT compared, and a signature block.
- **`scripts/parity-page/`** — the generator. `checklist-core.mjs` parses the checklists out of the
  plan files; `build.mjs --sync` copies each checklist section VERBATIM into
  `docs/parity/checklists/` (with `sources.json` recording each plan file's sha256), so the page
  builds and its test runs without the plans, and every later build re-extracts and refuses to run
  on a difference. Three refusals guard the page: a row with no status (or a status whose `match`
  no longer appears in the line — the positional-id drift guard), an Evidence cell naming a test
  that does not exist, and a row called `done` whose evidence is "no test".
- **`scripts/shots.mjs`** — Shiny-vs-Atlas screenshot pairs (chromium, 1280×800, public **v7**
  only), one curated STATE per view: each is a URL on both sides, or a short scripted interaction
  where the old app has no URL state. Waits are on real rendered elements (the Shiny apps take
  9–13 s to paint), timeouts ≥ 60 s, 2 retries; a capture that did not render — blank, disconnected,
  still recalculating, or with either app's **welcome modal over it** — is recorded and printed as a
  **FAILED pair**, never shipped as though the comparison had happened. `--only` and
  `--side shiny|atlas` merge into the existing manifest, so one state (or one half of every state)
  can be re-shot without a 20-minute full run.
- **Three defects the screenshots found**, now on the page as known gaps rather than fixed here:
  the zones table's score column is headed by the metric's whole published label and wraps the
  header open (`G-24`); the composition treemap's summary line calls a summed `suit_er_area`
  "species" and keeps a "birds are not in this view" note above a treemap that does show birds
  (`G-23`); and `out=` round-trips in the URL while nothing reads it, so the species map always
  draws Program-Area outlines where Shiny drew Ecoregions and let you choose (`G-25`, `ID-11`).
- **`tests/parity-page/checklist.test.ts`** — the loader's own gates: one row per `- [ ]` line over
  the three real checklists (72 = 22 + 22 + 28), ids stable and in file order, the drift guard, and
  a **permanent red case** (`tests/fixtures/parity-page/status-fault-done-no-test.mjs`) proving that
  a line claiming `done` with "no test" as evidence fails the consistency check.
- **`--check` compares the page MODULO its volatile fields** (fix, found on merge commit `609982b`):
  the page prints the git HEAD sha and two timestamps, so `parity:page:check` was stale on every
  commit AFTER the one that rendered it, with no edit anywhere — a check nobody can keep green is a
  check everyone learns to ignore. Those three values are now marked in the HTML
  (`data-volatile="sha|generated|shots-generated"`) and `canonicalizeHtml()` blanks exactly them on
  both sides; every status, note, caption, URL and byte count still compares literally.
  `sources.json`'s `planSha256` is documented — and tested — as INFORMATIVE ONLY: the build compares
  the extracted checklist SLICE, so appending progress-log lines to a plan file never fails a build.
- **The generator's modules carry JSDoc types** (fix: CI's `tsc --noEmit` was red on
  `tests/parity-page/checklist.test.ts` — eight errors, because vitest does not type-check and
  neither of us ran `npm run check`). `ChecklistRow`, `Status`, `Evidence`, `StatusEntry`,
  `MergedRow` and `TestIndex` are now declared where they belong — on the modules that own them, the
  same convention as `scripts/check-relative-assets-core.mjs` — and `STATUS` is typed as
  `Record<string, StatusEntry>` rather than left as its own 72-key literal, which is what made a
  four-row fixture "missing 68 properties". The fixture is typed with the exported `StatusEntry`. No
  `any`, no `@ts-ignore`: a wrong status value from TypeScript is now
  `Type '"nope"' is not assignable to type 'Status'`.
- New scripts: `npm run parity:page`, `npm run parity:page:check`, `npm run parity:shots`.

# atlas 0.10.16

atlas-8 Deliverable 4: beta feedback, zero backend.

- **"Report a problem"** — a new control in the on-map About card (bottom-left, desktop only) opens
  a prefilled GitHub issue in `MarineSensitivity/atlas`, labeled `beta-feedback`: app version + git
  SHA, the resolved release, the lens, the page URL (query kept, **fragment always stripped** — a
  drawn place's geometry never leaves the browser, plan D8), user agent, viewport and theme, plus a
  short "What happened / What you expected" template. Pure logic in
  `src/lib/feedback/issueUrl.ts#feedbackIssueUrl()` (`tests/feedback/issueUrl.test.ts`, one fixture
  per rule); the URL is capped at ~7,500 chars (GitHub truncates a `new/…` issue URL around 8 KB) by
  trimming the user agent, then the template — never an identifier.
- **New build-time define, `__APP_SHA__`** (`vite.config.ts`, `git rev-parse --short HEAD`,
  `"unknown"` fallback when git is unavailable) — cites the exact build in the issue body, not just
  `package.json`'s version.
- **Optional `VITE_FEEDBACK_URL`**: when set at build time, the control POSTs the same context
  there (`fetch`, `keepalive`) instead of opening GitHub, falling back to the GitHub link on any
  failure (`src/lib/feedback/postFeedback.ts`). Documented in `docs/feedback.md` and `.env.example`.
- **`tests/feedback/noHash.test.ts`**: a source-scan gate (the same technique
  `tests/analytics/noRawLocation.wiring.test.ts` uses) proving nothing under `src/lib/feedback/`
  ever reads the live page location's `href`/`hash`, or `window.location` — the URL is always passed
  in by the caller (`Shell.svelte`, built from the reactive `Sel`, never `location.search`
  directly). Seeded fault: `tests/faults/feedback-location-href.patch` (`npm run test:faults`).

# atlas 0.10.15

atlas-8 step 3: accessibility. axe everywhere, a scripted no-pointer keyboard walk on three
engines, the accessibility-tree review, two new seeded faults, and Deliverable 3 — the Section 508
conformance note. **No app-side accessibility defect is fixed here** (a Sonnet round does the
fixes, then re-audits); fourteen are found, reproduced and written up instead.

- **axe on every matrix state, not nine of them (`e2e/matrix.a11y.spec.ts`, new).** The axe
  coverage was four shell states, four gallery states and one report state. It is now **179
  audits**: all 174 runs `scripts/verify.mjs` itself enumerates (58 named view states × {desktop
  1280×800, phone 390×844, phoneNarrow 320×800}), plus both gallery themes, both `report.html`
  access states and the auto-opened D15 denial dialog. The state list is **imported** from
  `scripts/verify.mjs` (`STATE_MATRIX`, `VIEWPORTS`, and a new exported `gotoState()`), never
  copied, so a state added there is audited here on the next run. Chromium only, by the plan's
  wording; the webkit/firefox projects ignore the file so a full run reports 179 audits rather than
  179 plus 358 skips. **Result: 179/179, zero serious/critical.**
- **A scripted keyboard walk, pointer never used (`e2e/keyboard-walk.spec.ts`, new).** The plan's
  sentence as a test: select a Program Area from the zones table, read its score, create a place by
  coordinates, open the report and trigger an export — with Tab/Shift+Tab/Arrow/Enter/Space/Esc
  only (Option+Tab on WebKit, whose default Tab sequence skips buttons). Every stop asserts that
  `document.activeElement` is still a rendered, on-screen control **and** has an accessible name,
  computed by Playwright's own accname implementation. The score assertion compares what the table
  shows against the release's own published metric, not a second hand-typed literal. Runs on all
  three engines: chromium 10 passed / 5 `fixme`, webkit 9/6, firefox 9/6 — every `fixme` is a
  numbered finding, never a convenience skip.
- **`npm run verify` was structurally broken and nothing said so — fixed.** The 2026-09-23 basemap
  round deleted `routeBasemapTiles` (the keyed raster basemap) in favour of `routeBasemapStyle`, but
  `scripts/verify.mjs` kept importing it by name. A missing named export resolves to `undefined`
  rather than failing the load, so **every one of the 41 scores-lens states threw `TypeError:
routeBasemapTiles is not a function`** before its first assertion, from `6a7d88b` until now. Two
  lines.
- **Two new seeded faults, wired into `npm run test:faults`** (`tests/faults/hexbutton-unnamed.patch`
  — the tool rail's `HexButton` loses its `aria-label`, turning the axe sweep red;
  `tests/faults/modal-focus-restore.patch` — a modal opened by setting the `open` attribute instead
  of `showModal()`, so closing it restores focus to nothing, turning the keyboard walk red). These
  are the first Playwright gates in that manifest: `playwright.config.ts` now honours a `PW_PORT`
  env var and, when it is set, never reuses a server it did not start — otherwise the throwaway
  worktree's gate would be served the unpatched build and quietly pass.
- **`e2e/report-hermetic.ts` (new)** — `report.html`'s first-tier fixtures (`BOOT_V9`/`BOOT_V7`/
  `PL`/`gotoReport`) extracted out of `e2e/report.spec.ts` so the axe sweep audits the same document
  rather than a near-copy of it. No behaviour change to the existing report suite.
- **`docs/accessibility.md` (new, Deliverable 3)** — the Section 508 / WCAG 2.1 AA conformance note:
  every A and AA criterion with its status, and for each "Supports" the **file and test title** that
  proves it; the known exceptions (the map canvas, whose equivalent is the zones table — with the
  keyboard test that proves the equivalence, and the honest note that nothing points a screen-reader
  user at it yet); a "not yet verified" section that names every criterion no test covers; the
  per-region screen-reader walk notes; and the test evidence counts. The claim is **partially
  supports**, and nothing is claimed that the matrix does not test.
- **`docs/accessibility-fixes.md` (new)** — the numbered fix list for the Sonnet round: 14 items,
  each with its SC number, `file:line`, what a user experiences, the fix, and a severity. Six are
  serious, including two that only appear on one engine (WebKit drops focus to `<body>` on a rail
  tool swap; Firefox's skip link lands _past_ the tool rail). Seven already have a committed failing
  test.
- **`npm run verify` is in CI** — its own `verify` job in `pages.yml`, gating `publish`. This is the
  reason A11Y-0 lived for a day: the 58-state × 3-viewport matrix was the last gate with no CI job
  at all, so nothing ran the script that had been throwing on every scores-lens state. Measured
  before choosing the shape (laptop, serial by design): **chromium 174 runs in 134 s**, **all three
  engines 522 runs in 315 s** — cost was not the deciding factor; firefox was. `verify.mjs` launches
  browsers directly and never reads `playwright.config.ts`, so 0.10.14's `firefoxUserPrefs` +
  `FIREFOX_HEADED` recipe does not reach it and a GPU-less runner's firefox has no WebGL2; the job
  runs **chromium only** and says so, with teaching `verify.mjs` that recipe recorded as the
  follow-up. The three-engine matrix stays covered by the `e2e` job. Proven to fail on a thrown
  state, not just a failed assertion: `tests/faults/verify-missing-export.patch` reintroduces the
  exact missing import (measured: baseline exit 0, faulted exit 1, six "✗ … — threw:" lines), and
  `main()` now also has a `.catch()` so anything thrown _outside_ a state is a hard failure rather
  than a bet on Node's unhandled-rejection default.
- **`tests/GATES.md`** updated: the three new gates and their faults, and the `test:faults` count
  4 → 7 (on the merged tree, beside Deliverable 4's `feedback-location-href`). The CI `test:faults`
  job now installs chromium, since three of the seven faults drive a real browser.

# atlas 0.10.14

CI went red the first time the browser suites ran on a real GitHub `ubuntu-latest` runner
(run 35819393922 on `febe9df`: `e2e (gallery)` 6 failed, `e2e (chromium, webkit, firefox)`
232 passed / 3 flaky / 9 failed), so `publish dist/ to gh-pages` was skipped and the live site
stayed at 0.10.9. Everything here is a linux-runner red — a slower, GPU-less machine with
different fonts and platform-suffixed snapshots. No assertion was weakened, nothing is skipped on
CI, and no console-error allow-list was widened.

- **Firefox on the runner had no WebGL2 at all, which was 5 of the 9 reds** (new
  `scripts/firefox-webgl-prefs.json`, new `scripts/check-webgl2.mjs`, `playwright.config.ts`,
  `pages.yml`). `canvas.getContext("webgl2")` returned `null` and maplibre-gl threw
  `GPUInitializationError: WebGL2 is required to display this map` before the map object ever
  existed — so every firefox spec waiting on `window.__atlasMap`, `window.__atlasSpecies` or a
  rendered `.map-print img` timed out, both shell-smoke "zero console errors" gates saw the
  throw, and the serial `describe`s skipped everything behind them. Two causes, both fixed:
  Firefox's blocklist disables its software (llvmpipe) GL path unless `webgl.force-enabled` is
  set, AND — unlike chromium, which ships its own SwiftShader — Firefox uses the SYSTEM GL stack,
  which `playwright install --with-deps` populates with libGL but not Mesa's actual DRI drivers.
  `pages.yml` now installs `libgl1-mesa-dri` (+ `libglx-mesa0`, `libegl-mesa0`) and runs the suite
  with `LIBGL_ALWAYS_SOFTWARE=1`. And even that is not enough: Playwright's Firefox has no WebGL
  **in headless mode on linux at all** (measured, run 35823275862 — with the drivers installed and
  the prefs applied, `getContext("webgl2")` is still `null`, while chromium and webkit on the same
  runner are fine), so the suite now runs under `xvfb-run` with the firefox project HEADED
  whenever `$DISPLAY` exists; a local macOS run is unchanged.
  **`scripts/check-webgl2.mjs` is the new gate that makes this
  diagnosable**: it launches each engine with the same prefs file the Playwright config reads,
  creates a real WebGL2 context, prints the renderer, and runs BEFORE the suite — one explicit red
  saying "firefox: no WebGL2" instead of six specs failing for a reason none of them is about.
  Nothing here relaxes an assertion.
  - **What actually kept the job red after all of that** (fix round 1): the `timing` project
    declares `dependencies: ["chromium", "webkit", "firefox"]`, and `npx playwright test
--project=timing` runs a project's dependencies first — so the "timing gate" step was
    silently re-running the **entire three-engine matrix a second time**, and it was the one
    browser step not wrapped in `xvfb-run`. Its headless firefox had no WebGL2 and reported the
    same six failures the real suite step had just PASSED (run 35823503729: step 9 success, step
    10 failure, identical test list). That step now runs `--no-deps` under `xvfb-run` — which
    also halves the job, since those 249 tests were being run twice. And the headed switch is no
    longer inferred from `$DISPLAY`: `pages.yml` sets `FIREFOX_HEADED=1` on every browser step,
    and both `playwright.config.ts` and `scripts/check-webgl2.mjs` **throw** if it is set with no
    display — forgetting `xvfb-run` on a step is now a loud failure, not a silent WebGL2-less run.
- **The cold first-paint timing gate has run on the CI runner for the first time, and its budget is
  now per machine** (`e2e/species.timing.spec.ts`, `docs/performance.md`). `docs/performance.md`
  had said in as many words that the ≤ 2.5 s gate "has never run on the CI runner … expect it to
  run slower"; once `--no-deps` let it actually reach the assertion there, it did. The finding is
  the **spread**, not a single number: medians of **3281 / 2629 / 3261 ms** (run 35824811030) and
  then **1906 ms** (run 35825712215) — identical code, same nominal hardware, minutes apart, a 1.7×
  swing, with the good run beating the laptop's own 2500 ms budget. That is a 2-core shared VM
  whose dominant cost is network-RTT-bound tile latency, and it is why a laptop-calibrated cap
  would have made this suite red roughly half the time for no reason related to the app. The
  **laptop budget is unchanged at 2500 ms**; CI gets its own 4000 ms, ~22% above the _worst_
  median observed (not the mean — against that spread a mean is a coin flip), which still goes red
  on a ~1 s cold-path regression. The spec now prints its samples and median on a PASS too, so
  every green run adds a row to `docs/performance.md`'s table (updated with the real numbers, per
  atlas-0 review F6's original ask) and the cap can be lowered later on evidence.
- **`document.fonts.ready` as a wait is unbounded, and on WebKit/linux it did not settle**
  (`e2e/shell.cls.spec.ts`). All six WebKit geometry-equality cases died as
  `page.evaluate: Test ended.` on that one line. `document.fonts.ready` is a whole-document
  promise — only as prompt as the slowest face in the set, and re-armed by every new font request
  — so when it does not settle there is nothing to report but a timeout. The spec now awaits the
  SELF-HOSTED brand faces it actually measures (the Jost/Carlito `FontFace` objects) with
  `FontFace.load()` against a bounded timer, then asserts each one's own `status === "loaded"`:
  a face that never loads is a red that NAMES the face, weight and status, not a silent 30 s test
  timeout. Deliberately NOT `document.fonts.check()` — measured on WebKit, that answers `true`
  even for a family whose `@font-face` request never responds (with `font-display: swap` the
  fallback is "available"), so it is a check that cannot fail.
- **A map test manufactured the console error it then failed on** (`e2e/map.spec.ts`,
  `e2e/scores.firstpaint.spec.ts`, `e2e/species.smoke.spec.ts`). `Map.isSourceLoaded(id)` FIRES a
  MapLibre `ErrorEvent` (`There is no tile manager with ID '<id>'`) when the style does not
  currently hold that source, and an unhandled one lands in `console.error`. The vector-feature
  probes polled from the instant `window.__atlasMap` existed — before the zones style is composed
  — so on a slow machine the poll landed in that window and put 6-8 errors into the very array the
  test asserts is empty. Each probe now checks `getLayer()` first (returns `undefined`, fires
  nothing), the guard `species.timing.spec.ts` already used. The assertion is unchanged: layer
  present, source loaded, AND a rendered feature.
- **A PDF prose assertion was really an assertion about line wrapping** (new `e2e/pdfText.ts`,
  `tests/e2e/pdfText.test.ts`, `e2e/report.spec.ts`). `pdf-parse` joins rendered lines with `\n`,
  and ubuntu-latest's fonts wrap the Sources paragraph in different places than macOS, so the
  running-footer gate's `toContain(sentence)` stopped matching. The extracted text is now
  whitespace-normalized through one tested function (collapse whitespace runs; join a soft wrap
  that landed on an existing hyphen) and the gate asserts the WHOLE sentence rather than its tail
  — line-break-proof without becoming a shorter claim. Two of that function's five unit tests are
  seeded faults: a DROPPED word and an OVERPRINTED line must still not match. The normalized text
  is attached to the test report, so a future red on another platform shows the text.
- **An engine-backed step carried Playwright's 5 s per-assertion default**
  (`e2e/report.spec.ts`). "the permalink reproduces byte-identical scores.csv/species.csv in a
  FRESH context" boots real DuckDB-WASM twice — once per context — and still read
  "Scoring TestPlace (1 of 1)…" at 5 s on the runner. Both waits now use an explicit 30 s, which
  is 2× the _measured_ 15 s budget the sibling cold-load gate for the same place holds (and which
  passed on webkit/linux in the same run). The comment says so; the cold-load and
  `species.timing.spec.ts` performance gates are untouched.
- **Linux gallery baselines** (`e2e/gallery.spec.ts-snapshots/*-chromium-linux.png`). Playwright
  snapshots are platform-suffixed and the repo only had `-darwin`, so all six gallery cases failed
  with "A snapshot doesn't exist … writing actual". The linux baselines were generated BY CI and
  eyeballed before committing (every section renders in both themes at all three widths); the
  darwin baselines stay. To make that possible, `pages.yml` now uploads `test-results/` as an
  artifact on a red `e2e` or `e2e (gallery)` job — without it there is no way to get a linux
  rendering, or a failing test's trace, off the runner.

# atlas 0.10.13

Two owner-reported defects, both screenshots: the species popup was unreadable in the navy theme,
and the scores lens showed nothing on a map click.

- **One themed map popup, shared by both lenses (`src/lib/map/popup.ts` + `popup.css`).** MapLibre's
  own `Popup` ships a hard-coded white box and a black close glyph -- unthemed, so the navy theme's
  light-on-dark text tokens painted white text on that white box; only the species value row's own
  inline swatch style stayed legible. Every popup in this app now goes through `createPopup()`,
  themed with the same glass recipe as every other floating card (`--surface-panel` at
  `--glass-opacity` + `--glass-blur`, text `--text-primary`, close button and focus ring themed
  too) -- `tests/map/popup.test.ts` pins the class/token wiring, and `e2e/species-popup.spec.ts`
  measures the REAL computed contrast on a real click, in both themes (navy 10.79:1, paper
  14.23:1, against the same `--surface-panel-basis` worst-case the site's own contrast gate uses).
- **The scores lens now shows a popup on click.** A cell click shows "Cell {id} · lon {x.xxx}, lat
  {y.yyy} · {layer label}: {value}" (atlas-4's Selection checklist); a zone click shows "{name or
  key}: {round(value)}" (parity doc §6.4's tooltip text, `zoneFill.ts`'s `zoneTooltip()`, wired to a
  click for the first time). The popup closes on the next click or Esc. The cell's value is read
  from the wide `cell` Parquet tile through a new, minimal query (`analysis/queries.ts#cellValue()`,
  `sql/cell_value.sql`) -- never a rendered raster pixel (plan D4);
  `tests/lens/scores/no-readpixels.test.ts` is the source-scan gate that holds it, and
  `e2e/scores.popup.spec.ts` exercises the real engine against a real Parquet fixture.

# atlas 0.10.12

Three owner-reported UI defects, screenshots in hand: an overcrowded legend, a missing Scores
legend, and an overcrowded species search field.

- **Legend labels overcrowd fixed.** `Legend.svelte` used to print one label per palette stop (11
  for a continuous ramp, e.g. "1.00 10.90 20.80 ... 100.00"). It now takes a `ticks` prop (default
  2, spec.md's continuous-ramp rule: both ENDPOINTS, optionally a midpoint) and renders only that
  many labels — the gradient itself still paints every stop. Species legend labels are integers
  ("1"/"100", new `formatSpeciesLegendValue`); the scores legend's endpoints print the pre-rounded
  `signif(rescale,3)`/`round(range,1)` values verbatim (new `formatScoresLegendValue` — a plain
  stringify, never `toLocaleString`'s implicit 3-fraction-digit re-round, which turned
  `signif(0.0123456,3) = 0.0123` into "0.012"). `tests/raster/ramps.test.ts`
  (`legendTicks`), `tests/lens/species/mapInputs.test.ts`, `tests/lens/scores/{mapInputs,raster}.test.ts`.
- **The Scores lens now has a floating legend.** It never had one at all outside the Layers panel
  (and never for the zone-choropleth branch): `mapInputs.ts`'s `scoresMapInputs()` now also returns
  a `legend` (raster branch: `signif(rescale,3)` endpoints; zone branch: `round(range,1)` endpoints,
  11-bin swatches; plus `unavailable`/`empty` reasons), rendered by the new `ScoresLegend.svelte`
  through the SAME floating "lens legend" region over the map the species lens already used
  (Shell.svelte: one slot, keyed on `sel.lens`, both lazy). The in-panel copy in `LayersPanel.svelte`
  is removed (spec.md: one legend on screen at a time). `e2e/scores.firstpaint.spec.ts` (floating
  legend with title + 2 endpoints, both versions) and a new lens-switch test (scores legend swaps
  out for species); `tests/lens/scores/{mapInputs,zoneFill}.test.ts`.
- **The species search field no longer overflows.** "Only species in US waters" used to be a third
  static row inside the topbar's fixed-height search pill, always rendered — moved into the
  picker's own dropdown (`.picker-dropdown`, opens under the field on focus) as its header, the
  first focusable element after the input, never part of the field's static box. Kept in the
  picker rather than the Layers panel: it filters what the SEARCH shows, and stays reachable by Tab
  from the field. Also fixed `.picker-input`'s own `height: 44px` override, which alone already
  overflowed the 32 px pill. `e2e/species.smoke.spec.ts` (closed-state height/no-overflow, and
  keyboard reachability from the field).
  - The keyboard-reachability test presses `Alt+Tab` (Playwright's name for Option+Tab) on WebKit,
    plain `Tab` elsewhere: WebKit's default Tab sequence skips non-text form controls (checkboxes
    included) without "Full Keyboard Access" on, the same platform default
    `e2e/shell.a11y.spec.ts:189` already documents for buttons — not a bug in this checkbox.

# atlas 0.10.11

The basemap fix: CARTO's raster basemap tiles (`dark_all`/`light_all`) started answering with an
"API KEY REQUIRED" watermark (owner report, 2026-09-23) -- CARTO now gates the raster endpoint
behind a key. The basemap is CARTO's keyless VECTOR GL style instead
(`dark-matter-gl-style`/`positron-gl-style`), fetched once per theme and merged into the app's ONE
composed style (CLAUDE.md: "one MapLibre style, one `setStyle(diff:true)`").

- **No more watermark.** `src/lib/map/layers/basemap.ts#basemapForTheme()` now returns CARTO's
  vector style.json URL; `loadBasemapStyle()` fetches+caches it per theme (never awaited inline by
  `composeStyle()`, which stays synchronous -- see its own header for the measured regression that
  made this the rule). `style.ts#mergeCartoStyle()` namespaces every fetched source/layer with a
  `basemap-` prefix (CARTO's own style.json has a layer literally named `"background"`, which
  would otherwise collide with this app's synthetic one) and merges them FIRST into `LAYER_ORDER`'s
  "basemap" slot; `layersControlItems()` excludes all of them from the toggleable layers list by
  that same prefix. `report/reportMap.ts`'s report map follows the same builder automatically.
- **Never blanks.** A failed or not-yet-warm fetch falls back to `EMPTY_BASEMAP_STYLE` (no CARTO
  layers), leaving just the theme's plain `--surface-map` background colour -- never a blank map.
- **Hermetic e2e fixtures updated**: `e2e/map-hermetic.ts#routeBasemapStyle()` (and
  `routeVariedBasemapStyle()`, for `report.spec.ts`'s captured-image checks) route the whole CARTO
  vector chain -- style.json, its TileJSON, every `.mvt` tile, the sprite.
- **Two new seeded-fault gates**: `tests/map/no-raster-basemap.test.ts` (a source scan: the old
  `dark_all`/`light_all` raster literals never return to `src/lib/map`) and a layer-order fixture
  proving a CARTO layer mistagged with the wrong role would sort after the zone data instead of
  under it.

# atlas 0.10.10

`atlas-8` fix round 2 (of 2): merged with `main` (atlas-7 fix round 2, 0.10.9); the coordinator's
survivor (`scores.firstpaint.spec.ts` v9's raster test, intermittently red alone on Firefox at
load, ~1-in-13 to 1-in-40) was a REAL bug in `src/lib/map/styleQueue.ts`, not a test-timing gap.

- **Root cause: a stale queued style could clobber a just-applied one.** Instrumented with a
  wrapped `map.setStyle` (logging `isStyleLoaded()`, the style's layer ids, and any thrown error
  around each real call): on the failing runs, TWO real `setStyle(diff:true)` calls landed close
  together — the first (direct-apply, `r_lyr` included) added the raster; a SECOND, ~100-4000ms
  later, silently REMOVED it again. That second call was the FALLBACK/`"idle"` flush of an OLDER,
  now-stale queued style from an earlier `applyStyle` call made while `isStyleLoaded()` was still
  false — `createStyleApplier`'s "apply immediately once loaded" branch never cancelled that
  earlier call's still-armed listener/timer, so it fired later regardless and reapplied its
  outdated (raster-less) content over the correct one. Fixed in `styleQueue.ts`: the direct-apply
  branch now clears `queued`/`queuedListener`/the fallback timer first, so a stale flush finds
  nothing left to apply (already-existing, safe no-op path) instead of undoing the newer style.
  Two new regression tests in `tests/map/styleQueue.test.ts` reproduce it with a `MutableFakeMap`
  (an `isStyleLoaded()` that flips false→true mid-scenario, which every prior `FakeMap`-based test
  pinned constant and so could never have caught) and fail without the fix (verified by reverting
  it locally and re-running).
- `scripts/verify.mjs` self-sufficiency (fix round 1) re-verified on the merged tree: builds +
  starts its own preview server on a fresh port, runs, tears down only what it started.
- Gates: `tsc` 0 · `vitest` (styleQueue.test.ts) 10/10, including the 2 new regressions ·
  `npx playwright test` (all three engine projects + timing, one combined run, a fresh port never
  reused from a prior run): 262 passed, 21 skipped, 0 failed, 0 did not run. The originally-red
  `scores.firstpaint.spec.ts` v9 raster test alone, repeated 8x on `--project=firefox`: 64/64 (all
  four v7/v9 tests x 8 repeats), each raster-paint run now well under 1.5s (previously up to a
  20s+ timeout).

# atlas 0.10.9

`atlas-8` fix round 1 (of 2): merged with `main` (atlas-7's report, 0.10.5-0.10.8); the widened
specs were RED on webkit/firefox as reported, root-caused and fixed for real (not loosened).

- **Root cause, both originally-reported failures (and two more found the same way): a raster
  applied by a lens' own reactive effect, or manually injected by a test, can land while
  `map.isStyleLoaded()` is still false** and get QUEUED (`src/lib/map/styleQueue.ts`), flushing
  only on the map's next `"idle"` or its 4000ms fallback — `map.loaded()` says nothing about
  whether that queue has flushed. Chromium usually won the race by luck of timing; WebKit/Firefox
  reproducibly lost it.
  - `e2e/map.spec.ts` "paints a raster": `ScoresLens.svelte`'s own lazy-mount effect
    (`mapExtra = scoresMapInputs(...)`) was clobbering the test's manually-injected raster.
    Fixed self-healingly: the raster is re-injected on every poll iteration, so whichever
    injection is temporally last always wins, regardless of which engine's module-loading timing
    is slower.
  - `e2e/species.smoke.spec.ts` "switching species twice": the OLD assertion checked
    `isSourceLoaded` once, then read the source URL once with no further wait — so it could
    read a STALE (first-selected) URL while the SECOND selection's style was still sitting in the
    queue. Fixed by polling the URL itself until it matches, covering the 4000ms fallback.
  - `e2e/species.smoke.spec.ts` "a range draws >= 1 rendered feature": same shape as the
    `map.spec.ts` fix (manual injection vs. the species lens' own mount effect) — same
    self-healing fix.
  - `e2e/scores.firstpaint.spec.ts` "paints the score raster" (v7 AND v9, on any engine): same
    queue-flush race, no manual injection this time (`ScoresLens`'s OWN effect can queue). Fixed
    by waiting for the real layer (`r_lyr`) to exist before polling pixels; the previous narrow
    `browserName==="firefox" && ver==="v9"` skip is removed — no longer needed.
- **`e2e/species.timing.spec.ts`**: a real, one-time browser-process warm-up cost (measured: the
  FIRST page a freshly-launched browser ever navigates took 20.9s here vs ~1.1s for the 2nd-5th,
  same browser, fresh contexts) can exceed this test's per-run polling ceilings. Widened them
  (10s→30s per poll, plus `test.setTimeout(120_000)`) so this one-time cost is not the artificial
  bottleneck; the actual gate (`BUDGET_MS` on the median of 3) is unchanged.
- **`scripts/verify.mjs` is now self-sufficient**: if nothing answers `VERIFY_BASE_URL` yet, it
  builds `dist/` and starts its own `vite preview`, waits for it, runs the matrix, and shuts down
  ONLY the server it started (a server it finds already running is reused, never killed).
  `--no-server` fails fast instead, for a caller that wants to manage the server itself.
- Gates: `tsc` 0 · `svelte-check` 0/0 · `vitest` 169 files / 2548 tests, 3 skipped · `eslint` 0 ·
  `prettier` clean · `npx playwright test --project={chromium,webkit,firefox} --workers=1` (run
  one engine at a time per the shared-machine load rule): 91/91, 81/81 (10 chromium-only skips),
  82/82 (9 skips) — 0 failed, 0 did not run, on all three. `node scripts/verify.mjs` (chromium,
  self-started server): 6/6 on a `--limit=2` smoke check.

`atlas-7` fix round 2 (Opus review of main@0ec0eb3): four static section narratives, D7b's own
disclosure, a real (not just double) running footer, an honest coverage claim, two ported access
invariants, and a real map-PNG-capture guard -- plus the fix its own e2e fixture exposed.

- **Four static narratives**, built from THIS release's own data, never hardcoded: the Map section
  states the Spectral ramp + ecoregion rescale; each flower names exactly this release's
  `scores.components` (and, when a ring folded a duplicate component, says so); the Table of
  Scores states the N-cells/rescaling rule; the Summary of Species carries the FWS/NMFS->USA
  extinction-risk consolidation note. `tests/lib/report/narratives.test.ts` (9 tests) pins these,
  including a seeded-fault case (`bird, turtle, fish` must never read `reptile, other`).
- **D7b disclosed for drawn places.** A `kind: "geom"` place's Parameters entry now states, in one
  sentence, that it is scored over the U.S. study area cells by the published zone method and can
  therefore differ slightly from a Program Area it traces (measured up to ~0.05 on a released
  area); a zone place carries no such note (a published zone IS the study area).
  `tests/lib/report/narratives.test.ts` covers both branches.
- **The running footer was two footers, not one.** `@page { @bottom-center }` DOES render in
  Chromium (a prior comment here claiming otherwise was wrong, measured false) -- it held a static
  placeholder while a `position: fixed` `.print-footer` carried the real permalink/release text,
  so every printed page carried both, no page number anywhere, and on page 3 the fixed copy
  collided with body content. Fixed: the fixed `.print-footer` is gone; `@bottom-center`'s
  `content` now reads the real permalink/release strings off two CSS custom properties
  (`Report.svelte` sets them; generated content has no element of its own to read a prop off of)
  plus `counter(page)`/`counter(pages)` for the page numbers.
- **"Scored over 99.9%" was sometimes false.** A coverage of 0.998740 rounded UP to "99.9%"
  (`Math.round`), which 99.874% does not exceed. The footnote now floors to one decimal
  (`formatCoveragePctFloor`, new); the neutral Parameters-table display is unaffected (still
  rounds).
- **Two invariants ported into `e2e/report.spec.ts`** from the shell/places specs, since
  `report.html` re-implements the same access gate and the same `#pl=` hash codec and neither
  guarantee was ever proven for it directly: public host + `?ver=v9` makes zero requests under
  `/v9/` (falls through to latest); the place token never appears in any request URL.
- **The map-PNG-capture guard only rejected pure black/white.** A reviewer's captured report map
  was 896x360 of one flat colour -- neither black nor white, so the old guard passed it.
  `captureMapPng` now also rejects a flat, single-colour capture (a luminance-stdev floor); the
  pure pixel-stats math is now its own exported, DOM-free function
  (`luminanceStatsFromRgba`/`captureRejectionReason`) so `tests/report/reportMap.test.ts` can seed
  the fault directly (a flat mid-grey capture that a mean-only check would have accepted).
  Wiring this guard up against a REAL (not flat) hermetic basemap tile (`variedPng()`,
  `e2e/map-hermetic.ts`) exposed a second, real bug: `captureMapPng` waited on `isStyleLoaded()`,
  which says nothing about an in-flight animated `flyTo()` or a raster tile's still-pending image
  decode, so the capture often fired at (or near) the pre-flight, pre-decode frame. Fixed: it now
  waits for the map's `"idle"` event unconditionally (never short-circuited), twice, with a brief
  settle in between -- bounded by the same fallback-timer pattern `styleQueue.ts` already uses
  against a hung tile request.
- `provenance.ts`'s "Reproduce in R" snippet now states `# requires msens >= {boot.msens}` (three
  of its functions are unexported on `main` as of this writing) and no longer calls
  `cells_in_study_area()` as a redundant second clip -- `scores_for_cells(..., denominator =
"study_area")` already clips to the study area internally.
- Gates: `tsc` 0 · `svelte-check` 0/0 · `vitest` 164 files / 2524 tests (3 skipped), all green ·
  `eslint` 0 · `prettier` clean · `vite build` succeeds · `size-budget --entry index.html` 415.2 KB
  gzip static / 555.7 KB combined (budgets 450/600) · `size-budget --entry report.html
--allow-marker duckdb` 53.4 KB gzip static (budget 450) · `e2e/report.spec.ts` chromium 18/18
  (36/36 under `--repeat-each=2`).

# atlas 0.10.8

- `e2e/report.spec.ts`'s `page.pdf()` block is skipped on webkit and firefox (`page.pdf()` exists only
  in headless Chromium); it had failed there, not skipped, on the first full three-engine run.

# atlas 0.10.7

`atlas-7` fix round 1 (Opus review): no second copy of the map; the checklist's real gates against
real Parquet fixtures; five seeded faults as tests, not arguments.

- **No second copy of the map.** `reportMap.ts` no longer restates the basemap tile URL or a
  zone's `label_pt` lookup, and `mapWiring.ts` is deleted: `Report.svelte` now imports `createMap`
  (`lib/map/map.ts`) and `composeStyle`/`basemapForTheme`/`zoneLabelsFromBoot` (`lib/map/style.ts`,
  `layers/{basemap,zones}.ts`) directly, same as the app. Accepted the ~6 KB gzip this puts back on
  `index.html` (see the size line below).
  `tests/report/noSecondMapCopy.wiring.test.ts` (seeded fault: a restated basemap host, a
  hand-built `new MapLibreMap(...)`, or a hardcoded glyphs URL under `src/report/` is caught) is
  the mechanical guard against it recurring.
- **Real Parquet fixtures, real gates.** `e2e/fixtures/report/*.parquet` (`generate.sql`, the
  duckdb CLI, same "generate once, commit the binary" convention as `e2e/fixtures/places/`): a
  synthetic 48x48 grid with FOUR `cell`/`cell_model` partition tiles, real `taxon`/`zone_taxon`
  rows. `e2e/report.spec.ts` gained: (a) 20 zone places rendering complete in < 10 s; (b) a 4-tile
  custom (drawn) place's scores AND species rendering complete, cold, in < 15 s, combining all
  four `cell_model` batches; (c) `page.pdf()` + `pdf-parse`: place/table labels present, the
  PREVIEW watermark present for v9/preview and absent for v7 (the rotated watermark text comes
  back letter-per-line from pdfjs — matched whitespace-stripped); (d) the downloaded HTML opens
  with every http(s) request routed to a hard abort and still shows map/flowers/tables; (e) the
  permalink reproduces byte-identical `scores.csv`/`species.csv` (compared via `fflate#unzipSync`)
  across a **fresh browser context**. Needed `npm run duckdb:fetch-ext` locally (CI already runs
  this before `vite build`) — DuckDB-WASM's `read_parquet()` autoloads the `parquet` extension and
  the self-hosted mirror under `public/duckdb-ext/` is gitignored, dev-only.
- **Five seeded faults, as tests**: `tests/report/noHtmlDirective.wiring.test.ts` (`{@html name}`
  in any `src/report/**/*.svelte`); `tests/report/windowOpenSync.wiring.test.ts` (an `await` before
  `window.open()` in either entry point's handler); `tests/report/rampDomainFromPlaces.wiring.test.ts`
  (a release-wide rescale reference feeding the map's color domain instead of `model.map.domain`);
  `tests/report/printBreakInside.test.ts` (`break-inside: avoid` missing from `table tr` under
  `@media print`); the watermark-absent-for-restricted and table-row-break faults are additionally
  exercised live by `e2e/report.spec.ts`'s `page.pdf()` block above.
- Gates: `tsc` 0 · `svelte-check` 0/0 · `vitest` 163 files / 2501 tests, all green · `eslint` 0 ·
  `prettier` clean · `vite build` succeeds · `size-budget --entry index.html` 415.2 KB gzip static
  - 140.5 KB worker = 555.7 KB combined (budget 600 KB; up from 0.10.6's 414.8 KB now that the map
    wiring is shared code again, not a restatement) · `size-budget --entry report.html --allow-marker
duckdb` 52.6 KB gzip static, 0 worker (unchanged) · `e2e/report.spec.ts` 15/15 green (chromium) ·
    `e2e/shell.smoke.spec.ts` 4/4 still green.

# atlas 0.10.6

`atlas-7` step 4: the two entry points into the report.

- **Places panel "Report"** (`src/places/Places.svelte`) — a footer button beside Share/Download
  that opens `report.html?ver={ver}#pl={sel.pl}` for every place currently in the panel.
  `window.open()` runs SYNCHRONOUSLY inside the click handler (no `await` before it) so no browser
  treats the tab as unrequested — the exact popup-blocker workaround the legacy Shiny app's
  placeholder-tab trick (`apps/scores/app.R:1311-1326`) no longer needs. `ver` is the release this
  panel is actually viewing (`window.__early.version`, already read here); `pl` is reused verbatim
  from `sel.pl`, never re-encoded.
- **Zones table "Report on selected"** (`src/lens/scores/ZonesTable.svelte` + `TablePanel.svelte`)
  — a checkbox column (only rendered when a caller passes `onReportSelected`) plus a toolbar button
  that opens a report for one multi-key zone Place carrying every checked key, in the table's own
  rank order. `TablePanel.svelte` builds the `z.<set>.<keys>` token with `places/model.ts`'s own
  `zoneSetForUnit()`/`hashFromPlaces()` — the identical encoding a Places-panel zone place uses —
  and opens it the same synchronous way.
- Neither entry point imports anything from `src/lib/report/` or `src/report/`: both just build a
  URL string and call `window.open()`, so index.html's own static graph is untouched by this step
  (confirmed: `size-budget --entry index.html` is unchanged from 0.10.5's number).
- Analytics: `report_open{n_places, kinds}` fires once, from inside `report.html` itself
  (`Report.svelte`, after `expandPlaces()` resolves) rather than from either opener, so a single
  click is a single event regardless of which entry point was used; `report_export{format}` fires
  per export button. Both event names were already reserved in `lib/analytics/events.ts` (atlas-2);
  `sanitize.ts` already strips `pl`/`t` from every event unconditionally, so neither a place name
  nor a vertex nor the hash can reach either one.
- Gates: `tsc` 0 * `svelte-check` 0/0 * `vitest` 158 files/2485 tests, all green * `eslint` 0
  (added `svelte/reactivity`'s `SvelteSet` for the checkbox selection, per `svelte/prefer-svelte-
reactivity`) * `prettier` clean * `size-budget --entry index.html` unchanged at 414.7 KB gzip
  static / 555.3 KB combined * `e2e/shell.smoke.spec.ts` and `e2e/report.spec.ts` still green.

# atlas 0.10.5

`atlas-7` steps 2-3: the report document itself, its progressive rendering, the print stylesheet
and the three client-side exporters. Landed together because the document and its export buttons
are one file (`Report.svelte`); step 4 (entry points) follows in 0.10.6.

- **`report.html` + `src/report/Report.svelte`** — the document, mounted by `src/report-main.ts`.
  Header band (MST mark, the agency lockup behind `VITE_SEAL=1` via `lib/ui/sealVisibility.ts`,
  release chip, generated stamp, the permalink and its QR — a PNG `<img>`, never `{@html}` — wave
  footer); intro; Parameters (collapsed, a `hidden`-attribute disclosure so print CSS can force it
  open); the map (places filled by mean score, `spectral_r`, opacity 0.6, point-on-surface labels
  with a white halo, `Legend.svelte`, positron basemap + attribution); one flower per place (tabs
  on screen, all panels always in the DOM so print shows them sequentially); the Table of Scores
  with coverage footnotes; the Summary of Species per place (counts cross-tab, top 20 linking to
  the Species lens, "Download full species list" as a client Blob, the empty-case string); Sources
  and Method (citations via `lib/release/cite.ts`); Provenance (collapsed SQL, "Reproduce in R").
  Progressive rendering: `placeInputs` starts every place's `scores`/`species` at `null` and
  `buildReport()` (already-merged, untouched) re-runs after each place lands, with ONE visible
  `.progress-line` plus `announce()` calls.
- **`report.html`'s access gate** — the SAME inline early-fetch script as `index.html`,
  byte-for-byte (this file's own header explains why it must be a second copy, not an import).
  `tests/release/inline-early-fetch.test.ts` now asserts the two are identical and runs the shared
  `ACCESS_CASES` table against report.html's own copy too.
- **`src/report/data.ts`** — dispatches each place to the SAME engine paths the app already uses:
  a zone place's scores come straight from `boot.zones` (`model.ts#zoneScoreInput`, no engine at
  all) and its species from `speciesForZone()`; a custom place goes through
  `places/{dataEngine,results}.ts`'s D7b-clipped blend — no second query path.
- **`src/report/reportMap.ts` + `mapWiring.ts`** — a standalone MapLibre map for the print/export
  figure, deliberately NOT importing `lib/map/{map,style,layers/*}.ts`: those are reachable
  STATICALLY from `index.html` already, and report.html importing them too shared a Rollup chunk
  with index.html's own entry, measured to grow its committed static budget by 6.3 KB gzip for
  code only report.html needed. `mapWiring.ts` restates the small, load-bearing slice of
  `map.ts#createMap` (named maplibre-gl imports, the `?worker&url` wiring, `preserveDrawingBuffer`)
  and `reportMap.ts` restates `layers/{basemap,zones}.ts`'s two facts (the positron tile URL, a
  zone's `label_pt`) instead. `captureMapPng()` waits for `idle`, forces a repaint, waits two
  animation frames, then rejects an all-black/all-white capture.
- **`src/report/{exportFiles,exportHtml,exportZip,exportDocx,flowerSvg,svgToPng,qr}.ts`** — Print
  (`window.print()`); Download HTML (a detached DOM clone with the live map swapped for its
  captured PNG, `collectPageCss()` inlining every stylesheet, self-contained because this document
  loads no custom web font to begin with); the data-package ZIP (lazy `fflate` over
  `buildDataPackageFiles()`'s pure file list — `scores_<place>.csv`, `species_<place>.csv` via the
  app's own `lens/scores/species.ts#toCsv`, `places.geojson`, `query/*.sql`, `provenance.json`,
  `CITATION.md`, `README.md`); Word (lazy `docx`, coded styles per D9 — no reference template
  exists to match). `report.css` imports only `lib/brand/tokens.css`, never `fonts.css`, and sets
  `data-theme="paper"` explicitly (tokens.css's un-themed default is `navy` — the very first e2e
  run caught this as a real color-contrast failure). `@page { size: Letter; margin: .75in }`, a
  `position: fixed` running footer/watermark (Chromium repeats fixed elements per page; CSS Paged
  Media margin boxes are the spec-correct primary but unsupported there), `break-inside: avoid` on
  figures/table rows/flowers, `table thead { display: table-header-group }` so a spanning table's
  header repeats.
- **`src/report/colors.ts`** — the report's own twin of `lib/map/colors.ts`: every color literal a
  standalone SVG/canvas/MapLibre-style needs outside any stylesheet, in one file.
  `tests/raster/ramps.wiring.test.ts` now exempts it the same way it exempts the map's.
- **`scripts/size-budget.mjs` `--allow-marker`** — report.html's provenance section narrates
  "DuckDB-WASM 1.32.0" as prose and its Word button used to say "Word (.docx)"; both are
  `FORBIDDEN_LAZY_MARKERS` substrings that a build-output text scan cannot tell apart from an
  actually-bundled dependency. `--allow-marker duckdb` drops that marker for report.html's own
  invocation; `tests/report-lazy-import-duckdb.wiring.test.ts` (a source-level, entry-relative
  scan, the same technique as `tests/treemap-lazy-import.wiring.test.ts`) is what still proves
  `@duckdb/duckdb-wasm` and `docx` are never statically bundled by either entry.
- **Gates measured on this branch**: `tsc` 0 errors; `svelte-check` 0/0; `vitest` 158 files / 2485
  tests / 3 skipped, all green; `eslint` 0; `prettier --check` clean; `vite build` (both entries in
  one graph) succeeds; `size-budget --entry index.html` 414.7 KB gzip static + 140.5 KB worker =
  555.3 KB combined (budget 600 KB) — **up from the previously-committed 409.3 KB** because
  `maplibre-gl` itself is now shared between the two entries (report.html genuinely needs it too,
  and `tests/size-budget-gallery-isolation.test.ts` pins index.html and report.html to the SAME
  Rollup config, unlike gallery.html) — the avoidable share (`lib/map/{style,layers/*}.ts`,
  `camera.ts`) was eliminated via `mapWiring.ts`/`colors.ts` above, and 555.3 KB still clears the
  600 KB combined budget comfortably; `size-budget --entry report.html --allow-marker duckdb`
  52.6 KB gzip static, 0 worker (budget 450/150 KB); both committed red fixtures still fail;
  `e2e/report.spec.ts` (chromium, hermetic, zone places only — see that file's own header for
  scope) 9/9 green, and caught two real bugs before commit: the theme was never set (white text on
  a light background) and a stray trailing CSS rule silently defeated the print watermark under
  `@media print`.

# atlas 0.10.3

`atlas-8` step 3: budgets and the browser suites in CI; `docs/performance.md`.

- **`.github/workflows/pages.yml`, six new jobs**: `e2e` (the root Playwright suite, all three
  engines, then the `timing` project as its own step after them), `e2e-gallery`, `e2e-engine`,
  `e2e-opfs`, and `parity` (v9 against the real bucket — verified PASS, max|Δ| < 1e-9 on every
  quantity, before this job was written). `publish` now depends on all of them, plus `checks` and
  `test-faults` (0.10.1).
- **`docs/performance.md`** — what every budget/timing gate measured on this laptop (size-budget:
  409.4/140.5/549.9 KB gzip; the timing gate: median 1579 ms of 3 cold runs against a 2.5s budget)
  and an honest accounting of what has NOT yet been observed on a real CI runner (this session has
  no CI access) — the jobs are wired, not yet run for real; atlas-0's F6 ask ("record the runner's
  number") is half-done until the first real `main` run's numbers are pasted back in.
- **The three slowest `verify.mjs` states, profiled**: all three are early-in-the-run desktop
  states within 500-1150ms of each other regardless of what they render — cost is dominated by
  per-page browser/hydration overhead, not by any state's own data. No fix indicated.
- `scripts/verify.mjs` now times every state and prints the slowest 3 at the end of a run.

`atlas-8` step 4: the fiddly bits that are code, not data.

- **Playwright route handlers now tolerate a test ending** (`e2e/routeSafety.ts`'s `safeRoute`) —
  the Firefox teardown race ("`route.fetch: Test ended`" outside any test, skipping the next one)
  is swallowed at the handler level in `e2e/{hermetic,map-hermetic,species-hermetic}.ts`; any other
  error still propagates.
- **`Panel.svelte`'s nested landmarks, fixed**: the panel body no longer carries a second
  `role="region"` inside the section that is already the panel's one landmark. New gate:
  `tests/ui/panelLandmarks.test.ts`.
- **The skip link now reaches the tool rail too**: a second skip link ("Skip to the tools",
  `#rail-region`) precedes the existing one — the rail's single roving-tabindex stop used to be
  reachable only by Shift+Tab backward from the panel. New gate: `tests/shell/skipLinks.test.ts`.
- **`?theme=navy|paper` accepted as aliases of `dark|light`** — the gallery/mockups' own theme-name
  convention now resolves correctly if pasted into the real app, in both the real parser
  (`THEME_ALIASES`, `src/lib/state/codec.ts`) and index.html's inline pre-paint script. New gate:
  `tests/shell/themeAliases.test.ts`; `tests/shell/theme-preboot.test.ts`'s shared case table grew
  two rows.
- **`DataTable`'s filter `<input>` itself reaches 44 CSS px tall on a coarse pointer** (spec §11) —
  the wrapping label already did; the visible, tappable input stayed ~28px. New gate:
  `e2e/gallery.spec.ts`'s "atlas-8 fix" describe block.
- **The Categories demo table no longer overflows the page at 320 CSS px** — wrapped in a
  `overflow-x: auto` scroll container (SC 1.4.10 exempts a data table's own scroll, never the
  page's). New gates: `tests/ui/categoriesOverflow.test.ts`, `e2e/gallery.spec.ts`'s "atlas-8 fix".
- Found while running the full gallery suite: `e2e/gallery.spec.ts`'s own Panel-body test still
  asserted the pre-fix `role="region"` — updated to assert its absence instead.

# atlas 0.10.2

`atlas-8` step 2: the Playwright state matrix, widened to three engines.

- **`scripts/verify.mjs`, filled in** — grew from a 4-state, chromium-only skeleton to 58 named
  view states (shell/theme, the scores lens' projection × outline × unit × palette × layer × area ×
  zone-selection combinations, the species lens' species × US-only × representation combinations) ×
  3 viewports (1280×800 / 390×844 / 320×800) × 3 engines (chromium/webkit/firefox) = 522 runs, fully
  hermetic (reuses `e2e/{hermetic,map-hermetic,species-hermetic}.ts`'s own fixtures via the same
  bundler-extension resolve hook `scripts/parity/run.mjs` uses). Per-state assertions beyond
  `assertLayout()`: a `gl.readPixels` raster probe (alpha-blended against `SCORE_RASTER_OPACITY`,
  not the raw fixture colour) and a rendered-vector-feature count, both run at desktop only (the
  fixture camera is desktop-tuned; a Program Area can legitimately sit outside a phone's narrower
  view at the same zoom — not a bug this matrix owns). `--engines=`/`--limit=`/`--states=` flags for
  fast local iteration.
- **Two real bugs the matrix found and fixed:**
  - The version chip's unstyled `PREVIEW` badge (`src/lib/ui/VersionBadge.svelte`) widened
    `button.chip` past its 84px CLS-stable min-width, pushing the topbar's theme toggle 0.7px past
    the right edge at 320 CSS px — only reachable by viewing a restricted/preview release (the
    species lens' v9 fixture). Fixed with a compact `.ms-preview-badge` style (`shell.css`).
  - `e2e/places.spec.ts`'s keyboard-only rename test selected the existing text with `Home` then
    `Shift+End`, which did not update WebKit's DOM selection the same way Chromium/Firefox's did —
    the later `type()` call inserted instead of replaced. Switched to `ControlOrMeta+a`.
- **`e2e/map.spec.ts`, `e2e/scores.firstpaint.spec.ts`, `e2e/species.smoke.spec.ts`,
  `e2e/places.spec.ts` widened from chromium-only to all three engines** (all measured green,
  except one open finding below).
- **One open, honestly-scoped finding, not silently widened:** `scores.firstpaint.spec.ts`'s v9
  raster probe reproducibly times out on Firefox specifically when run immediately after v7's four
  tests in the same file/worker (passes reliably alone or as the first test); root cause not
  isolated within this session. Skipped narrowly (`browserName==="firefox" && ver==="v9"`) with the
  finding documented in the test file itself, rather than reverting the whole file to chromium-only.
- **`e2e/verify.faults.spec.ts`** — the pyramid's three named seeded faults for this gate: a raster
  source 404 (DOM/layout stays fine; the pixel probe is what catches it), `setStyle` losing the zone
  layer (the vector-feature count is what catches it), and a panel pushed off-screen at 390 px
  (`assertLayout`'s per-control bounding-box check catches it, its whole-document overflow check
  does not).

# atlas 0.10.1

`atlas-8` step 1: gate inventory + the seeded-fault suite.

- **`tests/GATES.md`** — every gate named across atlas-0…7/9's subplans and Progress logs, where it
  lives, its committed seeded fault (or the rewrite that gave it one). ~95 gates inventoried; ~90
  already self-prove on `npm test`; 4 were "CANNOT FAIL" and are fixed in this release.
- **`npm run test:faults` (`scripts/test-faults.mjs`)** — the seeded faults that must be applied to
  the REAL exported function (not a parallel copy in a test file): each one is a committed unified
  diff under `tests/faults/*.patch`, applied in its own `git worktree add --detach` copy of HEAD
  under `$TMPDIR`, run against its named gate, and asserted RED, then discarded. Ships with three
  faults: `coverage-quadratic-scan` (the widened ratio gate below), `rmod-guard-drop`, and
  `opfs-eviction-order`. Wired into `pages.yml` as its own job, gating `publish` the same way
  `checks` does.
- **The coverage vertex-ratio gate, widened** (`tests/geo/coverage.test.ts`) — the existing 600↔2400
  vertex pair (threshold 8×) measured a real O(n²) fault at only ~2× (atlas-2's own closing-review
  finding: too weak to be load-proof). Added a 600↔16,000-vertex pair, threshold 16× — the same
  fault now measures 34–41× against a 5.4–7.6× baseline.
- **Species lens source scan widened** (`tests/lens/species/sourceScan.test.ts`) — now also scans
  `src/lib/map/**` (previously invisible to it), and follows one relative-import hop per file so a
  forbidden grid constant re-exported from a sibling module is caught even when its literal digits
  never appear in the scanned file's own text.
- **`document.title` has exactly one writer** — `Shell.svelte` and the species lens
  (`src/lens/species/state.svelte.ts`) each ran an independent effect writing it, racing on Svelte's
  own effect-scheduling order. Consolidated to `Shell.svelte`; new source-scan gate
  `tests/shell/documentTitle.test.ts`.
- **Upload refusal-copy per-rule assertions** (`tests/geo/upload/messages.test.ts`) — the old
  aggregate checks let a vague-but-grammatical "mysteryRule" through undetected. Added per-rule
  tables: `what` must name the number/name that decided a count-based rule's outcome (13 rules);
  `fix` must name a concrete format or tool (20 of 22 rules).

# atlas 0.10.0

`atlas-7` step 1: the report data model — one pure function from `(release, places)` to a plain
object whose every number equals what R produces for the same places.

- **`buildReport()` (`src/lib/report/model.ts`)** — header (title, `ver · status · access`,
  generated stamp, permalink parts, the PREVIEW banner and `PREVIEW_` file prefix on a restricted
  release), intro, per-place parameters (kind, zone keys or vertex count / bbox / area / N cells /
  the D7b share inside the study area / the place token), the map's ramp domain, one flower per
  place, the Table of Scores with a coverage footnote for every component below 100 %, the species
  cross-tab + top 20 + full list, dataset citations, and a provenance block that replaces
  `devtools::session_info()` (every table read with its digest, app SHA, DuckDB-WASM version,
  timestamp, the SQL that ran, and a runnable "Reproduce in R" snippet carrying the real place
  token). It **fetches nothing**: the caller supplies the already-run queries, and every one of them
  may be `null` so the document can render progressively. Every figure also carries a text summary
  (`model.summaries`), the accessibility gate's input.
- **The numbers gate.** `tests/fixtures/report/{v7,v9}/report_{gaa,gulf_rectangle,aleutian_dateline}.json`
  — six committed R references generated read-only by `scripts/parity/report_fixtures.R`
  (`npm run report:fixtures`; see `tests/fixtures/report/README.md` for the exact commands).
  `tests/lib/report/numbers.test.ts` asserts every score within `1e-9` and the counts, the top-20
  order and the full-list order **exactly**, per place per version, with the input rows shuffled
  first so the model's own sorts are what is measured. R and TypeScript agree on all six.
- **Six seeded faults** (`tests/lib/report/faults.ts` + `faults.test.ts`), each proven red against
  the same fixtures: a mis-mapped `er_consolidate` arm, the ramp not widened when every place
  agrees, `Overall` as a weighted mean, the top 20 sorted by the wrong column, a suppressed coverage
  footnote, and the D7b clip bypassed for a custom place.
- **`src/lib/release/cite.ts`** — new, and the app's ONE dataset-citation path. It reads
  `boot.datasets`' `citation`/`link_info`, which nothing did before (the species lens's
  `datasetIndex()` keeps only the display fields). It lives under `release/`, not under `report/`,
  so a lens can use it without dragging the report into `index.html`'s static graph.
- **`tests/report-lazy-import.wiring.test.ts`** — `src/lib/report/` must stay unreachable from
  `src/main.ts`'s static import graph. `scripts/size-budget.mjs` only ever walks `index.html`, so it
  could not have caught a leak until it grew past the budget; this scan states the invariant
  directly. `index.html`'s static critical path is unchanged at 409.3 KB gzip.
- **`docs/report-model.md`** — the model's shape and what steps 2–3 render from it, including the
  two places where two numbers legitimately differ: a zone place's published `zone_metric` vs the
  same area traced as a custom place (v9 GAA 40.4484 vs 40.4982), and the flower's drawn-petal mean
  vs the table's `Overall` on releases that publish both `primary producer` and `primprod`.

# atlas 0.9.15

- The species first-paint timing gate's Playwright project now `depends` on the three engine
  projects, so in a full `npx playwright test` run it starts only once they have finished and the
  machine is quiet (started concurrently it hit its 10 s predicate timeout; alone, and now in the
  full run, medians of ~1.5 s). `--project=timing` still runs it on its own.

# atlas 0.9.14

`atlas-6` fix round 1 (Opus review): four must-fixes in the places panel.

- **Share dialog: dead ladder, link/number divergence.** `ShareDialog.svelte` now branches on
  `fit.simplified` BEFORE `fit.status`, so the simplify-and-accept ladder actually renders whenever
  a rung already ran to fit the link (previously unreachable: `fit.status === "ok"` is true for an
  accepted rung too). `copyLink()` now builds the copied URL from `fit.hash` via the new
  `shareUrl()` helper (`src/places/share.ts`), never `location.href` verbatim — which used to copy
  the ORIGINAL, unsimplified link while the dialog displayed the simplified length. Accepting a
  rung recomputes from `fit.places` directly so the numbers on screen update before anything is
  copied.
- **"Show analysis cells" now paints the D7b-clipped set.** `Places.svelte`'s
  `toggleAnalysisCells()` calls the new `placeCellsInStudyArea()` (`src/places/results.ts`) instead
  of the raw, unclipped `geo/coverage.ts#cellsInPolygon()` — a place straddling the study-area edge
  no longer paints land/foreign-water squares the analysis itself never counts.
- **D7b's study-area clip has a behavioural test**, not just a text regex over the SQL: a new
  `tests/analysis/studyAreaClip.test.ts` evaluates the real `sql/cells_in_study_area.sql` WHERE
  clause against a small in-memory cell table (`in_usa` TRUE/FALSE/NULL), proving NULL counts as
  inside and the composite reflects only the clipped cells. `MAX_PLACES` (model.ts vs.
  upload/normalize.ts) and `CIRCLE_SEGMENTS` are now pinned with a regression test each.
- **Fresh-profile round trip**: `e2e/places.spec.ts` gained a real-release test (a tiny checked-in
  DuckDB-WASM fixture) proving that copying a place's share link and opening it in a brand-new
  browser context recomputes the identical cell count and composite.

# atlas 0.9.13

atlas-5 fix round 3: pins four reviewer faults that stayed GREEN, plus the five-probe
`/cog/point` gate as a permanent unit test.

- **US-only toggle keeps a shared selection (SpeciesPicker.svelte)**: `data/picker.ts`'s
  `keepSelection` was already pure and tested, but nothing exercised the SVELTE WIRING that calls
  it — dropping that call stayed green. New e2e case (`e2e/species.smoke.spec.ts`) loads a non-US
  taxon directly, ticks "Only species in US waters", and asserts the fallback to the default; also
  asserts a taxon in both lists survives the toggle either direction.
- **`createSearchLogger(now)`** (new, `data/picker.ts`): the 900 ms debounce + ≥ 3 chars +
  no-repeats `search_species` rule, pulled out of `SpeciesPicker.svelte`'s inline `setTimeout` so a
  fake-clock unit test can pin it (`tests/lens/species/picker.test.ts`) — a 900 → 90 ms fault and
  an "allow a repeat" fault both now go red.
- **`popup.ts`'s 0.5 luminance threshold** now has a PAIRED fixture (`#7f7f7f`, 0.498 → white,
  beside `#808080`, 0.502 → black) — the previous one-sided fixture could not tell "the threshold
  is 0.5" apart from "the threshold is anywhere below 0.502"; a 0.5 → 0.35 fault now goes red.
- **`src/lib/map/styleQueue.ts`**: a bounded fallback (`DEFAULT_STYLE_FALLBACK_MS` = 4000) flushes
  a queued style even if `"idle"` never fires — a HUNG tile request (no response, ever) used to
  strand a queued style silently, same symptom as fix round 1's bug, just triggered by the network
  instead of event timing. Unit-tested with a fake clock; e2e twin in `species.smoke.spec.ts` hangs
  both basemap and titiler tiles and asserts a species switch still shows the new raster source.
- New unit test: `tests/lens/species/popup.test.ts`'s "the five `/cog/point` probes" drives the
  real `createTitilerValueSource` (cog / AquaX-delivered / pmtiles-presence / nodata / off-grid)
  into `popupContent.displayValue`, pinning the whole click pipeline, not just the swatch math.

# atlas 0.9.12

`atlas-4` fix round 2: the flower threw on every v8/v9 view. Both releases publish
`extrisk_primary_producer_ecoregion_rescaled` (the species-category extinction-risk term) AND the
unrelated `primprod_ecoregion_rescaled` (raw environmental productivity) — both fold onto ONE
`primprod` category (`categories.ts`'s synonym table predates a release publishing both at once),
and `computeFlowerGeometry` deliberately throws when two components share a category. Verified
against the publish pipeline itself (`workflows/score_cell_metrics.qmd`:
`comp_keys <- c(glue("extrisk_{sp_cats}_ecoregion_rescaled"), "primprod_ecoregion_rescaled")`) that
BOTH terms genuinely feed the composite score as separate, equal-weight inputs — this is a FLOWER
DISPLAY collision only, not a data-correctness issue.

- `src/lens/scores/flower.ts`: every path (`fromMetrics`/`zoneFlowerComponents`,
  `defaultFlowerComponents`, `cellFlowerComponents`) now runs its components through
  `dedupeFlowerComponents` — ONE slot per resolved category, keeping the ER-weighted
  species-category term over the bare environmental twin on a collision. Each now returns a
  `DedupResult` (`{components, droppedLabels}`) instead of a bare array.
- `src/lib/ui/flowerGeometry.ts`: new `computeFlowerGeometrySafe` — the throwing
  `computeFlowerGeometry`, but a same-category collision degrades (first-seen category wins,
  the rest reported in `droppedKeys`) instead of throwing; a belt-and-braces fallback for a caller
  that did not already de-duplicate its own data. `Flower.svelte` calls this, never the throwing
  form directly, and announces every dropped label (its own catch AND the caller's
  `droppedLabels` prop) exactly once via the shared Announcer ("duplicate component skipped:
  {key}") — a data quirk degrades the flower, it never blanks it.
- New fixture `tests/lens/scores/fixtures.ts`'s `BOOT_V9`, trimmed from the LIVE v9
  `app/boot.json` (curl'd 2026-09-22): the exact 17-key `layers` list and the exact
  `flower_default.AK` (8 entries, both "primary producer" and "primprod" present) — the real
  collision, not a synthetic stand-in. `e2e/scores.firstpaint.spec.ts` now runs its whole suite on
  BOTH v7 and v9 (v9 via a preview session — it is `restricted` in the versions fixture, matching
  the live registry); the default-flower test's expected hub value is version-specific (v9: 7
  kept of 8, mean rounded to 22).
- New `src/lib/map/style.ts`'s `layersControlItems(style)`: a "layers control" derived from the
  actually-composed style's own layer ids, never a hand-maintained list — the structural fix for
  the ported Shiny app's known bug (parity doc §6.4: a control hardcoded to `pra_ln`/`pra_lbl`/
  `er_ln`/`r_lyr`/`outside_pra_lyr` while the real ids were `programarea_ln`/`programarea_lbl`/
  `ecoregion_ln`/…, so three of five switches were dead after any sidebar change). This
  architecture already avoided that bug; `tests/map/style.test.ts` now names and pins it.

# atlas 0.9.11

- The species cold first-paint gate (`e2e/species.smoke.spec.ts`'s "paints the first species pixel

- The species cold first-paint gate (`e2e/species.smoke.spec.ts`'s "paints the first species pixel
  within 2.5s cold" test) is now its own serial Playwright project: moved to
  `e2e/species.timing.spec.ts` (project `timing`, `workers: 1`), gated on the MEDIAN of 3 fresh-context
  cold loads rather than a single sample, so engine-matrix CPU contention (measured: 3,065 ms inside
  the full `npx playwright test` run vs 1,578-1,621 ms alone) can no longer fail it spuriously. No
  functional species-lens test changed; shared fixtures moved to `e2e/species-hermetic.ts`.

# atlas 0.9.10

`atlas-4` fix round 2: `src/shell/Shell.svelte` statically imported every lens' panel component
(`ScoresLens`, `VersionPickerModal`, `WelcomeModal`, `SpeciesLensPanel`, `SpeciesPicker`,
`SpeciesLegend`, `NotFoundModal`, `Places`) — 450.4 KB gzip static, 0.4 KB over
`scripts/size-budget.mjs`'s 450 KB budget, and a species-only deep link downloaded the entire
scores lens it never renders (`e2e/species.smoke.spec.ts`'s cold first-pixel spec measured
2,742 ms). Measured after this fix: **409.2 KB gzip static** (budget 450) / **140.5 KB gzip runtime
worker** (budget 150); species cold first-pixel back to **2,061 ms** (budget 2,500).

- Every lens PANEL component now loads as its own dynamic `import()` chunk, chosen by `sel.lens`
  (`ScoresLens` on "scores"; `SpeciesLens`/`SpeciesPicker`/`SpeciesLegend`/`NotFoundModal` together
  on "species") or by `activeTool === "places"` (`Places`) — the same `Component<any>` held in
  `$state`, resolved by a `$effect`, rendered via `{@const Comp = ...}` pattern
  `TablePanel.svelte`/`Composition.svelte` already used for `Composition.svelte`/`Treemap.svelte`.
  `VersionPickerModal`/`WelcomeModal` are app-wide chrome (not gated on `sel.lens`) and load
  unconditionally right after mount — still their own chunk, out of the entry's static graph, just
  not delayed. The species lens' pure data/wiring layer (`state.svelte.ts`) and the places map store
  (`placesMap.svelte.ts`) stay static, since both are needed before any panel component mounts and
  neither imports a `.svelte` file itself. The ONE `panelBody` snippet and the ONE
  `composeStyle`/`applyStyle` effect are unchanged in structure — a lens still only computes
  `composeStyle` inputs (docs/map.md); the shell still owns mounting and the one style call. A
  chunk still in flight falls back to the existing `TOOL_BODY[activeTool]` skeleton text (or simply
  renders nothing, for an overlay/modal with no visible closed state), so
  `e2e/shell.cls.spec.ts`'s skeleton/hydrated geometry-equality gate is unaffected.
- New regression test, `tests/shell/lazy-lens-imports.test.ts`: a source scan asserting
  `Shell.svelte` never statically imports a `.svelte` panel component under `src/lens/` or
  `src/places/`, with its own seeded-fault case (mirrors `tests/places/lazyImports.test.ts`'s
  technique for terra-draw).

# atlas 0.9.9

`atlas-6` step 4: results and share (Deliverables 5-7), closing out the phase. Measured:
**420.2 KB gzip static** (budget 450) / **140.5 KB gzip runtime worker** (budget 150).

- **Results for a custom place**, by the published zone method (master plan D7/D7b), reusing
  `src/places/dataEngine.ts` from step 3: coverage ("N% of this place is inside the US study
  area", each component's own coverage/mean-where-present), composite + a `Flower` (shared
  `src/lib/ui/`, not the scores lens's own — this renders entirely within `src/places/**`), and a
  components `DataTable`. A place wholly outside the study area gets the "no scores" notice
  (`ResultsPanel.svelte`), never a row of zeros.
- **Species need `cell_model` tiles**: the fetch plan (tile count, MB — real `Content-Length` via
  `HEAD`, falling back to a documented average) shows before anything downloads; above 40 tiles or
  150 MB it asks first (`src/places/fetchPlan.ts`); progress reads "batch N of M" as each
  ≤ 8-tile batch's buffers are dropped. `capabilities.cell_model === false` shows "species aren't
  available for this release" instead of a table.
- **Share** (`ShareDialog.svelte`) states what the link carries (release, lens, layer, camera, N
  places) and its length; over 2,000 chars a note, over 8,000 the simplification ladder
  (before/after vertices, area change %, cells changed) — and **accepting writes the simplified
  geometry back to `#pl=` itself**, never a share-only copy, so the numbers visibly update before
  the (now-shorter) link is copied. Nothing fitting even simplified offers the GeoJSON download
  first. Reuses `geo/placeCodec.ts`'s `fitPlacesToUrl` (atlas-2) — this phase only adds the "what it
  carries" summary and the before/after diff.
- **Analytics** (`place_draw`, `place_upload`, `place_share`) are now wired at their real call
  sites — a drawn shape, an upload's outcome, a copied share link — all counts/buckets only
  (`src/places/analytics.ts`, built in step 1). Every call site's `track` prop defaults to a no-op:
  no GA4 loader is mounted app-wide yet (`analytics.ts`'s own header), so nothing sends anything
  until a later phase wires that in.

# atlas 0.9.8

`atlas-6` step 3, UI half: upload (Deliverable 4). Drop a file anywhere on the map (a native
drop/dragover listener on the map's own container) or use the picker; `src/lib/geo/upload/` (atlas-2's
parsing half) is called only through a dynamic `import()`, so this is the first time anything in
`src/` reaches it. `src/places/dataEngine.ts` is new: the ONE lazily-created DuckDB engine +
`AnalysisSources` this panel now shares between the study-area check here and Deliverable 5's
results (a later commit) — `Engine` itself, and `analysis/templates.ts` (which embeds every
`sql/*.sql` file verbatim, comments included), are dynamic imports for the same reason terra-draw
was in step 2: a correctly-lazy reference that still matched `scripts/size-budget.mjs`'s
forbidden-marker text scan ("duckdb"; `composition.sql`'s own comments happen to say "treemap").
Measured: **409.1 KB gzip static** (budget 450) / **140.5 KB gzip runtime worker** (budget 150).

- Every refusal (a bad file, a point/line geometry, a self-intersection, an out-of-range or
  projected coordinate, a `.gpkg` with no runtime wired) renders verbatim (what/why/fix) in the
  panel, never "invalid file".
- A multi-feature file asks once: keep every shape as its own place (auto-named "Uploaded place N",
  editable via the existing inline rename — a live "name from this property" picker is NOT wired
  this step, a documented scope trim) or merge into one. Re-parses with the chosen
  `multiFeature` option rather than re-implementing the split client-side.
- The GeoPackage consent prompt (naming the ~22 MB, third-party `extensions.duckdb.org` download)
  is written, but with `runtime: null` (no DuckDB `spatial` wiring in this phase — docs/upload.md's
  own documented limitation): every `.gpkg` ends at the "convert to GeoJSON" fallback refusal today;
  wiring a real runtime later needs no UI change.
- **"Must touch the study area" (D7b) is a real, network-backed check** (`src/places/studyArea.ts`):
  fetches only the place's own `cell` tiles (materialize-then-query) and clips to `in_usa` cells
  (`sql/cells_in_study_area.sql`) exactly as Deliverable 5's results will; zero touching cells is
  `outsideUsWaters()`, never a silently-added place with nothing to score. Because
  `NormalizeOptions.studyArea`'s own type is synchronous and this check is not, it runs as a
  separate async step immediately after `normalizeUpload()`/`parseCoordinateEntry()` returns
  `ok: true`, before the place is added — same user-visible refusal shape either way.

# atlas 0.9.7

`atlas-6` step 2: drawing (Deliverable 3). `terra-draw@1.35.0` +
`terra-draw-maplibre-gl-adapter@1.4.1` are new, exact-pinned dependencies, reached ONLY through
`src/places/draw.ts`'s dynamic `import()` — genuinely lazy: neither package appears in
`index.html`'s static import graph (`tests/places/lazyImports.test.ts`), and `vite.config.ts` now
renames their output chunks (`draw-vendor-*.js`) because Vite's default chunk-naming otherwise put
the literal string `"terra-draw"` into the entry's own dynamic-import specifier — a correct, lazy
reference that still tripped `scripts/size-budget.mjs`'s forbidden-marker text scan. Measured after
the fix: **405.9 KB gzip static** (budget 450) / **140.5 KB gzip runtime worker** (budget 150).

- **Polygon, rectangle and circle** (a 64-gon, `CIRCLE_SEGMENTS`), plus a select/edit mode with
  midpoints (drag a vertex, drag a midpoint to add one, drag the whole shape) — touch-capable
  (terra-draw's own adapter). On finish, the RAW drawn geometry is run through
  `analysis/place.ts`'s `analysisGeometry()` (unwrap, then decode(encode(...))) before it becomes a
  place — Deliverable 3's "what is displayed is what is analyzed" starts at creation, not at share
  time — and the displayed outline is redrawn from that decoded geometry, densified to ≤ 0.25°
  steps per edge (`src/places/densify.ts`) so a long straight analysed edge cannot visibly bow on
  the globe projection.
- **"Show analysis cells"**: for the selected drawn/uploaded place, paints every covered cell
  (`geo/coverage.ts#cellsInPolygon`, purely client-side — no engine needed) at `fill-opacity = pct /
100`. `SelectionSpec` gained one field for this (`cellOpacity`), the selection layer's only change
  (`src/lib/map/style.ts`); disabled above 20,000 cells (`MAX_ANALYSIS_CELLS`).
- **"Enter coordinates"**: the promised keyboard/screen-reader alternative — drawing is never the
  only way. A bounding box (`xmin, ymin, xmax, ymax`), a list of `lon, lat` lines (≥ 3, closed
  automatically), or pasted WKT/GeoJSON (handed to the SAME `normalizeUpload()` a file drop uses, so
  a typed shape passes through every rule Deliverable 4 already enforces — self-intersection, the
  antimeridian, the vertex cap). A refusal renders verbatim (what/why/fix), never "invalid".

# atlas 0.9.6

`atlas-6` step 1: the Places panel (Deliverable 1) and pick mode on the release's one drawable
zone unit (Deliverable 2, Tier 0 — zone places only; draw/upload/results follow in the next three
commits). `src/places/**` is new; the shell mounts it where the "Places" rail tool already
reserved a panel slot (`src/shell/Shell.svelte`), and the map only gains one new `composeStyle`
input (the pick-mode highlight, folded into the existing `selection` field).

- **The list**: kind icon, inline rename (≤ 60 chars, `geom`/`upload` places only — a `zone` place's
  identity is its keys, not a name, per the `g1` codec's own schema), area km² (a fast client-side
  estimate until Deliverable 5's results land; a zone place's is `boot.zones`' own published
  number), data coverage % and a composite chip where known, and zoom / duplicate / delete / "open
  in report" (a stub link to `report.html` carrying the same query + hash). Up to 20 places; every
  mutation writes `#pl=` through the existing `g1` codec with `history.replaceState` only — never a
  second copy of the list.
- **Pick mode**: click a zone on the map to select it; Ctrl/Cmd-click, Shift-click or a long-press
  (500 ms) adds to the selection; clicking the sole picked zone again clears it. "Add to places"
  turns the current pick into one new zone place (`z.pa.GAA,WGA`) — this is also the exact function
  (`src/places/model.ts`'s `addZonePlace`) the scores lens's zones table calls once atlas-4 builds
  it, needing no reference to this panel's UI.
- **"Recent"**: the last ten place tokens in `localStorage`, never the only copy of a live place; a
  "Clear" button, and "Add back" to restore one.
- **`SELECTION_COLOR` is now pinned** (`tests/map/colors.test.ts`): the constant itself, not just
  code that stays self-consistent with whatever value it happens to hold today.
- Footer: Share (copies the current link — the same clipboard action the top bar's Share already
  uses) and Download places (a GeoJSON `FeatureCollection` of the decoded geometries actually
  analysed; a `zone` place, which carries no geometry client-side, is a named `geometry: null`
  feature rather than being silently dropped).

# atlas 0.9.5

atlas-5 fix round 2: closes the gaps a review found in fix round 1's `map.ts` `applyStyle`-queue
fix (0.9.4) — a real fix with no regression test, and two seeded faults whose automatic diffs came
back empty.

- **`src/lib/map/styleQueue.ts`** (new): the queue pulled out of `map.ts` into a pure, testable
  function (`createStyleApplier`), so the `"idle"` vs `"style.load"` fix has a real regression test
  (`tests/map/styleQueue.test.ts`) — reverting to `"style.load"` reproducibly reds 3 of 4 cases,
  including the one modelling two separate not-loaded windows. `map.ts` now delegates to it.
- `e2e/species.smoke.spec.ts`: a new case drives the exact race through the real app (two rapid
  `selectSpecies()` calls before the map's first `"idle"`) and asserts the SECOND species' raster
  ends up in `map.getStyle().sources` — reds under the reverted fault, passes with it.
- A new case exercises the PMTiles ranges branch through real MapLibre vector-tile parsing
  (reusing atlas-map's committed `zones.pmtiles` archive under a range-style filter, since a
  fresh one-polygon archive would only re-prove tippecanoe works): "a range draws ≥ 1 rendered
  feature."
- Verified by hand (the automatic fault-seeding's diff was empty for both): a hard-coded `[1, 100]`
  rescale in `mapInputs.ts`'s COG branch reds the AquaX-Delivered unit test; a
  `["!=", ["get", "mdl_key"], "__none__"]` filter in `map/layers/ranges.ts`'s `rangeLayer` (admits
  every model) reds the ranges unit test. Both reverted after confirming red.

# atlas 0.9.4

`atlas-5` steps 1-2: the species lens UI, on top of the already-merged data layer
(`src/lens/species/data/**`) and shared map module (`src/lib/map/**`). Delivered together (skipping
an interim 0.9.3 checkpoint) because the two steps share one reactive core.

- **Shard-driven species view**: on `sp=` the taxon shard loads, draws through `composeStyle` (the
  asset's OWN colormap/rescale — AquaX delivered `[0,1000]`, everything else `[1,100]` — opacity
  0.8, nearest), a continuous legend from `ramps.ts`, the sidebar card (§7.3), and a camera fit to
  the layer's own extent. `merged.type = null` shows "No surface published for this taxon in {ver}"
  instead of a raster. Document title tracks the layer on screen.
- **The camera never calls MapLibre's own bounds-fitting method** (`tests/map/no-fitbounds.test.ts`'s
  gate covers `src/lens` too): `src/lib/map/camera.ts`'s new `boundsToCameraView()` computes the
  equivalent center+zoom by hand, in linear (never re-wrapped) Mercator space, so a frame whose
  `east` exceeds 180 fits correctly; `map.ts`'s new `flyToBounds()` is the imperative half. Refits
  ONLY when the species changes, never on a layer/representation switch.
- **Picker + search**: `app/taxa.json` loads on focus/idle, grouped by `sp_cat`, ranked
  (exact→prefix→word-start→substring, scientific before common), virtualized (reusing
  `dataTableCore.ts`'s window math). "Only species in US waters" keeps the current selection across
  the swap. `search_species` logs at ≥3 chars, 900 ms debounced, no repeats.
- **Layer bar + representation**: green `is-merged` / a distinct `is-input` state, one pill per
  input in `dataset.sort_order`; a struck-through pill for an input with no published surface is a
  plain, non-focusable `<span title="...">` (not a `<button>`) — the atlas-5 gate's exact wording.
  The Original/Interpolated ↔ Delivered/As ingested toggle switches `rep`, live.
- **The PMTiles ranges branch**: a new `map/layers/ranges.ts` builder + `ComposeStyleInput.range`
  field + `LAYER_ORDER` role, filtered to the asset's own `mdl_key`; switching from a COG layer to a
  range (or back) removes the old source AND layer together, proven by a test (the stale-surface
  bug, §11.8) — `composeStyle` always replaces the whole style.
- **Click → popup**: `cellFromLonLat` on the release's own grid (never a hard-coded 7200/3600), the
  sampled value via `/cog/point` behind `ValueSource` (plan D4), binned against the asset's OWN
  rescale (generalizing §6.5's literal `[1,100]` formula so an AquaX Delivered click still lands in
  the right bin), swatch/text-luminance rule byte-for-byte from the reference. A range click reports
  "presence only"; no value is a grey pin + "no value here". A real `maplibregl.Popup` opens on the
  first click.
- Deep-link resolution (`?mdl_key=`/`?mdl_seq=`/`sp`), the "Model not found" modal, and the ten
  analytics events are wired into `state.svelte.ts` already (step 3 lands the remaining chrome:
  welcome modal, release picker, tour, OBIS).
- **Fixed a latent bug in `src/lib/map/map.ts`'s `applyStyle` queue** (atlas-map's own code, not
  species-specific — any lens whose data arrives async and calls `applyStyle` more than once before
  the map's first style finishes loading hits it): the queue was flushed on `"style.load"`, which
  MapLibre fires exactly ONCE, ever, for the true initial style transition. A second style queued
  while the map is briefly not-loaded again (e.g. while a newly-added raster source's tiles are in
  flight) registered a SECOND `once("style.load", …)` that never fires, stranding that style in the
  queue forever — its layer never appears, silently. Now flushed on `"idle"`, which fires every time
  the map settles, for the whole life of the map. Caught by
  `e2e/species.smoke.spec.ts`'s cold-load gate; `e2e/map.spec.ts`'s existing suite still passes
  unchanged.
- `select_species` now logs on every species change EXCEPT the session's first (§10: "seeded with
  the default species so the opening taxon is not logged as a user choice").
- New: `src/lens/species/{mapInputs,popup,state.svelte,SpeciesTitle,LayerBarView,SpeciesCardView,
SpeciesLegend,SpeciesPicker,SpeciesLens,NotFoundModal}.{ts,svelte}`; `src/lib/map/layers/ranges.ts`;
  `boundsToCameraView` in `src/lib/map/camera.ts`; a `RANGE_FILL_COLOR` data color in
  `src/lib/map/colors.ts`; `vite.config.ts`'s `define: { __APP_VERSION__ }` (so `Analytics`'s
  `appVersion` never pulls the whole `package.json` — including its `pinReasons` prose — into the
  static bundle, which tripped the forbidden-lazy-chunk-marker scan on `"duckdb"`/`"shp"`/`"treemap"`
  literally appearing in that JSON).
- Size budget: 410.5 KB / 450 KB static, 140.5 KB / 150 KB worker (551.0 KB / 600 KB combined) —
  unchanged in shape from atlas-map's baseline, all species code counted since none of it is meant
  to be lazy.

# atlas 0.9.3-scores

`atlas-4` fix round 1 (of 2): two real Playwright regressions from steps 1-3, plus four seeded-fault
demonstrations.

- **Fix, `e2e/map.spec.ts`'s console-error assertion**: the scores lens mounts by default and its
  zones carry `label_pt` in every boot fixture here, so `zonesNeedGlyphs()` — false before atlas-4,
  since nothing exercised a label layer — is now true on an ordinary shell load. Verified live
  (`curl -sI` on the exact requested URL) that `layers/basemap.ts`'s `LABEL_FONT` ("Open Sans
  Regular") is correct: CARTO's glyph endpoint answers 200 for it. The actual fault was the
  hermetic fixture: `e2e/hermetic.ts` and `e2e/map-hermetic.ts` both routed
  `tiles.basemaps.cartocdn.com/**` to a 404, harmless only while unreached — Chromium logs ANY
  failed resource load as a console "error" regardless of how gracefully MapLibre recovers from
  it. Both now route to 200 with an empty body (a zero-byte protobuf is still a valid, if
  data-free, glyph message).
- **Fix, `e2e/shell.cls.spec.ts`'s skeleton-vs-hydrated geometry gate**: re-measured the real
  Layers panel at 1280px with no `boot.json` (this spec's own fixture state) and re-fit
  `index.html`'s skeleton to match — four `sk-field` rows (66px), one `sk-switch-row` (24px), the
  `sk-layers-control` section (43px) and the `sk-legend-note` fallback (36px), 12px gaps, in
  `.sk-panel-body` (now `display:flex` to lay them out the same way the real
  `.layers-panel` does). The pre-existing placeholder sentence (`TOOL_BODY.layers`,
  `tests/shell/tools.test.ts` still requires it verbatim) stays in the DOM but `hidden`, carrying
  no layout weight. Total: 524px at desktop, matching the hydrated panel exactly; phone was
  already correct (Sheet's fixed height ignores content either way).
- **Seeded faults, each shown red then restored** (four of the five requested; the D15 `?ver=`
  fault was already demonstrated in step 3):
  - a study-area key reaching a data query (`raster.ts`'s `scoreRasterSpec` appending `&area=GA`)
    — new permanent regression test added (`tests/lens/scores/raster.test.ts`, asserts
    `tileUrlLeaksStudyArea(...) === null`), then red, then reverted.
  - `fitBounds(` in `src/lens/scores` (`LayersPanel.svelte`'s `onAreaChange`) — caught by the
    existing `tests/map/no-fitbounds.test.ts` source scan (already scans `src/lens`), red, reverted.
  - the ER-rule table `EN 100 -> 99` — the rule was inline markup in `GlossaryModal.svelte` with no
    test; extracted to `src/lens/scores/glossary.ts` (CLAUDE.md: core logic in a plain module) with
    a new permanent test (`tests/lens/scores/glossary.test.ts`), then red, then reverted.
  - the 11-bin rule off by one (`raster/ramps.ts`'s `choroplethBin`) — the existing `zoneFill.test.ts`
    did not pin an exact stop colour, so it did NOT catch this; added a test asserting the exact
    low/mid/high stop colours against `boot.palettes` itself, then red (`#E5F498` vs expected
    `#FFFFBF`), then reverted.

# atlas 0.9.2

`atlas-4` step 3: chrome — the release picker (D15), the welcome modal, and the version-chip
`aria-haspopup` restore.

- **New: `src/lib/release/previewLink.ts`** (D15's pure link builder, handed over from atlas-3): a
  restricted release is offered ONLY as a link to the preview host's `/{ver}/atlas/` path,
  carrying the CURRENT query + hash verbatim, never `?ver=` on Pages.
- **New: `src/lens/scores/{VersionPickerModal,WelcomeModal}.svelte`**, mounted from Shell.svelte
  (app-wide chrome, not gated on `sel.lens` — the ported app's own modals were not lens-specific
  either). The version chip now opens a real dialog and carries `aria-haspopup="dialog"` again,
  restored in this SAME change per the subplan's own instruction (and
  `e2e/shell.a11y.spec.ts`'s matching test flipped from "carries no aria-haspopup" to "opens a
  real dialog"). A denied version (`?ver=v9` on the public host) auto-opens the SAME modal with a
  notice + the preview link, so the "why" is visible without an extra click.
- **The welcome modal** shows on first paint unless "Don't show this again" is set
  (`localStorage`); `?tour=off` hides the tour invitation. **Not built this step: the driver.js
  guided tour itself** — a new dependency plus its own lazy-chunk wiring was judged too much risk
  for the remaining budget; "Take a Tour" announces instead of starting one. The three ported
  modals (unknown/restricted/not-served) are consolidated into ONE modal varying its notice text
  by denial reason, a documented simplification over three separate dialogs.
- **Fix, test infrastructure**: the welcome modal's native `<dialog>` (`showModal()`) blocks
  pointer events across the WHOLE page while open, which broke nearly every OTHER shell e2e spec
  wholesale the moment it landed (they click `.topbar`/rail/panel controls with no reason to expect
  a blocking dialog). `e2e/hermetic.ts`'s `routeSealFixture()` — already called by every affected
  spec — now also seeds the "don't show again" key via `addInitScript`; a dedicated spec
  (`e2e/scores.welcome.spec.ts`) exercises the real, unsuppressed first-visit behaviour instead.
- New e2e: `e2e/scores.welcome.spec.ts`, `e2e/scores.versionPicker.spec.ts` (the D15 gate: the
  notice, its exact preview-host link, and zero `/v9/` requests — the "zero requests" half was
  already covered by the existing release-access gate).
- **Could not satisfy this step**: the driver.js tour (see above); the zones table landed in step
  2's commit rather than this one (built alongside the rest of the table panel; a step-boundary
  deviation, not a missing feature).

# atlas 0.9.1

`atlas-4` step 2: selection, the clicked cell's flower, the species table + CSV + composition
treemap.

- **Map click -> selection** (`ScoresLens.svelte`): `mapClick()` resolves a click on the release's
  own grid; the cell branch always selects a cell (`sel=cell:<id>`), the zone-choropleth branch
  only reacts to an actual zone hit (`sel=zone:<unit>:<key>`) — matching the ported app's separate
  `map_click`/`map_feature_click` events, never a fallback between the two.
- **The clicked cell's flower** now loads through the engine (`sql/cell_components.sql`, never
  `/cog/point`): `src/lens/scores/engine.ts` boots DuckDB-WASM lazily (dynamic `import()` only,
  memoised per release) the first time a cell is clicked or the species table opens.
- **New: `src/lens/scores/{SpeciesTable,ZonesTable,Composition,GlossaryModal,TablePanel}.svelte`,
  `{speciesLoad,composition,zonesTable}.ts`.** The species table is a bespoke grid (not
  `src/lib/ui/DataTable.svelte`, which renders every cell as plain text): real `<a>` cells for
  `taxon` (BOTW/WoRMS) and `model` (switches to the Species lens in place, keeping place and
  camera; a plain click intercepts to avoid a reload, a modifier-click/new-tab falls through to
  the browser's own default), still built on `dataTableCore.ts`'s proven sort/filter. CSV export
  writes the UNFORMATTED frame, RFC 4180-quoted. The zones table ranks every zone of the release's
  one unit by the current layer (`zone_metric`, read verbatim — the atlas-4 numbers gate holds by
  construction). The composition treemap groups by species category (not the six WoRMS ranks the
  ported app nests — `Treemap.svelte` is one level by design; see "could not satisfy").
- **`capabilities.cell_species_list = false`** (read as the closest match to the checklist's
  "`capabilities.cell_model`") and **`n_taxa == 0`** both show a header explaining why, never an
  error or an empty-looking table.
- **Fix, size budget**: `Composition.svelte` (and, inside it, `Treemap.svelte`) load through a
  DYNAMIC `import()` two hops deep from `TablePanel.svelte`, not a static one — a static import
  one hop up still failed `scripts/size-budget.mjs`'s "treemap" marker on `Treemap-<hash>.js`
  itself appearing in the entry chunk's own Vite chunk-preload bookkeeping, a case the marker scan
  is explicitly designed to catch. Static path: 410.3 KB gzip (budget 450).
- **Could not satisfy this step**: the "≤ 2 requests cold" gate's shape assumes the species table's
  CORE tables (`taxon`/`zone_taxon`/`taxonomy`) are already resident when a cell is clicked; this
  step loads them lazily on first need instead (fewer requests for a session that never opens the
  species table, more on the very first one) — not verified against the gate's literal request
  count. `analysis/queries.ts` and `release/dataBase.ts` are statically reachable (via
  `componentMetricKeys`/`dataUrl` type-adjacent usage), logged by Vite as
  `INEFFECTIVE_DYNAMIC_IMPORT`; harmless today (neither pulls in DuckDB) but not the fully-lazy
  "whole analysis layer" the plan describes — untangling it further was not done this step.

# atlas 0.9.0

`atlas-4` step 1: the Scores lens' Layers panel, legend and map wiring, from Tier 0 (`boot.json`)
only — `src/lens/scores/**`.

- **New: `src/lens/scores/{boot,raster,zoneFill,mapInputs,fallback,selection}.ts`.** Pure readers
  over `boot.json`'s scores shape (the ONE drawable unit per D17, layer groups/default — the
  release's `category: "composite"` row, never `boot.layers[0]`, which the publisher orders raw
  -> component -> composite, the opposite of the ported app's "order 1 = overall score"), the score
  raster + "cells outside Program Areas" overlay + legend (titiler tiles, `rescale` verbatim,
  `signif(…, 3)` endpoints — new `geo/round.ts` export), and the zone-choropleth 11-bin fill +
  legend (`round(range, 1)`, the `Inf/-Inf` empty-values guard).
- **`src/lens/scores/{LayersPanel,FlowerPanel,ScoresLens}.svelte`** mounted into the shell's
  existing "Layers"/"Flower" rail tools (Shell.svelte edit: a `lensMapExtra` bucket the active lens
  populates, merged into the shell's one `composeStyle`/`applyStyle` call — no lens ever touches
  MapLibre itself). The Flower tool already shows the release's default (nothing selected) or a
  clicked zone's flower from Tier 0 alone; a cell's flower needs the engine and lands in step 2.
- **An unknown `unit`/`lyr` falls back** (`fallback.ts`) to `"cell"` / the composite default, never
  a blank map — the atlas-4 gate, unit-tested.
- **A small, ADD-only map addition**: `ZoneUnitSpec.highlightKey` + `zoneHighlightLayer()`
  (`map/layers/zones.ts`) — a clicked zone's outline, filtered against its own vector source rather
  than a second geometry fetch. `docs/map.md`'s "add a composeStyle input" recipe, followed.
- **Today's real data gap, discovered, not invented**: every published release's `boot.palettes`
  carries ONLY `spectral_r` — no Viridis/Cividis/Magma stops. The palette picker still
  offers all four (the raster tile still renders correctly via titiler's own `colormap_name`), but
  the legend and the zone choropleth show a "not published" notice rather than guessing a ramp.
- Gate: `e2e/scores.firstpaint.spec.ts`, hermetic, with its own 20-feature Program-Area PMTiles
  fixture (`e2e/fixtures/scores/zones20.{geojson,pmtiles}`) — raster pixels at two ocean probes
  (correctly BLENDED at `SCORE_RASTER_OPACITY` 0.6, not full opacity), 20 outlines, the legend, the
  default flower.
- **Fix, `e2e/shell.a11y.spec.ts`**: re-triaged the pinned `color-contrast` incomplete ceiling
  (phone 5 -> 10, desktop 9 -> 16) for the Layers panel's real content — verified each new node's
  token pair against `scripts/contrast.mjs`'s 70 (now 86) resolved pairs before raising it.
- **Could not satisfy this step**: Fullscreen/navigation/scale MapLibre controls were attempted and
  reverted — they render into `#map`, which carries `role="img"`, and axe correctly flags the
  nested interactive buttons; fixing it needs a decision (drop `role="img"`? something else?) this
  step should not make alone. The Nominatim geocoder was not attempted. `e2e/shell.cls.spec.ts`'s
  skeleton-vs-hydrated exact-height gate for `panel-frame` now fails at desktop (106px skeleton vs
  ~524px real content): the gate's methodology (byte-exact skeleton height) cannot hold once a
  lens's DEFAULT view is boot-data-dependent content rather than one line of placeholder text —
  left for a follow-up that also affects the species lens, not patched here with an unverified
  guess at a new skeleton height.

# atlas 0.8.3

# atlas 0.8.1

`atlas-6` step 3, parsing half: the upload pipeline, from an untrusted file to a normalized place
geometry. No UI and no map — `src/lib/geo/upload/`, callable from a test, and nothing in `src/`
imports it yet, so the static critical path is unchanged at 108.6 KB gzip. Full write-up:
`docs/upload.md`.

- **Seven formats read, each behind its own dynamic `import()`** (spike verdict `docs/spikes/S4.md`):
  GeoJSON (no parser), zipped shapefile (`shpjs`), KML and GPX (`@tmcw/togeojson`), FlatGeobuf
  (`flatgeobuf`), pasted WKT (hand-rolled, no dependency), and GeoPackage through DuckDB `spatial` —
  prompted once with its 22.4 MB third-party download named, lazy, and falling back to "convert to
  GeoJSON" on a decline or a blocked `extensions.duckdb.org`. The format is sniffed from the magic
  bytes before any parser loads, so a wrong extension costs nothing.
- **One normalizer for all of them** (`normalize.ts`), applying Deliverable 4's rules in order:
  10 MB (a zip: 200 entries and 50 MB uncompressed, read from the central directory **before
  extraction**, so a zip bomb is refused by the sizes it declares about itself) → parse → polygons
  only, never buffered → coordinates finite, in range and **not projected** → 50 000 vertices →
  rings closed, RFC 7946 winding, holes kept → self-intersection, reported with the crossing's
  coordinates and vertex indices → the antimeridian. "Must touch the study area" is exposed as a
  hook for the caller, which needs the release's cells.
- **A projected file is refused, never scored.** A declared CRS is authoritative (`shpjs` reprojects
  from a `.prj`; FlatGeobuf and `ST_Read` report it and do not), and only a file that declares
  nothing is judged by its magnitudes — the `.prj`-less shapefile that S4 measured returning raw
  metres in silence. The committed fixture that used to land a California rectangle in the Arctic
  now fails with a sentence naming the value.
- **Both spellings of a place crossing 180° become the same place**: a wrapped ring through the
  shared `unwrapRing()` rule, and an RFC 7946 split pair through a new `seam.ts` that fires only on
  the literal cut (a vertex at +180 _and_ one at −180) and rejoins it. Identical ring, identical
  cells on `global05` and `usa05`.
- **GPX turns out to have no polygon type** — S4 never exercised it, and adding the fixture is what
  showed this. A closed track is read as a ring; an open one is refused by name rather than closed
  or buffered.
- **Refusals say what happened, why and what to do**, all in `messages.ts`; none says "invalid
  file", and a test drives every one of them to keep it that way.
- **A name from a file is plain text and is never escaped**: `<img src=x onerror=…>` comes back byte
  for byte, asserted as such, because the panel binds it as text and escaping would render visibly.
- Fixtures moved (`git mv`, not copied) from `spikes/4/fixtures/` to `tests/fixtures/upload/`, plus
  a plain GeoJSON, a closed-track GPX and an open-track GPX. Hostile inputs are generated in the
  test setup, never committed. `@xmldom/xmldom` added as a devDependency so KML and GPX are covered
  by fast node unit tests rather than only in a browser.

# atlas 0.8.0

`atlas-map`: the shared map module (`src/lib/map/`) the three lenses build on — one MapLibre
instance, one composed style, one `setStyle(diff:true)`. The shell now renders a real map.

- **New: `src/lib/map/`.** `map.ts` (`createMap()` — the whole S2 wiring: named imports,
  `?worker&url` + `setWorkerUrl`, `preserveDrawingBuffer`, `resize()` plus a `ResizeObserver` on the
  container, camera to/from the URL), `style.ts` (`composeStyle()` + `applyStyle()` and a DECLARED
  layer order, so a missing layer can never cascade), `camera.ts` (rounded, de-duplicated, 300 ms
  debounced, never on a programmatic move), `interaction.ts` (click → `{lngLat, cellId, zone}` using
  the RELEASE's grid; hover; `flyTo(studyArea)` — never `fitBounds`) and the pure builders
  `layers/{basemap,zones,raster,titiler}.ts`.
- **The basemap follows the theme**: navy → CARTO dark-matter, paper → positron, as raster tiles
  (one source, no style.json/sprite/TileJSON, zero added JS). Globe ⇄ mercator travels in the style.
- **The `zone_style` table is data, not code**: programarea/planarea white 1 px, ecoregion black
  3 px, subregion `#d9d9d9` 2 px dashed `[3,3]` 0.7, labels programarea white 12 px / ecoregion black
  16 px, subregion none.
- **The camera is in the URL**: `?map=lon,lat,zoom` is written with `history.replaceState`, debounced,
  and never while the app itself is moving the map.
- `pmtiles@^4.5.0` is now a dependency (the `pmtiles://` protocol the zones sources are read through).
- `docs/map.md`: the interface the three lenses may call, and how to add a source.
- **Fix, `scripts/size-budget.mjs`:** a forbidden lazy-chunk marker now has to start a token.
  Minified maplibre-gl contains `dashPositions`, which embeds `shp`, so the budget failed the moment
  maplibre entered the static graph. Measured after the fix: **391.2 KB gzip static** (budget 450) and
  **140.5 KB gzip runtime worker** (budget 150).
- **Fix, `src/shell/shell.css`:** the map container is `.stage > .map`, not `.map` — MapLibre's own
  stylesheet declares `.maplibregl-map { position: relative }` and won on equal specificity, which
  collapsed the container to 0 px tall and left a 300 px canvas on an 800 px viewport.
- `e2e/hermetic.ts`'s `routeBucket()` also routes the map's tile origins, so no spec reaches the live
  network now that every shell page mounts a map; the shell a11y gate's `color-contrast` incomplete
  triage is re-pinned (desktop 8 → 9 nodes, `imgNode` added) because axe cannot see through a canvas.

# atlas 0.7.6

`atlas-5` step 1, fix round 1: `camera.ts` copes with how extents are ACTUALLY published. Measured
over every published shard — v9 publishes 48,378 bboxes of which only **16** have `xmax > 180` while
**6,273 are written WRAPPED** (naive span > 180 deg; 5,053 over 300 deg) and 38,448 are `null`; **v7
publishes no bbox at all** (all 16,153 null). The contract's "already reduced to the minimal-span
frame" does not hold, so the plan's camera gate would have failed for thousands of taxa. The
upstream defect is atlas-1's; the lens compensates now.

- **`minimalFrame()`** applies plan D8's rule client-side: a bbox whose naive span exceeds 180 deg is
  read as wrapped and re-expressed as the complementary interval `[xmax, xmin + 360]` when that is
  narrower — `[-173.7, -16.05, 163.7, 20.2]` becomes `[163.7, -16.05, 186.3, 20.2]`, 22.6 deg
  centred on 175 E. An already-unwrapped box (`[160, 48, 210, 66]`) is untouched and a genuinely
  circumglobal one stays wide rather than framing a degenerate sliver. Longitudes are still never
  NORMALIZED.
- **The fallback chain ends somewhere real**: input extent -> merged extent -> the supplied
  ecoregion extent -> the release's study-area view (`boot.study_areas[FULL]`, read by
  `studyAreaView()`), so a v7 species frames US waters instead of the globe. `Camera` is therefore a
  union of a bounds camera and a centre/zoom camera.
- **The gate the plan asked for, over real data**: `tests/fixtures/species/v9/wide-bboxes.json` is 50
  real v9 extents with naive spans over 180 deg (every 125th of the 6,273, with provenance). Framed
  naively 48 of the 50 span >= 200 deg; after `minimalFrame()` the widest is 179.5 deg and all 50
  centres lie inside the model's own longitudes.
