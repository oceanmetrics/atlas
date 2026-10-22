# Send feedback

> **Status in OceanMetrics Atlas (WP11, 2026-10-14; restricted views 0.3.4 and 0.3.5, 2026-10-22).** The dialog, the payload and the privacy rules still apply. What no longer does: the release registry (`versions.json` `access`, preview sessions, `session.json`). Since 0.3.4 `restricted` comes from the VIEW instead (`src/lib/catalog/access.ts#viewAccess`): a collection in the "Unlisted (shared by link)" group (opened from a `?collection=` link), one declaring `atlas:access: "restricted"`, or any page whose URL carries `?collection=` or `?catalog=`. The GitHub issue goes to `oceanmetrics/atlas`, and the endpoint comes from `VITE_FEEDBACK_URL` (no address is hard-coded): the shared Ocean Metrics Apps Script (`oceanmetrics/erddap-places` `scripts/feedback/Code.gs`), which does NOT read `restricted` and files every report as a public issue. Since 0.3.5 (Ben, 2026-10-22) a restricted view sends anyway (`RESTRICTED_PUBLIC_ISSUE_OK = true`): the issue shows the text and the screenshot, and the page link drops `collection`/`catalog` (the zero-backend issue link included), so the share link never reaches it. With `RESTRICTED_PUBLIC_ISSUE_OK = false` (0.3.4) a restricted view posts nothing: the dialog says the collection is under review and asks for comments to go to whoever shared the link, and `sendFeedback()` refuses a restricted payload on its own too. Once the deployed script skips the issue for `restricted: true`, set `ENDPOINT_SKIPS_ISSUE_WHEN_RESTRICTED` (`src/lib/feedback/endpoint.ts`) to `true`. Regression test: `tests/feedback/restrictedCollection.test.ts`; seeded faults `feedback-unlisted-not-restricted`, `feedback-restricted-posted`, `feedback-access-unwired`, `feedback-share-link-in-issue`.

U3 (round 2). The "Report a problem" control (About card, bottom-left over the map — see
`src/shell/Shell.svelte`'s `.about-region`; U1's top-bar "Feedback" control will call the same
function once it lands) opens `src/lib/feedback/FeedbackDialog.svelte`: a screenshot of the current
view, an optional hand-drawn annotation, a kind (bug / idea / question / data), a short text, an
optional email, and a privacy checkbox. It posts to a Google Apps Script endpoint that writes a
Sheet row, mails the team, and (for a **public** release only) files a GitHub issue with the
screenshot. With no endpoint configured, or when the release is **restricted**, it degrades
gracefully rather than failing silently — see "What happens without an endpoint" below.

This replaces the atlas-8 "beta feedback, zero backend" control (0.10.16); the zero-backend
GitHub-issue path is kept as the fallback, not removed. The control's own anchor `href` (a plain
prefilled GitHub issue link, `src/lib/feedback/issueUrl.ts`) still degrades gracefully with
JS disabled — a normal click now opens the dialog instead (`Shell.svelte`'s `openFeedback()`).

## What the dialog composes

`src/lib/feedback/payload.ts`'s `buildFeedbackPayload(input)` — a pure function, unit-tested in
`tests/feedback/payload.test.ts` — composes the exact JSON body the endpoint receives:

```
{ app: "atlas", kind, title, text, email, url?, release, version, sha, lens, viewport, theme,
  user_agent, image?, website, restricted }
```

- **`kind`** is one of `bug` / `idea` / `question` / `data` (Ben's R6 decision) — it becomes both
  the segmented control's selection and, verbatim, the GitHub issue's label.
- **`url`** is present **only if the reporter ticks "Include my current view link"** (off by
  default) — the privacy rule (plan D8, the same one `issueUrl.ts`'s zero-backend link already
  enforced): the URL fragment (a drawn place's geometry, `#pl=`) never leaves the device unless the
  reporter deliberately opts in. Unticked, the `url` key is **absent from the payload entirely** —
  not just hash-stripped, not present-but-empty. `src/lib/feedback/**` never reads the live page
  location itself; `Shell.svelte` builds `pageUrl` (fragment-stripped, query kept) and a snapshot of
  the raw hash the same way it always has for the zero-backend link, and hands both to the dialog as
  plain props. `tests/feedback/noHash.test.ts` is this directory's own source-scan gate for that
  (extended from the original Deliverable 4 gate — still the same forbidden literal tokens).
- **`restricted`** comes from the resolved release's `versions.json` `access` field (`"restricted"`
  → `true`; `"public"`, `"unknown"`, or unresolved → `false`) — read in `Shell.svelte` off the SAME
  `versions` rows the release picker already resolves, **never** `src/lib/release/access.ts`'s
  `accessOf()` (`tests/shell/shell-invariants.test.ts`: `Shell.svelte` may not import
  `../lib/release` at all — the early-fetch script is the one place that logic runs before any
  bundle parses).
- **`image`** is a `data:image/...` URL, present only when a screenshot was captured, kept
  ("Include screenshot" stays checked), and fits under `MAX_IMAGE_DATA_URL_LENGTH` (~4.5 MB of
  base64 text — `capture.ts`'s own `fitBytes()` already keeps the PNG itself under ~3 MB before it
  ever reaches the payload builder).
- **`website`** is the honeypot: a visually-hidden `<input>` a real person never fills; the SERVER
  (`Code.gs`) is what actually rejects a non-empty value, not this pure function.

## The screenshot and the annotator

`src/lib/feedback/capture.ts` captures the current view (`#shell`, index.html's app root) with
**html-to-image**'s `toCanvas` — never html2canvas, which rejects on `color-mix()` (the light
theme's palette uses it; the identical reason `../../CalCOFI/explore/src/capture.ts` picked
html-to-image). The map's MapLibre canvas needs `preserveDrawingBuffer: true` for its pixels to
survive the readback — `src/lib/map/map.ts` already sets it. Any currently-**open** `<dialog>`
(the feedback dialog's own Modal element, mid-capture) is filtered out of the capture, so the
screenshot never draws itself.

`src/lib/feedback/annotate.ts` is a hand-rolled canvas annotator (arrow / circle / rectangle / pen /
text, three colours, undo, clear) — no third-party library (marker.js is commercial; fabric.js and
tldraw are hundreds of KB for far more than five tools need). Colour/tool selection, undo and clear
are ordinary `<button>`s (keyboard-reachable, `role="group"`/`aria-pressed`); the canvas itself
carries an `aria-describedby` pointing at a plain-text usage hint, since freehand drawing has no
keyboard equivalent.

Both `capture.ts` (and the `html-to-image` package it imports) and `annotate.ts` are reached **only**
through `FeedbackDialog.svelte`'s own dynamic `import()` — never on the static critical path.
`scripts/size-budget-core.mjs`'s `FORBIDDEN_LAZY_MARKERS` now lists `"html-to-image"` (the build-time
half of that gate); `tests/feedback/lazy.test.ts` is the source-level half (a wiring gate proving
the dynamic-only wiring holds even before a build). The three annotator marker colours (and
`capture.ts`'s background fallback) live in `src/lib/feedback/colors.ts` — the one place this
directory may write a hex literal (a `<canvas>` 2D context does not read a CSS custom property;
`tests/raster/ramps.wiring.test.ts` names this file as its third such exception, alongside
`src/lib/map/colors.ts` and `src/report/colors.ts`).

## Sending

`src/lib/feedback/postFeedback.ts` POSTs the payload as `text/plain` JSON (keeps the request a CORS
"simple request" — an Apps Script `/exec` endpoint answers no `OPTIONS`, so an `application/json`
preflight would be dropped). **No `keepalive: true`** — the original Deliverable 4 control set it
because the same click could open a new tab; U3's dialog stays open through the whole send, and a
`keepalive` fetch is capped at a 64 KiB combined body quota (WHATWG fetch spec) that a
screenshot-carrying payload routinely exceeds, causing an immediate, silent rejection with **no**
network request Playwright (or a real browser's network panel) ever sees — this was a real defect
caught writing `e2e/feedback.spec.ts`, not a hypothetical one; see `postFeedback.ts`'s own header.

### `VITE_FEEDBACK_URL` / the local override

Build-time `VITE_FEEDBACK_URL` (a Pages repository variable) names the deployed Apps Script `/exec`
URL. `src/lib/feedback/endpoint.ts`'s `feedbackEndpoint()` also honours a `localStorage` override,
**`atlas.feedback_url`** — set it in the browser console (or via a test's `page.addInitScript`) to
point a running build at a different deployment or a local fixture without a rebuild:

```js
localStorage.setItem("atlas.feedback_url", "https://script.google.com/macros/s/.../exec");
```

### What happens without an endpoint

Unset (the build default): the dialog still works — every field, the screenshot, the annotator —
but "Send" stays disabled and the dialog says so. The zero-backend fallback, **"Open as GitHub
issue"**, opens a prefilled `github.com/oceanmetrics/atlas/issues/new` link built from the
CURRENT form state (`src/lib/feedback/githubIssue.ts`, labelled with the chosen `kind`) and copies
the screenshot (if kept) to the clipboard so it can be pasted into the issue — GitHub's `new/…` URL
cannot embed an image directly.

**Restricted release:** "Open as GitHub issue" is not offered at all, on the client — the button
is absent, and the dialog says the report goes to the team only. This is a client-side convenience,
not the enforcement point: the payload's own `restricted` field is what `Code.gs` checks
server-side before ever calling the GitHub API, so a modified or replayed request cannot bypass the
rule by omitting or lying about the flag from a build that otherwise has it right.

### Analytics

Two events, `feedback_open` and `feedback_sent` (`src/lib/analytics/events.ts`), each carrying only
`{ kind, restricted }` — never the text, the email, or the URL. `tests/analytics/noRawLocation.wiring.test.ts`
is unaffected (it scans `src/lib/analytics/**` for the live location global, not for what a
component's `track()` calls pass — those are separately typed, so an event carrying `pl`/`url`/`t`
would be a compile error against `EventParamsMap`).

## The Apps Script endpoint (once, by a maintainer)

`scripts/feedback/Code.gs` is the generated-by-hand JavaScript for the bound Apps Script project —
ported from CalCOFI Explorer's own generator
(`../../CalCOFI/calcofi4r/R/feedback.R#cc_feedback_script()`) and adapted to atlas's payload shape
and its two rules (the kind IS the label; a restricted release gets no public issue). Setup:

1. **Create the Sheet** under the maintainer account — e.g. "Atlas feedback".
   Add two tabs:
   - **`feedback`** — first row exactly the header `Code.gs`'s own `FEEDBACK_HEADER` constant
     defines (`ts, id, app, kind, title, text, email, url, release, version, sha, lens, viewport,
theme, user_agent, website, restricted, image_url, issue_url, status`).
   - **`recipients`** — `A1 = "email"`, one address per row. Seed it with the maintainers'
     addresses (kept in the Sheet, never in this repo). Edit a cell to add or remove someone later
     — no redeploy needed.
2. **Extensions → Apps Script**, delete the default `Code.gs` stub, paste the contents of this
   repo's `scripts/feedback/Code.gs` verbatim.
3. **Project Settings → Script properties**:
   - `GITHUB_TOKEN` (optional but expected in production) — a fine-grained personal access token
     scoped to `oceanmetrics/atlas` only, with **Contents: Read and write** and **Issues: Read
     and write** permissions. Without it, every submission still reaches the Sheet and mail; the
     `status` column says `"issue skipped: no GITHUB_TOKEN"`.
   - `DRIVE_FOLDER_ID` (optional) — a Drive folder id to file screenshots under. Without it, the
     script makes (or reuses) a folder named "atlas feedback" beside the Sheet itself.
4. **Deploy → New deployment → type "Web app"** — execute as **Me**, who has access **Anyone**.
   Copy the `/exec` URL.
5. **Give the app the URL**: set it as the repository variable `VITE_FEEDBACK_URL` in
   `oceanmetrics/atlas`'s GitHub Pages workflow so the built site picks it up.
   `.github/workflows/pages.yml`'s `checks` job already builds with two env vars on its
   `npx vite build` step (`VITE_SEAL`/`VITE_AGENCY`, plan D10) — add the new one alongside them,
   exactly this shape:

   ```yaml
   - run: npx vite build
     env:
       VITE_SEAL: "1"
       VITE_AGENCY: MMA
       VITE_FEEDBACK_URL: ${{ vars.VITE_FEEDBACK_URL }}
   ```

   (Add `vars.VITE_FEEDBACK_URL` under **Settings → Secrets and variables → Actions → Variables**
   with the `/exec` URL as its value — a plain repository _variable_, not a _secret_: it is an
   endpoint URL that ships in the public bundle either way, the same category `VITE_AGENCY`
   already is.) This runbook does **not** edit `pages.yml` itself — that is a separate change,
   reviewed like any other workflow edit.

6. **Re-paste `Code.gs`** after any change to this file (a Sheet's bound script is not "installed"
   from `main` automatically — there is no build step for Apps Script).

### Testing without a real deployment

Point a running build (dev server or a local `npm run preview`) at any endpoint you can inspect —
your own test deployment, or a `page.route`-intercepted fixture URL in a script — via the
`localStorage` override above. `e2e/feedback.spec.ts` does exactly this: it seeds
`atlas.feedback_url` with a fake `https://script.google.com/...` URL via `page.addInitScript` and
routes that exact URL with Playwright, asserting the posted JSON body (the hash-inclusion rule, the
`restricted` flag) end-to-end against the real dialog.

### The privacy statement (what the dialog itself tells the reporter)

> What is sent: your text, this view's release and lens, the viewport and theme, and the screenshot
> (unless you turn it off) — the page link only if you tick the box above. It goes to the team by
> mail and, on a public release, as a public GitHub issue in `oceanmetrics/atlas` labelled
> `{kind}` — filed either way, whether or not you give an email. Your email, if you give one, never
> appears in the issue; it stays in the team's own mail and sheet, with a copy sent back to you.
> This release being under review is the one case no public issue is filed at all.

V4 fix (owner phone report, 2026-09-24, docs fact-check item 2): the OLD wording ("...and, without
your email, as a public GitHub issue...") read as though giving an email somehow traded away the
issue, or the issue's filing was conditional on withholding one — `scripts/feedback/Code.gs` files
the issue unconditionally on a public release (once `GITHUB_TOKEN` is set), independent of whether
`email` was supplied at all; only the issue BODY never carries the submitter's email (that field is
never passed into `_openIssue()` — it lives in the Sheet row and the team's own mail only, see
`Code.gs`'s own `// 3. the row` comment).

## Seeded fault

`tests/faults/feedback-hash-leak.patch` (`npm run test:faults`): `buildFeedbackPayload()` rewritten
to place the hash on `payload.url` **unconditionally**, ignoring `includeUrl` — silently starts
leaking a drawn place's geometry (and any other page state in the fragment) on every submission,
ticked or not. Turns `tests/feedback/payload.test.ts` red (the pure-function assertion) and
`e2e/feedback.spec.ts`'s `'ticking "include my current view link"...'` test red (the unticked case
now finds a `#` in the posted body) — see `tests/GATES.md`'s own row for this entry and
`scripts/test-faults.mjs`'s `feedback-hash-leak` manifest entry (`PW_PORT=4388`).

## For the docs site (Quarto)

`docs/feedback-quarto-include.md` describes the small standalone include (JS + the same endpoint
variable) for `MarineSensitivity/docs` to add its own "Send feedback" control — that repo is
separate and is not touched here.
