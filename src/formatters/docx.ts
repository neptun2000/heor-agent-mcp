import {
  Document,
  Paragraph,
  TextRun,
  HeadingLevel,
  Table,
  TableRow,
  TableCell,
  WidthType,
  AlignmentType,
  Packer,
} from "docx";
import type { LiteratureResult } from "../providers/types.js";
import type { AuditRecord } from "../audit/types.js";

export async function resultsToDocx(
  results: LiteratureResult[],
  audit: AuditRecord,
): Promise<string> {
  const doc = new Document({
    sections: [{
      properties: {},
      children: [
        // Title
        new Paragraph({
          children: [new TextRun({ text: "Literature Search Report", bold: true, size: 48 })],
          heading: HeadingLevel.TITLE,
          alignment: AlignmentType.CENTER,
          spacing: { after: 400 },
        }),
        // Metadata
        new Paragraph({
          children: [new TextRun({ text: `Generated: ${audit.timestamp} | Tool: ${audit.tool}`, italics: true, size: 20, color: "666666" })],
          alignment: AlignmentType.CENTER,
          spacing: { after: 600 },
        }),
        // Methodology
        new Paragraph({
          children: [new TextRun({ text: "Methodology", bold: true, size: 28 })],
          heading: HeadingLevel.HEADING_1,
        }),
        new Paragraph({
          children: [new TextRun({ text: audit.methodology || "Not specified", size: 22 })],
          spacing: { after: 200 },
        }),
        // Summary stats
        new Paragraph({
          children: [new TextRun({ text: "Summary", bold: true, size: 28 })],
          heading: HeadingLevel.HEADING_1,
        }),
        new Paragraph({
          children: [new TextRun({ text: `Total results included: ${audit.inclusions}`, size: 22 })],
        }),
        new Paragraph({
          children: [new TextRun({ text: `Sources queried: ${audit.sources_queried.length}`, size: 22 })],
          spacing: { after: 300 },
        }),
        // Results heading
        new Paragraph({
          children: [new TextRun({ text: "Results", bold: true, size: 28 })],
          heading: HeadingLevel.HEADING_1,
        }),
        // Each result
        ...results.flatMap((r, i) => [
          new Paragraph({
            children: [new TextRun({ text: `${i + 1}. ${r.title}`, bold: true, size: 24 })],
            heading: HeadingLevel.HEADING_2,
          }),
          new Paragraph({
            children: [
              new TextRun({ text: `Source: `, bold: true, size: 20 }),
              new TextRun({ text: `${r.source} | `, size: 20 }),
              new TextRun({ text: `Date: `, bold: true, size: 20 }),
              new TextRun({ text: `${r.date} | `, size: 20 }),
              new TextRun({ text: `Type: `, bold: true, size: 20 }),
              new TextRun({ text: r.study_type, size: 20 }),
            ],
          }),
          ...(r.authors.length > 0 ? [new Paragraph({
            children: [
              new TextRun({ text: "Authors: ", bold: true, size: 20 }),
              new TextRun({ text: r.authors.join(", "), size: 20 }),
            ],
          })] : []),
          ...(r.abstract ? [new Paragraph({
            children: [new TextRun({ text: r.abstract.slice(0, 500), size: 20 })],
            spacing: { before: 100 },
          })] : []),
          new Paragraph({
            children: [new TextRun({ text: r.url, size: 18, color: "0563C1" })],
            spacing: { after: 200 },
          }),
        ]),
        // Audit section
        new Paragraph({
          children: [new TextRun({ text: "Audit Trail", bold: true, size: 28 })],
          heading: HeadingLevel.HEADING_1,
          spacing: { before: 400 },
        }),
        // Sources table
        buildSourcesTable(audit),
        // Assumptions
        ...(audit.assumptions.length > 0 ? [
          new Paragraph({
            children: [new TextRun({ text: "Assumptions", bold: true, size: 24 })],
            heading: HeadingLevel.HEADING_2,
          }),
          ...audit.assumptions.map(a => new Paragraph({
            children: [new TextRun({ text: `• ${a}`, size: 20 })],
          })),
        ] : []),
        // Warnings
        ...(audit.warnings.length > 0 ? [
          new Paragraph({
            children: [new TextRun({ text: "Warnings", bold: true, size: 24 })],
            heading: HeadingLevel.HEADING_2,
          }),
          ...audit.warnings.map(w => new Paragraph({
            children: [new TextRun({ text: `Warning: ${w}`, size: 20, color: "CC6600" })],
          })),
        ] : []),
        // Disclaimer
        new Paragraph({
          children: [new TextRun({
            text: "Disclaimer: This is a preliminary report for orientation purposes only. Results require validation by a qualified health economist before use in any HTA submission or payer negotiation.",
            italics: true, size: 18, color: "999999",
          })],
          spacing: { before: 600 },
        }),
      ],
    }],
  });

  const buffer = await Packer.toBuffer(doc);
  return buffer.toString("base64");
}

function buildSourcesTable(audit: AuditRecord): Table {
  const headerRow = new TableRow({
    children: ["Source", "Query", "Returned", "Included", "Status"].map(text =>
      new TableCell({
        children: [new Paragraph({ children: [new TextRun({ text, bold: true, size: 20 })] })],
        width: { size: 20, type: WidthType.PERCENTAGE },
      })
    ),
    tableHeader: true,
  });

  const dataRows = audit.sources_queried.map(s =>
    new TableRow({
      children: [s.source, s.query_sent, String(s.results_returned), String(s.results_included), s.status].map(text =>
        new TableCell({
          children: [new Paragraph({ children: [new TextRun({ text, size: 20 })] })],
          width: { size: 20, type: WidthType.PERCENTAGE },
        })
      ),
    })
  );

  return new Table({
    rows: [headerRow, ...dataRows],
    width: { size: 100, type: WidthType.PERCENTAGE },
  });
}

// Generic content-to-docx for CE model and dossier outputs
export async function contentToDocx(
  title: string,
  markdownContent: string,
  audit: AuditRecord,
): Promise<string> {
  // Parse markdown sections into document paragraphs
  const contentParagraphs = markdownContent.split("\n").map(line => {
    if (line.startsWith("## ")) {
      return new Paragraph({
        children: [new TextRun({ text: line.replace(/^## /, ""), bold: true, size: 28 })],
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 300 },
      });
    }
    if (line.startsWith("### ")) {
      return new Paragraph({
        children: [new TextRun({ text: line.replace(/^### /, ""), bold: true, size: 24 })],
        heading: HeadingLevel.HEADING_2,
      });
    }
    if (line.startsWith("**") && line.endsWith("**")) {
      return new Paragraph({
        children: [new TextRun({ text: line.replace(/\*\*/g, ""), bold: true, size: 22 })],
      });
    }
    if (line.startsWith("- ")) {
      return new Paragraph({
        children: [new TextRun({ text: line.replace(/^- /, "• "), size: 20 })],
      });
    }
    if (line.startsWith("| ")) {
      // Table rows — render as plain text (tables handled separately)
      return new Paragraph({
        children: [new TextRun({ text: line, size: 18, font: "Courier New" })],
      });
    }
    if (line.trim() === "" || line.startsWith("---")) {
      return new Paragraph({ children: [] });
    }
    return new Paragraph({
      children: [new TextRun({ text: line.replace(/\*\*/g, ""), size: 22 })],
    });
  });

  const doc = new Document({
    sections: [{
      properties: {},
      children: [
        new Paragraph({
          children: [new TextRun({ text: title, bold: true, size: 48 })],
          heading: HeadingLevel.TITLE,
          alignment: AlignmentType.CENTER,
          spacing: { after: 400 },
        }),
        new Paragraph({
          children: [new TextRun({ text: `Generated: ${audit.timestamp}`, italics: true, size: 20, color: "666666" })],
          alignment: AlignmentType.CENTER,
          spacing: { after: 600 },
        }),
        ...contentParagraphs,
        new Paragraph({
          children: [new TextRun({
            text: "Disclaimer: This is a preliminary report for orientation purposes only.",
            italics: true, size: 18, color: "999999",
          })],
          spacing: { before: 600 },
        }),
      ],
    }],
  });

  const buffer = await Packer.toBuffer(doc);
  return buffer.toString("base64");
}
