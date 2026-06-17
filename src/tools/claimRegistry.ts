/**
 * evidence.claim_registry — author evidence claims once, reference by ID
 * across deliverables.
 *
 * A claim is a single source-of-truth statement (an ICER, an effect
 * estimate, a prevalence) persisted in the project knowledge base at
 * `<project>/claims/registry.json`. Pairs with evidence.consistency_check
 * (drift detection) and publication.draft (claim reuse). See design log #20.
 *
 * Actions: upsert | list | get | remove.
 */
import { z } from "zod";
import {
  addAssumption,
  createAuditRecord,
  setMethodology,
} from "../audit/builder.js";
import { auditToMarkdown } from "../formatters/markdown.js";
import { extractDisclosureLevel } from "../formatters/disclosure.js";
import { suggestForEnum } from "../util/didYouMean.js";
import { caseInsensitiveEnum } from "../util/caseInsensitive.js";
import { projectExists } from "../knowledge/projectStore.js";
import {
  loadClaimRegistry,
  saveClaimRegistry,
} from "../knowledge/claimStore.js";
import { sanitizeProjectId } from "../knowledge/paths.js";
import { extractClaims, SUPPORTED_IMPORT_SOURCES } from "../claims/extract.js";
import type { Claim } from "../claims/types.js";
import type { ToolResult } from "../providers/types.js";

const ACTIONS = ["upsert", "list", "get", "remove", "import"] as const;
const STATUSES = ["draft", "verified", "superseded"] as const;

const ClaimInputSchema = z.object({
  id: z.string().min(1).optional(),
  statement: z.string().min(1).optional(),
  numeric_value: z.number().optional(),
  value_display: z.string().optional(),
  unit: z.string().optional(),
  keywords: z.array(z.string()).optional(),
  citation: z.string().optional(),
  source_tool: z.string().optional(),
  source_run_id: z.string().optional(),
  status: caseInsensitiveEnum(STATUSES).optional(),
  tags: z.array(z.string()).optional(),
});

const ClaimRegistrySchema = z
  .object({
    project_id: z.string().min(1, "project_id is required"),
    action: caseInsensitiveEnum(ACTIONS),
    claim: ClaimInputSchema.optional(),
    claim_id: z.string().optional(),
    import_from: z
      .object({
        source_tool: z.string().min(1),
        source_run_id: z.string().optional(),
        result: z.unknown(),
      })
      .optional(),
  })
  .strict();

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

export async function handleClaimRegistry(
  rawInput: unknown,
): Promise<ToolResult> {
  const parsed = ClaimRegistrySchema.safeParse(rawInput);
  if (!parsed.success) {
    const messages: string[] = [];
    for (const issue of parsed.error.issues) {
      if (
        issue.code === "invalid_enum_value" &&
        typeof issue.received === "string"
      ) {
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
  const projectId = sanitizeProjectId(input.project_id);

  if (!(await projectExists(projectId))) {
    throw new Error(
      `Project "${projectId}" not found. Create it first with project.create.`,
    );
  }

  let audit = createAuditRecord(
    "evidence.claim_registry",
    input as unknown as Record<string, unknown>,
    "text",
  );
  audit = setMethodology(
    audit,
    "Single source-of-truth claim registry persisted in the project knowledge base. Enables cross-deliverable traceability and drift detection (evidence.consistency_check) per good-publication/HTA evidence-management practice.",
  );

  const registry = await loadClaimRegistry(projectId);
  const now = new Date().toISOString();
  const lines: string[] = [];
  let savedPath: string | undefined;

  switch (input.action) {
    case "upsert": {
      if (!input.claim || !input.claim.statement) {
        throw new Error(
          "action 'upsert' requires claim.statement (and optionally claim.id).",
        );
      }
      const c = input.claim;
      const statement = c.statement;
      if (!statement) {
        throw new Error("action 'upsert' requires claim.statement.");
      }
      let id = c.id ? slugify(c.id) : slugify(statement);
      // Ensure non-empty id.
      if (!id) id = `claim-${registry.claims.length + 1}`;
      const existingIdx = registry.claims.findIndex((x) => x.id === id);
      const base: Claim = {
        id,
        statement,
        numeric_value: c.numeric_value,
        value_display: c.value_display,
        unit: c.unit,
        keywords:
          c.keywords && c.keywords.length
            ? c.keywords
            : deriveKeywords(statement, c.unit),
        citation: c.citation,
        source_tool: c.source_tool,
        source_run_id: c.source_run_id,
        status: c.status ?? "draft",
        tags: c.tags ?? [],
        created_at: existingIdx >= 0 ? registry.claims[existingIdx].created_at : now,
        updated_at: now,
      };
      if (existingIdx >= 0) {
        registry.claims[existingIdx] = base;
        lines.push(`Updated claim \`${id}\`.`);
      } else {
        registry.claims.push(base);
        lines.push(`Created claim \`${id}\`.`);
      }
      registry.updated_at = now;
      savedPath = await saveClaimRegistry(projectId, registry);
      audit = addAssumption(audit, `Upserted claim ${id}; registry now holds ${registry.claims.length} claim(s).`);
      lines.push("");
      lines.push(renderClaim(base));
      break;
    }
    case "import": {
      if (!input.import_from) {
        throw new Error(
          "action 'import' requires import_from { source_tool, result }.",
        );
      }
      const { source_tool, source_run_id, result } = input.import_from;
      const extracted = extractClaims(source_tool, result);
      if (extracted.length === 0) {
        if (!SUPPORTED_IMPORT_SOURCES.includes(source_tool)) {
          throw new Error(
            `Unsupported import source "${source_tool}". Supported: ${SUPPORTED_IMPORT_SOURCES.join(", ")}.`,
          );
        }
        lines.push(
          `No claims could be extracted from the ${source_tool} result — check that the structured result object was passed.`,
        );
        break;
      }
      const importedIds: string[] = [];
      for (const e of extracted) {
        const id = slugify(e.id) || `claim-${registry.claims.length + 1}`;
        const idx = registry.claims.findIndex((x) => x.id === id);
        const claim: Claim = {
          id,
          statement: e.statement,
          numeric_value: e.numeric_value,
          value_display: e.value_display,
          unit: e.unit,
          keywords: e.keywords,
          source_tool,
          source_run_id,
          status: "draft",
          tags: ["imported"],
          created_at: idx >= 0 ? registry.claims[idx].created_at : now,
          updated_at: now,
        };
        if (idx >= 0) registry.claims[idx] = claim;
        else registry.claims.push(claim);
        importedIds.push(id);
      }
      registry.updated_at = now;
      savedPath = await saveClaimRegistry(projectId, registry);
      audit = addAssumption(
        audit,
        `Imported ${importedIds.length} claim(s) from ${source_tool}: ${importedIds.join(", ")}.`,
      );
      lines.push(
        `Imported ${importedIds.length} claim(s) from \`${source_tool}\`: ${importedIds.map((i) => `\`${i}\``).join(", ")}.`,
      );
      lines.push("");
      for (const id of importedIds) {
        const c = registry.claims.find((x) => x.id === id);
        if (c) lines.push(renderClaim(c));
      }
      break;
    }
    case "remove": {
      if (!input.claim_id) throw new Error("action 'remove' requires claim_id.");
      const id = slugify(input.claim_id);
      const before = registry.claims.length;
      registry.claims = registry.claims.filter((x) => x.id !== id);
      if (registry.claims.length === before) {
        throw new Error(`Claim "${id}" not found in registry.`);
      }
      registry.updated_at = now;
      savedPath = await saveClaimRegistry(projectId, registry);
      lines.push(`Removed claim \`${id}\`. ${registry.claims.length} claim(s) remain.`);
      break;
    }
    case "get": {
      if (!input.claim_id) throw new Error("action 'get' requires claim_id.");
      const id = slugify(input.claim_id);
      const found = registry.claims.find((x) => x.id === id);
      if (!found) throw new Error(`Claim "${id}" not found in registry.`);
      lines.push(renderClaim(found));
      break;
    }
    case "list":
    default: {
      lines.push(`# Claim registry — ${projectId}`);
      lines.push("");
      if (registry.claims.length === 0) {
        lines.push("_No claims yet. Add one with action 'upsert'._");
      } else {
        lines.push("| ID | Statement | Value | Status | Source |");
        lines.push("|----|-----------|-------|--------|--------|");
        for (const c of registry.claims) {
          lines.push(
            `| \`${c.id}\` | ${truncate(c.statement, 60)} | ${c.value_display ?? c.numeric_value ?? "—"} | ${c.status} | ${c.source_tool ?? "—"} |`,
          );
        }
      }
      break;
    }
  }

  if (savedPath) {
    lines.push("");
    lines.push(`_Registry saved to ${savedPath}_`);
  }
  lines.push("");
  lines.push(
    auditToMarkdown(audit, {
      disclosure: { level: extractDisclosureLevel(rawInput, "standard") },
    }),
  );

  return {
    content: lines.join("\n"),
    audit,
    registry: { project_id: projectId, count: registry.claims.length, claims: registry.claims },
  } as ToolResult & { registry: { project_id: string; count: number; claims: Claim[] } };
}

function deriveKeywords(statement: string, unit?: string): string[] {
  const kws: string[] = [];
  if (unit) kws.push(unit);
  // Pull a few salient capitalised/acronym tokens as anchors.
  const acronyms = statement.match(/\b[A-Z]{2,}\b/g) ?? [];
  for (const a of acronyms) if (!kws.includes(a)) kws.push(a);
  return kws;
}

function renderClaim(c: Claim): string {
  const lines = [
    `### \`${c.id}\` (${c.status})`,
    `**Statement:** ${c.statement}`,
  ];
  if (c.value_display ?? c.numeric_value !== undefined)
    lines.push(`**Value:** ${c.value_display ?? c.numeric_value}${c.unit ? ` ${c.unit}` : ""}`);
  if (c.keywords.length) lines.push(`**Keywords:** ${c.keywords.join(", ")}`);
  if (c.citation) lines.push(`**Citation:** ${c.citation}`);
  if (c.source_tool) lines.push(`**Source:** ${c.source_tool}${c.source_run_id ? ` (run ${c.source_run_id})` : ""}`);
  if (c.tags.length) lines.push(`**Tags:** ${c.tags.join(", ")}`);
  return lines.join("\n");
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

export const claimRegistryToolSchema = {
  name: "evidence.claim_registry",
  description:
    "Author evidence claims once and reference them by ID across deliverables (dossiers, publications, payer materials). A claim is a single source-of-truth statement — an ICER, an effect estimate, a prevalence — persisted in the project knowledge base. Actions: 'upsert' (create/update a claim; id auto-derived from the statement if omitted), 'list', 'get', 'remove', and 'import' (auto-register claims from a tool result — pass import_from {source_tool, result} with the structured output of models.cost_effectiveness (→ ICER, incremental QALYs, incremental cost) or models.budget_impact (→ net budget impact); the registry self-populates instead of manual upserts). Each claim carries a numeric_value + value_display + unit + keywords (anchors used by evidence.consistency_check to locate it in prose) + citation + source_tool/run for provenance + status (draft/verified/superseded). Requires an existing project (project.create). Pairs with evidence.consistency_check (detect drift across documents) and publication.draft (reuse claims). Enum values case-insensitive.",
  annotations: {
    title: "Claim Registry",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  inputSchema: {
    type: "object",
    properties: {
      project_id: { type: "string" },
      action: { type: "string", enum: ACTIONS },
      claim: {
        type: "object",
        properties: {
          id: { type: "string", description: "Optional stable slug; derived from statement if omitted." },
          statement: { type: "string" },
          numeric_value: { type: "number" },
          value_display: { type: "string", description: "Canonical display form, e.g. '£18,500'." },
          unit: { type: "string", description: "e.g. 'GBP/QALY', '%', 'days'." },
          keywords: {
            type: "array",
            items: { type: "string" },
            description: "Anchor terms the consistency checker uses to locate the claim in prose. Derived from the statement + unit if omitted.",
          },
          citation: { type: "string" },
          source_tool: { type: "string" },
          source_run_id: { type: "string" },
          status: { type: "string", enum: STATUSES },
          tags: { type: "array", items: { type: "string" } },
        },
      },
      claim_id: { type: "string", description: "For 'get' / 'remove'." },
      import_from: {
        type: "object",
        description:
          "For 'import': auto-extract claims from a tool result. source_tool ∈ {models.cost_effectiveness, models.budget_impact}; result = that tool's structured output (the model_results / content object).",
        properties: {
          source_tool: { type: "string" },
          source_run_id: { type: "string" },
          result: {},
        },
        required: ["source_tool", "result"],
      },
      ai_disclosure_level: {
        type: "string",
        enum: ["off", "standard", "submission"],
      },
    },
    required: ["project_id", "action"],
  },
} as const;
