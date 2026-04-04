import { z } from "zod";
import type {
  DossierParams,
  ToolResult,
  LiteratureResult,
} from "../providers/types.js";

const DossierSchema = z.object({
  hta_body: z.enum(["nice", "ema", "fda", "iqwig", "has"]),
  submission_type: z.enum(["sta", "mta", "early_access"]),
  drug_name: z.string().min(1),
  indication: z.string().min(1),
  evidence_summary: z.union([z.string(), z.array(z.any())]).optional(),
  model_results: z.any().optional(),
  output_format: z.enum(["text", "json", "docx"]).optional(),
});
import {
  createAuditRecord,
  addAssumption,
  addWarning,
  setMethodology,
} from "../audit/builder.js";
import { auditToMarkdown } from "../formatters/markdown.js";

const NICE_STA_SECTIONS = [
  "Population",
  "Intervention",
  "Comparators",
  "Outcomes (PICO)",
  "Clinical Evidence Summary",
  "Economic Evidence Summary",
  "Unmet Need",
  "Place in Therapy",
];

const EMA_SECTIONS = [
  "Product Description",
  "Clinical Pharmacology",
  "Efficacy Data",
  "Safety Data",
  "Risk-Benefit Assessment",
];

const FDA_SECTIONS = [
  "Indication",
  "Clinical Studies",
  "Adverse Reactions",
  "Dosage and Administration",
  "Clinical Pharmacology",
];

const SECTIONS_BY_BODY: Record<string, string[]> = {
  nice: NICE_STA_SECTIONS,
  ema: EMA_SECTIONS,
  fda: FDA_SECTIONS,
  iqwig: NICE_STA_SECTIONS,
  has: NICE_STA_SECTIONS,
};

const METHODOLOGY_BY_BODY: Record<string, string> = {
  nice: "NICE STA guidance v3.0 (2022)",
  ema: "EMA Common Technical Document format",
  fda: "FDA Prescribing Information format",
  iqwig: "IQWiG Methods v6.1",
  has: "HAS transparency committee dossier format",
};

function buildSection(
  name: string,
  drugName: string,
  indication: string,
  evidenceSummary?: string | LiteratureResult[],
): { content: string; status: "complete" | "partial" | "missing" } {
  const evidence =
    typeof evidenceSummary === "string"
      ? evidenceSummary
      : Array.isArray(evidenceSummary) && evidenceSummary.length > 0
        ? evidenceSummary
            .map((r) => `- ${r.title} (${r.source}, ${r.date})`)
            .join("\n")
        : null;

  switch (name) {
    case "Population":
      return {
        content: `Adult patients with ${indication} requiring pharmacological treatment.`,
        status: "complete",
      };
    case "Intervention":
      return {
        content: `${drugName} as described in the Summary of Product Characteristics (SmPC).`,
        status: "complete",
      };
    case "Comparators":
      return {
        content: `⚠️ Comparators not specified — provide current standard of care and relevant licensed alternatives for ${indication}.`,
        status: "missing",
      };
    case "Outcomes (PICO)":
      return {
        content: `Primary: HbA1c reduction, mortality. Secondary: QoL (EQ-5D), hospitalisation, adverse events.\n⚠️ Confirm outcome selection with clinical advisor.`,
        status: "partial",
      };
    case "Clinical Evidence Summary":
      return evidence
        ? { content: evidence, status: "complete" }
        : {
            content: `⚠️ Clinical evidence not provided. Pipe output from literature_search to populate this section.`,
            status: "missing",
          };
    case "Economic Evidence Summary":
      return {
        content: `⚠️ Economic model results not provided. Run cost_effectiveness_model and pipe results here.`,
        status: "missing",
      };
    default:
      return {
        content: `⚠️ ${name} — populate with submission-specific content.`,
        status: "missing",
      };
  }
}

export async function handleHtaDossierPrep(
  rawParams: unknown,
): Promise<ToolResult> {
  const params = DossierSchema.parse(rawParams) as DossierParams;
  const outputFormat = params.output_format ?? "text";
  let audit = createAuditRecord(
    "hta_dossier_prep",
    params as unknown as Record<string, unknown>,
    outputFormat,
  );
  const methodology =
    METHODOLOGY_BY_BODY[params.hta_body] ?? "Unknown HTA body";
  audit = setMethodology(audit, methodology);
  audit = addAssumption(audit, `Template: ${methodology}`);
  audit = addAssumption(
    audit,
    `Submission type: ${params.submission_type.toUpperCase()}`,
  );

  const sections = SECTIONS_BY_BODY[params.hta_body] ?? NICE_STA_SECTIONS;
  const lines: string[] = [];

  lines.push(
    `## ${params.hta_body.toUpperCase()} ${params.submission_type.toUpperCase()} Dossier Draft`,
  );
  lines.push(
    `**Drug:** ${params.drug_name} | **Indication:** ${params.indication}`,
  );
  lines.push(`**Template:** ${methodology}\n`);

  const gaps: string[] = [];
  for (const sectionName of sections) {
    const { content, status } = buildSection(
      sectionName,
      params.drug_name,
      params.indication,
      params.evidence_summary,
    );
    lines.push(`### ${sectionName}`);
    lines.push(content);
    lines.push("");
    if (status === "missing") {
      gaps.push(sectionName);
      audit = addWarning(
        audit,
        `Section "${sectionName}" requires additional input`,
      );
    }
  }

  if (gaps.length > 0) {
    lines.push(`---`);
    lines.push(`## Gap Analysis`);
    lines.push(
      `The following ${gaps.length} section(s) require additional information:`,
    );
    gaps.forEach((g) => lines.push(`- ⚠️ ${g}`));
    lines.push("");
  }

  lines.push(auditToMarkdown(audit));
  return { content: lines.join("\n"), audit };
}

export const htaDossierPrepToolSchema = {
  name: "hta_dossier_prep",
  description:
    "Structure evidence into HTA body-specific submission format (NICE STA, EMA, FDA, IQWIG, HAS). Produces draft sections with gap analysis. Accepts output from literature_search and cost_effectiveness_model.",
  inputSchema: {
    type: "object",
    properties: {
      hta_body: {
        type: "string",
        enum: ["nice", "ema", "fda", "iqwig", "has"],
      },
      submission_type: { type: "string", enum: ["sta", "mta", "early_access"] },
      drug_name: { type: "string" },
      indication: { type: "string" },
      evidence_summary: {
        description: "Text summary or JSON array from literature_search output",
      },
      model_results: {
        description: "JSON output from cost_effectiveness_model",
      },
      output_format: { type: "string", enum: ["text", "json", "docx"] },
    },
    required: ["hta_body", "submission_type", "drug_name", "indication"],
  },
};
