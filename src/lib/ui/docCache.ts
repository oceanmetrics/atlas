// The fetch + render of a markdown document, shared by `DocModal.svelte`: one request per URL (the
// promise is cached, a failure is forgotten so a retry fetches again), the renderer loaded on first
// use (`import()` keeps `lib/markdown/render.ts` off the static path).
export type RenderedDoc = { ok: true; html: string } | { ok: false; error: string };

const cache = new Map<string, Promise<RenderedDoc>>();

export function renderedDoc(
  url: string,
  fetchImpl: typeof fetch = (...args) => fetch(...args),
): Promise<RenderedDoc> {
  const hit = cache.get(url);
  if (hit) return hit;
  const p = (async (): Promise<RenderedDoc> => {
    try {
      const res = await fetchImpl(url);
      if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
      const text = await res.text();
      const { renderMarkdown } = await import("../markdown/render");
      return { ok: true, html: renderMarkdown(text, url) };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  })();
  cache.set(url, p);
  void p.then((r) => {
    if (!r.ok) cache.delete(url);
  });
  return p;
}

/** forget every cached document (tests). */
export function clearDocCache(): void {
  cache.clear();
}
