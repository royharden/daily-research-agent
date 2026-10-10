/*
# Schedule pg_cron jobs for the three seeded skills (direct constants)

1. What this does
- Creates one pg_cron job per seeded skill; each job posts to the
  run-skill Edge Function via pg_net with that skill's id in the body.
- Uses the project URL and anon key as literals because the demo app is
  public/no-auth and the anon key ships in the browser bundle anyway.

2. Jobs created (UTC)
- 'morning-brief ai-agents-digest'  -> 0 7 * * *
- 'morning-brief indie-hacker-news' -> 30 6 * * *
- 'morning-brief llm-evals-arxiv'   -> 0 8 * * *

3. Notes
- Idempotent via NOT EXISTS checks; safe to re-run.
*/

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'morning-brief ai-agents-digest') THEN
    PERFORM cron.schedule(
      'morning-brief ai-agents-digest',
      '0 7 * * *',
      $J$SELECT net.http_post(
        url := 'https://delmjlsyujwzytvsqwcr.supabase.co/functions/v1/run-skill',
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRlbG1qbHN5dWp3enl0dnNxd2NyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE1OTI1NDIsImV4cCI6MjEwNzE2ODU0Mn0.tJ3Q6Up5rCEm2f_KQOXJ3WzkFUKB8s-3uQba39IZ4QA', 'apikey', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRlbG1qbHN5dWp3enl0dnNxd2NyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE1OTI1NDIsImV4cCI6MjEwNzE2ODU0Mn0.tJ3Q6Up5rCEm2f_KQOXJ3WzkFUKB8s-3uQba39IZ4QA'),
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
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRlbG1qbHN5dWp3enl0dnNxd2NyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE1OTI1NDIsImV4cCI6MjEwNzE2ODU0Mn0.tJ3Q6Up5rCEm2f_KQOXJ3WzkFUKB8s-3uQba39IZ4QA', 'apikey', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRlbG1qbHN5dWp3enl0dnNxd2NyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE1OTI1NDIsImV4cCI6MjEwNzE2ODU0Mn0.tJ3Q6Up5rCEm2f_KQOXJ3WzkFUKB8s-3uQba39IZ4QA'),
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
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRlbG1qbHN5dWp3enl0dnNxd2NyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE1OTI1NDIsImV4cCI6MjEwNzE2ODU0Mn0.tJ3Q6Up5rCEm2f_KQOXJ3WzkFUKB8s-3uQba39IZ4QA', 'apikey', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRlbG1qbHN5dWp3enl0dnNxd2NyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE1OTI1NDIsImV4cCI6MjEwNzE2ODU0Mn0.tJ3Q6Up5rCEm2f_KQOXJ3WzkFUKB8s-3uQba39IZ4QA'),
        body := jsonb_build_object('skill_id', (SELECT id FROM skills WHERE slug = 'llm-evals-arxiv'))
      )$J$
    );
  END IF;
END $$;