# instances/marinesensitivity

The MarineSensitivity Atlas as an instance of this codebase (vision doc 2026-10-21, "The atlas, one
codebase with skins"). **A scaffold, not built today**: it holds the values already known from
`MarineSensitivity/atlas` 0.10.88 and validates against `../instance.schema.json`
(`tests/instances.test.ts`), but `VITE_INSTANCE=marinesensitivity npm run build` is not expected to
give a working app until build week 4, **2026-11-20 to 11-26**.

## What is here

- `instance.json`: name "MarineSensitivity Atlas" (a one-string wordmark), the page title and
  description from its `index.html`, the rail `layers, details, table, report`, the default lens
  `scores`, theme `dark`, tour `on`, the catalog base = the marine-atlas release base
  (`src/lib/release/dataBase.ts` `PUBLIC_DATA_BASE`), the titiler host, and the feedback app key
  `atlas`.
- `tokens.css` (the MMA palette, `--mma-*`, with its `@contrast` block) and `tokens.json` (exported
  by `VITE_INSTANCE=marinesensitivity node scripts/export-tokens.mjs`), `fonts.css` and `fonts/`
  (Jost and Carlito subsets, OFL; Century Gothic and Calibri stay `local()` only), copied verbatim
  from that repo.
- `mark.svg`: the wave-in-hexagon mark (`WaveHexMark.svelte`) with its CSS classes written as
  presentation attributes reading the same custom properties.
- `assets/`: the favicon and the two motifs.

## What arrives in build week 4 (2026-11-20 to 11-26)

- **The Scores lens** (`Lens = "scores" | "species"` in the MST repo): this build's `Lens` union is
  `"collection" | "species"`, so `defaults.lens: "scores"` falls back to `collection` until the lens
  lands as a member of the union.
- **The Report export** (the `report` tool): not in this build's `ToolName` union, so the rail drops it
  until then.
- **The seal**: the MMA seal behind the build flags `VITE_SEAL` / `VITE_AGENCY` (and
  `VITE_SEAL_URL`), `src/lib/ui/sealVisibility.ts` in the MST repo. Those lines left this repo's
  `.env.example` on 2026-10-22; they come back as this instance's settings.
- **The gallery** (the MST mockup gallery and its `navy`/`paper` theme names).
- **`atlas:uncertainty`**, the first MST renderer hook; `src/lib/catalog/hooks.ts#unknownHooks`
  reports it until it is registered. The MST kinds (`src/lib/catalog/mst/kinds.ts`) become a declared
  hook then too.
- The release-to-catalog bridge: the catalog base here is a release registry (`latest.txt`,
  `{ver}/manifest.json`), not a STAC `catalog.json`.
- An og card (`og.image`): none today, so no `og:image` tags are written.
- Strings that have no counterpart in the MST app yet and are placeholders until then: `credit`,
  `cite`, `about`, the group label `MarineSensitivity`, and the token set (the MST palette predates
  tokens this build reads, such as `--om-mark-spark` and the `--cat-*` set; the contrast gate and the
  token parity are checked when the instance is first built).
