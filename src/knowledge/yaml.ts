export interface Frontmatter {
  [key: string]:
    | string
    | number
    | boolean
    | string[]
    | Date
    | Record<string, unknown>
    | null
    | undefined;
}

/**
 * Parse YAML frontmatter from a markdown string.
 * Returns { frontmatter, body } where body is the content after the frontmatter.
 * If no frontmatter present, returns { frontmatter: {}, body: content }.
 */
export function parseFrontmatter(content: string): {
  frontmatter: Frontmatter;
  body: string;
} {
  if (!content.startsWith("---\n") && !content.startsWith("---\r\n")) {
    return { frontmatter: {}, body: content };
  }
  const lines = content.split(/\r?\n/);
  // Find closing ---
  let endIdx = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === "---") {
      endIdx = i;
      break;
    }
  }
  if (endIdx === -1) return { frontmatter: {}, body: content };

  const yamlLines = lines.slice(1, endIdx);
  const rawBody = lines.slice(endIdx + 1).join("\n");
  // Strip a single leading newline that stringifyFrontmatter inserts
  const body = rawBody.startsWith("\n") ? rawBody.slice(1) : rawBody;
  const frontmatter = parseYamlLines(yamlLines);
  return { frontmatter, body };
}

function parseYamlLines(lines: string[]): Frontmatter {
  const result: Frontmatter = {};
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim() || line.trim().startsWith("#")) {
      i++;
      continue;
    }

    // Key: value pattern
    const match = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*):\s*(.*)$/);
    if (!match) {
      i++;
      continue;
    }
    const key = match[1];
    const rawValue = match[2].trim();

    if (rawValue === "" || rawValue === "|" || rawValue === ">") {
      // Multi-line or array follows. Check next line indentation.
      const items: string[] = [];
      let j = i + 1;
      while (j < lines.length && lines[j].startsWith("  ")) {
        const itemLine = lines[j].trim();
        if (itemLine.startsWith("- ")) {
          items.push(parseScalar(itemLine.slice(2).trim()) as string);
        }
        j++;
      }
      if (items.length > 0) result[key] = items;
      else result[key] = "";
      i = j;
    } else {
      result[key] = parseScalar(rawValue);
      i++;
    }
  }
  return result;
}

function parseScalar(value: string): string | number | boolean | null {
  const trimmed = value.trim();
  if (trimmed === "null" || trimmed === "~" || trimmed === "") return null;
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  // Number
  if (/^-?\d+$/.test(trimmed)) return parseInt(trimmed, 10);
  if (/^-?\d*\.\d+$/.test(trimmed)) return parseFloat(trimmed);
  // Quoted string
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

/**
 * Serialize a Frontmatter object + body into a markdown string with YAML frontmatter.
 */
export function stringifyFrontmatter(
  frontmatter: Frontmatter,
  body: string,
): string {
  const lines: string[] = ["---"];
  for (const [key, value] of Object.entries(frontmatter)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      if (value.length === 0) continue;
      lines.push(`${key}:`);
      value.forEach((item) => lines.push(`  - ${stringifyScalar(item)}`));
    } else if (value instanceof Date) {
      lines.push(`${key}: ${value.toISOString()}`);
    } else if (typeof value === "object") {
      // Skip nested objects for now (v1 limitation)
      continue;
    } else {
      lines.push(
        `${key}: ${stringifyScalar(value as string | number | boolean)}`,
      );
    }
  }
  lines.push("---");
  lines.push("");
  lines.push(body);
  return lines.join("\n");
}

function stringifyScalar(value: string | number | boolean): string {
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return String(value);
  // String — quote if contains special chars
  const str = String(value);
  if (/[:#\[\]{}&*!|>'"%@`,\n]/.test(str) || str.includes("  ")) {
    return `"${str.replace(/"/g, '\\"')}"`;
  }
  return str;
}
