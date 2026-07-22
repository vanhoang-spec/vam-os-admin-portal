-- READ-ONLY METADATA PROBE. NO BUSINESS ROWS. OWNER EXECUTION REQUIRED.
WITH public_sequences AS (
  SELECT n.nspname AS schema_name, c.relname AS sequence_name, r.rolname AS owner,
         s.seqtypid::regtype::text AS data_type, s.seqstart AS start_value,
         s.seqincrement AS increment_by, s.seqmin AS min_value, s.seqmax AS max_value,
         s.seqcache AS cache_size, s.seqcycle AS cycle, c.oid AS sequence_oid
  FROM pg_class AS c
  JOIN pg_namespace AS n ON n.oid = c.relnamespace
  JOIN pg_roles AS r ON r.oid = c.relowner
  JOIN pg_sequence AS s ON s.seqrelid = c.oid
  WHERE n.nspname = 'public' AND c.relkind = 'S'
), ownership AS (
  SELECT d.objid AS sequence_oid, tn.nspname AS table_schema, tc.relname AS table_name,
         a.attname AS column_name
  FROM pg_depend AS d
  JOIN pg_class AS tc ON tc.oid = d.refobjid
  JOIN pg_namespace AS tn ON tn.oid = tc.relnamespace
  JOIN pg_attribute AS a ON a.attrelid = tc.oid AND a.attnum = d.refobjsubid
  WHERE d.classid = 'pg_class'::regclass AND d.deptype IN ('a', 'i')
)
SELECT ps.*, o.table_schema, o.table_name, o.column_name
FROM public_sequences AS ps
LEFT JOIN ownership AS o ON o.sequence_oid = ps.sequence_oid
ORDER BY ps.schema_name, ps.sequence_name;
