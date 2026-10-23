import { describe, expect, it } from "vitest";
import { formatScoresLegendValue, scoresMapInputs } from "../../../src/lens/scores/mapInputs";
import { defaultLayerKey } from "../../../src/lens/scores/boot";
import { BOOT_V7, MANIFEST_OVERLAYS_V7 } from "./fixtures";

describe("scoresMapInputs — cell branch", () => {
  it("raster + overlay populated, zones VISUALLY outline-only (B3: an invisible opacity-0 query fill, not undefined)", () => {
    const out = scoresMapInputs({
      boot: BOOT_V7,
      overlays: MANIFEST_OVERLAYS_V7,
      unit: "cell",
      lyr: defaultLayerKey(BOOT_V7),
      palette: "spectral_r",
      showOutsidePra: false,
      selection: null,
    });
    expect(out.raster?.id).toBe("r_lyr");
    expect(out.overlays).toHaveLength(1);
    // B3 fix: `zoneUnitsFromBoot` (layers/zones.ts) now attaches `queryFillFor`'s invisible
    // placeholder to every unit, so pick mode can query a polygon's interior even in the "raster
    // cells" spatial-unit branch this test covers. `opacity: 0` keeps it invisible on screen.
    expect(out.zones[0].fill?.opacity).toBe(0);
    expect(out.zones[0].fill?.stops).toEqual([]);
    expect(out.selection).toBeNull();
  });

  // atlas-4 defect fix: the scores lens had no floating legend at all -- this pins the raster
  // branch's contribution (title + `signif(rescale,3)` endpoints), the underlying data the
  // floating `ScoresLegend.svelte` renders.
  it("legend: kind 'raster', title from the layer's label, endpoints signif(rescale, 3)", () => {
    const out = scoresMapInputs({
      boot: BOOT_V7,
      overlays: MANIFEST_OVERLAYS_V7,
      unit: "cell",
      lyr: defaultLayerKey(BOOT_V7),
      palette: "spectral_r",
      showOutsidePra: false,
      selection: null,
    });
    expect(out.legend?.kind).toBe("raster");
    if (out.legend?.kind === "raster") {
      expect(out.legend.title).toBe("Overall score"); // BOOT_V7's composite layer label
      expect(out.legend.stops[0].value).toBe(0); // signif(0, 3)
      expect(out.legend.stops.at(-1)?.value).toBe(96); // signif(96, 3) — BOOT_V7's composite rescale
    }
  });

  // M2 fix (docs/usability.md): the raster legend used to go "unavailable" the moment a palette
  // (today: anything but spectral_r) had no published boot.palettes stops -- even though titiler
  // was already painting the tiles correctly server-side. `rasterLegend` (raster.ts) now falls back
  // to ramps.ts's own fixed ramp, so `scoresMapInputs` carries a real "raster" legend here too.
  it("legend: kind 'raster' (M2 fallback) even when the release has not published this palette's stops", () => {
    const out = scoresMapInputs({
      boot: BOOT_V7,
      overlays: MANIFEST_OVERLAYS_V7,
      unit: "cell",
      lyr: defaultLayerKey(BOOT_V7),
      palette: "viridis",
      showOutsidePra: false,
      selection: null,
    });
    expect(out.legend?.kind).toBe("raster");
    if (out.legend?.kind === "raster") {
      expect(out.legend.title).toBe("Overall score");
      expect(out.legend.stops).toHaveLength(11);
    }
  });

  it("a cell selection draws a ring polygon at the given colour", () => {
    const out = scoresMapInputs({
      boot: BOOT_V7,
      overlays: MANIFEST_OVERLAYS_V7,
      unit: "cell",
      lyr: defaultLayerKey(BOOT_V7),
      palette: "spectral_r",
      showOutsidePra: false,
      selection: { kind: "cell", lon: -90, lat: 27, halfW: 0.025, halfH: 0.025 },
    });
    expect(out.selection?.color).toBe("#ff00aa");
    expect(out.selection?.features.features[0].geometry.type).toBe("Polygon");
  });
});

// M6 (review round 1, "short-label test missing" — code already had this precedence, only the
// test did not): `state.metricLabels` is the manifest's own SHORT label
// (`boot.ts#metricLabelsFromManifest`), keyed by `metric_key`; `layer?.label` is `boot.json`'s
// LONG description text. Real v7 strings (`BOOT_V7`'s "primprod" row + the release's actual
// published manifest short label, `workflows/dev/gen_v7_artifacts.R:49`), not synthetic ones, so
// a fixture drift between the two files would show up here.
describe("scoresMapInputs — legend title precedence (M6)", () => {
  // M6 re-check (round 2): v7's REAL LIVE long label (BOOT_V7's own primprod row), fetched
  // verbatim from the live v7/app/boot.json -- round 1's string was v8's own paraphrase.
  const PRIMPROD_LONG_LABEL =
    "Primary productivity: Oregon State Vertically Generalized Production Model (VGPM) " +
    "from Visible Infrared Imaging Radiometer Suite (VIIRS) satellite data (mg C / m^2 / day) " +
    "from daily averages available as monthly averaged to annual and averaged to overall for " +
    "the most recently available full years of data 2014 to 2023";
  const PRIMPROD_SHORT_LABEL = "prim prod, 2014-2023 avg (mg C/m^2/day)"; // v7's manifest.metrics

  it("no metricLabels at all (manifest not loaded yet): falls back to the LONG boot.layers label", () => {
    const out = scoresMapInputs({
      boot: BOOT_V7,
      overlays: MANIFEST_OVERLAYS_V7,
      unit: "cell",
      lyr: "primprod",
      palette: "spectral_r",
      showOutsidePra: false,
      selection: null,
    });
    expect(out.legend?.title).toBe(PRIMPROD_LONG_LABEL);
  });

  it("metricLabels has no row for THIS metric_key: still falls back to the LONG label, not blank", () => {
    const out = scoresMapInputs({
      boot: BOOT_V7,
      overlays: MANIFEST_OVERLAYS_V7,
      unit: "cell",
      lyr: "primprod",
      palette: "spectral_r",
      showOutsidePra: false,
      selection: null,
      metricLabels: { extrisk_bird: "bird: ext. risk" },
    });
    expect(out.legend?.title).toBe(PRIMPROD_LONG_LABEL);
  });

  it("metricLabels publishes a SHORT label for this metric_key: it wins over the long boot.layers label", () => {
    const out = scoresMapInputs({
      boot: BOOT_V7,
      overlays: MANIFEST_OVERLAYS_V7,
      unit: "cell",
      lyr: "primprod",
      palette: "spectral_r",
      showOutsidePra: false,
      selection: null,
      metricLabels: { primprod: PRIMPROD_SHORT_LABEL },
    });
    // R3-W7 follow-up: `metricKeyLabel()` now sentence-cases every label it returns, useful or
    // fallback -- "prim prod, ..." -> "Prim prod, ...".
    expect(out.legend?.title).toBe("Prim prod, 2014-2023 avg (mg C/m^2/day)");
  });

  // R3-B1 (round-3 plan): a release whose composite `metric_key` really IS the bare string
  // "score" (no `boot.layers[].label`, no `manifest.metrics` entry for it) used to fall all the
  // way through to the raw key verbatim, lowercase -- the exact "raw metric key 'score' shown in
  // the legend/chip" bug the plan names. `boot.layers` here has no row named "score" at all (an
  // unresolved `lyr`, the OTHER way this path is reached), so both `metricLabels` and `layer?.label`
  // miss and the fallback is exercised for real, not just documented.
  it("R3-B1: an unresolved lyr with no label anywhere title-cases the raw key ('score' -> 'Score')", () => {
    const out = scoresMapInputs({
      boot: BOOT_V7,
      overlays: MANIFEST_OVERLAYS_V7,
      unit: "cell",
      lyr: "score",
      palette: "spectral_r",
      showOutsidePra: false,
      selection: null,
    });
    expect(out.legend?.title).toBe("Score");
  });

  // Fix round (orchestrator, 2026-09-25): the OTHER way "score" reaches the UI -- a real, published
  // `manifest.metrics` row whose curated `label` is ITSELF just the bare key. The old
  // `metricLabels[key] ?? ... ?? metricKeyLabel(key)` chain found this truthy value on the very
  // FIRST `??` and never reached the title-casing fallback at all.
  it("R3-B1 (fix round): a curated manifest label equal to the key is ALSO title-cased, not shown verbatim", () => {
    const out = scoresMapInputs({
      boot: BOOT_V7,
      overlays: MANIFEST_OVERLAYS_V7,
      unit: "cell",
      lyr: "score",
      palette: "spectral_r",
      showOutsidePra: false,
      selection: null,
      metricLabels: { score: "score" },
    });
    expect(out.legend?.title).toBe("Score");
  });
});

describe("scoresMapInputs — zone-choropleth branch", () => {
  it("raster/overlay cleared, the current unit gets a fill, others stay outline-only", () => {
    const out = scoresMapInputs({
      boot: BOOT_V7,
      overlays: MANIFEST_OVERLAYS_V7,
      unit: "programarea",
      lyr: defaultLayerKey(BOOT_V7),
      palette: "spectral_r",
      showOutsidePra: false,
      selection: null,
    });
    expect(out.raster).toBeNull();
    expect(out.overlays).toEqual([]);
    const pra = out.zones.find((z) => z.unit === "programarea")!;
    expect(pra.fill).toBeDefined();
    expect(pra.fill!.stops).toHaveLength(2);
  });

  it("a zone selection sets highlightKey on the matching unit only", () => {
    const out = scoresMapInputs({
      boot: BOOT_V7,
      overlays: MANIFEST_OVERLAYS_V7,
      unit: "programarea",
      lyr: defaultLayerKey(BOOT_V7),
      palette: "spectral_r",
      showOutsidePra: false,
      selection: { kind: "zone", unit: "programarea", key: "GAA" },
    });
    const pra = out.zones.find((z) => z.unit === "programarea")!;
    expect(pra.highlightKey).toBe("GAA");
  });

  // atlas-4 defect fix: the zone-choropleth branch had NO legend at all before this fix (not even
  // in-panel) — `zoneChoropleth`'s own `legend` field was computed and then discarded.
  it("legend: kind 'zone', title from the layer's label, endpoints round(range, 1)", () => {
    const out = scoresMapInputs({
      boot: BOOT_V7,
      overlays: MANIFEST_OVERLAYS_V7,
      unit: "programarea",
      lyr: defaultLayerKey(BOOT_V7),
      palette: "spectral_r",
      showOutsidePra: false,
      selection: null,
    });
    expect(out.legend?.kind).toBe("zone");
    if (out.legend?.kind === "zone") {
      expect(out.legend.title).toBe("Overall score");
      expect(out.legend.stops[0].value).toBe(12); // round(12, 1) — GEO
      expect(out.legend.stops.at(-1)?.value).toBe(33.1); // round(33.09, 1) — GAA
    }
  });

  it("legend: kind 'empty' — the Inf/-Inf guard, no zone carries a value for this metric", () => {
    const out = scoresMapInputs({
      boot: BOOT_V7,
      overlays: MANIFEST_OVERLAYS_V7,
      unit: "programarea",
      lyr: "nope",
      palette: "spectral_r",
      showOutsidePra: false,
      selection: null,
    });
    // R3-B1: an unresolved lyr with no label anywhere now title-cases via `metricKeyLabel()`
    // ("nope" -> "Nope"), not the raw lowercase key verbatim — see the dedicated R3-B1 test above.
    expect(out.legend).toEqual({ kind: "empty", title: "Nope" });
  });
});

describe("formatScoresLegendValue — the scores legend's own formatValue (defect fix)", () => {
  it("prints an already-rounded value verbatim, never re-rounding it", () => {
    // the exact fault this exists to catch: toLocaleString("en-US")'s implicit 3-fraction-digit
    // cap turns signif(0.0123456, 3) = 0.0123 into "0.012" — a plain stringify does not.
    expect(formatScoresLegendValue(0.0123)).toBe("0.0123");
    expect(formatScoresLegendValue(98.8)).toBe("98.8");
  });
});

// R4-A (Ben, 2026-09-30): the legend carries the whole-layer histogram + the clicked value's marker.
describe("scoresMapInputs -- legend histogram + marker (R4-A)", () => {
  const base = {
    boot: BOOT_V7,
    overlays: MANIFEST_OVERLAYS_V7,
    lyr: defaultLayerKey(BOOT_V7),
    palette: "spectral_r" as const,
    showOutsidePra: false,
    selection: null,
  };
  const hist = { binCount: 3, counts: [1, 8, 2], min: 0, max: 96 };

  it("raster: the passed-in histogram travels in the legend object, by identity", () => {
    const out = scoresMapInputs({ ...base, unit: "cell", rasterHistogram: hist, marker: 40 });
    expect(out.legend?.kind).toBe("raster");
    if (out.legend?.kind === "raster") {
      expect(out.legend.histogram).toBe(hist);
      expect(out.legend.marker).toBe(40);
    }
  });

  it("legend-histogram-stable-across-clicks: only the marker differs between two clicks", () => {
    const a = scoresMapInputs({ ...base, unit: "cell", rasterHistogram: hist, marker: 12 });
    const b = scoresMapInputs({ ...base, unit: "cell", rasterHistogram: hist, marker: 77 });
    if (a.legend?.kind !== "raster" || b.legend?.kind !== "raster") throw new Error("raster");
    expect(b.legend.histogram).toBe(a.legend.histogram);
    expect(a.legend.marker).not.toBe(b.legend.marker);
    expect({ ...a.legend, marker: null }).toEqual({ ...b.legend, marker: null });
  });

  it("zone: the histogram bins every zone's value and is identical whichever zone is clicked", () => {
    const a = scoresMapInputs({ ...base, unit: "programarea", marker: 10 });
    const b = scoresMapInputs({ ...base, unit: "programarea", marker: 90 });
    if (a.legend?.kind !== "zone" || b.legend?.kind !== "zone") throw new Error("zone");
    expect(a.legend.histogram?.binCount).toBeGreaterThan(0);
    expect(b.legend.histogram).toEqual(a.legend.histogram);
    expect(a.legend.marker).toBe(10);
    expect(b.legend.marker).toBe(90);
  });

  it("no histogram source and no click: the legend is the bare ramp (null, null)", () => {
    const out = scoresMapInputs({ ...base, unit: "cell" });
    if (out.legend?.kind !== "raster") throw new Error("raster");
    expect(out.legend.histogram).toBeNull();
    expect(out.legend.marker).toBeNull();
  });
});
