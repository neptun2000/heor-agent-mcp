/**
 * workflow.living_evidence — orchestrate the living-evidence pipeline
 * (SLR → living knowledge base → JCA/HTA deliverables), end to end.
 *
 * Returns the ordered runbook of tool calls for a baseline build or a
 * living refresh, with each step's trigger resolved against the supplied
 * signals (material change, drifting claims). The MCP server is stateless,
 * so this names + routes the flow; the calling agent executes the steps and
 * the host owns the refresh schedule. Pure logic. See design log #22.
 */
import { z } from "zod";
import {
  addAssumption,
  addWarning,
  createAuditRecord,
  setMethodology,
} from "../audit/builder.js";
import { auditToMarkdown } from "../formatters/markdown.js";
import { extractDisclosureLevel } from "../formatters/disclosure.js";
import { suggestForEnum } from "../util/didYouMean.js";
import { caseInsensitiveEnum } from "../util/caseInsensitive.js";
import { planLivingEvidence } from "../orchestration/livingEvidence.js";
import type { LivingEvidenceResult } from "../orchestration/livingEvidence.js";
import type { ToolResult } from "../providers/types.js";

export type { LivingEvidenceResult } from "../orchestration/livingEvidence.js";

const STAGES = ["baseline", "refresh"] as const;

const WorkflowLivingEvidenceSchema = z
  .object({
    intervention: z.string().min(1, "intervention is required"),
    indication: z.string().min(1, "indication is required"),
    stage: caseInsensitiveEnum(STAGES).default("baseline"),
    project_id: z.string().optional(),
    material_change: z.boolean().default(false),
    new_records: z.number().int().nonnegative().default(0),
    recommended_downstream: z.array(z.string()).default([]),
    drifting_claims: z.array(z.string()).default([]),
    deliverables: z.array(z.string()).default([]),
  })
  .strict();

export async function handleWorkflowLivingEvidence(
  rawInput: unknown,
): Promise<ToolResult> {
  const parsed = WorkflowLivingEvidenceSchema.safeParse(rawInput);
  if (!parsed.success) {
    const messages: string[] = [];
    for (const issue of parsed.error.issues) {
      if (issue.code === "invalid_enum_value" && typeof issue.received === "string") {
        const suggestions = suggestForEnum(
          issue.received,
          issue.options as readonly string[],
        );
        messages.push(
          `Invalid ${issue.path.join(".")}: "${issue.received}". Allowed: ${(issue.options as string[]).join(", ")}.${
            suggestions.length ? ` Did you mean ${suggestions.map((s) => `"${s}"`).join(", ")}?` : ""
          }`,
        );
      } else {
        messages.push(`${issue.path.join(".") || "input"}: ${issue.message}`);
      }
    }
    throw new Error(messages.join("\n"));
  }
  const input = parsed.data;

  let audit = createAuditRecord(
    "workflow.living_evidence",
    input as unknown as Record<string, unknown>,
    "text",
  );
  audit = setMethodology(
    audit,
    "Living-evidence pipeline orchestration (SLR → living knowledge base → JCA/HTA deliverables). Deterministic runbook generator: emits the ordered tool calls with trigger conditions resolved against living-review / consistency signals. Stateless — does not execute steps or persist state; scheduling is host-owned.",
  );

  const result = planLivingEvidence({
    intervention: input.intervention,
    indication: input.indication,
    stage: input.stage,
    project_id: input.project_id,
    material_change: input.material_change,
    new_records: input.new_records,
    recommended_downstream: input.recommended_downstream,
    drifting_claims: input.drifting_claims,
    deliverables: input.deliverables,
  });

  audit = addAssumption(
    audit,
    `Stage '${result.stage}': ${result.triggered_count} step(s) triggered, ${result.skipped_count} skipped.`,
  );
  for (const w of result.warnings) audit = addWarning(audit, w);

  const lines: string[] = [];
  lines.push(
    `# Living-Evidence Pipeline — ${input.intervention} (${input.indication})`,
  );
  lines.push("");
  lines.push(
    `**Stage:** ${result.stage} · **Steps triggered:** ${result.triggered_count}/${result.steps.length}${input.stage === "refresh" ? ` · **Material change:** ${input.material_change ? "yes" : "no"}` : ""}`,
  );
  lines.push("");

  lines.push("## Runbook");
  lines.push("| # | Step | Tool | Trigger | Run? |");
  lines.push("|---|------|------|---------|------|");
  for (const s of result.steps) {
    lines.push(
      `| ${s.order} | ${s.name} | \`${s.tool}\` | ${s.condition} | ${s.triggered ? "▶️ run" : "⏭️ skip"} |`,
    );
  }
  lines.push("");

  lines.push("## Step detail");
  for (const s of result.steps) {
    if (!s.triggered) continue;
    lines.push(`### ${s.order}. ${s.name} — \`${s.tool}\``);
    lines.push(`${s.action}.`);
    lines.push(`_${s.rationale}_`);
    lines.push("");
  }

  lines.push("## Automatic refresh");
  lines.push(result.next_refresh_note);
  lines.push("");

  if (result.warnings.length) {
    lines.push("## ⚠️ Notes");
    for (const w of result.warnings) lines.push(`- ${w}`);
    lines.push("");
  }

  lines.push(
    auditToMarkdown(audit, {
      disclosure: { level: extractDisclosureLevel(rawInput, "standard") },
    }),
  );

  return {
    content: lines.join("\n"),
    audit,
    living_evidence: result,
  } as ToolResult & { living_evidence: LivingEvidenceResult };
}

export const workflowLivingEvidenceToolSchema = {
  name: "workflow.living_evidence",
  description:
    "Orchestrate the end-to-end living-evidence pipeline — AI-augmented SLR → living knowledge base → JCA/HTA deliverables ('from review to reimbursement'). Returns the ordered runbook of tool calls to make: for stage='baseline', the full chain (literature.search → screen → risk_of_bias → triangulation → network/indirect → cost_effectiveness → budget_impact → gap_analysis → claim_registry → dossier/JCA → consistency_check → living_review init); for stage='refresh', only the steps triggered by the signals you pass (material_change + recommended_downstream from literature.living_review, drifting_claims from evidence.consistency_check) so an unchanged refresh is a near no-op. This is a deterministic runbook generator — it does NOT execute the steps or hold state (the calling agent runs them; the host owns persistence + the refresh schedule). Use it to drive or document the living pipeline. Enum values case-insensitive.",
  annotations: {
    title: "Living-Evidence Pipeline",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  inputSchema: {
    type: "object",
    properties: {
      intervention: { type: "string" },
      indication: { type: "string" },
      stage: { type: "string", enum: STAGES, default: "baseline" },
      project_id: { type: "string" },
      material_change: {
        type: "boolean",
        default: false,
        description: "From literature.living_review refresh — gates the re-run steps.",
      },
      new_records: { type: "number", minimum: 0, default: 0 },
      recommended_downstream: {
        type: "array",
        items: { type: "string" },
        default: [],
        description: "From literature.living_review (e.g. ['evidence_network','itc_feasibility']).",
      },
      drifting_claims: {
        type: "array",
        items: { type: "string" },
        default: [],
        description: "From evidence.consistency_check — gates deliverable regeneration.",
      },
      deliverables: {
        type: "array",
        items: { type: "string" },
        default: [],
        description: "Deliverables in scope, e.g. ['living_gvd','jca_submission','hta_submission','iegp'].",
      },
      ai_disclosure_level: {
        type: "string",
        enum: ["off", "standard", "submission"],
      },
    },
    required: ["intervention", "indication"],
  },
} as const;
