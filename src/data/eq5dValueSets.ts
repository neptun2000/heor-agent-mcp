/**
 * EQ-5D Value Set Reference Data
 *
 * Static reference data for the four value sets currently relevant to UK HTA submissions.
 * Sources: EuroQol Group (euroqol.org) — value-set registry; Devlin et al. 2018
 * Health Economics (England 5L); Dolan 1997 Medical Care (UK 3L MVH);
 * Hernández Alava et al. 2022 NICE DSU (3L→5L mapping algorithm);
 * NICE ECD16 position statement; OHE publications (ohe.org).
 *
 * Impact estimates from:
 *   Biz A.N., Hernández Alava M., Wailoo A. (2026). Switching from EQ-5D-3L to EQ-5D-5L
 *   in England: the impact in NICE technology appraisals. Value in Health (forthcoming).
 *
 * This data is PUBLIC knowledge about value sets — not derivative of the EQ-5D instrument
 * itself (which is EuroQol trademark).
 */

export type ValueSetId = "uk_3l" | "england_5l" | "uk_5l_new" | "dsu_mapping";

export interface ValueSet {
  id: ValueSetId;
  name: string;
  country: string;
  version: "3L" | "5L" | "mapped_3L";
  valuation_year: number;
  publication_year: number;
  protocol: string;
  methods: string[];
  n_respondents: number;
  n_states_valued: number;
  full_health_value: number;
  mildest_slight_state: number | null;
  moderate_state_value: number;
  worst_state_value: number;
  pct_states_worse_than_dead: number;
  dimension_weights: {
    mobility: number;
    self_care: number;
    usual_activities: number;
    pain_discomfort: number;
    anxiety_depression: number;
  };
  nice_status:
    | "current"
    | "superseded"
    | "consultation"
    | "interim"
    | "rejected";
  reference_url: string;
  notes: string;
}

export const EQ5D_VALUE_SETS: ValueSet[] = [
  {
    id: "uk_3l",
    name: "UK EQ-5D-3L (MVH)",
    country: "United Kingdom",
    version: "3L",
    valuation_year: 1993,
    publication_year: 1997,
    protocol: "Measurement and Valuation of Health (MVH)",
    methods: ["TTO"],
    n_respondents: 2997,
    n_states_valued: 45,
    full_health_value: 1.0,
    mildest_slight_state: null, // 3L has no "slight" level
    moderate_state_value: 0.516, // state 22222
    worst_state_value: -0.594, // state 33333
    pct_states_worse_than_dead: 34.6,
    dimension_weights: {
      mobility: 25.2,
      self_care: 17.2,
      usual_activities: 7.6,
      pain_discomfort: 31.0,
      anxiety_depression: 19.0,
    },
    nice_status: "current",
    reference_url: "https://doi.org/10.1097/00005650-199711000-00002",
    notes:
      "Dolan 1997. Wide range (−0.594 to 1), bimodal distribution, 34.6% of states worse than dead. Current NICE-recommended set pending 2026 5L adoption.",
  },
  {
    id: "england_5l",
    name: "England EQ-5D-5L (Devlin)",
    country: "England",
    version: "5L",
    valuation_year: 2012,
    publication_year: 2018,
    protocol: "EQ-VT v1.0",
    methods: ["cTTO", "DCE"],
    n_respondents: 996,
    n_states_valued: 86,
    full_health_value: 1.0,
    mildest_slight_state: 0.95, // state 11211 / 12111
    moderate_state_value: 0.593, // state 33333
    worst_state_value: -0.285, // state 55555
    pct_states_worse_than_dead: 5.1,
    dimension_weights: {
      mobility: 21.3,
      self_care: 15.8,
      usual_activities: 14.3,
      pain_discomfort: 26.1,
      anxiety_depression: 22.5,
    },
    nice_status: "rejected",
    reference_url: "https://doi.org/10.1002/hec.3564",
    notes:
      "Devlin et al. 2018. Independent QA review flagged data and methods concerns; NICE did not adopt. Narrower range than UK 3L, only 5.1% of states worse than dead.",
  },
  {
    id: "dsu_mapping",
    name: "UK 3L via NICE DSU Mapping",
    country: "United Kingdom",
    version: "mapped_3L",
    valuation_year: 2022,
    publication_year: 2022,
    protocol: "NICE DSU Mapping Algorithm (Hernández Alava 2022)",
    methods: ["bespoke mixture copula (5L responses → 3L utilities)"],
    n_respondents: 3551,
    n_states_valued: 3125, // all 5L states mapped
    full_health_value: 0.985, // reference: female aged 40
    mildest_slight_state: 0.932,
    moderate_state_value: 0.424, // state 33333 mapped
    worst_state_value: -0.524, // state 55555 mapped
    pct_states_worse_than_dead: 20.6,
    dimension_weights: {
      // DSU mapping is not a direct 5L value set — dimension weights are not reported
      // at the instrument-level; use UK 3L weights as baseline.
      mobility: 25.2,
      self_care: 17.2,
      usual_activities: 7.6,
      pain_discomfort: 31.0,
      anxiety_depression: 19.0,
    },
    nice_status: "interim",
    reference_url: "https://www.sheffield.ac.uk/nice-dsu/tsds",
    notes:
      "Hernández Alava et al. 2022. Interim NICE recommendation since 2022 — maps EQ-5D-5L responses to UK 3L utility space. Reference person is female aged 40. Being superseded by the new direct UK 5L value set (2026).",
  },
  {
    id: "uk_5l_new",
    name: "UK EQ-5D-5L (NEW 2026)",
    country: "United Kingdom",
    version: "5L",
    valuation_year: 2023,
    publication_year: 2026,
    protocol: "EQ-VT v2.1",
    methods: ["cTTO"],
    n_respondents: 1200,
    n_states_valued: 102,
    full_health_value: 1.0,
    mildest_slight_state: 0.968, // state 21111
    moderate_state_value: 0.604, // state 33333
    worst_state_value: -0.567, // state 55555
    pct_states_worse_than_dead: 14.7,
    dimension_weights: {
      mobility: 17.8, // ↓ vs UK 3L
      self_care: 13.1, // ↓ vs UK 3L
      usual_activities: 13.5, // ↑ vs UK 3L
      pain_discomfort: 30.6,
      anxiety_depression: 25.0, // ↑ vs UK 3L
    },
    nice_status: "consultation",
    reference_url: "https://www.nice.org.uk/corporate/ecd16",
    notes:
      "NICE consultation 2026-04-15 to 2026-05-13. Similar range to UK 3L but symmetric distribution (not bimodal). Mild–moderate states have more compressed utilities. Usual activities and anxiety/depression relatively more important; mobility and self-care relatively less.",
  },
];

export type IndicationType =
  | "cancer_life_extending"
  | "non_cancer_life_extending"
  | "non_cancer_qol_only";

export interface ImpactEstimate {
  indication_type: IndicationType;
  median_qaly_change_pct: number; // e.g. +13.7 or -37
  median_icer_change_pct: number; // e.g. -12 or +59
  direction: "more_cost_effective" | "less_cost_effective" | "mixed";
  examples: string[];
  caveat: string;
}

/**
 * Anticipated impact of switching UK 3L (via DSU mapping) → new UK 5L value set.
 * Source: Biz, Hernández Alava, Wailoo (2026) — 39 decisions across 37 NICE TAs.
 */
export const BIZ_2026_IMPACT: ImpactEstimate[] = [
  {
    indication_type: "cancer_life_extending",
    median_qaly_change_pct: 13.7,
    median_icer_change_pct: -12,
    direction: "more_cost_effective",
    examples: ["Oncology medicines with life-extending effect"],
    caveat:
      "Driven by higher utility values for severe states under the new 5L set — larger QALY gains in end-of-life phases.",
  },
  {
    indication_type: "non_cancer_life_extending",
    median_qaly_change_pct: 0,
    median_icer_change_pct: -9.6,
    direction: "mixed",
    examples: ["Heterogeneous — 7 of 11 cases saw ICER decrease"],
    caveat:
      "Results were mixed; in most cases (7 of 11) ICERs decreased, with a median reduction of 9.6% across the category.",
  },
  {
    indication_type: "non_cancer_qol_only",
    median_qaly_change_pct: -37,
    median_icer_change_pct: 59,
    direction: "less_cost_effective",
    examples: [
      "Migraine",
      "Ulcerative colitis",
      "Atopic dermatitis",
      "Hidradenitis suppurativa",
      "Plaque psoriasis",
    ],
    caveat:
      "The new 5L set has compressed utility values in mild–moderate health states — the range patients typically occupy for chronic QoL-only conditions. This shrinks incremental QALY gains and raises ICERs sharply. Consider requesting NICE flexibilities (non-EQ-5D evidence where instrument is demonstrably inappropriate).",
  },
];

export function getValueSet(id: ValueSetId): ValueSet | undefined {
  return EQ5D_VALUE_SETS.find((v) => v.id === id);
}

export function getImpactEstimate(
  indication: IndicationType,
): ImpactEstimate | undefined {
  return BIZ_2026_IMPACT.find((i) => i.indication_type === indication);
}
