import { homedir } from "node:os";
import { join } from "node:path";

export function getKbRoot(): string {
  return process.env.HEOR_KB_ROOT ?? join(homedir(), ".heor-agent");
}

export function getProjectRoot(projectId: string): string {
  return join(getKbRoot(), "projects", sanitizeProjectId(projectId));
}

export function getRawLiteratureDir(projectId: string): string {
  return join(getProjectRoot(projectId), "raw", "literature");
}

export function getRawModelsDir(projectId: string): string {
  return join(getProjectRoot(projectId), "raw", "models");
}

export function getRawDossiersDir(projectId: string): string {
  return join(getProjectRoot(projectId), "raw", "dossiers");
}

export function getWikiDir(projectId: string): string {
  return join(getProjectRoot(projectId), "wiki");
}

export function getReportsDir(projectId?: string): string {
  if (projectId) {
    return join(getProjectRoot(projectId), "reports");
  }
  return join(getKbRoot(), "reports");
}

// Sanitize project ID to prevent path traversal and filesystem issues
export function sanitizeProjectId(id: string): string {
  // Allow alphanumeric, hyphens, underscores. Replace all else with hyphen.
  const clean = id
    .replace(/[^a-zA-Z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  if (clean.length === 0)
    throw new Error("Invalid project ID: must contain alphanumeric characters");
  if (clean.length > 64) return clean.slice(0, 64).toLowerCase();
  return clean.toLowerCase();
}

// Sanitize filename (for file IDs like "pubmed_12345")
export function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9_.-]/g, "_").slice(0, 200);
}
