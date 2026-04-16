import { z } from "zod";
import { createProject, listProjects } from "../knowledge/projectStore.js";
import type { ToolResult } from "../providers/types.js";
import { createAuditRecord } from "../audit/builder.js";

const ProjectCreateSchema = z.object({
  project_id: z.string().min(1).max(64),
  drug: z.string().min(1),
  indication: z.string().min(1),
  hta_targets: z
    .array(
      z.enum([
        "nice",
        "ema",
        "fda",
        "iqwig",
        "has",
        "jca",
        "cadth",
        "pbac",
        "icer",
      ]),
    )
    .optional(),
  notes: z.string().optional(),
});

export async function handleProjectCreate(
  rawParams: unknown,
): Promise<ToolResult> {
  const params = ProjectCreateSchema.parse(rawParams);
  const audit = createAuditRecord(
    "project_create",
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
    lines.push("- raw/literature/ (auto-populated by literature_search)");
    lines.push("- raw/models/ (auto-populated by cost_effectiveness_model)");
    lines.push("- raw/dossiers/ (auto-populated by hta_dossier_prep)");
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
  name: "project_create",
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
