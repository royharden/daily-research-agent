// Tiny YAML-subset parser for skill front-matter. Supports:
// key: value, key: "value", nested lists of maps (- type: x \n   url: y),
// and scalars. Not a general YAML parser.
import type { SkillConfig, SkillSource } from "./types";

// Mirrors the server-side bounds in supabase/functions/_shared/skill-config.ts.
export const SKILL_LIMITS = { name: 120, markdown: 10_000, sources: 8, query: 200, url: 2048, caresAbout: 500, skip: 500, output: 1000 };
const REDDIT_HOSTS = ["reddit.com", "www.reddit.com", "old.reddit.com"];

function sourceUrlError(type: string, url: string): string | null {
  if (url.length > SKILL_LIMITS.url) return `Source type ${type} url must be ${SKILL_LIMITS.url} characters or fewer`;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return `Source type ${type} url is not a valid URL`;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return `Source type ${type} url must start with http:// or https://`;
  if (type === "reddit" && !REDDIT_HOSTS.includes(u.hostname.toLowerCase().replace(/\.+$/, ""))) {
    return "Source type reddit url must be on reddit.com, www.reddit.com or old.reddit.com";
  }
  return null;
}

export interface ParsedSkill {
  frontmatter: Record<string, unknown>;
  config: SkillConfig;
  body: string;
  errors: string[];
}

export function parseFrontmatter(markdown: string): { meta: Record<string, unknown>; body: string } | { error: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(markdown);
  if (!m) return { error: "Front-matter must start and end with ---" };
  const [, yamlRaw, body] = m;
  const meta: Record<string, unknown> = {};
  const lines = yamlRaw.split(/\r?\n/);
  let i = 0;
  let currentKey: string | null = null;
  let currentList: unknown[] | null = null;

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim() || line.trim().startsWith("#")) {
      i++;
      continue;
    }
    const listItem = /^\s+-\s+(.*)$/.exec(line);
    if (listItem && currentKey && currentList) {
      const rest = listItem[1];
      if (rest.includes(":")) {
        // inline map start: "- type: hn" — subsequent indented lines add keys
        const map: Record<string, string> = {};
        const kv = /^([^:]+):\s*(.*)$/.exec(rest);
        if (kv) map[kv[1].trim()] = unquote(kv[2].trim());
        i++;
        // consume indented continuation lines
        while (i < lines.length) {
          const cont = /^\s{2,}([^:#]+):\s*(.*)$/.exec(lines[i]);
          if (!cont) break;
          map[cont[1].trim()] = unquote(cont[2].trim());
          i++;
        }
        currentList.push(map);
        continue;
      }
      currentList.push(unquote(rest.trim()));
      i++;
      continue;
    }
    const kv = /^([^:\s][^:]*):\s*(.*)$/.exec(line);
    if (!kv) {
      return { error: `Cannot parse line: "${line}"` };
    }
    const key = kv[1].trim();
    const value = kv[2].trim();
    if (value === "") {
      currentKey = key;
      currentList = [];
      meta[key] = currentList;
      i++;
    } else {
      currentKey = null;
      currentList = null;
      meta[key] = unquote(value);
      i++;
    }
  }

  return { meta, body };
}

function unquote(s: string): string {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

export function parseSkill(markdown: string): ParsedSkill {
  const errors: string[] = [];
  const parsed = parseFrontmatter(markdown);
  if ("error" in parsed) {
    return {
      frontmatter: {},
      config: { sources: [], keep: 6, cares_about: "", skip: "", output: "" },
      body: markdown,
      errors: [parsed.error],
    };
  }
  const { meta, body } = parsed;

  const sources: SkillSource[] = [];
  if (Array.isArray(meta.sources)) {
    for (const s of meta.sources) {
      if (typeof s === "string") {
        // "- https://..." shorthand -> rss
        if (/^https?:\/\//.test(s)) sources.push({ type: "rss", url: s });
        continue;
      }
      if (s && typeof s === "object") {
        const obj = s as Record<string, string>;
        const type = obj.type as SkillSource["type"];
        if (!["hn", "rss", "arxiv", "reddit"].includes(type)) {
          errors.push(`Unknown source type "${obj.type}" (use hn, rss, arxiv, or reddit)`);
          continue;
        }
        if (type === "rss" || type === "reddit") {
          const urlError = obj.url ? sourceUrlError(type, obj.url) : null;
          if (!obj.url) errors.push(`Source type ${type} needs a url`);
          else if (urlError) errors.push(urlError);
          else sources.push({ type, url: obj.url });
        } else {
          if (!obj.query) errors.push(`Source type ${type} needs a query`);
          else if (obj.query.length > SKILL_LIMITS.query) errors.push(`Source type ${type} query must be ${SKILL_LIMITS.query} characters or fewer`);
          else sources.push({ type, query: obj.query });
        }
      }
    }
    if (sources.length > SKILL_LIMITS.sources) errors.push(`sources: at most ${SKILL_LIMITS.sources} sources`);
  } else {
    errors.push("sources: must be a list (each - type: hn/rss/arxiv/reddit)");
  }

  const keep = Number(meta.keep ?? 6);
  if (!Number.isInteger(keep) || keep < 1 || keep > 12) errors.push("keep: must be a number between 1 and 12");
  if (String(meta.name ?? "").length > SKILL_LIMITS.name) errors.push(`name: must be ${SKILL_LIMITS.name} characters or fewer`);
  if (markdown.length > SKILL_LIMITS.markdown) errors.push(`Skill is too long (max ${SKILL_LIMITS.markdown.toLocaleString()} characters)`);

  const schedule = String(meta.schedule ?? "0 7 * * *");
  if (!isValidCron(schedule)) errors.push(`schedule: "${schedule}" is not a valid 5-field cron expression`);

  // body sections
  const section = (title: string): string => {
    const re = new RegExp(`^##\\s+${title}\\s*\\n([\\s\\S]*?)(?=\\n##\\s|$)`, "im");
    const m = re.exec(body);
    return m ? m[1].trim() : "";
  };

  let cares = section("What I care about");
  const skip = section("Skip");
  const output = section("Output");
  if (!cares) {
    // accept "What I care about" fallbacks: any ## section containing "care"
    const alt = /^##\s+([^\n]*care[^\n]*)\n([\s\S]*?)(?=\n##\s|$)/im.exec(body);
    if (alt) cares = alt[2].trim();
  }
  if (!cares) errors.push('Add a "## What I care about" section — Jev needs it');
  if (!output) errors.push('Add an "## Output" section — the writer uses it');
  if (cares.length > SKILL_LIMITS.caresAbout) errors.push(`"What I care about" must be ${SKILL_LIMITS.caresAbout} characters or fewer`);
  if (skip.length > SKILL_LIMITS.skip) errors.push(`"Skip" must be ${SKILL_LIMITS.skip} characters or fewer`);
  if (output.length > SKILL_LIMITS.output) errors.push(`"Output" must be ${SKILL_LIMITS.output} characters or fewer`);

  return {
    frontmatter: meta,
    config: { sources, keep: Number.isFinite(keep) ? keep : 6, cares_about: cares, skip, output },
    body,
    errors,
  };
}

export function isValidCron(expr: string): boolean {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  const ranges = [
    [0, 59],
    [0, 23],
    [1, 31],
    [1, 12],
    [0, 6],
  ];
  return parts.every((p, idx) => {
    const [lo, hi] = ranges[idx];
    if (p === "*") return true;
    return p.split(",").every((piece) => {
      let base = piece;
      if (base.includes("/")) {
        const [r, s] = base.split("/");
        if (!/^\d+$/.test(s)) return false;
        base = r;
      }
      if (base === "*") return true;
      if (base.includes("-")) {
        const [a, b] = base.split("-").map(Number);
        return Number.isFinite(a) && Number.isFinite(b) && a >= lo && b <= hi && a <= b;
      }
      const n = Number(base);
      return Number.isFinite(n) && n >= lo && n <= hi;
    });
  });
}
