/*
# Store cron config in a table and reschedule jobs

1. What this does
- Creates a small `app_config` table to hold the project URL and anon key
  for use by pg_cron jobs (since ALTER DATABASE SET app.settings.* is not
  permitted on this platform).
- The URL and anon key are public values (the anon key ships in the browser
  bundle for this no-auth demo). They are NOT secrets.
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

INSERT INTO app_config (key, value) VALUES
  ('supabase_url', 'https://delmjlsyujwzytvsqwcr.supabase.co'),
  ('anon_key', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRlbG1qbHN5dWp3enl0dnNxd2NyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE1OTI1NDIsImV4cCI6MjEwNzE2ODU0Mn0.tJ3Q6Up5rCEm2f_KQOXJ3WzkFUKB8s-3uQba39IZ4QA')
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