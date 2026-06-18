/**
 * publication.draft — assemble an abstract / manuscript / poster /
 * plain-language summary that reuses claims from the project registry.
 *
 * Selects the right reporting guideline for the study design (CONSORT /
 * STROBE / PRISMA / CHEERS), emits a GPP2022 + ICMJE compliance checklist,
 * and inserts referenced claims so the same source-of-truth figures appear
 * in the publication as in the dossier. Pure logic + an optional registry
 * read. See design log #20.
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
import { projectExists } from "../knowledge/projectStore.js";
import { loadClaimRegistry } from "../knowledge/claimStore.js";
import { sanitizeProjectId } from "../knowledge/paths.js";
import { buildPublication } from "../claims/publication.js";
import type { Claim, PublicationResult } from "../claims/types.js";
import type { ToolResult } from "../providers/types.js";

const TYPES = ["abstract", "manuscript", "poster", "plain_language_summary"] as const;
const DESIGNS = ["rct", "observational", "systematic_review", "economic_evaluation", "other"] as const;

const PublicationDraftSchema = z
  .object({
    type: caseInsensitiveEnum(TYPES),
    title: z.string().min(1, "title is required"),
    study_design: caseInsensitiveEnum(DESIGNS).default("other"),
    target: z.string().optional(),
    background: z.string().optional(),
    objective: z.string().optional(),
    methods: z.string().optional(),
    results: z.string().optional(),
    conclusions: z.string().optional(),
    project_id: z.string().optional(),
    reference_claim_ids: z.array(z.string()).default([]),
    word_limit: z.number().int().positive().optional(),
    funded: z.boolean().optional(),
    medical_writing_support: z.boolean().optional(),
    trial_registration_id: z.string().optional(),
  })
  .strict();

export async function handlePublicationDraft(
  rawInput: unknown,
): Promise<ToolResult> {
  const parsed = PublicationDraftSchema.safeParse(rawInput);
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

  // Resolve referenced claims from the registry.
  let resolved_claims: Claim[] = [];
  const missingClaims: string[] = [];
  if (input.reference_claim_ids.length > 0) {
    if (!input.project_id) {
      throw new Error(
        "reference_claim_ids supplied but no project_id — claims are resolved from a project registry.",
      );
    }
    const projectId = sanitizeProjectId(input.project_id);
    if (!(await projectExists(projectId))) {
      throw new Error(`Project "${projectId}" not found.`);
    }
    const registry = await loadClaimRegistry(projectId);
    const byId = new Map(registry.claims.map((c) => [c.id, c]));
    for (const id of input.reference_claim_ids) {
      const found = byId.get(id);
      if (found) resolved_claims.push(found);
      else missingClaims.push(id);
    }
  }

  let audit = createAuditRecord(
    "publication.draft",
    input as unknown as Record<string, unknown>,
    "text",
  );
  audit = setMethodology(
    audit,
    "Publication scaffolding per ICMJE Recommendations + GPP2022 (Good Publication Practice). Reporting guideline auto-selected by study design (CONSORT/STROBE/PRISMA/CHEERS, EQUATOR Network). Referenced claims pulled from the project claim registry to keep figures consistent with the dossier (single source of truth).",
  );

  const result: PublicationResult = buildPublication({
    title: input.title,
    type: input.type,
    target: input.target,
    study_design: input.study_design,
    background: input.background,
    objective: input.objective,
    methods: input.methods,
    results: input.results,
    conclusions: input.conclusions,
    resolved_claims,
    word_limit: input.word_limit,
    funded: input.funded,
    medical_writing_support: input.medical_writing_support,
    trial_registration_id: input.trial_registration_id,
  });

  if (missingClaims.length > 0) {
    audit = addWarning(
      audit,
      `Referenced claim id(s) not found in registry: ${missingClaims.join(", ")}.`,
    );
  }
  audit = addAssumption(
    audit,
    `${input.type} drafted (${result.word_count} words${result.word_limit ? ` / ${result.word_limit} limit` : ""}); ${result.referenced_claims.length} claim(s) inserted.`,
  );
  for (const w of result.warnings) audit = addWarning(audit, w);

  const lines: string[] = [];
  lines.push(`# ${result.title}`);
  lines.push("");
  lines.push(
    `**Type:** ${result.type}${result.target ? ` · **Target:** ${result.target}` : ""} · **Words:** ${result.word_count}${result.word_limit ? ` / ${result.word_limit}` : ""} · **Guideline:** ${result.reporting_guideline}`,
  );
  lines.push("");

  for (const s of result.sections) {
    lines.push(`## ${s.heading}`);
    lines.push(s.body);
    lines.push("");
  }

  if (missingClaims.length > 0) {
    lines.push("## ⚠️ Unresolved claim references");
    lines.push(`These claim ids were not found in the registry: ${missingClaims.map((m) => `\`${m}\``).join(", ")}.`);
    lines.push("");
  }

  lines.push("## Compliance checklist (ICMJE + GPP2022)");
  lines.push("| Item | Required |");
  lines.push("|------|----------|");
  for (const c of result.compliance_checklist) {
    lines.push(`| ${c.item} | ${c.mandatory ? "✅ mandatory" : "recommended"} |`);
  }
  lines.push("");

  if (result.warnings.length) {
    lines.push("## ⚠️ Advisory");
    for (const w of result.warnings) lines.push(`- ${w}`);
    lines.push("");
  }

  lines.push("## References");
  lines.push("- ICMJE Recommendations for the Conduct, Reporting, Editing, and Publication of Scholarly Work in Medical Journals");
  lines.push("- GPP2022: Good Publication Practice guidelines (DeTora et al. 2022, Ann Intern Med)");
  lines.push(`- EQUATOR Network reporting guideline: ${result.reporting_guideline}`);
  lines.push("");
  lines.push(
    auditToMarkdown(audit, {
      disclosure: { level: extractDisclosureLevel(rawInput, "submission") },
    }),
  );

  return {
    content: lines.join("\n"),
    audit,
    publication: result,
  } as ToolResult & { publication: PublicationResult };
}

export const publicationDraftToolSchema = {
  name: "publication.draft",
  description:
    "Draft a publication — abstract, manuscript, poster, or plain-language summary — that reuses claims from the project registry so the same source-of-truth figures appear in the publication as in the dossier. Structures the content per type (structured abstract / IMRaD manuscript / poster / lay summary), auto-selects the reporting guideline for the study_design (CONSORT for RCTs, STROBE for observational, PRISMA for systematic reviews, CHEERS for economic evaluations), enforces a word limit (default per type, overridable), and emits a GPP2022 + ICMJE compliance checklist (authorship criteria, disclosures, funding, trial registration, data-sharing). Pass reference_claim_ids + project_id to pull registered claims into the Results. Flags over-limit drafts, unregistered RCTs, and superseded claims; notes that AI cannot be an author (ICMJE). Pairs with evidence.claim_registry + evidence.consistency_check. Enum values case-insensitive.",
  annotations: {
    title: "Publication Draft",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  inputSchema: {
    type: "object",
    properties: {
      type: { type: "string", enum: TYPES },
      title: { type: "string" },
      study_design: { type: "string", enum: DESIGNS, default: "other" },
      target: { type: "string", description: "Journal or congress, e.g. 'ISPOR 2026', 'Value in Health'." },
      background: { type: "string" },
      objective: { type: "string" },
      methods: { type: "string" },
      results: { type: "string" },
      conclusions: { type: "string" },
      project_id: { type: "string", description: "Required when reference_claim_ids is non-empty." },
      reference_claim_ids: {
        type: "array",
        items: { type: "string" },
        default: [],
        description: "Claim ids from the registry to insert into Results (single source of truth).",
      },
      word_limit: { type: "number", description: "Override the per-type default word limit." },
      funded: { type: "boolean" },
      medical_writing_support: { type: "boolean" },
      trial_registration_id: { type: "string" },
      ai_disclosure_level: {
        type: "string",
        enum: ["off", "standard", "submission"],
      },
    },
    required: ["type", "title"],
  },
} as const;
