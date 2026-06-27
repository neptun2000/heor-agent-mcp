import { assembleStrategy } from "../../src/search/strategyAssembler.js";

describe("assembleStrategy — numbered-line ledger", () => {
  it("builds 2-line concept + single-line filter + single-line exclusion + age + date", () => {
    const out = assembleStrategy({
      conceptLines: ["'disease A'/exp", "'disease B'/exp"],
      strandFilter: ["'cost'/exp OR economic*:ab,ti"],
      exclusionLines: ["'editorial':it OR 'letter':it"],
      ageLimit: "child*:ab,ti OR 'child'/exp",
      dateLimit: "[2007-2017]/py",
    });
    const q = out.lines.map((l) => l.query);
    expect(q[0]).toBe("'disease A'/exp");
    expect(q[1]).toBe("'disease B'/exp");
    expect(q[2]).toBe("#1 OR #2");
    expect(q[3]).toBe("'cost'/exp OR economic*:ab,ti");
    expect(q[4]).toBe("#3 AND #4");
    expect(q[5]).toBe("'editorial':it OR 'letter':it");
    expect(q[6]).toBe("#5 NOT #6");
    expect(q[7]).toBe("child*:ab,ti OR 'child'/exp");
    expect(q[8]).toBe("#7 AND #8");
    expect(q[9]).toBe("#9 AND [2007-2017]/py");
    expect(out.finalLineNumber).toBe(10);
  });

  it("handles a 9-line concept block and a 4-line exclusion (ABSSSI shape)", () => {
    const out = assembleStrategy({
      conceptLines: ["c1", "c2", "c3", "c4", "c5", "c6", "c7", "c8", "c9"],
      strandFilter: ["epi filter"],
      exclusionLines: ["x1", "x2", "x3", "x4"],
      dateLimit: "[2012-2017]/py",
      languageLimit: "[english]/lim",
    });
    const q = out.lines.map((l) => l.query);
    expect(q[9]).toBe("#1 OR #2 OR #3 OR #4 OR #5 OR #6 OR #7 OR #8 OR #9"); // line #10
    expect(q[10]).toBe("epi filter"); // #11
    expect(q[11]).toBe("#10 AND #11"); // #12
    expect(q[12]).toBe("x1"); // #13
    expect(q[16]).toBe("#13 OR #14 OR #15 OR #16"); // #17
    expect(q[17]).toBe("#12 NOT #17"); // #18
    expect(q[18]).toBe("#18 AND [2012-2017]/py"); // #19
    expect(q[19]).toBe("#19 AND [english]/lim"); // #20
    expect(out.finalLineNumber).toBe(20);
  });

  it("omits optional limits cleanly (HRQoL shape: no date, no language)", () => {
    const out = assembleStrategy({
      conceptLines: ["c1", "c2"],
      strandFilter: ["hrqol"],
      exclusionLines: ["x1"],
      ageLimit: "child*",
    });
    expect(out.finalLineNumber).toBe(9);
    expect(out.lines[8].query).toBe("#7 AND #8");
  });
});
