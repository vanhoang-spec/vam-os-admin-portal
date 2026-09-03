# Performance Baseline

Status: post-compute browser measurement pending authenticated staging access

Production compute was confirmed by the product owner as Pro/Micro in Singapore on 2026-08-30. No production write or migration is authorized in this phase.

Fresh authenticated browser timings require Core Team/Reviewer UAT sessions. Existing code-path evidence retained from current main: paged application-list reads and the current-main manual-review performance changes. Hot-path candidates to measure—not blindly apply—are covering indexes on `application_answers.application_id` and `applications.person_id`, plus RLS init-plan warnings on `application_reviews` and `admin_scope_access`.

This document will record representative S12 volume assumptions, query/request counts, timings, pagination behavior, bulk-operation limits, and before/after measurements. Measurements must distinguish local synthetic, staging, and production read-only evidence.
