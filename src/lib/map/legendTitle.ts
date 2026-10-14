// Ben's ask (round-3 review, 2026-09-25 — folded in as UI-L2): "Given the different toolbar
// selections and data layer options, we should probably update the Legend to mention which layer
// is being displayed." ONE pure builder, used by the desktop legend card, the phone legend chip's
// short form, the phone Legend modal, and the Download menu's PNG/SVG footer title
// (`lib/download/legendFormat.ts`) — so an exported figure says the same thing the screen does.
//
// Two forms:
//   - collection:  "{item label}" title (e.g. "Richness of sharks, summer"), "{collection title} ·
//     {value unit}" subtitle (a missing clause just drops).
//   - species:     "{common name} (*{binomial}*)" title, "{input label} · {representation} ·
//     {value semantics}" subtitle.
export interface LegendTitleContext {
  lens: "collection" | "species";
  /** collection only: the item's own title (the dimension selection spelled out), else its id. */
  itemLabel?: string;
  /** collection only: the collection's own title. */
  collectionTitle?: string;
  /** collection only: what the values mean (`sdm:value_unit`, e.g. "unitless", "individuals/km2"). */
  valueUnit?: string;
  /** species only. */
  commonName?: string;
  scientificName?: string;
  /** the active input pill's own label (e.g. "FWS Range", "Merged model", "AquaMaps"). */
  inputLabel?: string;
  /** "presence", "habitat suitability 1–100", "as delivered", … */
  valueSemantics?: string;
  /** "presence" / "habitat suitability" / … — `layerBar.ts`'s own representation word, distinct
   * from `valueSemantics` (the brief's forms combine them into one clause per example, so a caller
   * with only one of the two may pass either and leave the other empty). */
  representation?: string;
}

export interface LegendTitle {
  title: string;
  /** `null` when there is nothing more to say than the title (an "unavailable"/"empty" legend, or
   * a caller that supplied no context beyond the bare label). */
  subtitle: string | null;
}

function joinClauses(clauses: readonly (string | null | undefined)[]): string | null {
  const parts = clauses.filter((c): c is string => Boolean(c && c.trim()));
  return parts.length ? parts.join(" · ") : null;
}

/** the collection lens: the item's label, then which collection it belongs to and its value unit. */
function collectionLegendTitle(ctx: LegendTitleContext): LegendTitle {
  return {
    title: ctx.itemLabel?.trim() || "Layer",
    subtitle: joinClauses([ctx.collectionTitle, ctx.valueUnit]),
  };
}

/** the species lens: common name + italic-flagged binomial as the title (the caller renders the
 * `.sci`/italics styling — this module only marks WHERE the scientific name is, via the return
 * shape below, never markup). */
function speciesLegendTitle(ctx: LegendTitleContext): LegendTitle {
  const common = ctx.commonName?.trim();
  const sci = ctx.scientificName?.trim();
  const title = common && sci ? `${common} (${sci})` : (common ?? sci ?? "Species");
  return { title, subtitle: joinClauses([ctx.inputLabel, ctx.representation, ctx.valueSemantics]) };
}

/**
 * The legend's title + subtitle for `ctx` — see the module header for the three forms. Never
 * throws on a partial context: every field not supplied just drops its clause from the subtitle
 * (a caller mid-wiring, or a release that publishes less metadata than another, still gets a
 * correct — if shorter — legend rather than an error).
 */
export function legendTitle(ctx: LegendTitleContext): LegendTitle {
  return ctx.lens === "species" ? speciesLegendTitle(ctx) : collectionLegendTitle(ctx);
}

/** the phone legend chip's SHORT form — the title alone (module header: "the chip's short form is
 * the title only"). */
export function legendChipTitle(ctx: LegendTitleContext): string {
  return legendTitle(ctx).title;
}
