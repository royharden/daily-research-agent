import { useEffect, useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { Download, FileText, Globe, Rss, ArrowRight } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { supabase } from "@/lib/supabase";
import type { Digest, Run, Item, Skill } from "@/lib/types";
import { useMode } from "@/context/ModeContext";

const sourceIcon = (source: string) =>
  source === "hn" ? (
    <span className="badge bg-amberb-100 text-amberb-700 dark:bg-amberb-900/50 dark:text-amberb-300">HN</span>
  ) : source === "arxiv" ? (
    <span className="badge bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300">arXiv</span>
  ) : source === "reddit" ? (
    <span className="badge bg-moss-100 text-moss-700 dark:bg-moss-900/50 dark:text-moss-300">Reddit</span>
  ) : (
    <span className="badge bg-paper-200 text-ink-600 dark:bg-paper-800 dark:text-paper-300">RSS</span>
  );

export default function DigestPage() {
  const { slug = "" } = useParams();
  const [digest, setDigest] = useState<Digest | null>(null);
  const [skill, setSkill] = useState<Skill | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const { mode } = useMode();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase.from("digests").select("*").eq("slug", slug).maybeSingle();
      if (cancelled) return;
      if (!data) {
        setNotFound(true);
        setLoading(false);
        return;
      }
      const d = data as Digest;
      setDigest(d);
      if (d.skill_id) {
        const { data: s } = await supabase.from("skills").select("*").eq("id", d.skill_id).maybeSingle();
        if (!cancelled && s) setSkill(s as Skill);
        if (d.run_id) {
          const { data: its } = await supabase.from("items").select("*").eq("kept", true).eq("run_id", d.run_id);
          if (!cancelled) setItems((its ?? []) as Item[]);
        }
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  const markdown = useMemo(() => digestToMarkdown(digest, skill?.name ?? "Morning Brief"), [digest, skill]);

  if (loading) return <div className="text-center text-ink-400 py-16">Loading digest…</div>;
  if (notFound || !digest)
    return (
      <div className="card p-8 text-center">
        <p className="text-ink-500 mb-4">This digest doesn't exist (or hasn't been published yet).</p>
        <Link to="/" className="btn-primary">Back to Morning Brief</Link>
      </div>
    );

  const c = digest.content;
  const urlToTitle = new Map(items.map((i) => [i.url, i.title]));

  return (
    <article className="mx-auto max-w-2xl">
      <div className="text-center mb-8">
        <div className="text-xs uppercase tracking-widest text-ink-400 dark:text-paper-400 mb-3">
          {skill ? (
            <Link to="/" className="hover:text-moss-600">{skill.name}</Link>
          ) : (
            "Morning Brief"
          )}
          {" · "}
          {new Date(digest.created_at).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })}
        </div>
        <h1 className="headline-serif text-3xl sm:text-4xl">{c.headline}</h1>
        <div className="mt-4 flex items-center justify-center gap-2 text-xs text-ink-400">
          <span className={`badge ${digest.writer_mode === "llm" ? "bg-moss-100 text-moss-700 dark:bg-moss-900/50 dark:text-moss-300" : "bg-paper-200 text-ink-600 dark:bg-paper-800 dark:text-paper-300"}`}>
            {digest.writer_mode === "llm" ? "LLM writer" : "Template writer"}
          </span>
        </div>
      </div>

      <div className="space-y-5">
        {c.bullets.map((b, i) => (
          <div key={i} className="flex gap-3">
            <span className="font-serif text-moss-600 dark:text-moss-400 font-semibold text-lg leading-snug">{i + 1}.</span>
            <p className="text-[15px] leading-relaxed">
              {b.text}{" "}
              <a
                href={b.item_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-moss-600 dark:text-moss-400 hover:underline text-sm whitespace-nowrap"
              >
                {sourceIcon(guessSource(urlToTitle.get(b.item_url) ?? "", b.item_url))}
              </a>
            </p>
          </div>
        ))}
      </div>

      {c.full_read && (
        <div className="card mt-10 p-6 bg-paper-100/70 dark:bg-paper-900">
          <div className="text-xs uppercase tracking-widest text-moss-700 dark:text-moss-300 mb-2">Worth reading in full</div>
          <a href={c.full_read.item_url} target="_blank" rel="noopener noreferrer" className="font-serif text-lg font-semibold hover:text-moss-600 transition-colors">
            {urlToTitle.get(c.full_read.item_url) ?? c.full_read.item_url}
          </a>
          <p className="text-sm text-ink-500 dark:text-paper-300 mt-2 leading-relaxed">{c.full_read.why}</p>
        </div>
      )}

      {c.themes.length > 0 && (
        <div className="mt-8 flex flex-wrap gap-2 justify-center">
          {c.themes.map((t) => (
            <span key={t} className="badge bg-paper-200 text-ink-600 dark:bg-paper-800 dark:text-paper-300">{t}</span>
          ))}
        </div>
      )}

      <div className="mt-12 pt-6 border-t border-paper-200 dark:border-paper-800 flex flex-wrap items-center justify-center gap-3 text-sm">
        <button
          className="btn-secondary"
          onClick={() => {
            const blob = new Blob([markdown], { type: "text/markdown" });
            const a = document.createElement("a");
            a.href = URL.createObjectURL(blob);
            a.download = `${slug}.md`;
            a.click();
            URL.revokeObjectURL(a.href);
          }}
        >
          <Download size={15} /> Export Markdown
        </button>
        {skill && (
          <a className="btn-secondary" href={`/feed/${skill.slug}.xml`} target="_blank" rel="noopener noreferrer">
            <Rss size={15} /> Digest RSS
          </a>
        )}
        <Link className="btn-secondary" to={`/skills`}>
          <FileText size={15} /> Edit the skill <ArrowRight size={13} />
        </Link>
      </div>
    </article>
  );
}

function guessSource(_title: string, url: string): string {
  if (/arxiv/.test(url)) return "arxiv";
  if (/news\.ycombinator\.com/.test(url)) return "hn";
  if (/reddit/.test(url)) return "reddit";
  return "rss";
}

export function digestToMarkdown(digest: Digest | null, skillName: string): string {
  if (!digest) return "";
  const c = digest.content;
  const lines = [`# ${c.headline}`, "", `_${skillName} — ${new Date(digest.created_at).toDateString()}_`, ""];
  c.bullets.forEach((b, i) => lines.push(`${i + 1}. ${b.text} — [source](${b.item_url})`));
  if (c.full_read) {
    lines.push("", `## Worth reading in full`, `[${c.full_read.item_url}](${c.full_read.item_url}) — ${c.full_read.why}`);
  }
  if (c.themes.length) lines.push("", `Themes: ${c.themes.join(", ")}`);
  return lines.join("\n");
}
