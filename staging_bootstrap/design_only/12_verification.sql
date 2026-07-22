-- STAGING ONLY. DESIGN ONLY. NOT AUTHORIZED. NOT EXECUTED. READ-ONLY VERIFICATION DESIGN.
-- MUST NEVER RUN ON PRODUCTION. Owner must first confirm ref ljfneyuvpxrmejpxsmpz in Supabase UI.

-- Relations, columns/nullability/defaults, and RLS flags (metadata only).
SELECT n.nspname AS schema_name, c.relname, c.relkind, c.relrowsecurity, c.relforcerowsecurity,
       a.attnum, a.attname, pg_catalog.format_type(a.atttypid,a.atttypmod) AS data_type,
       a.attnotnull, pg_get_expr(ad.adbin,ad.adrelid) AS column_default
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
LEFT JOIN pg_attrdef ad ON ad.adrelid=a.attrelid AND ad.adnum=a.attnum
WHERE n.nspname='public' ORDER BY c.relname,a.attnum;

-- Enum labels/order.
SELECT t.typname,e.enumlabel,e.enumsortorder FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace
JOIN pg_enum e ON e.enumtypid=t.oid WHERE n.nspname='public' ORDER BY t.typname,e.enumsortorder;

-- PK/unique/check/FK constraints and indexes.
SELECT c.relname,con.conname,con.contype,con.convalidated,pg_get_constraintdef(con.oid,true) AS definition
FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' ORDER BY c.relname,con.conname;
SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname='public' ORDER BY tablename,indexname;

-- Functions, SECURITY DEFINER and search_path; triggers; views.
SELECT p.proname,pg_get_function_identity_arguments(p.oid) AS args,p.prosecdef,p.proconfig
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' ORDER BY p.proname,args;
SELECT c.relname,t.tgname,t.tgenabled,pg_get_triggerdef(t.oid,true) AS definition
FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND NOT t.tgisinternal ORDER BY c.relname,t.tgname;
SELECT viewname,definition FROM pg_views WHERE schemaname='public' ORDER BY viewname;

-- Policies and grants. Expected values remain OWNER APPROVAL REQUIRED.
SELECT schemaname,tablename,policyname,permissive,roles,cmd,qual,with_check FROM pg_policies WHERE schemaname='public' ORDER BY tablename,policyname;
SELECT table_name,grantee,privilege_type,is_grantable FROM information_schema.table_privileges WHERE table_schema='public' ORDER BY table_name,grantee,privilege_type;
SELECT routine_name,grantee,privilege_type,is_grantable FROM information_schema.routine_privileges WHERE routine_schema='public' ORDER BY routine_name,grantee;

-- Migration 061 objects must remain absent.
SELECT to_regclass('public.recruitment_campaigns') IS NULL AS recruitment_campaigns_absent,
       NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='applications' AND column_name='campaign_id') AS applications_campaign_id_absent;

-- No copied production rows/identities before synthetic fixtures: counts only, no row values.
SELECT (SELECT count(*) FROM public.people) AS people_rows,
       (SELECT count(*) FROM public.admin_users) AS admin_user_rows,
       (SELECT count(*) FROM public.applications) AS application_rows,
       (SELECT count(*) FROM public.matches) AS match_rows;
-- Expected before approved synthetic provisioning: all zero. Do not query auth.users or storage objects.
