import type { LiteratureResult } from "../types.js";

const BASE = "https://www.ebi.ac.uk/chembl/api/data";

interface ChemblMolecule {
  molecule_chembl_id: string;
  pref_name: string | null;
  molecule_type: string;
  first_approval: number | null;
  molecule_properties: { full_mwt: string } | null;
}

export async function fetchChembl(
  query: string,
  maxResults: number,
): Promise<LiteratureResult[]> {
  try {
    const url = `${BASE}/molecule.json?pref_name__icontains=${encodeURIComponent(query)}&limit=${maxResults}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return [];

    const data = (await res.json()) as { molecules: ChemblMolecule[] };
    return (data.molecules ?? []).map((mol) => ({
      id: `chembl_${mol.molecule_chembl_id}`,
      source: "chembl" as const,
      title: mol.pref_name ?? mol.molecule_chembl_id,
      authors: [],
      date: mol.first_approval ? `${mol.first_approval}` : "",
      study_type: "compound_data",
      abstract: `${mol.molecule_type ?? "Molecule"} — MW: ${mol.molecule_properties?.full_mwt ?? "unknown"}`,
      url: `https://www.ebi.ac.uk/chembl/compound_report_card/${mol.molecule_chembl_id}/`,
    }));
  } catch {
    return [];
  }
}
