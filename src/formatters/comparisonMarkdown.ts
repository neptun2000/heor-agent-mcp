import type { IndirectComparisonResult } from "../network/types.js";

function formatNum(n: number, decimals: number = 2): string {
  return n.toFixed(decimals);
}

function formatP(p: number): string {
  if (p < 0.001) return "<0.001";
  if (p < 0.01) return formatNum(p, 3);
  return formatNum(p, 3);
}

export function comparisonToMarkdown(result: IndirectComparisonResult): string {
  const lines: string[] = [];

  lines.push("## Indirect Treatment Comparisons");
  lines.push("");

  const methodLabel =
    result.method === "bucher"
      ? "Bucher Method"
      : result.method === "frequentist_nma"
        ? "Frequentist Network Meta-Analysis"
        : "Mixed Methods";
  lines.push(`**Method:** ${methodLabel}`);
  lines.push(`**Comparisons:** ${result.estimates.length}`);
  lines.push("");

  if (result.estimates.length === 0) {
    lines.push(
      "No indirect comparisons could be computed. Check that comparisons share a common comparator and measure the same outcome.",
    );
    return lines.join("\n");
  }

  // Group by outcome
  const outcomes = new Map<string, typeof result.estimates>();
  for (const e of result.estimates) {
    if (!outcomes.has(e.outcome)) outcomes.set(e.outcome, []);
    outcomes.get(e.outcome)!.push(e);
  }

  for (const [outcome, estimates] of outcomes) {
    lines.push(`### ${outcome}`);
    lines.push("");

    const measure = estimates[0].measure;
    const label = measure === "MD" ? "MD" : measure;

    lines.push(`| Comparison | ${label} | 95% CI | p-value | Via | Method |`);
    lines.push("|------------|---------|--------|---------|-----|--------|");

    for (const e of estimates) {
      const est =
        measure === "MD" ? formatNum(e.estimate) : formatNum(e.estimate);
      const ci = `[${formatNum(e.ci_lower)}, ${formatNum(e.ci_upper)}]`;
      const p = formatP(e.p_value);
      const via = e.commonComparator;
      const method = e.method === "bucher" ? "Bucher" : "Freq. NMA";

      lines.push(
        `| ${e.intervention} vs ${e.comparator} | ${est} | ${ci} | ${p} | ${via} | ${method} |`,
      );
    }
    lines.push("");
  }

  // Heterogeneity statistics (I², Cochran Q)
  if (result.heterogeneity && result.heterogeneity.length > 0) {
    lines.push("### Heterogeneity Statistics");
    lines.push(
      `Per-comparison heterogeneity across trials of the same pair/outcome/measure. Interpretation bands per Cochrane Handbook Ch. 10.10.`,
    );
    lines.push("");
    lines.push(
      `| Comparison | k | Cochran Q | df | p-value | I² (%) | τ² | Interpretation |`,
    );
    lines.push(`|---|---:|---:|---:|---:|---:|---:|---|`);
    for (const h of result.heterogeneity) {
      lines.push(
        `| ${h.comparison_label} | ${h.n_studies} | ${h.cochran_q.toFixed(2)} | ${h.df} | ${h.p_value.toFixed(4)} | ${h.i_squared_pct.toFixed(1)} | ${h.tau_squared.toFixed(4)} | ${h.interpretation_band} |`,
      );
    }
    const anyHigh = result.heterogeneity.some(
      (h) =>
        h.interpretation === "substantial" ||
        h.interpretation === "considerable",
    );
    if (anyHigh) {
      lines.push("");
      lines.push(
        `> ⚠️ Substantial or considerable heterogeneity detected in at least one comparison. Consider subgroup analysis, meta-regression, or random-effects pooling. Investigate effect modifiers via \`itc_feasibility\`.`,
      );
    }
    lines.push("");
  }

  // Warnings
  if (result.warnings.length > 0) {
    lines.push("### Warnings");
    for (const w of result.warnings) {
      lines.push(`- ⚠️ ${w}`);
    }
    lines.push("");
  }

  // Limitations
  lines.push("### Limitations");
  for (const l of result.limitations) {
    lines.push(`- ${l}`);
  }

  return lines.join("\n");
}
