// release/cite.ts -- THE one dataset-citation path (atlas-7 §7 / the phase's review checklist:
// "the report reads the same ramps.ts, categories.ts, cite.ts and SQL files as the app: no second
// copy").
//
// NEW IN atlas-7, AND DELIBERATELY NOT UNDER `src/lib/report/`. Before this file there was no
// shared citation path at all: `src/lens/species/data/layerBar.ts#datasetIndex()` reads
// `boot.datasets` for the layer pills but keeps only `name_display`/`value_info`/`sort_order` and
// never looks at `citation`/`link_info`. It lives in `release/` because a citation is RELEASE
// METADATA (it comes out of `boot.json`, like every other reader here) and because `src/lib/report/`
// is reachable only from `report.html` -- a lens importing a module from there would drag the whole
// report into `index.html`'s static graph and blow the 450 KB budget. Anything that wants to print
// "where did this number come from" imports THIS.
//
// Defensive, like every other boot reader (`release/boot.ts`'s rule): a malformed row is skipped,
// never thrown on -- a missing citation degrades to "no citation published", which is legible.

export interface Citation {
  /** `dataset.ds_key`, the join key the rest of the app names a dataset by. */
  dsKey: string;
  /** `dataset.name_display`, else the key itself. */
  label: string;
  /** `dataset.citation` -- the full reference string, verbatim except `fixKnownCitationTypos`'s
   * one named exception (below), or `null` when unpublished. */
  citation: string | null;
  /** `dataset.link_info` -- the dataset's own page, or `null`. */
  href: string | null;
}

interface RawDataset {
  ds_key?: unknown;
  name_display?: unknown;
  citation?: unknown;
  link_info?: unknown;
  sort_order?: unknown;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v : null;
}

/** P3 fix (Opus eyes-on review, 2026-09-24): one narrow, NAMED exception to `citation`'s own
 * "verbatim" contract (this module's `Citation.citation` doc, above) -- the AquaMaps R package's
 * own upstream CITATION text runs two words together with no space
 * ("Creative Commons Attribution-NonCommercial 3.0 UnportedLicense, please see ..."), verified
 * against the real v7-v9 `datasets.json` `am_0.05` row. That text is release metadata this repo
 * does not generate (it comes from `workflows`/`msens`'s own dataset registry, out of this fix's
 * reach) -- correcting it here is display-only and never touches the published field itself.
 *
 * R3-B8 (Opus eyes-on review, 2026-09-25): a second, same-row exception -- the AquaMaps R
 * package's own upstream text says "Content from AquaMaps as provided in this R package is
 * licensed...", which reads fine INSIDE that package's own CITATION file but is orphaned prose
 * once copied verbatim into `datasets.json` and printed in a report that never mentions "this R
 * package" anywhere else -- a reader has no antecedent for "this". "the msens R package" names
 * the package the text is actually quoting from (`workflows`'s own sibling `msens`, which vendors
 * this citation string). DISPLAY-TIME ONLY, same as the typo fix above: the real fix is
 * `msens`'s own `inst/.../datasets.json` (R3-C4, a separate workflows task) -- retire this second
 * replacement once that source text is corrected and every bundle republished with it. */
function fixKnownCitationTypos(v: string): string {
  return v
    .replace(/\bUnportedLicense\b/g, "Unported License")
    .replace(/\bas provided in this R package\b/g, "as provided in the msens R package");
}

function citationStr(v: unknown): string | null {
  const s = str(v);
  return s === null ? null : fixKnownCitationTypos(s);
}

/**
 * `boot.datasets` -> the citation list, in `dataset.sort_order` (a `null` order sorts LAST -- the
 * same rule `layerBar.ts#compareDs` uses for the pills), ties broken by `ds_key` so the order is
 * total and a report regenerated from the same release is byte-identical.
 *
 * `[]` for a release that publishes no `datasets` block (v1-era bundles), never a throw.
 */
export function citations(boot: unknown): Citation[] {
  const rows = (boot as { datasets?: unknown } | null | undefined)?.datasets;
  if (!Array.isArray(rows)) return [];
  const out: { c: Citation; order: number | null }[] = [];
  for (const raw of rows as RawDataset[]) {
    if (!raw || typeof raw !== "object") continue;
    const dsKey = str(raw.ds_key);
    if (!dsKey) continue;
    out.push({
      c: {
        dsKey,
        label: str(raw.name_display) ?? dsKey,
        citation: citationStr(raw.citation),
        href: str(raw.link_info),
      },
      order:
        typeof raw.sort_order === "number" && Number.isFinite(raw.sort_order)
          ? raw.sort_order
          : null,
    });
  }
  out.sort((a, b) => {
    if (a.order !== b.order) {
      if (a.order === null) return 1;
      if (b.order === null) return -1;
      return a.order - b.order;
    }
    return a.c.dsKey < b.c.dsKey ? -1 : a.c.dsKey > b.c.dsKey ? 1 : 0;
  });
  return out.map((r) => r.c);
}

/** only the datasets that actually published a citation -- what a "Sources" section lists. */
export function citedDatasets(boot: unknown): Citation[] {
  return citations(boot).filter((c) => c.citation !== null);
}
