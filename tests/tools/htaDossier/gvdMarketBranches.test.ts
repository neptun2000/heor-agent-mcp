/**
 * TDD — RED phase: gvdMarketBranches tests
 * Tests for per-market policy subsections (US/UK/EU5/JP).
 */
import { generateMarketPathways } from "../../../src/tools/htaDossier/gvdMarketBranches.js";

const drug = "examplivir";
const indication = "chronic hepatitis B";

describe("generateMarketPathways — US branch", () => {
  it("mentions ICER", () => {
    const { us } = generateMarketPathways(drug, indication);
    expect(us).toContain("ICER");
  });

  it("mentions Medicare", () => {
    const { us } = generateMarketPathways(drug, indication);
    expect(us).toContain("Medicare");
  });

  it("mentions IRA (Inflation Reduction Act)", () => {
    const { us } = generateMarketPathways(drug, indication);
    expect(us).toMatch(/IRA|Inflation Reduction Act/);
  });
});

describe("generateMarketPathways — UK branch", () => {
  it("mentions NICE", () => {
    const { uk } = generateMarketPathways(drug, indication);
    expect(uk).toContain("NICE");
  });

  it("mentions QALY threshold (£20K–£30K range)", () => {
    const { uk } = generateMarketPathways(drug, indication);
    expect(uk).toMatch(/£20[,.]?000|£30[,.]?000|20,000.*30,000|20K.*30K/);
  });
});

describe("generateMarketPathways — EU5 branch", () => {
  it("mentions JCA (Joint Clinical Assessment)", () => {
    const { eu5 } = generateMarketPathways(drug, indication);
    expect(eu5).toMatch(/JCA|Joint Clinical Assessment/);
  });

  it("mentions G-BA or IQWiG", () => {
    const { eu5 } = generateMarketPathways(drug, indication);
    expect(eu5).toMatch(/G-BA|IQWiG/);
  });
});

describe("generateMarketPathways — Japan branch", () => {
  it("mentions C2H or Chuikyo", () => {
    const { jp } = generateMarketPathways(drug, indication);
    expect(jp).toMatch(/C2H|Chuikyo/);
  });
});
