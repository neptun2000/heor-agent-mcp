/**
 * Tests for pv.comparative_safety — class-level comparative safety profile.
 *
 * Ranks top-N adverse events per product by reporting rate per 1,000
 * exposed (or raw count), lays products side-by-side, calls out events of
 * interest, and optionally layers in disproportionality. Pure logic.
 *
 * Fixture loosely mirrors a 3-product anti-CGRP class FAERS view.
 */
import {
  handlePvComparativeSafety,
  type ComparativeSafetyResult,
} from "../../src/tools/pvComparativeSafety.js";

interface Res {
  content: string;
  comparative_safety: ComparativeSafetyResult;
}

async function run(input: Record<string, unknown>): Promise<Res> {
  return (await handlePvComparativeSafety(input)) as unknown as Res;
}

const THREE_PRODUCTS = {
  drug_class: "anti-CGRP migraine mAbs",
  indication: "migraine prevention",
  data_source: "faers",
  top_n: 3,
  products: [
    {
      name: "erenumab",
      exposed_population: 100000,
      adverse_events: [
        { name: "constipation", drug_event_count: 490 },
        { name: "migraine", drug_event_count: 489 },
        { name: "drug ineffective", drug_event_count: 368 },
        { name: "nausea", drug_event_count: 294 },
      ],
    },
    {
      name: "galcanezumab",
      exposed_population: 100000,
      adverse_events: [
        { name: "injection-site reaction", drug_event_count: 490 },
        { name: "migraine", drug_event_count: 299 },
        { name: "drug ineffective", drug_event_count: 169 },
        { name: "constipation", drug_event_count: 30 },
      ],
    },
    {
      name: "fremanezumab",
      exposed_population: 100000,
      adverse_events: [
        { name: "injection-site reaction", drug_event_count: 386 },
        { name: "migraine", drug_event_count: 101 },
        { name: "drug ineffective", drug_event_count: 114 },
      ],
    },
  ],
  events_of_interest: ["cardiovascular", "constipation"],
};

describe("pv_comparative_safety — schema validation", () => {
  it("requires at least two products", async () => {
    await expect(
      run({
        drug_class: "x",
        indication: "y",
        products: [
          { name: "a", adverse_events: [{ name: "ae", drug_event_count: 1 }] },
        ],
      }),
    ).rejects.toThrow(/at least 2 products|products/i);
  });

  it("rejects an unknown data_source with did-you-mean", async () => {
    await expect(
      run({
        drug_class: "x",
        indication: "y",
        data_source: "faer" as never,
        products: THREE_PRODUCTS.products,
      }),
    ).rejects.toThrow(/faers|data_source/i);
  });
});

describe("pv_comparative_safety — ranking", () => {
  it("ranks each product's AEs by reporting rate per 1,000 exposed", async () => {
    const r = await run(THREE_PRODUCTS);
    const erenumab = r.comparative_safety.per_product.find(
      (p) => p.product === "erenumab",
    )!;
    expect(erenumab.ranked_by).toBe("reporting_rate");
    expect(erenumab.ranked[0].name).toBe("constipation");
    expect(erenumab.ranked[0].rank).toBe(1);
    // 490 / 100000 * 1000 = 4.9
    expect(erenumab.ranked[0].reporting_rate_per_1000).toBeCloseTo(4.9, 5);
    // top_n = 3 → only 3 rows
    expect(erenumab.ranked).toHaveLength(3);
  });

  it("falls back to raw report count and warns when no exposure denominator", async () => {
    const r = await run({
      drug_class: "x",
      indication: "y",
      top_n: 2,
      products: [
        {
          name: "a",
          adverse_events: [
            { name: "headache", drug_event_count: 10 },
            { name: "nausea", drug_event_count: 5 },
          ],
        },
        {
          name: "b",
          adverse_events: [
            { name: "headache", drug_event_count: 3 },
            { name: "nausea", drug_event_count: 8 },
          ],
        },
      ],
    });
    expect(r.comparative_safety.per_product[0].ranked_by).toBe("report_count");
    expect(r.comparative_safety.warnings.join(" ")).toMatch(
      /raw report counts|exposure denominator/i,
    );
  });
});

describe("pv_comparative_safety — class comparison & observations", () => {
  it("builds a side-by-side comparison row for an AE shared across products", async () => {
    const r = await run(THREE_PRODUCTS);
    const migraine = r.comparative_safety.class_comparison.find(
      (row) => row.adverse_event.toLowerCase() === "migraine",
    )!;
    expect(migraine).toBeDefined();
    // migraine is in the top-3 for all three products
    expect(migraine.cells.every((c) => c.rank !== null)).toBe(true);
  });

  it("flags constipation as a product-level differentiator (erenumab only)", async () => {
    const r = await run(THREE_PRODUCTS);
    const obs = r.comparative_safety.observations.join(" ");
    expect(obs).toMatch(/constipation/i);
    // constipation ranks for erenumab but not the others' top-3
    expect(obs).toMatch(/differentiator|does not reach/i);
  });

  it("reports an event of interest absent from all top-N (cardiovascular)", async () => {
    const r = await run(THREE_PRODUCTS);
    const cv = r.comparative_safety.events_of_interest_findings.find((f) =>
      f.adverse_event.toLowerCase().includes("cardio"),
    )!;
    expect(cv.in_top_n_for).toHaveLength(0);
    expect(r.comparative_safety.observations.join(" ")).toMatch(
      /cardiovascular: did NOT rank in the top/i,
    );
  });
});

describe("pv_comparative_safety — disproportionality", () => {
  it("computes PRR/ROR/IC/EBGM when 2x2 marginals are supplied", async () => {
    const r = await run({
      drug_class: "anti-CGRP",
      indication: "migraine",
      grand_total: 2000000,
      top_n: 2,
      products: [
        {
          name: "erenumab",
          exposed_population: 100000,
          total_reports: 20000,
          adverse_events: [
            { name: "constipation", drug_event_count: 490, event_total: 5000 },
            { name: "migraine", drug_event_count: 489, event_total: 40000 },
          ],
        },
        {
          name: "galcanezumab",
          exposed_population: 100000,
          total_reports: 15000,
          adverse_events: [
            { name: "constipation", drug_event_count: 30, event_total: 5000 },
            { name: "migraine", drug_event_count: 299, event_total: 40000 },
          ],
        },
      ],
    });
    expect(r.comparative_safety.disproportionality_computed).toBe(true);
    const constErenumab = r.comparative_safety.per_product
      .find((p) => p.product === "erenumab")!
      .ranked.find((a) => a.name === "constipation")!;
    expect(constErenumab.disproportionality).not.toBeNull();
    expect(constErenumab.disproportionality!.prr).toBeGreaterThan(1);
  });

  it("warns that disproportionality is not computed without marginals", async () => {
    const r = await run(THREE_PRODUCTS);
    expect(r.comparative_safety.disproportionality_computed).toBe(false);
    expect(r.comparative_safety.warnings.join(" ")).toMatch(
      /disproportionality.*not computed/i,
    );
  });
});

describe("pv_comparative_safety — output & caveats", () => {
  it("always carries the spontaneous-report-is-not-incidence caveat", async () => {
    const r = await run(THREE_PRODUCTS);
    expect(r.comparative_safety.warnings.join(" ")).toMatch(
      /reporting behaviour, not incidence/i,
    );
  });

  it("markdown includes per-product tables and a class comparison", async () => {
    const r = await run(THREE_PRODUCTS);
    expect(r.content).toMatch(/Comparative Safety Profile/);
    expect(r.content).toMatch(/erenumab — top 3/);
    expect(r.content).toMatch(/Class comparison/);
    expect(r.content).toMatch(/Rate \/ 1,000 exposed/);
  });
});
