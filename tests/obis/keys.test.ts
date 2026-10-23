// The OBIS layer's keys (src/lens/collection/h3/share.ts `h3ShortcutFor`, `H3_SHORTCUTS`): obis-hex `help/keys.ts`
// for the keys the atlas did not have (`g`); the atlas's own (+, −, Esc, Tab) are its Help list's.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { H3_SHORTCUTS, h3ShortcutFor } from "../../src/lens/collection/h3/share";

describe("keys", () => {
  it("shortcut map and guards: g toggles the globe; never while typing, with a modifier or under a modal", () => {
    expect(h3ShortcutFor({ key: "g" })).toBe("projection");
    expect(h3ShortcutFor({ key: "G" })).toBe("projection");
    expect(h3ShortcutFor({ key: "x" })).toBeNull();
    for (const tag of ["INPUT", "textarea", "SELECT"])
      expect(h3ShortcutFor({ key: "g", targetTag: tag })).toBeNull();
    expect(h3ShortcutFor({ key: "g", targetEditable: true })).toBeNull();
    expect(h3ShortcutFor({ key: "g", ctrlKey: true })).toBeNull();
    expect(h3ShortcutFor({ key: "g", altKey: true })).toBeNull();
    expect(h3ShortcutFor({ key: "g", metaKey: true })).toBeNull();
    expect(h3ShortcutFor({ key: "g" }, { busy: true })).toBeNull();
    expect(H3_SHORTCUTS.map((s) => s.keys.join(" "))).toEqual(["g", "← →"]);
  });
  it("the Help menu lists g for a hexagon layer, beside the atlas's own keys", () => {
    const shell = readFileSync("src/shell/Shell.svelte", "utf8");
    expect(shell).toContain("<li>g — globe or flat map (hexagon layers)</li>");
    expect(shell).toContain("<li>= — zoom the map in</li>");
    expect(shell).toContain('data-testid="help-h3-layer"');
  });
});
