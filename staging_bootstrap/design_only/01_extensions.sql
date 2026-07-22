-- STAGING ONLY. DESIGN ONLY. NOT AUTHORIZED. NOT EXECUTED.
-- MUST NEVER RUN ON PRODUCTION.
-- Production metadata: citext 1.6 and pgcrypto 1.3 are required by the selected public baseline.
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
-- Excluded: supabase_vault and all Supabase/platform-managed extension internals.
