// Wiring gate, fix round 1 (item 3): "the ramp domain taken from the release instead of the
// report's places" is the seeded fault this file exists to make impossible by construction.
// report/ramp.ts#rampDomain() (step 1, already tested against R) computes the domain from THIS
// report's places (`range()`, widened +/-0.5 when equal) -- never from a release-wide rescale
// bound (`boot.metrics[*].rescale`, `manifest.metrics`, a layer's own min/max). `Report.svelte`
// only ever reads the ALREADY-COMPUTED `model.map.domain`; this scans the map-facing report
// source for a release-wide rescale reference feeding a color/domain computation, which would be
// exactly this fault reappearing.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

const RELEASE_DOMAIN_MARKERS = [/boot\.metrics/, /manifest\.metrics/, /\.rescale\b/, /layerByKey/];

export function findReleaseDomainReferences(source: string): string[] {
  return RELEASE_DOMAIN_MARKERS.filter((re) => re.test(source)).map((re) => re.source);
}

describe("the map's color domain comes ONLY from model.map.domain, never a release-wide rescale bound", () => {
  it("reportMap.ts references no release-wide rescale/metrics source", () => {
    const source = readFileSync(`${ROOT}/src/report/reportMap.ts`, "utf8");
    expect(findReleaseDomainReferences(source)).toEqual([]);
  });

  it("Report.svelte's map section reads model.map.domain, not a release bound", () => {
    const source = readFileSync(`${ROOT}/src/report/Report.svelte`, "utf8");
    expect(source).toContain("model.map.domain");
    expect(findReleaseDomainReferences(source)).toEqual([]);
  });

  it("SEEDED FAULT: a release-wide rescale reference is caught", () => {
    const rogue = "const domain = boot.metrics[key].rescale;";
    expect(findReleaseDomainReferences(rogue).length).toBeGreaterThan(0);
  });
});
