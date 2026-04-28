# VAM OS Admin Portal MVP QA Checklist

Use this checklist before internal deployment or VAM core-team review.

## Environment

- [ ] `.env.local` contains `NEXT_PUBLIC_SUPABASE_URL`.
- [ ] `.env.local` contains `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
- [ ] No `service_role`, database password, or secret key is present in frontend env files.
- [ ] Local app starts with `npm.cmd run dev:clean`.
- [ ] `npm.cmd run build` passes.

## Dashboard

- [ ] Open `/`.
- [ ] KPI counts match known Supabase production counts:
  - [ ] Total people / “Tổng thành viên”
  - [ ] Mentor
  - [ ] Mentee
  - [ ] Applications / “Ứng tuyển”
  - [ ] Total matches / “Tổng match”
  - [ ] Active matches / “Match active”
- [ ] Dashboard charts render:
  - [ ] Mentees by school code
  - [ ] Matches by status
  - [ ] Applications by final status
  - [ ] Mentors by mentee count bucket
- [ ] Dashboard warning links open the intended pages.
- [ ] Dev logs do not show oversized `application_answers` warnings on Dashboard.

## People

- [ ] Open `/people`.
- [ ] Search by name, email, or phone.
- [ ] Click a person row and confirm `/people/[id]` opens.
- [ ] Person detail shows person info, roles, mentor profile, mentee profile, applications, and relationship sections when available.
- [ ] No edit/update/delete actions are visible.

## Mentors

- [ ] Open `/mentors`.
- [ ] Search by name, email, company, or title.
- [ ] Filter by assigned mentee state.
- [ ] Filter by company.
- [ ] Sort by assigned mentee count, name, and company.
- [ ] Confirm mentor rows show mentee counts and active match counts.
- [ ] Click `Xem profile` and confirm mentor profile link opens in a new tab when available.
- [ ] Click a mentor row and confirm the person profile opens.

## Mentees

- [ ] Open `/mentees`.
- [ ] Search by name, email, mentee code, MSSV, major, or mentor.
- [ ] Filter by school code.
- [ ] Filter by mentor state.
- [ ] Filter by match status.
- [ ] Filter by major.
- [ ] Sort by school code, name, and match confidence.
- [ ] Confirm mentor info, match links, and mentor links display when available.
- [ ] Placeholder values such as `0`, `nan`, `undefined`, and `null` display as `-`.

## Applications

- [ ] Open `/applications`.
- [ ] Confirm the list loads without fetching all `application_answers`.
- [ ] Rows with missing applicant name/email still show `SBD`, short application ID, or short person ID.
- [ ] Search by name, email, SBD, application ID, or person ID.
- [ ] Filter by final status, role applied, season, and PDPA consent.
- [ ] Sort by submitted date, applicant name, and final status.
- [ ] Click `Xem chi tiết` and confirm `/applications/[id]` opens.

## Application Detail

- [ ] Applicant information displays cleanly.
- [ ] Application summary displays season, role, submitted date, SBD, consent, source, final status, and profile URL if available.
- [ ] Application answers load only for the selected application.
- [ ] Answers are sorted in the expected natural question order.
- [ ] Long answers collapse by default.
- [ ] `Xem đầy đủ` expands a long answer.
- [ ] `Thu gọn` collapses it again.
- [ ] Related mentee profile, mentor profile, and match sections appear when available.

## Matches

- [ ] Open `/matches`.
- [ ] Search by mentor or mentee name.
- [ ] Filter by status and match type.
- [ ] Click a match and confirm `/matches/[id]` opens.
- [ ] Match detail shows mentor and mentee details.
- [ ] Mentor profile link appears when `bio_url` exists.
- [ ] Match detail links back to the matches list.

## People Detail Relationships

- [ ] Open a mentor profile.
- [ ] Confirm “Mentees đang được mentor này phụ trách” appears when mentor matches exist.
- [ ] Confirm links to match detail and mentee profile work.
- [ ] Open a mentee profile.
- [ ] Confirm “Mentor của mentee này” appears when a match exists.
- [ ] Confirm mentor profile link, mentor person link, and match link work.

## Data Issues

- [ ] Open `/data-issues`.
- [ ] KPI counts render for all issue types.
- [ ] Expand and collapse issue sections A-G.
- [ ] Empty sections show “Không có vấn đề cần rà soát.”
- [ ] Applications missing name/email are listed in section B.
- [ ] Links to people, applications, and matches work.
- [ ] Dev logs do not show `application_answers` fetch warnings.

## MVP Boundaries

- [ ] No login is expected in MVP v0.1.
- [ ] No RLS behavior is expected in MVP v0.1.
- [ ] No edit/update/delete/create actions exist yet.
- [ ] Portal is treated as internal-only and read-only.
