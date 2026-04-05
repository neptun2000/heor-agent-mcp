import { searchProject } from "../../src/knowledge/search.js";
import { saveLiteratureResult } from "../../src/knowledge/rawStore.js";
import { writeWikiFile } from "../../src/knowledge/wikiStore.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("searchProject", () => {
  let tmpDir: string;
  const orig = process.env.HEOR_KB_ROOT;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "heor-search-"));
    process.env.HEOR_KB_ROOT = tmpDir;

    // Populate with test data
    await saveLiteratureResult("testproj", {
      id: "pubmed_1", source: "pubmed", title: "Semaglutide trial", authors: ["Smith"], date: "2023", study_type: "rct",
      abstract: "A phase 3 study of semaglutide in type 2 diabetes. Primary endpoint HbA1c.",
      url: "https://example.com/1",
    }, "semaglutide");
    await saveLiteratureResult("testproj", {
      id: "pubmed_2", source: "pubmed", title: "Pembrolizumab NSCLC", authors: ["Jones"], date: "2023", study_type: "rct",
      abstract: "Pembrolizumab vs chemotherapy in NSCLC.",
      url: "https://example.com/2",
    }, "pembrolizumab");
    await writeWikiFile("testproj", "wiki/trials/sustain-6.md", "# SUSTAIN-6\n\nSemaglutide cardiovascular outcomes trial.");
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
    if (orig === undefined) delete process.env.HEOR_KB_ROOT;
    else process.env.HEOR_KB_ROOT = orig;
  });

  it("finds matches across raw/ and wiki/", async () => {
    const results = await searchProject("testproj", "semaglutide");
    expect(results.length).toBeGreaterThan(0);
    const files = results.map(r => r.file);
    expect(files.some(f => f.includes("raw/literature"))).toBe(true);
    expect(files.some(f => f.includes("wiki/trials"))).toBe(true);
  });

  it("respects paths filter", async () => {
    const wikiOnly = await searchProject("testproj", "semaglutide", { paths: ["wiki"] });
    expect(wikiOnly.every(r => r.file.startsWith("wiki"))).toBe(true);

    const rawOnly = await searchProject("testproj", "semaglutide", { paths: ["raw"] });
    expect(rawOnly.every(r => r.file.startsWith("raw"))).toBe(true);
  });

  it("is case-insensitive by default", async () => {
    const lower = await searchProject("testproj", "semaglutide");
    const upper = await searchProject("testproj", "SEMAGLUTIDE");
    expect(lower.length).toBe(upper.length);
  });

  it("returns empty array for non-existent project", async () => {
    const results = await searchProject("doesnotexist", "anything");
    expect(results).toEqual([]);
  });

  it("respects max_results", async () => {
    const results = await searchProject("testproj", "semaglutide", { max_results: 1 });
    expect(results.length).toBe(1);
  });

  it("extracts title and source from frontmatter", async () => {
    const results = await searchProject("testproj", "semaglutide", { paths: ["raw"] });
    const match = results.find(r => r.source === "pubmed");
    expect(match).toBeDefined();
    expect(match?.title).toContain("Semaglutide");
  });
});
