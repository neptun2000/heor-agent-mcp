/**
 * Tests for ageRangeParser — best-effort parser for label population text.
 *
 * Design contract:
 * - Returns { age_min_years, age_max_years, weight_constraint_kg, sex_constraint }
 * - All fields nullable — unparseable text returns all nulls
 * - "female" / "male" sex constraints extracted when present
 */

import { parseAgeRange } from "../../../src/providers/regulatory/ageRangeParser.js";

describe("ageRangeParser — age ranges", () => {
  it("parses 'patients 18 years of age or older'", () => {
    const result = parseAgeRange("patients 18 years of age or older");
    expect(result.age_min_years).toBe(18);
    expect(result.age_max_years).toBeNull();
  });

  it("parses 'pediatric patients aged 6 to 17 years weighing 45 kg or more'", () => {
    const result = parseAgeRange(
      "pediatric patients aged 6 to 17 years weighing 45 kg or more",
    );
    expect(result.age_min_years).toBe(6);
    expect(result.age_max_years).toBe(17);
    expect(result.weight_constraint_kg).toBe(45);
  });

  it("parses 'adult and pediatric patients 6 years of age and older'", () => {
    const result = parseAgeRange(
      "adult and pediatric patients 6 years of age and older",
    );
    expect(result.age_min_years).toBe(6);
    expect(result.age_max_years).toBeNull();
  });

  it("parses 'patients 2 years of age and older'", () => {
    const result = parseAgeRange("patients 2 years of age and older");
    expect(result.age_min_years).toBe(2);
    expect(result.age_max_years).toBeNull();
  });

  it("parses 'adults (18 years and older)'", () => {
    const result = parseAgeRange("adults (18 years and older)");
    expect(result.age_min_years).toBe(18);
    expect(result.age_max_years).toBeNull();
  });

  it("parses age range 'children 2 to 11 years'", () => {
    const result = parseAgeRange("children 2 to 11 years");
    expect(result.age_min_years).toBe(2);
    expect(result.age_max_years).toBe(11);
  });

  it("parses 'patients aged ≥12 years' with unicode ≥", () => {
    const result = parseAgeRange("patients aged ≥12 years");
    expect(result.age_min_years).toBe(12);
    expect(result.age_max_years).toBeNull();
  });
});

describe("ageRangeParser — weight constraints", () => {
  it("parses 'weighing 45 kg or more'", () => {
    const result = parseAgeRange("weighing 45 kg or more");
    expect(result.weight_constraint_kg).toBe(45);
  });

  it("parses 'at least 30 kg body weight'", () => {
    const result = parseAgeRange("at least 30 kg body weight");
    expect(result.weight_constraint_kg).toBe(30);
  });

  it("does not extract weight when not present", () => {
    const result = parseAgeRange("adult patients 18 years and older");
    expect(result.weight_constraint_kg).toBeNull();
  });
});

describe("ageRangeParser — sex constraints", () => {
  it("parses 'in females of reproductive potential'", () => {
    const result = parseAgeRange("in females of reproductive potential");
    expect(result.sex_constraint).toBe("female_only");
  });

  it("parses 'premenopausal women'", () => {
    const result = parseAgeRange("premenopausal women");
    expect(result.sex_constraint).toBe("female_only");
  });

  it("parses 'men with prostate cancer'", () => {
    const result = parseAgeRange("men with prostate cancer");
    expect(result.sex_constraint).toBe("male_only");
  });

  it("returns null sex_constraint for neutral text", () => {
    const result = parseAgeRange("adult patients 18 years and older");
    expect(result.sex_constraint).toBeNull();
  });
});

describe("ageRangeParser — unparseable / fallback", () => {
  it("returns all nulls for completely unparseable text", () => {
    const result = parseAgeRange("as part of the approved regimen");
    expect(result.age_min_years).toBeNull();
    expect(result.age_max_years).toBeNull();
    expect(result.weight_constraint_kg).toBeNull();
    expect(result.sex_constraint).toBeNull();
  });

  it("returns all nulls for empty string", () => {
    const result = parseAgeRange("");
    expect(result.age_min_years).toBeNull();
    expect(result.age_max_years).toBeNull();
    expect(result.weight_constraint_kg).toBeNull();
    expect(result.sex_constraint).toBeNull();
  });

  it("does not throw on unusual unicode input", () => {
    expect(() => parseAgeRange("patients \u{1F4A9} aged")).not.toThrow();
  });
});
