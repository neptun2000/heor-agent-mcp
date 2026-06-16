// heor-agent-mcp/tests/tools/livingReview.test.ts
// Design log #39 — literature.living_review
import {
  livingReviewSchema,
  diffRecordSets,
  assessMateriality,
  computeNextRefresh,
  runLivingReview,
  CONFERENCE_CALENDAR,
  type LivingReviewRecord,
} from "../../src/tools/livingReview.js";

const searchReturning = (records: LivingReviewRecord[]) => async () => ({
  content: JSON.stringify({ results: records }),
});

const rec = (
  id: string,
  over: Partial<LivingReviewRecord> = {},
): LivingReviewRecord => ({
  id,
  source: "pubmed",
  title: `Study ${id}`,
  authors: [],
  date: "2026-01-01",
  abstract: "",
  url: `https://example.org/${id}`,
  ...over,
});

describe("living_review — schema", () => {
  it("defaults cadence to quarterly and protocol.runs to 3", () => {
    const p = livingReviewSchema.parse({
      mode: "init",
      protocol: { research_question: "seladelpar in PBC" },
    });
    expect(p.recommended_cadence).toBe("quarterly");
    expect(p.protocol.runs).toBe(3);
  });

  it("requires mode and protocol", () => {
    expect(() =>
      livingReviewSchema.parse({ protocol: { research_question: "x" } }),
    ).toThrow();
    expect(() => livingReviewSchema.parse({ mode: "init" })).toThrow();
  });
});

describe("living_review — diffRecordSets", () => {
  it("computes added and removed by stable id", () => {
    const prev = [rec("a"), rec("b")];
    const next = [rec("b"), rec("c")];
    const { added, removed } = diffRecordSets(prev, next);
    expect(added.map((r) => r.id)).toEqual(["c"]);
    expect(removed.map((r) => r.id)).toEqual(["a"]);
  });

  it("falls back to title+year when id is missing", () => {
    const prev = [rec("", { title: "Alpha", date: "2025-05-01" })];
    const next = [
      rec("", { title: "Alpha", date: "2025-09-01" }), // same title+year → unchanged
      rec("", { title: "Beta", date: "2026-01-01" }), // new
    ];
    const { added, removed } = diffRecordSets(prev, next);
    expect(added.map((r) => r.title)).toEqual(["Beta"]);
    expect(removed).toHaveLength(0);
  });
});

describe("living_review — assessMateriality", () => {
  it("is not material when nothing new", () => {
    const m = assessMateriality([], 5);
    expect(m.material).toBe(false);
    expect(m.recommended_downstream).toEqual([]);
  });

  it("flags a new RCT as material", () => {
    const m = assessMateriality([rec("x", { study_type: "rct" })], 5);
    expect(m.material).toBe(true);
    expect(m.reasons.join(" ")).toMatch(/RCT/i);
    expect(m.recommended_downstream).toContain("evidence_network");
  });

  it("flags reaching the new-record threshold", () => {
    const five = [1, 2, 3, 4, 5].map((n) => rec(`r${n}`));
    const m = assessMateriality(five, 5);
    expect(m.material).toBe(true);
    expect(m.reasons.join(" ")).toMatch(/5 new|threshold/i);
  });

  it("flags a conference late-breaker", () => {
    const m = assessMateriality(
      [rec("y", { title: "Late-breaking abstract, ESMO 2026" })],
      5,
    );
    expect(m.material).toBe(true);
    expect(m.reasons.join(" ")).toMatch(/late-break|conference/i);
  });
});

describe("living_review — computeNextRefresh", () => {
  it("adds the cadence interval", () => {
    expect(computeNextRefresh("2026-06-15", "monthly")).toBe("2026-07-15");
    expect(computeNextRefresh("2026-06-15", "quarterly")).toBe("2026-09-15");
    expect(computeNextRefresh("2026-06-15", "half_yearly")).toBe("2026-12-15");
    expect(computeNextRefresh("2026-06-15", "annual")).toBe("2027-06-15");
  });

  it("resolves conference_adhoc to the next calendar date after as_of", () => {
    const next = computeNextRefresh("2026-06-15", "conference_adhoc");
    const expected = [...CONFERENCE_CALENDAR]
      .sort()
      .find((d) => d > "2026-06-15");
    expect(next).toBe(expected);
    expect(next > "2026-06-15").toBe(true);
  });
});

describe("living_review — handler (init)", () => {
  it("runs a baseline search and returns all records as new", async () => {
    const r = await runLivingReview(
      {
        mode: "init",
        protocol: { research_question: "seladelpar in PBC" },
        as_of: "2026-06-15",
      },
      { literatureSearch: searchReturning([rec("a"), rec("b")]) },
    );
    expect(r.run_index).toBe(1);
    expect(r.records.map((x) => x.id)).toEqual(["a", "b"]);
    expect(r.prisma_delta).toEqual({ new: 2, dropped: 0, total_now: 2 });
    expect(r.material_change).toBe(false);
    expect(r.next_refresh_due).toBe("2026-09-15");
  });
});

describe("living_review — handler (refresh)", () => {
  it("diffs against previous_records and flags a material new RCT", async () => {
    const next = [rec("b"), rec("c", { study_type: "rct" })]; // a dropped, c added
    const r = await runLivingReview(
      {
        mode: "refresh",
        protocol: { research_question: "seladelpar in PBC" },
        previous_records: [rec("a"), rec("b")],
        as_of: "2026-06-15",
        recommended_cadence: "monthly",
      },
      { literatureSearch: searchReturning(next) },
    );
    expect(r.run_index).toBe(2);
    expect(r.new_records.map((x) => x.id)).toEqual(["c"]);
    expect(r.dropped_records.map((x) => x.id)).toEqual(["a"]);
    expect(r.prisma_delta).toEqual({ new: 1, dropped: 1, total_now: 2 });
    expect(r.material_change).toBe(true);
    expect(r.recommended_downstream).toContain("evidence_network");
    expect(r.next_refresh_due).toBe("2026-07-15");
  });

  it("renders a markdown_section with header and an ELEVATE disclosure block", async () => {
    const r = await runLivingReview(
      {
        mode: "refresh",
        protocol: { research_question: "x" },
        previous_records: [rec("a")],
        as_of: "2026-06-15",
      },
      { literatureSearch: searchReturning([rec("a"), rec("d")]) },
    );
    expect(r.markdown_section).toContain("Living SLR");
    expect(r.markdown_section).toContain("AI Assistance Disclosure");
  });
});
