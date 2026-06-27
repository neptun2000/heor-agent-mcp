import type { FilterProvenance, NumberedLine, StrandId } from "./types.js";

export interface StrandStrategy {
  strand: StrandId;
  embase_lines: NumberedLine[];
  pubmed_lines: NumberedLine[];
  provenance: FilterProvenance;
  sign_filter_lines?: string[];
}

const STRAND_TITLE: Record<StrandId, string> = {
  economic: "Cost & resource use",
  clinical: "Clinical effectiveness",
  hrqol: "HRQoL & utilities",
  epidemiology: "Epidemiology & burden",
};

function escapePipe(value: string): string {
  return value.replace(/\|/g, "\\|");
}

export function formatStrategyMarkdown(
  perStrand: StrandStrategy[],
  opts: { emtreeDraft: boolean },
): string {
  const out: string[] = ["# Search Strategy"];

  for (const strand of perStrand) {
    out.push(`\n## ${STRAND_TITLE[strand.strand]}`);
    const provenanceUrl = strand.provenance.templateUrl ?? strand.provenance.url;
    out.push(
      `*Methodological filter: ${strand.provenance.source} — [source](${strand.provenance.url}) · [SIGN template](${provenanceUrl}). ${strand.provenance.citation}*`,
    );

    if (opts.emtreeDraft) {
      out.push(
        "> **DRAFT — verify in Emtree.** Embase controlled-vocabulary terms are LLM-suggested and must be checked in your licensed Embase session. Embase hit counts are NOT computed here.",
      );
    }

    out.push("\n**Embase** (run in your Embase session for counts):");
    out.push("| # | Query | Embase hits |", "|---|-------|-------------|");
    for (const line of strand.embase_lines) {
      out.push(`| ${line.n} | ${escapePipe(line.query)} | — |`);
    }

    out.push(
      "\n**PubMed / MEDLINE** (real counts via NCBI E-utilities — *not Embase*):",
    );
    out.push("| # | Query | PubMed hits |", "|---|-------|-------------|");
    for (const line of strand.pubmed_lines) {
      out.push(
        `| ${line.n} | ${escapePipe(line.query)} | ${line.count ?? "n/a"} |`,
      );
    }

    if (strand.sign_filter_lines?.length) {
      out.push("\n**Full SIGN methodological filter (Ovid syntax, reference):**");
      out.push("```");
      strand.sign_filter_lines.forEach((line, index) => {
        out.push(`${index + 1}. ${line}`);
      });
      out.push("```");
    }
  }

  return out.join("\n");
}