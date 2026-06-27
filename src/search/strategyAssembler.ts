import type { StrategyInput, NumberedLine, AssembledStrategy } from "./types.js";

/**
 * Deterministic numbered-line ledger. Emits each term line, OR-combines a
 * multi-line block into a single combine line, then AND/NOT-combines the
 * named blocks. Matches the structure of every real Embase strategy in
 * design-log #44 (concept → strand → exclusion → optional age/date/language).
 */
export function assembleStrategy(input: StrategyInput): AssembledStrategy {
  const lines: NumberedLine[] = [];
  let n = 0;
  const push = (query: string): number => {
    n += 1;
    lines.push({ n, query });
    return n;
  };
  // Emit a block's term lines, then (if >1) an OR-combine line. Returns the
  // line number that represents the whole block.
  const emitBlock = (block: string[]): number => {
    const nums = block.map((line) => push(line));
    if (nums.length === 1) return nums[0];
    return push(nums.map((x) => `#${x}`).join(" OR "));
  };

  const conceptRef = emitBlock(input.conceptLines);
  const strandRef = emitBlock(input.strandFilter);
  let currentRef = push(`#${conceptRef} AND #${strandRef}`);

  const exclusionRef = emitBlock(input.exclusionLines);
  currentRef = push(`#${currentRef} NOT #${exclusionRef}`);

  if (input.ageLimit) {
    const ageRef = push(input.ageLimit);
    currentRef = push(`#${currentRef} AND #${ageRef}`);
  }
  if (input.dateLimit) {
    currentRef = push(`#${currentRef} AND ${input.dateLimit}`);
  }
  if (input.languageLimit) {
    currentRef = push(`#${currentRef} AND ${input.languageLimit}`);
  }

  return { lines, finalLineNumber: n };
}
