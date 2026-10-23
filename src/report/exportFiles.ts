// report/exportFiles.ts -- atlas-7 step 3, Export 3 (the data package ZIP). PURE: builds the
// textual contents of every file the ZIP holds from a `ReportModel` alone, so the rule "what goes
// in the package" is unit-testable without touching `fflate` or the DOM (CLAUDE.md: core logic
// lives in an exported function; `exportZip.ts` only zips whatever this returns).
//
// `scores.csv`/`species.csv` are PER PLACE (spec §"Exports" 3); `species.csv` reuses the exact CSV
// serializer the Table panel's own species download already uses
// (`lens/scores/species.ts#toCsv`) over `SPECIES_CSV_COLUMNS`, so a re-download from the report and
// a re-download from the app produce byte-identical rows for the same place -- never a second CSV
// writer with its own quoting rule.
import { WORDMARK_TEXT } from "../lib/brand/instance";
import { toCsv } from "../lens/scores/species";
import { SPECIES_CSV_COLUMNS } from "../lib/report/species";
import type { ReportModel, ReportPlaceInput } from "../lib/report/model";
import { slugify } from "../lib/report/format";
import type { AreaGeometry } from "../lib/geo/types";

export interface PackageFile {
  path: string;
  content: string;
}

function csvField(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** `scores_<slug>.csv`: one row per component this place has, plus a final `Overall` row -- the
 * SAME numbers `ScoresTableSection` prints, never re-derived from the raw components. P4: a place
 * whose Table of Scores row carries a footnote (below the coverage floor, or a component the
 * workflow's own 5 % floor dropped entirely) gets that SAME sentence appended as a trailing `Note`
 * row -- the ZIP export renders the same footnotes as the screen, same as the HTML/DOCX exports. */
export function scoresCsv(model: ReportModel, placeIndex: number): string {
  const row = model.scores.rows[placeIndex];
  const header = ["component", "score"].map(csvField).join(",");
  const lines = row.cells
    .filter((c) => c.score !== null)
    .map((c) => [csvField(c.component), csvField(c.score)].join(","));
  lines.push([csvField("Overall"), csvField(row.overall)].join(","));
  const footnote = model.scores.footnotes.find((fn) => fn.place === row.name);
  if (footnote) lines.push([csvField("Note"), csvField(footnote.text)].join(","));
  return [header, ...lines].join("\r\n") + "\r\n";
}

/** `species_<slug>.csv`: the full list, in the model's own `csvColumns` order. */
export function speciesCsv(model: ReportModel, placeIndex: number): string {
  const species = model.species[placeIndex];
  const rows = species.full ?? [];
  const cols = species.csvColumns.length ? species.csvColumns : SPECIES_CSV_COLUMNS;
  return toCsv(
    rows,
    cols.map((key) => ({ key, value: (r: (typeof rows)[number]) => (r as never)[key] })),
  );
}

/** `places.geojson`: a `FeatureCollection` of every custom (drawn) place's decoded geometry --
 * zone places carry no geometry here (their boundary is the release's own PMTiles archive, not
 * something this report ever downloaded), so they are simply absent, never a fabricated shape. */
export function placesGeoJson(places: readonly ReportPlaceInput[]): string {
  const features = places
    .filter((p): p is ReportPlaceInput & { geometry: AreaGeometry } => p.geometry !== undefined)
    .map((p) => ({
      type: "Feature" as const,
      properties: { name: p.name, kind: p.place.kind, token: p.token },
      geometry: p.geometry,
    }));
  return JSON.stringify({ type: "FeatureCollection", features }, null, 2);
}

/** `CITATION.md`: every cited dataset, one bullet each. */
export function citationMarkdown(model: ReportModel): string {
  const lines = [`# Citations — ${model.header.title}`, ""];
  if (model.sources.citations.length === 0) {
    lines.push("No dataset in this release published a citation.");
  } else {
    for (const c of model.sources.citations) {
      lines.push(`- **${c.label}**: ${c.citation}${c.href ? ` (${c.href})` : ""}`);
    }
  }
  return lines.join("\n") + "\n";
}

/** `README.md`: what this package is, and the permalink that reproduces it exactly. */
export function readmeMarkdown(model: ReportModel): string {
  return (
    `# ${model.header.title}\n\n` +
    `Release ${model.header.releaseChip}. Generated ${model.header.generatedLabel}.\n\n` +
    `This package was downloaded from a ${WORDMARK_TEXT} report. The permalink below ` +
    `reproduces the exact same document, recomputed in a browser from the same immutable release:\n\n` +
    `${model.header.permalink.href}\n\n` +
    `## Contents\n\n` +
    `- \`scores_<place>.csv\` / \`species_<place>.csv\` — one pair per reported place\n` +
    `- \`places.geojson\` — every drawn/uploaded place's analysed geometry (zone places are the ` +
    `release's own published boundary, not repeated here)\n` +
    `- \`query/*.sql\` — the SQL that actually ran\n` +
    `- \`provenance.json\` — tables read, digests, the app version, and how to reproduce this in R\n` +
    `- \`CITATION.md\` — dataset citations for this release\n`
  );
}

/** every file the data-package ZIP holds, keyed by its path inside the archive. */
export function buildDataPackageFiles(
  model: ReportModel,
  places: readonly ReportPlaceInput[],
): PackageFile[] {
  const files: PackageFile[] = [
    { path: "README.md", content: readmeMarkdown(model) },
    { path: "CITATION.md", content: citationMarkdown(model) },
    { path: "provenance.json", content: JSON.stringify(model.provenance, null, 2) },
    { path: "places.geojson", content: placesGeoJson(places) },
  ];
  places.forEach((p, i) => {
    const slug = slugify(p.name);
    files.push({ path: `scores_${slug}.csv`, content: scoresCsv(model, i) });
    files.push({ path: `species_${slug}.csv`, content: speciesCsv(model, i) });
  });
  model.provenance.sql.forEach((run) => {
    files.push({ path: `query/${run.name}.sql`, content: run.sql });
  });
  return files;
}
