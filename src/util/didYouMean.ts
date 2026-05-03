/**
 * Levenshtein-distance "did you mean" suggestions for invalid enum values.
 *
 * When a Claude/ChatGPT call fails Zod validation with an `invalid_enum_value`
 * (e.g., user passed "heta" expecting "hta"), surface the closest valid
 * candidate so the agent can self-correct on the next turn instead of
 * giving up or fabricating.
 */

function levenshtein(a: string, b: string): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost,
      );
    }
  }
  return dp[m][n];
}

/**
 * Max edit distance for a "close enough" suggestion. Scaled to ~30% of the
 * input length so longer strings allow more typos but short strings stay
 * strict (avoids "xyz" → "abc" false positives).
 */
function maxDistance(input: string): number {
  return Math.max(2, Math.ceil(input.length * 0.4));
}

/** Returns the single closest match within threshold, or null. */
export function closestMatch(
  input: string,
  candidates: readonly string[],
): string | null {
  if (candidates.length === 0) return null;
  const lower = input.toLowerCase();
  const threshold = maxDistance(lower);
  let best: { name: string; dist: number } | null = null;
  for (const c of candidates) {
    const d = levenshtein(lower, c.toLowerCase());
    if (d > threshold) continue;
    if (!best || d < best.dist) best = { name: c, dist: d };
  }
  return best?.name ?? null;
}

/** Returns the top-3 nearest enum values within threshold (sorted by distance). */
export function suggestForEnum(
  input: string,
  candidates: readonly string[],
): string[] {
  const lower = input.toLowerCase();
  const threshold = maxDistance(lower);
  return candidates
    .map((c) => ({ c, d: levenshtein(lower, c.toLowerCase()) }))
    .filter(({ d }) => d <= threshold)
    .sort((a, b) => a.d - b.d)
    .slice(0, 3)
    .map(({ c }) => c);
}
