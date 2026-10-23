// report/exportDocx.ts -- atlas-7 step 3, Export 4 (master plan D9: Word yes, no reference
// template -- "libs/ESP Report Template 2025_1 tech.docx" does not exist, so parity is a low bar
// and this uses CODED styles instead of a `reference-doc`). Reached only through `Report.svelte`'s
// dynamic `import()` (`docx`'s own pinReasons entry): never a static import.
//
// Builds the same three tables the screen/print document shows (Table of Scores, the species
// counts cross-tab, the Top 20) plus a rasterized flower per place and the map PNG when the caller
// already captured one (mapPng.ts) -- Word has no vector surface, so both go in as `ImageRun`s.
import type { ReportModel } from "../lib/report/model";
import { formatCount, formatErScore, formatScore0 } from "../lib/report/format";
import { flowerStandaloneSvg } from "./flowerSvg";
import { rasterizeSvg } from "./svgToPng";
// type-only: erased at compile time, so this never becomes a static runtime import of `docx`
// (see this module's own header -- the real module is loaded lazily below).
import type { Paragraph as ParagraphT, Table as TableT } from "docx";

// brand-adjacent palette (src/lib/brand/tokens.css's navy/teal family), coded here because a Word
// document cannot read a CSS custom property -- this is the "coded styles" D9 asks for.
const BRAND_NAVY = "12283F";
const BRAND_TEAL = "1B6E7A";
const BRAND_RULE = "C9D2DC";

export interface DocxExportOptions {
  mapPng?: { bytes: Uint8Array; width: number; height: number } | null;
  /** resolves a `--cat-*` CSS custom property to a concrete hex color (flowerSvg.ts's seam). */
  resolveColor: (cssVarName: string) => string;
}

export async function buildDocxBlob(model: ReportModel, opts: DocxExportOptions): Promise<Blob> {
  const docx = await import("docx");
  const {
    Document,
    Packer,
    Paragraph,
    TextRun,
    HeadingLevel,
    AlignmentType,
    Table,
    TableRow,
    TableCell,
    ImageRun,
    WidthType,
    BorderStyle,
  } = docx;

  const heading = (text: string, level: (typeof HeadingLevel)[keyof typeof HeadingLevel]) =>
    new Paragraph({ text, heading: level });

  const para = (text: string) => new Paragraph({ children: [new TextRun(text)] });

  const cell = (text: string, opts: { bold?: boolean; right?: boolean } = {}) =>
    new TableCell({
      children: [
        new Paragraph({
          alignment: opts.right ? AlignmentType.RIGHT : AlignmentType.LEFT,
          children: [new TextRun({ text, bold: opts.bold })],
        }),
      ],
    });

  // P4: the Table of Scores' own footnote marker -- a real Word superscript run appended after the
  // value, same information as the screen's `<sup>{id}</sup>` (Report.svelte). `footnoteId: null`
  // (the common case -- most cells carry none, P4's whole point) renders exactly like `cell()`.
  const scoreCell = (text: string, footnoteId: number | null, opts: { right?: boolean } = {}) =>
    new TableCell({
      children: [
        new Paragraph({
          alignment: opts.right ? AlignmentType.RIGHT : AlignmentType.LEFT,
          children: [
            new TextRun(text),
            ...(footnoteId !== null
              ? [new TextRun({ text: String(footnoteId), superScript: true })]
              : []),
          ],
        }),
      ],
    });

  const table = (header: string[], rows: string[][]) =>
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({ children: header.map((h) => cell(h, { bold: true })) }),
        ...rows.map(
          (r) =>
            new TableRow({ children: r.map((v) => cell(v, { right: /^-?[\d,.%]+$/.test(v) })) }),
        ),
      ],
    });

  const children: (ParagraphT | TableT)[] = [];

  children.push(heading(model.header.title, HeadingLevel.TITLE));
  children.push(para(`${model.header.releaseChip} — generated ${model.header.generatedLabel}`));
  children.push(para(model.header.permalink.href));
  if (model.header.previewBanner) children.push(para(`⚠ ${model.header.previewBanner}`));

  children.push(heading("Introduction", HeadingLevel.HEADING_1));
  children.push(para(model.intro.text));

  if (opts.mapPng) {
    children.push(heading("Map", HeadingLevel.HEADING_1));
    const scale = Math.min(1, 500 / opts.mapPng.width);
    children.push(
      new Paragraph({
        children: [
          new ImageRun({
            type: "png",
            data: opts.mapPng.bytes,
            transformation: {
              width: opts.mapPng.width * scale,
              height: opts.mapPng.height * scale,
            },
          }),
        ],
      }),
    );
  }

  children.push(heading("Plot of Scores", HeadingLevel.HEADING_1));
  for (const flower of model.flowers) {
    children.push(heading(flower.name, HeadingLevel.HEADING_2));
    const svg = flowerStandaloneSvg(flower.name, flower.geometry, flower.centre, {
      resolveColor: opts.resolveColor,
    });
    try {
      const raster = await rasterizeSvg(svg, 220, 220);
      children.push(
        new Paragraph({
          children: [
            new ImageRun({
              type: "png",
              data: raster.bytes,
              transformation: { width: raster.width, height: raster.height },
            }),
          ],
        }),
      );
    } catch {
      children.push(para(flower.detail)); // rasterization unavailable (non-browser test run) — text still carries the numbers
    }
  }

  children.push(heading("Table of Scores", HeadingLevel.HEADING_1));
  // P4: built by hand (not the generic `table()` helper above) because a component cell needs its
  // OWN footnote marker -- the same `cell.footnotes[0]` id the screen's `<sup>` reads
  // (`Report.svelte`'s Table of Scores section), never re-derived here.
  children.push(
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({
          children: ["Area", "N cells", ...model.scores.components, "Overall"].map((h) =>
            cell(h, { bold: true }),
          ),
        }),
        ...model.scores.rows.map(
          (r) =>
            new TableRow({
              children: [
                cell(r.name),
                cell(formatCount(r.nCells), { right: true }),
                ...r.cells.map((c) =>
                  scoreCell(
                    c.score === null ? "—" : formatScore0(c.score),
                    c.footnotes[0] ?? null,
                    {
                      right: true,
                    },
                  ),
                ),
                cell(r.overall === null ? "—" : formatScore0(r.overall), {
                  right: true,
                  bold: true,
                }),
              ],
            }),
        ),
      ],
    }),
  );
  // P4: the SAME grouped footnotes the screen's `<ol class="footnotes">` lists (Report.svelte) --
  // absent entirely (no paragraphs at all) when nothing in this report is below the coverage floor.
  for (const fn of model.scores.footnotes) {
    children.push(
      new Paragraph({
        children: [
          new TextRun({ text: `${fn.id}. `, superScript: true }),
          new TextRun({ text: fn.text, size: 18 }),
        ],
      }),
    );
  }

  children.push(heading("Summary of Species", HeadingLevel.HEADING_1));
  for (const species of model.species) {
    children.push(heading(species.name, HeadingLevel.HEADING_2));
    if (!species.counts || !species.top) {
      children.push(para(species.empty ?? "No species found for this area."));
      continue;
    }
    children.push(
      table(
        ["Category", ...species.counts.columns, "Total"],
        [
          ...species.counts.rows.map((r) => [
            r.category,
            ...r.counts.map(formatCount),
            formatCount(r.total),
          ]),
          [
            "Total",
            ...species.counts.totalRow.counts.map(formatCount),
            formatCount(species.counts.totalRow.total),
          ],
        ],
      ),
    );
    children.push(
      table(
        ["Category", "Common", "Scientific", "ER code", "ER score", "Score"],
        species.top.rows.map((r) => [
          r.sp_cat,
          r.sp_common ?? "",
          r.sp_scientific,
          r.er_code ?? "",
          r.er_score === null ? "" : formatErScore(r.er_score),
          formatScore0(r.suit_er_area),
        ]),
      ),
    );
  }

  children.push(heading("Sources and Method", HeadingLevel.HEADING_1));
  for (const p of model.sources.text) children.push(para(p));
  for (const c of model.sources.citations) children.push(para(`${c.label}: ${c.citation}`));

  children.push(heading("Provenance", HeadingLevel.HEADING_1));
  children.push(
    para(
      `Release ${model.provenance.ver} · ${model.provenance.status ?? "—"} · ${model.provenance.access ?? "—"}. ` +
        `Generated ${model.provenance.generatedAt}. App ${model.provenance.appSha}. DuckDB-WASM ${model.provenance.duckdbWasm ?? "—"}.`,
    ),
  );

  const doc = new Document({
    styles: {
      default: {
        document: { run: { font: "Calibri", size: 22 } },
      },
      paragraphStyles: [
        {
          id: "Title",
          name: "Title",
          basedOn: "Normal",
          next: "Normal",
          run: { size: 48, bold: true, color: BRAND_NAVY, font: "Georgia" },
        },
        {
          id: "Heading1",
          name: "Heading 1",
          basedOn: "Normal",
          next: "Normal",
          run: { size: 32, bold: true, color: BRAND_TEAL, font: "Georgia" },
          paragraph: {
            spacing: { before: 240, after: 120 },
            border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: BRAND_RULE } },
          },
        },
        {
          id: "Heading2",
          name: "Heading 2",
          basedOn: "Normal",
          next: "Normal",
          run: { size: 26, bold: true, color: BRAND_NAVY },
          paragraph: { spacing: { before: 180, after: 90 } },
        },
      ],
    },
    sections: [{ children }],
  });

  return Packer.toBlob(doc);
}

export async function downloadDocx(model: ReportModel, opts: DocxExportOptions): Promise<void> {
  const blob = await buildDocxBlob(model, opts);
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = `${model.header.fileStem}.docx`;
    a.click();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
