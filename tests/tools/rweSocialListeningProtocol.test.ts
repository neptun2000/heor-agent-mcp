/**
 * Tests for rwe.social_listening_protocol — protocol + compliance generator.
 */
import {
  handleRweSocialListeningProtocol,
  type SocialProtocolResult,
} from "../../src/tools/rweSocialListeningProtocol.js";

interface Res {
  content: string;
  social_protocol: SocialProtocolResult;
}

async function run(input: Record<string, unknown>): Promise<Res> {
  return (await handleRweSocialListeningProtocol(input)) as unknown as Res;
}

describe("rwe_social_listening_protocol — schema", () => {
  it("requires at least one objective and platform", async () => {
    await expect(
      run({ drug: "x", indication: "y", objectives: [], platforms: [] }),
    ).rejects.toThrow(/objective|platform/i);
  });

  it("rejects an unknown platform with did-you-mean", async () => {
    await expect(
      run({
        drug: "x",
        indication: "y",
        objectives: ["sentiment"],
        platforms: ["twitter"] as never,
      }),
    ).rejects.toThrow(/x_twitter|platform/i);
  });

  it("is case-insensitive on enums", async () => {
    const r = await run({
      drug: "x",
      indication: "y",
      objectives: ["Sentiment"],
      platforms: ["Reddit"],
    });
    expect(r.social_protocol.platforms).toContain("reddit");
  });
});

describe("rwe_social_listening_protocol — mandatory PV section", () => {
  it("ALWAYS includes a pharmacovigilance-handling section even without AE objective", async () => {
    const r = await run({
      drug: "x",
      indication: "y",
      objectives: ["sentiment"],
      platforms: ["x_twitter"],
    });
    const headings = r.social_protocol.sections.map((s) => s.heading);
    expect(headings.join(" ")).toMatch(/Pharmacovigilance/i);
    // And warns that PV is mandatory regardless of objective
    expect(r.social_protocol.warnings.join(" ")).toMatch(
      /PV screening is still mandatory/i,
    );
  });

  it("escalates obligations for an MAH-managed channel", async () => {
    const r = await run({
      drug: "x",
      indication: "y",
      objectives: ["adverse_event_monitoring"],
      platforms: ["facebook"],
      is_mah_managed_channel: true,
    });
    const pv = r.social_protocol.sections.find((s) =>
      /Pharmacovigilance/i.test(s.heading),
    )!;
    expect(pv.items.join(" ")).toMatch(/MAH-sponsored|proactive AE solicitation/i);
  });
});

describe("rwe_social_listening_protocol — privacy gating", () => {
  it("includes a GDPR DPIA mandatory checklist item for EU jurisdictions", async () => {
    const r = await run({
      drug: "x",
      indication: "y",
      objectives: ["sentiment"],
      platforms: ["x_twitter"],
      privacy_jurisdictions: ["eu_gdpr"],
    });
    const dpia = r.social_protocol.compliance_checklist.find((c) =>
      /GDPR DPIA/i.test(c.item),
    )!;
    expect(dpia.mandatory).toBe(true);
  });

  it("GDPR DPIA is non-mandatory for US-only HIPAA scope", async () => {
    const r = await run({
      drug: "x",
      indication: "y",
      objectives: ["sentiment"],
      platforms: ["x_twitter"],
      privacy_jurisdictions: ["us_hipaa"],
    });
    const dpia = r.social_protocol.compliance_checklist.find((c) =>
      /GDPR DPIA/i.test(c.item),
    )!;
    expect(dpia.mandatory).toBe(false);
  });
});

describe("rwe_social_listening_protocol — output", () => {
  it("emits sections, checklist, limitations, and routes to sibling tools", async () => {
    const r = await run({
      drug: "fremanezumab",
      indication: "migraine",
      objectives: ["patient_experience", "adverse_event_monitoring"],
      platforms: ["reddit", "patient_forums"],
      keywords: ["fremanezumab", "Ajovy"],
      time_window_months: 12,
    });
    expect(r.content).toMatch(/Social-Listening Study Protocol/);
    expect(r.content).toMatch(/Compliance checklist/);
    expect(r.content).toMatch(/Limitations/);
    expect(r.content).toMatch(/pv\.social_listening_triage/);
    expect(r.content).toMatch(/irb\.review/);
    expect(r.social_protocol.limitations.length).toBeGreaterThan(0);
  });

  it("seeds the search strategy with supplied keywords", async () => {
    const r = await run({
      drug: "x",
      indication: "y",
      objectives: ["sentiment"],
      platforms: ["x_twitter"],
      keywords: ["myDrug", "myBrand"],
    });
    const search = r.social_protocol.sections.find((s) =>
      /Search strategy/i.test(s.heading),
    )!;
    expect(search.items.join(" ")).toMatch(/myDrug, myBrand/);
  });
});
