// atlas-3: one fixture per rule of the contrast contract, plus the real tokens.css.
// The seeded fault the subplan names — "it must fail when Gold is assigned to text on paper" —
// is `teal on paper is a FAIL` below, so the gate can never quietly stop being able to fail.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { instanceId, instanceTokensCss } from "../scripts/instance.mjs";
import {
  checkContrast,
  contrastRatio,
  parseManifest,
  parseThemes,
} from "../scripts/contrast-core.mjs";

const TOKENS = readFileSync(instanceTokensCss(), "utf8");

// each instance's own seeded fault (its accent as text on paper) and palette facts
const PALETTE = (
  {
    oceanmetrics: {
      seed: ["--text-accent: var(--om-teal-deep);", "--text-accent: var(--om-teal);"],
      ratio: /\[paper\] --text-accent .* 2\.10:1 < 4\.5:1 \(text\)/,
      exemptToken: "--om-teal",
      exemptValue: "#2fc7b8",
      navy: "var(--om-navy)",
    },
    marinesensitivity: {
      seed: ["--text-accent: var(--mma-steel);", "--text-accent: var(--mma-gold);"],
      ratio: /\[paper\] --text-accent .* 1\.71:1 < 4\.5:1 \(text\)/,
      exemptToken: "--mma-gold",
      exemptValue: "#e8c24a",
      navy: "var(--mma-navy)",
    },
  } as Record<
    string,
    {
      seed: [string, string];
      ratio: RegExp;
      exemptToken: string;
      exemptValue: string;
      navy: string;
    }
  >
)[instanceId()];

/** a minimal two-theme tokens file with one pair, used to exercise one rule at a time */
function fixture({
  manifest,
  navy,
  paper,
  base = "",
}: {
  manifest: string;
  navy: string;
  paper: string;
  base?: string;
}) {
  return `/* @contrast
${manifest}
 */
:root { ${base} }
:root, :root[data-theme="navy"] { ${navy} }
:root[data-theme="paper"] { ${paper} }`;
}

describe("contrastRatio (WCAG 2.1)", () => {
  it("measures the guide's own pairs", () => {
    expect(contrastRatio("#ffffff", "#001a57")).toBeCloseTo(16.34, 1); // white on Navy
    expect(contrastRatio("#e8c24a", "#001a57")).toBeCloseTo(9.53, 1); // Gold on Navy
    expect(contrastRatio("#e8c24a", "#ffffff")).toBeCloseTo(1.71, 1); // Gold on white
  });

  it("expands a 3-digit hex", () => {
    expect(contrastRatio("#fff", "#000")).toBe(21);
  });
});

describe("the contrast contract", () => {
  it("passes for the real tokens.css, in both themes", () => {
    const { results, failures } = checkContrast(TOKENS);
    expect(failures).toEqual([]);
    expect(results.length).toBeGreaterThan(40);
    expect(new Set(results.map((r) => r.theme))).toEqual(new Set(["navy", "paper"]));
  });

  it("the accent as text on paper is a FAIL (the seeded fault of `node scripts/contrast.mjs`)", () => {
    const seeded = TOKENS.replace(PALETTE.seed[0], PALETTE.seed[1]);
    expect(seeded).not.toEqual(TOKENS); // the seed actually applied
    const { failures } = checkContrast(seeded);
    expect(failures.join("\n")).toMatch(PALETTE.ratio);
  });

  it("holds text to 4.5:1 and non-text to 3:1 — the same color can pass one and fail the other", () => {
    const manifest = " * text    --fg : --bg\n * nontext --edge : --bg";
    // #767676 on white is 4.54:1 (text-legal, and 3:1 too); #a0a0a0 is 2.61:1 (neither)
    const both = fixture({
      manifest,
      navy: "--fg: #767676; --edge: #a0a0a0; --bg: #ffffff;",
      paper: "--fg: #767676; --edge: #a0a0a0; --bg: #ffffff;",
    });
    expect(checkContrast(both).failures.filter((f) => f.includes("--edge"))).toHaveLength(2);
    expect(checkContrast(both).failures.filter((f) => f.includes("--fg"))).toHaveLength(0);
  });

  it("checks BOTH themes: a pair that passes on navy and fails on paper is caught", () => {
    const css = fixture({
      manifest: " * text --fg : --bg",
      navy: "--fg: #e8c24a; --bg: #001a57;",
      paper: "--fg: #e8c24a; --bg: #ffffff;",
    });
    const { failures } = checkContrast(css);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("[paper]");
  });

  it("a color token with no pair and no exemption is a FAIL (coverage, not silence)", () => {
    const css = fixture({
      manifest: " * text --fg : --bg",
      navy: "--fg: #ffffff; --bg: #001a57; --stray: #ff00ff;",
      paper: "--fg: #001a57; --bg: #ffffff; --stray: #ff00ff;",
    });
    expect(checkContrast(css).failures.join("\n")).toMatch(
      /--stray .* is a color token with no contrast pair and no exemption/,
    );
  });

  it("an exempted token is allowed, and a non-color token needs no exemption", () => {
    const css = fixture({
      manifest: " * text --fg : --bg\n * exempt --stray : decorative",
      base: "--space-4: 16px;",
      navy: "--fg: #ffffff; --bg: #001a57; --stray: #ff00ff;",
      paper: "--fg: #001a57; --bg: #ffffff; --stray: #ff00ff;",
    });
    expect(checkContrast(css).failures).toEqual([]);
  });

  it("refuses to guess at a translucent pair instead of skipping it", () => {
    const css = fixture({
      manifest: " * text --fg : --bg",
      navy: "--fg: #ffffff; --bg: color-mix(in srgb, #001a57 88%, transparent);",
      paper: "--fg: #001a57; --bg: #ffffff;",
    });
    expect(checkContrast(css).failures.join("\n")).toMatch(/not an opaque hex pair/);
  });

  it("resolves var() chains before measuring", () => {
    const css = fixture({
      manifest: " * text --fg : --bg\n * exempt --palette-gold : raw palette",
      base: "--palette-gold: #e8c24a;",
      navy: "--fg: var(--palette-gold); --bg: #001a57;",
      paper: "--fg: #001a57; --bg: #ffffff;",
    });
    const { results, failures } = checkContrast(css);
    expect(failures).toEqual([]);
    expect(results.find((r) => r.theme === "navy")?.ratio).toBeCloseTo(9.53, 1);
  });
});

describe("the manifest is the contract (it is read from tokens.css, not from the script)", () => {
  it("names every category color and both themes' surfaces", () => {
    const { pairs, exempt } = parseManifest(TOKENS);
    const subjects = pairs.map((p) => p.token);
    for (const cat of [
      "bird",
      "coral",
      "fish",
      "invertebrate",
      "mammal",
      "other",
      "primprod",
      "turtle",
    ]) {
      expect(subjects).toContain(`--cat-${cat}`);
    }
    expect(exempt.has(PALETTE.exemptToken)).toBe(true);
  });

  it("throws when tokens.css has no manifest at all", () => {
    expect(() => parseManifest(":root { --a: #fff; }")).toThrow(/@contrast/);
  });

  it("reads the navy block as the default :root and paper as the override", () => {
    const { base, navy, paper } = parseThemes(TOKENS);
    expect(base.get(PALETTE.exemptToken)).toBe(PALETTE.exemptValue);
    expect(navy.get("--text-primary")).toBe("#ffffff");
    expect(paper.get("--text-primary")).toBe(PALETTE.navy);
  });
});
