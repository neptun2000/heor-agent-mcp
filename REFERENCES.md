# HEORAgent Data Sources & References

Complete catalog of all 39 data sources and reference endpoints used by heor-agent-mcp.

---

## Literature & Evidence Databases

| Source | API/URL | Access | Description |
|--------|---------|--------|-------------|
| **PubMed** | `https://eutils.ncbi.nlm.nih.gov/entrez/eutils` | Free | 35M+ biomedical citations (NLM/NIH). Full abstracts via efetch. |
| **ClinicalTrials.gov** | `https://clinicaltrials.gov/api/v2/studies` | Free | FDA-regulated clinical studies worldwide (NIH/NLM). |
| **bioRxiv / medRxiv** | `https://api.biorxiv.org/details/medrxiv` | Free | Life sciences and medical preprints (Cold Spring Harbor). |
| **ChEMBL** | `https://www.ebi.ac.uk/chembl/api/data` | Free | Drug bioactivity, mechanisms, ADMET properties (EMBL-EBI). |
| **Embase** | `https://api.elsevier.com/content/search/embase` | `ELSEVIER_API_KEY` | 8,500+ journals + conference abstracts (Elsevier). Required by NICE/Cochrane for SRs. |
| **Cochrane** | `https://api.wiley.com/onlinelibrary/tdm/v1/articles` | `COCHRANE_API_KEY` or proxy | Systematic reviews, GRADE assessments (Wiley). Gold standard for evidence synthesis. |
| **Google Scholar** | `https://serpapi.com/search` | `SERPAPI_KEY` | Grey literature, theses, conference proceedings (via SerpAPI). |
| **ISPOR** | `https://www.ispor.org/heor-resources/presentations-database` | Free (reference) | 30,000+ HEOR conference abstracts and posters. |

## Epidemiology & Population Data

| Source | API/URL | Access | Description |
|--------|---------|--------|-------------|
| **WHO GHO** | `https://ghoapi.who.int/api` | Free | Global health indicators: mortality, disease prevalence, health expenditure (WHO). |
| **World Bank** | `https://api.worldbank.org/v2` | Free | GDP/capita, population, life expectancy, demographics across 200+ countries. |
| **OECD Health** | `https://stats.oecd.org/SDMX-JSON/data` | Free | Health expenditure, hospital beds, physicians, obesity rates (OECD member countries). |
| **IHME / GBD** | `https://vizhub.healthdata.org/gbd-results/` | Free (reference) | Global Burden of Disease: DALYs, YLLs, prevalence across 369 diseases, 204 countries. |
| **All of Us** | `https://databrowser.researchallofus.org/api/v1/databrowser` | Free | NIH precision medicine cohort: 800K+ participants, EHR + genomics + surveys. |

## Regulatory & Drug Pricing

| Source | API/URL | Access | Description |
|--------|---------|--------|-------------|
| **FDA Orange Book** | `https://api.fda.gov/drug/drugsfda.json` | Free | Drug approvals, patents, therapeutic equivalence (TE) codes. |
| **FDA Purple Book** | `https://api.fda.gov/drug/label.json` (BLA filter) | Free | Licensed biologics, biosimilars, reference products. |
| **CMS NADAC** | `https://data.cms.gov/data-api/v1/dataset` | Free | US National Average Drug Acquisition Costs (weekly updated). |
| **BNF** | `https://bnf.nice.org.uk/search/` | Free (reference) | UK drug pricing, dosing, indications (BMJ/RPS). |
| **NHS Drug Tariff** | `https://www.nhsbsa.nhs.uk/.../drug-tariff` | Free (reference) | UK community pharmacy reimbursement prices. |
| **emc (UK)** | `https://www.medicines.org.uk/emc/search` | Free (reference) | UK SmPC and PILs for licensed medicines. |
| **PBS Schedule** | `https://www.pbs.gov.au/search/` | Free (reference) | Australian drug subsidy scheme prices and restrictions. |
| **MBS Online** | `http://www9.health.gov.au/mbs/search.cfm` | Free (reference) | Australian Medicare Benefits Schedule (medical service fees). |
| **ANVISA / CMED** | `https://www.gov.br/anvisa/.../cmed/precos` | Free (reference) | Brazilian government maximum drug prices. |

## HTA Cost References

| Source | API/URL | Access | Description |
|--------|---------|--------|-------------|
| **PSSRU Unit Costs** | `https://www.pssru.ac.uk/unitcostsreport/` | Free (reference) | UK definitive reference for staff, hospital, community care costs. Used by NICE. |
| **NHS National Cost Collection** | `https://www.england.nhs.uk/costing-in-the-nhs/national-cost-collection/` | Free (reference) | UK hospital costs per HRG (~17M patient records/year). |
| **NHS Payment Scheme** | `https://www.england.nhs.uk/pay-syst/nhs-payment-scheme/` | Free (reference) | UK tariff prices (commissioners pay for NHS services). |
| **AIHW Health Expenditure** | `https://www.aihw.gov.au/.../health-expenditure` | Free (reference) | Australian health expenditure data (annual). |

## HTA Appraisals & Guidance

| Source | API/URL | Access | Description |
|--------|---------|--------|-------------|
| **NICE Technology Appraisals** | `https://www.nice.org.uk/search` | Free (reference) | UK HTA decisions with ERG reports, committee papers, FADs. |
| **NICE Methods Guide** | `https://www.nice.org.uk/process/pmg36` | Free (reference) | NICE reference case methodology (PMG36). |
| **CADTH CDR / pCODR** | `https://www.cadth.ca/reimbursement-reviews-search` | Free (reference) | Canadian drug reimbursement reviews. |
| **ICER Reports** | `https://icer.org/` | Free (reference) | US value assessments with health-benefit price benchmarks. |
| **PBAC PSD** | `https://www.pbs.gov.au/.../pbac-meetings/psd` | Free (reference) | Australian HTA public summary documents. |
| **G-BA / AMNOG** | `https://www.g-ba.de/bewertungsverfahren/nutzenbewertung/` | Free (reference) | German benefit assessments (Federal Joint Committee). |
| **IQWiG** | `https://www.iqwig.de/en/projects/` | Free (reference) | German HTA reports and methods (v7.0). |
| **HAS (France)** | `https://www.has-sante.fr/.../transparency-committee` | Free (reference) | French HTA opinions + economic evaluation methodology. |
| **CEPS (France)** | `https://solidarites-sante.gouv.fr/.../ceps/` | Free (reference) | French drug pricing authority. |
| **AIFA (Italy)** | `https://www.aifa.gov.it/en/prezzi-e-rimborso` | Free (reference) | Italian HTA, pricing, and national formulary. |
| **TLV (Sweden)** | `https://www.tlv.se/in-english/` | Free (reference) | Swedish HTA decisions and value-based pricing guidelines. |
| **INESSS (Quebec)** | `https://www.inesss.qc.ca/en/search.html` | Free (reference) | Quebec provincial HTA agency reports. |
| **CONITEC (Brazil)** | `https://www.gov.br/conitec/.../tecnologias-avaliadas/busca` | Free (reference) | Brazilian HTA decisions for SUS. |
| **IETS (Colombia)** | `https://www.iets.org.co/Paginas/busqueda.aspx` | Free (reference) | Colombian HTA agency reports. |
| **HITAP (Thailand)** | `https://www.hitap.net/en/` | Free (reference) | Thai HTA agency and iDSI APAC network. |

## LATAM & Regional Sources

| Source | API/URL | Access | Description |
|--------|---------|--------|-------------|
| **DATASUS** | `http://tabnet.datasus.gov.br/` | Free | Brazilian SUS hospital/ambulatory data (SIH/SUS, SIA/SUS). |
| **PAHO Open Data** | `https://opendata.paho.org/en/catalog` | Free (reference) | Pan American Health Organization: 115+ indicators, 49 countries. |
| **FONASA (Chile)** | `https://www.fonasa.cl/.../estadisticas` | Free (reference) | Chilean public health insurance utilization data. |
| **DEIS (Chile)** | `https://deis.minsal.cl/` | Free (reference) | Chilean mortality and morbidity statistics. |

## Enterprise Sources (via proxy)

| Source | API/URL | Access | Description |
|--------|---------|--------|-------------|
| **Citeline TrialTrove** | `https://api.citeline.com/trialtrove/v1/trials` | `CITELINE_API_KEY` or proxy | Comprehensive global trial intelligence (180+ therapy areas). |
| **Pharmapendium** | `https://api.elsevier.com/content/pharmapendium/search` | `PHARMAPENDIUM_API_KEY` or proxy | Preclinical/clinical/post-marketing safety across regulatory filings (Elsevier). |
| **Cortellis CI** | `https://api.cortellis.com/v2/search/ci` | `CORTELLIS_API_KEY` or proxy | Drug pipeline, consensus forecasts, competitive intelligence (Clarivate). |

---

*Last updated: 2026-04-06. 39 data sources across 25 countries and 6 continents.*
