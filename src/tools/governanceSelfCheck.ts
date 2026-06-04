// heor-agent-mcp/src/tools/governanceSelfCheck.ts
/**
 * governance.self_check — GenAI-in-HTA governance self-check.
 * Scores an AI-assisted workflow against 6 governance dimensions, each traced
 * to verified ELEVATE-GenAI domains. Deterministic RAG + Insufficient scoring;
 * silence is never a pass. Design log #34.
 */
import { z } from "zod";
import {
  CROSSWALK,
  DIMENSION_ORDER,
  type DimensionKey,
} from "../governance/crosswalk.js";
import {
  scoreDimension,
  tallyScorecard,
  aggregateVerdict,
  deriveFromAudit,
  type Rag,
  type ProbeAnswer,
  type UseCase,
} from "../governance/scoring.js";
import {
  renderGovernanceScorecard,
  type RenderedDimension,
} from "../formatters/governanceMarkdown.js";
import { createAuditRecord, addToolCall } from "../audit/builder.js";
import {
  buildDisclosure,
  extractDisclosureLevel,
  AI_DISCLOSURE_LEVEL_SCHEMA_PROPERTY,
} from "../formatters/disclosure.js";

const probeSchema = z
  .object({
    answer: z.enum(["yes", "no", "partial"]).nullable().optional(),
    detail: z.string().optional(),
  })
  .optional();

export const governanceSelfCheckSchema = z.object({
  mode: z.enum(["describe", "audit_record"]).default("describe"),
  workflow_description: z.string().optional(),
  context: z
    .object({
      use_case: z
        .enum([
          "regulatory_submission",
          "payer_dossier",
          "internal_analysis",
          "exploratory",
        ])
        .default("internal_analysis"),
      jurisdiction: z.string().optional(),
    })
    .optional(),
  probes: z
    .object({
      transparency: probeSchema,
      citation_validation: probeSchema,
      human_oversight: probeSchema,
      phi_data_handling: probeSchema,
      bias_equity: probeSchema,
      auditability: probeSchema,
    })
    .optional(),
  audit_record: z.any().optional(),
  ai_disclosure_level: z.enum(["off", "standard", "submission"]).optional(),
});

export type GovernanceSelfCheckInput = z.input<typeof governanceSelfCheckSchema>;
export type GovernanceSelfCheckParams = z.infer<typeof governanceSelfCheckSchema>;

export interface GovernanceDimensionResult {
  key: DimensionKey;
  label: string;
  rag: Rag;
  elevate_refs: string[];
  derivation_note?: string;
  finding: string;
  recommended_mitigation: string;
}

export interface GovernanceSelfCheckResult {
  schema_version: "1.0";
  mode: "describe" | "audit_record";
  use_case: UseCase;
  dimensions: GovernanceDimensionResult[];
  scorecard: { green: number; amber: number; red: number; insufficient: number };
  verdict: string;
  governance_summary: string;
  markdown_section: string;
}

function findingFor(rag: Rag, refs: string[]): string {
  const r = refs.join("/");
  switch (rag) {
    case "green":
      return "Safeguard in place.";
    case "amber":
      return `Partially in place — strengthen to fully meet ELEVATE ${r}.`;
    case "red":
      return `Not in place — gap against ELEVATE ${r}.`;
    default:
      return `No evidence supplied — cannot certify (silence is not a pass). Maps to ELEVATE ${r}.`;
  }
}

function resolveProbeAnswers(
  params: GovernanceSelfCheckParams,
): Record<DimensionKey, ProbeAnswer> {
  const out = {
    transparency: undefined,
    citation_validation: undefined,
    human_oversight: undefined,
    phi_data_handling: undefined,
    bias_equity: undefined,
    auditability: undefined,
  } as Record<DimensionKey, ProbeAnswer>;

  if (params.mode === "audit_record" && params.audit_record) {
    const derived = deriveFromAudit(params.audit_record);
    out.transparency = derived.transparency;
    out.citation_validation = derived.citation_validation;
    out.auditability = derived.auditability;
  }

  // Explicit probes override derived values.
  const p = params.probes;
  if (p) {
    for (const key of DIMENSION_ORDER) {
      const probe = p[key];
      if (probe && probe.answer !== undefined) {
        out[key] = probe.answer;
      }
    }
  }
  return out;
}

function buildSummary(
  dims: GovernanceDimensionResult[],
  verdict: string,
): string {
  const reds = dims.filter((d) => d.rag === "red").map((d) => d.label);
  const insuff = dims.filter((d) => d.rag === "insufficient").map((d) => d.label);
  const parts = [`Governance verdict: ${verdict}.`];
  if (reds.length) parts.push(`Material gaps: ${reds.join(", ")}.`);
  if (insuff.length)
    parts.push(`Unverified (supply evidence): ${insuff.join(", ")}.`);
  if (!reds.length && !insuff.length)
    parts.push("All assessed dimensions have safeguards in place.");
  return parts.join(" ");
}

export async function governanceSelfCheckHandler(
  rawParams: GovernanceSelfCheckInput,
): Promise<GovernanceSelfCheckResult> {
  const params = governanceSelfCheckSchema.parse(rawParams);
  const useCase: UseCase = params.context?.use_case ?? "internal_analysis";
  const answers = resolveProbeAnswers(params);

  const dimensions: GovernanceDimensionResult[] = DIMENSION_ORDER.map((key) => {
    const entry = CROSSWALK[key];
    const rag = scoreDimension(answers[key]);
    return {
      key,
      label: entry.label,
      rag,
      elevate_refs: entry.elevate_refs,
      ...(entry.derivation_note ? { derivation_note: entry.derivation_note } : {}),
      finding: findingFor(rag, entry.elevate_refs),
      recommended_mitigation: rag === "green" ? "" : entry.remediation,
    };
  });

  const rags = dimensions.map((d) => d.rag);
  const scorecard = tallyScorecard(rags);
  const verdict = aggregateVerdict(rags, useCase);

  const rendered: RenderedDimension[] = dimensions.map((d) => ({
    key: d.key,
    label: d.label,
    rag: d.rag,
    elevate_refs: d.elevate_refs,
    finding: d.finding,
    recommended_mitigation: d.recommended_mitigation,
  }));

  let markdown = renderGovernanceScorecard(rendered, scorecard, verdict);

  // Self-disclosure: the governance tool emits its own ELEVATE disclosure block.
  const level = extractDisclosureLevel(rawParams, "standard");
  let audit = createAuditRecord(
    "governance.self_check",
    { mode: params.mode, use_case: useCase },
    "markdown",
    "Deterministic ELEVATE-GenAI crosswalk scoring (design log #34).",
  );
  if (params.mode === "audit_record") {
    audit = addToolCall(audit, {
      name: "governance.self_check:audit_derivation",
      ms: 0,
      outcome: "ok",
    });
  }
  const disclosure = buildDisclosure(audit, { level });
  if (disclosure) markdown = `${markdown}\n\n${disclosure}`;

  return {
    schema_version: "1.0",
    mode: params.mode,
    use_case: useCase,
    dimensions,
    scorecard,
    verdict,
    governance_summary: buildSummary(dimensions, verdict),
    markdown_section: markdown,
  };
}

export const governanceSelfCheckToolSchema = {
  name: "governance.self_check",
  description:
    "Score an AI-assisted HTA/HEOR workflow against 6 governance dimensions (transparency, citation validation, human-in-the-loop, PHI/data handling, bias & equity, auditability), each traced to the verified ELEVATE-GenAI reporting domains (ISPOR Working Group on Generative AI, Value in Health 2025). Two modes: 'describe' (free-text workflow_description + structured probes — a blank probe scores 'insufficient', never a pass) and 'audit_record' (pass a prior HEORAgent AuditRecord to auto-derive transparency/citation/auditability). Returns a Red/Amber/Green/Insufficient scorecard, a use_case-gated verdict ('any Red blocks submission-ready'), tailored mitigations, a pipeable governance_summary, and an ELEVATE disclosure block. Governance subset only — does not score ELEVATE's model-evaluation domains (robustness, calibration, deployment/efficiency). Design log #34.",
  annotations: {
    title: "GenAI Governance Self-Check",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  inputSchema: {
    type: "object",
    properties: {
      mode: {
        type: "string",
        enum: ["describe", "audit_record"],
        default: "describe",
        description:
          "'describe' = score a workflow_description + probes; 'audit_record' = auto-derive from a HEORAgent AuditRecord.",
      },
      workflow_description: {
        type: "string",
        description:
          "Free-text description of the AI-assisted workflow: what the AI does and where its output goes.",
      },
      context: {
        type: "object",
        properties: {
          use_case: {
            type: "string",
            enum: [
              "regulatory_submission",
              "payer_dossier",
              "internal_analysis",
              "exploratory",
            ],
            default: "internal_analysis",
            description:
              "Tunes severity: Red and Insufficient block for submission/dossier; advisory for exploratory.",
          },
          jurisdiction: { type: "string" },
        },
      },
      probes: {
        type: "object",
        description:
          "One probe per dimension. Each is {answer: 'yes'|'no'|'partial'|null, detail?}. Omit or null → scored 'insufficient' (never a pass).",
        properties: {
          transparency: { $ref: "#/$defs/probe" },
          citation_validation: { $ref: "#/$defs/probe" },
          human_oversight: { $ref: "#/$defs/probe" },
          phi_data_handling: { $ref: "#/$defs/probe" },
          bias_equity: { $ref: "#/$defs/probe" },
          auditability: { $ref: "#/$defs/probe" },
        },
      },
      audit_record: {
        type: "object",
        description:
          "A prior HEORAgent AuditRecord (audit_record mode). Auto-derives transparency/citation/auditability.",
      },
      ai_disclosure_level: AI_DISCLOSURE_LEVEL_SCHEMA_PROPERTY,
    },
    $defs: {
      probe: {
        type: "object",
        properties: {
          answer: {
            type: ["string", "null"],
            enum: ["yes", "no", "partial", null],
          },
          detail: { type: "string" },
        },
      },
    },
  },
};
