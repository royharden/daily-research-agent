// Tiny YAML-subset parser for skill front-matter. Supports:
// key: value, key: "value", nested lists of maps (- type: x \n   url: y),
// and scalars. Not a general YAML parser.
import type { SkillConfig, SkillSource } from "./types";

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
          if (!obj.url) errors.push(`Source type ${type} needs a url`);
          else sources.push({ type, url: obj.url });
        } else {
          if (!obj.query) errors.push(`Source type ${type} needs a query`);
          else sources.push({ type, query: obj.query });
        }
      }
    }
  } else {
    errors.push("sources: must be a list (each - type: hn/rss/arxiv/reddit)");
  }

  const keep = Number(meta.keep ?? 6);
  if (!Number.isFinite(keep) || keep < 1 || keep > 12) errors.push("keep: must be a number between 1 and 12");

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
