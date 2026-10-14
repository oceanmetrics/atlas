// resolve.ts: the deep-link resolver (merged key, raw input key, legacy mdl_seq), the US-only
// clearing rule, the two "Model not found" explanations, the canonical rewrite and the event shape.
import { describe, expect, expectTypeOf, it } from "vitest";
import {
  MERGED_IN,
  canonicalUrl,
  deepLinkKey,
  notFoundReasons,
  resolveDeepLink,
  resolveFromAlias,
  targetOf,
  type DeepLinkEvent,
} from "../../../src/lens/species/data/resolve";
import { createShardCache } from "../../../src/lens/species/data/shards";
import { parseSel } from "../../../src/lib/state/codec";
import type { EventParamsMap } from "../../../src/lib/analytics/events";
import { fixtureFetch, taxaIndexFor } from "./fixtures";

const LEATHERBACK = "ms_merge|WORMS:137209";
const WRYBILL = "ms_merge|BOTW:22693928";
const opts = () => ({
  fetchJson: fixtureFetch(),
  cache: createShardCache(),
  index: taxaIndexFor("v9"),
});

describe("which key the URL is asking with", () => {
  it("sp wins, then mdl_key, then mdl_seq", () => {
    expect(deepLinkKey(new URLSearchParams("sp=A&mdl_key=B&mdl_seq=3"))).toEqual({
      key: "A",
      legacy: false,
    });
    expect(deepLinkKey(new URLSearchParams("mdl_key=B&mdl_seq=3"))).toEqual({
      key: "B",
      legacy: true,
    });
    expect(deepLinkKey(new URLSearchParams("mdl_seq=3"))).toEqual({ key: "3", legacy: true });
    expect(deepLinkKey(new URLSearchParams(""))).toBeNull();
  });
});

describe("?sp= / ?mdl_key= (merged)", () => {
  it("a merged key resolves to (sp, merged) and logs nothing for a modern link", async () => {
    const r = await resolveDeepLink("v9", new URLSearchParams(`sp=${LEATHERBACK}`), opts());
    expect(r).toMatchObject({ kind: "species", sp: LEATHERBACK, in: MERGED_IN, clearUs: false });
    if (r.kind !== "species") return;
    expect(r.event).toBeNull();
  });

  it("a legacy mdl_key naming the merged model logs resolution=merged_model", async () => {
    const r = await resolveDeepLink("v9", new URLSearchParams(`mdl_key=${LEATHERBACK}`), opts());
    if (r.kind !== "species") throw new Error(r.kind);
    expect(r.resolution).toBe("merged_model");
    expect(r.event).toEqual({
      name: "deeplink_mdl_key",
      params: { mdl_key: LEATHERBACK, resolution: "merged_model" },
    });
  });
});

describe("?mdl_key= (a raw input key)", () => {
  it("resolves through the alias shard to (sp, in) and logs resolution=input_model", async () => {
    const r = await resolveDeepLink("v9", new URLSearchParams("mdl_key=ax|137209"), opts());
    if (r.kind !== "species") throw new Error(r.kind);
    expect(r.sp).toBe(LEATHERBACK);
    expect(r.in).toBe("ax");
    expect(r.resolution).toBe("input_model");
    expect(r.event?.params.resolution).toBe("input_model");
  });

  it("works for a mask input too (rng_iucn)", async () => {
    const r = await resolveDeepLink("v9", new URLSearchParams("mdl_key=rng_iucn|15106"), opts());
    if (r.kind !== "species") throw new Error(r.kind);
    expect([r.sp, r.in]).toEqual(["ms_merge|WORMS:137077", "rng_iucn"]);
  });
});

describe("?mdl_seq= (v1-v7b legacy)", () => {
  it("an integer id resolves to the v7 merged key", async () => {
    const r = await resolveDeepLink("v7", new URLSearchParams("mdl_seq=54383"), {
      fetchJson: fixtureFetch(),
      cache: createShardCache(),
      index: taxaIndexFor("v7"),
    });
    if (r.kind !== "species") throw new Error(r.kind);
    expect([r.sp, r.in, r.resolution]).toEqual(["54383", MERGED_IN, "merged_model"]);
  });

  it("a legacy RAW input id resolves to (merged, its ds_key)", async () => {
    const r = await resolveDeepLink("v7", new URLSearchParams("mdl_seq=790"), {
      fetchJson: fixtureFetch(),
      cache: createShardCache(),
      index: taxaIndexFor("v7"),
    });
    if (r.kind !== "species") throw new Error(r.kind);
    expect([r.sp, r.in, r.resolution]).toEqual(["54383", "am_0.05", "input_model"]);
  });
});

describe("a non-US target turns the US-only box off", () => {
  it("clearUs is true for a taxon that is not valid_usa", async () => {
    const r = await resolveDeepLink("v9", new URLSearchParams(`mdl_key=${WRYBILL}`), opts());
    if (r.kind !== "species") throw new Error(r.kind);
    expect(r.clearUs).toBe(true);
    expect(targetOf(r, parseSel({ search: "", hash: "" }))).toEqual({
      sp: WRYBILL,
      in: MERGED_IN,
      us: false,
    });
  });

  it("clearUs is false for a US-valid taxon (the box stays as the user left it)", async () => {
    const r = await resolveDeepLink("v9", new URLSearchParams(`mdl_key=${LEATHERBACK}`), opts());
    if (r.kind !== "species") throw new Error(r.kind);
    expect(r.clearUs).toBe(false);
    expect(targetOf(r, parseSel({ search: "", hash: "" }))?.us).toBe(true);
  });

  it("an input link inherits its TAXON's validity", async () => {
    const r = await resolveDeepLink("v9", new URLSearchParams("mdl_key=bl|22693928"), opts());
    if (r.kind !== "species") throw new Error(r.kind);
    expect([r.sp, r.in, r.clearUs]).toEqual([WRYBILL, "bl", true]);
  });

  it("without the index loaded yet, an unknown validity clears the box rather than hiding the taxon", () => {
    const r = resolveFromAlias("k", { mergedKey: "m", dsKey: "am" }, null);
    if (r.kind !== "species") throw new Error(r.kind);
    expect(r.clearUs).toBe(true);
  });
});

describe("an unknown key", () => {
  it("is not-found, with the two explanations of section 4", async () => {
    const r = await resolveDeepLink("v9", new URLSearchParams("mdl_key=am|gone-9999"), opts());
    if (r.kind !== "not-found") throw new Error(r.kind);
    expect(r.reasons).toEqual(notFoundReasons("am|gone-9999"));
    expect(r.reasons[0]).toContain("no longer available");
    expect(r.reasons[2]).toContain("US Exclusive Economic Zone");
    expect(r.event.params.resolution).toBe("not_found");
  });

  it("a shard that fails to load is the same user-visible outcome", async () => {
    const r = await resolveDeepLink("v9", new URLSearchParams("mdl_key=x|1"), {
      fetchJson: async () => {
        throw new Error("offline");
      },
      cache: createShardCache(),
      index: taxaIndexFor("v9"),
    });
    expect(r.kind).toBe("not-found");
  });

  it("no species key at all is 'none', not 'not-found'", async () => {
    expect((await resolveDeepLink("v9", new URLSearchParams("lens=scores"), opts())).kind).toBe(
      "none",
    );
  });
});

describe("the canonical URL", () => {
  it("rewrites a legacy input link to sp + in, dropping the legacy key", () => {
    const r = resolveFromAlias(
      "ax|137209",
      { mergedKey: LEATHERBACK, dsKey: "ax" },
      taxaIndexFor("v9"),
    );
    if (r.kind !== "species") throw new Error(r.kind);
    const loc = { search: "?mdl_key=ax%7C137209", hash: "" };
    const { search } = canonicalUrl(loc, targetOf(r, parseSel(loc))!);
    // `|` stays percent-encoded (state/codec.ts un-escapes only `,` and `:` for readability)
    expect(search).toBe("?sp=ms_merge%7CWORMS:137209&in=ax");
    expect(search).not.toContain("mdl_key");
  });

  it("never writes a retired scores-era key (out, ver) into the link", () => {
    const { search } = canonicalUrl(
      { search: "?mdl_seq=54383&out=ecoregion&ver=v9", hash: "" },
      { sp: "54383", in: MERGED_IN },
    );
    expect(search).not.toContain("out=");
    expect(search).not.toContain("ver=");
  });

  it("omits in= for the merged model and rep= for the default representation", () => {
    const { search } = canonicalUrl(
      { search: "?mdl_seq=54383", hash: "" },
      { sp: "54383", in: MERGED_IN },
    );
    expect(search).toBe("?sp=54383");
  });

  it("writes rep= only when it is not the default", () => {
    const loc = { search: "", hash: "" };
    expect(canonicalUrl(loc, { sp: "k", in: "ax", rep: "model" }).search).toBe(
      "?sp=k&in=ax&rep=model",
    );
    expect(canonicalUrl(loc, { sp: "k", in: "ax", rep: "native" }).search).toBe("?sp=k&in=ax");
  });

  it("carries us=0 when the resolver cleared the box, and keeps other view state", () => {
    const loc = { search: "?mdl_key=bl%7C22693928&proj=mercator", hash: "#t=Title" };
    const out = canonicalUrl(loc, { sp: WRYBILL, in: "bl", us: false });
    expect(out.search).toContain("us=0");
    expect(out.search).toContain("proj=mercator");
    expect(out.hash).toBe("#t=Title");
  });
});

describe("the analytics event is data, not a call", () => {
  it("has exactly the shape events.ts types for deeplink_mdl_key", () => {
    expectTypeOf<DeepLinkEvent["params"]>().toEqualTypeOf<EventParamsMap["deeplink_mdl_key"]>();
  });

  it("resolve.ts imports nothing from analytics/", async () => {
    const src = await import("node:fs").then((fs) =>
      fs.readFileSync(
        new URL("../../../src/lens/species/data/resolve.ts", import.meta.url),
        "utf8",
      ),
    );
    expect(src).not.toMatch(/from "[^"]*analytics/);
  });
});
