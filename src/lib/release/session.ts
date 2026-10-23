// Preview-mode detection (plan D6): a same-origin `session.json` is the SOLE way into preview mode.
// It exists only on the preview host (Caddy answers it there, behind Cloudflare Access); GitHub
// Pages has no such file, so a 404 there means "public" — same as a network error (offline, CORS
// failure, DNS hiccup). Anything other than a clean 200 with `{"preview": true}` in the body
// defaults to "public": the app must never fail OPEN into preview mode.
export interface SessionInfo {
  preview: boolean;
  raw: unknown;
}

export const PUBLIC_SESSION: SessionInfo = { preview: false, raw: null };

// the slice of `Response` this needs, so callers (and tests) don't have to construct a real one.
export type SessionResponseLike = Pick<Response, "ok" | "json">;

export async function resolveSession(
  fetchSession: () => Promise<SessionResponseLike>,
): Promise<SessionInfo> {
  let res: SessionResponseLike;
  try {
    res = await fetchSession();
  } catch {
    return PUBLIC_SESSION; // network error = public
  }

  if (!res.ok) return PUBLIC_SESSION; // 404 (or any non-2xx) = public

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return PUBLIC_SESSION; // not valid JSON = public, never throw into preview
  }

  const preview =
    !!body && typeof body === "object" && (body as Record<string, unknown>).preview === true;
  return { preview, raw: body };
}
