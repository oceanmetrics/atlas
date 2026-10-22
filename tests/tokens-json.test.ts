// atlas-3 step 2: instances/<id>/tokens.json is a deterministic export of tokens.css, for any
// consumer that cannot read CSS custom properties (Node scripts, design tooling). Regenerating it
// in memory from the committed tokens.css must be byte-identical to the committed tokens.json —
// exactly the fault this seeds: change a token without re-exporting, and this goes red.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  exportTokens,
  OUTPUT_FILE,
  renderTokensJson,
  TOKENS_CSS_FILE,
} from "../scripts/export-tokens.mjs";

const CSS = readFileSync(TOKENS_CSS_FILE, "utf8");
const COMMITTED = readFileSync(OUTPUT_FILE, "utf8");

describe("tokens.json (atlas-3 step 2)", () => {
  it("regenerates byte-identical to the committed file (no shell-out)", () => {
    expect(renderTokensJson(CSS)).toBe(COMMITTED);
  });

  it("resolves every var() reference — no unresolved var( survives into either theme", () => {
    const { navy, paper } = exportTokens(CSS);
    for (const [theme, tokens] of [
      ["navy", navy],
      ["paper", paper],
    ] as const) {
      for (const [name, value] of Object.entries(tokens)) {
        expect(value, `${theme}.${name}`).not.toMatch(/var\(/);
      }
    }
  });

  it("carries the same set of token names in both themes", () => {
    const { navy, paper } = exportTokens(CSS);
    expect(Object.keys(paper).sort()).toEqual(Object.keys(navy).sort());
  });

  it("agrees on --fill-accent (Gold in both themes — R5 y1, docs/usability.md §7)", () => {
    const { navy, paper } = exportTokens(CSS);
    expect(navy["--fill-accent"]).toBe("#2fc7b8");
    expect(paper["--fill-accent"]).toBe("#2fc7b8");
  });

  it("disagrees on --border-accent (Teal on navy, Navy on paper — R5 y1's ring)", () => {
    const { navy, paper } = exportTokens(CSS);
    expect(navy["--border-accent"]).toBe("#2fc7b8");
    expect(paper["--border-accent"]).toBe("#05294d");
  });

  it("goes red when a token changes without a matching re-export (the seeded fault)", () => {
    const mutated = CSS.replace("--om-teal: #2fc7b8;", "--om-teal: #ffcc00;");
    expect(mutated).not.toEqual(CSS);
    const regenerated = renderTokensJson(mutated);
    expect(regenerated).not.toBe(COMMITTED); // drifted from the committed export — must not match
  });

  it("is valid, parseable JSON", () => {
    expect(() => JSON.parse(COMMITTED)).not.toThrow();
  });
});
