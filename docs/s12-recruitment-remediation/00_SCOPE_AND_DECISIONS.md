# S12 Recruitment Operational Remediation — Scope and Decisions

Status: in progress

## Objective

Make the existing UEH Mentoring Season 12 recruitment workflow operationally usable by Core Team at real volume without reopening a broad VAM OS audit or adding unrelated future-platform work.

## Locked product decisions

1. S12 Profile Review requires at least one reviewer. The threshold must be configurable by season and stage. Core Team may assign more reviewers when needed.
2. Mentor CV/interview availability is collected externally through Google Form/Sheet for S12. Core Team grants personal Reviewer/Interviewer access in VAM OS. Public self-registration is out of scope.
3. Least privilege applies: only actual recruitment participants receive Reviewer/Interviewer permissions, and shared accounts are prohibited.
4. Bulk Final Decision must enforce the same lifecycle eligibility gates as individual decisions.

## Explicit non-goals

- Public account self-registration.
- Replacing the S12 Google Form/Sheet availability collection.
- Broad platform, CRM, matching, events, or future-season redesign.
- Broad VAM OS security or product audit outside changed recruitment paths.

## Environments

- Production application: `vam-os-admin-portal` on Vercel.
- Production Supabase: `vam-os-mvp` (`qkkroesfiazsejkzflcd`).
- Staging Supabase: `vam-os-staging` (`ljfneyuvpxrmejpxsmpz`).
- Git production baseline: `origin/main` at remediation start.
- Git staging divergence is reconciled explicitly; it is not assumed to be a deployable superset of production.

