// heor-agent-mcp/tests/governance/scoring.test.ts
import {
  scoreDimension,
  tallyScorecard,
  aggregateVerdict,
} from "../../src/governance/scoring.js";

describe("scoreDimension", () => {
  it("maps probe answers to RAG, blank → insufficient (never green)", () => {
    expect(scoreDimension("yes")).toBe("green");
    expect(scoreDimension("partial")).toBe("amber");
    expect(scoreDimension("no")).toBe("red");
    expect(scoreDimension(null)).toBe("insufficient");
    expect(scoreDimension(undefined)).toBe("insufficient");
  });
});

describe("tallyScorecard", () => {
  it("counts each RAG state", () => {
    expect(
      tallyScorecard(["green", "green", "amber", "red", "insufficient", "insufficient"]),
    ).toEqual({ green: 2, amber: 1, red: 1, insufficient: 2 });
  });
});

describe("aggregateVerdict", () => {
  it("any Red blocks for high-stakes and internal use", () => {
    expect(aggregateVerdict(["red", "green"], "regulatory_submission")).toMatch(/Not submission-ready/);
    expect(aggregateVerdict(["red", "green"], "internal_analysis")).toMatch(/Not submission-ready/);
  });
  it("Red is advisory for exploratory use", () => {
    expect(aggregateVerdict(["red", "green"], "exploratory")).toMatch(/advisory/i);
  });
  it("Insufficient blocks certification for high-stakes use", () => {
    expect(aggregateVerdict(["green", "insufficient"], "payer_dossier")).toMatch(/Cannot certify/);
  });
  it("Insufficient is flagged (non-blocking) for internal use", () => {
    expect(aggregateVerdict(["green", "insufficient"], "internal_analysis")).toMatch(/missing evidence flagged/i);
  });
  it("Amber-only resolves to adequate-with-gaps", () => {
    expect(aggregateVerdict(["green", "amber"], "regulatory_submission")).toMatch(/resolve ambers/i);
  });
  it("all Green → strong posture", () => {
    expect(aggregateVerdict(["green", "green"], "regulatory_submission")).toBe("Strong governance posture");
  });
  it("is deterministic (same input → identical output)", () => {
    const a = aggregateVerdict(["red", "amber", "insufficient"], "payer_dossier");
    const b = aggregateVerdict(["red", "amber", "insufficient"], "payer_dossier");
    expect(a).toBe(b);
  });
});
