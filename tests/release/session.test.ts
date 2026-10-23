import { describe, expect, it } from "vitest";
import { resolveSession, type SessionResponseLike } from "../../src/lib/release/session";

function fakeRes(ok: boolean, body: unknown): SessionResponseLike {
  return { ok, json: async () => body };
}

describe("resolveSession (plan D6)", () => {
  it("a 404 (public GitHub Pages: the file does not exist) is public", async () => {
    const s = await resolveSession(async () => fakeRes(false, null));
    expect(s.preview).toBe(false);
  });

  it("a network error is public, never a throw", async () => {
    const s = await resolveSession(async () => {
      throw new Error("offline");
    });
    expect(s.preview).toBe(false);
  });

  it("only a 200 with preview: true is preview", async () => {
    const s = await resolveSession(async () => fakeRes(true, { preview: true }));
    expect(s.preview).toBe(true);
  });

  it("a 200 with preview: false, or missing, is public", async () => {
    expect((await resolveSession(async () => fakeRes(true, { preview: false }))).preview).toBe(
      false,
    );
    expect((await resolveSession(async () => fakeRes(true, {}))).preview).toBe(false);
  });

  it("a 200 with an unparsable body is public, not a throw", async () => {
    const res: SessionResponseLike = {
      ok: true,
      json: async () => {
        throw new Error("bad json");
      },
    };
    const s = await resolveSession(async () => res);
    expect(s.preview).toBe(false);
  });
});
