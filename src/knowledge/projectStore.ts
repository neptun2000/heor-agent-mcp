import { writeFile, readFile, mkdir, access, readdir } from "node:fs/promises";
import { join } from "node:path";
import {
  getProjectRoot,
  getWikiDir,
  getRawLiteratureDir,
  getRawModelsDir,
  getRawDossiersDir,
  getKbRoot,
  sanitizeProjectId,
} from "./paths.js";
import { stringifyFrontmatter, parseFrontmatter, type Frontmatter } from "./yaml.js";

export interface ProjectConfig {
  project_id: string;
  drug: string;
  indication: string;
  hta_targets?: string[];        // e.g. ["nice", "cadth", "pbac"]
  picos?: Array<{ id: string; population: string; comparator: string; outcomes: string[] }>;
  created_at: string;
  notes?: string;
}

export interface ProjectCreateParams {
  project_id: string;
  drug: string;
  indication: string;
  hta_targets?: string[];
  notes?: string;
}

export async function projectExists(projectId: string): Promise<boolean> {
  try {
    const yamlPath = join(getProjectRoot(projectId), "project.yaml");
    await access(yamlPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Create a new project with directory skeleton and project.yaml.
 * Idempotent: if project exists, returns existing config without overwriting.
 */
export async function createProject(
  params: ProjectCreateParams,
): Promise<{ config: ProjectConfig; created: boolean; path: string }> {
  const projectId = sanitizeProjectId(params.project_id);
  const projectRoot = getProjectRoot(projectId);

  if (await projectExists(projectId)) {
    const existing = await readProjectConfig(projectId);
    return { config: existing, created: false, path: projectRoot };
  }

  // Create directory skeleton
  await mkdir(getRawLiteratureDir(projectId), { recursive: true });
  await mkdir(getRawModelsDir(projectId), { recursive: true });
  await mkdir(getRawDossiersDir(projectId), { recursive: true });
  await mkdir(getWikiDir(projectId), { recursive: true });

  const config: ProjectConfig = {
    project_id: projectId,
    drug: params.drug,
    indication: params.indication,
    hta_targets: params.hta_targets ?? [],
    picos: [],
    created_at: new Date().toISOString(),
    notes: params.notes,
  };

  await writeProjectConfig(projectId, config);

  // Create starter wiki index.md
  const indexContent = `---
project: ${projectId}
drug: ${params.drug}
indication: ${params.indication}
---

# ${params.drug} — ${params.indication}

Project knowledge base index.

## Structure
- [[trials/]] — clinical trials and evidence
- [[comparators/]] — comparator drugs and standards of care
- [[outcomes/]] — outcome measures and endpoints
- [[picos/]] — PICO definitions per scoping decision
- [[models/]] — CE model runs and PSA results

## Data Sources
Raw search results are auto-saved to \`raw/literature/\`, \`raw/models/\`, and \`raw/dossiers/\`.

*Created: ${config.created_at}*
`;

  await writeFile(join(getWikiDir(projectId), "index.md"), indexContent, "utf-8");

  return { config, created: true, path: projectRoot };
}

export async function readProjectConfig(projectId: string): Promise<ProjectConfig> {
  const yamlPath = join(getProjectRoot(projectId), "project.yaml");
  const raw = await readFile(yamlPath, "utf-8");
  const { frontmatter } = parseFrontmatter(raw);

  return {
    project_id: String(frontmatter.project_id ?? projectId),
    drug: String(frontmatter.drug ?? ""),
    indication: String(frontmatter.indication ?? ""),
    hta_targets: Array.isArray(frontmatter.hta_targets) ? (frontmatter.hta_targets as string[]) : [],
    picos: [], // picos are complex; skip for v1
    created_at: String(frontmatter.created_at ?? ""),
    notes: frontmatter.notes ? String(frontmatter.notes) : undefined,
  };
}

async function writeProjectConfig(projectId: string, config: ProjectConfig): Promise<void> {
  const yamlPath = join(getProjectRoot(projectId), "project.yaml");
  // project.yaml uses frontmatter format (--- delimiters) for consistency with other .md files
  const fm: Frontmatter = {
    project_id: config.project_id,
    drug: config.drug,
    indication: config.indication,
    hta_targets: config.hta_targets ?? [],
    created_at: config.created_at,
  };
  if (config.notes) fm.notes = config.notes;
  const body = "# Project metadata\nManaged by heor-agent-mcp. Edit with care.";
  await writeFile(yamlPath, stringifyFrontmatter(fm, body), "utf-8");
}

/**
 * List all projects in the KB root.
 */
export async function listProjects(): Promise<string[]> {
  try {
    const projectsRoot = join(getKbRoot(), "projects");
    const entries = await readdir(projectsRoot, { withFileTypes: true });
    return entries
      .filter(e => e.isDirectory())
      .map(e => e.name)
      .sort();
  } catch {
    return [];
  }
}
