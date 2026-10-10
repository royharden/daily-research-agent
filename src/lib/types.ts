// Shared frontend types for Morning Brief.

export interface SkillSource {
  type: "hn" | "rss" | "arxiv" | "reddit";
  query?: string;
  url?: string;
}

export interface SkillConfig {
  sources: SkillSource[];
  keep: number;
  cares_about: string;
  skip: string;
  output: string;
}

export interface Skill {
  id: string;
  slug: string;
  name: string;
  markdown: string;
  config: SkillConfig;
  schedule: string;
  active: boolean;
  created_at: string;
}

export interface RunCounts {
  fetched: number;
  deduped: number;
  sent_to_jev: number;
  kept: number;
}

export interface Run {
  id: string;
  skill_id: string;
  status: "running" | "success" | "error" | "limit";
  counts: RunCounts;
  jev_cost_usd: number;
  latency_ms: number | null;
  error: string | null;
  started_at: string;
  finished_at: string | null;
}

export interface Item {
  id: string;
  run_id: string;
  skill_id: string;
  url: string;
  title: string;
  source: string;
  summary: string;
  jev_response: {
    relevance: number;
    substance: number;
    skip_p: number;
    kind: string;
    scored_by: string;
  } | null;
  relevance: number | null;
  substance: number | null;
  skip_p: number | null;
  kind: string | null;
  score: number | null;
  kept: boolean;
  drop_reason: string | null;
  created_at: string;
}

export interface DigestContent {
  headline: string;
  bullets: { text: string; item_url: string }[];
  full_read: { item_url: string; why: string } | null;
  themes: string[];
}

export interface Digest {
  id: string;
  slug: string;
  run_id: string | null;
  skill_id: string | null;
  content: DigestContent;
  writer_mode: "llm" | "mock";
  created_at: string;
}

export type WriterMode = "live" | "mock" | "offline";
