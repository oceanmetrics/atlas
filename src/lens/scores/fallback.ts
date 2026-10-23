// atlas-4 gate: "an unknown `unit`/`lyr` in the URL falls back without a blank map." Pure — the
// component reads `sel.unit`/`sel.lyr` through these rather than trusting the URL value directly.
import { defaultLayerKey, layerByKey, primaryUnitType } from "./boot";

/** `"cell"`, or the release's own drawable unit type when `unit` names it; anything else (a typo,
 * a retired unit, a unit from a DIFFERENT release reached via a stale link) falls back to `"cell"`
 * rather than drawing an empty choropleth for a unit that does not exist here. */
export function effectiveUnit(unit: string, boot: unknown): string {
  if (unit === "cell") return "cell";
  return unit === primaryUnitType(boot) ? unit : "cell";
}

/** `lyr` when the release actually has that `metric_key`; otherwise the release's own composite
 * (overall score) default — never `undefined` reaching the raster/legend builders, which would
 * otherwise render nothing. */
export function effectiveLyr(lyr: string | undefined, boot: unknown): string | null {
  if (lyr && layerByKey(boot, lyr)) return lyr;
  return defaultLayerKey(boot);
}
