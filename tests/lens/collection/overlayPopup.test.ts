// The card a click on a collection's own overlays opens (src/lens/collection/overlayPopup.ts): every
// property of every feature, in the overlay's field order with its labels, null as "—", numbers formatted
// without ever rounding an id, every value escaped as text, at most 25 features then "and N more".
import { describe, expect, it } from "vitest";
import type { CollectionOverlaySpec } from "../../../src/lib/catalog/overlays";
import {
  EMPTY_VALUE,
  FEATURE_CAP,
  formatOverlayValue,
  moreText,
  overlayAnnounceText,
  overlayHoverText,
  overlayLabel,
  overlayPopupHtml,
  overlayRows,
  type OverlayHit,
} from "../../../src/lens/collection/overlayPopup";

const SIGHTINGS: CollectionOverlaySpec = {
  id: "sightings_vessel",
  title: "Vessel sightings, 2003–2024",
  asset: "sightings_vessel",
  url: "https://data.test/s.pmtiles",
  sourceLayer: "sightings_vessel",
  geometry: "point",
  color: "#c51b7d",
  default: true,
  labelField: "vernacularName",
  fields: ["sightid", "vernacularName", "group.size", "beaufort"],
  fieldLabels: { "group.size": "Group size", vernacularName: "Species" },
  filterField: "models",
};
const EFFORT: CollectionOverlaySpec = {
  ...SIGHTINGS,
  id: "effort_vessel",
  title: "Vessel effort",
  geometry: "line",
  labelField: null,
  fields: null,
  fieldLabels: {},
};

const SIGHTING = {
  sightid: 20140612003,
  survey: "GU1402",
  date: "2014-06-12",
  vernacularName: "Rice's whale",
  "group.size": 2,
  lat: 28.6254321,
  lon: -86.1234567,
  dist_km: 1.234567,
  models: "|rices_whale|",
};

/** the [label, value] pairs of every row of one rendered feature, in order. */
function rowsOf(html: string): [string, string][] {
  return [...html.matchAll(/<tr><th scope="row">(.*?)<\/th><td>(.*?)<\/td><\/tr>/g)].map((m) => [
    m[1],
    m[2],
  ]);
}

describe("formatOverlayValue", () => {
  it("null, undefined and the empty string read '—'", () => {
    expect(formatOverlayValue("x", null)).toBe(EMPTY_VALUE);
    expect(formatOverlayValue("x", undefined)).toBe(EMPTY_VALUE);
    expect(formatOverlayValue("x", "")).toBe(EMPTY_VALUE);
    expect(EMPTY_VALUE).toBe("—");
  });
  it("an integer as it is (no grouping, no rounding), 0 is a value", () => {
    expect(formatOverlayValue("group.size", 2)).toBe("2");
    expect(formatOverlayValue("year", 2014)).toBe("2014");
    expect(formatOverlayValue("n", 1234567)).toBe("1234567");
    expect(formatOverlayValue("n", 0)).toBe("0");
  });
  it("a float to ~4 significant digits", () => {
    expect(formatOverlayValue("dist_km", 1.234567)).toBe("1.235");
    expect(formatOverlayValue("density", 0.000123456)).toBe("0.0001235");
    expect(formatOverlayValue("area", 12345.678)).toBe("12350");
  });
  it("never rounds an id, whatever its type", () => {
    expect(formatOverlayValue("sightid", 20140612003)).toBe("20140612003");
    expect(formatOverlayValue("segment_id", 1234.56789)).toBe("1234.56789");
    expect(formatOverlayValue("FID", 42908)).toBe("42908");
    expect(formatOverlayValue("objectid", 3.14159265)).toBe("3.14159265");
  });
  it("a longitude/latitude keeps 5 decimals (a 4-digit rounding would move it ~1 km)", () => {
    expect(formatOverlayValue("lat", 28.6254321)).toBe("28.62543");
    expect(formatOverlayValue("decimalLongitude", -86.1234567)).toBe("-86.12346");
  });
  it("strings verbatim (dates arrive as ISO strings), booleans as words", () => {
    expect(formatOverlayValue("date", "2014-06-12T13:45:00Z")).toBe("2014-06-12T13:45:00Z");
    expect(formatOverlayValue("models", "|rices_whale|")).toBe("|rices_whale|");
    expect(formatOverlayValue("on_effort", true)).toBe("true");
    expect(formatOverlayValue("on_effort", false)).toBe("false");
  });
});

describe("overlayRows: every property, the overlay's fields first, its labels", () => {
  it("lists the `fields` in order, then every other property in the feature's own order", () => {
    const rows = overlayRows(SIGHTINGS, SIGHTING);
    expect(rows.map((r) => r.key)).toEqual([
      "sightid",
      "vernacularName",
      "group.size",
      "beaufort",
      "survey",
      "date",
      "lat",
      "lon",
      "dist_km",
      "models",
    ]);
    // all properties present
    for (const k of Object.keys(SIGHTING)) expect(rows.some((r) => r.key === k)).toBe(true);
  });
  it("a listed field the feature lacks (a vector tile drops nulls) is a row reading '—'", () => {
    expect(overlayRows(SIGHTINGS, SIGHTING).find((r) => r.key === "beaufort")).toEqual({
      key: "beaufort",
      label: "beaufort",
      value: "—",
    });
  });
  it("field_labels name a row; otherwise the property name does", () => {
    const rows = overlayRows(SIGHTINGS, SIGHTING);
    expect(rows.find((r) => r.key === "group.size")?.label).toBe("Group size");
    expect(rows.find((r) => r.key === "vernacularName")?.label).toBe("Species");
    expect(rows.find((r) => r.key === "survey")?.label).toBe("survey");
  });
  it("no `fields`: every property in the feature's own order", () => {
    expect(overlayRows(EFFORT, { b: 1, a: 2 }).map((r) => r.key)).toEqual(["b", "a"]);
  });
});

describe("overlayPopupHtml", () => {
  const hit = (properties: Record<string, unknown>, spec = SIGHTINGS): OverlayHit => ({
    spec,
    properties,
  });

  it("a heading of the overlay title and the label value, then one row per property", () => {
    const html = overlayPopupHtml([hit(SIGHTING)], null);
    expect(html).toContain('<span class="atlas-popup-ov-title">Vessel sightings, 2003–2024</span>');
    expect(html).toContain('<span class="atlas-popup-ov-label">Rice&#39;s whale</span>');
    expect(rowsOf(html)).toEqual([
      ["sightid", "20140612003"],
      ["Species", "Rice&#39;s whale"],
      ["Group size", "2"],
      ["beaufort", "—"],
      ["survey", "GU1402"],
      ["date", "2014-06-12"],
      ["lat", "28.62543"],
      ["lon", "-86.12346"],
      ["dist_km", "1.235"],
      ["models", "|rices_whale|"],
    ]);
  });

  it("groups by overlay in the order given (top overlay first), each feature its own block", () => {
    const html = overlayPopupHtml(
      [hit(SIGHTING), hit({ ...SIGHTING, sightid: 2 }), hit({ seg: 7 }, EFFORT)],
      null,
    );
    const titles = [...html.matchAll(/atlas-popup-ov-title">(.*?)</g)].map((m) => m[1]);
    expect(titles).toEqual([
      "Vessel sightings, 2003–2024",
      "Vessel sightings, 2003–2024",
      "Vessel effort",
    ]);
    // an overlay without a label_field: the title alone
    expect(html.split("atlas-popup-ov-feature").length - 1).toBe(3);
  });

  it("escapes every value: a property holding markup renders as text", () => {
    const evil = "<img src=x onerror=alert(1)>";
    const html = overlayPopupHtml(
      [hit({ ...SIGHTING, survey: evil, vernacularName: evil, [evil]: evil })],
      evil,
    );
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    // in the heading, a row label, a row value and the value line alike
    expect(html.match(/&lt;img src=x onerror=alert\(1\)&gt;/g)!.length).toBeGreaterThanOrEqual(5);
    const quoted = overlayPopupHtml([hit({ note: `"><script>x</script>` })], null);
    expect(quoted).not.toContain("<script>");
    expect(quoted).toContain("&quot;&gt;&lt;script&gt;");
  });

  it("caps the list at 25 features and says how many more", () => {
    const many = Array.from({ length: 31 }, (_, i) => hit({ ...SIGHTING, sightid: i }));
    const html = overlayPopupHtml(many, null);
    expect(FEATURE_CAP).toBe(25);
    expect(html.split('class="atlas-popup-ov-feature"').length - 1).toBe(25);
    expect(html).toContain(`<p class="atlas-popup-ov-more">${moreText(6)}</p>`);
    expect(moreText(6)).toBe("and 6 more");
    // exactly at the cap: no "more" line
    expect(overlayPopupHtml(many.slice(0, 25), null)).not.toContain("atlas-popup-ov-more");
  });

  it("the Item's value line sits under the list (hidden until a raster value arrives)", () => {
    const withCell = overlayPopupHtml([hit(SIGHTING)], "Cell 1234: 0.42");
    expect(withCell).toMatch(/<\/div><p class="atlas-popup-ov-cell">Cell 1234: 0\.42<\/p><\/div>$/);
    expect(overlayPopupHtml([hit(SIGHTING)], null)).toContain(
      '<p class="atlas-popup-ov-cell" hidden></p>',
    );
  });
});

describe("hover and announce text", () => {
  it("the hover says the label, else the overlay title", () => {
    expect(overlayHoverText({ spec: SIGHTINGS, properties: SIGHTING })).toBe("Rice's whale");
    expect(overlayHoverText({ spec: SIGHTINGS, properties: { sightid: 1 } })).toBe(
      "Vessel sightings, 2003–2024",
    );
    expect(overlayHoverText({ spec: EFFORT, properties: { seg: 1 } })).toBe("Vessel effort");
    expect(overlayLabel({ spec: SIGHTINGS, properties: { vernacularName: "" } })).toBeNull();
  });
  it("the announcement counts the features and names the first", () => {
    const one = { spec: SIGHTINGS, properties: SIGHTING };
    expect(overlayAnnounceText([one])).toBe("Vessel sightings, 2003–2024: Rice's whale");
    expect(overlayAnnounceText([one, { spec: EFFORT, properties: {} }])).toBe(
      "2 features here. Vessel sightings, 2003–2024: Rice's whale",
    );
    expect(overlayAnnounceText([])).toBe("");
  });
});
