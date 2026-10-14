// A `fetch` stand-in that serves tests/fixtures/catalog/ under two made-up origins, so the loader is
// exercised end to end with no network: the catalog's own base, and the MarineSensitivity STAC's.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const FIXTURE_BASE = "https://atlas.test/atlas/";
export const MST_BASE = "https://file.marinesensitivity.org/stac/";
const ROOT = join(__dirname, "../fixtures/catalog");

export type Override = (url: string) => Response | Promise<Response> | undefined;

export interface FakeFetch {
  fetch: typeof fetch;
  /** every URL requested, in order. */
  calls: string[];
}

function fixturePath(url: string): string | null {
  if (url.startsWith(FIXTURE_BASE)) return join(ROOT, url.slice(FIXTURE_BASE.length));
  if (url.startsWith(MST_BASE)) return join(ROOT, "mst", url.slice(MST_BASE.length));
  return null;
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** serves the fixture tree; `override` may answer a URL itself (a 500, bad JSON, a thrown error). */
export function fakeFetch(override?: Override): FakeFetch {
  const calls: string[] = [];
  const impl = async (input: RequestInfo | URL): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push(url);
    const forced = override?.(url);
    if (forced) return forced;
    const path = fixturePath(url);
    if (!path || !existsSync(path)) return new Response("not found", { status: 404 });
    return new Response(readFileSync(path), { status: 200 });
  };
  return { fetch: impl as typeof fetch, calls };
}
