# PHASE E: Season 12 Lifecycle Blueprint

This blueprint governs the end-to-end management of a new season (Season 12), from initialization through matching and active monitoring.

## 1. Create New Season
- **System Initialization**: Define Season 12 parameters in the database under a specific `program_id` (e.g., UEH Mentoring, Hanoi Alumni Mentoring), including start dates, target KPIs, and configuration settings distinct from Season 11.

## 2. Intake Applications
- **Application Portal**: Accept applications via native VAM OS forms (e.g., `/apply/[program]/[season]/mentor`). See [Application Portal Blueprint](APPLICATION_PORTAL_AND_INTAKE_BLUEPRINT.md).
- **Data Intake**: As a fallback, facilitate the secure import of new mentor and mentee applications via CSV.
- **Validation**: Ensure all required fields are present before creating the `new` application record in the staging area.

## 3. Classify Mentor/Mentee
- **Categorization**: Route applications into respective mentor or mentee pools based on form responses or predefined criteria.
- **Tagging**: Apply relevant tags (e.g., industry, experience level) to aid in the matching process.

## 4. Review Workflow
- **Application Statuses**: Applications transition through detailed states: `new` -> `reviewed` -> `interviewing` -> `accepted` / `rejected` / `waitlisted`.
- **Interface**: Provide a dedicated review screen for the core team to evaluate applications, append internal notes, and manage duplicates before converting them to profiles.

## 5. Matching Workflow
- **Drafting**: Create proposed mentor-mentee pairs in a sandbox environment without notifying users.
- **Algorithm/Support**: (Optional) Use basic heuristics to suggest potential matches based on tags and preferences.

## 6. Activate Matches
- **Finalization**: Confirm the draft matches, transitioning their status to `Active`.
- **Notification**: Trigger the automated email sequence to introduce the pair and provide their VAM portal credentials.

## 7. Season-Specific Dashboard
- **Context Switching**: Ensure the Admin portal allows seamless toggling between Season 11 historical data and active Season 12 metrics.
- **Data Isolation**: Verify that KPIs, charts, and issue queues strictly filter data to the currently selected season and assigned `program_id`.

## 8. Transition from Season 11 to Season 12
- **Offboarding**: Formalize the closure of Season 11 relationships (e.g., mark as `Completed` or `Alumni`).
- **Continuity**: Manage cases where a Season 11 pair chooses to continue their specific relationship into Season 12.
