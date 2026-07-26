-- Enable Row Level Security on every PostgREST-exposed table.
--
-- Why: no migration in this repo has ever enabled RLS, so each table has been
-- readable (and writable) by anyone holding the project's anon/publishable key.
-- Nothing in the application needs that key: every server-side path resolves
-- SUPABASE_SERVICE_ROLE_KEY (an `sb_secret_...` key), and there is no browser
-- code that talks to Supabase directly. This app has no Supabase Auth users
-- either, so there is no legitimate anon or authenticated caller to preserve.
--
-- Enabling RLS with NO policies is deny-by-default for anon/authenticated.
-- `service_role` bypasses RLS entirely, so every application code path is
-- unaffected. Adding a policy later is an explicit, reviewable act.
--
-- Idempotent: ALTER TABLE ... ENABLE ROW LEVEL SECURITY is a no-op when already
-- enabled, and the loop skips tables that do not exist in this environment.

DO $$
DECLARE
    target_table text;
    exposed_tables text[] := ARRAY[
        'approval_workflow',
        'approved_dishes',
        'assets',
        'basic_ai_check_audits',
        'correction_rules',
        'document_pairs',
        'draft_sessions',
        'form_attempt_logs',
        'menus',
        'prompt_proposals',
        'properties',
        'submissions',
        'submitter_profiles',
        'system_alerts',
        'users'
    ];
BEGIN
    FOREACH target_table IN ARRAY exposed_tables LOOP
        IF EXISTS (
            SELECT 1 FROM pg_tables
            WHERE schemaname = 'public' AND tablename = target_table
        ) THEN
            EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', target_table);
            RAISE NOTICE 'RLS enabled on public.%', target_table;
        ELSE
            RAISE NOTICE 'skipped public.% (table not present)', target_table;
        END IF;
    END LOOP;
END $$;

-- Verification (run after applying; every row should read rowsecurity = true):
--
--   SELECT tablename, rowsecurity
--   FROM pg_tables
--   WHERE schemaname = 'public'
--   ORDER BY rowsecurity, tablename;
--
-- And confirm the app still works: the dashboard uses the service-role key and
-- must be unaffected. A read with the anon key should now return [] (RLS) or
-- 401 (if legacy JWT keys are disabled) instead of live rows.
