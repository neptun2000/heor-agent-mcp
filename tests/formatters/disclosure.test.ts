import {
  buildDisclosure,
  extractDisclosureLevel,
  ISPOR_TASK_FORCE_CITATION,
} from "../../src/formatters/disclosure.js";
import {
  createAuditRecord,
  addSource,
  addToolCall,
} from "../../src/audit/builder.js";

const FIXED_DATE = "2026-05-28";

describe("buildDisclosure — level off", () => {
  it("returns empty string", () => {
    const audit = createAuditRecord("hta.workflow", {}, "text");
    expect(buildDisclosure(audit, { level: "off", dateISO: FIXED_DATE })).toBe(
      "",
    );
  });
});

describe("buildDisclosure — level standard", () => {
  it("contains required ISPOR-aligned header elements", () => {
    const audit = createAuditRecord("hta.workflow", {}, "text");
    const out = buildDisclosure(audit, {
      level: "standard",
      dateISO: FIXED_DATE,
    });
    expect(out).toContain("AI Assistance Disclosure");
    expect(out).toContain("requires human review");
    expect(out).toContain("**Model:**");
    expect(out).toContain("**Generated:**");
    expect(out).toContain(FIXED_DATE);
  });

  it("lists tools called when present", () => {
    let audit = createAuditRecord("hta.workflow", {}, "text");
    audit = addToolCall(audit, {
      name: "literature.search",
      ms: 412,
      outcome: "ok",
    });
    audit = addToolCall(audit, {
      name: "evidence.risk_of_bias",
      ms: 180,
      outcome: "degraded",
    });
    const out = buildDisclosure(audit, {
      level: "standard",
      dateISO: FIXED_DATE,
    });
    expect(out).toContain("literature.search");
    expect(out).toContain("evidence.risk_of_bias");
    expect(out).toContain("degraded");
  });

  it("renders 'this tool only' when tools_called is empty", () => {
    const audit = createAuditRecord("hta.workflow", {}, "text");
    const out = buildDisclosure(audit, {
      level: "standard",
      dateISO: FIXED_DATE,
    });
    expect(out).toContain("this tool only");
  });

  it("lists sources queried with hit counts when present", () => {
    let audit = createAuditRecord("literature.search", {}, "text");
    audit = addSource(audit, {
      source: "pubmed",
      query_sent: "semaglutide",
      results_returned: 47,
      results_included: 18,
      latency_ms: 320,
      status: "ok",
    });
    audit = addSource(audit, {
      source: "clinicaltrials",
      query_sent: "semaglutide",
      results_returned: 3,
      results_included: 3,
      latency_ms: 120,
      status: "ok",
    });
    const out = buildDisclosure(audit, {
      level: "standard",
      dateISO: FIXED_DATE,
    });
    expect(out).toContain("**Sources queried:**");
    expect(out).toContain("pubmed");
    expect(out).toContain("n=18");
    expect(out).toContain("clinicaltrials");
    expect(out).toContain("n=3");
  });

  it("omits sources queried line when no sources", () => {
    const audit = createAuditRecord("hta.workflow", {}, "text");
    const out = buildDisclosure(audit, {
      level: "standard",
      dateISO: FIXED_DATE,
    });
    expect(out).not.toContain("**Sources queried:**");
  });

  it("references ISPOR Task Force but does NOT include full citation", () => {
    const audit = createAuditRecord("hta.workflow", {}, "text");
    const out = buildDisclosure(audit, {
      level: "standard",
      dateISO: FIXED_DATE,
    });
    expect(out).toContain("ISPOR");
    expect(out).not.toContain("doi:");
  });

  it("uses injected modelId when provided", () => {
    const audit = createAuditRecord("hta.workflow", {}, "text");
    const out = buildDisclosure(audit, {
      level: "standard",
      dateISO: FIXED_DATE,
      modelId: "claude-opus-4-7",
    });
    expect(out).toContain("claude-opus-4-7");
  });

  it("is deterministic with same inputs", () => {
    const audit = createAuditRecord("hta.workflow", { drug: "test" }, "text");
    const a = buildDisclosure(audit, {
      level: "standard",
      dateISO: FIXED_DATE,
    });
    const b = buildDisclosure(audit, {
      level: "standard",
      dateISO: FIXED_DATE,
    });
    expect(a).toBe(b);
  });
});

describe("buildDisclosure — level submission", () => {
  it("contains everything standard has", () => {
    const audit = createAuditRecord("hta.workflow", {}, "text");
    const out = buildDisclosure(audit, {
      level: "submission",
      dateISO: FIXED_DATE,
    });
    expect(out).toContain("AI Assistance Disclosure");
    expect(out).toContain("requires human review");
  });

  it("includes Submission-grade detail section", () => {
    const audit = createAuditRecord("hta.workflow", {}, "text");
    const out = buildDisclosure(audit, {
      level: "submission",
      dateISO: FIXED_DATE,
    });
    expect(out).toContain("Submission-grade detail");
  });

  it("includes full ISPOR citation with DOI", () => {
    const audit = createAuditRecord("hta.workflow", {}, "text");
    const out = buildDisclosure(audit, {
      level: "submission",
      dateISO: FIXED_DATE,
    });
    expect(out).toContain("ELEVATE-GenAI");
    expect(out).toContain("doi:");
    expect(out).toContain("10.1016/j.jval.2025.06.018");
  });
});

describe("extractDisclosureLevel", () => {
  it("returns the provided level when valid", () => {
    expect(
      extractDisclosureLevel({ ai_disclosure_level: "off" }, "standard"),
    ).toBe("off");
    expect(
      extractDisclosureLevel({ ai_disclosure_level: "standard" }, "submission"),
    ).toBe("standard");
    expect(
      extractDisclosureLevel({ ai_disclosure_level: "submission" }, "standard"),
    ).toBe("submission");
  });

  it("returns defaultLevel when field is absent", () => {
    expect(extractDisclosureLevel({}, "standard")).toBe("standard");
    expect(extractDisclosureLevel({}, "submission")).toBe("submission");
  });

  it("returns defaultLevel when field is invalid", () => {
    expect(
      extractDisclosureLevel({ ai_disclosure_level: "verbose" }, "standard"),
    ).toBe("standard");
    expect(
      extractDisclosureLevel({ ai_disclosure_level: 42 }, "standard"),
    ).toBe("standard");
    expect(
      extractDisclosureLevel({ ai_disclosure_level: null }, "standard"),
    ).toBe("standard");
  });

  it("returns defaultLevel when args is null or non-object", () => {
    expect(extractDisclosureLevel(null, "standard")).toBe("standard");
    expect(extractDisclosureLevel(undefined, "standard")).toBe("standard");
    expect(extractDisclosureLevel("string", "standard")).toBe("standard");
  });
});

describe("ISPOR_TASK_FORCE_CITATION", () => {
  it("is a non-empty string", () => {
    expect(typeof ISPOR_TASK_FORCE_CITATION).toBe("string");
    expect(ISPOR_TASK_FORCE_CITATION.length).toBeGreaterThan(0);
  });

  it("contains ELEVATE-GenAI and the verified DOI", () => {
    expect(ISPOR_TASK_FORCE_CITATION).toContain("ELEVATE-GenAI");
    expect(ISPOR_TASK_FORCE_CITATION).toContain("10.1016/j.jval.2025.06.018");
  });
});
