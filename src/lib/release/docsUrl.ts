// docsUrl.ts -- P10: where the Atlas's Help > Docs link should point.
//
// Ben opened Help > Docs on the live v7 app and landed on the documentation book's PREFACE, not
// the Atlas guide he was looking for -- the link was a plain `https://marinesensitivity.org/docs/
// {ver}/` (Shell.svelte's own `docsHref`, unchanged since U6). `docs/apps/atlas.qmd` now exists
// (docs repo, merged 49bc28b) and the book's CI publishes it per release as `apps/atlas.html`
// inside that release's own book directory -- quarto books preserve a chapter source's
// subdirectory in the rendered output 1:1, so `apps/atlas.qmd` -> `_book/apps/atlas.html`
// (`docs/.github/workflows/quarto-publish.yaml`'s `build` job; verified against `docs/_quarto.yml`,
// which lists `apps/atlas.qmd` under "Applications (Current)").
//
// The three destinations mirror `docs/libs/versioned.R`'s own `doc_docs_url()` (that file's own
// "NEVER fall back to another version's numbers" rule, applied here to a LINK instead of a figure):
//  - public:     https://marinesensitivity.org/docs/{ver}/apps/atlas.html -- GitHub Pages, staged
//    by quarto-publish.yaml's `publish` job.
//  - restricted: {previewBase}/docs/{ver}/apps/atlas.html -- the signed-in preview host. The
//    `publish` job NEVER stages a restricted release's book onto the public `gh-pages` branch at
//    all (it goes to `gh-pages-preview` instead, the sibling `publish-preview` job), so a public
//    link for v7b/v8/v9 would 404. Same shape as msens's `preview_docs_url()` (`R/ver_token.R`) +
//    `product_urls()`'s `docs` entry for a restricted release, with the chapter path appended.
//  - unknown (no `ver`, or no registry row to say public/restricted): the book's ROOT, never a
//    guessed `{ver}/apps/atlas.html` a build may not have published.
//
// Pure: no fetch, no DOM. `Shell.svelte` duplicates this by hand rather than importing it
// (tests/shell/shell-invariants.test.ts's source-scan guard: the shell never imports
// src/lib/release -- see that file's `releaseRestricted` for the same rule already applied to
// access.ts). This file is the single TESTED definition (tests/release/docsUrl.test.ts); the e2e
// assertion on the real rendered href (e2e/shell.chrome.spec.ts) is what proves Shell.svelte's
// hand-duplicate still agrees with it.
import { RELEASE } from "../brand/instance";
import { PREVIEW_HOST } from "./previewLink";
import type { AccessLevel } from "./access";

/** the book's root -- also the "we don't know" fallback: the instance's `release.docs`. */
export const DOCS_ROOT = RELEASE?.docs ?? "";

/** the Atlas chapter's path within a release's own book directory. */
export const ATLAS_CHAPTER_PATH = "apps/atlas.html";

/** UI-16 (Opus 5.5 eyes-on review, round 3): the DATA release's own notes chapter -- what "What
 * changed" should link, distinct from `ATLAS_CHAPTER_PATH` (the APP's own guide) and from the
 * app's CHANGELOG.md (the About modal used to link that instead, which describes the ATLAS CODE's
 * history, not the data RELEASE the person is looking at -- workflows' own `data/release_notes.yml`
 * publishes per-version entries into the SAME versioned docs book `atlasDocsUrl` reads, by the SAME
 * "quarto preserves a chapter source's own subdirectory 1:1" rule that file's header documents; no
 * `apps/` prefix, since the chapter is top-level in the book, not under "Applications").
 *
 * R3-rr fix 4 (Opus 5.5 eyes-on review round 3, second pass, 2026-09-25): the chapter's QMD source
 * is `docs/releases.qmd` (verified: `docs/_quarto.yml` lists `releases.qmd` under its top-level
 * chapters; there is no `release_notes.qmd` in that repo) — quarto's own "a chapter source renders
 * to the SAME basename" rule (this file's own header) means the rendered chapter is
 * `releases.html`, not `release_notes.html`. The live link 404s
 * (`https://marinesensitivity.org/docs/v7/release_notes.html`); `releases.html` is 200, verified
 * live 2026-09-25. This constant was simply named after the UNRELATED `data/release_notes.yml` data
 * file the chapter is built FROM, not after the chapter's own QMD filename. */
export const RELEASE_NOTES_CHAPTER_PATH = "releases.html";

/**
 * URL of `ver`'s Atlas chapter, or the book root when `ver`/`access` is not known.
 *
 * @param ver the resolved release label (e.g. `window.__early.version`), or null/undefined before
 *   it resolves.
 * @param access `"public"` | `"restricted"` | `"unknown"` -- from the SAME `versions.json` row a
 *   caller already has (`access.ts#accessOf`, or Shell.svelte's own hand-duplicated lookup).
 * @param previewBase the signed-in preview host; overridable for tests, defaults to `PREVIEW_HOST`.
 */
export function atlasDocsUrl(
  ver: string | null | undefined,
  access: AccessLevel,
  previewBase: string = PREVIEW_HOST,
): string {
  return versionedDocsUrl(ver, access, ATLAS_CHAPTER_PATH, previewBase);
}

/**
 * URL of `ver`'s release-notes chapter ("What changed" in the About modal) -- the SAME
 * public/restricted/unknown resolution `atlasDocsUrl` uses, just a different chapter path. See
 * `RELEASE_NOTES_CHAPTER_PATH`'s own header for why this is a distinct link from both
 * `atlasDocsUrl` (the app's guide) and the app's own CHANGELOG.md.
 */
export function releaseNotesUrl(
  ver: string | null | undefined,
  access: AccessLevel,
  previewBase: string = PREVIEW_HOST,
): string {
  return versionedDocsUrl(ver, access, RELEASE_NOTES_CHAPTER_PATH, previewBase);
}

function versionedDocsUrl(
  ver: string | null | undefined,
  access: AccessLevel,
  chapterPath: string,
  previewBase: string,
): string {
  if (!ver || access === "unknown") return DOCS_ROOT;
  if (access === "restricted") return `${previewBase}/docs/${ver}/${chapterPath}`;
  return `${DOCS_ROOT}${ver}/${chapterPath}`;
}
