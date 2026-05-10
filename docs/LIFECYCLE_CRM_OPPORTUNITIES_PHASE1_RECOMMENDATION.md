# Phase 1 Recommendation: Lifecycle, CRM, and Opportunities (Revised)

## 1. Final Phase 1 Scope
Phase 1 will focus exclusively on providing a unified view of members across seasons and logging core CRM interactions for the operational team. The scope is strictly limited to establishing `person_season_memberships` to map identities to programs over time, building a robust `crm_notes` system with action tracking built-in, and integrating a permission-scoped person timeline directly into the existing member profile pages. 

## 2. Tables to Create
- **`person_season_memberships`:** Maps a `person_id` to a `season_id` indicating their role/status for that specific program cycle.
- **`person_season_membership_log`:** Provides an immutable audit trail for status changes or role updates within the membership table.
- **`crm_notes`:** Stores qualitative interactions. Instead of a separate follow-ups table, this table should include lightweight action fields: `next_action_text`, `next_action_due_date`, and `owner_admin_user_id`.

## 3. Existing Tables to Reuse
- **`people`**: Remains the master global identity source.
- **`action_items`**: May be evaluated for extended use if the lightweight action fields inside `crm_notes` prove insufficient.
- **`matches`, `events`, `event_participations`**: Used to populate the timeline.
- **`admin_users`, `admin_scope_access`**: Drive visibility and permission rules.

## 4. Tables Explicitly Deferred
- `crm_follow_ups` (reusing `action_items` or lightweight `crm_notes` fields instead)
- `opportunity_categories`
- `opportunities` (and related applications/matches)
- `scholarships` / `scholarship_applications`
- `corporate_engagement_programs` (CEP)
- `mentor_certifications` / `training_progress`

## 5. UI to Build
- **Integrated Person Timeline (`/people/[id]`):** Build timeline and history features as tabs or sections within the existing member detail page, rather than a standalone `/people/[id]/timeline` route.
- **CRM Note Editor:** A modal/drawer component within the profile to add notes and assign simple follow-ups (next action text, due date, owner).
- **Duplicate Risk Flags:** Simple UI indicators highlighting potential duplicate profiles based on email or phone, without building a merge resolution tool.

## 6. Permission/Privacy Rules
- **CRM Note Visibility (4-Level Model):**
  - **Private:** Visible only to the author and super admins.
  - **Ops_Only:** Visible to core operations team members.
  - **Team:** Visible to all admins within the assigned program.
  - **System:** Automated system logs.
- **Timeline Visibility Scoping:**
  - `super_admin`: Full cross-program and cross-season history.
  - Program Admins: Only data (matches, notes, events) for their allowed programs and seasons.
  - Support/Viewer Roles: Limited or no access to sensitive CRM notes.
- **RLS Strategy:** Row-Level Security policies should be designed for the new tables but should *not* be blindly enabled in production. Rely on current app-layer auth and recommend a staging-only security QA phase before turning on production RLS.

## 7. Backfill Strategy
- Identify duplicate identities and generate a risk report, but do not automatically merge. 
- Run idempotent scripts to populate `person_season_memberships` and `person_season_membership_log` based on historical `matches` and intake data.

## 8. Codex Implementation Sequence
1. **Schema Design:** Create `person_season_memberships`, `person_season_membership_log`, and `crm_notes` (with lightweight action fields).
2. **Security & RLS (Staging):** Draft RLS policies based on the 4-level visibility model and program scopes, but test exclusively in staging.
3. **API & Data Access:** Update application-layer auth queries to securely fetch timeline data respecting program boundaries.
4. **UI Integration:** Add the timeline and CRM notes sections into `/people/[id]`.
5. **Backfill Scripting:** Safely migrate existing history into memberships and generate duplication warnings.

## 9. Do-Not-Build List (Hard Defer)
- Automated season rollover wizard.
- Opportunities, scholarships, and CEP workflows.
- Mentor certification tracking and volunteer hour logging.
- Supporter / Partner recruitment pipeline tools.
- Identity merge UI / resolution tools.
- Mentor self-confirmation portal.
- Separate `crm_follow_ups` table.
- Standalone `/people/[id]/timeline` route.
- `opportunity_categories` lookup table.

## 10. Open Questions Remaining
- If lightweight follow-ups in `crm_notes` expand, at what threshold do we migrate them fully into the existing `action_items` workflow?
- How should we notify the `owner_admin_user_id` when a `next_action_due_date` is approaching?
- Will support roles need a specific UI strictly for resolving the flagged duplicate identities in a future phase?
