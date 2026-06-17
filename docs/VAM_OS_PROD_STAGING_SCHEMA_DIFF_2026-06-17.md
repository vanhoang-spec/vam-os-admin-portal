# VAM OS Production vs. Staging Schema Diff

**Date:** 2026-06-17
*Generated via structured read-only catalog queries on local replicas.*

## Restore Validation Report
The production and staging schema dumps were restored locally into isolated empty databases.
- **ON_ERROR_STOP=1** was *intentionally omitted*. Enabling it would immediately halt the entire restore at the first missing Supabase-managed proprietary extension (e.g., `supabase_vault`), completely preventing the standard `public` schema from being restored.
- **Restore Errors**: Both restores produced exactly 1 ERROR related strictly to: `ERROR: extension "supabase_vault" is not available`. There were 0 FATAL errors.
- **Objects Omitted/Failed**: 0 public application objects failed. 
- **Supabase-Managed Objects Not Reproducible Locally**: Proprietary Supabase extensions (`supabase_vault`, `pg_graphql` configurations), `auth`, `storage`, and `realtime` schema triggers that depend on Supabase infrastructure.
- **Verification**: The `public` schema table counts were verified mathematically against the original SQL dumps (`grep "CREATE TABLE public"`). 
  - Production: 49 tables in dump, 49 restored and captured.
  - Staging: 38 tables in dump, 38 restored and captured.
- **Uncertain Findings**: None. The public catalog extraction is validated for application-owned public schema objects, with the documented `supabase_vault` extension exception and any Supabase-managed objects excluded.

- **Table**: application_answers
- **Table**: application_decisions
- **Table**: application_reviews
- **Table**: applications
- **Table**: communications
- **Table**: data_issues
- **Table**: feedback_responses
- **Table**: operational_team_assignments
- **Table**: person_roles
- **Table**: review_assignment_batches
- **Table**: staging_application_answers_import
- **Table**: staging_applications_import
- **Table**: staging_event_registrations_import
- **Table**: staging_events_import
- **Table**: staging_feedback_import
- **Table**: staging_matches_import
- **Table**: staging_mentee_profiles_import
- **Table**: staging_mentor_profiles_import
- **Table**: staging_people_import
- **Table**: staging_person_roles_import
- **Function**: citext
- **Function**: citext
- **Function**: citext
- **Function**: citext_cmp
- **Function**: citext_eq
- **Function**: citext_ge
- **Function**: citext_gt
- **Function**: citext_hash
- **Function**: citext_hash_extended
- **Function**: citext_larger
- **Function**: citext_le
- **Function**: citext_lt
- **Function**: citext_ne
- **Function**: citext_pattern_cmp
- **Function**: citext_pattern_ge
- **Function**: citext_pattern_gt
- **Function**: citext_pattern_le
- **Function**: citext_pattern_lt
- **Function**: citext_smaller
- **Function**: citextin
- **Function**: citextout
- **Function**: citextrecv
- **Function**: citextsend
- **Function**: is_admin_role
- **Function**: max
- **Function**: min
- **Function**: regexp_match
- **Function**: regexp_match
- **Function**: regexp_matches
- **Function**: regexp_matches
- **Function**: regexp_replace
- **Function**: regexp_replace
- **Function**: regexp_split_to_array
- **Function**: regexp_split_to_array
- **Function**: regexp_split_to_table
- **Function**: regexp_split_to_table
- **Function**: replace
- **Function**: split_part
- **Function**: strpos
- **Function**: texticlike
- **Function**: texticlike
- **Function**: texticnlike
- **Function**: texticnlike
- **Function**: texticregexeq
- **Function**: texticregexeq
- **Function**: texticregexne
- **Function**: texticregexne
- **Function**: translate

## 2. Staging-Only Application Objects
These tables and functions exist in Staging but are not in Production (newer features or temporary tables).
- **Table**: action_item_comments
- **Table**: staging_ham_s6_import_skips
- **Table**: staging_ham_s6_people_identity_map
- **Table**: staging_ham_s6_recap_pilot_audit
- **Table**: staging_reference_seed_matches
- **Table**: staging_reference_seed_mentee_profiles
- **Table**: staging_reference_seed_mentor_profiles
- **Table**: staging_reference_seed_people
- **Table**: temp_prod_people
- **Function**: add_action_item_comment
- **Function**: create_action_item
- **Function**: generate_monthly_followup_actions
- **Function**: get_operations_workflow_data
- **Function**: set_action_items_updated_at
- **Function**: update_action_item

## 3. Definition Mismatches (Common Tables)
### Table: action_items
- RLS Enabled mismatch: Prod=True, Stag=False
- Prod-only columns: type, target_person_id, season_code, owner_email, notes
- Staging-only columns: season_id, owner_admin_user_id, created_by_admin_user_id, resolved_by_admin_user_id, due_date, resolved_at
### Table: activity_correction_log
- RLS Enabled mismatch: Prod=True, Stag=False
- Staging-only columns: season_id, entity_type, entity_id, before_data, after_data, requested_by_admin_user_id, reviewed_by_admin_user_id, status, reviewed_at
- Prod-only policies: read_activity_correction_log_review_roles
### Table: admin_audit_log
- RLS Enabled mismatch: Prod=True, Stag=False
- Prod-only columns: action, actor_email, target_email, metadata, updated_at, details
### Table: admin_scope_access
- Prod-only policies: admin read access, super admin write access
- Staging-only policies: read_admin_scope_access_self_or_super_admin
### Table: admin_users
- RLS Enabled mismatch: Prod=False, Stag=True
- Staging-only policies: active admins can read themselves
### Table: data_import_batches
- RLS Enabled mismatch: Prod=False, Stag=True
### Table: data_quality_issues
- RLS Enabled mismatch: Prod=False, Stag=True
### Table: event_participations
- Prod-only columns: updated_at
- Staging-only columns: status
- Prod-only policies: read_event_participations_internal_roles
### Table: event_registrations
- Prod-only columns: legacy_event_registration_temp_id, person_id, source_notes, source_sheet, source_row_id, reviewed_at, reviewed_by, cancelled_at, cancelled_by, cancel_reason, waitlist_position, waitlisted_by, rejected_by, reject_reason
### Table: events
- RLS Enabled mismatch: Prod=False, Stag=True
- Prod-only columns: source_sheet, source_row_id, updated_at, proof_instruction, collect_speaker_questions, speaker_question_prompt, show_no_show_policy, show_role_field, public_description
- Staging-only columns: name, season_code
- Prod-only policies: read_events_active_admins
### Table: matches
- RLS Enabled mismatch: Prod=False, Stag=True
- Prod-only columns: legacy_match_temp_id, source_sheet, source_row_id, mentor_profile_id, mentee_profile_id, intake_batch_id, match_source, matched_by, ended_at, end_reason, admin_notes
- Staging-only columns: mentor_id, mentee_id, season_code, match_reason, support_team, match_quality_score, primary_match
- Prod-only policies: read_matches_internal_roles
### Table: mentee_profiles
- RLS Enabled mismatch: Prod=False, Stag=True
- Prod-only columns: mssv_raw, gpa_4, has_prior_season, source_sheet, source_row_id, source_application_id
- Staging-only columns: status, school_or_faculty, graduation_year, target_function, english_level, location, mentee_status
- Prod-only policies: read_mentee_profiles_internal_roles
### Table: mentor_profiles
- Prod-only columns: alma_mater, first_joined_year, interests_text, support_team_lead, admin_notes, source_sheet, source_row_id, source_application_id
- Staging-only columns: mentor_type, bio_short, linkedin_url
- Prod-only policies: read_mentor_profiles_internal_roles
### Table: mentoring_recaps
- Prod-only columns: updated_at
- Prod-only policies: read_mentoring_recaps_internal_roles
### Table: people
- RLS Enabled mismatch: Prod=False, Stag=True
- Prod-only columns: legacy_person_temp_id, full_name_normalized, phone_raw, date_of_birth, facebook_url, preferred_language, consent_pdpa, consent_pdpa_at, consent_marketing_email, source_sheet, source_row_id, updated_at
- Staging-only columns: role
- Prod-only policies: read_people_internal_roles
### Table: programs
- Prod-only columns: description, updated_at
- Prod-only policies: read_programs_active_admins
### Table: season_monthly_kpis
- RLS Enabled mismatch: Prod=False, Stag=True
### Table: seasons
- Prod-only columns: status, starts_on, ends_on, updated_at
- Prod-only policies: read_seasons_active_admins

## 4. Migration Files Missing from Staging
Based on the missing application/review tables and read_*_roles policies, Staging appears to be missing several migrations entirely, notably:
- **Migration 018** (Internal/Active Admin RLS Policies for core tables like events, matches, people)
- **Migrations related to Applications & Reviews** (application_answers, application_reviews, etc.)
- **Migrations related to Communications & Data Issues**
Conversely, Staging contains newer Action Items workflow migrations (e.g., 050) which may not be fully in Production or are disjoint.

## 5. Supabase-Managed Objects Excluded
The following standard objects were ignored in the application comparison:
- Extension: pg_stat_statements
- Schema: auth, storage, realtime
- Roles: anon, authenticated, service_role
