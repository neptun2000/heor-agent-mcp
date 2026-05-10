/**
 * Best-effort parser for label population text.
 *
 * Extracts { age_min_years, age_max_years, weight_constraint_kg, sex_constraint }
 * from verbatim label text like:
 *   "pediatric patients aged 6 to 17 years weighing 45 kg or more"
 *
 * All fields are nullable — unparseable text returns all nulls.
 * The caller always retains the verbatim population text.
 */

import type { PopulationParsed } from "./types.js";

export function parseAgeRange(text: string): PopulationParsed {
  const result: PopulationParsed = {
    age_min_years: null,
    age_max_years: null,
    weight_constraint_kg: null,
    sex_constraint: null,
  };

  if (!text || typeof text !== "string") return result;

  const lower = text.toLowerCase();

  // Sex constraint detection
  if (/\b(females?|women|woman|premenopausal|postmenopausal)\b/.test(lower)) {
    result.sex_constraint = "female_only";
  } else if (/\b(males?|men|man)\b/.test(lower)) {
    result.sex_constraint = "male_only";
  }

  // Age range: "aged X to Y years" or "X to Y years"
  const rangeMatch = text.match(/(?:aged?\s+)?(\d+)\s+to\s+(\d+)\s+years?/i);
  if (rangeMatch) {
    result.age_min_years = parseInt(rangeMatch[1], 10);
    result.age_max_years = parseInt(rangeMatch[2], 10);
    return _extractWeight(result, text);
  }

  // Minimum age patterns:
  // "18 years of age or older"
  // "6 years of age and older"
  // "≥12 years" or ">= 12 years"
  // "at least 12 years"
  // "12 years and older"
  const minAgePatterns = [
    /(?:aged?\s+)?(\d+)\s+years?\s+(?:of\s+age\s+)?(?:and|or)\s+older/i,
    /(?:aged?\s+)?(\d+)\s+years?\s+(?:of\s+age\s+)?(?:and|or)\s+above/i,
    /(?:at\s+least\s+)?[≥>=]+\s*(\d+)\s+years?/i,
    /patients?\s+(\d+)\s+years?\s+of\s+age\s+or\s+older/i,
    /(?:adults?\s+)?\((\d+)\s+years?\s+and\s+older\)/i,
    /(?:at\s+least\s+)(\d+)\s+years?\s+of\s+age/i,
    /(?:aged?\s+)(\d+)\s+years?\s+(?:and\s+)?(?:and\s+)?older/i,
    /\b(\d+)\s+years?\s+of\s+age\s+(?:and|or)\s+older/i,
  ];

  for (const pattern of minAgePatterns) {
    const m = text.match(pattern);
    if (m) {
      result.age_min_years = parseInt(m[1], 10);
      return _extractWeight(result, text);
    }
  }

  return _extractWeight(result, text);
}

function _extractWeight(
  result: PopulationParsed,
  text: string,
): PopulationParsed {
  // Weight patterns: "weighing 45 kg or more", "at least 30 kg body weight",
  //   "body weight ≥ 45 kg"
  const weightPatterns = [
    /weighing\s+(\d+(?:\.\d+)?)\s*kg/i,
    /at\s+least\s+(\d+(?:\.\d+)?)\s*kg/i,
    /[≥>=]+\s*(\d+(?:\.\d+)?)\s*kg/i,
    /(\d+(?:\.\d+)?)\s*kg\s+or\s+(?:more|greater)/i,
  ];

  for (const pattern of weightPatterns) {
    const m = text.match(pattern);
    if (m) {
      result.weight_constraint_kg = parseFloat(m[1]);
      break;
    }
  }

  return result;
}
