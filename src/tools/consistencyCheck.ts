/**
 * evidence.consistency_check — detect drift of registered (or inline)
 * claims across deliverables (dossier / publication / payer materials).
 *
 * Loads claims from the project registry (or takes inline claims), scans
 * each supplied deliverable's text, and flags where a DIFFERENT value
 * sits next to a claim's keywords (drift) or where the claim is absent.
 * Pure detection over caller-supplied text — no I/O beyond the registry
 * read. Pairs with evidence.claim_registry. See design log #20.
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
import { projectExists } from "../knowledge/projectStore.js";
import { loadClaimRegistry } from "../knowledge/claimStore.js";
import { sanitizeProjectId } from "../knowledge/paths.js";
import { checkConsistency } from "../claims/consistency.js";
import type { Claim, ConsistencyResult } from "../claims/types.js";
import type { ToolResult } from "../providers/types.js";

const InlineClaimSchema = z.object({
  id: z.string().min(1),
  statement: z.string().min(1),
  numeric_value: z.number().optional(),
  value_display: z.string().optional(),
  unit: z.string().optional(),
  keywords: z.array(z.string()).min(1),
  citation: z.string().optional(),
  status: z.enum(["draft", "verified", "superseded"]).optional(),
});

const DeliverableSchema = z.object({
  name: z.string().min(1),
  text: z.string().min(1),
});

const ConsistencyCheckSchema = z
  .object({
    project_id: z.string().optional(),
    claims: z.array(InlineClaimSchema).optional(),
    claim_ids: z.array(z.string()).optional(),
    deliverables: z.array(DeliverableSchema).min(1, "supply at least one deliverable"),
  })
  .strict()
  .refine((d) => d.project_id || (d.claims && d.claims.length > 0), {
    message: "supply either project_id (to load the registry) or inline claims",
  });

export async function handleConsistencyCheck(
  rawInput: unknown,
): Promise<ToolResult> {
  const parsed = ConsistencyCheckSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new Error(
      parsed.error.issues
        .map((i) => `${i.path.join(".") || "input"}: ${i.message}`)
        .join("\n"),
    );
  }
  const input = parsed.data;

  // Resolve claims: registry + inline (inline overrides by id).
  let claims: Claim[] = [];
  if (input.project_id) {
    const projectId = sanitizeProjectId(input.project_id);
    if (!(await projectExists(projectId))) {
      throw new Error(
        `Project "${projectId}" not found. Create it (project.create) or pass inline claims.`,
      );
    }
    const registry = await loadClaimRegistry(projectId);
    claims = registry.claims;
  }
  if (input.claims && input.claims.length) {
    const inline: Claim[] = input.claims.map((c) => ({
      id: c.id,
      statement: c.statement,
      numeric_value: c.numeric_value,
      value_display: c.value_display,
      unit: c.unit,
      keywords: c.keywords,
      citation: c.citation,
      status: c.status ?? "draft",
      tags: [],
      created_at: "",
      updated_at: "",
    }));
    const byId = new Map(claims.map((c) => [c.id, c]));
    for (const c of inline) byId.set(c.id, c);
    claims = [...byId.values()];
  }
  if (input.claim_ids && input.claim_ids.length) {
    const want = new Set(input.claim_ids);
    claims = claims.filter((c) => want.has(c.id));
  }

  let audit = createAuditRecord(
    "evidence.consistency_check",
    input as unknown as Record<string, unknown>,
    "text",
  );
  audit = setMethodology(
    audit,
    "Keyword-anchored numeric drift detection: each claim is located in each deliverable by its keywords; numbers within ±70 characters are compared to the canonical value (exact for integers, 0.5% tolerance otherwise). Flags drift (conflicting number near keyword) and absence. Necessary-not-sufficient — human review still required.",
  );

  const result: ConsistencyResult = checkConsistency(claims, input.deliverables);

  audit = addAssumption(
    audit,
    `${result.claims_checked} claim(s) × ${result.deliverables_checked} deliverable(s); ${result.drift_count} drift, ${result.absent_count} absent.`,
  );
  for (const w of result.warnings) audit = addWarning(audit, w);

  const lines: string[] = [];
  lines.push("# Cross-Deliverable Consistency Check");
  lines.push("");
  lines.push(
    `**Claims:** ${result.claims_checked} · **Deliverables:** ${result.deliverables_checked} · **Drift:** ${result.drift_count} · **Absent:** ${result.absent_count}`,
  );
  lines.push("");

  if (result.drift_count > 0) {
    lines.push("## ⚠️ Drift — reconcile before release");
    for (const f of result.findings.filter((x) => x.status === "drift")) {
      lines.push(`- **\`${f.claim_id}\`** in **${f.deliverable}**: ${f.note}`);
    }
    lines.push("");
  } else {
    lines.push("✅ No drift detected across the supplied deliverables.");
    lines.push("");
  }

  // Matrix
  const deliverables = input.deliverables.map((d) => d.name);
  lines.push("## Claim × deliverable matrix");
  lines.push(`| Claim | ${deliverables.join(" | ")} |`);
  lines.push(`|-------|${deliverables.map(() => "------").join("|")}|`);
  const claimIds = [...new Set(result.findings.map((f) => f.claim_id))];
  for (const cid of claimIds) {
    const cells = deliverables.map((d) => {
      const f = result.findings.find(
        (x) => x.claim_id === cid && x.deliverable === d,
      );
      if (!f) return "—";
      return f.status === "consistent" ? "✅" : f.status === "drift" ? "⚠️ drift" : "absent";
    });
    lines.push(`| \`${cid}\` | ${cells.join(" | ")} |`);
  }
  lines.push("");

  lines.push("## Interpretation");
  for (const w of result.warnings) lines.push(`- ${w}`);
  lines.push("");
  lines.push(
    auditToMarkdown(audit, {
      disclosure: { level: extractDisclosureLevel(rawInput, "standard") },
    }),
  );

  return {
    content: lines.join("\n"),
    audit,
    consistency: result,
  } as ToolResult & { consistency: ConsistencyResult };
}

export const consistencyCheckToolSchema = {
  name: "evidence.consistency_check",
  description:
    "Detect drift of evidence claims across deliverables (HTA dossier, publication, GVD/AMCP payer materials). Loads claims from the project registry (project_id) and/or takes inline claims, then scans each supplied deliverable's text and flags where a DIFFERENT number sits next to a claim's keywords (drift — e.g. an ICER you updated in the model but not in the dossier) or where a claim is absent. Returns a claim × deliverable matrix, the list of drifting claims, and per-finding detail. Keyword-anchored + numeric: it catches drifting numbers near claim keywords, not paraphrased claims — a 'consistent' result is necessary, not sufficient. Pairs with evidence.claim_registry. Pure detection over caller-supplied text.",
  annotations: {
    title: "Cross-Deliverable Consistency Check",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  inputSchema: {
    type: "object",
    properties: {
      project_id: {
        type: "string",
        description: "Load claims from this project's registry. Optional if inline claims are supplied.",
      },
      claims: {
        type: "array",
        description: "Inline claims (override registry claims with the same id).",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            statement: { type: "string" },
            numeric_value: { type: "number" },
            value_display: { type: "string" },
            unit: { type: "string" },
            keywords: { type: "array", items: { type: "string" } },
            citation: { type: "string" },
            status: { type: "string", enum: ["draft", "verified", "superseded"] },
          },
          required: ["id", "statement", "keywords"],
        },
      },
      claim_ids: {
        type: "array",
        items: { type: "string" },
        description: "Optional: restrict the check to these claim ids.",
      },
      deliverables: {
        type: "array",
        minItems: 1,
        description: "Documents to check, each a {name, text}.",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            text: { type: "string" },
          },
          required: ["name", "text"],
        },
      },
      ai_disclosure_level: {
        type: "string",
        enum: ["off", "standard", "submission"],
      },
    },
    required: ["deliverables"],
  },
} as const;
