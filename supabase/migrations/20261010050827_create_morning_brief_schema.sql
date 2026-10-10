/*
# Morning Brief — schema (single public demo workspace, no auth)

1. New Tables
- `skills` — one row per markdown skill the user authors.
  - `id` (uuid, primary key)
  - `slug` (text, unique, used in public digest URLs)
  - `name` (text, display name)
  - `markdown` (text, full skill.md contents incl. front-matter)
  - `config` (jsonb, parsed front-matter: sources, keep, sections)
  - `schedule` (text, cron expression in UTC)
  - `active` (bool, whether the cron job is scheduled)
  - `created_at` (timestamptz)
- `runs` — one row per pipeline execution.
  - `id` (uuid, primary key)
  - `skill_id` (uuid, fk to skills)
  - `status` (text: running | success | error | limit)
  - `counts` (jsonb: fetched, deduped, sent_to_jev, kept)
  - `jev_cost_usd` (numeric)
  - `latency_ms` (int)
  - `error` (text, nullable)
  - `started_at`, `finished_at` (timestamptz)
- `items` — every fetched candidate with its Jev answers and ranking outcome.
  - `id` (uuid, primary key)
  - `run_id` (uuid, fk to runs)
  - `skill_id` (uuid, fk to skills)
  - `url`, `title`, `source`, `summary` (text)
  - `jev_response` (jsonb, raw Jev answers for the item)
  - `relevance`, `substance`, `skip_p` (numeric)
  - `kind` (text)
  - `score` (numeric)
  - `kept` (bool)
  - `drop_reason` (text)
  - `created_at` (timestamptz)
- `digests` — the published digest content.
  - `id` (uuid, primary key)
  - `slug` (text, unique)
  - `run_id` (uuid, fk to runs)
  - `skill_id` (uuid, fk to skills)
  - `content` (jsonb: headline, bullets, full_read, themes)
  - `writer_mode` (text: llm | mock)
  - `created_at` (timestamptz)
- `usage_counters` — daily per-function call cap.
  - `fn` (text), `day` (date), `calls` (int); primary key (fn, day)

2. Security
- RLS enabled on every table; the demo is intentionally public and has no
  sign-in, so policies are permissive `TO anon, authenticated`. Digests and
  skills are readable by anyone; writes are allowed so the demo app can
  edit skills and record runs.
- A SECURITY DEFINER helper `increment_usage(fn_name text)` atomically
  counts calls against the 200/day cap so concurrent cron + button runs
  cannot overshoot.

3. Seed data
- Three example skills: "AI agents digest", "Indie hacker news",
  "New arXiv papers on LLM evals".

4. Notes
- No user_id columns and no auth.uid() usage: single-tenant demo.
- pg_cron jobs are managed by the edge functions via dynamic SQL at runtime.
*/

CREATE TABLE IF NOT EXISTS skills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text UNIQUE NOT NULL,
  name text NOT NULL,
  markdown text NOT NULL,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  schedule text NOT NULL DEFAULT '0 7 * * *',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  skill_id uuid NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'running',
  counts jsonb NOT NULL DEFAULT '{}'::jsonb,
  jev_cost_usd numeric NOT NULL DEFAULT 0,
  latency_ms int,
  error text,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

CREATE TABLE IF NOT EXISTS items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  skill_id uuid NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  url text NOT NULL,
  title text NOT NULL,
  source text NOT NULL,
  summary text NOT NULL DEFAULT '',
  jev_response jsonb,
  relevance numeric,
  substance numeric,
  skip_p numeric,
  kind text,
  score numeric,
  kept boolean NOT NULL DEFAULT false,
  drop_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS digests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text UNIQUE NOT NULL,
  run_id uuid REFERENCES runs(id) ON DELETE SET NULL,
  skill_id uuid REFERENCES skills(id) ON DELETE SET NULL,
  content jsonb NOT NULL,
  writer_mode text NOT NULL DEFAULT 'mock',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS usage_counters (
  fn text NOT NULL,
  day date NOT NULL,
  calls int NOT NULL DEFAULT 0,
  PRIMARY KEY (fn, day)
);

ALTER TABLE skills ENABLE ROW LEVEL SECURITY;
ALTER TABLE runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE items ENABLE ROW LEVEL SECURITY;
ALTER TABLE digests ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_counters ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "public_read_skills" ON skills;
CREATE POLICY "public_read_skills" ON skills FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "public_write_skills" ON skills;
CREATE POLICY "public_write_skills" ON skills FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "public_update_skills" ON skills;
CREATE POLICY "public_update_skills" ON skills FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "public_delete_skills" ON skills;
CREATE POLICY "public_delete_skills" ON skills FOR DELETE TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "public_read_runs" ON runs;
CREATE POLICY "public_read_runs" ON runs FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "public_write_runs" ON runs;
CREATE POLICY "public_write_runs" ON runs FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "public_update_runs" ON runs;
CREATE POLICY "public_update_runs" ON runs FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "public_delete_runs" ON runs;
CREATE POLICY "public_delete_runs" ON runs FOR DELETE TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "public_read_items" ON items;
CREATE POLICY "public_read_items" ON items FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "public_write_items" ON items;
CREATE POLICY "public_write_items" ON items FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "public_update_items" ON items;
CREATE POLICY "public_update_items" ON items FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "public_delete_items" ON items;
CREATE POLICY "public_delete_items" ON items FOR DELETE TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "public_read_digests" ON digests;
CREATE POLICY "public_read_digests" ON digests FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "public_write_digests" ON digests;
CREATE POLICY "public_write_digests" ON digests FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "public_update_digests" ON digests;
CREATE POLICY "public_update_digests" ON digests FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "public_delete_digests" ON digests;
CREATE POLICY "public_delete_digests" ON digests FOR DELETE TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "public_read_usage" ON usage_counters;
CREATE POLICY "public_read_usage" ON usage_counters FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "public_write_usage" ON usage_counters;
CREATE POLICY "public_write_usage" ON usage_counters FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "public_update_usage" ON usage_counters;
CREATE POLICY "public_update_usage" ON usage_counters FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "public_delete_usage" ON usage_counters;
CREATE POLICY "public_delete_usage" ON usage_counters FOR DELETE TO anon, authenticated USING (true);

CREATE OR REPLACE FUNCTION increment_usage(fn_name text, cap int DEFAULT 200)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_calls int;
BEGIN
  INSERT INTO usage_counters (fn, day, calls)
  VALUES (fn_name, current_date, 1)
  ON CONFLICT (fn, day) DO UPDATE SET calls = usage_counters.calls + 1
  RETURNING calls INTO current_calls;

  IF current_calls > cap THEN
    UPDATE usage_counters SET calls = cap WHERE fn = fn_name AND day = current_date;
    RETURN -1;
  END IF;

  RETURN current_calls;
END;
$$;

INSERT INTO skills (slug, name, markdown, config, schedule, active)
VALUES
('ai-agents-digest', 'AI agents digest', $MD$---
name: AI agents digest
schedule: "0 7 * * *"
sources:
  - type: hn
    query: "AI agents"
  - type: rss
    url: https://blog.langchain.dev/rss/
  - type: arxiv
    query: "cat:cs.AI AND abs:agent"
keep: 6
---
## What I care about
New agent frameworks, evals, and real production lessons.

## Skip
Funding announcements, listicles, and hype without substance.

## Output
A 5-bullet brief, then one "worth reading in full" pick.
$MD$,
'{"sources":[{"type":"hn","query":"AI agents"},{"type":"rss","url":"https://blog.langchain.dev/rss/"},{"type":"arxiv","query":"cat:cs.AI AND abs:agent"}],"keep":6,"cares_about":"New agent frameworks, evals, and real production lessons.","skip":"Funding announcements, listicles, and hype without substance.","output":"A 5-bullet brief, then one \"worth reading in full\" pick."}'::jsonb,
'0 7 * * *', true),
('indie-hacker-news', 'Indie hacker news', $MD$---
name: Indie hacker news
schedule: "30 6 * * *"
sources:
  - type: hn
    query: "side project"
  - type: hn
    query: "indie hacker"
  - type: rss
    url: https://news.ycombinator.com/rss
keep: 5
---
## What I care about
Solo founders shipping products, revenue milestones, launch lessons, and honest postmortems.

## Skip
VC funding rounds, corporate PR, and motivational fluff.

## Output
A short list of things worth checking out, each with a one-line why.
$MD$,
'{"sources":[{"type":"hn","query":"side project"},{"type":"hn","query":"indie hacker"},{"type":"rss","url":"https://news.ycombinator.com/rss"}],"keep":5,"cares_about":"Solo founders shipping products, revenue milestones, launch lessons, and honest postmortems.","skip":"VC funding rounds, corporate PR, and motivational fluff.","output":"A short list of things worth checking out, each with a one-line why."}'::jsonb,
'30 6 * * *', true),
('llm-evals-arxiv', 'New arXiv papers on LLM evals', $MD$---
name: New arXiv papers on LLM evals
schedule: "0 8 * * *"
sources:
  - type: arxiv
    query: "cat:cs.CL AND abs:evaluation"
  - type: arxiv
    query: "cat:cs.CL AND abs:benchmark"
keep: 4
---
## What I care about
Novel benchmark methodology, contamination-aware evals, and honest error analysis for language models.

## Skip
Benchmarks that only chase leaderboard points without analysis, and position papers without experiments.

## Output
One-line-per-paper list with the key contribution, plus one paper to read in full.
$MD$,
'{"sources":[{"type":"arxiv","query":"cat:cs.CL AND abs:evaluation"},{"type":"arxiv","query":"cat:cs.CL AND abs:benchmark"}],"keep":4,"cares_about":"Novel benchmark methodology, contamination-aware evals, and honest error analysis for language models.","skip":"Benchmarks that only chase leaderboard points without analysis, and position papers without experiments.","output":"One-line-per-paper list with the key contribution, plus one paper to read in full."}'::jsonb,
'0 8 * * *', true)
ON CONFLICT (slug) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_items_run ON items (run_id);
CREATE INDEX IF NOT EXISTS idx_runs_skill ON runs (skill_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_digests_skill ON digests (skill_id, created_at DESC);