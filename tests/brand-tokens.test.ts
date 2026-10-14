// atlas-3 review checklist, rules 1 and 2: no hex literal outside tokens.css, and the motifs stay
// at or under the guide's 10 % opacity. Each rule has its planted-fault twin here, so neither gate
// can quietly stop being able to fail.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  findHexLiterals,
  SCAN_ROOTS,
  TOKENS_JSON_FILE,
} from "../scripts/check-hex-literals-core.mjs";

const TOKENS = readFileSync("src/lib/brand/tokens.css", "utf8");
const MOTIF_CAP = 0.1; // MMA Branding Guide 2026, pp. 9-10

let dir: string | null = null;

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = null;
});

function makeRepo(files: Record<string, string>): string {
  dir = mkdtempSync(join(tmpdir(), "atlas-brand-"));
  for (const [rel, content] of Object.entries(files)) {
    const p = join(dir, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, content);
  }
  return dir;
}

describe("no hex literal outside tokens.css", () => {
  it("is true of everything atlas-3 wrote", () => {
    expect(findHexLiterals(".")).toEqual([]);
  });

  it("scans the brand directory, the component library and the shell css", () => {
    expect(SCAN_ROOTS).toContain("src/lib/brand");
    expect(SCAN_ROOTS).toContain("src/lib/ui");
    expect(SCAN_ROOTS).toContain("src/shell/shell.css");
  });

  it("flags a planted literal in a component under src/lib/ui (the step 2 seeded fault)", () => {
    const d = makeRepo({
      "src/lib/brand/tokens.css": ":root { --mma-gold: #e8c24a; }",
      "src/lib/ui/HexButton.svelte": "<style>.hex { background: #e8c24a; }</style>",
    });
    const hits = findHexLiterals(d);
    expect(hits).toHaveLength(1);
    expect(hits[0].path).toBe(join("src", "lib", "ui", "HexButton.svelte"));
  });

  it("flags a planted literal in the shell css too", () => {
    const d = makeRepo({ "src/shell/shell.css": ".chip { color: #fff; }" });
    expect(findHexLiterals(d)).toHaveLength(1);
  });

  it("exempts ONLY tokens.json, generated verbatim from tokens.css, not every .json file", () => {
    const withTokensJson = makeRepo({
      "src/lib/brand/tokens.json": '{"navy":{"--mma-gold":"#e8c24a"}}',
    });
    expect(findHexLiterals(withTokensJson)).toEqual([]);

    const otherJson = makeRepo({
      "src/lib/ui/some-data.json": '{"color":"#e8c24a"}',
    });
    expect(findHexLiterals(otherJson)).toHaveLength(1);
  });

  it("holds for the committed tokens.json", () => {
    expect(findHexLiterals(".").filter((h) => h.path === TOKENS_JSON_FILE)).toEqual([]);
  });

  it("flags a planted literal in the inlined critical CSS of index.html (the seeded fault)", () => {
    const d = makeRepo({
      "src/lib/brand/tokens.css": ":root { --mma-gold: #e8c24a; }",
      "index.html": "<style>.chip { color: #e8c24a; }</style>",
    });
    const hits = findHexLiterals(d);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ path: "index.html", match: "#e8c24a" });
  });

  it("allows literals inside tokens.css itself", () => {
    const d = makeRepo({ "src/lib/brand/tokens.css": ":root { --mma-navy: #001a57; }" });
    expect(findHexLiterals(d)).toEqual([]);
  });

  it("does not mistake a fragment link or an svg id reference for a color", () => {
    const d = makeRepo({
      "index.html": '<a href="#place-panel">x</a><use href="#i-layers" />',
    });
    expect(findHexLiterals(d)).toEqual([]);
  });

  it("allows a vendored brand mark only while it says where it came from", () => {
    const withProvenance = makeRepo({
      "src/lib/brand/vendor/mark.svg":
        '<!-- vendored verbatim from elsewhere --><svg fill="#FFFFFF"/>',
    });
    expect(findHexLiterals(withProvenance)).toEqual([]);
    rmSync(withProvenance, { recursive: true, force: true });

    const without = makeRepo({ "src/lib/brand/vendor/mark.svg": '<svg fill="#FFFFFF"/>' });
    expect(findHexLiterals(without)[0].reason).toMatch(/provenance/);
  });
});

describe("motif opacity is capped at 10 % (guide pp. 9-10)", () => {
  const opacities = () =>
    [...TOKENS.matchAll(/(--motif-[\w-]*opacity)\s*:\s*([\d.]+)\s*;/g)].map(([, name, v]) => ({
      name,
      value: Number(v),
    }));

  it("declares an opacity token for both motifs", () => {
    expect(
      opacities()
        .map((o) => o.name)
        .sort(),
    ).toEqual(["--motif-hex-opacity", "--motif-wave-opacity"]);
  });

  it("keeps every motif opacity at or under the cap", () => {
    for (const o of opacities()) expect(o.value).toBeLessThanOrEqual(MOTIF_CAP);
  });

  it("goes red when one is raised above the cap (the seeded fault)", () => {
    const raised = TOKENS.replace("--motif-hex-opacity: 0.1;", "--motif-hex-opacity: 0.18;");
    expect(raised).not.toEqual(TOKENS);
    const values = [...raised.matchAll(/--motif-[\w-]*opacity\s*:\s*([\d.]+)\s*;/g)].map((m) =>
      Number(m[1]),
    );
    expect(values.some((v) => v > MOTIF_CAP)).toBe(true);
  });

  it("uses `currentColor` and no literal in the motif assets, so the tint comes from a token", () => {
    for (const f of ["hex.svg", "wave.svg"]) {
      const svg = readFileSync(`src/lib/brand/motifs/${f}`, "utf8");
      expect(svg).toMatch(/currentColor/);
      expect(svg).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    }
  });
});
