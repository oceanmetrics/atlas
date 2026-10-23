import { describe, expect, it } from "vitest";
import { boot, minimalBootCheck } from "../../src/lib/release/boot";

describe("minimalBootCheck (structural-only stand-in for the real JSON Schema, TODO atlas-1)", () => {
  it("accepts any plain object — the real schema is not published yet", () => {
    expect(minimalBootCheck({ grid: { grid_id: "usa05" } })).toEqual({
      grid: { grid_id: "usa05" },
    });
  });

  it("accepts an empty object", () => {
    expect(minimalBootCheck({})).toEqual({});
  });

  it("rejects null, an array, and a non-object", () => {
    for (const raw of [null, undefined, [], "boot", 1]) {
      expect(minimalBootCheck(raw)).toBeNull();
    }
  });
});

describe("boot() (consumes window.__early when present)", () => {
  it("prefers early.boot over fetching", async () => {
    const fetchJson = async () => {
      throw new Error("must not fetch when early.boot is present");
    };
    const b = await boot("v9", { early: { boot: Promise.resolve({ grid: {} }) }, fetchJson });
    expect(b).toEqual({ grid: {} });
  });

  it("falls back to fetchJson when there is no early object", async () => {
    const requested: string[] = [];
    const b = await boot("v9", {
      fetchJson: async (url) => {
        requested.push(url);
        return { grid: {} };
      },
    });
    expect(b).toEqual({ grid: {} });
    expect(requested).toEqual(["https://storage.oceanmetrics.io/marine-atlas/v9/app/boot.json"]);
  });

  it("resolves to null when app/boot.json 404s (it does not exist until atlas-1)", async () => {
    const b = await boot("v9", {
      fetchJson: async () => {
        throw new Error("404");
      },
    });
    expect(b).toBeNull();
  });

  it("resolves to null, never a throw, when early.boot rejects", async () => {
    const b = await boot("v9", { early: { boot: Promise.reject(new Error("network")) } });
    expect(b).toBeNull();
  });

  it("resolves to null when there is neither an early object nor a fetchJson", async () => {
    expect(await boot("v9")).toBeNull();
  });

  it("passes the raw payload through an injected validator", async () => {
    let sawRaw: unknown;
    const validate = (raw: unknown) => {
      sawRaw = raw;
      return null;
    };
    await boot("v9", { early: { boot: Promise.resolve({ units: [] }) }, validate });
    expect(sawRaw).toEqual({ units: [] });
  });
});

// TODO(atlas-1): once msens publishes boot.json's JSON Schema, copy it into this repo and add a
// drift guard comparing its sha256 against msens `main`, mirroring tests/pins.test.ts's verdict-drift
// pattern. Until then boot() validates with minimalBootCheck() only (see src/lib/release/boot.ts).
it.skip("boot.json JSON Schema sha256 matches msens main (TODO atlas-1: schema not yet published)", () => {
  expect(true).toBe(false); // placeholder body; never runs while skipped
});
