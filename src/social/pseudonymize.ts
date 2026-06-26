import { createHash } from "node:crypto";
/** Truncated SHA-256 of a social handle. Deterministic + irreversible. */
export function pseudonymizeAuthor(username: string): string {
  return createHash("sha256").update(username).digest("hex").slice(0, 12);
}
