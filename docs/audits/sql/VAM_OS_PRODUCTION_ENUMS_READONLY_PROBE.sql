-- READ-ONLY METADATA PROBE. DO NOT MODIFY DATA. OWNER EXECUTION REQUIRED.
WITH public_enums AS (
  SELECT n.nspname AS schema_name, t.typname AS enum_name,
         e.enumlabel, e.enumsortorder
  FROM pg_type AS t
  JOIN pg_namespace AS n ON n.oid = t.typnamespace
  JOIN pg_enum AS e ON e.enumtypid = t.oid
  WHERE n.nspname = 'public'
)
SELECT schema_name, enum_name, enumlabel, enumsortorder
FROM public_enums
ORDER BY schema_name, enum_name, enumsortorder;
