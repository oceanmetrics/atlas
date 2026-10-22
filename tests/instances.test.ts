// Instances (instances/<id>/, VITE_INSTANCE): every instance.json validates against
// instances/instance.schema.json, the built instance only picks values its build knows (Lens, ToolName,
// CatalogGroup stay compile-time unions), every file an instance names exists, and the HTML entries are
// filled from it. The schema validator is scripts/instance.mjs's hand validator (no ajv dependency);
// each of its rules has a seeded fault below.
import { existsSync, readFileSync } from "node:fs";
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
import { DEFAULT_SEL, LENSES, THEMES } from "../src/lib/state/types";
import { ALL_TOOLS, TOOL_ORDER } from "../src/shell/tools";

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

describe("validateInstance: one seeded fault per rule", () => {
  const errs = (patch: (i: typeof OM) => void) => {
    const i = structuredClone(OM);
    patch(i);
    return validateInstance(i, SCHEMA);
  };

  it("an unknown key (additionalProperties: false)", () => {
    expect(errs((i) => (i.seal = true))).toEqual(['$: unknown key "seal"']);
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
    expect(LENSES).toContain(OM.defaults.lens);
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

  it("the marinesensitivity instance names values of its own week-4 build (not this build's unions)", () => {
    const mst = readInstance("marinesensitivity");
    expect(mst.tools).toContain("report");
    expect(ALL_TOOLS).not.toContain("report");
    expect(mst.defaults.lens).toBe("scores");
    expect(existsSync(`${instanceDir("marinesensitivity")}/README.md`)).toBe(true);
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
    expect(out).toContain('<span class="wm-0">MarineSensitivity Atlas</span>');
  });

  it("an unknown placeholder throws instead of shipping as text", () => {
    expect(() => renderInstanceHtml("<p>%instance.slogan%</p>", OM, omMark)).toThrow(/slogan/);
    expect(() => renderInstanceHtml("<!--instance:seal-->", OM, omMark)).toThrow(/seal/);
  });
});
