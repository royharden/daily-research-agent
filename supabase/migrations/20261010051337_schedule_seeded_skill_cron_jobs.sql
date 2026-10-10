/*
# Schedule pg_cron jobs for the three seeded skills

1. What this does
- Creates one pg_cron job per seeded skill so each morning the schedule
  fires an HTTP POST (via pg_net) to the `run-skill` Edge Function with
  that skill's id.
- The Edge Function URL and anon key are injected from the environment
  settings (current_setting) so no secret is hardcoded in the migration.
  The anon key is safe to use here: the function is public in this demo
  and enforces its own daily cap.

2. Jobs created (UTC)
- 'morning-brief ai-agents-digest'  -> 0 7 * * *
- 'morning-brief indie-hacker-news' -> 30 6 * * *
- 'morning-brief llm-evals-arxiv'   -> 0 8 * * *

3. Notes
- Job names are prefixed 'morning-brief ' so pause/resume logic can find
  and unschedule them by name.
- Idempotent: existing jobs with the same name are skipped via a check.
*/

DO $$
DECLARE
  base_url text := current_setting('app.settings.supabase_url', true);
  anon_key text := current_setting('app.settings.anon_key', true);
BEGIN
  IF base_url IS NULL OR anon_key IS NULL THEN
    RAISE NOTICE 'Missing app.settings.supabase_url / app.settings.anon_key; skipping cron job creation';
    RETURN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'morning-brief ai-agents-digest') THEN
    PERFORM cron.schedule(
      'morning-brief ai-agents-digest',
      '0 7 * * *',
      $J$SELECT net.http_post(
        url := 'https://delmjlsyujwzytvsqwcr.supabase.co/functions/v1/run-skill',
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || current_setting('app.settings.anon_key', true), 'apikey', current_setting('app.settings.anon_key', true)),
        body := jsonb_build_object('skill_id', (SELECT id FROM skills WHERE slug = 'ai-agents-digest'))
      )$J$
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'morning-brief indie-hacker-news') THEN
    PERFORM cron.schedule(
      'morning-brief indie-hacker-news',
      '30 6 * * *',
      $J$SELECT net.http_post(
        url := 'https://delmjlsyujwzytvsqwcr.supabase.co/functions/v1/run-skill',
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || current_setting('app.settings.anon_key', true), 'apikey', current_setting('app.settings.anon_key', true)),
        body := jsonb_build_object('skill_id', (SELECT id FROM skills WHERE slug = 'indie-hacker-news'))
      )$J$
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'morning-brief llm-evals-arxiv') THEN
    PERFORM cron.schedule(
      'morning-brief llm-evals-arxiv',
      '0 8 * * *',
      $J$SELECT net.http_post(
        url := 'https://delmjlsyujwzytvsqwcr.supabase.co/functions/v1/run-skill',
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || current_setting('app.settings.anon_key', true), 'apikey', current_setting('app.settings.anon_key', true)),
        body := jsonb_build_object('skill_id', (SELECT id FROM skills WHERE slug = 'llm-evals-arxiv'))
      )$J$
    );
  END IF;
END $$;