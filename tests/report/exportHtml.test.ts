import { afterEach, describe, expect, it, vi } from "vitest";
import { assembleStandaloneHtml, fetchAsDataUrl } from "../../src/report/exportHtml";

describe("assembleStandaloneHtml", () => {
  it("inlines the css and body verbatim, with an escaped title", () => {
    const html = assembleStandaloneHtml({
      title: "GAA & GAB",
      css: "body{color:red}",
      bodyHtml: "<main>hi</main>",
    });
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("<title>GAA &amp; GAB</title>");
    expect(html).toContain("<style>body{color:red}</style>");
    expect(html).toContain("<main>hi</main>");
  });

  it("is a single self-contained document: no <link> or external <script>", () => {
    const html = assembleStandaloneHtml({ title: "t", css: "", bodyHtml: "<p>x</p>" });
    expect(html).not.toMatch(/<link\b/);
    expect(html).not.toMatch(/<script\b/);
  });

  // B5 (docs/usability.md): the downloaded HTML rendered white text on a light page, because this
  // function's own `<html>` tag never carried `data-theme="paper"` -- `tokens.css`'s bare `:root`
  // (no `data-theme`) IS the dark "navy" theme, so every `var(--...)` token in the collected CSS
  // resolved against navy while the page's literal backgrounds stayed light. `report.html` itself
  // has always set this explicitly (its own header comment) -- this function builds a FRESH
  // `<html>` tag, so it needs its own copy of the same fix.
  it("B5: the exported <html> carries data-theme=paper and color-scheme: light", () => {
    const html = assembleStandaloneHtml({ title: "t", css: "", bodyHtml: "<p>x</p>" });
    const htmlTag = /<html\b[^>]*>/.exec(html)?.[0];
    expect(htmlTag).toBeDefined();
    expect(htmlTag).toContain('data-theme="paper"');
    expect(htmlTag).toContain("color-scheme: light");
  });
});

describe("fetchAsDataUrl (B5: inlining the seal for the offline export)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("resolves a successful fetch to a data: URI via FileReader", async () => {
    const blob = new Blob(["<svg></svg>"], { type: "image/svg+xml" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, blob: async () => blob })),
    );
    class FakeFileReader {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      result: string | null = null;
      readAsDataURL() {
        this.result = "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=";
        this.onload?.();
      }
    }
    vi.stubGlobal("FileReader", FakeFileReader as unknown as typeof FileReader);
    await expect(fetchAsDataUrl("https://example.org/seal.svg")).resolves.toBe(
      "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=",
    );
  });

  it("never throws -- a failed fetch (offline, 404, CORS) resolves null", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false })),
    );
    await expect(fetchAsDataUrl("https://example.org/seal.svg")).resolves.toBeNull();

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network error");
      }),
    );
    await expect(fetchAsDataUrl("https://example.org/seal.svg")).resolves.toBeNull();
  });
});
