/**
 * Country profiles for the EU JCA PICO matrix analyzer (design log #13).
 * Source of truth: latest available G-BA / HAS / AIFA / RedETS /
 * Zorginstituut / NICE clinical-practice and HTA recommendations as of
 * Q2 2026.
 *
 * Comparator lookups are coarse — molecule name + 1-line rationale only.
 * Bumped via JCA_REVISION when EUnetHTA publishes new methodological
 * guidance or country preferences change materially.
 */
import type {
  ComparatorEntry,
  CountryProfile,
  DrugClass,
  IndicationCategory,
  Jurisdiction,
  LineOfTherapy,
  OutcomePriority,
} from "./types.js";

export const JCA_REVISION = "2026-05" as const;

function instrumentsFor(category: IndicationCategory): string[] {
  if (category === "oncology_nsclc" || category === "oncology_other") {
    return ["EQ-5D-5L", "EORTC QLQ-C30"];
  }
  if (category === "ibd_uc" || category === "ibd_cd") {
    return ["EQ-5D-5L", "IBDQ-32"];
  }
  if (category === "diabetes_t2" || category === "obesity") {
    return ["EQ-5D-5L", "IWQOL-Lite"];
  }
  return ["EQ-5D-5L"];
}

function oncologyOutcomePriority(): OutcomePriority[] {
  return ["OS", "PFS", "HRQoL", "AE"];
}

function ibdOutcomePriority(): OutcomePriority[] {
  return ["remission", "HRQoL", "AE", "other"];
}

function chronicOutcomePriority(): OutcomePriority[] {
  return ["HRQoL", "remission", "AE", "other"];
}

function hfrefOutcomePriority(): OutcomePriority[] {
  // EuroQol Annex II preference + DAPA-HF / EMPEROR-Reduced primary
  // composite. CV death and HF hospitalization sit at the top of the
  // patient-relevant outcomes hierarchy for HFrEF; HRQoL via KCCQ/EQ-5D
  // is a key secondary.
  return [
    "CV_death",
    "HF_hospitalization",
    "all_cause_mortality",
    "HRQoL",
    "NYHA_progression",
    "AE",
  ];
}

function outcomePriorityFor(category: IndicationCategory): OutcomePriority[] {
  if (category === "oncology_nsclc" || category === "oncology_other") {
    return oncologyOutcomePriority();
  }
  if (category === "ibd_uc" || category === "ibd_cd") {
    return ibdOutcomePriority();
  }
  if (category === "cardiovascular_hfref") {
    return hfrefOutcomePriority();
  }
  return chronicOutcomePriority();
}

function nsclcSecondLineComparators(country: Jurisdiction): ComparatorEntry[] {
  // NSCLC 2L EGFR-mutant: chemo doublet (carboplatin + pemetrexed) is
  // standard everywhere; immunotherapy (pembrolizumab/nivolumab) is the
  // alternative in DE/NL; ramucirumab + erlotinib is more common in IT/ES.
  const instruments = instrumentsFor("oncology_nsclc");
  const chemo: ComparatorEntry = {
    molecule: "carboplatin + pemetrexed",
    rationale: `Chemotherapy doublet — standard 2L NSCLC backbone in ${country.toUpperCase()} per local clinical guidelines.`,
    outcome_instrument_preferences: instruments,
  };
  const io: ComparatorEntry = {
    molecule: "pembrolizumab",
    rationale: `Immunotherapy — frequently considered as comparator for 2L NSCLC where PD-L1 status supports it. Recognised in ${country.toUpperCase()} HTA submissions.`,
    outcome_instrument_preferences: instruments,
  };
  const tki_alt: ComparatorEntry = {
    molecule: "afatinib",
    rationale: `Alternative TKI option in EGFR-mutant 2L; relevant context comparator in ${country.toUpperCase()}.`,
    outcome_instrument_preferences: instruments,
  };
  if (country === "de" || country === "nl") return [chemo, io];
  if (country === "fr") return [chemo, tki_alt];
  if (country === "it" || country === "es") return [chemo, io, tki_alt];
  if (country === "uk") return [chemo, io];
  return [chemo];
}

function ibdUcBiologicComparators(country: Jurisdiction): ComparatorEntry[] {
  const instruments = instrumentsFor("ibd_uc");
  // UC biologics universe (post-2024): vedolizumab, infliximab, ustekinumab,
  // mirikizumab, ozanimod. National HTA preferences vary.
  const ved: ComparatorEntry = {
    molecule: "vedolizumab",
    rationale: `Gut-selective integrin inhibitor — established 1L biologic in ${country.toUpperCase()} for moderate-to-severe UC.`,
    outcome_instrument_preferences: instruments,
  };
  const ifx: ComparatorEntry = {
    molecule: "infliximab",
    rationale: `Anti-TNF — historical UC standard; biosimilar pricing keeps it as a comparator anchor in ${country.toUpperCase()}.`,
    outcome_instrument_preferences: instruments,
  };
  const ust: ComparatorEntry = {
    molecule: "ustekinumab",
    rationale: `IL-12/23 inhibitor — recognised UC biologic option.`,
    outcome_instrument_preferences: instruments,
  };
  const oz: ComparatorEntry = {
    molecule: "ozanimod",
    rationale: `S1P receptor modulator — oral option, increasingly considered in 1L moderate UC.`,
    outcome_instrument_preferences: instruments,
  };
  if (country === "de") return [ved, ifx, ust];
  if (country === "fr") return [ved, ifx, oz];
  if (country === "it" || country === "es") return [ved, ifx, ust, oz];
  if (country === "nl") return [ved, ust];
  if (country === "uk") return [ved, ifx, ust];
  return [ved, ifx];
}

function genericComparators(
  country: Jurisdiction,
  category: IndicationCategory,
): ComparatorEntry[] {
  const instruments = instrumentsFor(category);
  return [
    {
      molecule: "standard of care (country-specific)",
      rationale: `Coarse placeholder — confirm against latest ${country.toUpperCase()} HTA precedents and clinical guidelines.`,
      outcome_instrument_preferences: instruments,
    },
  ];
}

/**
 * Per-country comparator universe for HFrEF. Curated against the dapagliflozin
 * + empagliflozin + sacubitril-valsartan reimbursement landscape (post-TA679,
 * post-TA773, post-TA388). Closes the per-country-depth gap design log #15
 * exposed when Claude.ai's HFrEF dossier had country-specific zVT detail
 * (DE 3 zVT scenarios, FR ASMR vs SMR, NL ARNI-eligible vs ineligible) but
 * HEORAgent's `jca_pico_scope` returned the generic "country-specific SoC"
 * placeholder. See design log #18.
 *
 * Each country has multiple distinct comparator entries reflecting either
 * the zVT structure that body uses (Germany's G-BA defines several zVT
 * scenarios per indication and rates each separately) or the value
 * framework's distinct comparator universes (HAS evaluates SMR against
 * placebo-on-GDMT and ASMR against the in-class active comparator).
 */
function cardiovascularHfrefComparators(
  country: Jurisdiction,
): ComparatorEntry[] {
  const instruments = instrumentsFor("cardiovascular_hfref");

  // Common in-class active comparator across most jurisdictions
  const empa: ComparatorEntry = {
    molecule: "empagliflozin",
    rationale: `In-class SGLT2 inhibitor active comparator (NICE TA773 / EMPEROR-Reduced). ITC via DAPA-HF + EMPEROR-Reduced or Zannad 2020 IPD pooled meta-analysis (Lancet) is the standard route in ${country.toUpperCase()}.`,
    outcome_instrument_preferences: instruments,
  };

  // Common comparator: optimised GDMT placebo (ACEi/ARB + beta-blocker + MRA)
  const gdmtAceI: ComparatorEntry = {
    molecule: "ACEi/ARB-based GDMT (no SGLT2i)",
    rationale: `Optimised standard care: ACE inhibitor or ARB + beta-blocker + MRA, without SGLT2 inhibitor. Represents the trial control arm of DAPA-HF (placebo + GDMT). Used as the SMR / cost-utility anchor.`,
    outcome_instrument_preferences: instruments,
  };

  // ARNI-based GDMT (sacubitril-valsartan replacing ACEi/ARB per ESC 2021)
  const gdmtArni: ComparatorEntry = {
    molecule:
      "ARNI-based GDMT (sacubitril-valsartan + beta-blocker + MRA, no SGLT2i)",
    rationale: `ESC 2021 / NICE TA388-aligned optimised GDMT with ARNI replacing ACEi/ARB. Distinct ${country.toUpperCase()} sub-population: ARNI-eligible patients on optimised therapy without SGLT2i.`,
    outcome_instrument_preferences: instruments,
  };

  if (country === "de") {
    // G-BA / IQWiG: zVT typically defines 2-3 patient-relevant scenarios.
    // For HFrEF + SGLT2i, the canonical zVT split is by background therapy
    // (ACEi/ARB-based vs ARNI-based) and by in-class comparator (empa).
    return [gdmtAceI, gdmtArni, empa];
  }
  if (country === "fr") {
    // HAS: distinguishes SMR (medical service rendered, vs placebo+GDMT)
    // and ASMR (added benefit, vs in-class active comparator).
    return [
      {
        molecule: "ARNI-based GDMT (no SGLT2i) — for SMR",
        rationale: `HAS SMR anchor: optimised standard care including sacubitril-valsartan where appropriate. Reflects DAPA-HF placebo arm + ESC-aligned GDMT.`,
        outcome_instrument_preferences: instruments,
      },
      {
        molecule: "empagliflozin — for ASMR",
        rationale: `HAS ASMR anchor: in-class active comparator. The added benefit (vs Jardiance) drives ASMR rating. ITC via DAPA-HF + EMPEROR-Reduced.`,
        outcome_instrument_preferences: instruments,
      },
    ];
  }
  if (country === "it") {
    // AIFA: innovativeness criteria consider unmet need + clinical benefit
    // + quality of evidence. In-class active comparator features prominently
    // for the "added therapeutic value" assessment.
    return [gdmtAceI, empa];
  }
  if (country === "es") {
    // AEMPS / RedETS IPT: stepwise positioning. Spanish IPT typically describes
    // 1L ACEi/ARB + beta-blocker, 2L MRA, then SGLT2i add-on. Regional
    // (autonomous community) decisions can add restrictions post-IPT.
    return [
      {
        molecule: "ACEi/ARB + beta-blocker + MRA (no SGLT2i, no ARNI)",
        rationale: `Spanish IPT 1L/2L positioning: standard triple therapy without SGLT2i. Reflects the population for which dapagliflozin add-on is being considered.`,
        outcome_instrument_preferences: instruments,
      },
      empa,
      {
        molecule: "sacubitril-valsartan + beta-blocker + MRA",
        rationale: `Sometimes raised by autonomous communities as an alternative anchor given sacubitril-valsartan's established place in Spanish HFrEF therapy.`,
        outcome_instrument_preferences: instruments,
      },
    ];
  }
  if (country === "nl") {
    // ZIN: ARNI-eligible vs ARNI-ineligible/intolerant is a typical
    // sub-population split because the cost-utility differs materially.
    return [
      {
        molecule: "ARNI-based GDMT (no SGLT2i) — ARNI-eligible patients",
        rationale: `ZIN sub-population: patients eligible for and tolerant of sacubitril-valsartan. Anchor uses ARNI in background.`,
        outcome_instrument_preferences: instruments,
      },
      {
        molecule: "ACEi/ARB-based GDMT (no SGLT2i) — ARNI-ineligible patients",
        rationale: `ZIN sub-population: patients ineligible for or intolerant of sacubitril-valsartan. Anchor uses ACEi/ARB in background.`,
        outcome_instrument_preferences: instruments,
      },
      empa,
    ];
  }
  if (country === "uk") {
    // Post-Brexit context only — NICE TA679 already established empagliflozin
    // as a relevant in-class comparator; SoC includes ARNI per NG106.
    return [gdmtArni, empa];
  }
  // eu_other or unknown — degrade gracefully
  return [gdmtAceI, empa];
}

function comparatorsFor(
  country: Jurisdiction,
  category: IndicationCategory,
  drug_class: DrugClass,
  line: LineOfTherapy,
): ComparatorEntry[] {
  if (category === "oncology_nsclc" && line === "second_line") {
    return nsclcSecondLineComparators(country);
  }
  if (category === "ibd_uc") {
    return ibdUcBiologicComparators(country);
  }
  if (category === "cardiovascular_hfref") {
    return cardiovascularHfrefComparators(country);
  }
  // Drug-class-aware fallback for unknown indications
  if (category === "oncology_other" || category === "oncology_nsclc") {
    const instruments = instrumentsFor(category);
    return [
      {
        molecule: "standard chemotherapy doublet",
        rationale: `Default oncology comparator anchor for ${country.toUpperCase()}; refine against the indication's clinical trial protocol.`,
        outcome_instrument_preferences: instruments,
      },
    ];
  }
  void drug_class;
  return genericComparators(country, category);
}

function subgroupsFor(category: IndicationCategory): string[] {
  if (category === "oncology_nsclc") {
    return [
      "EGFR mutation status",
      "PD-L1 TPS (≥50% / 1-49% / <1%)",
      "ECOG performance status (0-1 vs 2)",
      "brain metastases (yes/no)",
    ];
  }
  if (category === "ibd_uc") {
    return [
      "Mayo total score (moderate vs severe)",
      "prior biologic exposure (TNF-experienced vs naive)",
      "extent of colitis (left-sided vs extensive)",
    ];
  }
  if (category === "ibd_cd") {
    return [
      "CDAI (moderate vs severe)",
      "prior biologic exposure",
      "fistulizing vs luminal disease",
    ];
  }
  if (category === "diabetes_t2") {
    return ["baseline HbA1c", "BMI category", "CV risk status"];
  }
  if (category === "obesity") {
    return ["BMI category", "comorbidities (T2D, CV, OSA)"];
  }
  return ["age strata", "comorbidity status"];
}

function profile(jurisdiction: Jurisdiction, hta_body: string): CountryProfile {
  return {
    jurisdiction,
    hta_body,
    comparators: (cat, dc, line) => comparatorsFor(jurisdiction, cat, dc, line),
    population_subgroups: (cat) => subgroupsFor(cat),
  };
}

export const COUNTRY_PROFILES: Record<Jurisdiction, CountryProfile> = {
  de: profile("de", "G-BA / IQWiG"),
  fr: profile("fr", "HAS"),
  it: profile("it", "AIFA"),
  es: profile("es", "AEMPS / RedETS"),
  nl: profile("nl", "Zorginstituut Nederland"),
  uk: profile("uk", "NICE (post-Brexit, context only)"),
  eu_other: {
    jurisdiction: "eu_other",
    hta_body: "Other EU member states — consult national HTA",
    comparators: () => [
      {
        molecule: "consult national HTA body",
        rationale:
          "v1 of jca_pico_scope covers DE/FR/IT/ES/NL + UK only. For other EU member states (BE, AT, SE, DK, FI, PL, CZ, HU, etc.), consult the national HTA body for jurisdiction-specific comparator preferences.",
        outcome_instrument_preferences: ["EQ-5D-5L"],
      },
    ],
    population_subgroups: () => [],
  },
};

/**
 * Coarse classifier mapping a free-text indication to a category.
 * Errs on "other" rather than guessing wrong.
 */
export function classifyIndication(indication: string): IndicationCategory {
  const x = indication.toLowerCase();
  if (
    x.includes("nsclc") ||
    x.includes("non-small cell lung") ||
    x.includes("lung cancer")
  ) {
    return "oncology_nsclc";
  }
  if (
    x.includes("cancer") ||
    x.includes("oncolog") ||
    x.includes("carcinoma") ||
    x.includes("tumour") ||
    x.includes("tumor") ||
    x.includes("myeloma") ||
    x.includes("leukemia") ||
    x.includes("leukaemia") ||
    x.includes("lymphoma")
  ) {
    return "oncology_other";
  }
  // "UC" as a bare token is fine; "uc" as a substring is too broad — it
  // matches mucositis, Duchenne, glaucoma, etc. Use word boundaries.
  if (
    x.includes("ulcerative colitis") ||
    /(^|\s)uc(\s|$)/.test(x) ||
    /(^|\s)u\.c\.(\s|$)/.test(x)
  ) {
    return "ibd_uc";
  }
  if (x.includes("crohn")) return "ibd_cd";
  if (
    x.includes("type 2 diabetes") ||
    x.includes("t2d") ||
    x.includes("diabetes mellitus type 2")
  ) {
    return "diabetes_t2";
  }
  if (x.includes("obesity") || x.includes("overweight")) return "obesity";
  // HFrEF-specific (sub-class of cardiovascular). Detected when any of the
  // common phrasings appear. Match HFrEF before generic cardiovascular so
  // the more-specific category wins. Word boundaries prevent "hfref" from
  // matching "preferred" etc. — but it's also rare enough as a token that
  // a substring match is fine.
  if (
    x.includes("hfref") ||
    x.includes("heart failure with reduced ejection") ||
    x.includes("reduced ejection fraction") ||
    x.includes("heart failure reduced ejection")
  ) {
    return "cardiovascular_hfref";
  }
  if (
    x.includes("cardiovascular") ||
    x.includes("heart failure") ||
    x.includes("hypertension")
  ) {
    return "cardiovascular";
  }
  if (
    x.includes("rheumatoid") ||
    x.includes("psoriatic") ||
    x.includes("ankylosing") ||
    x.includes("lupus")
  ) {
    return "rheumatology";
  }
  if (
    x.includes("multiple sclerosis") ||
    x.includes("alzheimer") ||
    x.includes("parkinson") ||
    x.includes("epilepsy")
  ) {
    return "neurology";
  }
  return "other";
}

export function profileFor(jurisdiction: Jurisdiction): CountryProfile {
  return COUNTRY_PROFILES[jurisdiction];
}

export function outcomePriorityForCategory(
  category: IndicationCategory,
): OutcomePriority[] {
  return outcomePriorityFor(category);
}
