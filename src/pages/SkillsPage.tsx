import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Clock, PauseCircle, PlayCircle, Plus, Save, AlertTriangle, CheckCircle2 } from "lucide-react";
import { useSkills, useLatestRun } from "@/hooks/useData";
import { parseSkill, isValidCron } from "@/lib/frontmatter";
import { supabase } from "@/lib/supabase";
import { nextCronRun } from "@/lib/cron";
import type { Skill } from "@/lib/types";

const TEMPLATE = `---
name: My new digest
schedule: "0 7 * * *"
sources:
  - type: hn
    query: "your topic"
  - type: rss
    url: https://example.com/feed.xml
  - type: arxiv
    query: "cat:cs.AI AND abs:your topic"
keep: 6
---
## What I care about
Describe what belongs in this brief.

## Skip
Describe what should never appear.

## Output
Describe the shape of the digest (e.g. 5 bullets + one full-read pick).
`;

function nextRunLocal(schedule: string): string {
  const next = nextCronRun(schedule);
  if (!next) return "—";
  return next.toLocaleString(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit" });
}

export default function SkillsPage() {
  const { skills, loading, error } = useSkills();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = skills.find((s) => s.id === selectedId) ?? null;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="headline-serif text-2xl">Skills</h1>
          <p className="text-sm text-ink-500 dark:text-paper-300">Markdown files that drive a morning agent.</p>
        </div>
        <button
          className="btn-primary"
          onClick={async () => {
            const slug = `skill-${Date.now().toString(36)}`;
            const { data } = await supabase
              .from("skills")
              .insert({ slug, name: "Untitled skill", markdown: TEMPLATE, config: { sources: [], keep: 6, cares_about: "", skip: "", output: "" }, schedule: "0 7 * * *", active: false })
              .select()
              .maybeSingle();
            if (data) setSelectedId((data as Skill).id);
          }}
        >
          <Plus size={16} /> New skill
        </button>
      </div>

      {error && <div className="card p-4 text-sm text-red-600 mb-4">{error}</div>}
      {loading && <div className="text-center text-ink-400 py-12">Loading…</div>}

      <div className="grid gap-3">
        {skills.map((s) => (
          <SkillRow key={s.id} skill={s} open={selectedId === s.id} onToggle={() => setSelectedId(selectedId === s.id ? null : s.id)} />
        ))}
      </div>

      {selected && <Editor skill={selected} />}
    </div>
  );
}

function SkillRow({ skill, open, onToggle }: { skill: Skill; open: boolean; onToggle: () => void }) {
  const run = useLatestRun(skill.id);
  const parsed = useMemo(() => parseSkill(skill.markdown), [skill.markdown]);

  const setPaused = async (paused: boolean) => {
    await supabase.from("skills").update({ active: !paused }).eq("id", skill.id);
    window.location.reload();
  };

  return (
    <div className="card overflow-hidden">
      <button onClick={onToggle} className="w-full text-left p-4 flex flex-wrap items-center gap-3 hover:bg-paper-100/50 dark:hover:bg-paper-800/40 transition-colors">
        <div className="flex-1 min-w-0">
          <div className="font-serif font-semibold">{skill.name}</div>
          <div className="text-xs text-ink-400 dark:text-paper-400 mt-0.5 flex flex-wrap gap-x-3">
            <span className="inline-flex items-center gap-1"><Clock size={11} /> {skill.schedule} UTC · next {nextRunLocal(skill.schedule)}</span>
            <span>{parsed.config.sources.length} sources</span>
            <span>keep {parsed.config.keep}</span>
          </div>
        </div>
        <span className={`badge ${run?.status === "success" ? "bg-moss-100 text-moss-700 dark:bg-moss-900/50 dark:text-moss-300" : run?.status === "error" ? "bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300" : "bg-paper-200 text-ink-600 dark:bg-paper-800 dark:text-paper-300"}`}>
          {run?.status ?? "never run"}
        </span>
        <span className={`badge ${skill.active ? "bg-moss-100 text-moss-700 dark:bg-moss-900/50 dark:text-moss-300" : "bg-amberb-100 text-amberb-700 dark:bg-amberb-900/50 dark:text-amberb-300"}`}>
          {skill.active ? "scheduled" : "paused"}
        </span>
      </button>
      {open && (
        <div className="border-t border-paper-200 dark:border-paper-800 p-4 flex flex-wrap gap-2">
          <Link to={`/run/${skill.id}`} className="btn-secondary">
            <CheckCircle2 size={15} /> Last run detail
          </Link>
          <RunNowButton skillId={skill.id} />
          <button className="btn-secondary" onClick={() => setPaused(!skill.active)}>
            {skill.active ? <><PauseCircle size={15} /> Pause</> : <><PlayCircle size={15} /> Resume</>}
          </button>
        </div>
      )}
    </div>
  );
}

function RunNowButton({ skillId }: { skillId: string }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <span className="inline-flex items-center gap-2">
      <button
        className="btn-primary"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setMsg(null);
          const { data, error } = await supabase.functions.invoke("run-skill", { body: { skill_id: skillId } });
          setBusy(false);
          if (error) setMsg(`Run failed: ${error.message}`);
          else if ((data as { error?: string })?.error) setMsg((data as { error: string }).error);
          else window.location.href = `/run/${skillId}`;
        }}
      >
        <PlayCircle size={15} /> {busy ? "Running…" : "Run now"}
      </button>
      {msg && <span className="text-xs text-red-600">{msg}</span>}
    </span>
  );
}

function Editor({ skill }: { skill: Skill }) {
  const [markdown, setMarkdown] = useState(skill.markdown);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [preview, setPreview] = useState<"edit" | "preview">("edit");
  const parsed = useMemo(() => parseSkill(markdown), [markdown]);

  const save = async () => {
    setSaving(true);
    await supabase
      .from("skills")
      .update({
        markdown,
        name: String(parsed.frontmatter.name ?? skill.name),
        schedule: String(parsed.frontmatter.schedule ?? skill.schedule),
        config: parsed.config,
      })
      .eq("id", skill.id);
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="card mt-4 p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex gap-1">
          <button
            className={`px-3 py-1.5 rounded-lg text-sm font-medium ${preview === "edit" ? "bg-paper-200 dark:bg-paper-800" : "text-ink-500"}`}
            onClick={() => setPreview("edit")}
          >
            Edit
          </button>
          <button
            className={`px-3 py-1.5 rounded-lg text-sm font-medium ${preview === "preview" ? "bg-paper-200 dark:bg-paper-800" : "text-ink-500"}`}
            onClick={() => setPreview("preview")}
          >
            Preview
          </button>
        </div>
        <button className="btn-primary" onClick={save} disabled={saving || parsed.errors.length > 0}>
          <Save size={15} /> {saving ? "Saving…" : saved ? "Saved" : "Save skill"}
        </button>
      </div>

      {parsed.errors.length > 0 ? (
        <div className="mb-3 space-y-1">
          {parsed.errors.map((e) => (
            <div key={e} className="flex items-start gap-2 text-xs text-amberb-700 dark:text-amberb-300">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" /> {e}
            </div>
          ))}
        </div>
      ) : (
        <div className="mb-3 flex items-center gap-2 text-xs text-moss-600 dark:text-moss-300">
          <CheckCircle2 size={13} /> Front-matter looks good — {parsed.config.sources.length} sources, keep {parsed.config.keep}
        </div>
      )}

      {preview === "edit" ? (
        <textarea
          className="input font-mono text-xs leading-relaxed"
          rows={24}
          value={markdown}
          onChange={(e) => setMarkdown(e.target.value)}
          spellCheck={false}
        />
      ) : (
        <pre className="text-sm whitespace-pre-wrap font-sans leading-relaxed p-2">{markdown}</pre>
      )}
      {!isValidCron(String(parsed.frontmatter.schedule ?? "")) && (
        <p className="text-xs text-ink-400 mt-2">Schedule is a 5-field cron expression in UTC (minute hour day month weekday).</p>
      )}
    </div>
  );
}
