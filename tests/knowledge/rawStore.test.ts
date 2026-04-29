import { saveLiteratureResult, saveModelRun, saveDossier } from "../../src/knowledge/rawStore.js";
import { parseFrontmatter } from "../../src/knowledge/yaml.js";
import { readFile, rm, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LiteratureResult } from "../../src/providers/types.js";

describe("rawStore", () => {
  let tmpDir: string;
  const originalEnv = process.env.HEOR_KB_ROOT;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "heor-kb-test-"));
    process.env.HEOR_KB_ROOT = tmpDir;
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
    if (originalEnv === undefined) delete process.env.HEOR_KB_ROOT;
    else process.env.HEOR_KB_ROOT = originalEnv;
  });

  const mockResult: LiteratureResult = {
    id: "pubmed_12345",
    source: "pubmed",
    title: "Test Study on Semaglutide",
    authors: ["Smith J", "Jones K"],
    date: "2023-05-15",
    study_type: "rct",
    abstract: "This study examined the efficacy of semaglutide.",
    url: "https://pubmed.ncbi.nlm.nih.gov/12345/",
  };

  it("saves a literature result to raw/literature/", async () => {
    const path = await saveLiteratureResult("test-drug", mockResult, "semaglutide");
    expect(path).toContain("test-drug");
    expect(path).toContain("literature");
    const content = await readFile(path, "utf-8");
    const { frontmatter, body } = parseFrontmatter(content);
    expect(frontmatter.id).toBe("pubmed_12345");
    expect(frontmatter.title).toBe("Test Study on Semaglutide");
    expect(frontmatter.project).toBe("test-drug");
    expect(Array.isArray(frontmatter.retrieved_at)).toBe(true);
    expect(body).toContain("Test Study on Semaglutide");
  });

  it("deduplicates by merging retrieval history", async () => {
    await saveLiteratureResult("test-drug", mockResult, "semaglutide diabetes");
    // Wait a tick to ensure different timestamps
    await new Promise(resolve => setTimeout(resolve, 10));
    const path = await saveLiteratureResult("test-drug", mockResult, "glp-1 agonist");
    const content = await readFile(path, "utf-8");
    const { frontmatter } = parseFrontmatter(content);
    expect((frontmatter.retrieved_at as string[]).length).toBe(2);
    expect((frontmatter.query_history as string[]).length).toBe(2);
    expect(frontmatter.query_history).toContain("semaglutide diabetes");
    expect(frontmatter.query_history).toContain("glp-1 agonist");
  });

  it("does not duplicate same query in history", async () => {
    await saveLiteratureResult("test-drug", mockResult, "same query");
    const path = await saveLiteratureResult("test-drug", mockResult, "same query");
    const content = await readFile(path, "utf-8");
    const { frontmatter } = parseFrontmatter(content);
    expect((frontmatter.query_history as string[]).length).toBe(1);
    // But retrieved_at still grows
    expect((frontmatter.retrieved_at as string[]).length).toBe(2);
  });

  it("saves a model run to raw/models/", async () => {
    const path = await saveModelRun(
      "test-drug",
      { intervention: "nivolumab", comparator: "pembrolizumab", perspective: "nhs", model_type: "partsa" },
      "## CE Analysis\nICER: £48,250",
    );
    expect(path).toContain("models");
    const content = await readFile(path, "utf-8");
    const { frontmatter, body } = parseFrontmatter(content);
    expect(frontmatter.tool).toBe("models.cost_effectiveness");
    expect(frontmatter.intervention).toBe("nivolumab");
    expect(body).toContain("ICER");
  });

  it("saves a dossier to raw/dossiers/", async () => {
    const path = await saveDossier(
      "test-drug",
      "nice",
      "sta",
      { drug_name: "semaglutide", indication: "T2D" },
      "## NICE STA Draft",
    );
    expect(path).toContain("dossiers");
    expect(path).toContain("nice");
    const content = await readFile(path, "utf-8");
    const { frontmatter } = parseFrontmatter(content);
    expect(frontmatter.hta_body).toBe("nice");
    expect(frontmatter.submission_type).toBe("sta");
    expect(frontmatter.drug_name).toBe("semaglutide");
  });

  it("sanitizes project IDs", async () => {
    const path = await saveLiteratureResult("Test/Drug!!!", mockResult, "q");
    expect(path).not.toContain("/Test/");
    expect(path).toContain("test-drug");
  });
});
