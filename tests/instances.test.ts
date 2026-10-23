// Instances (instances/<id>/, VITE_INSTANCE): every instance.json validates against
// instances/instance.schema.json, the built instance only picks values its build knows (Lens, ToolName,
// CatalogGroup stay compile-time unions), every file an instance names exists, and the HTML entries are
// filled from it. The schema validator is scripts/instance.mjs's hand validator (no ajv dependency);
// each of its rules has a seeded fault below.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  instanceDir,
  instanceId,
  listInstanceAssets,
  listInstances,
  loadInstance,
  parseMark,
  readInstance,
  readMark,
  renderInstanceHtml,
  SCHEMA_FILE,
  validateInstance,
  wordmarkHtml,
} from "../scripts/instance.mjs";
import { INSTANCE, WORDMARK } from "../src/lib/brand/instance";
import { CATALOG_GROUPS, GROUP_LABEL, GROUP_ORDER } from "../src/lib/catalog/load";
import { ALL_LENSES, DEFAULT_SEL, LENSES, THEMES } from "../src/lib/state/types";
import { ALL_TOOLS, TOOL_ORDER } from "../src/shell/tools";
import {
  CRITICAL_BUDGET_BYTES,
  RUNTIME_WORKER_BUDGET_BYTES,
} from "../scripts/size-budget-core.mjs";

const SCHEMA = JSON.parse(readFileSync(SCHEMA_FILE, "utf8"));
const OM = readInstance("oceanmetrics");

describe("every instance validates against instance.schema.json", () => {
  it("finds both instances", () => {
    expect(listInstances()).toEqual(["marinesensitivity", "oceanmetrics"]);
  });

  it.each(listInstances())("%s", (id) => {
    expect(validateInstance(readInstance(id), SCHEMA)).toEqual([]);
    expect(() => loadInstance(id)).not.toThrow();
  });

  it("the schema is draft 2020-12 and closed at the top", () => {
    expect(SCHEMA.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
    expect(SCHEMA.additionalProperties).toBe(false);
  });
});

// ---- the 1.1 fixtures: tests/fixtures/instance/{valid,invalid}/, invalid.json the expected error ----

const FIX = "tests/fixtures/instance";
const jsonFiles = (dir: string) =>
  readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort();
const readFix = (kind: string, f: string) =>
  JSON.parse(readFileSync(`${FIX}/${kind}/${f}`, "utf8"));
const EXPECTED: Record<string, string> = JSON.parse(readFileSync(`${FIX}/invalid.json`, "utf8"));

describe("instance.schema.json 1.1 fixtures", () => {
  it("has an expected error for every invalid fixture, and nothing else", () => {
    expect(Object.keys(EXPECTED).sort()).toEqual(jsonFiles(`${FIX}/invalid`));
    expect(jsonFiles(`${FIX}/valid`).length).toBeGreaterThan(0);
  });
  it.each(jsonFiles(`${FIX}/valid`))("valid/%s passes", (f) => {
    expect(validateInstance(readFix("valid", f), SCHEMA)).toEqual([]);
  });
  it.each(jsonFiles(`${FIX}/invalid`))(
    "invalid/%s breaks exactly one rule, its expected one",
    (f) => {
      const errors = validateInstance(readFix("invalid", f), SCHEMA);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain(EXPECTED[f]);
    },
  );
  it("every lens has its defaults.lens-in-lenses rule, so a new lens cannot skip it", () => {
    // the lens rules (the other allOf rules, such as report-needs-report-strings, say something else)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the schema JSON, read untyped
    const lensRules = SCHEMA.allOf.filter((r: any) => r.if.properties.defaults);
    const ruled = lensRules.map(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- as above
      (r: any) => r.if.properties.defaults.properties.lens.const as string,
    );
    expect(ruled).toEqual(SCHEMA.$defs.lens.enum);
    for (const r of lensRules) {
      const lens = r.if.properties.defaults.properties.lens.const;
      expect(r.then.properties.lenses.contains.const).toBe(lens);
    }
  });
});

describe("validateInstance: one seeded fault per rule", () => {
  const errs = (patch: (i: typeof OM) => void) => {
    const i = structuredClone(OM);
    patch(i);
    return validateInstance(i, SCHEMA);
  };

  it("an unknown key (additionalProperties: false)", () => {
    expect(errs((i) => (i.gallery = true))).toEqual(['$: unknown key "gallery"']);
    expect(errs((i) => (i.og.twitter = "x"))).toEqual(['$.og: unknown key "twitter"']);
  });
  it("a missing required key", () => {
    expect(errs((i) => delete i.credit)).toEqual(['$: missing "credit"']);
  });
  it("a wordmark of two parts (one string or exactly three)", () => {
    expect(errs((i) => (i.wordmark = ["Ocean", "Metrics"]))).toHaveLength(1);
    expect(errs((i) => (i.wordmark = ["Ocean", "Metrics", "Atlas", "Plus"]))).toHaveLength(1);
    expect(errs((i) => (i.wordmark = "OceanMetrics Atlas"))).toEqual([]);
  });
  it("a pattern, an enum, uniqueItems, minItems and dependentRequired", () => {
    expect(errs((i) => (i.catalog.base = "http://x/"))[0]).toMatch(/catalog\.base/);
    expect(errs((i) => (i.defaults.theme = "navy"))[0]).toMatch(/not one of/);
    expect(errs((i) => (i.tools = ["layers", "layers"]))).toEqual([
      "$.tools: items are not unique",
    ]);
    expect(errs((i) => (i.tools = []))).toEqual(["$.tools: fewer than 1 items"]);
    expect(errs((i) => delete i.og.imageAlt)).toEqual(['$.og: "image" needs "imageAlt"']);
  });
  it("1.1: lenses, defaults.lens in lenses, tools, pages, release, seal and budget", () => {
    expect(errs((i) => delete i.lenses)).toEqual(['$: missing "lenses"']);
    expect(errs((i) => (i.lenses = []))).toEqual([
      '$.lenses: has no "collection"',
      "$.lenses: fewer than 1 items",
    ]);
    expect(errs((i) => (i.lenses = ["collection", "lens"]))[0]).toMatch(
      /^\$\.lenses\[1\]: "lens" not one of/,
    );
    expect(errs((i) => (i.defaults.lens = "species"))).toEqual([]);
    expect(errs((i) => (i.defaults.lens = "scores"))).toEqual(['$.lenses: has no "scores"']);
    expect(errs((i) => (i.tools = [...i.tools, "report"]))).toEqual([]);
    expect(errs((i) => (i.pages = ["index", "gallery"]))[0]).toMatch(
      /^\$\.pages\[1\]: "gallery" not one of/,
    );
    expect(errs((i) => (i.pages = ["catalog"]))).toEqual(['$.pages: has no "index"']);
    expect(errs((i) => delete i.pages)).toEqual(['$: missing "pages"']);
    const registry = "https://example.org/registry/";
    expect(errs((i) => (i.release = { registry }))).toEqual([]);
    expect(errs((i) => (i.release = { registry: "https://example.org/registry" }))[0]).toMatch(
      /release\.registry/,
    );
    expect(errs((i) => (i.release = { registry, access: "open" }))[0]).toMatch(/release\.access/);
    expect(errs((i) => (i.release = { registry, preview: "https://p.example.org/" }))[0]).toMatch(
      /release\.preview/,
    );
    expect(errs((i) => (i.seal = { agency: "MMA", src: "./seal.svg" }))).toEqual([]);
    expect(errs((i) => (i.seal = { agency: "NOAA", src: "./seal.svg" }))[0]).toMatch(
      /seal\.agency/,
    );
    expect(errs((i) => (i.seal = { agency: "MMA", src: "/seal.svg" }))[0]).toMatch(
      /seal\.src: matches 0 of oneOf/,
    );
    expect(errs((i) => (i.budget.static_kb = 0))).toEqual(["$.budget.static_kb: less than 1"]);
    expect(errs((i) => (i.budget.worker_kb = 1.5))).toEqual(["$.budget.worker_kb: not a integer"]);
    expect(errs((i) => delete i.budget)).toEqual(['$: missing "budget"']);
  });
  it("const, contains and if/then, the keywords 1.1 added to the hand validator", () => {
    expect(validateInstance("a", { const: "a" })).toEqual([]);
    expect(validateInstance("b", { const: "a" })).toEqual(['$: "b" is not "a"']);
    expect(validateInstance([1, 2], { contains: { const: 3 } })).toEqual(["$: has no 3"]);
    const rule = { if: { const: 1 }, then: { minimum: 2 } };
    expect(validateInstance(1, rule)).toEqual(["$: less than 2"]);
    expect(validateInstance(0, rule)).toEqual([]);
    expect(() => validateInstance(0, { if: { const: 1 }, else: {} })).toThrow(/else/);
  });
  it("an id that is not its folder name", () => {
    expect(() => loadInstance("oceanmetrics", ".")).not.toThrow();
    expect(validateInstance({ ...OM, id: "Bad Id" }, SCHEMA)).toHaveLength(1);
  });
  it("throws on a schema keyword it does not implement, rather than ignore it", () => {
    expect(() => validateInstance("x", { type: "string", format: "uri" })).toThrow(/format/);
  });
});

describe("the built instance chooses among what the build knows", () => {
  it("src/lib/brand/instance.ts carries the selected instance.json", () => {
    expect(INSTANCE).toEqual(readInstance(instanceId()));
    expect(INSTANCE.id).toBe(instanceId());
  });

  it("the oceanmetrics instance's tools are ToolName members, and the rail is them, in order", () => {
    for (const t of OM.tools) expect(ALL_TOOLS).toContain(t);
    if (instanceId() === "oceanmetrics") expect(TOOL_ORDER).toEqual(OM.tools);
  });

  it("the oceanmetrics instance's defaults are Lens / Theme members, and DEFAULT_SEL uses them", () => {
    expect(ALL_LENSES).toContain(OM.defaults.lens);
    expect(THEMES).toContain(OM.defaults.theme);
    if (instanceId() === "oceanmetrics") {
      expect(DEFAULT_SEL.lens).toBe(OM.defaults.lens);
      expect(DEFAULT_SEL.theme).toBe(OM.defaults.theme);
      expect(DEFAULT_SEL.tour).toBe(OM.defaults.tour);
    }
  });

  it("the oceanmetrics instance's catalog groups are every CatalogGroup, once, in its order", () => {
    const ids = OM.catalog.groups.map((g: { id: string }) => g.id);
    expect([...ids].sort()).toEqual([...CATALOG_GROUPS].sort());
    if (instanceId() === "oceanmetrics") {
      expect(GROUP_ORDER).toEqual(ids);
      expect(GROUP_LABEL.oceanmetrics).toBe("OceanMetrics");
    }
  });

  it("the selected instance's build carries exactly its lenses, in its order", () => {
    expect(LENSES).toEqual(INSTANCE.lenses);
  });

  it("the oceanmetrics instance builds lenses this build knows, publishes pages that exist, and its budget is the size gate's", () => {
    for (const l of OM.lenses) expect(ALL_LENSES).toContain(l);
    for (const p of OM.pages) expect(existsSync(`${p}.html`)).toBe(true);
    expect(OM.budget).toEqual({
      static_kb: CRITICAL_BUDGET_BYTES / 1024,
      worker_kb: RUNTIME_WORKER_BUDGET_BYTES / 1024,
    });
    expect(OM.release).toBeUndefined();
    expect(OM.seal).toBeUndefined();
  });

  it("the marinesensitivity instance builds the 0.10.93 atlas: Scores and Species, the Report rail and page, the registry, the seal", () => {
    const mst = readInstance("marinesensitivity");
    expect(mst.tools).toEqual(["layers", "details", "table", "report"]);
    expect(ALL_TOOLS).toContain("report");
    expect(mst.defaults.lens).toBe("scores");
    expect(mst.lenses).toEqual(["scores", "species"]);
    expect(ALL_LENSES).toContain("scores");
    expect(mst.pages).toEqual(["index", "report"]);
    expect(existsSync("report.html")).toBe(true);
    expect(mst.release.registry).toBe(mst.catalog.base);
    expect(mst.release.docs).toBe("https://marinesensitivity.org/docs/");
    expect(mst.seal.agency).toBe("MMA");
    expect(mst.report.stem).toBe("MarineSensitivity");
    expect(mst.repo).toBe("MarineSensitivity/atlas");
    expect(existsSync(`${instanceDir("marinesensitivity")}/README.md`)).toBe(true);
    // the build carries exactly the instance's lenses (state/types.ts LENSES, the module table)
    if (instanceId() === "marinesensitivity") expect(LENSES).toEqual(["scores", "species"]);
  });
});

describe("every file an instance names exists", () => {
  it.each(listInstances())("%s", (id) => {
    const i = readInstance(id);
    const dir = instanceDir(id);
    expect(existsSync(`${dir}/tokens.css`)).toBe(true);
    expect(existsSync(`${dir}/tokens.json`)).toBe(true);
    expect(existsSync(`${dir}/assets/${i.favicon}`)).toBe(true);
    for (const m of ["hex.svg", "wave.svg"])
      expect(existsSync(`${dir}/assets/motifs/${m}`)).toBe(true);
    if (i.og.image) expect(existsSync(`${dir}/assets/${i.og.image}`)).toBe(true);
    const served = listInstanceAssets(id);
    for (const s of i.supporters) {
      expect(served).toContain(s.logo.replace(/^\.\//, ""));
      if (s.logoDark) expect(served).toContain(s.logoDark.replace(/^\.\//, ""));
    }
    expect(served.some((p: string) => p.startsWith("motifs/"))).toBe(false);
    const mark = readMark(i);
    expect(mark.viewBox).toMatch(/^[\d.\s-]+$/);
    expect(mark.body).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
});

describe("parseMark / wordmarkHtml", () => {
  it("splits a mark into its viewBox and inner markup, dropping comments", () => {
    expect(parseMark('<!-- c -->\n<svg viewBox="0 0 2 2">\n  <path d="M0 0"/>\n</svg>\n')).toEqual({
      viewBox: "0 0 2 2",
      body: '<path d="M0 0"/>',
    });
    expect(() => parseMark("<svg><path/></svg>")).toThrow(/viewBox/);
  });

  it("three parts run the first two together, then a space; one part stands alone", () => {
    expect(wordmarkHtml(["Ocean", "Metrics", "Atlas"])).toBe(
      '<span class="wm-0">Ocean</span><span class="wm-1">Metrics</span> <span class="wm-2">Atlas</span>',
    );
    expect(wordmarkHtml("A & B")).toBe('<span class="wm-0">A &amp; B</span>');
    expect(WORDMARK.length === 1 || WORDMARK.length === 3).toBe(true);
  });
});

describe("renderInstanceHtml fills index.html and catalog.html", () => {
  const index = readFileSync("index.html", "utf8");
  const catalog = readFileSync("catalog.html", "utf8");
  const omMark = readMark(OM);

  it("leaves no placeholder in either entry", () => {
    for (const html of [index, catalog]) {
      const out = renderInstanceHtml(html, OM, omMark);
      expect(out).not.toMatch(/%instance\.[A-Za-z]|<!--instance:[a-z]/);
    }
  });

  it("writes the oceanmetrics title, descriptions, og tags, favicon and skeleton wordmark", () => {
    const out = renderInstanceHtml(index, OM, omMark);
    expect(out).toContain("<title>OceanMetrics Atlas</title>");
    expect(out).toContain(`<meta name="description" content="${OM.description}" />`);
    expect(out).toContain('<link rel="icon" type="image/svg+xml" href="./favicon.svg" />');
    expect(out).toContain('<meta property="og:url" content="https://oceanmetrics.io/atlas/" />');
    expect(out).toContain(
      '<meta property="og:image" content="https://oceanmetrics.io/atlas/og.png" />',
    );
    expect(out).toContain(
      '<svg class="mark" viewBox="0 0 2048 2048" width="1.05em" height="1.05em" aria-hidden="true"',
    );
    expect(out).toContain(wordmarkHtml(OM.wordmark));
    expect(renderInstanceHtml(catalog, OM, omMark)).toContain(
      "<title>OceanMetrics Atlas catalog</title>",
    );
  });

  it("an instance without an og card writes no og:image tags", () => {
    const mst = readInstance("marinesensitivity");
    const out = renderInstanceHtml(index, mst, readMark(mst));
    expect(out).not.toContain(`property="og:image`);
    expect(out).toContain("<title>Scores · MarineSensitivity Atlas</title>");
    expect(out).toContain('<span class="wm-0">Marine Sensitivity Atlas</span>');
  });

  it("an unknown placeholder throws instead of shipping as text", () => {
    expect(() => renderInstanceHtml("<p>%instance.slogan%</p>", OM, omMark)).toThrow(/slogan/);
    expect(() => renderInstanceHtml("<!--instance:seal-->", OM, omMark)).toThrow(/seal/);
  });
});
