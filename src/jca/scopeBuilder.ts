/**
 * Pure scope-builder logic for jca_pico_scope. Given a normalised input,
 * returns a fully-populated PicoMatrix without any I/O. See design log #13.
 */
import {
  classifyIndication,
  JCA_REVISION,
  outcomePriorityForCategory,
  profileFor,
} from "./countryRegistry.js";
import type {
  DrugClass,
  Jurisdiction,
  LineOfTherapy,
  PicoMatrix,
} from "./types.js";

export interface ScopeBuilderInput {
  drug: string;
  indication: string;
  drug_class: DrugClass;
  mechanism_of_action?: string;
  line_of_therapy: LineOfTherapy;
  biomarker_status?: string;
  jurisdictions: Jurisdiction[];
  regulatory_context:
    | "pre_authorisation"
    | "post_authorisation"
    | "conditional_approval";
}

export function buildScope(input: ScopeBuilderInput): PicoMatrix {
  const category = classifyIndication(input.indication);

  const country_specific = input.jurisdictions.map((j) => {
    const p = profileFor(j);
    const comparators = p.comparators(
      category,
      input.drug_class,
      input.line_of_therapy,
    );
    return {
      jurisdiction: j,
      hta_body: p.hta_body,
      comparators,
      population_subgroups: p.population_subgroups(category),
      outcome_priorities: outcomePriorityForCategory(category),
    };
  });

  const distinctMolecules = new Set<string>();
  for (const c of country_specific) {
    for (const cmp of c.comparators) distinctMolecules.add(cmp.molecule);
  }
  const distinct_comparator_count = distinctMolecules.size;
  const heterogeneity_warning =
    input.jurisdictions.length > 1 && distinct_comparator_count >= 3;

  const picos = buildPicos(input, country_specific);

  const rationale = buildRationale(input, category, distinct_comparator_count);

  return {
    drug: input.drug,
    indication: input.indication,
    indication_category: category,
    jca_revision: JCA_REVISION,
    picos,
    country_specific,
    heterogeneity_warning,
    distinct_comparator_count,
    rationale,
  };
}

function buildPicos(
  input: ScopeBuilderInput,
  country_specific: PicoMatrix["country_specific"],
): PicoMatrix["picos"] {
  const seen = new Set<string>();
  const picos: PicoMatrix["picos"] = [];
  let counter = 1;
  const populationBase = input.biomarker_status
    ? `${input.indication}; biomarker: ${input.biomarker_status}`
    : input.indication;
  for (const country of country_specific) {
    for (const cmp of country.comparators) {
      const key = `${cmp.molecule}::${country.outcome_priorities.join(",")}`;
      if (seen.has(key)) continue;
      seen.add(key);
      picos.push({
        id: `PICO-${counter}`,
        population: populationBase,
        comparator: cmp.molecule,
        outcomes: country.outcome_priorities.map((o) => o.toString()),
      });
      counter += 1;
    }
  }
  if (picos.length === 0) {
    picos.push({
      id: "PICO-1",
      population: populationBase,
      comparator: "standard of care",
      outcomes: ["clinical effectiveness", "HRQoL", "AE"],
    });
  }
  return picos;
}

function buildRationale(
  input: ScopeBuilderInput,
  category: ReturnType<typeof classifyIndication>,
  distinct: number,
): string {
  const parts: string[] = [];
  parts.push(
    `JCA scope for ${input.drug} in ${input.indication} (${category} category) across ${input.jurisdictions.length} jurisdiction(s).`,
  );
  if (input.regulatory_context === "pre_authorisation") {
    parts.push(
      "Anticipatory scope — JCA scope is finalised at marketing authorisation; this output is for protocol-design and pre-MA market access strategy only.",
    );
  }
  if (distinct >= 3) {
    parts.push(
      `Heterogeneity warning: ${distinct} distinct comparator molecules across jurisdictions. Plan for evidence_network + itc_feasibility before estimation.`,
    );
  }
  return parts.join(" ");
}
