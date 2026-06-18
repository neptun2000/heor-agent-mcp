/**
 * Pure GVP Module VI reportability triage for social-listening posts.
 * No I/O, no NLP — applies the deterministic four-element ICSR test to the
 * structured assessment the caller supplies for each post, then tallies.
 *
 * GVP Module VI rev 2: a valid individual case safety report (ICSR)
 * requires FOUR elements — an identifiable reporter, an identifiable
 * patient, a suspect medicinal product, and an adverse event/reaction.
 * For digital media that the marketing-authorisation holder sponsors or
 * manages, any post meeting all four must be reported (15 calendar days
 * for serious, 90 for non-serious). Posts with a product + event but a
 * missing patient or reporter warrant follow-up to try to validate.
 */
import type {
  IcsrElements,
  SocialPostInput,
  SocialTriageInput,
  SocialTriageResult,
  PostTriage,
  ReportabilityClass,
  Sentiment,
} from "./types.js";

const ELEMENT_KEYS: (keyof IcsrElements)[] = [
  "identifiable_reporter",
  "identifiable_patient",
  "suspect_product",
  "adverse_event",
];

function classifyPost(post: SocialPostInput): PostTriage {
  const e = post.elements;
  const missing = ELEMENT_KEYS.filter((k) => !e[k]);
  const serious = post.serious ?? false;

  let classification: ReportabilityClass;
  let recommended_action: string;
  let reporting_deadline_days: number | null = null;

  if (e.suspect_product && e.adverse_event && e.identifiable_patient && e.identifiable_reporter) {
    classification = "valid_icsr";
    reporting_deadline_days = serious ? 15 : 90;
    recommended_action = `Valid ICSR — enter into the safety database and report within ${reporting_deadline_days} calendar days (${serious ? "serious" : "non-serious"}). Do not contact the poster beyond approved follow-up channels.`;
  } else if (e.suspect_product && e.adverse_event) {
    classification = "potential_ae_followup";
    recommended_action = `Potential AE missing ${missing.join(" + ")} — attempt approved follow-up to obtain a valid ICSR; log the follow-up attempt regardless of outcome.`;
  } else if (!e.adverse_event && (e.suspect_product || post.themes?.length)) {
    classification = "non_ae_insight";
    recommended_action =
      "No adverse event — not reportable; usable as qualitative patient-experience/sentiment insight only.";
  } else {
    classification = "not_reportable";
    recommended_action =
      "Does not meet AE/product criteria — not reportable and not usable as a product insight.";
  }

  return {
    id: post.id,
    classification,
    missing_elements: missing,
    serious,
    recommended_action,
    reporting_deadline_days,
  };
}

function emptySentiment(): Record<Sentiment, number> {
  return { positive: 0, neutral: 0, negative: 0, mixed: 0 };
}

function tally(items: string[]): { key: string; count: number }[] {
  const m = new Map<string, number>();
  for (const raw of items) {
    const k = raw.trim();
    if (!k) continue;
    m.set(k.toLowerCase(), (m.get(k.toLowerCase()) ?? 0) + 1);
  }
  // Preserve first-seen display label.
  const label = new Map<string, string>();
  for (const raw of items) {
    const k = raw.trim().toLowerCase();
    if (k && !label.has(k)) label.set(k, raw.trim());
  }
  return [...m.entries()]
    .map(([k, count]) => ({ key: label.get(k) ?? k, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

export function triageSocialPosts(
  input: SocialTriageInput,
): SocialTriageResult {
  const per_post = input.posts.map(classifyPost);

  const counts: Record<ReportabilityClass, number> = {
    valid_icsr: 0,
    potential_ae_followup: 0,
    not_reportable: 0,
    non_ae_insight: 0,
  };
  for (const p of per_post) counts[p.classification]++;

  const reportable_icsr_count = counts.valid_icsr;
  const serious_icsr_count = per_post.filter(
    (p) => p.classification === "valid_icsr" && p.serious,
  ).length;

  const sentiment_distribution = emptySentiment();
  for (const post of input.posts) {
    if (post.sentiment) sentiment_distribution[post.sentiment]++;
  }

  const theme_tally = tally(input.posts.flatMap((p) => p.themes ?? [])).map(
    (t) => ({ theme: t.key, count: t.count }),
  );
  const adverse_event_tally = tally(
    input.posts.flatMap((p) => p.adverse_event_terms ?? []),
  ).map((t) => ({ term: t.key, count: t.count }));

  const pv_obligations: string[] = [];
  if (reportable_icsr_count > 0) {
    pv_obligations.push(
      `${reportable_icsr_count} valid ICSR(s) detected — the reporting clock has started: 15 calendar days for serious cases, 90 for non-serious (GVP Module VI rev 2).`,
    );
    if (serious_icsr_count > 0) {
      pv_obligations.push(
        `${serious_icsr_count} serious ICSR(s) — expedite to the QPPV / safety database immediately; 15-day clock.`,
      );
    }
    pv_obligations.push(
      "Enter cases into EudraVigilance / FAERS per jurisdiction; record source as digital media; do not de-anonymise or contact posters outside approved follow-up channels.",
    );
  }
  if (counts.potential_ae_followup > 0) {
    pv_obligations.push(
      `${counts.potential_ae_followup} potential AE(s) need follow-up to validate — log every follow-up attempt (success or not) for the audit trail.`,
    );
  }

  const warnings: string[] = [];
  warnings.push(
    "Social-listening evidence is low-validity (selection bias, non-representative and unverifiable users, bots). Use sentiment/theme output as hypothesis-generating qualitative insight, not as effectiveness or incidence evidence.",
  );
  warnings.push(
    "Reportability here depends entirely on the four-element assessment supplied per post — verify each against the verbatim source before reporting. This tool applies the rule; it does not read the posts.",
  );
  if (
    reportable_icsr_count === 0 &&
    counts.potential_ae_followup === 0 &&
    input.posts.length > 0
  ) {
    warnings.push(
      "No AE-bearing posts in this batch — if the search keywords did not include symptom/side-effect terms, AE under-capture is likely; revisit the search strategy.",
    );
  }

  return {
    drug: input.drug,
    indication: input.indication,
    platform: input.platform,
    total_posts: input.posts.length,
    counts,
    reportable_icsr_count,
    serious_icsr_count,
    sentiment_distribution,
    theme_tally,
    adverse_event_tally,
    per_post,
    pv_obligations,
    warnings,
  };
}
