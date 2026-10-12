// Bounds + validation for skill config. Used at write time (save-skill, strict)
// and at read time (run-skill, lenient: anything already in the DB is re-bounded).
import { checkUrl, normalizeHost } from "./deno-utils.ts";

export const SKILL_LIMITS = {
  name: 120,
  markdown: 10_000,
  schedule: 100,
  caresAbout: 500,
  skip: 500,
  output: 1000,
  sources: 8,
  query: 200,
  url: 2048,
  keepMin: 1,
  keepMax: 20,
};

export const SOURCE_TYPES = ["hn", "rss", "arxiv", "reddit"] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

export const REDDIT_HOSTS = new Set(["reddit.com", "www.reddit.com", "old.reddit.com"]);

export interface SkillSource {
  type: SourceType;
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

/** Returns the cleaned source, or a reason string when the source must be rejected. */
export function validateSource(raw: unknown): SkillSource | string {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return "source must be an object";
  const src = raw as Record<string, unknown>;
  const type = src.type;
  if (typeof type !== "string" || !(SOURCE_TYPES as readonly string[]).includes(type)) {
    return `unknown source type "${String(type ?? "").slice(0, 20)}"`;
  }
  if (type === "hn" || type === "arxiv") {
    const query = src.query ?? "";
    if (typeof query !== "string") return `${type}: query must be text`;
    if (query.length > SKILL_LIMITS.query) return `${type}: query longer than ${SKILL_LIMITS.query} characters`;
    return { type, query };
  }
  const url = src.url;
  if (typeof url !== "string" || !url) return `${type}: url required`;
  if (url.length > SKILL_LIMITS.url) return `${type}: url longer than ${SKILL_LIMITS.url} characters`;
  const blocked = checkUrl(url);
  if (blocked) return `${type}: ${blocked}`;
  if (type === "reddit" && !REDDIT_HOSTS.has(normalizeHost(new URL(url).hostname))) {
    return "reddit: host must be reddit.com, www.reddit.com or old.reddit.com";
  }
  return { type: type as SourceType, url };
}

function str(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

/** Lenient read-time bounding for config already stored in the DB. */
export function boundConfigForRun(raw: unknown): SkillConfig & { rejected: string[] } {
  const config = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const rawSources = Array.isArray(config.sources) ? config.sources.slice(0, SKILL_LIMITS.sources) : [];
  const sources: SkillSource[] = [];
  const rejected: string[] = [];
  for (const s of rawSources) {
    const v = validateSource(s);
    if (typeof v === "string") rejected.push(v);
    else sources.push(v);
  }
  const keepNum = Number(config.keep ?? 6);
  const keep = Number.isFinite(keepNum)
    ? Math.min(SKILL_LIMITS.keepMax, Math.max(SKILL_LIMITS.keepMin, Math.floor(keepNum)))
    : 6;
  return {
    sources,
    rejected,
    keep,
    cares_about: str(config.cares_about).slice(0, SKILL_LIMITS.caresAbout),
    skip: str(config.skip).slice(0, SKILL_LIMITS.skip),
    output: str(config.output).slice(0, SKILL_LIMITS.output),
  };
}

/** Strict write-time validation. Returns the cleaned config or an error message (422). */
export function validateConfigForSave(raw: unknown): SkillConfig | string {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return "config must be an object";
  const config = raw as Record<string, unknown>;
  if (!Array.isArray(config.sources)) return "config.sources must be a list";
  if (config.sources.length > SKILL_LIMITS.sources) return `At most ${SKILL_LIMITS.sources} sources`;
  const sources: SkillSource[] = [];
  for (const s of config.sources) {
    const v = validateSource(s);
    if (typeof v === "string") return `Invalid source: ${v}`;
    sources.push(v);
  }
  const keep = config.keep;
  if (typeof keep !== "number" || !Number.isInteger(keep) || keep < SKILL_LIMITS.keepMin || keep > SKILL_LIMITS.keepMax) {
    return `keep must be a whole number between ${SKILL_LIMITS.keepMin} and ${SKILL_LIMITS.keepMax}`;
  }
  const fields: [keyof SkillConfig, number][] = [
    ["cares_about", SKILL_LIMITS.caresAbout],
    ["skip", SKILL_LIMITS.skip],
    ["output", SKILL_LIMITS.output],
  ];
  for (const [key, max] of fields) {
    const v = config[key] ?? "";
    if (typeof v !== "string") return `${key} must be text`;
    if (v.length > max) return `${key} must be ${max} characters or fewer`;
  }
  return {
    sources,
    keep,
    cares_about: str(config.cares_about),
    skip: str(config.skip),
    output: str(config.output),
  };
}
