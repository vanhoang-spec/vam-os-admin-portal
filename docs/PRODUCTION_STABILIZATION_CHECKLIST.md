# PHASE A: Production Stabilization Checklist

This checklist focuses on immediate steps to stabilize the production application, ensuring core administrative workflows and data entry functions operate correctly after the initial release of the dashboard and closed-month data.

## 1. Authentication & Environment Fixes
- [ ] **Fix `SUPABASE_SERVICE_ROLE_KEY`**: Ensure the correct production service role key is securely stored in Vercel's environment variables. This is the immediate fix required for the "Invalid API key" errors observed on `/admin/users` and `/admin` workflow routes.

## 2. Admin Quality Assurance (QA)
- [ ] **QA `/admin/users`**: Verify the user directory loads successfully. Confirm that role management and visibility are functioning according to specifications.
- [ ] **QA `/admin` workflow**: Execute a full pass of standard administrative operations to identify any remaining authorization or data fetching issues.

## 3. Data Entry & Operations QA
- [ ] **QA manual recap add/edit**: Verify that administrators can successfully create new mentoring recaps manually and edit existing ones. Ensure all constraints (e.g., valid mentor/mentee pairs) are enforced without throwing unhandled errors.
- [ ] **QA event/training create/edit**: Confirm the ability to define new events, workshops, or training sessions, and update their details post-creation.
- [ ] **QA attendance tracking**: Validate the workflow for recording who attended which event, including toggling statuses.

## 4. Security & Compliance QA
- [ ] **QA audit log**: Ensure that all critical administrative actions (adding recaps, editing events, modifying users) are securely and accurately recorded in the system audit log, including the user, action type, and timestamp.
