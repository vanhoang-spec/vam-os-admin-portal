# PHASE G: Multi-Program Architecture & Mentor/Mentee Portal Blueprint

This blueprint outlines the vision and requirements for scaling VAM OS into a multi-program platform and introducing an external-facing portal for mentors and mentees.

## 1. Multi-Program Architecture
VAM OS will transition from a single-program system (UEH Mentoring) to a multi-tenant architecture supporting various initiatives (e.g., Hanoi Alumni Mentoring, future university programs).

### Core Concept:
- **Hierarchy**: VAM OS &rarr; Program &rarr; Season &rarr; User/Match/Recap/Event/Attendance/Feedback
- **Data Isolation**: All operational data (mentor database, mentee database, matching, recaps, follow-up queue, data issues, events, dashboards, reports) must be strictly separated by `program_id` and `season_id`.

### User-Program Mapping:
- **Do NOT assume 1 user = 1 program**: A single user account may participate in multiple programs.
- **Mapping Model**: Introduce a `user_program_roles` mapping model containing:
  - `user_id`
  - `program_id`
  - `role`
- **Capability**: Users can belong to multiple programs simultaneously, potentially with different roles in each (e.g., Mentee in Program A, Mentor in Program B).

## 2. Program-Level Permission Model
The future roles and permissions are defined to maintain strict data governance across programs:

- **Super Admin**: Manages all programs, seasons, users, and system-level permissions.
- **VAM Admin**: Views and manages all operational data across programs, but cannot manage system-level settings.
- **Program Admin**: Manages only their assigned program(s) and season(s).
- **Program Operations Admin**: Handles recaps, events, attendance, follow-up, and data correction exclusively within their assigned `program_id` and `season_id`.
- **Viewer / Board Viewer**: View-only access to dashboards and aggregate reports. No edit rights.
- **Mentor / Mentee**: External/self-service users with restricted, match-scoped visibility.

## 3. Mentor / Mentee Portal
A dedicated login portal will be introduced for external participants.

### Authentication & Identity:
- **Login Identity**: `username` = email address.
- **Password Policy**: 
  - The "last 4 digits of phone number" will NOT be a permanent password. It may only serve as a temporary first-login password.
  - Recommended implementations: Temporary passwords with forced reset on first login, Magic link / Email OTP, or Admin-invited account activation flows.

### Match-Scoped Access:
- **Mentor Access**: Must be strictly scoped by `match_id`. A mentor can only access data related to their own matches.
- **Mentee Access**: Must be strictly scoped by `match_id`. A mentee can only access data related to their own match.
- **Data Limitation**: External users have no access to full program-level data, except for specifically allowed aggregate insights.

### Mentor Visibility:
**Can see:**
- Their own profile
- Their assigned mentee(s)
- Recaps related to their own match
- Events/trainings open to them
- Their own attendance/registration status
- Ability to submit recaps or feedback (if enabled)

**Cannot see:**
- Private contact info of other mentors/mentees
- Recaps of unrelated matches
- Admin notes, data correction logs, or sensitive follow-up notes

### Mentee Visibility:
**Can see:**
- Their own profile
- Their assigned mentor
- Recaps related to their own match
- Events/trainings open to them
- Their own attendance/registration status
- Ability to submit recaps or feedback (if enabled)

**Cannot see:**
- Private contact info of other mentees/mentors
- Recaps of unrelated matches
- Admin notes, data correction logs, or sensitive follow-up notes

## 4. Public/Community Directory View
A limited community directory will be available to logged-in Mentors and Mentees to foster community engagement without compromising privacy.

**Allowed Visible Fields:**
- Mentor name
- Company / Organization
- Job title / Role
- Industry
- Function
- General experience band (if available)

**Strictly Prohibited Fields:**
- Email, phone number, personal address
- Private notes, internal tags, sensitive matching notes
- Recap content (unless directly related to the logged-in user)

## 5. Aggregate Insights
Mentor/mentee users may view high-level aggregate insights to understand the broader impact of the program.

**Allowed Insights:**
- Total number of mentors & mentees
- Mentor distribution by industry, function, and experience bands
- Mentee distribution by school, major, and year
- Number of events/trainings and broad program activity statistics

*Important*: Aggregate insights must never expose personal contact details or sensitive individual-level information.

## 6. RLS / Security Implications
When Row Level Security (RLS) is fully enabled for these new roles, policies must enforce access by:
- `user_id`
- `role`
- `program_id`
- `season_id`
- `match_id`

**RLS guarantees:**
- Program Admins cannot access other programs.
- Mentors/Mentees only see their own match-related data.
- Viewers only see allowed aggregate dashboards.
- External users absolutely cannot access admin notes or sensitive internal data.
