# Fixtures

## `iqwig-ga23-02-ground-truth.json`

Ground-truth scaffold for the **confounder_identification** regression benchmark
(Design log #43), modelled on the **IQWiG GA23-02** assessment
(dimethyl fumarate vs glatiramer acetate in relapsing-remitting MS) and the
confounder-identification workflow of **Pufulete et al. 2022** (commissioned by
IQWiG).

Shape (per the PHAROS/Regulaido ISPOR 2026 comparative study):

| Field | Count | Meaning |
|---|---|---|
| `individual_variables` | 132 | granular variables extracted from the literature |
| `consolidated_confounders` | 26 | the consolidated confounder set (Pufulete Step 2) |
| `unmeasurable_expert_only` | 2 | confounders obtainable only by expert interview (Step 3) |

### ⚠️ Provenance caveat

The variable **wordings** here are an **illustrative reconstruction** designed to
exercise the tool's consolidation + provenance logic — they are **NOT** a verbatim
transcription of the IQWiG working paper. Before using this file as an audited
ground truth, replace `individual_variables` / `consolidated_confounders` with the
verbatim list from the primary sources below and re-run with `RUN_BENCHMARK=1`.

### Primary sources (verify before audit use)

- IQWiG GA23-02 project page (Allgemeine Methoden / Rapid Report series):
  https://www.iqwig.de/en/ — search "GA23-02".
- Pufulete M, et al. *Confounder identification for non-randomised studies*
  (IQWiG-commissioned methods work, 2022). Verify the exact citation/DOI on
  PubMed before relying on it.
- PHAROS Labs / Regulaido ISPOR 2026 poster (the comparative study this
  benchmark mirrors) — request the source data from the authors for the verbatim
  132 → 26 mapping.

The benchmark test (`tests/benchmarks/confounderGa2302.test.ts`) runs a
**mock 5-paper corpus** in CI (offline). A full live-corpus run is gated behind
`RUN_BENCHMARK=1`.
