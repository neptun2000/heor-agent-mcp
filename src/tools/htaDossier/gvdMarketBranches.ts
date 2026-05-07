/**
 * GVD Section 11 — per-market policy subsection generators.
 * Produces substantive 2–3 paragraph prose for US, UK, EU5, and Japan.
 * v1 depth: one block per market (cross-market GVD scope).
 * Deeper per-payer (US) or per-country (EU5) content is deferred to v1.7.
 */

export interface MarketPathways {
  us: string;
  uk: string;
  eu5: string;
  jp: string;
}

/**
 * Generate per-market HTA policy subsections for GVD Section 11.
 * Content is substantive prose anchored to current methodology (as of 2026).
 */
export function generateMarketPathways(
  drug: string,
  indication: string,
): MarketPathways {
  return {
    us: generateUSBranch(drug, indication),
    uk: generateUKBranch(drug, indication),
    eu5: generateEU5Branch(drug, indication),
    jp: generateJapanBranch(drug, indication),
  };
}

// ─── Private branch generators ───────────────────────────────────────────────

function generateUSBranch(_drug: string, _indication: string): string {
  return `#### 11.1 United States

The primary HTA reference in the US is the **Institute for Clinical and Economic Review (ICER)**, which publishes value-based price benchmarks (typically $100K–$150K/QALY). ICER reviews are non-binding but increasingly used by commercial payers and pharmacy benefit managers (PBMs) for formulary positioning negotiations.

The **Inflation Reduction Act (IRA)** (2022) introduced Medicare drug-price negotiation for high-expenditure products (Part D: first cohort 2026; Part B: first cohort 2028). Products subject to negotiation face government-set Maximum Fair Prices (MFPs). The IRA also introduced inflation rebate penalties and caps Medicare beneficiary out-of-pocket costs at $2,000/year, reshaping the commercial reference environment.

Medicare and commercial market dynamics differ significantly: Medicare Part D requires rebate-negotiated formulary placement; commercial payers use closed formulary tiers with step therapy requirements. Evidence requirements: **AMCP Format 4.1** with Section 5 economic model is the industry standard for dossier submission to commercial payers. AMCP Format 4.1 dossier required — see AMCP tool (v1.7).`;
}

function generateUKBranch(_drug: string, _indication: string): string {
  return `#### 11.2 United Kingdom

**NICE** is the statutory HTA body for England. The standard cost-effectiveness threshold is **£20,000–£30,000/QALY**. A severity modifier under PMG36 (April 2022) extends the threshold up to £35,000/QALY for conditions with absolute QALY shortfall ≥12 QALYs or proportional QALY shortfall ≥85%. End-of-life criteria (≥24 months life expectancy gain) apply to certain oncology submissions and may further increase the acceptable ICER range.

The submission route is Single Technology Appraisal (STA) for single technologies; Multiple Technology Appraisal (MTA) for multiple comparators. NICE requires **validated EQ-5D utility values** — cross-walked from disease-specific instruments only where no direct EQ-5D data exist. **Note (2026):** NICE is consulting on adopting the new UK EQ-5D-5L value set (Biz et al. 2026, _Value in Health_ forthcoming), replacing the interim DSU 3L→5L mapping algorithm. Flag this transition in the economic model, as QALY estimates may shift.

The **Scottish Medicines Consortium (SMC)** provides a separate submission pathway for Scotland; the **All Wales Medicines Strategy Group (AWMSG)** covers Wales. Both require submission after or alongside the NICE process.`;
}

function generateEU5Branch(_drug: string, _indication: string): string {
  return `#### 11.3 EU5 (Germany, France, Italy, Spain, Netherlands)

The **EU Joint Clinical Assessment (JCA)** under Reg. (EU) 2021/2282 is being phased in: oncology and advanced therapy medicinal products (2025), orphan medicines (2028), all remaining new medicines (2030). JCA produces a clinical assessment report used by national HTA bodies as the evidence base for their benefit/risk evaluation; pricing and reimbursement decisions remain national competency.

Country-specific pathways: **Germany (G-BA/IQWiG)** — AMNOG early benefit assessment; added benefit vs. appropriate comparator (zweckmäßige Vergleichstherapie, zVT) determines price negotiations with GKV-Spitzenverband. **France (HAS/CT)** — SMR (clinical benefit) and ASMR (incremental benefit, I–V scale) ratings; ASMR I–III enable higher price negotiation leverage. **Italy (AIFA)** — therapeutic innovation scoring (Class A/H reimbursement) and comparative clinical benefit vs. standard of care. **Spain (AEMPS + RedETS)** — GENESIS reports prepared by hospital pharmacists for regional formulary access. **Netherlands (ZIN/Zorginstituut)** — pakketadvies; conditional reimbursement (voorwaardelijke toelating) available for uncertain evidence.

Evidence requirements vary: Germany requires direct head-to-head RCTs vs. zVT wherever feasible; France and Netherlands accept indirect comparisons with explicit methodological justification and uncertainty quantification.`;
}

function generateJapanBranch(_drug: string, _indication: string): string {
  return `#### 11.4 Japan

The **Center for Outcomes Research and Economic Evaluation for Health (C2H)** conducts cost-effectiveness assessments under **Chuikyo** (Central Social Insurance Medical Council) direction. Cost-effectiveness assessment is **supplementary** to the drug pricing negotiation process — it does not gate reimbursement but may result in a price adjustment (re-pricing) post-listing for products meeting the cost-effectiveness assessment trigger criteria (typically annual sales ≥¥10 billion or ≥¥15 billion for a given indication).

The threshold is approximately **¥5 million/QALY**, scaled for indication severity and innovation level via the severity modifier and innovativeness multiplier (each up to 1.5×). Japan-specific utility values are preferred; EQ-5D-3L or EQ-5D-5L norms from Japanese general population studies should be applied. If no Japan-specific utility data exist, document the mapping approach and sensitivity analysis.

Orphan designations in Japan (指定難病, shitei nanbyo) may qualify for special pricing considerations. The **JPMA** (Japan Pharmaceutical Manufacturers Association) GVD structure alignment is encouraged for pharma companies operating in Japan. Launch sequencing strategy should account for the Japan Pharmaceutical Affairs Law approval timeline vs. Chuikyo listing, which typically adds 60–90 days post-approval.`;
}
