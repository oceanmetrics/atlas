import { describe, expect, it } from "vitest";
import { zonesTableRows } from "../../../src/lens/scores/zonesTable";
import { zoneRows, type ZoneRow } from "../../../src/lens/scores/boot";
import { BOOT_V7 } from "./fixtures";

const COMPOSITE = "score_extriskspcat_primprod_ecoregionrescaled_equalweights";

describe("zonesTableRows", () => {
  it("ranks by the current layer, descending, and equals boot.zones' own metrics exactly", () => {
    const rows = zonesTableRows(zoneRows(BOOT_V7, "programarea"), COMPOSITE, [
      "extrisk_bird_ecoregion_rescaled",
      "extrisk_other_ecoregion_rescaled",
    ]);
    expect(rows.map((r) => r.key)).toEqual(["GAA", "GEO"]); // GAA=33.09 > GEO=12
    expect(rows[0].value).toBe(33.09);
    expect(rows[0].components).toEqual([
      { label: "bird", score: 59.09 },
      { label: "other", score: 25.54 },
    ]);
  });

  it("unpublished values sort last regardless of direction", () => {
    const zones: ZoneRow[] = [
      { key: "A", name: "A", n_taxa: 1, metrics: { m: 5 } },
      { key: "B", name: "B", n_taxa: 1, metrics: {} },
      { key: "C", name: "C", n_taxa: 1, metrics: { m: 9 } },
    ];
    const rows = zonesTableRows(zones, "m", []);
    expect(rows.map((r) => r.key)).toEqual(["C", "A", "B"]);
  });
});
