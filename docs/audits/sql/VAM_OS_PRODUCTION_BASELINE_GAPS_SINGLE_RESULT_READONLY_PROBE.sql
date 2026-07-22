-- OWNER-RUN READ-ONLY METADATA PROBE. NO BUSINESS ROWS, PII, OR SECRETS.
WITH
public_enums AS (
  SELECT t.oid AS type_oid, t.typname AS enum_name, e.enumlabel, e.enumsortorder
  FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace
  JOIN pg_enum e ON e.enumtypid=t.oid WHERE n.nspname='public'
),
public_types AS (
  SELECT t.oid, t.typname, t.typtype, t.typcategory, t.typnotnull,
         CASE WHEN t.typbasetype=0 THEN NULL ELSE t.typbasetype::regtype::text END AS base_type,
         obj_description(t.oid, 'pg_type') AS comment
  FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace
  WHERE n.nspname='public' AND t.typtype IN ('e','d','c')
),
public_views AS (
  SELECT c.oid, c.relname AS view_name, pg_get_viewdef(c.oid,true) AS definition,
         obj_description(c.oid,'pg_class') AS comment
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relkind IN ('v','m')
),
view_dependencies AS (
  SELECT DISTINCT pv.oid AS view_oid, rn.nspname AS referenced_schema,
         rc.relname AS referenced_object, rc.relkind AS referenced_kind
  FROM public_views pv JOIN pg_rewrite rw ON rw.ev_class=pv.oid
  JOIN pg_depend d ON d.classid='pg_rewrite'::regclass AND d.objid=rw.oid
  JOIN pg_class rc ON rc.oid=d.refobjid
  JOIN pg_namespace rn ON rn.oid=rc.relnamespace WHERE rc.oid<>pv.oid
),
public_sequences AS (
  SELECT c.oid, c.relname AS sequence_name, r.rolname AS owner,
         s.seqtypid::regtype::text AS data_type, s.seqstart, s.seqincrement,
         s.seqmax, s.seqmin, s.seqcache, s.seqcycle
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  JOIN pg_roles r ON r.oid=c.relowner JOIN pg_sequence s ON s.seqrelid=c.oid
  WHERE n.nspname='public' AND c.relkind='S'
),
sequence_ownership AS (
  SELECT d.objid AS sequence_oid, tn.nspname AS table_schema,
         tc.relname AS table_name, a.attname AS column_name, d.deptype
  FROM pg_depend d JOIN pg_class tc ON tc.oid=d.refobjid
  JOIN pg_namespace tn ON tn.oid=tc.relnamespace
  JOIN pg_attribute a ON a.attrelid=tc.oid AND a.attnum=d.refobjsubid
  WHERE d.classid='pg_class'::regclass AND d.deptype IN ('a','i')
),
public_functions AS (
  SELECT p.oid, p.proname AS function_name, pg_get_function_identity_arguments(p.oid) AS identity_args,
         p.prokind, l.lanname AS language, r.rolname AS owner, p.prosecdef AS security_definer,
         p.proconfig, pg_get_functiondef(p.oid) AS definition,
         obj_description(p.oid,'pg_proc') AS comment,
         EXISTS (SELECT 1 FROM pg_depend d JOIN pg_extension x ON x.oid=d.refobjid
                 WHERE d.classid='pg_proc'::regclass AND d.objid=p.oid AND d.deptype='e') AS extension_managed
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  JOIN pg_language l ON l.oid=p.prolang JOIN pg_roles r ON r.oid=p.proowner
  WHERE n.nspname='public' AND p.prokind IN ('f','p','w')
),
public_comments AS (
  SELECT c.relname AS object_name, c.relkind AS object_kind,
         obj_description(c.oid,'pg_class') AS comment
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND obj_description(c.oid,'pg_class') IS NOT NULL
),
payload AS (
  SELECT jsonb_build_object(
    'probe_version','vam-os-baseline-gaps-single-result-v1',
    'enums',COALESCE((SELECT jsonb_agg(to_jsonb(e) ORDER BY enum_name,enumsortorder) FROM public_enums e),'[]'::jsonb),
    'public_types',COALESCE((SELECT jsonb_agg(to_jsonb(t) ORDER BY typname) FROM public_types t),'[]'::jsonb),
    'views',COALESCE((SELECT jsonb_agg(to_jsonb(v) ORDER BY view_name) FROM public_views v),'[]'::jsonb),
    'view_dependencies',COALESCE((SELECT jsonb_agg(to_jsonb(d) ORDER BY view_oid,referenced_schema,referenced_object) FROM view_dependencies d),'[]'::jsonb),
    'sequences',COALESCE((SELECT jsonb_agg(to_jsonb(s) ORDER BY sequence_name) FROM public_sequences s),'[]'::jsonb),
    'sequence_ownership',COALESCE((SELECT jsonb_agg(to_jsonb(o) ORDER BY sequence_oid,table_name,column_name) FROM sequence_ownership o),'[]'::jsonb),
    'functions',COALESCE((SELECT jsonb_agg(to_jsonb(f) ORDER BY function_name,identity_args) FROM public_functions f),'[]'::jsonb),
    'comments',COALESCE((SELECT jsonb_agg(to_jsonb(c) ORDER BY object_name) FROM public_comments c),'[]'::jsonb)
  ) AS baseline_gap_metadata
)
SELECT baseline_gap_metadata FROM payload;
