import { parseFrontmatter, stringifyFrontmatter } from "../../src/knowledge/yaml.js";

describe("parseFrontmatter", () => {
  it("returns empty frontmatter when no --- delimiter", () => {
    const { frontmatter, body } = parseFrontmatter("Just body content");
    expect(frontmatter).toEqual({});
    expect(body).toBe("Just body content");
  });

  it("parses simple key-value pairs", () => {
    const input = `---\ntitle: Test Paper\nyear: 2024\n---\nBody text`;
    const { frontmatter, body } = parseFrontmatter(input);
    expect(frontmatter.title).toBe("Test Paper");
    expect(frontmatter.year).toBe(2024);
    expect(body).toBe("Body text");
  });

  it("parses array values", () => {
    const input = `---\nauthors:\n  - Alice\n  - Bob\n---\n`;
    const { frontmatter } = parseFrontmatter(input);
    expect(frontmatter.authors).toEqual(["Alice", "Bob"]);
  });

  it("parses quoted strings", () => {
    const input = `---\ntitle: "Contains: special chars"\n---\n`;
    const { frontmatter } = parseFrontmatter(input);
    expect(frontmatter.title).toBe("Contains: special chars");
  });

  it("parses booleans", () => {
    const input = `---\nactive: true\narchived: false\n---\n`;
    const { frontmatter } = parseFrontmatter(input);
    expect(frontmatter.active).toBe(true);
    expect(frontmatter.archived).toBe(false);
  });
});

describe("stringifyFrontmatter", () => {
  it("round-trips simple data", () => {
    const fm = { title: "Test", year: 2024 };
    const str = stringifyFrontmatter(fm, "Body");
    const { frontmatter, body } = parseFrontmatter(str);
    expect(frontmatter.title).toBe("Test");
    expect(frontmatter.year).toBe(2024);
    expect(body).toBe("Body");
  });

  it("round-trips arrays", () => {
    const fm = { authors: ["Alice", "Bob"] };
    const str = stringifyFrontmatter(fm, "");
    const { frontmatter } = parseFrontmatter(str);
    expect(frontmatter.authors).toEqual(["Alice", "Bob"]);
  });

  it("quotes strings with special characters", () => {
    const fm = { title: "Has: colon" };
    const str = stringifyFrontmatter(fm, "");
    expect(str).toContain('"Has: colon"');
  });
});
