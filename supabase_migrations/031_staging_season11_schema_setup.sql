-- Migration 031: Season 11 Staging Schema Setup
-- Generates missing data governance infrastructure (closed month KPIs, import batches, QA issues)
-- and the operational tracking view for mentees to fix the "open-month bleed".
-- NOTE: Intended for staging environments only at this stage. No production data imports are included.
-- Governance infrastructure only: this migration does not import March 2026 data.
-- This migration does not rewrite dashboard RPCs yet.
-- Staging-first and not production-ready without review and explicit approval.

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- 1. Create data_import_batches
CREATE TABLE IF NOT EXISTS data_import_batches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    season_id UUID NULL REFERENCES seasons(id),
    import_date TIMESTAMPTZ NOT NULL DEFAULT now(),
    status TEXT NOT NULL DEFAULT 'pending',
    source_file TEXT,
    created_by TEXT,
    rows_processed INT DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    
    CONSTRAINT data_import_batches_status_check
      CHECK (status IN ('pending', 'completed', 'failed', 'rolled_back'))
);

CREATE INDEX IF NOT EXISTS data_import_batches_season_id_idx ON data_import_batches(season_id);

COMMENT ON TABLE data_import_batches IS
  'Tracks data import executions for auditability and rollbacks.';

-- 2. Create data_quality_issues
CREATE TABLE IF NOT EXISTS data_quality_issues (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id UUID NULL REFERENCES data_import_batches(id),
    entity_type TEXT NOT NULL,
    entity_id UUID NULL,
    issue_type TEXT NOT NULL,
    severity TEXT NOT NULL DEFAULT 'warning',
    description TEXT,
    raw_data JSONB,
    is_resolved BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    
    CONSTRAINT data_quality_issues_severity_check
      CHECK (severity IN ('block', 'warning', 'info'))
);

CREATE INDEX IF NOT EXISTS data_quality_issues_batch_id_idx ON data_quality_issues(batch_id);

COMMENT ON TABLE data_quality_issues IS
  'Tracks QA discrepancies (missing IDs, duplicates, block issues) encountered during data imports.';

-- 3. Create season_monthly_kpis
CREATE TABLE IF NOT EXISTS season_monthly_kpis (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    season_id UUID NOT NULL REFERENCES seasons(id),
    month_value TEXT NOT NULL,
    closed BOOLEAN NOT NULL DEFAULT false,
    total_mentees INT NOT NULL DEFAULT 0,
    total_recap_entries INT NOT NULL DEFAULT 0,
    distinct_mentees_with_recap INT NOT NULL DEFAULT 0,
    total_mentors INT NOT NULL DEFAULT 0,
    pct_mentees_with_recap NUMERIC,
    source_name TEXT,
    source_file TEXT,
    batch_id UUID NULL REFERENCES data_import_batches(id),
    notes TEXT,
    closed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT season_monthly_kpis_month_check
      CHECK (month_value ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
    CONSTRAINT season_monthly_kpis_season_month_key UNIQUE (season_id, month_value)
);

CREATE INDEX IF NOT EXISTS season_monthly_kpis_season_month_idx ON season_monthly_kpis(season_id, month_value);

COMMENT ON TABLE season_monthly_kpis IS
  'Official monthly KPI benchmarks. Governance infrastructure only: no March 2026 data is imported by this migration. Used by dashboards to strictly display data for explicitly closed months after RPC review.';

-- 4. Create v_mentee_monthly_tracking
-- A view that explicitly calculates per-mentee monthly status based on the mentoring_recaps table.
CREATE OR REPLACE VIEW v_mentee_monthly_tracking AS
SELECT 
    season_id,
    mentee_person_id,
    meeting_month,
    COUNT(id) AS valid_recap_count
FROM mentoring_recaps
WHERE coalesce(trim(lower(status)), '') IN ('', 'submitted', 'needs_review')
  AND mentee_person_id IS NOT NULL
GROUP BY season_id, mentee_person_id, meeting_month;

COMMENT ON VIEW v_mentee_monthly_tracking IS
  'Per-mentee operational view tracking valid recap volume in a given month. Callers should left join this against matches to find mentees with missing recaps (0 count) for the closed month.';

-- 5. Create latest closed month view
-- One row per season based only on explicitly closed monthly KPI rows.
CREATE OR REPLACE VIEW v_season_latest_closed_month AS
WITH closed_kpis AS (
    SELECT
        season_id,
        month_value,
        lag(month_value) OVER (
            PARTITION BY season_id
            ORDER BY month_value
        ) AS previous_closed_month,
        total_mentees,
        total_recap_entries,
        distinct_mentees_with_recap,
        pct_mentees_with_recap,
        row_number() OVER (
            PARTITION BY season_id
            ORDER BY month_value DESC
        ) AS latest_rank
    FROM season_monthly_kpis
    WHERE closed = true
)
SELECT
    season_id,
    month_value AS latest_closed_month,
    previous_closed_month,
    total_mentees,
    total_recap_entries,
    distinct_mentees_with_recap,
    pct_mentees_with_recap
FROM closed_kpis
WHERE latest_rank = 1;

COMMENT ON VIEW v_season_latest_closed_month IS
  'Returns latest and previous explicitly closed reporting months per season from season_monthly_kpis. Staging-first support view; dashboard RPCs are not rewritten by migration 031.';

-- 6. Add triggers for updated_at
DROP TRIGGER IF EXISTS data_import_batches_set_updated_at ON data_import_batches;
CREATE TRIGGER data_import_batches_set_updated_at
BEFORE UPDATE ON data_import_batches
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS data_quality_issues_set_updated_at ON data_quality_issues;
CREATE TRIGGER data_quality_issues_set_updated_at
BEFORE UPDATE ON data_quality_issues
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS season_monthly_kpis_set_updated_at ON season_monthly_kpis;
CREATE TRIGGER season_monthly_kpis_set_updated_at
BEFORE UPDATE ON season_monthly_kpis
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
