// Rule-level tests for the Table of Scores: the plain mean, the union of component columns, and
// D7b's coverage footnotes. The R-fixture gate lives in `numbers.test.ts`; this file pins the
// branches a real release happens not to exercise (a component absent from one place, a `null`
// coverage, an empty report).
import { describe, expect, it } from "vitest";
import {
  componentColumns,
  overallScore,
  scoresTable,
  type ReportComponent,
} from "../../../src/lib/report/scores";

const comp = (
  component: string,
  score: number,
  coverage: number | null = 1,
  mean: number | null = score,
): ReportComponent => ({
  metric_key: `extrisk_${component}_ecoregion_rescaled`,
  component,
  score,
  even: 1,
  coverage,
  mean_where_present: mean,
});

describe("overallScore -- msens::mean_score(), the PLAIN mean of the components present", () => {
  it("is the unweighted mean, whatever the coverages are", () => {
    expect(overallScore([comp("bird", 10, 0.1), comp("fish", 20, 1)])).toBe(15);
  });

  it("a component with no row is absent from the mean, never a zero in it", () => {
    // three components in the release, two scored: 30, not 20.
    expect(overallScore([comp("bird", 20), comp("fish", 40)])).toBe(30);
  });

  it("no component at all is null (R's NaN), not 0", () => {
    expect(overallScore([])).toBeNull();
  });

  it("a non-finite score is skipped rather than poisoning the mean", () => {
    expect(overallScore([comp("bird", Number.NaN), comp("fish", 40)])).toBe(40);
  });
});

describe("componentColumns", () => {
  it("is the union over the report's places, in first-seen order", () => {
    expect(
      componentColumns([
        { components: [comp("bird", 1), comp("fish", 2)] },
        { components: [comp("fish", 3), comp("turtle", 4)] },
      ]),
    ).toEqual(["bird", "fish", "turtle"]);
  });
});

describe("scoresTable", () => {
  const place = (name: string, components: ReportComponent[]) => ({
    name,
    areaKm2: 100,
    nCells: 10,
    components,
    overall: overallScore(components),
  });

  it("keeps the places in the order given -- no sorting, no row limit (report.qmd:326-349)", () => {
    const t = scoresTable([place("Zed", [comp("bird", 1)]), place("Alpha", [comp("bird", 2)])]);
    expect(t.rows.map((r) => r.name)).toEqual(["Zed", "Alpha"]);
  });

  it("a place missing a component gets a blank cell, and its own Overall never saw it", () => {
    const t = scoresTable([
      place("A", [comp("bird", 10), comp("fish", 30)]),
      place("B", [comp("bird", 50)]),
    ]);
    expect(t.components).toEqual(["bird", "fish"]);
    expect(t.rows[1].cells.map((c) => c.score)).toEqual([50, null]);
    expect(t.rows[1].overall).toBe(50);
  });

  // P4 (Ben, phone, "Report" tool): the OLD rule footnoted anything short of ~100.0000000 %
  // coverage -- essentially every component of every place, since float coverage is almost never
  // exactly 1 -- producing a marker on nearly every cell and one near-identical footnote per
  // component. The new rule floors at 99 % (compared against the SAME `formatCoveragePctFloor()`
  // value the sentence prints) and groups every triggering component of a place into ONE sentence.
  it("a component at or above the 99 % floor does NOT footnote (99.9 %, and 99.0 % exactly)", () => {
    expect(scoresTable([place("A", [comp("bird", 40, 0.999)])]).footnotes).toEqual([]);
    expect(scoresTable([place("A", [comp("bird", 40, 0.99)])]).footnotes).toEqual([]);
  });

  it("a coverage of exactly 1 does NOT footnote", () => {
    expect(scoresTable([place("A", [comp("bird", 40, 1)])]).footnotes).toEqual([]);
  });

  it("a component below the 99 % floor DOES footnote (88.3 %)", () => {
    const t = scoresTable([place("ALA", [comp("turtle", 40, 0.883, 40)])]);
    expect(t.footnotes).toHaveLength(1);
    expect(t.footnotes[0]).toMatchObject({ id: 1, place: "ALA", components: ["turtle"] });
    expect(t.rows[0].cells[0].footnotes).toEqual([1]);
  });

  it("the footnote sentence matches the brief's own example exactly, mean omitted when it equals the displayed cell", () => {
    // mean_where_present (40) rounds to the SAME displayed cell value (40) -- "mean 40 where
    // scored" would be pure restatement, so it is left off entirely.
    const t = scoresTable([place("ALA", [comp("turtle", 40, 0.883, 40)])]);
    expect(t.footnotes[0].text).toBe("ALA: turtle scored over 88.3% of the area.");
  });

  it("mean-where-scored IS appended when it differs from the displayed cell value after rounding", () => {
    const t = scoresTable([place("ALA", [comp("turtle", 42, 0.883, 80)])]);
    expect(t.footnotes[0].text).toBe(
      "ALA: turtle scored over 88.3% of the area, mean 80 where scored.",
    );
  });

  it("multiple below-floor components in ONE area join ONE comma-separated sentence, one footnote", () => {
    const t = scoresTable([
      place("ALA", [comp("turtle", 40, 0.883, 40), comp("coral", 20, 0.5, 20)]),
    ]);
    expect(t.footnotes).toHaveLength(1);
    expect(t.footnotes[0].components).toEqual(["turtle", "coral"]);
    expect(t.footnotes[0].text).toBe(
      "ALA: turtle scored over 88.3% of the area, coral scored over 50% of the area.",
    );
    expect(t.rows[0].cells[0].footnotes).toEqual([1]);
    expect(t.rows[0].cells[1].footnotes).toEqual([1]);
  });

  it('a component the release never published for this place (absent, shown as "--") is grouped in too, worded as below the workflow\'s 5 % floor', () => {
    // "turtle" is a real column (place A carries it), but place B's row has no turtle component at
    // all -> byLabel.get("turtle") misses -> the same grouped mechanism, not a silent blank.
    const t = scoresTable([
      place("A", [comp("bird", 40), comp("turtle", 5, 0.02, 5)]),
      place("B", [comp("bird", 10)]),
    ]);
    expect(t.rows[1].cells.find((c) => c.component === "turtle")).toMatchObject({
      score: null,
      footnotes: [t.footnotes.find((f) => f.place === "B")!.id],
    });
    expect(t.footnotes.find((f) => f.place === "B")!.text).toBe(
      "B: turtle not scored (coverage below the 5% floor).",
    );
  });

  it("a fully-covered place with nothing absent gets NO footnote at all -- no markers, no list", () => {
    const t = scoresTable([place("FULL", [comp("bird", 40, 1), comp("fish", 20, 0.999)])]);
    expect(t.footnotes).toEqual([]);
    expect(t.rows[0].cells.every((c) => c.footnotes.length === 0)).toBe(true);
  });

  it("a NULL coverage does NOT footnote: 'we cannot say' is not 'it is complete'", () => {
    expect(scoresTable([place("A", [comp("bird", 40, null, null)])]).footnotes).toEqual([]);
  });

  // fix round 2, item 4 (still true under the new 99 % floor): the footnote text is a claim
  // ("scored over X% of the area") -- a coverage of 0.988740 rounds UP to "98.9%" (Math.round),
  // which the place's actual 98.874% does not exceed. The footnote must FLOOR instead.
  it("never overstates the footnote's 'over X%' claim (0.98874 floors to 98.8%, not round()'s 98.9%)", () => {
    const t = scoresTable([place("A", [comp("bird", 40, 0.98874, 40.05)])]);
    expect(t.footnotes[0].text).toContain("over 98.8% of the area");
    expect(t.footnotes[0].text).not.toContain("98.9%");
  });

  it("footnote ids are assigned in place order, skipping a place with nothing to note", () => {
    const t = scoresTable([
      place("A", [comp("bird", 1, 0.5), comp("fish", 2, 0.5)]),
      // CLEAN carries BOTH columns at full coverage -- nothing below the floor, nothing absent.
      place("CLEAN", [comp("bird", 3, 1), comp("fish", 4, 1)]),
      place("B", [comp("bird", 3, 0.5), comp("fish", 4, 0.5)]),
    ]);
    expect(t.footnotes.map((f) => [f.id, f.place])).toEqual([
      [1, "A"],
      [2, "B"],
    ]);
  });

  it("the table's text equivalent names every place and its Overall", () => {
    const t = scoresTable([place("A", [comp("bird", 41)]), place("B", [comp("bird", 12)])]);
    expect(t.summary).toBe("Table of scores, 2 places, overall score: A 41; B 12.");
  });

  it("an empty report is an empty table, not a throw", () => {
    const t = scoresTable([]);
    expect(t.rows).toEqual([]);
    expect(t.summary).toBe("Table of scores: no places.");
  });
});
