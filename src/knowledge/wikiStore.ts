import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import { dirname, join, normalize, relative, isAbsolute, sep } from "node:path";
import { getWikiDir, getProjectRoot } from "./paths.js";

/**
 * Validate that a requested path stays inside the allowed directory.
 * Prevents path traversal (../../etc/passwd).
 * Returns the resolved absolute path if safe, or throws.
 */
function validatePath(allowedRoot: string, requestedPath: string): string {
  if (isAbsolute(requestedPath)) {
    throw new Error(`Path must be relative: ${requestedPath}`);
  }
  // Normalize removes ../ etc.
  const normalized = normalize(requestedPath);
  if (normalized.startsWith("..") || normalized.includes(`${sep}..`) || normalized.includes(`..${sep}`)) {
    throw new Error(`Path traversal not allowed: ${requestedPath}`);
  }
  const resolved = join(allowedRoot, normalized);
  const rel = relative(allowedRoot, resolved);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(`Path escapes allowed root: ${requestedPath}`);
  }
  return resolved;
}

/**
 * Read a file from anywhere in the project's raw/ or wiki/ tree.
 * Path is relative to project root.
 * Allowed prefixes: "raw/", "wiki/"
 */
export async function readKnowledgeFile(projectId: string, path: string): Promise<string> {
  const projectRoot = getProjectRoot(projectId);
  const fullPath = validatePath(projectRoot, path);

  // Only allow reading from raw/ or wiki/ subtrees
  const rel = relative(projectRoot, fullPath);
  const inRaw = rel.startsWith("raw/") || rel.startsWith("raw" + sep);
  const inWiki = rel.startsWith("wiki/") || rel.startsWith("wiki" + sep);
  if (!inRaw && !inWiki) {
    throw new Error(`Read only allowed in raw/ or wiki/ subtrees: ${path}`);
  }

  return readFile(fullPath, "utf-8");
}

/**
 * Write a file to the project's wiki/ tree.
 * Path is relative to project root, MUST start with "wiki/".
 * Creates parent directories as needed.
 * Raw files can NOT be written via this tool — they come only from tool auto-save.
 */
export async function writeWikiFile(projectId: string, path: string, content: string): Promise<string> {
  const projectRoot = getProjectRoot(projectId);
  const fullPath = validatePath(projectRoot, path);

  // Must be inside wiki/
  const rel = relative(projectRoot, fullPath);
  if (!rel.startsWith("wiki/") && !rel.startsWith("wiki" + sep)) {
    throw new Error(`Writes only allowed in wiki/ subtree. Got: ${path}`);
  }

  if (!fullPath.endsWith(".md")) {
    throw new Error(`Wiki files must have .md extension: ${path}`);
  }

  await mkdir(dirname(fullPath), { recursive: true });
  await writeFile(fullPath, content, "utf-8");
  return fullPath;
}

/**
 * Check if a file exists in the project tree (raw/ or wiki/).
 */
export async function knowledgeFileExists(projectId: string, path: string): Promise<boolean> {
  try {
    const projectRoot = getProjectRoot(projectId);
    const fullPath = validatePath(projectRoot, path);
    await access(fullPath);
    return true;
  } catch {
    return false;
  }
}
