/**
 * Tests for pv.social_listening_triage — GVP Module VI reportability triage.
 */
import {
  handlePvSocialListeningTriage,
  type SocialTriageResult,
} from "../../src/tools/pvSocialListeningTriage.js";

interface Res {
  content: string;
  social_triage: SocialTriageResult;
}

async function run(input: Record<string, unknown>): Promise<Res> {
  return (await handlePvSocialListeningTriage(input)) as unknown as Res;
}

const FULL = {
  identifiable_reporter: true,
  identifiable_patient: true,
  suspect_product: true,
  adverse_event: true,
};

describe("pv_social_listening_triage — schema", () => {
  it("requires at least one post", async () => {
    await expect(
      run({ drug: "x", indication: "y", posts: [] }),
    ).rejects.toThrow(/at least one post|posts/i);
  });
});

describe("pv_social_listening_triage — four-element ICSR test", () => {
  it("all four elements → valid_icsr with a deadline", async () => {
    const r = await run({
      drug: "fremanezumab",
      indication: "migraine",
      posts: [{ id: "p1", elements: FULL, serious: false }],
    });
    const t = r.social_triage.per_post[0];
    expect(t.classification).toBe("valid_icsr");
    expect(t.reporting_deadline_days).toBe(90);
    expect(r.social_triage.reportable_icsr_count).toBe(1);
  });

  it("serious valid ICSR → 15-day deadline + serious count", async () => {
    const r = await run({
      drug: "x",
      indication: "y",
      posts: [{ id: "p1", elements: FULL, serious: true }],
    });
    expect(r.social_triage.per_post[0].reporting_deadline_days).toBe(15);
    expect(r.social_triage.serious_icsr_count).toBe(1);
  });

  it("product + event but no patient/reporter → potential_ae_followup", async () => {
    const r = await run({
      drug: "x",
      indication: "y",
      posts: [
        {
          id: "p1",
          elements: {
            identifiable_reporter: false,
            identifiable_patient: false,
            suspect_product: true,
            adverse_event: true,
          },
        },
      ],
    });
    const t = r.social_triage.per_post[0];
    expect(t.classification).toBe("potential_ae_followup");
    expect(t.missing_elements).toContain("identifiable_patient");
    expect(t.missing_elements).toContain("identifiable_reporter");
  });

  it("no AE but has product/themes → non_ae_insight", async () => {
    const r = await run({
      drug: "x",
      indication: "y",
      posts: [
        {
          id: "p1",
          elements: {
            identifiable_reporter: true,
            identifiable_patient: true,
            suspect_product: true,
            adverse_event: false,
          },
          themes: ["efficacy"],
          sentiment: "positive",
        },
      ],
    });
    expect(r.social_triage.per_post[0].classification).toBe("non_ae_insight");
  });

  it("no AE, no product → not_reportable", async () => {
    const r = await run({
      drug: "x",
      indication: "y",
      posts: [
        {
          id: "p1",
          elements: {
            identifiable_reporter: false,
            identifiable_patient: false,
            suspect_product: false,
            adverse_event: false,
          },
        },
      ],
    });
    expect(r.social_triage.per_post[0].classification).toBe("not_reportable");
  });
});

describe("pv_social_listening_triage — obligations & tallies", () => {
  it("starts the reporting clock and emits PV obligations when ICSRs exist", async () => {
    const r = await run({
      drug: "x",
      indication: "y",
      posts: [
        { id: "p1", elements: FULL, serious: true },
        { id: "p2", elements: FULL, serious: false },
      ],
    });
    expect(r.social_triage.pv_obligations.join(" ")).toMatch(
      /reporting clock|15 calendar days/i,
    );
    expect(r.social_triage.pv_obligations.join(" ")).toMatch(/serious/i);
  });

  it("tallies sentiment, themes, and AE terms", async () => {
    const r = await run({
      drug: "x",
      indication: "y",
      posts: [
        {
          id: "p1",
          elements: FULL,
          sentiment: "negative",
          themes: ["tolerability", "efficacy"],
          adverse_event_terms: ["constipation"],
        },
        {
          id: "p2",
          elements: { ...FULL, adverse_event: false },
          sentiment: "negative",
          themes: ["tolerability"],
        },
      ],
    });
    expect(r.social_triage.sentiment_distribution.negative).toBe(2);
    expect(r.social_triage.theme_tally[0].theme).toBe("tolerability");
    expect(r.social_triage.theme_tally[0].count).toBe(2);
    expect(r.social_triage.adverse_event_tally[0].term).toBe("constipation");
  });

  it("always carries the low-validity caveat", async () => {
    const r = await run({
      drug: "x",
      indication: "y",
      posts: [{ id: "p1", elements: FULL }],
    });
    expect(r.social_triage.warnings.join(" ")).toMatch(/low-validity/i);
  });

  it("markdown renders obligations and per-post table", async () => {
    const r = await run({
      drug: "x",
      indication: "y",
      posts: [{ id: "p1", elements: FULL, serious: true }],
    });
    expect(r.content).toMatch(/Pharmacovigilance obligations/);
    expect(r.content).toMatch(/Per-post triage/);
  });
});
