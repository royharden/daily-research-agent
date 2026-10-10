/*
# Security hardening — strip anon write grants, lock usage_counters, fix cron

## What this does
1. Drop ALL policies on usage_counters (SELECT/INSERT/UPDATE/DELETE for anon, authenticated).
2. Recreate increment_usage as SECURITY DEFINER, search_path=public, then REVOKE
   EXECUTE from PUBLIC/anon/authenticated and GRANT only to service_role.
3. On every other table (skills, runs, items, digests): drop UPDATE and DELETE
   policies for anon/authenticated. Keep only SELECT and INSERT policies
   (anon can read and create; updates/deletes happen via service-role client
   in edge functions).
4. Revoke UPDATE and DELETE column privileges from anon and authenticated on
   all five tables so even policy-less access is impossible.
5. Unschedule the existing cron jobs (which contain hardcoded JWTs) and
   reschedule them using current_setting('app.settings.*') — no literals.
*/

-- 1. usage_counters: drop all policies
DROP POLICY IF EXISTS "public_read_usage" ON usage_counters;
DROP POLICY IF EXISTS "public_write_usage" ON usage_counters;
DROP POLICY IF EXISTS "public_update_usage" ON usage_counters;
DROP POLICY IF EXISTS "public_delete_usage" ON usage_counters;

-- 2. increment_usage: recreate with SECURITY DEFINER, lock to service_role
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

REVOKE EXECUTE ON FUNCTION increment_usage(text, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION increment_usage(text, int) TO service_role;

-- 3. Drop UPDATE and DELETE policies on all other tables
DROP POLICY IF EXISTS "public_update_skills" ON skills;
DROP POLICY IF EXISTS "public_delete_skills" ON skills;
DROP POLICY IF EXISTS "public_update_runs" ON runs;
DROP POLICY IF EXISTS "public_delete_runs" ON runs;
DROP POLICY IF EXISTS "public_update_items" ON items;
DROP POLICY IF EXISTS "public_delete_items" ON items;
DROP POLICY IF EXISTS "public_update_digests" ON digests;
DROP POLICY IF EXISTS "public_delete_digests" ON digests;

-- 4. Revoke UPDATE and DELETE privileges from anon/authenticated on all tables
REVOKE UPDATE, DELETE ON skills FROM anon, authenticated;
REVOKE UPDATE, DELETE ON runs FROM anon, authenticated;
REVOKE UPDATE, DELETE ON items FROM anon, authenticated;
REVOKE UPDATE, DELETE ON digests FROM anon, authenticated;
REVOKE UPDATE, DELETE, INSERT, SELECT ON usage_counters FROM anon, authenticated;

-- 5. Replace cron jobs that had hardcoded JWTs with current_setting-based ones
--    First unschedule the old ones
DO $$
DECLARE
  j record;
BEGIN
  FOR j IN SELECT jobname FROM cron.job WHERE jobname LIKE 'morning-brief %' LOOP
    PERFORM cron.unschedule(j.jobname);
  END LOOP;
END $$;

--    Reschedule using env settings (no hardcoded URL or JWT)
DO $$
DECLARE
  base_url text := current_setting('app.settings.supabase_url', true);
  anon_key text := current_setting('app.settings.anon_key', true);
BEGIN
  IF base_url IS NULL OR anon_key IS NULL THEN
    RAISE NOTICE 'Missing app.settings.supabase_url / app.settings.anon_key; skipping cron job creation';
    RETURN;
  END IF;

  PERFORM cron.schedule(
    'morning-brief ai-agents-digest',
    '0 7 * * *',
    $J$SELECT net.http_post(
      url := current_setting('app.settings.supabase_url', true) || '/functions/v1/run-skill',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.settings.anon_key', true),
        'apikey', current_setting('app.settings.anon_key', true)
      ),
      body := jsonb_build_object('skill_id', (SELECT id FROM skills WHERE slug = 'ai-agents-digest'))
    )$J$
  );

  PERFORM cron.schedule(
    'morning-brief indie-hacker-news',
    '30 6 * * *',
    $J$SELECT net.http_post(
      url := current_setting('app.settings.supabase_url', true) || '/functions/v1/run-skill',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.settings.anon_key', true),
        'apikey', current_setting('app.settings.anon_key', true)
      ),
      body := jsonb_build_object('skill_id', (SELECT id FROM skills WHERE slug = 'indie-hacker-news'))
    )$J$
  );

  PERFORM cron.schedule(
    'morning-brief llm-evals-arxiv',
    '0 8 * * *',
    $J$SELECT net.http_post(
      url := current_setting('app.settings.supabase_url', true) || '/functions/v1/run-skill',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.settings.anon_key', true),
        'apikey', current_setting('app.settings.anon_key', true)
      ),
      body := jsonb_build_object('skill_id', (SELECT id FROM skills WHERE slug = 'llm-evals-arxiv'))
    )$J$
  );
END $$;