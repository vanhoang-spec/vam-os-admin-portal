-- READ-ONLY METADATA PROBE. NO BUSINESS ROWS. OWNER EXECUTION REQUIRED.
WITH public_views AS (
  SELECT n.nspname AS schema_name, c.relname AS view_name,
         pg_get_viewdef(c.oid, true) AS definition, c.oid AS view_oid
  FROM pg_class AS c
  JOIN pg_namespace AS n ON n.oid = c.relnamespace
  JOIN pg_views AS v ON v.schemaname = n.nspname AND v.viewname = c.relname
  WHERE n.nspname = 'public' AND c.relkind = 'v'
), dependencies AS (
  SELECT pv.view_oid, rn.nspname AS referenced_schema, rc.relname AS referenced_object
  FROM public_views AS pv
  JOIN pg_rewrite AS rw ON rw.ev_class = pv.view_oid
  JOIN pg_depend AS d ON d.classid = 'pg_rewrite'::regclass AND d.objid = rw.oid
  JOIN pg_class AS rc ON rc.oid = d.refobjid
  JOIN pg_namespace AS rn ON rn.oid = rc.relnamespace
  WHERE rc.oid <> pv.view_oid
)
SELECT pv.schema_name, pv.view_name, pv.definition,
       COALESCE(jsonb_agg(DISTINCT jsonb_build_object('schema', d.referenced_schema, 'object', d.referenced_object))
         FILTER (WHERE d.referenced_object IS NOT NULL), '[]'::jsonb) AS dependencies
FROM public_views AS pv
LEFT JOIN dependencies AS d ON d.view_oid = pv.view_oid
GROUP BY pv.schema_name, pv.view_name, pv.definition
ORDER BY pv.schema_name, pv.view_name;
