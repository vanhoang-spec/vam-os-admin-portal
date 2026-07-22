-- STAGING ONLY. DESIGN ONLY. NOT AUTHORIZED. NOT EXECUTED.
-- MUST NEVER RUN ON PRODUCTION.
-- Generated only from safety-reviewed catalog metadata and repository-confirmed later alterations.

ALTER TABLE "public"."seasons" ADD CONSTRAINT "seasons_program_id_fkey" FOREIGN KEY (program_id) REFERENCES programs(id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "public"."intake_batches" ADD CONSTRAINT "intake_batches_season_id_fkey" FOREIGN KEY (season_id) REFERENCES seasons(id) ON DELETE RESTRICT;
ALTER TABLE "public"."person_roles" ADD CONSTRAINT "person_roles_person_id_fkey" FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "public"."person_roles" ADD CONSTRAINT "person_roles_season_id_fkey" FOREIGN KEY (season_id) REFERENCES seasons(id) ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "public"."mentor_profiles" ADD CONSTRAINT "mentor_profiles_intake_batch_id_fkey" FOREIGN KEY (intake_batch_id) REFERENCES intake_batches(id);
ALTER TABLE "public"."mentor_profiles" ADD CONSTRAINT "mentor_profiles_person_id_fkey" FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "public"."mentor_profiles" ADD CONSTRAINT "mentor_profiles_source_application_id_fkey" FOREIGN KEY (source_application_id) REFERENCES applications(id);
ALTER TABLE "public"."mentee_profiles" ADD CONSTRAINT "mentee_profiles_intake_batch_id_fkey" FOREIGN KEY (intake_batch_id) REFERENCES intake_batches(id);
ALTER TABLE "public"."mentee_profiles" ADD CONSTRAINT "mentee_profiles_person_id_fkey" FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "public"."mentee_profiles" ADD CONSTRAINT "mentee_profiles_source_application_id_fkey" FOREIGN KEY (source_application_id) REFERENCES applications(id);
ALTER TABLE "public"."applications" ADD CONSTRAINT "applications_intake_batch_id_fkey" FOREIGN KEY (intake_batch_id) REFERENCES intake_batches(id);
ALTER TABLE "public"."applications" ADD CONSTRAINT "applications_person_id_fkey" FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "public"."applications" ADD CONSTRAINT "applications_season_id_fkey" FOREIGN KEY (season_id) REFERENCES seasons(id) ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "public"."application_answers" ADD CONSTRAINT "application_answers_application_id_fkey" FOREIGN KEY (application_id) REFERENCES applications(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "public"."events" ADD CONSTRAINT "events_intake_batch_id_fkey" FOREIGN KEY (intake_batch_id) REFERENCES intake_batches(id) ON DELETE SET NULL;
ALTER TABLE "public"."events" ADD CONSTRAINT "events_season_id_fkey" FOREIGN KEY (season_id) REFERENCES seasons(id) ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "public"."event_links" ADD CONSTRAINT "event_links_event_id_fkey" FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE;
ALTER TABLE "public"."event_registrations" ADD CONSTRAINT "event_registrations_event_id_fkey" FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "public"."event_registrations" ADD CONSTRAINT "event_registrations_event_link_id_fkey" FOREIGN KEY (event_link_id) REFERENCES event_links(id) ON DELETE SET NULL;
ALTER TABLE "public"."event_registrations" ADD CONSTRAINT "event_registrations_linked_person_id_fkey" FOREIGN KEY (linked_person_id) REFERENCES people(id) ON DELETE SET NULL;
ALTER TABLE "public"."event_registrations" ADD CONSTRAINT "event_registrations_person_id_fkey" FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "public"."event_participations" ADD CONSTRAINT "event_participations_event_id_fkey" FOREIGN KEY (event_id) REFERENCES events(id);
ALTER TABLE "public"."event_participations" ADD CONSTRAINT "event_participations_person_id_fkey" FOREIGN KEY (person_id) REFERENCES people(id);
ALTER TABLE "public"."event_participations" ADD CONSTRAINT "event_participations_season_id_fkey" FOREIGN KEY (season_id) REFERENCES seasons(id);
-- BLOCKED: mentoring_recaps_match_id_fkey depends on unresolved public.matches.
ALTER TABLE "public"."mentoring_recaps" ADD CONSTRAINT "mentoring_recaps_mentee_person_id_fkey" FOREIGN KEY (mentee_person_id) REFERENCES people(id);
ALTER TABLE "public"."mentoring_recaps" ADD CONSTRAINT "mentoring_recaps_mentor_person_id_fkey" FOREIGN KEY (mentor_person_id) REFERENCES people(id);
ALTER TABLE "public"."mentoring_recaps" ADD CONSTRAINT "mentoring_recaps_season_id_fkey" FOREIGN KEY (season_id) REFERENCES seasons(id);
-- BLOCKED: season_monthly_kpis_batch_id_fkey targets data_import_batches,
-- which remains OWNER CLASSIFICATION REQUIRED and is not emitted in 04_tables.sql.
ALTER TABLE "public"."season_monthly_kpis" ADD CONSTRAINT "season_monthly_kpis_season_id_fkey" FOREIGN KEY (season_id) REFERENCES seasons(id);
ALTER TABLE "public"."application_reviews" ADD CONSTRAINT "application_reviews_application_id_fkey" FOREIGN KEY (application_id) REFERENCES applications(id) ON DELETE CASCADE;
ALTER TABLE "public"."application_reviews" ADD CONSTRAINT "application_reviews_assigned_by_fkey" FOREIGN KEY (assigned_by) REFERENCES admin_users(id);
ALTER TABLE "public"."application_reviews" ADD CONSTRAINT "application_reviews_assignment_batch_id_fkey" FOREIGN KEY (assignment_batch_id) REFERENCES review_assignment_batches(id);
ALTER TABLE "public"."application_reviews" ADD CONSTRAINT "application_reviews_reviewer_admin_user_id_fkey" FOREIGN KEY (reviewer_admin_user_id) REFERENCES admin_users(id);
ALTER TABLE "public"."application_decisions" ADD CONSTRAINT "application_decisions_application_id_fkey" FOREIGN KEY (application_id) REFERENCES applications(id) ON DELETE CASCADE;
ALTER TABLE "public"."application_decisions" ADD CONSTRAINT "application_decisions_decided_by_fkey" FOREIGN KEY (decided_by) REFERENCES admin_users(id);
ALTER TABLE "public"."review_assignment_batches" ADD CONSTRAINT "review_assignment_batches_created_by_fkey" FOREIGN KEY (created_by) REFERENCES admin_users(id);
ALTER TABLE "public"."review_assignment_batches" ADD CONSTRAINT "review_assignment_batches_intake_batch_id_fkey" FOREIGN KEY (intake_batch_id) REFERENCES intake_batches(id);
ALTER TABLE "public"."person_season_memberships" ADD CONSTRAINT "person_season_memberships_created_by_fkey" FOREIGN KEY (created_by) REFERENCES admin_users(id) ON DELETE SET NULL;
ALTER TABLE "public"."person_season_memberships" ADD CONSTRAINT "person_season_memberships_intake_batch_id_fkey" FOREIGN KEY (intake_batch_id) REFERENCES intake_batches(id) ON DELETE SET NULL;
ALTER TABLE "public"."person_season_memberships" ADD CONSTRAINT "person_season_memberships_person_id_fkey" FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE CASCADE;
ALTER TABLE "public"."person_season_memberships" ADD CONSTRAINT "person_season_memberships_program_id_fkey" FOREIGN KEY (program_id) REFERENCES programs(id) ON DELETE RESTRICT;
ALTER TABLE "public"."person_season_memberships" ADD CONSTRAINT "person_season_memberships_season_id_fkey" FOREIGN KEY (season_id) REFERENCES seasons(id) ON DELETE RESTRICT;
ALTER TABLE "public"."person_season_membership_log" ADD CONSTRAINT "person_season_membership_log_changed_by_fkey" FOREIGN KEY (changed_by) REFERENCES admin_users(id) ON DELETE SET NULL;
ALTER TABLE "public"."person_season_membership_log" ADD CONSTRAINT "person_season_membership_log_membership_id_fkey" FOREIGN KEY (membership_id) REFERENCES person_season_memberships(id) ON DELETE RESTRICT;
ALTER TABLE "public"."person_season_membership_log" ADD CONSTRAINT "person_season_membership_log_person_id_fkey" FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE RESTRICT;
ALTER TABLE "public"."person_season_membership_log" ADD CONSTRAINT "person_season_membership_log_program_id_fkey" FOREIGN KEY (program_id) REFERENCES programs(id) ON DELETE RESTRICT;
ALTER TABLE "public"."person_season_membership_log" ADD CONSTRAINT "person_season_membership_log_season_id_fkey" FOREIGN KEY (season_id) REFERENCES seasons(id) ON DELETE RESTRICT;

-- Cyclic FK review: no directed cycle exists among emitted deterministic tables.
-- 46 authoritative FKs are emitted; nine are blocked (eight by matches, one by data_import_batches).
-- All FKs remain separated from CREATE TABLE so a future reviewed execution can create base tables first.
