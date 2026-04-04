export interface MetabolicProfile {
  condition: string;
  indicators_found: MetabolicIndicator[];
  comorbidities_mentioned: string[];
  biomarkers_mentioned: string[];
  demographic_notes: string[];
  data_quality: "strong" | "moderate" | "weak";
}

export interface MetabolicIndicator {
  name: string;
  category:
    | "anthropometric"
    | "glycemic"
    | "lipid"
    | "cardiovascular"
    | "renal"
    | "hepatic"
    | "other";
  mentioned_in: number; // count of results mentioning this
}

// Common HEOR metabolic indicators to look for in abstracts
const METABOLIC_INDICATORS: Array<{
  name: string;
  pattern: RegExp;
  category: MetabolicIndicator["category"];
}> = [
  // Anthropometric
  { name: "BMI", pattern: /\bBMI\b|body mass index/i, category: "anthropometric" },
  { name: "Waist circumference", pattern: /waist circumference/i, category: "anthropometric" },
  { name: "Obesity", pattern: /\bobes/i, category: "anthropometric" },
  // Glycemic
  { name: "HbA1c", pattern: /\bHbA1c\b|glycated hemoglobin|glycosylated/i, category: "glycemic" },
  { name: "Fasting glucose", pattern: /fasting (plasma )?glucose|FPG\b/i, category: "glycemic" },
  { name: "HOMA-IR", pattern: /HOMA-IR|insulin resistance/i, category: "glycemic" },
  // Lipid
  { name: "LDL cholesterol", pattern: /\bLDL\b|low-density lipoprotein/i, category: "lipid" },
  { name: "HDL cholesterol", pattern: /\bHDL\b|high-density lipoprotein/i, category: "lipid" },
  { name: "Triglycerides", pattern: /triglyceride/i, category: "lipid" },
  { name: "Total cholesterol", pattern: /total cholesterol/i, category: "lipid" },
  // Cardiovascular
  {
    name: "Blood pressure",
    pattern: /blood pressure|hypertension|systolic|diastolic|SBP\b|DBP\b/i,
    category: "cardiovascular",
  },
  { name: "Heart rate", pattern: /heart rate|pulse rate/i, category: "cardiovascular" },
  { name: "MACE", pattern: /\bMACE\b|major adverse cardiovascular/i, category: "cardiovascular" },
  // Renal
  { name: "eGFR", pattern: /\beGFR\b|estimated glomerular filtration/i, category: "renal" },
  { name: "Creatinine", pattern: /creatinine/i, category: "renal" },
  { name: "UACR", pattern: /\bUACR\b|albumin.creatinine ratio/i, category: "renal" },
  // Hepatic
  { name: "ALT", pattern: /\bALT\b|alanine (amino)?transferase/i, category: "hepatic" },
  { name: "AST", pattern: /\bAST\b|aspartate (amino)?transferase/i, category: "hepatic" },
  {
    name: "NAFLD",
    pattern: /\bNAFLD\b|non.alcoholic fatty liver|NASH\b|MASLD\b|MASH\b/i,
    category: "hepatic",
  },
];

const COMORBIDITIES = [
  { name: "Type 2 diabetes", pattern: /type 2 diabetes|T2DM?\b|T2D\b/i },
  { name: "Hypertension", pattern: /hypertension/i },
  { name: "Dyslipidemia", pattern: /dyslipid/i },
  { name: "Cardiovascular disease", pattern: /cardiovascular disease|CVD\b|coronary artery/i },
  { name: "Chronic kidney disease", pattern: /chronic kidney|CKD\b/i },
  { name: "Heart failure", pattern: /heart failure|HF\b|HFrEF|HFpEF/i },
  { name: "Stroke", pattern: /\bstroke\b|cerebrovascular/i },
  { name: "Depression", pattern: /\bdepression\b|depressive/i },
  { name: "COPD", pattern: /\bCOPD\b|chronic obstructive/i },
  { name: "Metabolic syndrome", pattern: /metabolic syndrome/i },
];

const BIOMARKERS = [
  { name: "CRP / hs-CRP", pattern: /\bCRP\b|C-reactive protein|hs-CRP/i },
  { name: "NT-proBNP", pattern: /NT-proBNP|BNP\b|brain natriuretic/i },
  { name: "Troponin", pattern: /troponin/i },
  { name: "IL-6", pattern: /\bIL-6\b|interleukin.6/i },
  { name: "TNF-α", pattern: /TNF|tumor necrosis factor/i },
  { name: "Adiponectin", pattern: /adiponectin/i },
  { name: "Ferritin", pattern: /ferritin/i },
];

export function analyzeMetabolicProfile(
  results: Array<{ title: string; abstract: string }>,
  condition: string,
): MetabolicProfile {
  const indicatorCounts = new Map<
    string,
    { count: number; category: MetabolicIndicator["category"] }
  >();
  const comorbSet = new Set<string>();
  const biomarkerSet = new Set<string>();
  const demoNotes: string[] = [];

  for (const r of results) {
    const text = `${r.title} ${r.abstract}`;

    // Scan for metabolic indicators
    for (const ind of METABOLIC_INDICATORS) {
      if (ind.pattern.test(text)) {
        const existing = indicatorCounts.get(ind.name);
        if (existing) {
          existing.count++;
        } else {
          indicatorCounts.set(ind.name, { count: 1, category: ind.category });
        }
      }
    }

    // Scan for comorbidities
    for (const c of COMORBIDITIES) {
      if (c.pattern.test(text)) comorbSet.add(c.name);
    }

    // Scan for biomarkers
    for (const b of BIOMARKERS) {
      if (b.pattern.test(text)) biomarkerSet.add(b.name);
    }

    // Extract demographic mentions
    const ageMatch = text.match(/(\d+)\s*[-–]\s*(\d+)\s*years?\s*(old|of age)?/i);
    if (ageMatch) {
      const note = `Age range: ${ageMatch[1]}–${ageMatch[2]} years`;
      if (!demoNotes.includes(note)) demoNotes.push(note);
    }
    if (
      /\bmale\b.*\bfemale\b|\bmen\b.*\bwomen\b/i.test(text) &&
      !demoNotes.some((d) => d.includes("sex"))
    ) {
      demoNotes.push("Both sexes included in study populations");
    }
  }

  const indicators: MetabolicIndicator[] = Array.from(indicatorCounts.entries())
    .map(([name, { count, category }]) => ({ name, category, mentioned_in: count }))
    .sort((a, b) => b.mentioned_in - a.mentioned_in);

  // Data quality based on how many indicators and results
  const quality: MetabolicProfile["data_quality"] =
    indicators.length >= 5 && results.length >= 5
      ? "strong"
      : indicators.length >= 2 || results.length >= 3
        ? "moderate"
        : "weak";

  return {
    condition,
    indicators_found: indicators,
    comorbidities_mentioned: Array.from(comorbSet).sort(),
    biomarkers_mentioned: Array.from(biomarkerSet).sort(),
    demographic_notes: demoNotes,
    data_quality: quality,
  };
}

export function profileToMarkdown(profile: MetabolicProfile): string {
  const lines: string[] = [];
  lines.push(`\n## Population Metabolic Profile: ${profile.condition}`);
  lines.push(`*Data quality: ${profile.data_quality}*\n`);

  if (profile.indicators_found.length > 0) {
    lines.push(`### Metabolic Indicators Identified`);
    lines.push(`| Indicator | Category | Mentioned in N studies |`);
    lines.push(`|-----------|----------|-----------------------|`);
    for (const ind of profile.indicators_found) {
      lines.push(`| ${ind.name} | ${ind.category} | ${ind.mentioned_in} |`);
    }
    lines.push("");
  }

  if (profile.comorbidities_mentioned.length > 0) {
    lines.push(`### Comorbidities Mentioned`);
    profile.comorbidities_mentioned.forEach((c) => lines.push(`- ${c}`));
    lines.push("");
  }

  if (profile.biomarkers_mentioned.length > 0) {
    lines.push(`### Biomarkers Referenced`);
    profile.biomarkers_mentioned.forEach((b) => lines.push(`- ${b}`));
    lines.push("");
  }

  if (profile.demographic_notes.length > 0) {
    lines.push(`### Population Demographics`);
    profile.demographic_notes.forEach((d) => lines.push(`- ${d}`));
    lines.push("");
  }

  if (profile.indicators_found.length === 0) {
    lines.push(
      `*No metabolic indicators identified in the search results. Try a more specific query or request additional data sources (who_gho, all_of_us).*`,
    );
  }

  return lines.join("\n");
}
