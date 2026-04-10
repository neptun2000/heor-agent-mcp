import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getReportsDir, sanitizeFilename } from "./paths.js";

/**
 * Save a base64-encoded DOCX report to disk.
 *
 * If `projectId` is provided, saves to `~/.heor-agent/projects/{id}/reports/`.
 * Otherwise saves to `~/.heor-agent/reports/`.
 *
 * @returns Absolute path to the saved file
 */
export async function saveReport(
  base64: string,
  filenameStem: string,
  projectId?: string,
  extension: string = "docx",
): Promise<string> {
  const dir = getReportsDir(projectId);
  await mkdir(dir, { recursive: true });

  const timestamp = new Date()
    .toISOString()
    .replace(/[:.]/g, "-")
    .replace(/T/, "_")
    .slice(0, 19);

  const safeName = sanitizeFilename(filenameStem);
  const filename = `${safeName}_${timestamp}.${extension}`;
  const fullPath = join(dir, filename);

  const buffer = Buffer.from(base64, "base64");
  await writeFile(fullPath, buffer);

  return fullPath;
}
