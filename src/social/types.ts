/**
 * Types for the social-listening tools.
 *
 *   pv.social_listening_triage      — GVP Module VI reportability triage of
 *                                     already-collected social posts.
 *   rwe.social_listening_protocol   — generates a study protocol + compliance
 *                                     checklist for a social-listening study.
 *
 * The triage tool does NOT scrape and does NOT run NLP — the calling model
 * supplies the per-post structured assessment (which of the four ICSR
 * elements are present, sentiment, themes). The tool applies the
 * deterministic reportability rules, tallies, and surfaces obligations.
 *
 * See design log #19.
 */

/** GVP Module VI: the four elements of a valid ICSR. */
export interface IcsrElements {
  identifiable_reporter: boolean;
  identifiable_patient: boolean;
  suspect_product: boolean;
  adverse_event: boolean;
}

export type Sentiment = "positive" | "neutral" | "negative" | "mixed";

export type ReportabilityClass =
  | "valid_icsr" // all four elements present → reportable ICSR
  | "potential_ae_followup" // product + event present, missing patient/reporter
  | "not_reportable" // no event and/or no suspect product
  | "non_ae_insight"; // explicitly no AE — usable as qualitative insight only

export interface SocialPostInput {
  id: string;
  elements: IcsrElements;
  sentiment?: Sentiment;
  themes?: string[];
  adverse_event_terms?: string[];
  serious?: boolean;
  verbatim_excerpt?: string;
}

export interface PostTriage {
  id: string;
  classification: ReportabilityClass;
  missing_elements: (keyof IcsrElements)[];
  serious: boolean;
  recommended_action: string;
  reporting_deadline_days: number | null;
}

export interface SocialTriageResult {
  drug: string;
  indication: string;
  platform: string;
  total_posts: number;
  counts: Record<ReportabilityClass, number>;
  reportable_icsr_count: number;
  serious_icsr_count: number;
  sentiment_distribution: Record<Sentiment, number>;
  theme_tally: { theme: string; count: number }[];
  adverse_event_tally: { term: string; count: number }[];
  per_post: PostTriage[];
  pv_obligations: string[];
  warnings: string[];
}

export interface SocialTriageInput {
  drug: string;
  indication: string;
  platform: string;
  posts: SocialPostInput[];
}

// ── Protocol generator ──────────────────────────────────────────────────────

export type SocialObjective =
  | "patient_experience"
  | "sentiment"
  | "adverse_event_monitoring"
  | "unmet_need"
  | "treatment_adherence"
  | "disease_awareness";

export type SocialPlatform =
  | "x_twitter"
  | "reddit"
  | "facebook"
  | "instagram"
  | "patient_forums"
  | "youtube"
  | "tiktok"
  | "blogs";

export type PrivacyJurisdiction = "eu_gdpr" | "us_hipaa" | "uk_gdpr" | "global";

export interface ProtocolSection {
  heading: string;
  items: string[];
}

export interface SocialProtocolResult {
  drug: string;
  indication: string;
  objectives: SocialObjective[];
  platforms: SocialPlatform[];
  sections: ProtocolSection[];
  compliance_checklist: { item: string; mandatory: boolean }[];
  limitations: string[];
  warnings: string[];
}

export interface SocialProtocolInput {
  drug: string;
  indication: string;
  objectives: SocialObjective[];
  platforms: SocialPlatform[];
  privacy_jurisdictions: PrivacyJurisdiction[];
  keywords: string[];
  time_window_months?: number;
  is_mah_managed_channel: boolean;
}

// ── Live collection (rwe.social_collect, design log #45) ────────────────────

export interface CollectedPost {
  id: string; // Reddit fullname "t3_…" — stable diff key for monitoring
  source_url: string; // permalink (audit-back; identifying — flagged in governance)
  channel?: string; // Reddit: subreddit name; Bluesky: omitted
  author_pseudonym: string; // truncated SHA-256 of handle — NEVER the raw username
  created_at: string; // ISO 8601
  title: string;
  body: string; // selftext
  score: number;
  num_comments: number;
}

export interface SocialCollectGovernance {
  public_data_only: true;
  pseudonymized: true;
  persisted: false;
  gvp_module_vi: string;
}

export interface SocialCollectResult {
  drug: string;
  indication?: string;
  platform: "reddit" | "bluesky";
  query_used: string; // exact query string — auditability + monitoring hook
  fetched_at: string; // ISO — monitoring hook
  total_collected: number;
  posts: CollectedPost[];
  governance: SocialCollectGovernance;
  warnings: string[];
}

export interface SocialCollectInput {
  drug: string;
  brand_names: string[];
  indication?: string;
  platform: "reddit" | "bluesky";
  subreddits: string[];
  keywords: string[];
  time_window: "day" | "week" | "month" | "year" | "all";
  sort: "relevance" | "new" | "top";
  max_posts: number;
}
