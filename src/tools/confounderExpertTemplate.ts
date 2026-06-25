import { z } from "zod";
import type { ToolResult } from "../providers/types.js";
import {
  createAuditRecord,
  setMethodology,
  addAssumption,
} from "../audit/builder.js";
import {
  buildDisclosure,
  extractDisclosureLevel,
  AI_DISCLOSURE_LEVEL_SCHEMA_PROPERTY,
} from "../formatters/disclosure.js";
import { expertInterviewBlock } from "../confounder/lexicon.js";

/**
 * confounder_expert_template (evidence.confounder_expert_template) — Design log #43.
 *
 * Pufulete Step 2/3: structured clinician/patient interview instrument for the
 * confounders literature CANNOT supply (the "unmeasurable" ones, e.g. patient
 * treatment preference). PURE — no network, no LLM. Pairs with
 * confounder_identification.expert_interview_required.
 */

const ConfounderExpertTemplateSchema = z
  .object({
    intervention: z.string().min(1),
    comparator: z.string().min(1),
    indication: z.string().min(1),
    unmeasurable_confounders: z.array(z.string()).optional(),
    interviewee_role: z
      .enum(["treating_physician", "clinical_expert", "patient_advocate", "payer"])
      .default("treating_physician")
      .optional(),
    ai_disclosure_level: z
      .enum(["off", "standard", "submission"])
      .default("standard")
      .optional(),
  })
  .strict();

type Input = z.infer<typeof ConfounderExpertTemplateSchema>;

interface SurveyItem {
  confounder: string;
  association_with_treatment_q: string;
  association_with_outcome_q: string;
  measurable_in_rwd_q: string;
  proxy_q: string;
  likert_scale: string[];
}

export interface ConfounderExpertTemplateContent {
  markdown_checklist: string;
  survey_items: SurveyItem[];
  dag_elicitation_prompts: string[];
}

const LIKERT = [
  "Strongly disagree",
  "Disagree",
  "Neither",
  "Agree",
  "Strongly agree",
];

function buildSurveyItem(confounder: string, input: Input): SurveyItem {
  return {
    confounder,
    association_with_treatment_q: `Does "${confounder}" influence whether a patient receives ${input.intervention} rather than ${input.comparator}? (a confounder must be associated with TREATMENT assignment)`,
    association_with_outcome_q: `Independent of treatment, does "${confounder}" affect the OUTCOME in ${input.indication}? (a confounder must also be associated with the OUTCOME)`,
    measurable_in_rwd_q: `Is "${confounder}" recorded in the available trial / registry / claims data, or is it unmeasured?`,
    proxy_q: `If unmeasured, is there a usable proxy for "${confounder}" (and how good is it)?`,
    likert_scale: LIKERT,
  };
}

export async function handleConfounderExpertTemplate(
  rawInput: unknown,
): Promise<ToolResult> {
  const input = ConfounderExpertTemplateSchema.parse(rawInput);

  const confounders =
    input.unmeasurable_confounders && input.unmeasurable_confounders.length > 0
      ? input.unmeasurable_confounders
      : expertInterviewBlock(input.indication).map((e) => e.variable);

  const survey_items = confounders.map((c) => buildSurveyItem(c, input));

  const dag_elicitation_prompts = [
    `Sketch a causal DAG: place ${input.intervention}/${input.comparator} (treatment) on the left, the outcome on the right, and each candidate confounder as a node with arrows INTO both treatment and outcome.`,
    `For each confounder above, confirm BOTH arrows exist — a node with only one arrow is a prognostic factor or a treatment predictor, not a confounder.`,
    `Identify any confounder that is a common effect (collider) of treatment and outcome — these must NOT be adjusted for.`,
    `Flag any confounder you believe is the single largest source of bias in this ${input.indication} comparison.`,
  ];

  const role = input.interviewee_role ?? "treating_physician";
  const lines: string[] = [];
  lines.push(`# Confounder Expert Interview Guide`);
  lines.push(``);
  lines.push(
    `**Comparison:** ${input.intervention} vs ${input.comparator} — ${input.indication}`,
  );
  lines.push(`**Interviewee role:** ${role.replace(/_/g, " ")}`);
  lines.push(``);
  lines.push(
    `> Purpose (Pufulete Step 2/3): elicit confounders that the literature cannot supply, and confirm — for each — that it is associated with BOTH treatment assignment and outcome (the definition of a confounder).`,
  );
  lines.push(``);
  lines.push(`## Per-confounder probes`);
  survey_items.forEach((s, i) => {
    lines.push(``);
    lines.push(`### ${i + 1}. ${s.confounder}`);
    lines.push(`- **Treatment link:** ${s.association_with_treatment_q}`);
    lines.push(`- **Outcome link:** ${s.association_with_outcome_q}`);
    lines.push(`- **Measurability:** ${s.measurable_in_rwd_q}`);
    lines.push(`- **Proxy:** ${s.proxy_q}`);
    lines.push(`- **Rating (circle one):** ${LIKERT.join(" / ")}`);
  });
  lines.push(``);
  lines.push(`## DAG elicitation`);
  for (const p of dag_elicitation_prompts) lines.push(`- ${p}`);
  lines.push(``);
  lines.push(`## Consensus`);
  lines.push(
    `- Where ≥2 experts disagree on whether a variable is a confounder, record the disagreement and resolve by majority + documented rationale; do not silently drop contested confounders.`,
  );

  let audit = createAuditRecord(
    "evidence.confounder_expert_template",
    {
      intervention: input.intervention,
      comparator: input.comparator,
      indication: input.indication,
      n_confounders: confounders.length,
    } as unknown as Record<string, unknown>,
    "text",
  );
  audit = setMethodology(
    audit,
    "Pufulete 2022 Step 2/3 interview instrument — deterministic templating (no LLM). Each confounder is probed against the two confounding criteria (treatment + outcome association) plus measurability and proxy availability.",
  );
  audit = addAssumption(
    audit,
    `${confounders.length} confounder(s) templated${
      input.unmeasurable_confounders?.length ? " (caller-supplied)" : " (default indication-aware set)"
    }.`,
  );

  const level = extractDisclosureLevel(rawInput, "standard");
  const disclosure = buildDisclosure(audit, { level });
  const markdown_checklist = disclosure ? `${lines.join("\n")}\n\n${disclosure}` : lines.join("\n");

  const content: ConfounderExpertTemplateContent = {
    markdown_checklist,
    survey_items,
    dag_elicitation_prompts,
  };

  return { content, audit };
}

export const confounderExpertTemplateToolSchema = {
  name: "evidence.confounder_expert_template",
  description:
    "Generate a clinician/patient interview guide (Pufulete Step 2/3) for the 'unmeasurable' confounders that literature cannot supply — patient treatment preference, tolerability expectation, etc. Pure template (no LLM, no network). Pass confounder_identification's expert_interview_required list as `unmeasurable_confounders`. Each confounder is probed against the two confounding criteria (associated with treatment AND outcome), measurability in available data, and proxy availability, plus DAG-elicitation prompts. Returns a ready-to-paste markdown checklist + structured survey_items.",
  annotations: {
    title: "Confounder Expert Interview Template",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  inputSchema: {
    type: "object",
    properties: {
      intervention: { type: "string" },
      comparator: { type: "string" },
      indication: { type: "string" },
      unmeasurable_confounders: {
        type: "array",
        items: { type: "string" },
        description: "Confounders to interview about (e.g. confounder_identification.expert_interview_required). Omit for an indication-aware default set.",
      },
      interviewee_role: {
        type: "string",
        enum: ["treating_physician", "clinical_expert", "patient_advocate", "payer"],
      },
      ai_disclosure_level: AI_DISCLOSURE_LEVEL_SCHEMA_PROPERTY,
    },
    required: ["intervention", "comparator", "indication"],
  },
};
