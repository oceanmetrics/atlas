import { describe, expect, it } from "vitest";
import {
  PUBLIC_DATA_BASE,
  dataBase,
  dataUrl,
  normalizeDataBase,
  registryUrl,
  sessionDataBase,
} from "../../src/lib/release/dataBase";

// plan D6: "dataBase(ver) is the one place a data origin is formed, and it prefers session.data
// when present". These pin the literal bucket URL and the validation `session.data` has to pass.

describe("PUBLIC_DATA_BASE", () => {
  it("is the literal registry prefix on the storage host, with the marine-atlas/ prefix and a trailing /", () => {
    // not "looks absolute": the bare …/{ver}/… path without marine-atlas/ answers 403, and a
    // relative base is the F1 bug (under /v9/atlas/ it produced /v9/atlas/v9/manifest.json).
    // the storage host since catalog 0.6.0 (path-style S3 before the cutover of 2026-10-23)
    expect(PUBLIC_DATA_BASE).toBe("https://storage.oceanmetrics.io/marine-atlas/");
  });

  it("composes the registry files", () => {
    expect(registryUrl("latest.txt")).toBe(`${PUBLIC_DATA_BASE}latest.txt`);
    expect(registryUrl("versions.json")).toBe(`${PUBLIC_DATA_BASE}versions.json`);
  });
});

describe("dataUrl", () => {
  it("puts the version segment exactly once, from the absolute base", () => {
    expect(dataUrl("v9", "manifest.json")).toBe(`${PUBLIC_DATA_BASE}v9/manifest.json`);
    expect(dataUrl("v9", "app/boot.json")).toBe(`${PUBLIC_DATA_BASE}v9/app/boot.json`);
  });

  it("tolerates a leading slash on the key without doubling it", () => {
    expect(dataUrl("v7", "/manifest.json")).toBe(`${PUBLIC_DATA_BASE}v7/manifest.json`);
  });
});

describe("normalizeDataBase (what a session.json body has to pass)", () => {
  it("accepts an https prefix and gives it a trailing slash", () => {
    expect(normalizeDataBase("https://data.example.org/p")).toBe("https://data.example.org/p/");
    expect(normalizeDataBase("https://data.example.org/p/")).toBe("https://data.example.org/p/");
  });

  it("rejects http (never downgrade the data origin)", () => {
    expect(normalizeDataBase("http://data.example.org/p/")).toBeNull();
  });

  it("rejects a relative value, which would silently mean same-origin", () => {
    expect(normalizeDataBase("./data/")).toBeNull();
    expect(normalizeDataBase("/data/")).toBeNull();
  });

  it("rejects other schemes", () => {
    for (const v of ["data:text/plain,x", "blob:https://x/y", "file:///tmp/"]) {
      expect(normalizeDataBase(v)).toBeNull();
    }
  });

  it("rejects embedded credentials", () => {
    expect(normalizeDataBase("https://user:pass@data.example.org/p/")).toBeNull();
  });

  it("rejects a value carrying a query or fragment (it is a prefix, not a request)", () => {
    expect(normalizeDataBase("https://data.example.org/p/?x=1")).toBeNull();
    expect(normalizeDataBase("https://data.example.org/p/#f")).toBeNull();
  });

  it("rejects non-strings and the empty string", () => {
    for (const v of [null, undefined, 42, {}, [], ""]) expect(normalizeDataBase(v)).toBeNull();
  });
});

describe("sessionDataBase (honoured only in preview — plan D6)", () => {
  const data = "https://data.example.org/secret/";

  it("is used when the session is preview", () => {
    expect(sessionDataBase("v9", { preview: true, raw: { preview: true, data } })).toBe(data);
  });

  it("is ignored when the session is not preview, however the body looks", () => {
    expect(sessionDataBase("v9", { preview: false, raw: { preview: false, data } })).toBeNull();
  });

  it("is ignored when there is no session at all (the public host)", () => {
    expect(sessionDataBase("v9", null)).toBeNull();
  });

  it("reads a per-version map for the version asked for, and only that one", () => {
    const raw = { preview: true, data: { v9: data } };
    expect(sessionDataBase("v9", { preview: true, raw })).toBe(data);
    expect(sessionDataBase("v8", { preview: true, raw })).toBeNull();
  });

  it("ignores a map entry that fails validation", () => {
    const raw = { preview: true, data: { v9: "../elsewhere/" } };
    expect(sessionDataBase("v9", { preview: true, raw })).toBeNull();
  });
});

describe("dataBase", () => {
  it("falls back to the public bucket whenever session.data is absent or invalid", () => {
    expect(dataBase("v9", null)).toBe(PUBLIC_DATA_BASE);
    expect(dataBase("v9", { preview: true, raw: {} })).toBe(PUBLIC_DATA_BASE);
    expect(dataBase("v9", { preview: true, raw: { data: "not a url" } })).toBe(PUBLIC_DATA_BASE);
  });

  it("prefers a valid session.data on a preview session", () => {
    const s = { preview: true, raw: { data: "https://data.example.org/secret/" } };
    expect(dataUrl("v9", "manifest.json", s)).toBe(
      "https://data.example.org/secret/v9/manifest.json",
    );
  });
});
