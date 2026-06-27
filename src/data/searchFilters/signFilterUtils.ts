/** Detect Ovid/EBSCO boolean-combine lines (not standalone search terms). */
const BOOLEAN_LINE =
  /^(or\/|and\/|# Query|S\d+\s|\d+\s+(or|not|and)\b)/i;

export function isSignBooleanLine(query: string): boolean {
  return BOOLEAN_LINE.test(query.trim());
}

/** Collapse a multi-line SIGN filter into one OR line for the outer strategy assembler. */
export function collapseSignFilterToOrLine(lines: string[]): string {
  const terms = lines.filter((line) => !isSignBooleanLine(line));
  if (terms.length === 0) {
    return lines[lines.length - 1] ?? "";
  }
  if (terms.length === 1) {
    return terms[0];
  }
  return `(${terms.join(" OR ")})`;
}