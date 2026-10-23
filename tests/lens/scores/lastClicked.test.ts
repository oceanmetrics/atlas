// R3-W8 item 5 fix round: `lastClickedLabel` -- the Report pane's "Last clicked" row label. See
// lastClicked.ts's own header for why this module stays cheap/static while the "Add to places"
// mutation (`lastClickedPlace.ts#placeFromLastClicked`) is its own dynamically-imported module.
import { describe, expect, it } from "vitest";
import { lastClickedLabel } from "../../../src/lens/scores/lastClicked";
import { BOOT_V7 } from "./fixtures";

describe("lastClickedLabel", () => {
  it("null selection: null (row hidden)", () => {
    expect(lastClickedLabel(null, BOOT_V7)).toBeNull();
  });

  it("boot not resolved yet: null, never a throw", () => {
    expect(lastClickedLabel({ kind: "cell", cellId: 1 }, null)).toBeNull();
    expect(lastClickedLabel({ kind: "cell", cellId: 1 }, undefined)).toBeNull();
  });

  it("a clicked cell: the SAME formatSubject() line the popup/flower/table already use", () => {
    // cell 1 of BOOT_V7's own usa05 grid (xmin 141.1, ymax 82.6, res 0.05, lon360): row 0, col 0 ->
    // centre (141.125, 82.575) -- wrapped to -180..180 by cellRing() -> lon -218.875 + 360.
    const label = lastClickedLabel({ kind: "cell", cellId: 1 }, BOOT_V7);
    expect(label).toMatch(/^Cell 1 · \d+\.\d+° [NS], \d+\.\d+° [EW]$/);
  });

  it("a clicked zone with a real published name: 'Full Name (KEY)' (paLabel)", () => {
    expect(lastClickedLabel({ kind: "zone", unit: "programarea", key: "GAA" }, BOOT_V7)).toBe(
      "Gulf of America, Eastern (GAA)",
    );
  });

  it("a clicked zone with no matching boot row: falls back to the bare key", () => {
    expect(lastClickedLabel({ kind: "zone", unit: "programarea", key: "ZZZ" }, BOOT_V7)).toBe(
      "ZZZ",
    );
  });
});
