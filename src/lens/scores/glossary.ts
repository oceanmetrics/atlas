// atlas-4 step 2/3 — the species table's column glossary content (parity doc §5.5 modal 3 /
// app.R:2604-2628), pulled out of GlossaryModal.svelte into a plain module so the ER rule's exact
// weights are asserted by a test rather than only ever read off the rendered dialog (CLAUDE.md:
// "keep core logic in an exported function... a component only calls it").
export interface GlossaryTerm {
  term: string;
  def: string;
}

export const GLOSSARY_COLUMNS: readonly GlossaryTerm[] = [
  {
    term: "cat",
    def: "The species category (bird, coral, fish, invertebrate, mammal, other, primary producer, turtle).",
  },
  {
    term: "taxon",
    def: "The taxon's authority and id (BOTW or WoRMS), linked to that authority's own record.",
  },
  { term: "scientific", def: "The scientific name." },
  { term: "common", def: "The common name, when published." },
  {
    term: "er_code",
    def: "The extinction-risk code (e.g. EN, VU, NT, LC, DD) from its governing list (IUCN, or NMFS/FWS where MMPA/MBTA applies).",
  },
  { term: "er_score", def: "The extinction-risk weight, as a percent of the rule below." },
  { term: "model", def: "The distribution model id, linked to that species in the Species lens." },
  { term: "is_mmpa", def: "Protected under the Marine Mammal Protection Act." },
  { term: "is_mbta", def: "Protected under the Migratory Bird Treaty Act." },
  { term: "area_km2", def: "The area (km²) of the selection this species' model covers." },
  { term: "avg_suit", def: "The average modeled habitat suitability over the selection." },
  {
    term: "pct_cat",
    def: "This row's share of its category's total suitability x extinction-risk x area.",
  },
];

export interface ErRuleRow {
  label: string;
  weight: number;
}

/**
 * The er_score weighting rule, verbatim (parity doc §5.5 modal 3): `NMFS|FWS:EN=100,
 * NMFS|FWS:TN=50, IUCN:CR=50, IUCN:EN=25, IUCN:VU=5, IUCN:NT=2, IUCN:LC|DD=1, MMPA=20, MBTA=10`.
 * `tests/lens/scores/glossary.test.ts` pins every value individually, so a typo (e.g. EN 100 -> 99)
 * shows up as exactly the row that changed, not a broad diff.
 */
export const ER_RULE: readonly ErRuleRow[] = [
  { label: "NMFS/FWS: EN", weight: 100 },
  { label: "NMFS/FWS: TN", weight: 50 },
  { label: "IUCN: CR", weight: 50 },
  { label: "IUCN: EN", weight: 25 },
  { label: "IUCN: VU", weight: 5 },
  { label: "IUCN: NT", weight: 2 },
  { label: "IUCN: LC / DD", weight: 1 },
  { label: "MMPA", weight: 20 },
  { label: "MBTA", weight: 10 },
];
