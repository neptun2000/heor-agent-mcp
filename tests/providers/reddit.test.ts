import { pseudonymizeAuthor } from "../../src/providers/direct/reddit.js";

describe("pseudonymizeAuthor", () => {
  it("is deterministic and irreversible — never leaks the raw handle", () => {
    const a = pseudonymizeAuthor("jane_doe_99");
    const b = pseudonymizeAuthor("jane_doe_99");
    expect(a).toBe(b);                       // deterministic
    expect(a).toHaveLength(12);              // truncated
    expect(a).not.toContain("jane");         // irreversible — no raw handle
    expect(a).toMatch(/^[0-9a-f]{12}$/);     // hex
    expect(pseudonymizeAuthor("john")).not.toBe(a); // distinct inputs differ
  });
});
