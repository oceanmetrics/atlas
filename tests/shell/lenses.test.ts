// The lens switch's labels exist twice: src/shell/lenses.ts (the hydrated switch) and
// scripts/instance.mjs (the skeleton switch the build writes into index.html before any bundle
// exists). This keeps the two equal, and every lens labelled.
import { describe, expect, it } from "vitest";
import { LENS_LABEL } from "../../src/shell/lenses";
import { ALL_LENSES } from "../../src/lib/state/types";
import { LENS_LABEL as SKELETON_LABEL, renderInstanceHtml } from "../../scripts/instance.mjs";

describe("the lens labels", () => {
  it("the skeleton and the hydrated switch use the same label for every lens", () => {
    expect(SKELETON_LABEL).toEqual(LENS_LABEL);
    for (const l of ALL_LENSES) expect(LENS_LABEL[l]).toBeTruthy();
  });

  it("the skeleton switch lists the instance's lenses, its default pressed", () => {
    const html = renderInstanceHtml(
      "<!--instance:lens-switch-->",
      { lenses: ["scores", "species"], defaults: { lens: "scores" }, og: {}, wordmark: "x" },
      { viewBox: "0 0 1 1", body: "" },
    );
    expect(html).toBe('<span class="is-pressed">Scores</span><span>Species</span>');
  });
});
