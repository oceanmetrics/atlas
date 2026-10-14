// owner review item 6 (Ben, live 0.10.62): "Search bar is narrower for Species than Scores. Do we
// need this extra inset outline or can we keep it clean and wide without?" Two bugs in one
// sentence, both in the topbar `.search-field` pill (shell.css):
//   1. `SpeciesPicker.svelte`'s `.species-picker` had no `width: 100%` of its own -- as a flex
//      item of `.search-field` (inline-flex, row) it sized to its content instead of stretching,
//      unlike `ScoresSearch.svelte`'s own `.scores-search`, which already carried that rule.
//   2. Both components' own `<input>` repeated `.search-field`'s own border/padding/background one
//      level down, nesting a visible second ring inside the field's own -- shell.css now strips it
//      on the desktop topbar field only (`.topbar .search-field .picker-input`/`.scores-search-input`).
// RED-FIRST: this fails on the pre-fix tree (species input ~40px narrower than scores', both with
// their own 1px border visible inside the field's own).
import { expect, test } from "@playwright/test";
import { gotoSpecies } from "./species-hermetic";

const DESKTOP = { width: 1280, height: 800 };

test.describe("the topbar search field is the SAME width in both lenses, with no doubled inset border", () => {
  test.use({ viewport: DESKTOP });

  test("the Collections and Species search inputs fill their shared .search-field pill equally, borderless", async ({
    page,
  }) => {
    // v7, public -- no preview session needed (species-hermetic.ts's own default fixture set is v9).
    await gotoSpecies(page, "/", "v7");

    const field = page.locator(".search-field");
    const fieldBox = (await field.boundingBox())!;

    // default lens on load with no `?sp=`/`?lens=` is "collection" (defaultLens()).
    const collectionsInput = page.locator(".search-field input[type=search]");
    await expect(collectionsInput).toBeVisible();
    const collectionsBox = (await collectionsInput.boundingBox())!;
    expect(
      await collectionsInput.evaluate((el) => getComputedStyle(el).borderWidth),
      "the Collections search input must carry no border of its own on the desktop field",
    ).toBe("0px");

    await page.locator(".topbar").getByRole("button", { name: "Species" }).click();
    const speciesInput = page.locator(".search-field .picker-input");
    await expect(speciesInput).toBeVisible();
    const speciesBox = (await speciesInput.boundingBox())!;
    expect(
      await speciesInput.evaluate((el) => getComputedStyle(el).borderWidth),
      "the species search input must carry no border of its own on the desktop field",
    ).toBe("0px");

    expect(
      Math.abs(speciesBox.width - collectionsBox.width),
      `species (${speciesBox.width}px) and Collections (${collectionsBox.width}px) search inputs must be the same width`,
    ).toBeLessThanOrEqual(0.5);
    // the field's own chrome (the search icon + its gap + the field's own horizontal padding,
    // shell.css's `.search-field`) accounts for the remaining ~50px -- this bounds it well under
    // the field's own 240px width, so a REGRESSION back to the bug (species alone losing another
    // ~40px to its own inner padding/border) would still be caught.
    expect(fieldBox.width - speciesBox.width).toBeLessThan(60);
  });
});
