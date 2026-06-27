export interface ConceptSpec {
  conditionTerms: string[];
  interventionTerms?: string[];
}

export interface ConceptBlock {
  embaseLines: string[];
  pubmedLines: string[];
  emtreeDraft: true;
}

const embaseLine = (term: string): string => `'${term}'/exp OR ${term}:ab,ti`;
const pubmedLine = (term: string): string => `"${term}"[MeSH] OR ${term}[tiab]`;

export function buildConceptBlock(spec: ConceptSpec): ConceptBlock {
  const terms = [...spec.conditionTerms, ...(spec.interventionTerms ?? [])];
  return {
    embaseLines: terms.map(embaseLine),
    pubmedLines: terms.map(pubmedLine),
    emtreeDraft: true,
  };
}