/**
 * Persistence for the claim registry. One JSON file per project at
 * `<project>/claims/registry.json`. Pure storage — validation and
 * upsert/dedup logic live in the tool layer.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getClaimsDir } from "./paths.js";
import type { ClaimRegistry } from "../claims/types.js";

function registryPath(projectId: string): string {
  return join(getClaimsDir(projectId), "registry.json");
}

/** Load the registry, or an empty one if none exists yet. */
export async function loadClaimRegistry(
  projectId: string,
): Promise<ClaimRegistry> {
  try {
    const raw = await readFile(registryPath(projectId), "utf-8");
    const parsed = JSON.parse(raw) as ClaimRegistry;
    if (!Array.isArray(parsed.claims)) {
      throw new Error("malformed registry: claims is not an array");
    }
    return parsed;
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err && err.code === "ENOENT") {
      return {
        schema_version: "1.0",
        project_id: projectId,
        claims: [],
        updated_at: new Date().toISOString(),
      };
    }
    throw e;
  }
}

export async function saveClaimRegistry(
  projectId: string,
  registry: ClaimRegistry,
): Promise<string> {
  const dir = getClaimsDir(projectId);
  await mkdir(dir, { recursive: true });
  const path = registryPath(projectId);
  await writeFile(path, JSON.stringify(registry, null, 2), "utf-8");
  return path;
}
