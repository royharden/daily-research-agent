/*
# Store cron config in a table and reschedule jobs

1. What this does
- Creates a small `app_config` table to hold the project URL and anon key
  for use by pg_cron jobs (since ALTER DATABASE SET app.settings.* is not
  permitted on this platform).
- Deployment-specific values are supplied by the operator, never committed.
  The anon role is public, but its project token must not be baked into source.
- RLS enabled with no policies — only the service_role / postgres roles
  can read it; anon and authenticated get nothing.
- Reschedules the three cron jobs to read from app_config at runtime.

2. Notes
- Idempotent: jobs are only created if they don't already exist.
- app_config has no anon/authenticated policies, so the browser cannot
  read it — only the database owner and service_role can.
*/

CREATE TABLE IF NOT EXISTS app_config (
  key text PRIMARY KEY,
  value text NOT NULL
);

ALTER TABLE app_config ENABLE ROW LEVEL SECURITY;

-- Optional migration-session settings, supplied outside this repository. Missing
-- settings preserve existing configuration and do not store placeholder values.
INSERT INTO app_config (key, value)
SELECT key, value FROM (VALUES
  ('supabase_url', nullif(current_setting('app.settings.supabase_url', true), '')),
  ('anon_key', nullif(current_setting('app.settings.anon_key', true), ''))
) AS config(key, value)
WHERE value IS NOT NULL
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

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