import { z } from "zod";
import type { ToolResult } from "../providers/types.js";
import { createAuditRecord, addSource } from "../audit/builder.js";

const CLINICALTRIALS_API_BASE = "https://clinicaltrials.gov/api/v2/studies";
const TOOL_NAME = "trial.enrollment_criteria";
const METHODOLOGY =
  "ClinicalTrials.gov API v2 — protocol section direct fetch";

const TrialEnrollmentCriteriaSchema = z.object({
  nct_id: z
    .string()
    .regex(/^NCT\d{8}$/)
    .describe("ClinicalTrials.gov identifier, e.g. NCT04184622"),
});

type TrialEnrollmentCriteriaInput = z.infer<
  typeof TrialEnrollmentCriteriaSchema
>;

interface ClinicalTrialsOutcome {
  measure?: string;
  description?: string;
  timeFrame?: string;
}

interface ClinicalTrialsEnrollmentInfo {
  count?: number;
  type?: string;
}

interface ClinicalTrialsEligibilityModule {
  eligibilityCriteria?: string;
  criteria?: string;
  sex?: string;
  minimumAge?: string;
  maximumAge?: string;
  minAge?: string;
  maxAge?: string;
  healthyVolunteers?: boolean;
}

interface ClinicalTrialsV2Study {
  protocolSection?: {
    identificationModule?: {
      nctId?: string;
      briefTitle?: string;
      officialTitle?: string;
    };
    designModule?: {
      phases?: string[];
      studyType?: string;
      enrollmentInfo?: ClinicalTrialsEnrollmentInfo;
    };
    eligibilityModule?: ClinicalTrialsEligibilityModule;
    outcomesModule?: {
      primaryOutcomes?: ClinicalTrialsOutcome[];
    };
    conditionsModule?: {
      conditions?: string[];
      keywords?: string[];
    };
  };
}

interface EligibilitySplit {
  inclusion: string;
  exclusion: string;
}

function formatMissing(value: string | undefined): string {
  return value && value.trim().length > 0 ? value.trim() : "Not reported";
}

function formatList(values: string[] | undefined): string {
  return values && values.length > 0 ? values.join(", ") : "Not reported";
}

function formatHealthyVolunteers(value: boolean | undefined): string {
  if (value === true) return "Yes";
  if (value === false) return "No";
  return "Not reported";
}

function formatEnrollment(
  enrollmentInfo: ClinicalTrialsEnrollmentInfo | undefined,
): string {
  if (!enrollmentInfo) return "Not reported";
  if (typeof enrollmentInfo.count === "number" && enrollmentInfo.type) {
    return `${enrollmentInfo.count} (${enrollmentInfo.type})`;
  }
  if (typeof enrollmentInfo.count === "number") {
    return String(enrollmentInfo.count);
  }
  return enrollmentInfo.type ?? "Not reported";
}

function stripCriteriaHeading(text: string, heading: RegExp): string {
  return text.replace(heading, "").trim();
}

function splitEligibilityCriteria(
  criteria: string | undefined,
): EligibilitySplit {
  const raw = criteria?.trim() ?? "";
  if (!raw) {
    return {
      inclusion: "Not reported in ClinicalTrials.gov record.",
      exclusion: "Not reported in ClinicalTrials.gov record.",
    };
  }

  const inclusionHeading =
    /(?:^|\n)\s*(?:key\s+|main\s+)?inclusion criteria\s*:?\s*/i;
  const exclusionHeading =
    /(?:^|\n)\s*(?:key\s+|main\s+)?exclusion criteria\s*:?\s*/i;
  const inclusionMatch = inclusionHeading.exec(raw);
  const exclusionMatch = exclusionHeading.exec(raw);

  if (inclusionMatch && exclusionMatch) {
    if (inclusionMatch.index < exclusionMatch.index) {
      return {
        inclusion: raw
          .slice(
            inclusionMatch.index + inclusionMatch[0].length,
            exclusionMatch.index,
          )
          .trim(),
        exclusion: raw
          .slice(exclusionMatch.index + exclusionMatch[0].length)
          .trim(),
      };
    }

    return {
      inclusion: raw
        .slice(inclusionMatch.index + inclusionMatch[0].length)
        .trim(),
      exclusion: raw
        .slice(
          exclusionMatch.index + exclusionMatch[0].length,
          inclusionMatch.index,
        )
        .trim(),
    };
  }

  if (inclusionMatch) {
    return {
      inclusion: raw
        .slice(inclusionMatch.index + inclusionMatch[0].length)
        .trim(),
      exclusion: "Not separately reported in ClinicalTrials.gov record.",
    };
  }

  if (exclusionMatch) {
    return {
      inclusion: "Not separately reported in ClinicalTrials.gov record.",
      exclusion: raw
        .slice(exclusionMatch.index + exclusionMatch[0].length)
        .trim(),
    };
  }

  return {
    inclusion: stripCriteriaHeading(raw, inclusionHeading),
    exclusion: "Not separately reported in ClinicalTrials.gov record.",
  };
}

function renderPrimaryOutcomes(
  primaryOutcomes: ClinicalTrialsOutcome[] | undefined,
): string[] {
  if (!primaryOutcomes || primaryOutcomes.length === 0) {
    return ["Not reported in ClinicalTrials.gov record."];
  }

  return primaryOutcomes.flatMap((outcome, index) => {
    const lines = [`### ${index + 1}. ${formatMissing(outcome.measure)}`];
    if (outcome.timeFrame) {
      lines.push(`**Time frame:** ${outcome.timeFrame}`);
    }
    if (outcome.description) {
      lines.push(`**Description:** ${outcome.description}`);
    }
    return lines;
  });
}

function notFoundMessage(nctId: string): string {
  return `NCT ID ${nctId} not found or ClinicalTrials.gov API unavailable. Verify the NCT number at https://clinicaltrials.gov/study/${nctId}`;
}

function renderTrialMarkdown(
  study: ClinicalTrialsV2Study,
  requestedNctId: string,
  apiUrl: string,
  fetchedAt: string,
): string {
  const protocol = study.protocolSection;
  const identity = protocol?.identificationModule;
  const design = protocol?.designModule;
  const eligibility = protocol?.eligibilityModule;
  const outcomes = protocol?.outcomesModule;
  const conditions = protocol?.conditionsModule;
  const criteria = splitEligibilityCriteria(
    eligibility?.eligibilityCriteria ?? eligibility?.criteria,
  );
  const nctId = identity?.nctId ?? requestedNctId;
  const studyUrl = `https://clinicaltrials.gov/study/${nctId}`;
  const minAge = eligibility?.minimumAge ?? eligibility?.minAge;
  const maxAge = eligibility?.maximumAge ?? eligibility?.maxAge;

  const lines: string[] = [
    "## Trial Identity",
    `**NCT ID:** ${nctId}`,
    `**Brief title:** ${formatMissing(identity?.briefTitle)}`,
    `**Official title:** ${formatMissing(identity?.officialTitle)}`,
    `**ClinicalTrials.gov URL:** ${studyUrl}`,
    "",
    "## Study Design",
    `**Study type:** ${formatMissing(design?.studyType)}`,
    `**Phase(s):** ${formatList(design?.phases)}`,
    `**Enrollment:** ${formatEnrollment(design?.enrollmentInfo)}`,
    `**Conditions:** ${formatList(conditions?.conditions)}`,
    `**Keywords:** ${formatList(conditions?.keywords)}`,
    `**Sex:** ${formatMissing(eligibility?.sex)}`,
    `**Minimum age:** ${formatMissing(minAge)}`,
    `**Maximum age:** ${formatMissing(maxAge)}`,
    `**Healthy volunteers:** ${formatHealthyVolunteers(eligibility?.healthyVolunteers)}`,
    "",
    "## Eligibility Criteria",
    "### Inclusion",
    "```text",
    criteria.inclusion,
    "```",
    "",
    "### Exclusion",
    "```text",
    criteria.exclusion,
    "```",
    "",
    "## Primary Outcomes",
    ...renderPrimaryOutcomes(outcomes?.primaryOutcomes),
    "",
    "## Audit",
    `**Tool:** ${TOOL_NAME}`,
    `**Methodology:** ${METHODOLOGY}`,
    `**Query:** ${requestedNctId}`,
    `**API URL:** ${apiUrl}`,
    `**Fetched at:** ${fetchedAt}`,
    "**Status:** ok",
  ];

  return lines.join("\n");
}

export async function handleTrialEnrollmentCriteria(
  rawInput: unknown,
): Promise<ToolResult> {
  const parsed = TrialEnrollmentCriteriaSchema.safeParse(rawInput);
  if (!parsed.success) {
    const messages = parsed.error.issues.map(
      (i) => `${i.path.join(".") || "input"}: ${i.message}`,
    );
    throw new Error(messages.join("\n"));
  }

  const input: TrialEnrollmentCriteriaInput = parsed.data;
  const auditInput = { nct_id: input.nct_id };
  let audit = createAuditRecord(
    TOOL_NAME,
    auditInput,
    "markdown",
    METHODOLOGY,
  );
  const apiUrl = `${CLINICALTRIALS_API_BASE}/${input.nct_id}?format=json`;
  const startedAt = Date.now();

  try {
    const response = await fetch(apiUrl, {
      signal: AbortSignal.timeout(15_000),
    });
    const latencyMs = Date.now() - startedAt;

    if (!response.ok) {
      audit = addSource(audit, {
        source: "ClinicalTrials.gov",
        query_sent: input.nct_id,
        results_returned: 0,
        results_included: 0,
        latency_ms: latencyMs,
        status: "failed",
        error: `HTTP ${response.status}`,
      });
      return { content: notFoundMessage(input.nct_id), audit };
    }

    const study = (await response.json()) as ClinicalTrialsV2Study;
    if (!study.protocolSection) {
      audit = addSource(audit, {
        source: "ClinicalTrials.gov",
        query_sent: input.nct_id,
        results_returned: 0,
        results_included: 0,
        latency_ms: latencyMs,
        status: "failed",
        error: "Missing protocolSection in ClinicalTrials.gov response",
      });
      return { content: notFoundMessage(input.nct_id), audit };
    }

    audit = addSource(audit, {
      source: "ClinicalTrials.gov",
      query_sent: input.nct_id,
      results_returned: 1,
      results_included: 1,
      latency_ms: latencyMs,
      status: "ok",
    });

    return {
      content: renderTrialMarkdown(
        study,
        input.nct_id,
        apiUrl,
        audit.timestamp,
      ),
      audit,
    };
  } catch (error) {
    audit = addSource(audit, {
      source: "ClinicalTrials.gov",
      query_sent: input.nct_id,
      results_returned: 0,
      results_included: 0,
      latency_ms: Date.now() - startedAt,
      status: "failed",
      error: error instanceof Error ? error.message : "Unknown fetch error",
    });
    return { content: notFoundMessage(input.nct_id), audit };
  }
}

export const trialEnrollmentCriteriaToolSchema = {
  name: TOOL_NAME,
  description:
    "Fetch enrollment/eligibility criteria for a clinical trial from ClinicalTrials.gov by NCT number. Returns structured eligibility criteria (inclusion/exclusion), primary outcomes, study design, and population description. Use this BEFORE building any trial-vs-real-world-population gap analysis. Always call this tool instead of using training-data knowledge about trial enrollment.",
  annotations: {
    title: "Trial Enrollment Criteria",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  inputSchema: {
    type: "object",
    properties: {
      nct_id: {
        type: "string",
        pattern: "^NCT\\d{8}$",
        description: "ClinicalTrials.gov identifier, e.g. NCT04184622",
      },
    },
    required: ["nct_id"],
  },
} as const;
