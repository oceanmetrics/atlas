# MarineSensitivity/atlas as a thin repo (draft, nothing applied there)

Build week 4, step 2 (decision D1, taken as recommended): the MarineSensitivity Atlas is built from
this repository (`instances/marinesensitivity/`), and `MarineSensitivity/atlas` becomes a thin repo
whose one workflow calls this repository's reusable `.github/workflows/build-instance.yml` at a pinned
tag and publishes the result to its own `gh-pages`. This page is the draft of that repo's files and
the steps for Ben. **Nothing here has been applied to MarineSensitivity/atlas**: changing its `main`
waits on Ben (the plan's "Waits on Ben").

## Why a thin repo, not a push from here

- https://marinesensitivity.org/atlas/ is the project Pages of a repo named `atlas` in the
  MarineSensitivity org (the org site's CNAME), so that repo stays the Pages host whatever builds the
  files.
- The preview host's sidecar serves that repo's `gh-pages` at
  `https://preview.marinesensitivity.org/{ver}/atlas/`.
- The feedback Apps Script commits screenshots to that repo's `main` under `feedback/`, and files its
  issues there (`instance.json` `repo`: `MarineSensitivity/atlas`).
- No cross-org secret: the thin repo checks out a public repo and publishes to its own `gh-pages` with
  its own `GITHUB_TOKEN`. A push from oceanmetrics/atlas would need a deploy key or PAT with write on a
  MarineSensitivity repo.
- MMA reviewers get their own release clock: the site moves only when the thin repo moves its pin, not
  on every oceanmetrics/atlas commit.
- Nothing is built twice: `build-instance.yml` is the one build, and oceanmetrics/atlas's own
  `pages.yml` calls it for both instances (oceanmetrics deployed, marinesensitivity built and checked).

## What `main` keeps

```
README.md                      what this repo is, the pin, how to move it (below)
LICENSE                        unchanged
PIN                            the oceanmetrics/atlas tag the site is built from: v0.5.0
.github/workflows/pages.yml    the one workflow (below)
feedback/                      the Apps Script's screenshots, unchanged
```

Everything else (the 0.10.93 source, its tests, docs, CI) stays reachable on the tag `v0.10.93` and
the branch `archive/0.10.93`. Issues, Pages settings (Deploy from a branch: `gh-pages`, `/`), the org
CNAME and the repository variables stay as they are.

## `.github/workflows/pages.yml`

`tests/release/pagesEnvVars.wiring.test.ts` reads the block below, so it stays in step with
`build-instance.yml`'s inputs. The tag appears three times (the `uses:` pin, `ref:` and `PIN`), and the
first job fails the run when they disagree.

```yaml
name: Pages

# The MarineSensitivity Atlas, built from oceanmetrics/atlas at the tag in PIN (instance
# marinesensitivity) by that repository's ONE reusable build, and published to this repository's
# gh-pages (branch-based Pages, served at https://marinesensitivity.org/atlas/; the preview host's
# sidecar serves the same branch at https://preview.marinesensitivity.org/{ver}/atlas/). To move the
# site to a new oceanmetrics/atlas release, change the tag in PIN and in the two places below.
on:
  push:
    branches: [main]
    # the feedback Apps Script commits each report's screenshot to main under feedback/; that commit
    # changes nothing the build reads
    paths-ignore:
      - "feedback/**"
      - "**.md"
  workflow_dispatch:

concurrency:
  group: pages
  cancel-in-progress: false

permissions:
  contents: read

jobs:
  pin:
    name: the pin agrees (PIN, uses, ref)
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: |
          pin="$(tr -d '[:space:]' < PIN)"
          grep -q "build-instance.yml@${pin}\$" .github/workflows/pages.yml
          grep -q "ref: ${pin}\$" .github/workflows/pages.yml
          echo "building oceanmetrics/atlas@${pin}"

  pages:
    needs: [pin]
    permissions:
      contents: write # the called workflow's deploy job pushes gh-pages with this repo's GITHUB_TOKEN
    uses: oceanmetrics/atlas/.github/workflows/build-instance.yml@v0.5.0
    with:
      instance: marinesensitivity
      ref: v0.5.0
      deploy: true
      # this repository's variables (Settings -> Secrets and variables -> Actions -> Variables),
      # public values that ship in the bundle either way
      VITE_FEEDBACK_URL: ${{ vars.VITE_FEEDBACK_URL }}
      VITE_LOG_URL: ${{ vars.VITE_LOG_URL }}
      VITE_GA_ID: ${{ vars.VITE_GA_ID }}
      VITE_PREVIEW_ATLAS_ROUTE: ${{ vars.VITE_PREVIEW_ATLAS_ROUTE }}
      # the MMA seal (instance.json `seal`: agency MMA and its image), shown only on this build
      VITE_SEAL: "1"
```

What the called workflow does (`build-instance.yml`): checks out `oceanmetrics/atlas` at `v0.5.0`,
runs the instance's unit tests (`vitest --project logic:marinesensitivity`), mirrors the DuckDB
extensions, builds with `VITE_INSTANCE=marinesensitivity`, holds the dist to the instance's budget
(`instance.json` `budget`) and the dist checks (relative assets, DuckDB mirror, inlined tokens, no
`session.json`, the instance module check), uploads `dist-marinesensitivity`, and then publishes that
same artifact to this repository's `gh-pages`. Its outputs are `artifact` (the artifact name) and
`sha` (the oceanmetrics/atlas commit built); the gh-pages commit message names both.

## Repository variables

| variable                   | keep / add | value                                                                             |
| -------------------------- | ---------- | --------------------------------------------------------------------------------- |
| `VITE_FEEDBACK_URL`        | keep       | the feedback Apps Script `/exec` URL, as today                                    |
| `VITE_LOG_URL`             | keep       | the Sheet-log beacon URL, as today                                                |
| `VITE_PREVIEW_ATLAS_ROUTE` | keep       | as today (`1` once the preview host serves `/{ver}/atlas/`)                       |
| `VITE_GA_ID`               | **add**    | `G-9HW6L751XG`: 0.10.93 hard-coded it in `analytics.ts`; this codebase ships none |

`VITE_SEAL` is set in the workflow (above); `VITE_AGENCY` and `VITE_SEAL_URL` are gone (the instance's
`seal` block carries the agency and the image). GA4's Enhanced Measurement setting stays as it is
(the history-event exclusion the atlas relies on, `e2e/fixtures/analytics-privacy/`).

## Steps for Ben

1. **Freeze 0.10.93** in MarineSensitivity/atlas:
   `git tag -a v0.10.93 57d53be -m "MarineSensitivity/atlas 0.10.93, the last standalone release"`,
   `git branch archive/0.10.93 57d53be`, push both.
2. **Look first**: the marinesensitivity build's shots (`docs/shots/mst_*` in oceanmetrics/atlas), or
   a staging URL, for MMA's look before the thin repo's first publish replaces the live site.
3. **Tag oceanmetrics/atlas `v0.5.0`** (the release plan in this repository's CHANGELOG 0.5.0 entry:
   the gate green on `main`, both builds green in CI).
4. **Add the variable** `VITE_GA_ID=G-9HW6L751XG` to MarineSensitivity/atlas.
5. **Reduce `main`** to the files above, in one commit:
   `git rm -r` everything but `README.md`, `LICENSE`, `feedback/`; add `PIN` (`v0.5.0`), the new
   `.github/workflows/pages.yml` and the new README (below). Push.
6. **Run it**: the push runs the workflow (or Actions -> Pages -> Run workflow). Check the run's
   `pages / build (marinesensitivity)` and `pages / publish ...` jobs, then
   https://marinesensitivity.org/atlas/: the About dialog says
   `oceanmetrics/atlas 0.5.0 · instance marinesensitivity`, the version chip resolves `v7`, and
   `?ver=v9` opens the picker with the restricted notice.
7. **Preview host**: confirm the sidecar still pulls `gh-pages` (the branch and its layout are
   unchanged), and say whether `https://preview.marinesensitivity.org/{ver}/atlas/` is live (README and
   `docs/usability.md` disagree); `VITE_PREVIEW_ATLAS_ROUTE` follows that answer.

**Rollback**: set the Pages source to the last good `gh-pages` commit (the pre-switch commit is the
0.10.93 build), or revert `main` to `archive/0.10.93` and let its own old workflow rebuild.

## Moving the pin

A new oceanmetrics/atlas release (`vX.Y.Z`, tagged there after its gate) reaches marinesensitivity.org
only when this repo moves to it: change `PIN`, the `uses: ...@vX.Y.Z` line and `ref: vX.Y.Z` in one
commit. The `pin` job refuses a run where the three disagree. Going back is the same edit to the older
tag.

## The thin repo's README (draft)

```markdown
# atlas

The MarineSensitivity Atlas at https://marinesensitivity.org/atlas/ (reviewer previews at
https://preview.marinesensitivity.org/{ver}/atlas/).

Its code lives in [oceanmetrics/atlas](https://github.com/oceanmetrics/atlas) as the
`marinesensitivity` instance (`instances/marinesensitivity/`); this repository only publishes it.
`.github/workflows/pages.yml` builds oceanmetrics/atlas at the tag in `PIN` with that repository's
reusable `build-instance.yml` and publishes the result to `gh-pages` (branch-based Pages).

- **The pin**: `PIN` holds the oceanmetrics/atlas tag the site is built from. To move it, change the tag
  in `PIN` and in the two places in `pages.yml` (`uses: ...@<tag>`, `ref: <tag>`), in one commit.
- **Feedback**: the in-app "Send feedback" files issues here and commits screenshots under `feedback/`.
- **History**: the standalone atlas (to 0.10.93) is the tag `v0.10.93` and the branch
  `archive/0.10.93`.
```
