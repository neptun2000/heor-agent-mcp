import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { getProjectRoot } from "./paths.js";

export interface SearchMatch {
  file: string;           // path relative to project root (e.g. "raw/literature/pubmed_123.md")
  line_number: number;
  snippet: string;        // the matching line with ~80 chars context
  score: number;          // simple relevance score
  title?: string;         // from frontmatter if available
  source?: string;        // from frontmatter
}

export interface SearchOptions {
  paths?: Array<"raw" | "wiki">;  // which subtrees to search, default both
  max_results?: number;            // default 20
  case_sensitive?: boolean;        // default false
}

/**
 * Search project files for a query. Returns matches with snippets.
 * Case-insensitive by default. Multi-term queries match any term (OR).
 */
export async function searchProject(
  projectId: string,
  query: string,
  options: SearchOptions = {},
): Promise<SearchMatch[]> {
  const { paths = ["raw", "wiki"], max_results = 20, case_sensitive = false } = options;
  const projectRoot = getProjectRoot(projectId);

  // Tokenize query into terms
  const terms = query.trim().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [];

  const matches: SearchMatch[] = [];

  for (const subtree of paths) {
    const dirPath = join(projectRoot, subtree);
    try {
      const files = await walkMarkdownFiles(dirPath);
      for (const filePath of files) {
        const fileMatches = await searchFile(filePath, projectRoot, terms, case_sensitive);
        matches.push(...fileMatches);
      }
    } catch {
      // Directory doesn't exist yet — skip
    }
  }

  // Sort by score desc, then file path asc for stability
  matches.sort((a, b) => b.score - a.score || a.file.localeCompare(b.file));
  return matches.slice(0, max_results);
}

async function walkMarkdownFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        const nested = await walkMarkdownFiles(full);
        out.push(...nested);
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        out.push(full);
      }
    }
  } catch {
    // directory not accessible — return empty
  }
  return out;
}

async function searchFile(
  filePath: string,
  projectRoot: string,
  terms: string[],
  caseSensitive: boolean,
): Promise<SearchMatch[]> {
  let content: string;
  try {
    content = await readFile(filePath, "utf-8");
  } catch {
    return [];
  }

  const lines = content.split("\n");
  const haystackTerms = caseSensitive ? terms : terms.map(t => t.toLowerCase());
  const matches: SearchMatch[] = [];
  const relFile = relative(projectRoot, filePath);

  // Extract title and source from frontmatter (simple regex, no full parse)
  let title: string | undefined;
  let source: string | undefined;
  for (let i = 0; i < Math.min(lines.length, 30); i++) {
    const line = lines[i];
    if (line.startsWith("title:")) title = line.slice(6).trim().replace(/^["']|["']$/g, "");
    if (line.startsWith("source:")) source = line.slice(7).trim().replace(/^["']|["']$/g, "");
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const haystack = caseSensitive ? line : line.toLowerCase();

    let matchCount = 0;
    for (const term of haystackTerms) {
      if (haystack.includes(term)) matchCount++;
    }

    if (matchCount > 0) {
      // Snippet: trim line to ~200 chars, centered around first match if possible
      const firstTerm = haystackTerms.find(t => haystack.includes(t));
      let snippet = line;
      if (line.length > 200 && firstTerm) {
        const idx = haystack.indexOf(firstTerm);
        const start = Math.max(0, idx - 80);
        const end = Math.min(line.length, idx + firstTerm.length + 80);
        snippet = (start > 0 ? "..." : "") + line.slice(start, end) + (end < line.length ? "..." : "");
      }
      matches.push({
        file: relFile,
        line_number: i + 1,
        snippet: snippet.trim(),
        score: matchCount,
        title,
        source,
      });
    }
  }

  return matches;
}
