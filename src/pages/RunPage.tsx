import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { Globe, RefreshCw, ArrowLeft, Check, X, CircleDot } from "lucide-react";
import { supabase } from "@/lib/supabase";
import type { Run, Item, Skill } from "@/lib/types";
import { findDemoRun } from "@/lib/demoData";
import { useMode } from "@/context/ModeContext";

const steps = ["fetch", "dedupe", "Jev", "rank", "digest"] as const;

export default function RunPage() {
  const { skillId = "" } = useParams();
  const { mode } = useMode();
  const [skill, setSkill] = useState<Skill | null>(null);
  const [run, setRun] = useState<Run | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [digestSlug, setDigestSlug] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: s } = await supabase.from("skills").select("*").eq("id", skillId).maybeSingle();
      if (cancelled) return;
      if (s) setSkill(s as Skill);
      const { data: r } = await supabase
        .from("runs")
        .select("*")
        .eq("skill_id", skillId)
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (cancelled) return;
      if (r) {
        setRun(r as Run);
        const { data: its } = await supabase.from("items").select("*").eq("run_id", (r as Run).id).order("score", { ascending: false, nullsFirst: false });
        if (!cancelled) setItems((its ?? []) as Item[]);
      } else {
        const demo = findDemoRun(skill?.slug ?? "");
        if (demo) setOffline(true);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [skillId, skill?.slug]);

  if (loading) return <div className="text-center text-ink-400 py-16">Loading run…</div>;

  if (offline) {
    const demo = findDemoRun(skill?.slug ?? "");
    return demo ? <DemoRunView demo={demo} /> : <NotFound />;
  }
  if (!run || !skill) return <NotFound />;

  const c = run.counts;
  const stepCounts: { label: string; value: number | string }[] = [
    { label: "fetched", value: c.fetched ?? 0 },
    { label: "after dedupe", value: c.deduped ?? 0 },
    { label: "sent to Jev", value: c.sent_to_jev ?? 0 },
    { label: "ranked", value: items.filter((i) => i.score != null).length },
    { label: "kept → digest", value: c.kept ?? 0 },
  ];

  return (
    <div>
      <Link to="/skills" className="text-sm text-ink-500 hover:text-moss-600 inline-flex items-center gap-1 mb-4">
        <ArrowLeft size={14} /> All skills
      </Link>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="headline-serif text-2xl">{skill.name}</h1>
          <p className="text-sm text-ink-500 dark:text-paper-300">
            {new Date(run.started_at).toLocaleString()} · {run.latency_ms ?? 0} ms · Jev cost ${run.jev_cost_usd.toFixed(5)}
          </p>
        </div>
        {digestSlug && (
          <Link className="btn-primary" to={`/d/${digestSlug}`}>
            <Globe size={15} /> View digest
          </Link>
        )}
      </div>

      {/* pipeline strip */}
      <div className="card p-4 mb-6">
        <div className="flex flex-wrap items-center gap-2">
          {steps.map((s, i) => (
            <div key={s} className="flex items-center gap-2">
              <div className="flex items-center gap-2 rounded-lg bg-paper-100/70 dark:bg-paper-800/60 px-3 py-2">
                <CircleDot size={13} className="text-moss-600 dark:text-moss-400" />
                <div>
                  <div className="text-xs font-medium">{s}</div>
                  <div className="text-xs text-ink-500 dark:text-paper-300">{stepCounts[i].value}</div>
                </div>
              </div>
              {i < steps.length - 1 && <ArrowLeft size={12} className="rotate-180 text-paper-300 dark:text-paper-600" />}
            </div>
          ))}
        </div>
        {run.error && (
          <p className="text-xs text-amberb-700 dark:text-amberb-300 mt-3">{run.error}</p>
        )}
      </div>

      <ItemTable items={items} />
    </div>
  );
}

function DemoRunView({ demo }: { demo: NonNullable<ReturnType<typeof findDemoRun>> }) {
  const c = { fetched: demo.fetchedCount, deduped: demo.dedupedCount, sent_to_jev: demo.jevCount, kept: demo.items.filter((i) => i.kept).length };
  const stepCounts = [c.fetched, c.deduped, c.sent_to_jev, demo.items.length, c.kept];
  return (
    <div>
      <div className="badge bg-amberb-100 text-amberb-700 dark:bg-amberb-900/50 dark:text-amberb-300 inline-flex items-center gap-1 mb-4">
        <RefreshCw size={11} /> Offline replay — recorded run
      </div>
      <h1 className="headline-serif text-2xl mb-6">Pipeline replay</h1>
      <div className="card p-4 mb-6">
        <div className="flex flex-wrap items-center gap-2">
          {steps.map((s, i) => (
            <div key={s} className="flex items-center gap-2">
              <div className="flex items-center gap-2 rounded-lg bg-paper-100/70 dark:bg-paper-800/60 px-3 py-2">
                <CircleDot size={13} className="text-moss-600 dark:text-moss-400" />
                <div>
                  <div className="text-xs font-medium">{s}</div>
                  <div className="text-xs text-ink-500 dark:text-paper-300">{stepCounts[i]}</div>
                </div>
              </div>
              {i < steps.length - 1 && <ArrowLeft size={12} className="rotate-180 text-paper-300 dark:text-paper-600" />}
            </div>
          ))}
        </div>
      </div>
      <ItemTable items={demo.items} />
    </div>
  );
}

function ItemTable({ items }: { items: Item[] }) {
  if (items.length === 0) return <div className="card p-6 text-center text-ink-400">No items recorded for this run.</div>;
  return (
    <div className="card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-paper-200 dark:border-paper-800 text-left text-xs text-ink-400 dark:text-paper-400">
              <th className="px-4 py-2.5 font-medium">Item</th>
              <th className="px-3 py-2.5 font-medium">Relevance</th>
              <th className="px-3 py-2.5 font-medium">Substance</th>
              <th className="px-3 py-2.5 font-medium">Skip p</th>
              <th className="px-3 py-2.5 font-medium">Score</th>
              <th className="px-3 py-2.5 font-medium">Kept</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it) => (
              <tr key={it.id} className="border-b border-paper-100 dark:border-paper-800/60 last:border-0 hover:bg-paper-100/40 dark:hover:bg-paper-800/30 transition-colors">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2 mb-1">
                    {sourceBadge(it.source)}
                    {it.kind && <span className="text-xs text-ink-400">{it.kind}</span>}
                  </div>
                  <a href={it.url} target="_blank" rel="noopener noreferrer" className="font-medium hover:text-moss-600 leading-snug line-clamp-2">
                    {it.title}
                  </a>
                  {it.drop_reason && <div className="text-xs text-ink-400 dark:text-paper-400 mt-1">Dropped: {it.drop_reason}</div>}
                </td>
                <ProbCell value={it.relevance} max={5} />
                <ProbCell value={it.substance} max={5} />
                <ProbCell value={it.skip_p} max={1} />
                <td className="px-3 py-3 font-mono text-xs">{it.score != null ? it.score.toFixed(3) : "—"}</td>
                <td className="px-3 py-3">
                  {it.kept ? (
                    <Check size={16} className="text-moss-600 dark:text-moss-400" />
                  ) : (
                    <X size={16} className="text-ink-300 dark:text-paper-600" />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ProbCell({ value, max }: { value: number | null; max: number }) {
  const v = value ?? 0;
  const pct = Math.round((v / max) * 100);
  return (
    <td className="px-3 py-3">
      <div className="flex items-center gap-2 group relative">
        <div className="w-16 h-1.5 rounded-full bg-paper-200 dark:bg-paper-700 overflow-hidden">
          <div className={`h-full rounded-full ${max === 1 ? "bg-amberb-400" : "bg-moss-500"}`} style={{ width: `${pct}%` }} />
        </div>
        <span className="text-xs text-ink-500 dark:text-paper-300 font-mono w-8">{value != null ? v.toFixed(1) : "—"}</span>
        <div className="absolute -top-8 left-0 hidden group-hover:block bg-ink-900 text-paper-50 dark:bg-paper-100 dark:text-ink-900 text-xs rounded px-2 py-1 whitespace-nowrap z-10">
          {pct}% of max
        </div>
      </div>
    </td>
  );
}

function sourceBadge(source: string) {
  const cls: Record<string, string> = {
    hn: "bg-amberb-100 text-amberb-700 dark:bg-amberb-900/50 dark:text-amberb-300",
    arxiv: "bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300",
    reddit: "bg-moss-100 text-moss-700 dark:bg-moss-900/50 dark:text-moss-300",
  };
  return <span className={`badge ${cls[source] ?? "bg-paper-200 text-ink-600 dark:bg-paper-800 dark:text-paper-300"}`}>{source === "rss" ? "RSS" : source}</span>;
}

function NotFound() {
  return (
    <div className="card p-8 text-center">
      <p className="text-ink-500 mb-4">This skill hasn't run yet. Open it in Skills and press "Run now".</p>
      <Link to="/skills" className="btn-primary">Go to Skills</Link>
    </div>
  );
}
