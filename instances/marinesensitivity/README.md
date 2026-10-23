# instances/marinesensitivity

The MarineSensitivity Atlas as an instance of this codebase (vision doc 2026-10-21, "The atlas, one
codebase with skins"). Since build week 4 (step 2) `VITE_INSTANCE=marinesensitivity npm run build` is
the atlas of MarineSensitivity/atlas 0.10.93 (`57d53be`), whose modules moved into this repository as
they were. It is published at https://marinesensitivity.org/atlas/ by the thin MarineSensitivity/atlas
repo once that repo calls this one's `.github/workflows/build-instance.yml` at a pinned tag
(`docs/mst-thin-repo.md`; until then the live site is the 0.10.93 build).

## What it builds (`instance.json`, the instance module table)

- **Lenses** `scores, species`, opening on Scores. The Scores lens (`src/lens/scores/`, through its
  `shell.ts`): raster cells and Program Areas, the flower, the zones, species and composition tables,
  search, the glossary and the welcome. No Collections lens (decision D2: the Ocean Metrics catalog is
  not listed here this week).
- **Rail** `layers, details, table, report`: the Report tool is the 0.10.93 Places flow
  (`src/places/ReportPlaces.svelte`: pick mode, the Program Area picker, draw, coordinates, upload, the
  results panel) with the report actions (`src/shell/ReportPane.svelte`).
- **Pages** `index, report`: `report.html`, the print-first report (`src/report/`, `src/lib/report/`).
- **Release** the marine-atlas registry (`latest.txt`, `versions.json`, `{ver}/...` under the bucket's
  `marine-atlas/`), the preview origin `https://preview.marinesensitivity.org` with the access gate (a
  restricted release opens only on the preview host's `session.json`), and the docs book
  `https://marinesensitivity.org/docs/`. The build writes the inline early-fetch script into both pages.
- **Seal** MMA (`https://marinesensitivity.org/branding/mma-seal.svg`), shown on a build with
  `VITE_SEAL=1` (the thin repo's workflow sets it): About and the report cover.
- **Report** title "Marine Sensitivity Report", export stem `MarineSensitivity`; feedback issues and the
  "Code on GitHub" link go to MarineSensitivity/atlas (`repo`); figures are named `marine-atlas_...`.
- **Budget** 472 / 150 KB gzip. 0.10.93 held 460; this codebase carries maplibre-gl 6.15 (the
  `@oceanmetrics/map` peer range), about 10 KB gzip over 0.10.93's 6.10, and the shared Place layers.
  Measured with `scripts/size-budget.mjs`: 0.10.93 449.7 KB, this build 465.9 KB. Raised 470 -> 472 for the registry lens's
  copy assets (`lib/catalog/registry/item.ts`, `registry.svelte.ts`: +0.55 KB gzip in this instance's index, which carries
  the collection lens's state module); CI's gzip (Node 22) measures about 1.4 KB over a laptop's: 470.5 KB there.

## What is here

- `instance.json` (above), `tokens.css` (the MMA palette, `--mma-*`, with its `@contrast` block; the
  shared data colours `--cat-*` including `--cat-mangrove`) and `tokens.json` (exported by
  `VITE_INSTANCE=marinesensitivity node scripts/export-tokens.mjs`), `fonts.css` and `fonts/` (Jost and
  Carlito subsets, OFL; Century Gothic and Calibri stay `local()` only), copied verbatim from that repo.
- `mark.svg`: the wave-in-hexagon mark (`WaveHexMark.svelte`) with its CSS classes written as
  presentation attributes reading the same custom properties.
- `assets/`: the favicon and the two motifs. Only public brand assets live in this folder; the
  restricted release prefixes and their numbers stay out of git.

## Not here (and why)

- **The gallery** (`gallery.html`, the mockup sections and their Playwright baselines): dev-only in
  0.10.93 too, never published; it stays in MarineSensitivity/atlas's archive.
- **The 0.10.93 Playwright specs** (scores, report, places, keyboard walk, the release gate) and their
  e2e-gated seeded faults: the unit tests and the vitest-gated faults moved; the browser specs are a
  follow-up (their fixtures route the bucket hermetically and need the MST e2e harness).
- **An og card** (`og.image`): none, so no `og:image` tags are written.
- **`atlas:uncertainty`** and the SEFSC republication (the rest of build week 4's scope).
