// WP11 item 9: the README renderer behind the Methods modal. Every rule one small fixture: headings,
// lists (nested), tables, links rewritten (relative resolved against the README's URL, new tab,
// noopener), images, code, and above all NO raw HTML or script passthrough.
import { describe, expect, it } from "vitest";
import { escapeHtml, renderMarkdown, resolveMarkdownUrl } from "../../src/lib/markdown/render";

const BASE = "https://example.test/atlas/biotrack_indicators/README.md";
const md = (s: string) => renderMarkdown(s, BASE);

describe("blocks", () => {
  it("headings h1..h6 and paragraphs (wrapped lines join)", () => {
    expect(md("# Title\n\n## Credits\n\nOne line\nsecond line.")).toBe(
      "<h1>Title</h1>\n<h2>Credits</h2>\n<p>One line second line.</p>",
    );
    expect(md("###### six")).toBe("<h6>six</h6>");
  });
  it("bulleted and numbered lists, with a nested list under an item", () => {
    expect(md("- Citation: x\n- Contacts:\n  - Ana, PI\n  - Bo, author\n- Funders: y")).toBe(
      "<ul><li>Citation: x</li><li>Contacts:\n<ul><li>Ana, PI</li><li>Bo, author</li></ul></li><li>Funders: y</li></ul>",
    );
    expect(md("1. one\n2. two")).toBe("<ol><li>one</li><li>two</li></ol>");
  });
  it("a GFM table: header, body rows, alignment, cells rendered inline", () => {
    const html = md(
      "| Asset | File |\n|---|---:|\n| `hex` | `hex.pmtiles` |\n| values | **big** |",
    );
    expect(html).toContain(
      '<thead><tr><th>Asset</th><th style="text-align:right">File</th></tr></thead>',
    );
    expect(html).toContain(
      '<td><code>hex</code></td><td style="text-align:right"><code>hex.pmtiles</code></td>',
    );
    expect(html).toContain('<td style="text-align:right"><strong>big</strong></td>');
    expect(html.match(/<tr>/g)).toHaveLength(3);
  });
  it("fenced code is literal (escaped, never interpreted)", () => {
    expect(md("```r\nx <- 1 < 2 & **not bold**\n```")).toBe(
      "<pre><code>x &lt;- 1 &lt; 2 &amp; **not bold**</code></pre>",
    );
  });
  it("blockquotes and rules", () => {
    expect(md("> quoted *text*")).toBe("<blockquote><p>quoted <em>text</em></p></blockquote>");
    expect(md("above\n\n---\n\nbelow")).toBe("<p>above</p>\n<hr>\n<p>below</p>");
  });
});

describe("inline", () => {
  it("code, bold, italic", () => {
    expect(md("a `values.parquet` and **bold** and *it* and _it2_")).toBe(
      "<p>a <code>values.parquet</code> and <strong>bold</strong> and <em>it</em> and <em>it2</em></p>",
    );
  });
  it("snake_case words are not emphasis", () => {
    expect(md("the values_h3 and cell_species tables")).toBe(
      "<p>the values_h3 and cell_species tables</p>",
    );
  });
  it("a link opens in a new tab with noopener noreferrer", () => {
    expect(md("[OBIS](https://obis.org/data)")).toBe(
      '<p><a href="https://obis.org/data" target="_blank" rel="noopener noreferrer">OBIS</a></p>',
    );
  });
  it("a bare URL and an <autolink> become links", () => {
    const html = md("see https://oceanmetrics.io/atlas/, or <https://doi.org/10.1/x>.");
    expect(html).toContain('href="https://oceanmetrics.io/atlas/"');
    expect(html).toContain('href="https://doi.org/10.1/x"');
    // the trailing comma stays outside the link
    expect(html).toContain(">https://oceanmetrics.io/atlas/</a>,");
  });
});

describe("relative links and images resolve against the README's own URL", () => {
  it("a relative link, a parent-relative link and a relative image", () => {
    const html = md("[items](./items/a.json) [up](../other/README.md) ![thumb](thumbnail.png)");
    expect(html).toContain('href="https://example.test/atlas/biotrack_indicators/items/a.json"');
    expect(html).toContain('href="https://example.test/atlas/other/README.md"');
    expect(html).toContain(
      '<img src="https://example.test/atlas/biotrack_indicators/thumbnail.png" alt="thumb" loading="lazy">',
    );
  });
  it("resolveMarkdownUrl: base-relative, absolute, mailto only for links, others refused", () => {
    expect(resolveMarkdownUrl("a/b.png", BASE, false)).toBe(
      "https://example.test/atlas/biotrack_indicators/a/b.png",
    );
    expect(resolveMarkdownUrl("https://x.test/p", BASE, false)).toBe("https://x.test/p");
    expect(resolveMarkdownUrl("mailto:a@b.test", BASE, true)).toBe("mailto:a@b.test");
    expect(resolveMarkdownUrl("mailto:a@b.test", BASE, false)).toBeNull();
    for (const bad of [
      "javascript:alert(1)",
      "data:text/html,x",
      "file:///etc/passwd",
      "#frag",
      "",
      "  ",
    ]) {
      expect(resolveMarkdownUrl(bad, BASE, true)).toBeNull();
    }
    expect(resolveMarkdownUrl("x.png", null, false)).toBeNull(); // no base, relative: unusable
  });
  it("a relative link with no base is plain text, not a broken link", () => {
    expect(renderMarkdown("[x](./a.md)")).toBe("<p>x</p>");
  });
});

describe("REGRESSION: no raw HTML or script passthrough", () => {
  it("raw tags come out as visible, escaped text", () => {
    const html = md('<script>alert(1)</script>\n\nhello <img src=x onerror="alert(1)"> <b>b</b>');
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<b>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
  });
  it("javascript: and data: links lose their href (text stays)", () => {
    const html = md(
      "[click](javascript:alert(1)) [d](data:text/html;base64,AAAA) [ok](https://ok.test/)",
    );
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("data:");
    expect(html.match(/<a /g)).toHaveLength(1);
    expect(html).toContain(">click");
  });
  it("an image with a javascript: src is just its alt text", () => {
    const html = md("![alt text](javascript:alert(1))");
    expect(html).toBe("<p>alt text</p>");
  });
  it("attribute-breaking quotes in a URL or alt are escaped", () => {
    const html = md('[a](https://x.test/"onmouseover="alert(1)) ![al"t](https://x.test/i.png)');
    expect(html).not.toMatch(/"onmouseover=/);
    expect(html).toContain('alt="al&quot;t"');
  });
  it("a fragment-only link is text (a hash is the app's view state)", () => {
    expect(md("[jump](#methods)")).toBe("<p>jump</p>");
  });
  it("escapeHtml covers & < > \" '", () => {
    expect(escapeHtml(`<a href="x">&'</a>`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;",
    );
  });
  it("garbage in never throws", () => {
    expect(() => md("\u0000 9  [[[ ](( ))) ||| \n|-|-|\n")).not.toThrow();
  });
});

describe("a real README shape (the biotrack collection's)", () => {
  const README = [
    "# MBON BioTrack biodiversity indicators",
    "",
    "Prototype (`atlas:status: prototype`). Part of the OceanMetrics Atlas (https://oceanmetrics.io/atlas/).",
    "",
    "## Credits",
    "",
    "- Citation (placeholder): Couto, T.B.A. (in prep).",
    "- Contacts:",
    "  - Neil Hammerschlag, principal investigator (neil@example.test)",
    "- Funders: NOAA IOOS MBON",
    "",
    "## Assets",
    "",
    "| Asset | File | What it holds |",
    "|---|---|---|",
    "| `hex` | `hex.pmtiles` | hex grid, layer `hex`, attribute `FID` only |",
    "| `values` | `values.parquet` | one row per FID, columns `{group}_{season}_{suffix}` |",
  ].join("\n");
  it("renders headings, nested lists and the table, with the bare URL linked", () => {
    const html = md(README);
    expect(html).toContain("<h1>MBON BioTrack biodiversity indicators</h1>");
    expect(html).toContain("<h2>Credits</h2>");
    expect(html).toContain("<ul><li>Citation (placeholder)");
    expect(html).toMatch(/<li>Contacts:\s*<ul><li>Neil Hammerschlag/);
    expect(html).toContain("<code>{group}_{season}_{suffix}</code>");
    expect(html).toContain('<a href="https://oceanmetrics.io/atlas/"');
    expect(html.match(/<tr>/g)).toHaveLength(3);
  });
});
