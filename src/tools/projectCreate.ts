import { z } from "zod";
import { createProject, listProjects } from "../knowledge/projectStore.js";
import type { ToolResult } from "../providers/types.js";
import { createAuditRecord } from "../audit/builder.js";
import { suggestForEnum } from "../util/didYouMean.js";

// Expanded list of HTA bodies users actually target. Added: smc (Scotland),
// awmsg (Wales), tlv (Sweden), aifa (Italy), inesss (Quebec), ispor.
// PostHog showed real-world calls with hta_targets=["smc"] failing because
// SMC was missing.
const HTA_TARGETS = [
  "nice",
  "smc",
  "awmsg",
  "ema",
  "fda",
  "iqwig",
  "gba",
  "has",
  "jca",
  "cadth",
  "pbac",
  "icer",
  "tlv",
  "aifa",
  "inesss",
  "ispor",
] as const;

const ProjectCreateSchema = z.object({
  project_id: z.string().min(1).max(64),
  drug: z.string().min(1),
  indication: z.string().min(1),
  hta_targets: z.array(z.enum(HTA_TARGETS)).optional(),
  notes: z.string().optional(),
});

export async function handleProjectCreate(
  rawParams: unknown,
): Promise<ToolResult> {
  const result = ProjectCreateSchema.safeParse(rawParams);
  if (!result.success) {
    const messages: string[] = [];
    for (const issue of result.error.issues) {
      if (
        issue.code === "invalid_enum_value" &&
        typeof issue.received === "string"
      ) {
        const suggestions = suggestForEnum(
          issue.received,
          issue.options as readonly string[],
        );
        const hint =
          suggestions.length > 0
            ? `Did you mean: ${suggestions.map((s) => `"${s}"`).join(", ")}?`
            : `Valid options: ${(issue.options as string[]).join(", ")}.`;
        messages.push(
          `Unknown ${issue.path.join(".")} value "${issue.received}". ${hint}`,
        );
      } else {
        messages.push(`${issue.path.join(".")}: ${issue.message}`);
      }
    }
    throw new Error(messages.join("\n"));
  }
  const params = result.data;
  const audit = createAuditRecord(
    "project.create",
    params as unknown as Record<string, unknown>,
    "text",
  );

  const { config, created, path } = await createProject(params);

  const lines: string[] = [];
  if (created) {
    lines.push(`✓ Created project "${config.project_id}"`);
    lines.push(`Drug: ${config.drug} | Indication: ${config.indication}`);
    if (config.hta_targets && config.hta_targets.length > 0) {
      lines.push(`HTA targets: ${config.hta_targets.join(", ")}`);
    }
    lines.push(`Path: ${path}`);
    lines.push("");
    lines.push("Directory skeleton created:");
    lines.push("- raw/literature/ (auto-populated by literature.search)");
    lines.push("- raw/models/ (auto-populated by models.cost_effectiveness)");
    lines.push("- raw/dossiers/ (auto-populated by hta.dossier)");
    lines.push("- wiki/index.md (starter index for manual organization)");
    lines.push("");
    lines.push(
      `Now use \`project: "${config.project_id}"\` in tool calls to auto-save results here.`,
    );
  } else {
    lines.push(`Project "${config.project_id}" already exists at ${path}`);
    lines.push(`Drug: ${config.drug} | Indication: ${config.indication}`);
  }

  const allProjects = await listProjects();
  lines.push(
    `\nAll projects (${allProjects.length}): ${allProjects.join(", ")}`,
  );

  return { content: lines.join("\n"), audit };
}

export const projectCreateToolSchema = {
  name: "project.create",
  description:
    "Initialize a new HEOR project workspace with directory skeleton and project.yaml metadata. Idempotent — returns existing project if already created. Required before using the `project` parameter in other tools.",
  annotations: {
    title: "Create Project Workspace",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  inputSchema: {
    type: "object",
    properties: {
      project_id: {
        type: "string",
        description:
          "Short identifier (alphanumeric + hyphens, e.g. 'semaglutide-t2d')",
      },
      drug: { type: "string", description: "Drug or intervention name" },
      indication: {
        type: "string",
        description: "Disease/condition being treated",
      },
      hta_targets: {
        type: "array",
        items: {
          type: "string",
          enum: [
            "nice",
            "ema",
            "fda",
            "iqwig",
            "has",
            "jca",
            "cadth",
            "pbac",
            "icer",
          ],
        },
        description: "HTA bodies to target (optional)",
      },
      notes: {
        type: "string",
        description: "Free-text project notes (optional)",
      },
    },
    required: ["project_id", "drug", "indication"],
  },
};
