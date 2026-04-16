import { z } from "zod";
import type {
  DossierParams,
  ToolResult,
  LiteratureResult,
  PicoDefinition,
} from "../providers/types.js";

const DossierSchema = z.object({
  hta_body: z.enum(["nice", "ema", "fda", "iqwig", "has", "jca", "gvd"]),
  submission_type: z.enum([
    "sta",
    "mta",
    "early_access",
    "initial",
    "renewal",
    "variation",
  ]),
  drug_name: z.string().min(1),
  indication: z.string().min(1),
  evidence_summary: z.union([z.string(), z.array(z.any())]).optional(),
  model_results: z.any().optional(),
  picos: z
    .array(
      z.object({
        id: z.string(),
        population: z.string(),
        comparator: z.string(),
        outcomes: z.array(z.string()),
      }),
    )
    .optional(),
  output_format: z.enum(["text", "json", "docx"]).optional(),
  project: z.string().optional(),
});
import {
  createAuditRecord,
  addAssumption,
  addWarning,
  setMethodology,
} from "../audit/builder.js";
import { auditToMarkdown } from "../formatters/markdown.js";
import { contentToDocx } from "../formatters/docx.js";
import { saveReport } from "../knowledge/index.js";
import { saveDossier } from "../knowledge/index.js";

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

const JCA_SECTIONS = [
  "Scope Confirmation",
  "Population and Disease Context",
  "Intervention",
  "Comparators",
  "Outcomes",
  "Comparative Clinical Effectiveness",
  "Indirect Treatment Comparison",
  "Comparative Safety",
  "Evidence Certainty (GRADE)",
  "Evidence Gaps and Uncertainty",
];

const GVD_SECTIONS = [
  "Executive Summary",
  "Disease Background and Epidemiology",
  "Current Standard of Care",
  "Unmet Need",
  "Product Description and Mechanism of Action",
  "Clinical Evidence",
  "Comparative Effectiveness",
  "Safety Profile",
  "Health Economic Summary",
  "Patient Reported Outcomes and Quality of Life",
  "Policy Environment and Market Access Landscape",
  "Implementation Considerations",
  "Evidence Gaps and Ongoing Studies",
];

const SECTIONS_BY_BODY: Record<string, string[]> = {
  nice: NICE_STA_SECTIONS,
  ema: EMA_SECTIONS,
  fda: FDA_SECTIONS,
  iqwig: NICE_STA_SECTIONS,
  has: NICE_STA_SECTIONS,
  jca: JCA_SECTIONS,
  gvd: GVD_SECTIONS,
};

const METHODOLOGY_BY_BODY: Record<string, string> = {
  nice: "NICE STA guidance v3.0 (2022)",
  ema: "EMA Common Technical Document format",
  fda: "FDA Prescribing Information format",
  iqwig: "IQWiG Methods v6.1",
  has: "HAS transparency committee dossier format",
  jca: "EUHTA Regulation (EU) 2021/2282 — Joint Clinical Assessment",
  gvd: "Global Value Dossier — cross-market foundational evidence document (ISPOR GVD best practices)",
};

/**
 * Auto-generate GRADE evidence quality assessment from literature results.
 *
 * GRADE domains: Risk of bias, Inconsistency, Indirectness, Imprecision, Publication bias
 * Ratings: High, Moderate, Low, Very Low
 *
 * Uses study type counts and basic heuristics from the evidence set.
 */
function generateGradeTable(
  evidence: LiteratureResult[],
  outcomes: string[],
): string {
  if (evidence.length === 0) return "";

  // Count study types
  const rctCount = evidence.filter(
    (r) =>
      r.study_type?.toLowerCase().includes("rct") ||
      r.study_type?.toLowerCase().includes("randomized") ||
      r.study_type?.toLowerCase().includes("randomised"),
  ).length;
  const maCount = evidence.filter(
    (r) =>
      r.study_type?.toLowerCase().includes("meta") ||
      r.study_type?.toLowerCase().includes("systematic"),
  ).length;
  const obsCount = evidence.filter(
    (r) =>
      r.study_type?.toLowerCase().includes("observational") ||
      r.study_type?.toLowerCase().includes("cohort") ||
      r.study_type?.toLowerCase().includes("case"),
  ).length;

  // Base certainty: RCTs start High, observational starts Low
  const hasRCTs = rctCount > 0;
  const hasMAs = maCount > 0;

  function assessOutcome(outcome: string): {
    certainty: string;
    rob: string;
    inconsistency: string;
    indirectness: string;
    imprecision: string;
    pub_bias: string;
    rationale: string;
  } {
    // Check if any evidence mentions this outcome
    const relevant = evidence.filter(
      (r) =>
        r.title?.toLowerCase().includes(outcome.toLowerCase()) ||
        r.abstract?.toLowerCase().includes(outcome.toLowerCase()),
    );
    const nRelevant = relevant.length;

    // Risk of bias
    const rob = hasRCTs || hasMAs ? "Low" : "High";

    // Inconsistency: if multiple studies, assume some inconsistency possible
    const inconsistency =
      nRelevant > 3 ? "Low" : nRelevant > 1 ? "Moderate" : "Serious";

    // Indirectness: assume moderate unless direct evidence exists
    const indirectness = nRelevant > 0 ? "Low" : "Serious";

    // Imprecision: based on study count
    const imprecision =
      nRelevant >= 3 ? "Low" : nRelevant >= 1 ? "Moderate" : "Serious";

    // Publication bias
    const pub_bias = hasMAs ? "Low" : nRelevant >= 5 ? "Low" : "Suspected";

    // Overall certainty
    let downgrades = 0;
    if (rob === "High") downgrades++;
    if (inconsistency === "Serious") downgrades++;
    if (indirectness === "Serious") downgrades++;
    if (imprecision === "Serious") downgrades++;
    if (pub_bias === "Suspected") downgrades++;

    const baseLevel = hasRCTs ? 4 : 2; // High=4, Low=2
    const finalLevel = Math.max(1, baseLevel - downgrades);
    const certainty =
      finalLevel >= 4
        ? "High"
        : finalLevel >= 3
          ? "Moderate"
          : finalLevel >= 2
            ? "Low"
            : "Very Low";

    const rationale = [
      rob !== "Low" ? `RoB: ${rob}` : "",
      inconsistency !== "Low" ? `Inconsistency: ${inconsistency}` : "",
      indirectness !== "Low" ? `Indirectness: ${indirectness}` : "",
      imprecision !== "Low" ? `Imprecision: ${imprecision}` : "",
      pub_bias !== "Low" ? `Pub. bias: ${pub_bias}` : "",
    ]
      .filter(Boolean)
      .join("; ");

    return {
      certainty,
      rob,
      inconsistency,
      indirectness,
      imprecision,
      pub_bias,
      rationale: rationale || "No downgrading",
    };
  }

  const assessedOutcomes =
    outcomes.length > 0
      ? outcomes
      : [
          "overall survival",
          "progression-free survival",
          "quality of life",
          "adverse events",
        ];

  const lines: string[] = [
    `### GRADE Evidence Quality Assessment`,
    ``,
    `Based on ${evidence.length} studies (${rctCount} RCTs, ${maCount} systematic reviews/meta-analyses, ${obsCount} observational):`,
    ``,
    `| Outcome | Certainty | RoB | Inconsistency | Indirectness | Imprecision | Pub. Bias | Rationale |`,
    `|---------|-----------|-----|---------------|-------------|-------------|-----------|-----------|`,
  ];

  for (const outcome of assessedOutcomes) {
    const a = assessOutcome(outcome);
    const certIcon =
      a.certainty === "High"
        ? "++++"
        : a.certainty === "Moderate"
          ? "+++-"
          : a.certainty === "Low"
            ? "++--"
            : "+---";
    lines.push(
      `| ${outcome} | **${a.certainty}** ${certIcon} | ${a.rob} | ${a.inconsistency} | ${a.indirectness} | ${a.imprecision} | ${a.pub_bias} | ${a.rationale} |`,
    );
  }

  lines.push(``);
  lines.push(
    `> **Note:** This is an automated GRADE assessment based on study counts and types. A definitive GRADE evaluation requires clinical expert judgment on each domain. See [GRADE Handbook](https://gdt.gradepro.org/app/handbook/handbook.html).`,
  );
  lines.push(``);

  return lines.join("\n");
}

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

function buildJCASection(
  name: string,
  drugName: string,
  indication: string,
  pico: PicoDefinition,
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
    case "Scope Confirmation":
      return {
        content:
          `**PICO ${pico.id}** — Scope as confirmed by HTA Coordination Group.\n` +
          `Population: ${pico.population}\nIntervention: ${drugName}\nComparator: ${pico.comparator}\n` +
          `Outcomes: ${pico.outcomes.join(", ")}`,
        status: "complete",
      };
    case "Population and Disease Context":
      return {
        content:
          `${pico.population} with ${indication}.\n` +
          `⚠️ Provide epidemiology, disease burden, and unmet need across relevant EU member states.`,
        status: "partial",
      };
    case "Intervention":
      return {
        content:
          `${drugName} as per EMA-approved Summary of Product Characteristics (SmPC).\n` +
          `⚠️ Reference the exact label wording — scope is tied to the approved indication.`,
        status: "complete",
      };
    case "Comparators":
      return {
        content:
          `**Primary comparator:** ${pico.comparator}\n` +
          `⚠️ Verify comparator relevance across all 27 EU member states. Include all nationally relevant alternatives identified during scoping.`,
        status: "partial",
      };
    case "Outcomes":
      return {
        content:
          pico.outcomes.length > 0
            ? `Assessed outcomes:\n${pico.outcomes.map((o) => `- ${o}`).join("\n")}`
            : `⚠️ No outcomes specified for this PICO. Provide primary and secondary endpoints as per scoping decision.`,
        status: pico.outcomes.length > 0 ? "complete" : "missing",
      };
    case "Comparative Clinical Effectiveness":
      return evidence
        ? {
            content:
              `Relative effects of ${drugName} vs ${pico.comparator}:\n${evidence}\n` +
              `⚠️ Express results as relative risk (RR), hazard ratio (HR), or mean difference (MD) with 95% CI.`,
            status: "partial",
          }
        : {
            content: `⚠️ No clinical evidence provided. Pipe output from literature_search to populate relative effects for ${pico.comparator}.`,
            status: "missing",
          };
    case "Indirect Treatment Comparison":
      return {
        content:
          `**ITC Feasibility Assessment:**\n` +
          `⚠️ Assess whether a connected evidence network exists between ${drugName} and ${pico.comparator}.\n` +
          `- If direct head-to-head evidence exists: state this and provide summary.\n` +
          `- If only indirect evidence: specify method (MAIC, STC, or NMA) and justify selection.\n` +
          `- JCA strongly prefers anchored indirect comparisons. Unanchored MAIC requires explicit justification.\n` +
          `- Note any heterogeneity in effect modifiers across included studies.`,
        status: "missing",
      };
    case "Comparative Safety":
      return {
        content:
          `Comparative safety of ${drugName} vs ${pico.comparator}:\n` +
          `⚠️ Provide: serious adverse events (SAEs), treatment discontinuations, adverse events of special interest (AESIs).\n` +
          `Express as relative risk with 95% CI where possible.`,
        status: "missing",
      };
    case "Evidence Certainty (GRADE)":
      return {
        content:
          `GRADE certainty assessment for ${pico.id}:\n` +
          `| Outcome | Certainty | Rationale |\n` +
          `|---|---|---|\n` +
          pico.outcomes
            .map(
              (o) =>
                `| ${o} | ⚠️ TBC | Assess risk of bias, inconsistency, indirectness, imprecision |`,
            )
            .join("\n") +
          `\n\n⚠️ Complete GRADE table with clinical advisor.`,
        status: "missing",
      };
    case "Evidence Gaps and Uncertainty":
      return {
        content:
          `Known evidence gaps for PICO ${pico.id}:\n` +
          `- ⚠️ List data limitations (immature survival data, missing subgroups, short follow-up)\n` +
          `- ⚠️ Flag patient populations not represented in trials\n` +
          `- ⚠️ Note impact of evidence gaps on certainty of results\n` +
          `This section will be referenced by national HTA bodies conducting cost-effectiveness analyses.`,
        status: "missing",
      };
    default:
      return {
        content: `⚠️ ${name} — populate with JCA submission-specific content for PICO ${pico.id}.`,
        status: "missing",
      };
  }
}

async function handleJCADossier(
  params: DossierParams,
  audit: ReturnType<typeof createAuditRecord>,
): Promise<ToolResult> {
  // Default single PICO if none provided
  const picos: PicoDefinition[] =
    params.picos && params.picos.length > 0
      ? params.picos
      : [
          {
            id: "PICO-1",
            population: `Adults with ${params.indication}`,
            comparator: "Current standard of care",
            outcomes: [
              "Overall survival",
              "Progression-free survival",
              "Quality of life (EQ-5D)",
              "Adverse events",
            ],
          },
        ];

  audit = addAssumption(
    audit,
    `EUHTA Regulation (EU) 2021/2282 — Joint Clinical Assessment`,
  );
  audit = addAssumption(audit, `${picos.length} PICO(s) assessed`);
  audit = addAssumption(
    audit,
    `JCA covers comparative clinical effectiveness and safety only. National cost-effectiveness assessment remains at member state level.`,
  );
  if (picos.length === 1 && (!params.picos || params.picos.length === 0)) {
    audit = addWarning(
      audit,
      `No PICOs provided — generated default PICO. Provide picos[] array for accurate JCA structure reflecting actual scoping decisions.`,
    );
  }
  if (picos.length > 10) {
    audit = addWarning(
      audit,
      `${picos.length} PICOs — complex submission. Ensure each PICO has dedicated evidence package.`,
    );
  }

  const lines: string[] = [];
  lines.push(`## EU Joint Clinical Assessment (JCA) Dossier Draft`);
  lines.push(
    `**Drug:** ${params.drug_name} | **Indication:** ${params.indication}`,
  );
  lines.push(
    `**Regulation:** EUHTA (EU) 2021/2282 | **PICOs:** ${picos.length}`,
  );
  lines.push(`**Submission type:** ${params.submission_type.toUpperCase()}`);
  lines.push(
    `\n> ⚠️ JCA covers comparative clinical effectiveness and safety **only**. Economic evaluation (cost-effectiveness) remains at national level.\n`,
  );

  const allGaps: string[] = [];

  for (const pico of picos) {
    lines.push(`---\n## ${pico.id}: ${pico.population} vs ${pico.comparator}`);
    for (const sectionName of JCA_SECTIONS) {
      const { content, status } = buildJCASection(
        sectionName,
        params.drug_name,
        params.indication,
        pico,
        params.evidence_summary,
      );
      lines.push(`### ${sectionName}`);
      lines.push(content);
      lines.push("");
      if (status === "missing") {
        const gap = `[${pico.id}] ${sectionName}`;
        allGaps.push(gap);
        audit = addWarning(
          audit,
          `Section "${sectionName}" (${pico.id}) requires additional input`,
        );
      }
    }
  }

  if (allGaps.length > 0) {
    lines.push(
      `---\n## Gap Analysis (${allGaps.length} sections require input)`,
    );
    allGaps.forEach((g) => lines.push(`- ⚠️ ${g}`));
    lines.push("");
  }

  lines.push(auditToMarkdown(audit));

  const outputFormat = params.output_format ?? "text";
  const jcaTextContent = lines.join("\n");

  if (params.project) {
    try {
      await saveDossier(
        params.project,
        params.hta_body,
        params.submission_type,
        { drug_name: params.drug_name, indication: params.indication },
        jcaTextContent,
      );
    } catch {}
  }

  if (outputFormat === "docx") {
    const base64 = await contentToDocx(
      `JCA ${params.submission_type.toUpperCase()} Dossier`,
      jcaTextContent,
      audit,
    );
    const filenameStem = `jca-${params.submission_type}-${params.drug_name.slice(0, 30)}-${params.indication.slice(0, 30)}`;
    const savedPath = await saveReport(base64, filenameStem, params.project);
    const sizeKb = Math.round(base64.length / 1024);
    return {
      content: `## DOCX Report Generated\n\n**File:** \`${savedPath}\`\n**Size:** ${sizeKb} KB\n**Type:** JCA ${params.submission_type.toUpperCase()} Dossier\n**Drug:** ${params.drug_name}\n**Indication:** ${params.indication}\n\nOpen with: \`open "${savedPath}"\``,
      audit,
    };
  }

  return { content: jcaTextContent, audit };
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

  // JCA: generate per-PICO sections
  if (params.hta_body === "jca") {
    return handleJCADossier(params, audit);
  }

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

  // Auto-generate GRADE table when evidence is provided as LiteratureResult[]
  if (
    Array.isArray(params.evidence_summary) &&
    params.evidence_summary.length > 0
  ) {
    const gradeTable = generateGradeTable(
      params.evidence_summary as LiteratureResult[],
      [],
    );
    if (gradeTable) {
      lines.push(gradeTable);
      audit = addAssumption(
        audit,
        "GRADE evidence quality assessment auto-generated from literature search results",
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

  const dossierTextContent = lines.join("\n");

  if (params.project) {
    try {
      await saveDossier(
        params.project,
        params.hta_body,
        params.submission_type,
        { drug_name: params.drug_name, indication: params.indication },
        dossierTextContent,
      );
    } catch {}
  }

  if (outputFormat === "docx") {
    const base64 = await contentToDocx(
      `${params.hta_body.toUpperCase()} ${params.submission_type.toUpperCase()} Dossier`,
      dossierTextContent,
      audit,
    );
    const filenameStem = `${params.hta_body}-${params.submission_type}-${params.drug_name.slice(0, 30)}`;
    const savedPath = await saveReport(base64, filenameStem, params.project);
    const sizeKb = Math.round(base64.length / 1024);
    return {
      content: `## DOCX Report Generated\n\n**File:** \`${savedPath}\`\n**Size:** ${sizeKb} KB\n**Type:** ${params.hta_body.toUpperCase()} ${params.submission_type.toUpperCase()}\n**Drug:** ${params.drug_name}\n**Indication:** ${params.indication}\n\nOpen with: \`open "${savedPath}"\``,
      audit,
    };
  }

  return { content: dossierTextContent, audit };
}

export const htaDossierPrepToolSchema = {
  name: "hta_dossier_prep",
  description:
    "Structure evidence into HTA body-specific submission format (NICE STA, EMA, FDA, IQWiG, HAS, EU JCA, or Global Value Dossier). Produces draft sections with gap analysis and auto-GRADE evidence quality tables. Accepts output from literature_search and cost_effectiveness_model.",
  annotations: {
    title: "HTA Dossier Preparation",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  inputSchema: {
    type: "object",
    properties: {
      hta_body: {
        type: "string",
        enum: ["nice", "ema", "fda", "iqwig", "has", "jca"],
        description:
          "HTA body. Use 'jca' for EU Joint Clinical Assessment (EUHTA Reg. 2021/2282).",
      },
      submission_type: {
        type: "string",
        enum: ["sta", "mta", "early_access", "initial", "renewal", "variation"],
        description:
          "Submission type. Use 'initial'/'renewal'/'variation' for JCA.",
      },
      drug_name: { type: "string" },
      indication: { type: "string" },
      evidence_summary: {
        description: "Text summary or JSON array from literature_search output",
      },
      model_results: {
        description: "JSON output from cost_effectiveness_model",
      },
      picos: {
        type: "array",
        description:
          "JCA: list of PICOs from the scoping decision. If omitted, a default PICO is generated.",
        items: {
          type: "object",
          properties: {
            id: {
              type: "string",
              description: "PICO identifier, e.g. 'PICO-1'",
            },
            population: { type: "string" },
            comparator: { type: "string" },
            outcomes: { type: "array", items: { type: "string" } },
          },
          required: ["id", "population", "comparator", "outcomes"],
        },
      },
      output_format: { type: "string", enum: ["text", "json", "docx"] },
      project: {
        type: "string",
        description:
          "Project ID for knowledge base persistence. When set, dossier draft is saved to ~/.heor-agent/projects/{project}/raw/dossiers/",
      },
    },
    required: ["hta_body", "submission_type", "drug_name", "indication"],
  },
};
