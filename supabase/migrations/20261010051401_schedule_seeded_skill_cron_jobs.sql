/*
# Schedule pg_cron jobs for the three seeded skills (via app_config table)

1. What this does
- Creates one pg_cron job per seeded skill; each job posts to the
  run-skill Edge Function via pg_net with that skill's id in the body.
- Reads the project URL and anon key from the `app_config` table at
  runtime — no hardcoded URLs or JWTs in the migration.

2. Jobs created (UTC)
- 'morning-brief ai-agents-digest'  -> 0 7 * * *
- 'morning-brief indie-hacker-news' -> 30 6 * * *
- 'morning-brief llm-evals-arxiv'   -> 0 8 * * *

3. Notes
- Idempotent via NOT EXISTS checks; safe to re-run.
- app_config has RLS enabled with no policies; only service_role / postgres
  can read it. The anon key is a public value for this no-auth demo.
*/

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'morning-brief ai-agents-digest') THEN
    PERFORM cron.schedule(
      'morning-brief ai-agents-digest',
      '0 7 * * *',
      $J$SELECT net.http_post(
        url := (SELECT value FROM app_config WHERE key = 'supabase_url') || '/functions/v1/run-skill',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (SELECT value FROM app_config WHERE key = 'anon_key'),
          'apikey', (SELECT value FROM app_config WHERE key = 'anon_key')
        ),
        body := jsonb_build_object('skill_id', (SELECT id FROM skills WHERE slug = 'ai-agents-digest'))
      )$J$
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'morning-brief indie-hacker-news') THEN
    PERFORM cron.schedule(
      'morning-brief indie-hacker-news',
      '30 6 * * *',
      $J$SELECT net.http_post(
        url := (SELECT value FROM app_config WHERE key = 'supabase_url') || '/functions/v1/run-skill',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (SELECT value FROM app_config WHERE key = 'anon_key'),
          'apikey', (SELECT value FROM app_config WHERE key = 'anon_key')
        ),
        body := jsonb_build_object('skill_id', (SELECT id FROM skills WHERE slug = 'indie-hacker-news'))
      )$J$
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'morning-brief llm-evals-arxiv') THEN
    PERFORM cron.schedule(
      'morning-brief llm-evals-arxiv',
      '0 8 * * *',
      $J$SELECT net.http_post(
        url := (SELECT value FROM app_config WHERE key = 'supabase_url') || '/functions/v1/run-skill',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (SELECT value FROM app_config WHERE key = 'anon_key'),
          'apikey', (SELECT value FROM app_config WHERE key = 'anon_key')
        ),
        body := jsonb_build_object('skill_id', (SELECT id FROM skills WHERE slug = 'llm-evals-arxiv'))
      )$J$
    );
  END IF;
END $$;
