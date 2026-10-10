import { Link } from "react-router-dom";
import { ArrowRight, Coffee, PlayCircle, Radio, WifiOff, PenLine } from "lucide-react";
import { useSkills, useLatestDigest, useLatestRun } from "@/hooks/useData";
import { useMode } from "@/context/ModeContext";
import type { WriterMode } from "@/lib/types";

const modeOptions: { value: WriterMode; label: string; icon: typeof Radio }[] = [
  { value: "live", label: "Live", icon: Radio },
  { value: "mock", label: "Mock writer", icon: PenLine },
  { value: "offline", label: "Offline replay", icon: WifiOff },
];

function statusBadge(status: string | undefined) {
  if (!status) return null;
  const cls =
    status === "success"
      ? "bg-moss-100 text-moss-700 dark:bg-moss-900/50 dark:text-moss-300"
      : status === "running"
        ? "bg-amberb-100 text-amberb-700 dark:bg-amberb-900/50 dark:text-amberb-300"
        : "bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300";
  return <span className={`badge ${cls}`}>{status}</span>;
}

export default function HomePage() {
  const { skills, loading } = useSkills();
  const { mode, setMode } = useMode();

  return (
    <div>
      <section className="py-10 sm:py-16 text-center">
        <div className="inline-flex items-center gap-2 badge bg-moss-100 text-moss-700 dark:bg-moss-900/50 dark:text-moss-300 mb-5">
          <Coffee size={13} /> your research, done before coffee
        </div>
        <h1 className="headline-serif text-4xl sm:text-5xl mb-4">Morning Brief</h1>
        <p className="text-ink-500 dark:text-paper-300 max-w-xl mx-auto text-lg leading-relaxed">
          Skills written in markdown. Every morning an agent reads your sources, Jev scores what's worth your
          time, and the LLM writes only what matters.
        </p>
      </section>

      <section className="mb-8">
        <div className="flex flex-wrap items-center justify-center gap-2">
          {modeOptions.map((o) => (
            <button
              key={o.value}
              onClick={() => setMode(o.value)}
              className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-all ${
                mode === o.value
                  ? "bg-ink-900 text-paper-50 dark:bg-paper-100 dark:text-ink-900 shadow"
                  : "border border-paper-300 dark:border-paper-700 text-ink-600 dark:text-paper-300 hover:bg-paper-100 dark:hover:bg-paper-800"
              }`}
            >
              <o.icon size={15} /> {o.label}
            </button>
          ))}
        </div>
        <p className="text-center text-xs text-ink-400 dark:text-paper-400 mt-3">
          {mode === "live" && "Real sources, live Jev scoring, and the LLM writer (subject to the 200 calls/day demo cap)."}
          {mode === "mock" && "Real fetching + live Jev scoring, but the digest is built from ranked titles instead of the LLM."}
          {mode === "offline" && "Recorded runs per example skill — full pipeline replay, no API calls, real ranking code."}
        </p>
      </section>

      <section>
        <h2 className="headline-serif text-xl mb-4">Today's digests</h2>
        {loading ? (
          <div className="text-center text-ink-400 py-12">Loading skills…</div>
        ) : skills.length === 0 ? (
          <div className="card p-8 text-center text-ink-500">
            No skills yet. Create your first one in <Link className="text-moss-600 underline" to="/skills">Skills</Link>.
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {skills.map((s) => (
              <SkillCard key={s.id} skillId={s.id} slug={s.slug} name={s.name} schedule={s.schedule} active={s.active} />
            ))}
          </div>
        )}
      </section>

      <section className="mt-12 card p-6">
        <h3 className="headline-serif text-lg mb-2">How a morning run works</h3>
        <div className="grid gap-3 sm:grid-cols-4 text-sm">
          {[
            ["1. Fetch wide", "Up to 60 items from the skill's RSS, HN, arXiv, or Reddit sources. Polite, read-only GETs."],
            ["2. Jev filters cheaply", "Batched scoring of relevance, substance, skip-probability, and kind — 10 items per request."],
            ["3. Code ranks & keeps", "A transparent formula keeps the top few, at most 2 per source."],
            ["4. LLM writes the rest", "Only kept items reach the expensive writer. The rest never cost a token."],
          ].map(([t, d]) => (
            <div key={t} className="rounded-lg bg-paper-100/60 dark:bg-paper-800/50 p-3">
              <div className="font-medium text-moss-700 dark:text-moss-300 mb-1">{t}</div>
              <div className="text-ink-500 dark:text-paper-300 text-xs leading-relaxed">{d}</div>
            </div>
          ))}
        </div>
        <Link to="/skills" className="btn-primary mt-5">
          <PlayCircle size={16} /> Open skills <ArrowRight size={15} />
        </Link>
      </section>
    </div>
  );
}

function SkillCard({
  skillId,
  slug,
  name,
  schedule,
  active,
}: {
  skillId: string;
  slug: string;
  name: string;
  schedule: string;
  active: boolean;
}) {
  const digest = useLatestDigest(skillId);
  const run = useLatestRun(skillId);

  return (
    <Link to={digest ? `/d/${digest.slug}` : `/skills`} className="card p-5 hover:shadow-md hover:-translate-y-0.5 transition-all block">
      <div className="flex items-start justify-between gap-2 mb-2">
        <span className="headline-serif text-base leading-snug">{name}</span>
        {statusBadge(run?.status)}
      </div>
      <div className="text-xs text-ink-400 dark:text-paper-400 mb-3">
        {active ? `Runs daily at ${schedule} UTC` : "Paused"} · {run?.counts?.kept ?? 0} kept last run
      </div>
      {digest ? (
        <div>
          <div className="font-serif text-sm font-semibold text-moss-700 dark:text-moss-300 leading-snug line-clamp-2">
            {digest.content.headline}
          </div>
          <div className="text-xs text-ink-400 mt-2 flex items-center gap-1">
            Read the digest <ArrowRight size={12} />
          </div>
        </div>
      ) : (
        <div className="text-xs text-ink-400">No digest yet — run this skill to publish one.</div>
      )}
    </Link>
  );
}
