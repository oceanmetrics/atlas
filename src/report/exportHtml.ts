// report/exportHtml.ts -- atlas-7 step 3, Export 2 ("Download HTML"): the rendered document
// serialized to ONE self-contained file (spec: inline CSS, SVG, PNG data URIs, embedded fonts).
//
// This app never loads a custom web font for `report.html` (report.css imports only
// `lib/brand/tokens.css`'s tokens, not `lib/brand/fonts.css`'s `@font-face` rules -- see report.css's
// own header) precisely so this export needs nothing "embedded": the `--font-body`/`--font-display`
// fallback chains resolve to system fonts everywhere, so there is no remote font request to inline
// in the first place. SVGs (the flowers, the permalink QR) are already inline markup in the live
// DOM; the map is a `<img>` PNG data URI by the time this runs (mapPng.ts, taken after `idle`) --
// there is no live MapLibre canvas to strip because the print/export map section never mounts one
// (see Report.svelte's header: the interactive map is index.html's job, not this one's).
//
// `assembleStandaloneHtml` is the pure part (string concatenation, unit-tested); `collectPageCss`
// walks `document.styleSheets`, which only exists in a real browser/jsdom document.
export function collectPageCss(doc: Document): string {
  const parts: string[] = [];
  for (const sheet of Array.from(doc.styleSheets)) {
    try {
      for (const rule of Array.from(sheet.cssRules)) parts.push(rule.cssText);
    } catch {
      // a cross-origin stylesheet's `cssRules` throws (SecurityError) -- report.html loads none,
      // but this stays defensive rather than assuming that forever.
    }
  }
  return parts.join("\n");
}

export interface StandaloneHtmlInput {
  title: string;
  css: string;
  /** the document root's `innerHTML` (Report.svelte hands over `#report-root`'s own markup). */
  bodyHtml: string;
  lang?: string;
}

/** PURE: assembles the final byte string. No DOM here -- unit-tested directly.
 *
 * B5 fix (docs/usability.md): `report.html` itself always carries `data-theme="paper"` (its own
 * header comment: "always the paper (light) theme ... this must be set explicitly or every token
 * resolves to the dark theme's pairing instead" -- `tokens.css`'s bare `:root` IS the navy/dark
 * theme). The exported standalone document is a FRESH `<html>`, built here, not a copy of
 * `report.html`'s own tag -- it never carried that attribute, so opening the download re-ran every
 * `var(--...)` token against the dark theme's values while the page's literal (non-token)
 * backgrounds stayed light: white text on a light page. `data-theme="paper"` alone is `report.css`'s
 * own source of truth for `color-scheme` too (`:root[data-theme="paper"] { color-scheme: light }`,
 * tokens.css), but this also sets it directly on the tag as a second, redundant guarantee -- the
 * exported file has no bundler to guarantee `collectPageCss`'s captured rule order stays outside
 * this file's own inline `<style>` cascade the way it does on the live page. */
export function assembleStandaloneHtml(input: StandaloneHtmlInput): string {
  const lang = input.lang ?? "en";
  return (
    `<!doctype html>\n` +
    `<html lang="${lang}" data-theme="paper" style="color-scheme: light">\n<head>\n<meta charset="UTF-8">\n` +
    `<meta name="viewport" content="width=device-width, initial-scale=1.0">\n` +
    `<title>${escapeHtml(input.title)}</title>\n` +
    `<style>${input.css}</style>\n</head>\n<body>\n${input.bodyHtml}\n</body>\n</html>\n`
  );
}

/**
 * Fetches `url` and resolves it to a `data:` URI, or `null` on any failure (offline, CORS, 404) --
 * never throws, so a caller can degrade gracefully (B5: hide the image, same spirit as the live
 * page's own `onerror` fallback, which `cloneNode()` never carries over -- it clones ATTRIBUTES,
 * not event listeners). DOM-dependent (`fetch`/`FileReader`); the pure byte-assembly above is what
 * carries this module's unit-test coverage, not this function.
 */
export async function fetchAsDataUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error ?? new Error("FileReader failed"));
      reader.onload = () => resolve(String(reader.result));
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export interface DownloadStandaloneHtmlOptions {
  rootId?: string;
  /**
   * Runs on a DETACHED CLONE of `#report-root` before it is serialized -- Report.svelte uses this
   * to swap the live, interactive map container for the static print `<img>` (the download ships
   * no JavaScript at all, so a live MapLibre container would serialize as a permanently empty
   * `<div>`; see report.css's `.map-live`/`.map-print` pair). May return a `Promise` (B5: inlining
   * the seal as a data URI needs a `fetch`); `downloadStandaloneHtml` awaits it either way.
   */
  transform?: (clone: HTMLElement) => void | Promise<void>;
}

/** builds the standalone document from the LIVE page (`document`) and downloads it. `rootId`
 * defaults to `report-root` (`report.html`'s mount point). */
export async function downloadStandaloneHtml(
  fileStem: string,
  title: string,
  opts: DownloadStandaloneHtmlOptions = {},
): Promise<void> {
  const root = document.getElementById(opts.rootId ?? "report-root");
  if (!root) throw new Error(`exportHtml: #${opts.rootId ?? "report-root"} not found`);
  const clone = root.cloneNode(true) as HTMLElement;
  await opts.transform?.(clone);
  const html = assembleStandaloneHtml({
    title,
    css: collectPageCss(document),
    bodyHtml: clone.outerHTML,
  });
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = `${fileStem}.html`;
    a.click();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
