/*
# Round 2 security hardening — per-call usage reservation, write lockdown

1. usage_counters
   - Ensure the table exists, RLS is on, EVERY policy on it is dropped, and
     REVOKE ALL from PUBLIC / anon / authenticated.

2. increment_usage_by(fn_name text, units int, cap int default 200) returns int
   - Atomically adds `units` to today's row only if calls + units <= cap, in a
     single INSERT ... ON CONFLICT DO UPDATE ... WHERE ... RETURNING statement.
   - Returns the new count, or -1 when the reservation would exceed the cap
     (nothing is incremented). Invalid arguments raise (edge functions fail closed).
   - SECURITY DEFINER, SET search_path = public, EXECUTE for service_role only.
   - Edge functions call it right before every paid upstream (Jev / OpenAI) fetch.

3. increment_usage(fn_name text, cap int default 200)
   - Kept for compatibility; now delegates to increment_usage_by(fn_name, 1, cap).
     Same lockdown: EXECUTE for service_role only.

4. Data tables (skills, runs, items, digests)
   - Drop every anon/authenticated INSERT / UPDATE / DELETE / ALL policy; keep
     anon SELECT. Revoke INSERT / UPDATE / DELETE / TRUNCATE from anon and
     authenticated. All writes now go through edge functions using the
     service-role client (run-skill, write-digest, and the new save-skill for
     creating / editing / pausing skills, which validates config and source URLs).

5. app_config: RLS on, no policies, REVOKE ALL from anon / authenticated.

6. storage: the app uses no buckets; drop any anon/authenticated write policies
   on storage.objects / storage.buckets if they exist.

Notes
- No keys, URLs or JWTs appear in this migration.
- Cron jobs are unchanged: they still send the Authorization + apikey headers
  built from app_config at runtime.
*/

-- 1. usage_counters -----------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.usage_counters (
  fn text NOT NULL,
  day date NOT NULL,
  calls int NOT NULL DEFAULT 0,
  PRIMARY KEY (fn, day)
);

ALTER TABLE public.usage_counters ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  p record;
BEGIN
  FOR p IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'usage_counters'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.usage_counters', p.policyname);
  END LOOP;
END $$;

REVOKE ALL ON public.usage_counters FROM PUBLIC, anon, authenticated;

-- 2. increment_usage_by -------------------------------------------------------

CREATE OR REPLACE FUNCTION public.increment_usage_by(fn_name text, units int, cap int DEFAULT 200)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_calls int;
BEGIN
  IF fn_name IS NULL OR units IS NULL OR cap IS NULL OR units < 1 OR cap < 0 THEN
    RAISE EXCEPTION 'increment_usage_by: invalid arguments';
  END IF;

  IF units > cap THEN
    RETURN -1;
  END IF;

  -- One statement: insert today's row, or add units only while staying within the cap.
  -- When the WHERE fails no row is updated or returned, so new_calls stays NULL.
  INSERT INTO public.usage_counters AS uc (fn, day, calls)
  VALUES (fn_name, current_date, units)
  ON CONFLICT (fn, day) DO UPDATE
    SET calls = uc.calls + EXCLUDED.calls
    WHERE uc.calls + EXCLUDED.calls <= cap
  RETURNING uc.calls INTO new_calls;

  RETURN COALESCE(new_calls, -1);
END;
$$;

REVOKE ALL ON FUNCTION public.increment_usage_by(text, int, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_usage_by(text, int, int) TO service_role;

-- 3. increment_usage (compat) -------------------------------------------------

CREATE OR REPLACE FUNCTION public.increment_usage(fn_name text, cap int DEFAULT 200)
RETURNS int
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.increment_usage_by(fn_name, 1, cap);
$$;

REVOKE ALL ON FUNCTION public.increment_usage(text, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_usage(text, int) TO service_role;

-- 4. Data tables: anon keeps SELECT only ---------------------------------------

ALTER TABLE public.skills ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.digests ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  p record;
BEGIN
  FOR p IN
    SELECT policyname, tablename FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('skills', 'runs', 'items', 'digests')
      AND cmd <> 'SELECT'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', p.policyname, p.tablename);
  END LOOP;
END $$;

-- (re)assert the public read policies the app needs
DROP POLICY IF EXISTS "public_read_skills" ON public.skills;
CREATE POLICY "public_read_skills" ON public.skills FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "public_read_runs" ON public.runs;
CREATE POLICY "public_read_runs" ON public.runs FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "public_read_items" ON public.items;
CREATE POLICY "public_read_items" ON public.items FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "public_read_digests" ON public.digests;
CREATE POLICY "public_read_digests" ON public.digests FOR SELECT TO anon, authenticated USING (true);

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.skills FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.runs FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.items FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.digests FROM anon, authenticated;

-- 5. app_config: service_role / owner only ------------------------------------

DO $$
DECLARE
  p record;
BEGIN
  IF to_regclass('public.app_config') IS NULL THEN
    RETURN;
  END IF;
  EXECUTE 'ALTER TABLE public.app_config ENABLE ROW LEVEL SECURITY';
  FOR p IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'app_config'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.app_config', p.policyname);
  END LOOP;
  EXECUTE 'REVOKE ALL ON public.app_config FROM PUBLIC, anon, authenticated';
END $$;

-- 6. storage: no anon/authenticated writes ------------------------------------

DO $$
DECLARE
  p record;
BEGIN
  IF to_regclass('storage.objects') IS NULL THEN
    RETURN;
  END IF;
  FOR p IN
    SELECT policyname, tablename FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename IN ('objects', 'buckets')
      AND cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL')
      AND roles && ARRAY['anon', 'authenticated', 'public']::name[]
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON storage.%I', p.policyname, p.tablename);
  END LOOP;
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'Skipping storage policy cleanup: %', SQLERRM;
END $$;
