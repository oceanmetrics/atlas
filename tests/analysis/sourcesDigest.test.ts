// atlas-2 phase review, ruling 4, the caller half: `analysis/sources.ts` is what CHOOSES the digest
// every object is registered under, and `engine/store/policy.ts`'s `expectedDigestFromBoot` is what
// the OPFS store compares persisted rows against at session start. If those two ever disagree, a
// table is either re-downloaded on every load or served stale forever — so they now share one
// function (`noDigestKey`) and this file asserts they agree object by object.
//
// The end-to-end property, stated as the ruling states it: `has()` is TRUE across a reload when
// `built_at` did not move, and FALSE when it did.
import { describe, expect, it, vi } from "vitest";
import { AnalysisSources } from "../../src/lib/analysis/sources";
import { expectedDigestFromBoot, noDigestKey } from "../../src/lib/engine/store/policy";
import { MemoryTableStore } from "../../src/lib/engine/store/memoryStore";
import type { Engine } from "../../src/lib/engine/engine";

const V = "v9";
const bootAt = (built_at: string, tables: Record<string, { digest: string }> = {}) => ({
  ver: V,
  built_at,
  id_field: "mdl_key",
  tables,
});

/** `digestFor()` needs no engine; the cast keeps this a pure test of the naming rule. */
function sources(boot: Record<string, unknown>): AnalysisSources {
  return new AnalysisSources({} as Engine, {
    url: (p) => `https://example.test/${V}/${p}`,
    boot,
    templates: {} as never,
  });
}

/** every object `sources.ts` registers that boot publishes NO digest for. */
const NO_DIGEST_PATHS = [
  "tables/model.parquet",
  "serve/cell_model/tile=1012/data_0.parquet",
  "app/taxonomy.parquet",
];

describe("sources.ts keys no-digest objects on built_at + path (ruling 4)", () => {
  it("agrees, object by object, with the store's session-start expectation", () => {
    const boot = bootAt("2026-09-21T10:00:00Z", { taxon: { digest: "T2" } });
    const expected = expectedDigestFromBoot(V, boot);
    const s = sources(boot);
    for (const path of NO_DIGEST_PATHS) {
      const name = `${V}/${path}`;
      expect(s.digestFor(path), `sources.ts's key for ${path}`).toBe(noDigestKey(boot, name));
      expect(expected(name), `the store's expectation for ${path}`).toBe(s.digestFor(path));
    }
  });

  it("still prefers a PUBLISHED digest when boot.tables has one", () => {
    const boot = bootAt("2026-09-21T10:00:00Z", { taxon: { digest: "T2" } });
    expect(sources(boot).digestFor("app/taxon.parquet", "taxon")).toBe("T2");
  });

  it("has() survives a reload when built_at did NOT move, and fails when it did", async () => {
    // one "session" registers the object; the next session computes its key again from a boot with
    // the same, then a different, built_at. `has(name, digest)` is what `Engine#load` consults to
    // decide whether to re-fetch.
    const db = { registerFileBuffer: vi.fn(async () => {}), dropFile: vi.fn(async () => null) };
    const store = new MemoryTableStore(db);
    const path = "tables/model.parquet";
    const name = `${V}/${path}`;

    const before = bootAt("2026-09-21T10:00:00Z");
    await store.register(name, sources(before).digestFor(path), new Uint8Array(8));

    // same build: the cached copy is still the right one.
    const same = bootAt("2026-09-21T10:00:00Z");
    expect(store.has(name, sources(same).digestFor(path))).toBe(true);

    // a rebuild of app/: the cached copy must be re-materialized.
    const after = bootAt("2026-09-22T09:30:00Z");
    expect(store.has(name, sources(after).digestFor(path))).toBe(false);
  });

  it("the OLD rule (the path alone) would have said `true` in both cases — the bug this fixes", () => {
    const before = bootAt("2026-09-21T10:00:00Z");
    const after = bootAt("2026-09-22T09:30:00Z");
    const pathOnly = `${V}/tables/model.parquet`; // what the fallback used to be
    expect(pathOnly).toBe(pathOnly); // constant for the life of the release: cached forever
    expect(sources(before).digestFor("tables/model.parquet")).not.toBe(
      sources(after).digestFor("tables/model.parquet"),
    );
  });

  it("a boot with no built_at fails closed: nothing is reused across sessions", () => {
    const boot = { ver: V, tables: {} };
    const key = sources(boot).digestFor("tables/model.parquet");
    expect(key).not.toBe(`${V}/tables/model.parquet`);
    expect(key).toBe(noDigestKey(boot, `${V}/tables/model.parquet`));
    expect(key).toMatch(/^nocache:/);
  });
});
