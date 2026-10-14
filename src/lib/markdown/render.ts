// A small, SAFE markdown -> HTML renderer for the READMEs a collection publishes (methods, field
// dictionaries): headings, paragraphs, bulleted/numbered/nested lists, GFM tables, fenced code,
// blockquotes, rules, emphasis, inline code, links and images.
//
// Safe by construction, not by sanitising afterwards: every piece of text is HTML-escaped as it is
// written, so raw HTML in the source (a `<script>`, an `<img onerror>`) comes out as visible text,
// never as markup. Only the tags this file writes ever exist in the output. Links are `http(s)`,
// `mailto:` or relative (resolved against the README's own URL, so `./fig.png` and `../values.md`
// mean the collection's files, not the page's); anything else (`javascript:`, `data:`) is dropped to
// plain text, a fragment-only link (`#section`) too (a hash is the app's view state, a modal must not
// navigate it). Links open in a new tab with `rel="noopener noreferrer"`.
//
// Pure and DOM-free (tested under Node). Loaded lazily by the modal that shows it, so the static path
// of the map does not carry it (`src/lib/ui/DocModal.svelte`).

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** an href/src made absolute against `base`; `null` when it is unusable or its scheme is not allowed.
 * `allowMailto` is for links only. A fragment-only reference is `null` (see the header). */
export function resolveMarkdownUrl(
  href: string,
  base: string | null,
  allowMailto: boolean,
): string | null {
  const v = href.trim();
  if (!v || v.startsWith("#")) return null;
  let url: URL;
  try {
    url = base ? new URL(v, base) : new URL(v);
  } catch {
    return null;
  }
  if (url.protocol === "https:" || url.protocol === "http:") return url.href;
  if (allowMailto && url.protocol === "mailto:") return url.href;
  return null;
}

// --- inline ---------------------------------------------------------------------------------------

/** a placeholder that survives escaping and the emphasis passes (private-use characters). */
const stash = (n: number) => `${n}`;

function renderInline(text: string, base: string | null): string {
  const slots: string[] = [];
  const keep = (html: string): string => {
    slots.push(html);
    return stash(slots.length - 1);
  };
  let s = text;

  // code spans first: their content is literal
  s = s.replace(/(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/g, (_m, _ticks, code: string) =>
    keep(`<code>${escapeHtml(code.trim())}</code>`),
  );

  // images, then links: [text](url "title"); the label may hold inline code (already stashed)
  s = s.replace(
    /!\[([^\]]*)\]\(\s*((?:[^()\s]|\([^()\s]*\))+)(?:\s+"[^"]*")?\s*\)/g,
    (_m, alt: string, src: string) => {
      const url = resolveMarkdownUrl(src, base, false);
      return url
        ? keep(`<img src="${escapeHtml(url)}" alt="${escapeHtml(alt)}" loading="lazy">`)
        : keep(escapeHtml(alt));
    },
  );
  s = s.replace(
    /\[([^\]]+)\]\(\s*((?:[^()\s]|\([^()\s]*\))+)(?:\s+"[^"]*")?\s*\)/g,
    (_m, label: string, href: string) => {
      const url = resolveMarkdownUrl(href, base, true);
      const inner = renderEmphasis(escapeWithStash(label));
      return url
        ? keep(
            `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${inner}</a>`,
          )
        : keep(inner);
    },
  );
  // <https://...> and bare http(s) URLs
  s = s.replace(/<(https?:\/\/[^\s<>]+)>/g, (_m, u: string) => autolink(u, keep));
  s = s.replace(
    /(^|[\s(])(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])/g,
    (_m, pre: string, u: string) => pre + autolink(u, keep),
  );

  // everything left is text: escape it, then emphasis
  s = renderEmphasis(escapeWithStash(s));
  // put the stashed pieces back (they may nest: a stashed link holds a stashed code span)
  for (let pass = 0; pass < 3; pass++) {
    s = s.replace(/(\d+)/g, (_m, i: string) => slots[Number(i)] ?? "");
  }
  return s;
}

function autolink(url: string, keep: (html: string) => string): string {
  const abs = resolveMarkdownUrl(url, null, false);
  return abs
    ? keep(
        `<a href="${escapeHtml(abs)}" target="_blank" rel="noopener noreferrer">${escapeHtml(url)}</a>`,
      )
    : keep(escapeHtml(url));
}

/** escape everything except the stash placeholders (which hold no `<`/`&`, only private-use chars). */
function escapeWithStash(s: string): string {
  return escapeHtml(s);
}

function renderEmphasis(escaped: string): string {
  return escaped
    .replace(/\*\*([^*\s][^*]*?)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^\w])__([^_\s][^_]*?)__(?!\w)/g, "$1<strong>$2</strong>")
    .replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?!\*)/g, "$1<em>$2</em>")
    .replace(/(^|[^\w])_([^_\s][^_]*?)_(?!\w)/g, "$1<em>$2</em>")
    .replace(/~~([^~]+)~~/g, "<del>$1</del>");
}

// --- blocks ---------------------------------------------------------------------------------------

const FENCE = /^\s{0,3}(`{3,}|~{3,})\s*([\w+-]*)\s*$/;
const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const HR = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const BULLET = /^(\s*)([-*+])\s+(.*)$/;
const ORDERED = /^(\s*)(\d+)[.)]\s+(.*)$/;
const QUOTE = /^\s{0,3}>\s?(.*)$/;
const TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

function splitRow(line: string): string[] {
  let t = line.trim();
  if (t.startsWith("|")) t = t.slice(1);
  if (t.endsWith("|") && !t.endsWith("\\|")) t = t.slice(0, -1);
  return t.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, "|"));
}

const isBlank = (l: string) => l.trim() === "";
const indentOf = (l: string) => l.length - l.trimStart().length;

interface Ctx {
  base: string | null;
}

function renderList(lines: string[], start: number, ctx: Ctx): { html: string; next: number } {
  const first = lines[start];
  const ordered = ORDERED.test(first) && !BULLET.test(first);
  const baseIndent = indentOf(first);
  const tag = ordered ? "ol" : "ul";
  const items: string[] = [];
  let i = start;
  while (i < lines.length) {
    const line = lines[i];
    const m = (ordered ? ORDERED : BULLET).exec(line);
    if (!m || indentOf(line) !== baseIndent) break;
    const body: string[] = [m[3]];
    i++;
    // continuation lines and nested lists belong to this item
    while (i < lines.length) {
      const nxt = lines[i];
      if (isBlank(nxt)) {
        // a blank line followed by an indented line continues the item
        if (i + 1 < lines.length && indentOf(lines[i + 1]) > baseIndent && !isBlank(lines[i + 1])) {
          body.push("");
          i++;
          continue;
        }
        break;
      }
      if (indentOf(nxt) > baseIndent) {
        body.push(nxt.slice(Math.min(indentOf(nxt), baseIndent + 2)));
        i++;
        continue;
      }
      break;
    }
    // a tight item (no blank line inside) keeps its text bare, as a nested list follows it directly
    items.push(`<li>${renderBlocks(body, ctx, !body.includes(""))}</li>`);
  }
  return { html: `<${tag}>${items.join("")}</${tag}>`, next: i };
}

/** `tight` (a list item with no blank line in it): its paragraphs are not wrapped in `<p>`. */
function renderBlocks(lines: string[], ctx: Ctx, tight = false): string {
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (isBlank(line)) {
      i++;
      continue;
    }

    const fence = FENCE.exec(line);
    if (fence) {
      const marker = fence[1][0].repeat(fence[1].length);
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(marker)) code.push(lines[i++]);
      i++; // the closing fence
      out.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`);
      continue;
    }

    const h = HEADING.exec(line);
    if (h) {
      const level = h[1].length;
      out.push(`<h${level}>${renderInline(h[2], ctx.base)}</h${level}>`);
      i++;
      continue;
    }

    if (HR.test(line) && !BULLET.test(line)) {
      out.push("<hr>");
      i++;
      continue;
    }

    // a table: a header row, a separator row, then body rows
    if (
      line.includes("|") &&
      i + 1 < lines.length &&
      TABLE_SEP.test(lines[i + 1]) &&
      lines[i + 1].includes("-")
    ) {
      const head = splitRow(line);
      const align = splitRow(lines[i + 1]).map((c) =>
        /^:-+:$/.test(c) ? "center" : /-+:$/.test(c) ? "right" : /^:-+/.test(c) ? "left" : "",
      );
      const cell = (tag: string, text: string, k: number) =>
        `<${tag}${align[k] ? ` style="text-align:${align[k]}"` : ""}>${renderInline(text, ctx.base)}</${tag}>`;
      const rows: string[] = [];
      i += 2;
      while (i < lines.length && !isBlank(lines[i]) && lines[i].includes("|")) {
        rows.push(
          `<tr>${splitRow(lines[i])
            .map((c, k) => cell("td", c, k))
            .join("")}</tr>`,
        );
        i++;
      }
      out.push(
        `<div class="md-table"><table><thead><tr>${head.map((c, k) => cell("th", c, k)).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table></div>`,
      );
      continue;
    }

    if (QUOTE.test(line)) {
      const inner: string[] = [];
      while (i < lines.length && QUOTE.test(lines[i])) {
        inner.push(QUOTE.exec(lines[i])![1]);
        i++;
      }
      out.push(`<blockquote>${renderBlocks(inner, ctx)}</blockquote>`);
      continue;
    }

    if (BULLET.test(line) || ORDERED.test(line)) {
      const list = renderList(lines, i, ctx);
      out.push(list.html);
      i = list.next;
      continue;
    }

    // a paragraph: consecutive lines up to a blank line or the start of another block
    const para: string[] = [];
    while (
      i < lines.length &&
      !isBlank(lines[i]) &&
      !FENCE.test(lines[i]) &&
      !HEADING.test(lines[i]) &&
      !QUOTE.test(lines[i]) &&
      !(HR.test(lines[i]) && !BULLET.test(lines[i])) &&
      !((BULLET.test(lines[i]) || ORDERED.test(lines[i])) && para.length > 0) &&
      !(
        lines[i].includes("|") &&
        i + 1 < lines.length &&
        TABLE_SEP.test(lines[i + 1]) &&
        para.length > 0
      )
    ) {
      para.push(lines[i].trim());
      i++;
    }
    const html = renderInline(para.join(" "), ctx.base);
    out.push(tight ? html : `<p>${html}</p>`);
  }
  return out.join("\n");
}

/**
 * Markdown -> safe HTML. `base` is the URL of the markdown file itself: relative links and images
 * resolve against it. Never throws.
 */
export function renderMarkdown(markdown: string, base: string | null = null): string {
  const lines = markdown.replace(/\r\n?/g, "\n").replace(/\t/g, "    ").split("\n");
  try {
    return renderBlocks(lines, { base });
  } catch {
    return `<pre>${escapeHtml(markdown)}</pre>`;
  }
}
