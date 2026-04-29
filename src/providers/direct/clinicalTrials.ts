import type { LiteratureResult } from "../types.js";

const BASE = "https://clinicaltrials.gov/api/v2/studies";

interface CTStudy {
  protocolSection: {
    identificationModule: {
      nctId: string;
      briefTitle: string;
      officialTitle?: string;
    };
    statusModule: { startDateStruct?: { date: string } };
    descriptionModule?: { briefSummary?: string };
    contactsLocationsModule?: { overallOfficials?: { name: string }[] };
    designModule?: { studyType?: string };
  };
}

export async function fetchClinicalTrials(
  query: string,
  maxResults: number,
): Promise<LiteratureResult[]> {
  try {
    const url = `${BASE}?query.term=${encodeURIComponent(query)}&pageSize=${maxResults}&format=json`;
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return [];

    const data = (await res.json()) as { studies: CTStudy[] };
    return (data.studies ?? []).map((study) => {
      const id = study.protocolSection.identificationModule;
      const desc = study.protocolSection.descriptionModule;
      const contacts = study.protocolSection.contactsLocationsModule;
      return {
        id: `ct_${id.nctId}`,
        source: "clinicaltrials" as const,
        title: id.briefTitle,
        authors: contacts?.overallOfficials?.map((o) => o.name) ?? [],
        date: study.protocolSection.statusModule.startDateStruct?.date ?? "",
        study_type:
          study.protocolSection.designModule?.studyType?.toLowerCase() ??
          "unknown",
        abstract: desc?.briefSummary ?? "",
        url: `https://clinicaltrials.gov/study/${id.nctId}`,
      };
    });
  } catch {
    return [];
  }
}
