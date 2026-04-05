import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import { join } from "node:path";
import { parseFrontmatter, stringifyFrontmatter, type Frontmatter } from "./yaml.js";
import { sanitizeFilename, getRawLiteratureDir, getRawModelsDir, getRawDossiersDir } from "./paths.js";
import type { LiteratureResult } from "../providers/types.js";

/**
 * Save a literature result to the project's raw/literature/ directory.
 * If a file with the same ID exists, merges: keeps original metadata,
 * appends current timestamp to retrieved_at array, appends query to query_history.
 */
export async function saveLiteratureResult(
  projectId: string,
  result: LiteratureResult,
  query: string,
): Promise<string> {
  const dir = getRawLiteratureDir(projectId);
  await mkdir(dir, { recursive: true });

  const filename = `${sanitizeFilename(result.id)}.md`;
  const filepath = join(dir, filename);
  const nowIso = new Date().toISOString();

  let frontmatter: Frontmatter;
  let body: string;

  if (await fileExists(filepath)) {
    // Merge: read existing, append retrieval
    const existing = await readFile(filepath, "utf-8");
    const parsed = parseFrontmatter(existing);
    frontmatter = parsed.frontmatter;
    body = parsed.body;
    const retrievedAt = Array.isArray(frontmatter.retrieved_at) ? frontmatter.retrieved_at : [];
    const queryHistory = Array.isArray(frontmatter.query_history) ? frontmatter.query_history : [];
    frontmatter.retrieved_at = [...retrievedAt, nowIso];
    if (!queryHistory.includes(query)) {
      frontmatter.query_history = [...queryHistory, query];
    }
  } else {
    // Create new
    frontmatter = {
      id: result.id,
      source: result.source,
      title: result.title,
      authors: result.authors,
      date: result.date,
      study_type: result.study_type,
      url: result.url,
      project: projectId,
      retrieved_at: [nowIso],
      query_history: [query],
    };
    body = `# ${result.title}\n\n${result.abstract || "*No abstract available*"}\n\n**URL:** ${result.url}`;
  }

  const content = stringifyFrontmatter(frontmatter, body);
  await writeFile(filepath, content, "utf-8");
  return filepath;
}

/**
 * Save a CE model run to raw/models/.
 * Filename: {iso-date}_{model_type}.md
 */
export async function saveModelRun(
  projectId: string,
  metadata: Record<string, unknown>,
  textContent: string,
): Promise<string> {
  const dir = getRawModelsDir(projectId);
  await mkdir(dir, { recursive: true });
  const nowIso = new Date().toISOString().replace(/[:.]/g, "-");
  const modelType = String(metadata.model_type ?? "markov");
  const filename = `${nowIso}_${sanitizeFilename(modelType)}.md`;
  const filepath = join(dir, filename);

  const frontmatter: Frontmatter = {
    tool: "cost_effectiveness_model",
    generated_at: new Date().toISOString(),
    project: projectId,
    ...Object.fromEntries(
      Object.entries(metadata).map(([k, v]) => [k, v as string | number | boolean | string[]]),
    ),
  };

  const content = stringifyFrontmatter(frontmatter, textContent);
  await writeFile(filepath, content, "utf-8");
  return filepath;
}

/**
 * Save an HTA dossier draft to raw/dossiers/.
 * Filename: {hta_body}_{submission_type}_{iso-date}.md
 */
export async function saveDossier(
  projectId: string,
  htaBody: string,
  submissionType: string,
  metadata: Record<string, unknown>,
  textContent: string,
): Promise<string> {
  const dir = getRawDossiersDir(projectId);
  await mkdir(dir, { recursive: true });
  const nowIso = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `${sanitizeFilename(htaBody)}_${sanitizeFilename(submissionType)}_${nowIso}.md`;
  const filepath = join(dir, filename);

  const frontmatter: Frontmatter = {
    tool: "hta_dossier_prep",
    hta_body: htaBody,
    submission_type: submissionType,
    generated_at: new Date().toISOString(),
    project: projectId,
    ...Object.fromEntries(
      Object.entries(metadata).map(([k, v]) => [k, v as string | number | boolean | string[]]),
    ),
  };

  const content = stringifyFrontmatter(frontmatter, textContent);
  await writeFile(filepath, content, "utf-8");
  return filepath;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
