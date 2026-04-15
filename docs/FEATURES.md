# HEORAgent MCP Server — Features

## Tools (11)

| Feature Name | What | Why | How |
|-------------|------|-----|-----|
| **Literature Search** | Search 41 data sources for evidence on a drug or indication with PRISMA-style audit trail | Every HTA submission starts with a systematic literature review — automating this across 41 sources saves weeks of manual work | PubMed, ClinicalTrials.gov, bioRxiv, ChEMBL, Embase, Cochrane, NICE, CADTH, ICER, PBAC, G-BA, and 30+ more. Multi-run stability search with deduplication. Source selection transparency table. |
| **Cost-Effectiveness Model** | Build Markov / PartSA cost-utility analysis with PSA, OWSA, CEAC, EVPI, and scenario analysis | Payers and HTA bodies require cost-effectiveness evidence to make reimbursement decisions — ICER per QALY is the universal metric | 3-state Markov (On-Treatment/Off-Treatment/Dead) or PartSA (PFS/PD/Dead). Half-cycle correction, 3.5% discounting (NICE reference case). Monte Carlo PSA up to 10K iterations. Scenario analysis with named parameter overrides. |
| **Budget Impact Model** | Estimate year-by-year net budget impact of adopting a new intervention over 1-10 years | Every HTA submission requires a BIA alongside CEA — NICE, CADTH, PBAC all mandate it to assess affordability | ISPOR BIA good practice (Mauskopf 2007, Sullivan 2014). Market share uptake curves, treatment displacement, population growth, per-patient cost breakdown. |
| **HTA Dossier Prep** | Structure evidence into HTA body-specific submission format with gap analysis and auto-GRADE | HTA bodies have strict template requirements — wrong format means rejection or delay. GRADE is mandated by JCA and used by NICE. | Templates for NICE STA, EMA, FDA, IQWiG, HAS, EU JCA. Per-PICO sections for JCA (Reg. 2021/2282). Auto-generates GRADE evidence quality table from literature results. |
| **Evidence Network** | Analyze literature results to build treatment comparison network and assess NMA feasibility | Before running an NMA, you need to know if the evidence network is connected and sufficient — this tool answers that question | Regex-based extraction of intervention-comparator pairs. Union-Find connectivity analysis. Feasibility assessment (node count, edge count, gaps). |
| **Indirect Comparison** | Compute indirect treatment comparisons using Bucher method or frequentist NMA | When no head-to-head trial exists, indirect comparisons are the only way to compare treatments — required by all HTA bodies | Bucher (single common comparator) or weighted least squares NMA (full network). Supports MD, OR, RR, HR. Auto-selects method based on network structure. |
| **Population-Adjusted Comparison** | MAIC / STC for population-adjusted indirect comparisons when trial populations differ | Standard ITC (Bucher/NMA) assumes similar populations — MAIC/STC adjusts for this, increasingly required by NICE and EMA | MAIC: propensity score reweighting with ESS reporting. STC: outcome regression adjustment. Summary-level data (no IPD required). Follows NICE DSU TSD 18. |
| **Project Create** | Initialize a persistent project workspace with structured directories | HEOR projects span weeks/months — a workspace keeps literature, models, and dossiers organized across sessions | Creates ~/.heor-agent/projects/{id}/ with raw/literature/, raw/models/, raw/dossiers/, wiki/ directories. |
| **Knowledge Search** | Full-text search across a project's raw data and wiki | Quickly find previously saved evidence without re-running searches | Multi-term OR matching across raw/ and wiki/ directories. |
| **Knowledge Read** | Read any file from a project's knowledge base | Access previously saved literature results, model outputs, or wiki notes | Reads from project raw/ or wiki/ tree. |
| **Knowledge Write** | Write compiled evidence to the project wiki | Organize and synthesize findings into a structured knowledge base | Writes to wiki/ directory only. Supports YAML frontmatter and Obsidian-style [[wikilinks]]. |

## Data Sources (41)

| Category | Sources |
|----------|---------|
| **Biomedical** | PubMed, ClinicalTrials.gov, bioRxiv/medRxiv, ChEMBL |
| **Epidemiology** | WHO GHO, World Bank, OECD Health, IHME GBD, All of Us |
| **FDA Regulatory** | Orange Book, Purple Book |
| **Enterprise** | Embase, ScienceDirect, Cochrane, Citeline, Pharmapendium, Cortellis, Google Scholar |
| **HTA Cost References** | CMS NADAC, PSSRU, NHS National Cost Collection, BNF, PBS Schedule |
| **HTA Appraisals** | NICE TAs, CADTH/CDA-AMC, ICER, PBAC, G-BA AMNOG, HAS, IQWiG, AIFA, TLV, INESSS, ISPOR |
| **LATAM** | DATASUS, CONITEC, ANVISA, PAHO, IETS, FONASA |
| **APAC** | HITAP |

## Indirect Comparison Methods

| Method | When Used | Reference |
|--------|-----------|-----------|
| Bucher | Single common comparator (A-B-C) | Bucher 1997 |
| Frequentist NMA | Connected network (3+ treatments) | Weighted least squares |
| MAIC | Population mismatch, summary data available | Signorovitch 2010, NICE DSU TSD 18 |
| STC | Fewer effect modifiers, simpler adjustment | NICE DSU TSD 18 |
