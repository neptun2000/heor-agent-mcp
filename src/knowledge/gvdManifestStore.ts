/**
 * Persistence for the Living GVD manifest. One JSON file per project at
 * `<project>/gvd/manifest.json`. Pure storage.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getGvdDir } from "./paths.js";
import type { GvdManifest } from "../gvd/types.js";

function manifestPath(projectId: string): string {
  return join(getGvdDir(projectId), "manifest.json");
}

export async function loadGvdManifest(
  projectId: string,
): Promise<GvdManifest | null> {
  try {
    const raw = await readFile(manifestPath(projectId), "utf-8");
    const parsed = JSON.parse(raw) as GvdManifest;
    if (!Array.isArray(parsed.sections)) {
      throw new Error("malformed GVD manifest: sections is not an array");
    }
    return parsed;
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err && err.code === "ENOENT") return null;
    throw e;
  }
}

export async function saveGvdManifest(
  projectId: string,
  manifest: GvdManifest,
): Promise<string> {
  const dir = getGvdDir(projectId);
  await mkdir(dir, { recursive: true });
  const path = manifestPath(projectId);
  await writeFile(path, JSON.stringify(manifest, null, 2), "utf-8");
  return path;
}
