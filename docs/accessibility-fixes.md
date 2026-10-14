# Accessibility fix list — atlas-8 step 3

> **Status in OceanMetrics Atlas (WP11, 2026-10-14).** The audit behind this list ran on the MarineSensitivity Atlas shell (Scores lens, Report, gallery, version chip). Findings about shared controls (rail, panel, sheet, menus, dialogs, popups) still describe code that remains; anything about the Scores lens, the Report, the component gallery or the version chip no longer applies, and the specs it cites (`e2e/matrix.a11y.spec.ts`, `e2e/keyboard-walk.spec.ts`, the gallery sweep) were removed in the 0.1.0 strip.

Found by the axe sweep over every `scripts/verify.mjs` matrix state (`e2e/matrix.a11y.spec.ts`,
179 audits), the scripted no-pointer keyboard walk on all three engines
(`e2e/keyboard-walk.spec.ts`), and a read of the real accessibility tree
(`ariaSnapshot()`) for every region of the shell, the report and the gallery.

**Status as of the fix round (0.10.18): all 14 items below are fixed.** Every `test.fixme` this
file's own round committed is now a real, passing assertion; items #8-14 (which had none before)
each have a new test. "Fixed" means the named test goes green with the fix in place and RED when
the fix (or, for #1, the new seeded fault `tests/faults/modal-esc-delegated.patch`) is reverted —
not that the code merely looks different.

Severity: **serious** = a keyboard or screen-reader user cannot complete a task, or is silently
dropped somewhere with no way back. **moderate** = the task is completable but the semantics are
wrong or missing, so the experience is materially worse than a sighted mouse user's.

| #   | SC                                         | Where                                                                     | Severity | Gate                                                                                                             |
| --- | ------------------------------------------ | ------------------------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------- |
| 0   | — (broken gate)                            | `scripts/verify.mjs:35,140`                                               | fixed    | `e2e/matrix.a11y.spec.ts`                                                                                        |
| 1   | 2.4.3 Focus Order (A)                      | `src/lib/ui/Modal.svelte`                                                 | serious  | **fixed** — `keyboard-walk.spec.ts` "A11Y-1: …"; seeded fault `tests/faults/modal-esc-delegated.patch`           |
| 2   | 2.4.3 Focus Order (A)                      | `src/lib/ui/Modal.svelte`                                                 | serious  | **fixed** — `keyboard-walk.spec.ts` "A11Y-2: …"                                                                  |
| 3   | 2.4.7 Focus Visible (AA)                   | `src/places/UploadPanel.svelte`                                           | serious  | **fixed** — `keyboard-walk.spec.ts` "A11Y-3: …"                                                                  |
| 4   | 4.1.3 Status Messages (AA)                 | `src/report/Report.svelte`                                                | serious  | **fixed** — `keyboard-walk.spec.ts` "A11Y-4: …"                                                                  |
| 5   | 2.4.3 Focus Order (A)                      | `src/shell/Shell.svelte` (WebKit only)                                    | serious  | **fixed** — `keyboard-walk.spec.ts` "activating a rail tool leaves focus on that tool"                           |
| 6   | 2.4.1 Bypass Blocks (A)                    | `src/shell/Shell.svelte`, `index.html` (Firefox only)                     | serious  | **fixed** — `keyboard-walk.spec.ts` "'Skip to the tools' lands the caret on the tool rail"                       |
| 7   | 4.1.2 Name, Role, Value (A)                | `src/lib/ui/Panel.svelte`                                                 | serious  | **fixed** — `keyboard-walk.spec.ts` "the panel body is a named region…"; `gallery.spec.ts`                       |
| 8   | 4.1.2 (A) + 1.3.1 (A)                      | `src/lens/species/SpeciesPicker.svelte`                                   | serious  | **fixed** — `species.smoke.spec.ts` "fix list #8: …" (3 tests, 3 engines)                                        |
| 9   | 1.1.1 Non-text Content (A)                 | `src/shell/Shell.svelte`                                                  | moderate | **fixed** — `keyboard-walk.spec.ts` "the map points at its own text equivalent"                                  |
| 10  | 1.3.1 Info and Relationships (A)           | `src/lens/scores/LayersPanel.svelte`                                      | moderate | **fixed** — `keyboard-walk.spec.ts` "no second region landmark nested inside…"                                   |
| 11  | 1.3.1 (A) + 2.4.6 Headings and Labels (AA) | `src/lib/ui/Legend.svelte`, `ScoresLegend.svelte`, `SpeciesLegend.svelte` | moderate | **fixed** — `keyboard-walk.spec.ts` "the floating legend is reachable as a landmark"                             |
| 12  | 4.1.3 Status Messages (AA)                 | `src/lib/map/popup.ts` + both lenses' click handlers                      | moderate | **fixed** — `scores.popup.spec.ts` / `species-popup.spec.ts` "…is also announced through the shared live region" |
| 13  | 4.1.2 Name, Role, Value (A)                | `src/report/Report.svelte`                                                | moderate | **fixed** — `report.spec.ts` "the flower tabs are a real tab widget…"                                            |
| 14  | 3.3.1-adjacent (robustness)                | `index.html`, `src/main.ts`                                               | moderate | **fixed** — `shell.smoke.spec.ts` "index.html reveals a visible role=alert message…"                             |

---

## 0. `scripts/verify.mjs` imported an export that no longer exists — **fixed in this change**

- **SC:** none (a broken gate, not a defect in the app).
- **Where:** `scripts/verify.mjs:35` (`routeBasemapTiles` in the import list) and `:140` (the call).
- **What a user experiences:** nothing — but nobody could see whether they did. The 2026-09-23
  basemap round replaced `routeBasemapTiles` (the keyed raster basemap) with `routeBasemapStyle`
  (CARTO's vector `style.json` chain) and deleted the old export. `scripts/verify.mjs` kept
  importing it by name. A named import of a missing export from a `.ts` module resolved through
  this script's bundler hook is `undefined`, not a load error, so nothing complained until a state
  actually ran — and then **every one of the 41 scores-lens states threw
  `TypeError: routeBasemapTiles is not a function` before its first assertion**. `npm run verify`
  has been structurally unable to check the scores lens since `6a7d88b`.
- **The fix:** import and call `routeBasemapStyle` instead (2 lines).
- **Why it was fixed here:** it blocked step 3's first deliverable (axe on every matrix state)
  entirely, and it is under ten lines.

## 1. Esc in a modal also collapses the panel behind it and takes the caret with it

- **SC:** 2.4.3 Focus Order (A); also 3.2.x (an unrequested change of context).
- **Where:** `src/lib/ui/Modal.svelte:69` — `onkeydown={handleDialogKeydown}` in the template.
- **What a user experiences:** open "Enter coordinates" from the Places panel, change your mind,
  press Esc. The dialog closes (correct) **and the whole Places panel collapses to a pill**, and
  focus lands on that pill instead of on the "Enter coordinates" button you came from. Everything
  you were working in is gone and you have to re-expand it. Measured on chromium:
  `document.activeElement` after Esc is
  `<button class="pill panel-pill" aria-expanded="false">Places</button>`.
- **Cause:** Svelte 5 **delegates** `keydown` to the app root. `Panel.svelte` attaches its
  Esc-collapses-me handler **imperatively** on its own `rootEl` (`Panel.svelte:50`), so during the
  real bubble phase Panel's listener runs _first_, collapses, and only afterwards does Modal's
  delegated `stopPropagation()` run — too late to stop anything. Panel's `!event.defaultPrevented`
  guard cannot help either: at the moment it checks, nothing has called `preventDefault()` yet.
- **The fix:** attach Modal's keydown the way `Popover.svelte:51-60` already does — imperatively,
  on the dialog element, in `onMount` — and `preventDefault()` as well as `stopPropagation()`.
  Popover's own header comment (`Popover.svelte:37-42`) states this exact reasoning; Modal is the
  one layer that did not follow it. ~8 lines.
- **Status:** ✅ Fixed. keyboard-walk.spec.ts "A11Y-1: Esc in the coordinate dialog returns focus to the opener, not the panel pill" -- REVERTED (this fix alone, tests/faults/modal-esc-delegated.patch) -> RED.
- **Severity:** serious.

## 2. Tab escapes an open modal when its last control is disabled

- **SC:** 2.4.3 Focus Order (A).
- **Where:** `src/lib/ui/Modal.svelte:32-33` — `FOCUSABLE_SELECTOR` is a bare
  `"button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])"`, with no
  `:not(:disabled)` and no visibility filter.
- **What a user experiences:** open "Enter coordinates" (its "Add place" button is disabled until
  you type something) and press Tab twice: Close → textarea → **`<body>`**. A screen reader
  announces nothing; the next Tab starts the cycle over. Measured on chromium, empty dialog:
  `Close → textarea → BODY → Close → …`; with text typed (Add place enabled) the cycle is correct:
  `textarea → Add place → Close → textarea`.
- **Cause:** the trap fires only when `document.activeElement === last`. `last` is the _disabled_
  "Add place" button, which can never hold focus, so the branch is dead and the browser's own
  boundary handling runs — which is the exact fall-through `Modal.svelte:35-39`'s comment says this
  code exists to prevent.
- **The fix:** filter `FOCUSABLE_SELECTOR`'s result to elements that can actually take focus
  (`:not([disabled])`, plus an `offsetParent !== null` / `checkVisibility()` filter for hidden
  ones). ~3 lines.
- **Status:** ✅ Fixed. keyboard-walk.spec.ts "A11Y-2: Tab never leaves an open modal, even when its last control is disabled" -- reverted -> RED.
- **Severity:** serious.

## 3. The file-upload control shows no focus indicator at all

- **SC:** 2.4.7 Focus Visible (AA).
- **Where:** `src/places/UploadPanel.svelte:171` (`<input type="file">`) and `:212-231` (the
  `.dropzone` label and the `opacity: 0` rule on the input).
- **What a user experiences:** Tab through the Places panel and one stop is simply invisible —
  the caret disappears for a step and comes back afterwards. The stretched, transparent file input
  is the focused element, and its visible wrapper (`.dropzone`) has no `:focus-within` rule, so
  nothing on screen changes. A sighted keyboard user cannot tell what is focused or that "choose a
  file" is even the current target.
- **The fix:** add a `.dropzone:focus-within { outline: 2px solid var(--focus-ring); outline-offset:
2px; }` rule. (The transparent-input-over-a-label pattern itself is fine and should stay.)
  ~4 lines. The only `:focus-within` rule in `src/` today is `shell.css:274`'s search field.
- **Status:** ✅ Fixed. keyboard-walk.spec.ts "A11Y-3: the file-upload control shows a visible focus indicator" -- reverted -> RED.
- **Severity:** serious.

## 4. The report's progress/status line is announced to nobody

- **SC:** 4.1.3 Status Messages (AA).
- **Where:** `src/report/Report.svelte:332` —
  `<p class="progress-line" role="status" aria-live="off">{progressLabel}</p>`.
- **What a user experiences:** `report.html` builds for several seconds ("Resolving the release…",
  "Starting the data engine…", "Scoring Gulf of America (1 of 2)…", "Done — 2 places."). An
  explicit `aria-live="off"` **overrides** the implicit `polite` that `role="status"` carries, so a
  screen-reader user is told none of it. The page is a status region in name only: they hear
  nothing, and have no way to know whether the document is still working or has finished.
- **The fix:** drop `aria-live="off"` (or set it to `polite`); optionally `aria-atomic="true"`.
  1 line. Note the report already mounts the shared `Announcer` (`div[role=status]
[aria-live=polite]`), so after the fix the page has two polite regions — either route the
  progress text through `announce()` instead, or keep both and accept the duplication (the
  Announcer's per-place "… scored." messages and the progress line say different things).
- **Status:** ✅ Fixed. keyboard-walk.spec.ts "A11Y-4: the report's progress line is actually announced" -- reverted -> RED.
- **Severity:** serious.

## 5. WebKit: activating a rail tool drops focus to `<body>`

- **SC:** 2.4.3 Focus Order (A). **WebKit/Safari only** — chromium and firefox keep focus.
- **Where:** the `activeTool` swap — `src/shell/Shell.svelte:108-113` and the lazy panel `$effect`s
  that resolve just after it; `src/lib/ui/Rail.svelte` holds the focused button.
- **What a user experiences:** on Safari, Tab to the tool rail, arrow to "Places", press Enter. The
  panel opens, and about 100 ms later the caret is gone: `document.activeElement` is `<body>`. The
  next Tab starts from the top of the document, so every tool switch costs a walk back through the
  whole top bar.
- **Measured** (100 ms polls, Playwright WebKit): activating the **already-open** tool keeps focus
  indefinitely; arrowing within the rail **without** activating keeps focus indefinitely;
  activating a **different** tool loses it by the first poll — i.e. it coincides with the newly
  chosen tool's lazy panel chunk resolving and the panel body swapping.
- **The fix:** not diagnosed to a single line. Start by re-focusing the activated rail button after
  the panel swap settles (an `await tick()` + `.focus()` in `selectTool`, the way
  `Panel.svelte`'s `collapse()`/`restore()` already re-establish focus), and confirm against the
  gate. Check whether the `aria-pressed`/`tabindex` rewrite on the rail's buttons, or the
  `{#if PlacesComp}` branch swap, is what WebKit treats as removing the focused node.
- **Status:** ✅ Fixed. keyboard-walk.spec.ts "activating a rail tool leaves focus on that tool" (webkit) -- reverted -> RED on webkit.
- **Severity:** serious (on one of the three engines, which is the one VoiceOver users are on).

## 6. Firefox: "Skip to the tools" skips the tools

- **SC:** 2.4.1 Bypass Blocks (A). **Firefox only.**
- **Where:** `index.html:345-346` — `<a class="skip-link" href="#rail-region">` and
  `href="#panel-region"`; the targets are a plain `<nav>` and a plain `<div>`, neither with
  `tabindex`.
- **What a user experiences:** on Firefox, activating "Skip to the tools" moves the sequential-focus
  starting point to `#rail-region` — and Firefox places that point **after the target's whole
  subtree**, so the next Tab lands on the panel's "Collapse to a pill" and the tool rail is skipped
  entirely. A skip link that skips the thing it names does not bypass anything. Measured: first Tab
  after the skip link is the rail's "Layers" on chromium and webkit, "Collapse to a pill" on
  firefox.
- **The fix:** `tabindex="-1"` on `#rail-region` and `#panel-region` (the standard remedy), so the
  target itself takes focus and every engine agrees. 2 attributes.
- **Status:** ✅ Fixed. keyboard-walk.spec.ts "'Skip to the tools' lands the caret on the tool rail" (firefox) -- reverted -> RED on firefox.
- **Severity:** serious.

## 7. The desktop panel's body is a nameless tab stop

- **SC:** 4.1.2 Name, Role, Value (A); also 1.3.1.
- **Where:** `src/lib/ui/Panel.svelte:130-135` —
  `<div class="panel-body" id={bodyId} tabindex="0">`, no role, no label.
- **What a user experiences:** Tab through the shell and one stop announces nothing at all —
  VoiceOver reads a blank group. The `tabindex="0"` is correct and required (axe's
  `scrollable-region-focusable`: a scrollable region with no focusable child must be reachable);
  what is missing is the name. Its phone twin, `Sheet.svelte:107`, already gets this right:
  `role="region" aria-label="{title} details"`. Panel lost its label when atlas-3 handover item (a)
  removed the nested landmark and kept the `tabindex`.
- **The fix:** give it a name without re-creating a nested landmark — `role="group"
aria-label="{title} details"` (a `group` is not a landmark, so the "two nested regions with
  near-duplicate names" problem that item (a) fixed does not come back). 2 attributes. Then update
  `e2e/gallery.spec.ts`'s "Panel's body has tabindex=0, and is NOT a second nested landmark" test to
  also assert the name, and remove the `KNOWN_UNNAMED_STOPS` entry in `e2e/keyboard-walk.spec.ts`.
- **Status:** ✅ Fixed. keyboard-walk.spec.ts "the panel body is a named region, like the sheet body is"; gallery.spec.ts "Panel's body has tabindex=0..." -- reverted -> RED.
- **Severity:** serious (it is on the Tab path of every page).

## 8. The species picker is a listbox with no combobox

- **SC:** 4.1.2 Name, Role, Value (A); 1.3.1 Info and Relationships (A).
- **Where:** `src/lens/species/SpeciesPicker.svelte:107-155`.
- **What a user experiences:** the field is a plain `<input type="search" aria-label="Search
species">`. Focusing it opens a `role="listbox"` beneath it, but the input carries **no**
  `role="combobox"`, **no** `aria-expanded`, **no** `aria-controls`/`aria-owns`, **no**
  `aria-activedescendant` and **no** `aria-autocomplete`. So: nothing announces that a list
  appeared, nothing announces how many results there are, Arrow Down does not move through the
  options, Esc does not close the list, and the only way into the results is to Tab out of the
  field (past the "Only species in US waters" checkbox) into a run of `role="option"` buttons that
  are each their own tab stop. A screen-reader user types "leatherback" and hears silence.
- **The fix:** the APG combobox-with-listbox pattern — `role="combobox"`, `aria-expanded`,
  `aria-controls` pointing at the `.picker-list`, `aria-autocomplete="list"`, and either
  `aria-activedescendant` + ArrowUp/ArrowDown/Enter/Esc on the input (preferred: the options stay
  out of the Tab order) or a documented roving tabindex. Announce the result count through the
  existing `announce()` on each debounced query. Note the list is **virtualized** (only ~12 of
  ~22k rows are in the DOM), so `aria-activedescendant` must be paired with scrolling the active
  option into the rendered window — `computeVisibleWindow` already gives the arithmetic. Moderate
  amount of work; not a one-liner.
- **Status:** ✅ Fixed. species.smoke.spec.ts, describe "fix list #8" (3 tests, 3 engines) -- reverted -> RED.
- **Severity:** serious (the species lens has no other way in).

## 9. The map never points at its own text equivalent

- **SC:** 1.1.1 Non-text Content (A).
- **Where:** `src/shell/Shell.svelte:587-594` —
  `<div id="map" role="img" aria-label="Map of U.S. marine areas">`.
- **What a user experiences:** the map announces itself as an image called "Map of U.S. marine
  areas" and nothing more. It is the whole page. The project's declared equivalent for it — the
  zones table, ranked by exactly the layer the choropleth is painting (`ZonesTable.svelte`'s own
  header: "a sighted user reads colour-by-value on the map; this table is the SAME ranking as
  text") — is four keystrokes away behind the Table rail tool, and nothing in the map's own
  semantics says so.
- **The fix:** `aria-describedby` on the map pointing at a visually-hidden sentence that names the
  equivalent and how to reach it ("Every zone's score is also in the Zones table, under the Table
  tool"), and ideally a skip-style link to it. ~6 lines. This is the one exception
  `docs/accessibility.md` claims; the claim is only honest once the pointer exists.
- **Status:** ✅ Fixed. keyboard-walk.spec.ts "the map points at its own text equivalent" -- reverted -> RED.
- **Severity:** moderate.

## 10. A second `region` landmark nested inside the panel's own region

- **SC:** 1.3.1 Info and Relationships (A).
- **Where:** `src/lens/scores/LayersPanel.svelte:164-165` —
  `<section class="layers-control" aria-label="Layers on the map"><h3>Layers</h3>`, rendered inside
  `Panel.svelte`'s `<section class="panel-surface" aria-labelledby>` whose name is already "Layers".
- **What a user experiences:** landmark navigation offers "Layers" and, inside it, "Layers on the
  map" — two nested regions with near-duplicate names, plus an `h3` "Layers" under an `h2`
  "Layers". This is the same defect atlas-3's handover item (a) fixed in `Panel.svelte`,
  reintroduced one level down.
- **The fix:** make it a `<div>` (or `role="group"`), and rename the `h3` to something that is not
  the panel's own title. ~2 lines.
- **Status:** ✅ Fixed. keyboard-walk.spec.ts "no second region landmark nested inside the Layers panel's own region" -- reverted -> RED.
- **Severity:** moderate.

## 11. The floating legend is not in any landmark, and its heading breaks the outline

- **SC:** 1.3.1 (A); 2.4.6 Headings and Labels (AA).
- **Where:** `src/lib/ui/Legend.svelte:44-46` — `<div class="legend"><h2>{title}</h2>`, mounted by
  `Shell.svelte:662-668` as a bare child of `<main>`.
- **What a user experiences:** the legend — which carries the only text equivalent of the colour
  ramp (`role="img"` with "…, score ramp from 0 to 100 score", correctly) — sits in no landmark at
  all, so landmark navigation never offers it. Its `<h2>` also lands after the panel's `<h3>`, so
  the document outline reads h1 → h2 → h3 → **h2** → h2.
- **The fix:** wrap it in `<section aria-labelledby>` (or give the existing div `role="region"` and
  point `aria-labelledby` at the `h2`) so it is reachable as a landmark, and confirm the heading
  level against the surrounding outline. ~3 lines.
- **Status:** ✅ Fixed. keyboard-walk.spec.ts "the floating legend is reachable as a landmark" -- reverted -> RED.
- **Severity:** moderate.

## 12. The map-click popup is never announced

- **SC:** 4.1.3 Status Messages (AA).
- **Where:** `src/lib/map/popup.ts` (`createPopup()`), used by
  `src/lens/scores/ScoresLens.svelte`'s `showPopup()` and `src/lens/species/state.svelte.ts`.
- **What a user experiences:** clicking the map is the only way to read a cell's id, lon/lat and
  the displayed layer's value ("Cell 1500000 · -90.000, 26.500 · Overall score: 73.4"). MapLibre
  inserts that popup as a plain `div` with a close button; it is not a live region, nothing moves
  focus into it, and nothing announces it. A screen-reader user who somehow triggers a map click
  gets no result at all.
- **The fix:** route the popup's text through the existing shared `announce()` at the same moment
  it is shown (one call in each of the two call sites). The map itself is not keyboard-operable
  and is not proposed to become so — the zones table is its equivalent (see #9) — but a value the
  app computed and displayed should not be invisible to AT.
- **Status:** ✅ Fixed. scores.popup.spec.ts + species-popup.spec.ts "...is also announced through the shared live region" -- reverted -> RED.
- **Severity:** moderate.

## 13. The report's flower tabs are half a tab widget

- **SC:** 4.1.2 Name, Role, Value (A).
- **Where:** `src/report/Report.svelte:468-479` (`role="tablist"` / `role="tab"`) and `:480-486`
  (the `<figure class="flower-panel" hidden>` panels).
- **What a user experiences:** the tabs are named correctly (the place name) and `aria-selected`
  is right, but there is **no** `role="tabpanel"`, **no** `aria-controls`/`aria-labelledby` linking
  a tab to its figure, and **no** arrow-key navigation (each tab is its own Tab stop). A screen
  reader announces "tab, 1 of 2", the user presses Arrow Right as the role promises, and nothing
  happens; there is also no way to jump from a tab to the figure it controls.
- **The fix:** `role="tabpanel"` + `aria-labelledby` on each figure, `aria-controls` + `id` on each
  tab, and ArrowLeft/ArrowRight with a roving tabindex on the tablist. ~15 lines. (Alternatively,
  drop the ARIA tab roles entirely and let them be plain toggle buttons — a smaller change that is
  also correct.)
- **Status:** ✅ Fixed. report.spec.ts "the flower tabs are a real tab widget: linked panels and Arrow-key navigation" -- reverted -> RED.
- **Severity:** moderate.

## 14. A failed bundle load says nothing — atlas-3 handover item (b), fixed this round

- **SC:** no single SC; a robustness/`3.3.1`-adjacent gap.
- **Where:** `index.html:496-498` — the only fallback is a `<noscript>`, which does not cover
  "JavaScript is on and the bundle 404'd or failed to parse".
- **What a user experiences:** with `**/assets/*.js` blocked, the page is a title, an `h1`, two
  dead skip links and ten `aria-hidden="true"` skeleton parts. Nothing at all is announced, and
  nothing on screen says the app failed. This was handed over from the atlas-3 closing review as
  item (b) and is the one item of (a)-(e) still open: (a) was fixed in `Panel.svelte` (but see #10),
  (c) two skip links landed (but see #6), (d) `DataTable.svelte:382-386` gives the filter inputs
  `min-height: var(--size-touch)` under `(pointer: coarse)`, and (e) `codec.ts:52-58` accepts the
  `navy`/`paper` aliases alongside `dark`/`light`.
- **The fix:** a timed inline script in `index.html` that, if the shell has not mounted after ~8 s,
  reveals a plain visible message with `role="alert"` ("This page could not load its application
  code. Reload, or try again later."), plus a spec that aborts `**/assets/*.js` and asserts it.
  ~15 lines.
- **Status:** ✅ Fixed. shell.smoke.spec.ts "index.html reveals a visible role=alert message when the bundle never runs" -- reverted -> RED.
- **Severity:** moderate.

---

## What the re-audit must show — done (0.10.18)

1. `npx playwright test e2e/keyboard-walk.spec.ts` on **chromium, webkit and firefox** —
   **18/18, nothing skipped**, on all three engines. (Before the fix round: 10/5, 9/6, 9/6 of 15;
   3 new tests for #9/#10/#11 were added in this round, so the total grew from 15 to 18.)
2. `npx playwright test --project=chromium e2e/matrix.a11y.spec.ts` — 179/179, still zero
   serious/critical (unchanged by this round — none of the findings above was ever an axe
   finding; that is the point of the walk).
3. `npm run test:faults` — **8/8**, including `hexbutton-unnamed`, `modal-focus-restore`, and the
   new `modal-esc-delegated` (fix list #1).
4. The `KNOWN_UNNAMED_STOPS` list in `e2e/keyboard-walk.spec.ts` is empty.
5. New tests exist for #8-#14: `species.smoke.spec.ts` (#8, 3 tests), `keyboard-walk.spec.ts`
   (#9, #10, #11), `scores.popup.spec.ts` + `species-popup.spec.ts` (#12), `report.spec.ts`
   (#13), `shell.smoke.spec.ts` (#14).
