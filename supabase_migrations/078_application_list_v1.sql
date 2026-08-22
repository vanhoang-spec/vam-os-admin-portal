-- Migration 078: Application List View (R2A)

-- Provide a read-only view that coalesces identity and status across S11/S12,
-- pre-computes the search text blob, and resolves basic names to avoid
-- massive nested eager fetches during list rendering.

CREATE OR REPLACE VIEW application_list_v1 AS
SELECT
  a.id,
  a.person_id,
  a.season_id,
  a.intake_batch_id,
  a.role_applied,
  a.sbd,
  a.source,
  a.acquisition_channel,
  a.submitted_at,
  COALESCE(a.status, a.final_status) AS status_unified,
  COALESCE(a.consent_data_storage, a.consent_pdpa) AS consent_unified,
  COALESCE(a.full_name, p.full_name) AS full_name,
  COALESCE(a.email_primary, p.email_primary) AS email_primary,
  COALESCE(s.code, s.name) AS season_code,
  COALESCE(b.code, b.name) AS intake_batch_code,
  LOWER(
    COALESCE(a.full_name, p.full_name, '') || ' ' ||
    COALESCE(a.email_primary, p.email_primary, '') || ' ' ||
    COALESCE(a.sbd, '') || ' ' ||
    a.id || ' ' ||
    COALESCE(a.person_id, '')
  ) AS search_blob,
  COALESCE(a.intake_batch_id, a.season_id) AS batch_season_id
FROM applications a
LEFT JOIN people p ON a.person_id = p.id
LEFT JOIN seasons s ON a.season_id = s.id
LEFT JOIN intake_batches b ON a.intake_batch_id = b.id;

-- Security invoker enforces RLS from the underlying tables
ALTER VIEW application_list_v1 SET (security_invoker = true);

-- Provide a fast facet view for the list filters if needed
CREATE OR REPLACE VIEW application_facets_v1 AS
SELECT DISTINCT
  season_id,
  intake_batch_id,
  role_applied,
  COALESCE(status, final_status) AS status_unified,
  COALESCE(consent_data_storage, consent_pdpa) AS consent_unified,
  COALESCE(intake_batch_id, season_id) AS batch_season_id
FROM applications;

ALTER VIEW application_facets_v1 SET (security_invoker = true);

GRANT SELECT ON application_list_v1 TO authenticated, service_role;
GRANT SELECT ON application_facets_v1 TO authenticated, service_role;
