import type { DirectComparison, IndirectPath } from "./types.js";

/**
 * Find all indirect comparison paths through a single common comparator.
 *
 * Given comparisons A-B and B-C, returns the path A→B→C allowing
 * indirect estimation of A vs C.
 *
 * If `target` is specified, only returns paths for that specific comparison.
 */
export function findIndirectPaths(
  comparisons: DirectComparison[],
  target?: { intervention: string; comparator: string },
): IndirectPath[] {
  // Build adjacency: for each treatment pair, collect comparisons
  const norm = (s: string) => s.toLowerCase().trim();
  const pairKey = (a: string, b: string) =>
    [norm(a), norm(b)].sort().join("↔");

  const pairMap = new Map<
    string,
    { a: string; b: string; comparisons: DirectComparison[] }
  >();

  for (const c of comparisons) {
    const key = pairKey(c.intervention, c.comparator);
    if (!pairMap.has(key)) {
      pairMap.set(key, { a: c.intervention, b: c.comparator, comparisons: [] });
    }
    pairMap.get(key)!.comparisons.push(c);
  }

  // Collect all treatments
  const treatments = new Set<string>();
  for (const c of comparisons) {
    treatments.add(norm(c.intervention));
    treatments.add(norm(c.comparator));
  }

  // Build adjacency list
  const adj = new Map<string, Set<string>>();
  for (const t of treatments) {
    adj.set(t, new Set());
  }
  for (const pair of pairMap.values()) {
    const a = norm(pair.a);
    const b = norm(pair.b);
    adj.get(a)!.add(b);
    adj.get(b)!.add(a);
  }

  const paths: IndirectPath[] = [];
  const treatmentList = Array.from(treatments);

  // For each pair (A, C), find all single-bridge paths A-B-C
  for (let i = 0; i < treatmentList.length; i++) {
    for (let j = i + 1; j < treatmentList.length; j++) {
      const a = treatmentList[i];
      const c = treatmentList[j];

      // If target is specified, filter
      if (target) {
        const tA = norm(target.intervention);
        const tC = norm(target.comparator);
        if (!((a === tA && c === tC) || (a === tC && c === tA))) continue;
      }

      // Find bridges: treatments connected to both A and C
      const neighborsA = adj.get(a)!;
      const neighborsC = adj.get(c)!;

      for (const bridge of neighborsA) {
        if (bridge === a || bridge === c) continue;
        if (!neighborsC.has(bridge)) continue;

        // Found a path: A-bridge-C
        // Get comparisons for A-bridge and C-bridge
        const abKey = pairKey(a, bridge);
        const cbKey = pairKey(c, bridge);

        const abData = pairMap.get(abKey);
        const cbData = pairMap.get(cbKey);

        if (abData && cbData) {
          // Get original labels (non-normalized)
          const labelA =
            abData.comparisons[0].intervention === a ||
            norm(abData.comparisons[0].intervention) === a
              ? abData.comparisons[0].intervention
              : abData.comparisons[0].comparator;
          const labelC =
            cbData.comparisons[0].intervention === c ||
            norm(cbData.comparisons[0].intervention) === c
              ? cbData.comparisons[0].intervention
              : cbData.comparisons[0].comparator;
          const labelBridge =
            abData.comparisons[0].comparator === bridge ||
            norm(abData.comparisons[0].comparator) === bridge
              ? abData.comparisons[0].comparator
              : abData.comparisons[0].intervention;

          paths.push({
            a: labelA,
            c: labelC,
            bridge: labelBridge,
            abComparisons: abData.comparisons,
            bcComparisons: cbData.comparisons,
          });
        }
      }
    }
  }

  return paths;
}
