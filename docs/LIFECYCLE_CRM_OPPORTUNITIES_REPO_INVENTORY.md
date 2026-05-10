# VAM OS Repo Inventory for Lifecycle, CRM, and Opportunities

## 1. Executive Summary
This document provides a concise inventory of existing VAM OS repository capabilities, specifically assessing what can be reused for the future Member Lifecycle, CRM Relationship History, and Opportunities foundation. The current system already possesses a robust program-scoped schema, an established intake/application workflow, and a foundational event tracking module. These existing pieces will significantly accelerate the development of a comprehensive CRM and Opportunity tracking system, though several structural gaps remain regarding long-term, cross-season member tracking.

## 2. Existing Tables/Features that can be Reused
- **Core Identity & Profiles:** `people`, `mentor_profiles`, `mentee_profiles` (already linked to seasons/batches via recent migrations).
- **Mentoring Lifecycle:** `matches` (manual matching foundation exists), `mentoring_recaps` (activity tracking).
- **Events & Opportunities:** `events`, `event_participations`, `event_registrations` (QR check-in foundation).
- **Intake & Progression:** `intake_batches`, `applications`, `reviews`, interviews logic (reusable for opportunity applications).
- **Organization & Scope:** `programs`, `seasons` (mentor taxonomy and programs established).
- **Access & Admin:** `admin_users`, `admin_scope_access`, `operational_team_assignments` (granular visibility control).
- **Admin Workflows:** `activity_correction_log` and admin correction workflows.

## 3. Existing UI Routes that can be Reused
- **CRM & Identity:** `/people`, `/mentors`, `/mentees` (can serve as the basis for a unified CRM profile view).
- **Lifecycle & Progression:** `/matches`, `/recaps`, `/applications`, `/reviews`, `/interviews`.
- **Opportunities & Activities:** `/events`, `/register`, `/checkin` (can be expanded for other opportunities).
- **Admin & Operations:** `/operations`, `/data-issues`, `/team`, `/actions` (reusable for CRM data governance and workflow oversight).

## 4. Existing Permission/Access Helpers that Matter
- **`lib/program-scope.ts`**: Critical for ensuring CRM and Opportunity data is properly gated by program (VAM vs. HAM) and season.
- **`lib/permissions.ts` & `lib/admin-auth.ts`**: Core role-based access control (RBAC) to manage who can view/edit relationship histories.
- **`lib/admin-users.ts`**: Helper for validating admin operational scopes and team assignments.
- **Row Level Security (RLS)**: Existing migrations (e.g., `018_draft_rls_read_policies.sql`, `020_admin_scope_access_schema_alignment.sql`) provide a blueprint for securing cross-season CRM data.

## 5. Existing Workflow Pieces that Overlap with CRM/Lifecycle/Opportunities
- **Application & Review Workflow:** The existing pipeline for applications, reviewer bulk assignment, and interview self-claiming directly maps to how members might apply for future Opportunities (e.g., jobs, advanced training).
- **Admin Correction Workflow:** The `data-issues` and `activity_correction_log` features are essential for maintaining CRM data integrity when updating historical relationships or fixing member states.
- **Event Registration & Check-in:** The current flow for event QR check-ins can be immediately repurposed to track participation in broader development opportunities.
- **Operational Team Assignments:** The logic for assigning admins to specific tasks or batches can be reused for assigning relationship managers or career coaches to members.

## 6. Clear List of Gaps
- No unified "Global Member Profile" that aggregates history across multiple programs/seasons independently of their current mentor/mentee status.
- Lack of a dedicated relationship history table to track informal connections, alumni networking, and non-programmatic interactions.
- No distinct "Opportunities" schema (e.g., job board, external workshops) separate from the standard VAM programmatic events.
- Missing a formal state machine for long-term member lifecycle transitions (e.g., Applicant -> Mentee -> Alumni -> Mentor).
- Skills, industry tagging, and member development taxonomy are currently basic and not fully integrated into a searchable CRM view.

## 7. Open Questions for Anh Thắng
- Should the "Global Profile" be a new entity, or should we heavily refactor the existing `people` table to serve as the master CRM record?
- Will "Opportunities" (like job postings) need program-scoped access, or should they be globally accessible to all validated VAM alumni?
- How much historical relationship data (pre-Season 11/6) needs to be migrated into the new CRM format?
- What is the preferred UX for the admin CRM view: a single timeline of all interactions, or tabbed views segregated by season/program?
- Are there specific external tools (like Mailchimp or formal CRM software) that this system needs to integrate with in the near future?
