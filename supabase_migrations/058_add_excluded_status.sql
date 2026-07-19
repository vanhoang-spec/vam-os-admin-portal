-- 058_add_excluded_status.sql
-- Adds 'excluded' to the mentoring_recaps.status CHECK constraint.
--
-- This is a DDL-only migration: it changes no recap data and is safe to apply
-- independently of the UEHM-S11 data sync (sync_s11_recaps.mjs --apply).
--
-- After this migration is installed, the sync script's --apply mode will
-- atomically UPDATE 125 excess/anomaly rows to status='excluded' and INSERT
-- 1,028 new official-ledger rows inside a single transaction.
--
-- Counting impact:
--   The VAM OS reporting filter is an INCLUSION whitelist:
--     coalesce(trim(lower(status)), '') IN ('', 'submitted', 'needs_review')
--   'excluded' is not in this whitelist, so excluded rows are automatically
--   invisible to all KPI queries and client-side isValidRecapActivity() without
--   any further code changes.

DO $$ BEGIN
  IF EXISTS (
    SELECT 1
    FROM   pg_constraint
    WHERE  conname     = 'mentoring_recaps_status_check'
      AND  conrelid    = 'public.mentoring_recaps'::regclass
  ) THEN
    ALTER TABLE public.mentoring_recaps
      DROP CONSTRAINT mentoring_recaps_status_check;
  END IF;

  ALTER TABLE public.mentoring_recaps
    ADD CONSTRAINT mentoring_recaps_status_check
      CHECK (status IN (
        'submitted',
        'needs_review',
        'invalid',
        'duplicate',
        'deleted',
        'excluded'
      ));
END; $$;

COMMENT ON COLUMN public.mentoring_recaps.status IS
  'submitted    = active recap; counted in KPI reports. '
  'needs_review = requires manual resolution (e.g. ledger placeholder); counted in KPI reports. '
  'invalid      = confirmed data-quality error; excluded from KPIs. '
  'duplicate    = known duplicate posting; excluded from KPIs. '
  'deleted      = soft-deleted by an admin; excluded from KPIs. '
  'excluded     = row exceeds the official ledger count for this mentee/month; '
  '               set by sync_s11_recaps.mjs --apply; excluded from KPIs. '
  'KPI reporting filter (RPC + client): status IN ('''', ''submitted'', ''needs_review'').';
