# VAM OS — Complete Feature Inventory

**Source material for a showcase document: "Building an ERP for an education /
training / mentoring organisation."**

*English companion to `VAM_OS_ERP_SHOWCASE_SOURCE.md`. Section numbers match
1:1, so the two files can be paired paragraph by paragraph for a bilingual
deliverable.*

| | |
|---|---|
| Figures as of | 24 Sep 2026, commit `536446a` |
| Live system | `os.alumni-mentoring.edu.vn` |
| Organisation | Vietnam Alumni Mentoring (VAM) — operates UEH Mentoring and 8 other programmes |
| Status | Running in production, serving the S12 recruitment season |

> **How to use this file.** This is an inventory of *facts*, not a brochure.
> Every number is read from the production database or counted from source at
> the commit above. When synthesising a showcase document, keep the numbers as
> they are and do not round them up. Section 9 states what is **not** built —
> keep that section in the internal version; whether it appears externally is a
> judgement call, but never let the document promise something that does not
> exist.

**Status markers used throughout Section 4:**

| Marker | Meaning |
|---|---|
| ● | **Live in production** — real people use it today |
| ◐ | **Built, awaiting merge** — code, migration and tests exist and pass all four gates; not yet in production |
| ○ | **Designed** — a design exists, no code yet |

Items with no marker are ● by default.

---

## 1. What VAM OS is

An in-house ERP written for the lifecycle of a mentoring programme: from opening
an intake form, through application scoring, interviews, mentor–mentee matching,
running events, logging every mentoring session, to the monthly report and the
roll-over into the next season.

What separates it from a conventional enterprise ERP is not any single module —
it is **who uses it**. Most of the people in this system are **volunteers**:
mentors are working professionals who give up an evening to score applications;
the organising team are students and alumni working outside office hours. Nobody
is trained on the software, nobody has time to read a manual, and nobody gets
fired for abandoning a task half-finished. That fact drives nearly every design
decision in this document:

- **No login where a login is not needed.** Applicants, event attendees,
  renewing mentors — all of them work through a personal link that arrives in
  their own inbox.
- **Getting one field wrong must never mean starting over.** Forms preserve what
  was already typed.
- **Permission gates fail closed.** If the permissions table cannot be read, the
  answer is "no", not "yes".
- **Every button on screen actually works.** Navigation never offers a page that
  will turn the user away.

---

## 2. Actual scale

### 2.1 Live operating data (production, 24 Sep 2026)

| Entity | Rows |
|---|---:|
| People in the community (`people`) | **1,360** |
| Applications | **1,919** |
| Answers inside applications | **23,667** |
| Scoring sheets (screening + interview) | **854** |
| Mentor–mentee pairings | **637** |
| Season memberships | **1,405** |
| Events | **23** |
| Event registrations | **1,460** |
| Attendances recorded | **964** |
| Mentoring session recaps | **2,447** |
| Emails sent (with a log entry) | **2,186** |
| Audit log rows | **1,880** |
| Organiser accounts | **75** (70 active) |
| Programmes | **9** |

**Status distribution across the 1,919 applications** — evidence of a real
recruitment pipeline, not demo data:

| Status | Applications |
|---|---:|
| `submitted` — received, awaiting processing | 921 |
| `screening_completed` | 494 |
| `approved_as_mentor` | 242 |
| `ready_for_final_decision` | 69 |
| `screening_assigned` | 64 |
| `invited_to_interview` | 51 |
| `interview_scheduled` | 26 |
| `rejected_or_not_fit` | 25 |
| `interview_in_progress` | 12 |
| `approved_as_mentee` | 10 |
| `withdrawn` | 4 |
| `ready_for_screening` | 1 |

### 2.2 Codebase scale

| | |
|---|---:|
| Commits | **753** (28 Apr 2026 → 24 Sep 2026, ~5 months) |
| Application code (`app/` + `lib/` + `components/`) | **98,082 lines** |
| Test code (`__tests__/`) | **92,501 lines** |
| SQL migration code | **17,832 lines** |
| Test files | **376** |
| Test cases | **7,649** |
| Pages (`page.tsx`) | **84** |
| API routes | **9** |
| Server action files | **38** |
| Business-logic modules (`lib/*.ts`) | **199** |
| Tables in `public` | **82** (RLS enabled on **82/82**) |
| Database functions | **127** |
| RPCs called by the app, under a declared contract | **60** |
| Current migrations | **53** (+52 historical files) |

**Beyond `main`, on completed branches:** a further **54,227 lines** across
**233 files** — cross-mentoring, AI-assisted matching, start-of-season mentor
confirmation, explainable bulk selection, recap import, a programme document
library. Sections 4.17–4.19 describe each layer with file paths for verification.

> **The test-to-application code ratio is 0.94 : 1.** Almost one line of test for
> every line of code. This is the number worth putting in an introductory
> document, because it explains how a system touching the real data of more than
> a thousand people can deploy several times a week.

---

## 3. Architecture

```
Next.js 15 (App Router) + React 18.3.1 + TypeScript + Tailwind
        │
        ├─ Server Components read           ─┐
        ├─ Server Actions write              ├─ service_role client
        └─ Middleware: login gate,          ─┘   (RLS bypassed, under control)
           public-route labelling,
           no-store for token-bearing pages
        │
Supabase (PostgreSQL)
        ├─ 82 tables, RLS enabled on all of them
        ├─ 127 functions — dangerous operations live in SECURITY DEFINER
        └─ Auth (Custom SMTP)
        │
Brevo — email delivery, ~300/day on the free tier
Vercel — automatic deploy on merge to main
DeepSeek + Tavily — AI tools (optional; nothing is stored)
```

**Three architectural conventions worth stating in a showcase:**

1. **`*-core.ts` is the pure half.** Every business module splits in two: the
   decision logic (no I/O, no Supabase) and the read/write wrapper. Business
   rules are therefore fully testable without mocking a database — and the same
   rule is read by the public page (browser), the server action (server) and the
   admin console alike. What the screen says can never diverge from what the
   write function actually does.

2. **RLS is enabled on all 82 tables, but there are only 13 policies.** This is
   deliberate, not an oversight: RLS enabled with **no** policy means only
   `service_role` can touch that table. The public key (`anon`) ships inside the
   website's own code and anyone can extract it, while Supabase grants table
   access to `anon` by default. On 16 Sep 2026 an audit found **27 tables
   readable — and writable — from outside**, for want of exactly two lines:
   `enable row level security` and `revoke ... from anon`. Migration
   `20260916090000_lock_down_public_api.sql` closed all of them, and since then
   every new table must enable RLS in the migration that creates it.

3. **Dangerous work lives in the database, not in the application.** Any
   operation with contention (reserving an interview seat, accepting a mentee
   within a quota, bulk approval) is a `SECURITY DEFINER` function that locks the
   row and re-counts — never a read-then-write loop in JavaScript. The
   application may run as many parallel instances on Vercel; there is only one
   database.

---

## 4. Feature inventory by module

### 4.1 Intake — public application forms

- **Two separate forms** for mentors and mentees (`/apply/mentor`,
  `/apply/mentee`), each with its own questions, industry taxonomy and job
  function taxonomy.
- **Open and close the form from the interface**, not from an environment
  variable and without a deploy. Every toggle writes an audit row. This
  permission is **narrower than every other admin permission in the system** —
  `admin` and `super_admin` only — because opening a form is an act of
  publication to the internet, and closing one mid-season silently cuts off
  everyone part-way through.
- **Edit the form's wording** (introduction, deadline note, support contacts)
  from the interface, on a separate permission from open/close: changing a
  sentence on an already-open form is not a publication event, so it sits one
  tier wider.
- **Submission-date bonus points**: "submit by date X, receive N bonus points."
  Thresholds can be set *after* the form is open and hundreds of applications are
  already in, because the bonus is **computed at read time** rather than stored
  on each application — editing a threshold updates every screen immediately, no
  backfill run required. Every threshold change is logged.
- **Automatic confirmation emails** to applicants, with a delivery log.
- **Confirmation backfill** for people who applied before the email layer
  existed — a separate button on a permission as narrow as opening the form,
  because pressing it wrongly means mail already sitting in someone's inbox with
  no recall.
- **Submission dates recorded in Vietnam time, not UTC.** (Before 16 Sep 2026,
  40 S12 applications were off by a day because of
  `toISOString().slice(0,10)` — fixed by migration and a shared `vietnamDateKey`
  helper.)

### 4.2 Application scoring — multi-reviewer evaluation

- **Five criteria × 1–5 = 25 points**: Motivation · Goal clarity · Commitment ·
  Programme fit · Communication. Plus a recommendation and a reviewer note.
- **Assignment**: one at a time, in bulk lots, or exactly the applications
  selected on screen. Every assignment emails the reviewer.
- **Minimum reviews per application configurable per season and per stage**
  (1–20). An application advances only when enough reviews are submitted.
- **Auto-saved drafts** — a reviewer who steps away mid-form loses nothing.
- **"My Work"** (`/my-work`): a personal task inbox pinned to the **top** of the
  navigation for every role that can hold an assignment. It is a *view* of the
  `application_reviews` table, not a second table — so unassigning makes the item
  vanish, reassigning moves it between people, and submitting moves it to Done,
  all for free, with no synchronisation code.
- **Organisers can edit review content** written by others, after submission —
  through a dedicated database function that records who changed what. The
  reviewer's own path is untouched.
- **Scoring progress dashboard** and **recruitment staffing roster**.
- **Grant scoring rights to someone with no account**: the system creates the
  account, grants the season scope and sends the invitation — one action instead
  of four.
- **In-app reviewer guide** (`/reviews/guide`).

### 4.3 Interviews

Two distinct flows for two distinct audiences:

**a) 1:1 mentor interviews — self-scheduled (live)**

- Interviewers declare their **available hours** on a day × hour grid.
- Mentor applicants receive a **personal link** (`/dat-lich/<token>`), no login,
  and pick an open hour themselves.
- **Automatic email cadence**: invitation, then reminders at day 3, 6 and 9 if
  unbooked. A cron job runs at 09:00 daily.
- **Two-way cancellation**: the mentor may cancel with more than 24 hours'
  notice; organisers may cancel at any time. Both notify both parties.
- **Invitation gate**: only applications that have **passed screening** receive a
  link. (This was a real incident: 9 mentors were invited before anyone had
  scored them, and 12 received the invitation and were then rejected. The gate is
  now enforced in three places — a TypeScript constant and two SQL functions —
  with a two-way contract test comparing the code against the SQL function
  bodies.)

**b) Mentee interviews — fixed sessions ◐**

- **12 fixed sessions** across 3–4 Oct 2026, six one-hour slots per day.
- Mentees receive a personal link (`/dat-ca/<token>`) and choose **one** session.
- **Changing sessions can never lose the existing seat**: the database function
  counts the new session's seats first and refuses if full, leaving the old
  booking intact; only when the new session has room does it cancel the old and
  insert the new. A static test asserts the order of those two statements inside
  the SQL function body.
- **Capacity is a count, not a key**: enforced by row lock and re-count, not by a
  unique index.
- **A blank seat field means the session is CLOSED**, not "unlimited".
  Fail-closed.
- **Organiser screen for seat counts and venue** across all 12 sessions: fill all
  at once or edit individually; the two bulk buttons are separate, so the seat
  button never overwrites the venue and vice versa.

### 4.4 Decisions and approvals

- **Per-application and bulk decisions**, each writing an
  `application_decisions` row plus an audit row.
- **Eligibility is checked before deciding**: the database function returns a
  specific reason per application rather than collapsing everything into one
  "failed".
- **Bulk official approval** — turning an applicant into a member of the season:
  creates the mentor/mentee profile, writes the membership, and copies **the
  mentee capacity the mentor themselves declared** into `capacity_target`.
- **Permissions split by the role applied for**: `support_team` decides **mentee**
  outcomes all the way through official approval; **mentor** outcomes stay with
  core team and above. The applied-for role is read from **the stored
  application**, never from the submitted form — a request claiming "mentee"
  about a mentor application is precisely how that split would be walked around,
  and the database re-checks the same split per application.
- **Restore a withdrawn application**.
- **Bulk invitation to the interview round**.
- **Exports**: CSV and PDF per application, CSV for recruitment results and score
  sheets. The download gate is **narrower** than the page-read gate, deliberately
  — an export carries the names, emails, phone numbers and student IDs of
  hundreds of people.

### 4.5 Mentor–mentee matching

- **Manual matching with capacity checking**: reads each mentor's own
  `capacity_target` (65 S12 mentors declared 1 place, 57 declared 2 — hard-coding
  3 for everyone means assigning three mentees to someone who said one).
- **A quick-view drawer** on the matching screen: name, school, target industry
  and the answers worth reading — built from **the same labels and the same
  exclusion list** used by the application detail page and the exports. A key
  that gains a Vietnamese label there gains it here the same day. Contact fields
  are excluded on purpose: this drawer is for judging fit, not for contacting
  anyone.
- **Mentor/mentee search** by industry, function and free text.
- **Pairing history** and **unpairing**.

### 4.6 Events — from open registration to conduct credit

The largest module in the system.

- **13 event types**, ordered by **the timeline of a season** rather than
  alphabetically: Mentee Orientation · Mentor Orientation · General Orientation ·
  Interview Day · Kickoff · Training · Cross-mentoring · Company Tour · Business
  Case · Job Shadowing · Networking · Closing · Other.
- **Multi-session series** with one shared registration link; registrants pick a
  session, or both.
- **Public registration form** (`/register/<token>`), with editable copy and
  per-session capacity.
- **Personal QR ticket** (`/ve/<code>`) — openable on a phone that is not logged
  in, at the door. The page carries `no-store` and `Referrer-Policy:
  no-referrer`.
- **Scanner app for event staff** (`/events/[id]/scan`): staff scan the code on
  the attendee's phone. Nobody types anything.
- **Up to 20 scan stations per event**, each assigned one of six purposes: Check
  in · Gift counter · Experience counter · Talkshow · Seminar · Check out. A scan
  is keyed by **purpose** (`talkshow`, `talkshow_2`), not by **ordinal** —
  inserting a station in the middle must not renumber every station after it.
- **Post-event survey** (`/khao-sat/<token>`), where **submitting the survey is
  the check-out action**. The reason: students attending Mentee Orientation are
  recommended for conduct credit on the basis of "checked in AND checked out",
  and making them queue to scan again as the session ends is something nobody
  manages in the final three minutes.
- **Event supporters**: scanning rights granted to people who are not organisers.
- **Reminder emails** sent from the event page, and **schedule-change notices**
  sent automatically to everyone holding a ticket for that session.
- **Manual attendance**, **walk-in recording**, 7 attendance states.
- **CSV export** of registrations and attendance.
- **Registrant matching against existing records** by normalised email/phone, so
  duplicate people are not created.

### 4.7 Recaps — the mentoring session log

- **2,447 recaps** recorded. Each is one meeting between one pair.
- **Create and edit recaps** from the organiser interface.
- **Monthly report**: recap count, active mentees/mentors, and **mentors with no
  recap this month** — the key indicator of which pairs have gone cold.
- **Recap-collection reminder emails** to organisers.

### 4.8 CRM and membership lifecycle

- **A person's profile** (`/people/[id]`) gathers everything about them: seasons
  participated in, role in each, applications submitted, events attended, pairs
  matched, internal notes.
- **Season membership lifecycle** with the full set of transitions: joined ·
  paused · reactivated · withdrawn · opted out · cancelled · completed. Each
  writes a `person_season_membership_log` row.
- **Season roles**: mentor · mentee · trainer · speaker (addable by hand), plus
  reviewer · interviewer (created only through the recruitment grant path —
  adding a bare row by hand produces a reviewer who cannot score anything).
- **Permissions split by the role of the person being changed**: core team may
  change mentors, support team only mentees. The role is read from **the stored
  row**, not from the form.
- **Delete a person entirely** — with a report *before* deletion listing exactly
  what will be lost, and a list of conditions that make a record **ineligible**
  for deletion. Someone who is both mentor and mentee is judged by the
  **stricter** permission.
- **CRM notes** and **communication history**.

### 4.9 Mentor renewal — season to season

- **Personal renewal link** (`/renew/<token>`) sent to last season's mentors.
- The mentor **reviews their existing profile**, edits what has changed, and
  confirms the commitment.
- **Accepting or declining** are both recorded; accepting creates and approves an
  application into the new season automatically.
- **The confirmation phrase validates as you type**, rather than only after
  pressing submit. (A mentor telephoned to say that typing the commitment phrase
  wrongly meant refilling the entire form — it took him a long time.)
- **Forms preserve what was typed when an error occurs.** React automatically
  clears an uncontrolled form after a server action completes — **including when
  the action returns an error**. An `onReset` guard now protects every long form
  in the system: renewal, event registration, surveys, scoring sheets.
- **Renewal console** (`/admin/renewals`): who has answered, who has not, resend
  a link, revoke a link.
- **Import previous-season mentors from a file**, with a preview step before any
  write.

### 4.10 Email and communications

- **25 declared email kinds**, each with its own server-side builder.
  **An applicant's own text is never interpolated into an email body** — a public
  form must never become a way to compose a message.
- **Sent-mail log** (`/operations/emails`): filter by kind and status, search by
  recipient. Four states: queued · sent · failed · skipped.
- **The Mail module — bulk composition** (`/operations/mail`), with three
  deliberately separate permission gates:
  - **Draft** — the widest, including support team. The entire point of the
    module is that they stop filing a ticket to change one sentence.
  - **Approve a template** — admin and above only. Editing an approved template
    drops it back to draft, so nobody can send wording an approver has not read.
  - **Press send** — the narrowest. Named separately from approval even though
    the two currently hold the same roles: they answer different questions, and
    the day one of them widens, the other must not follow by accident.
- **Templates hold placeholders, never real names**: `{{ten_nguoi_nhan}}` is
  substituted at send time, server-side. A template can therefore be drafted,
  edited, shown to a colleague, or handed to an assistant to write, without a
  single row of personal data leaving the system. And the renderer **refuses to
  produce a letter with an unfilled placeholder** — sending a student an email
  that opens "Dear {{recipient_name}}" is worse than sending nothing.
- **Six recipient audiences**, each a pre-written query rather than a free-form
  filter: mentees · mentors · both · organisers · renewing mentors · registrants
  of a given event (parameterised: which event, and whether the whole series
  counts). The reason: a batch does not finish in one run, and "Send remaining"
  must rebuild the list **exactly as the first run did**; the count the operator
  types to confirm must equal the count the server derives on its own.
- **System email samples** (`/operations/mail/samples`) — built from invented
  data: no recipient, no real name, no working link. Support team can read them
  to answer people who received a letter, without opening the real send log.
- **Duplicate suppression**: checks for the same kind sent to that address within
  the last 60 minutes.
- **Automatic backoff on Brevo's rate limit (429)**, resuming on the next run.

### 4.11 Accounts, permissions and audit

**Six global roles**: `super_admin` · `admin` · `core_team` · `support_team` ·
`reviewer` · `viewer`.

**Four scope levels per programme/season**: `full_access` · `operations` ·
`review` · `read`. An unrecognised level grants **nothing** and is discarded —
previously it normalised to "read", which meant one bad write to a nullable
column granted real read authority.

**Every permission gate is a named function with a documented reason.**
`lib/permissions.ts` holds 41 such predicates. A few examples show the separation
is not redundancy:

| Gate | Who | Why it is this narrow/wide |
|---|---|---|
| `canToggleApplicationForm` | admin+ | Opening a form publishes to the internet |
| `canEditApplicationFormTexts` | core team+ | Editing a sentence on an open form does not |
| `canSendBulkEmail` | admin+ | Sent mail cannot be recalled |
| `canComposeEmailTemplate` | support team+ | A draft sends nothing |
| `canDecideApplicationResult` | depends on role applied for | Support team decides mentees, core team decides mentors |
| `canRunAiExecutiveReport` | admin+ | The one AI tool that reads programme data |

**Account management hierarchy**: admin manages core team, core team manages
support team. One rule only — **strictly below yourself**: not peers, not
superiors, not yourself.

- **Import organiser accounts from a file**, with a preview step.
- **Invite mentors/mentees to create a login** — one person or a whole season.
- **Self-service password reset**, no need to ask the organising team. The reply
  is neutral in every error case, so the page cannot be used to discover which
  addresses have accounts.
- **Audit log** `admin_audit_log` — 1,880 rows, with a CHECK constraint on action
  type, so a new action type is a signed-off migration.
- **Responsibilities and assignments** (`/team`).

### 4.12 AI tools

Six tools. None of them stores its output anywhere, and API keys live only in
Vercel environment variables, never with a `NEXT_PUBLIC_` prefix.

| Tool | What it does |
|---|---|
| Activity ideas | Three directions with resources, risks and open questions |
| Content writing | Key message, social captions, long-form posts, calls to action |
| Canva AI design brief | An English prompt to paste straight into Canva, plus a checklist for the designer |
| **Executive report** | Synthesises recruitment, matching, recaps, events and operations |
| Vietnamese industry trends | Web-search backed (Tavily), sources stated **above** the input box |
| Document drafting | 8 administrative document types, each with a real outline |

**Two points worth making in a showcase:**

1. **The executive report sends numbers, never names.** Its input type has **no
   field anywhere that can hold a name, email or person ID** — what leaves VAM OS
   is a fixed set of labels written in the source and a set of counts.
2. **Unreadable is UNREADABLE, not zero.** A failing data source rendered as 0
   would have the AI write "no recaps at all this month" — a false alarm escalated
   to the executive board, phrased entirely plausibly.

Eight document types: Decision · Announcement · Outbound official letter ·
Proposal · Minutes · Regulation · Letter to mentors/volunteers · Other. Each
carries a real structural outline injected into the prompt — without it the model
returns prose that is correct in content but wrong in form: no distribution list,
no legal basis, no signature block.

The tools **read attachments**: PDF, Word, images. File type is determined by the
**file's leading bytes**, not by the MIME type the browser declares. Uploaded
bytes are read in exactly one place in the entire system.

**Export results to Word** (`/api/ai-doc/docx`).

### 4.13 Operations and reporting

- **Operations overview** — KPIs for the selected month.
- **Tasks and assignments** — open work, overdue work.
- **Monthly report**.
- **Season intelligence** — a founder-level dashboard.
- **Data review** — 276 data-quality issues currently tracked, with a reviewed
  correction workflow (`activity_correction_log`).
- **Programme portfolio** (`/portfolio`) — 9 programmes on one screen, each with
  a health indicator: normal · attention · data issue · unknown.
- **Per-programme workspace** (`/programs/<code>`).

### 4.14 Public surfaces — working without a login

Eight public paths, each with its own label in middleware:

| Path | Who opens it | Protection |
|---|---|---|
| `/apply/mentor`, `/apply/mentee` | Applicants | Form open/close gate |
| `/register/<token>` | Event registrants | Personal token |
| `/ve/<code>` | Ticket holders | `no-store` + `no-referrer` |
| `/checkin/<token>` | Door scanner | Personal token |
| `/khao-sat/<token>` | Attendees, post-event | Personal token |
| `/renew/<token>` | Renewing mentors | `no-store` + `no-referrer` |
| `/dat-lich/<token>` | Mentor applicants picking an hour | `no-store` + `no-referrer` |
| `/dat-ca/<token>` | Mentee applicants picking a session | `no-store` + `no-referrer` |
| `/blog`, `/blog/<slug>` | Anyone | Defaults to INTERNAL |

**The governing principle:** a token is a **bearer credential** — whoever holds it
can act as that person. So every check lives in a database function, not on the
page; token-bearing pages must never rest in a shared cache; and
`Referrer-Policy: no-referrer` keeps the token from leaking to another site via
the referer header.

**Participant portal** (`/ct`): mentors and mentees log in and see the seasons
they took part in and their programmes. The programme code in the URL comes from
the user's own hands, so typing another programme's code must return nothing —
and the answer for "that code does not exist" is identical to the answer for "you
do not belong to that programme", because distinguishing them tells people which
programmes exist.

### 4.15 Blog

- Internal and public posts, three states: draft · published · archived.
- **The default is INTERNAL.** Forgetting to choose makes a post internal, not
  public. The cost of the two mistakes is not symmetric: an internal post
  mistakenly left internal is simply read by fewer people; one mistakenly made
  public is read by the entire internet — and once Google has read it, taking the
  post down does not take down the cache.
- The decision "who may read which post" is **one pure function**, tested on its
  own against every combination anyone could think of. No other code re-derives
  that condition.

### 4.16 Multi-programme and season roll-over

- **9 active programmes**: UEH Mentoring · Hanoi Alumni Mentoring · BK Mentoring ·
  DUE Mentoring · FTU Mentoring · HUB Mentoring · HUFLIT Mentoring · Career
  Experience Program · Vietnam Alumni Mentoring.
- **Access scoped by programme × season**: an account may be granted operations
  rights on UEHM-S12 while seeing nothing of HAM.
- **Historical data import**: 11 staging tables for past seasons (S11 fully
  imported: 1,331 people, 637 pairs, 654 mentee profiles, 448 mentor profiles),
  with a log of skipped rows and the reason for each.

### 4.17 ◐ Cross-mentoring — a mentee meets a mentor outside their own pair

Branch `s12-phase8-cross-mentoring` · migration `072_cross_mentoring.sql` (654
lines, 6 tables) + `073_cross_mentoring_event_type.sql`.

A mentee wants to ask about a field their own mentor does not work in.
Cross-mentoring is the path for that, without breaking the existing pair.

- **A catalogue of fields** (`cross_mentoring_fields`) and **mentors declaring
  which fields they accept** (`mentor_cross_fields`).
- **The mentee submits the request** from their own portal
  (`/ct/<programme>/cross`) — not through the organising team.
- **The system asks each suitable mentor exactly once**, each by personal link
  (`/cross/<token>`), no login required. The mentor picks the hours they can take.
- **A cross-mentoring session becomes a record with its own lifecycle**
  (`cross_requests` → `cross_invitations` → `cross_invitation_slots`), fully
  logged (`cross_request_log`).
- **Organiser console**: `/operations/cross` and `/operations/cross/[id]`.
- **Four dedicated email kinds**, already present in `lib/email-core.ts` on
  `main`: `cross_invite` · `cross_selected` · `cross_not_selected` ·
  `cross_scheduled`.

### 4.18 ◐ AI-assisted matching — the model scores, the code assigns

Branch `s12-phase4-ai-matching` · `lib/ai-matching-core.ts` (581 lines, with 581
lines of tests) + migration `068_match_recommendations.sql`.

This is the section most worth putting in an introductory document, because it
answers the question every education organisation asks the moment it hears "AI":
*so who is accountable for the decision?*

Two rules shape the entire module:

**1. Nothing identifying leaves.** A mentee is `E001`, a mentor is `M001`; the
map from code to person exists only on the VAM OS side. Attributes are taken from
an **allow-list** — never by copying the record and deleting fields, because a
question added to the form tomorrow would immediately start leaking. Free text is
redacted (addresses, phone numbers, links, the writer's own name) **before** it is
included at all.

**2. The model scores; the code assigns.** The provider is asked exactly one
question: how well does this pair fit. Which mentee ends up with which mentor, and
how many mentees a mentor may take, is decided by `assignPairs` against **the
capacity the mentors themselves confirmed**. A model that hallucinates a code,
returns twenty pairs for one mentee, or scores 1.0 for everybody **cannot create a
pairing that breaks a rule**.

- **The prompt version is pinned** (`PROMPT_VERSION`), so a stored run can still
  be judged by exactly what produced it.
- **Proposals are stored; matches are not** — the commit message says it
  outright: *"store assisted-matching proposals, never the matches themselves."*
  Organisers approve, and a pairing is only ever created through the
  capacity-checked path.
- Screens: `/matches/recommendations` and `/matches/unmatched`.

### 4.19 ◐ Further layers already built on branches

| Layer | What it does | Where to verify |
|---|---|---|
| **Start-of-season mentor confirmation** | Mentors confirm participation in the new season by personal link, no login | `064_mentor_season_confirmations.sql` · `/confirm/[token]` · `/mentors/season-confirmations` |
| **Explainable bulk selection** | Ranks, cuts at the number of mentee places that exist, marks a reserve group | `066_selection_runs.sql` · `lib/selection-core.ts` |
| **Interview scheduling (S12 build)** | A scheduling grid for organisers | `067_interview_scheduling.sql` · `/interviews/schedule` |
| **Post-matching email set** | Four letters: mentee selected, mentee–mentor introduction, mentor's dossier package, kickoff invitation | `069_post_match_communications.sql` |
| **Recap import from Facebook** | Reads a recap post, normalises the permalink, takes the **session date** from the heading rather than the posting date | `070_recap_import.sql` · `lib/recap-import-core.ts` · Chrome utility `tools/recap-collector/` |
| **Programme document library** | Code of conduct and handbooks, written by organisers, read by mentees without a login | `lib/program-documents-core.ts` · `/documents/[slug]` |
| **Mentee dossier for mentors** | A personal link for a mentor to read their matched mentee's profile | `/mentee-dossier/[token]` |

**Two details that show the quality of this layer, worth quoting:**

*Bulk selection* — "Nobody is separated from an equal score. Where the cut would
split a group of applications on identical scores, the whole group moves down into
the reserve rather than some of them being invited and the rest not." Every tie is
broken by a **stated** rule, not by row order in the database — so the result can
be explained to an applicant who asks why.

*Document library* — this is the **one place in the system** where text an
organiser typed into an admin form is displayed on a page with no login in front
of it. The renderer therefore **escapes everything first** and only then puts its
own tags back: there is no path by which typed markup becomes live markup.

*Recap import* — Facebook serves the same post under three hosts (`m.` · `web.` ·
`www.`) with different tracking parameters each time. Unless those collapse to one
string, the unique index in migration 070 **protects nothing**.

---

## 5. Cross-cutting concerns

### 5.1 Time zones — one door only

Development machines run Vietnam time; Vercel runs **UTC**. A formatting function
that forgets to pin a time zone is therefore **correct locally and wrong in
production**, and every test passes locally too.

- All display goes through 4 shared functions; nobody hand-rolls
  `toLocaleString()`.
- Vitest sets `TZ=UTC` **before** loading anything, so tests run in the
  production time zone.
- Writing a DATE goes through `vietnamDateKey`, not
  `toISOString().slice(0,10)` — that is the UTC date.
- The date format throughout the product is **DD/MM/YYYY**.

### 5.2 Fail closed at every gate

If the permissions table cannot be read, return `false`. An infrastructure fault
must never become an authorisation. And a scope that **cannot be read** must
surface as an error, never as "no activity" — an empty scope filters every table
to zero rows, which looks exactly like a season that has not started.

### 5.3 Narrow write paths

To change one field, write a function that touches only that field. Calling a
whole-form update means any field not present on screen overwrites a value that
was correct.

### 5.4 Anything from a form is attacker-controlled

A dropdown already filtered on screen is **not a check**. The write function must
re-verify, and every write filters on both `id` and `season_id`.

### 5.5 Navigation must not promise what the route will refuse

Every menu entry is gated on **the exact predicate its page enforces**. A reviewer
was once shown six links that all bounced them to the home page; there is now a
test comparing the menu against permissions, role by role.

---

## 6. Engineering discipline — the most material section for an ERP showcase

### 6.1 Four gates, and what each one alone catches

| Gate | What it catches that no other gate does |
|---|---|
| `typecheck` | Type errors, calls to functions that do not exist |
| `lint` | Hooks called in the wrong place, unused variables |
| `vitest` | **Behaviour** — the only gate that catches `useActionState` on React 18 |
| `build` | Server/client component boundaries — errors there compile cleanly and fail at runtime |

All four run before every pull request. 7,649 test cases.

### 6.2 A test that cannot reproduce the bug is not known to catch it

After writing a test, **deliberately break the code in exactly the way the bug
occurs** and confirm the test goes red. If it stays green, the thing that needs
fixing is the test.

This practice has found real defects repeatedly, and every one of them had passed
all four gates:

- `venueKey` lost a backslash inside a regex — still a valid regex, just doing
  the wrong job.
- A Supabase test double swallowed `.order()`, so it went green identically for
  code that read in the wrong order.
- An assertion that "the form carries the right id" matched the delete form on
  the same line.
- A test asserting on a string that also appeared in **the comment explaining
  it** — this one recurred three times in a single working session.

### 6.3 Migrations are applied to production BEFORE the merge

Merging to `main` triggers GitHub Actions to test, build and deploy. **It does
not run migrations.** A migration is pasted into the Supabase SQL Editor
**first**, and only then merged — merge first and the new code calls a table that
does not exist.

- **Dry run inside a rolled-back transaction**: paste the whole migration with
  `commit;` changed to `rollback;` to see whether it runs, changing nothing. This
  technique caught a real vulnerability: three new tables were missing
  `revoke all ... from service_role` before the `grant`, so the grant narrowed
  nothing and DELETE remained.
- **Every migration ends with a self-check block** (`do $$`) that raises if
  anything is missing. A migration reporting success while a column was never
  added is the kind of thing that only surfaces at the worst possible moment.
- **CHECK constraints are widened additively**, by reading the current definition
  with `pg_get_constraintdef` and appending. Rewriting the whole list means that
  omitting one value silently stops rows of that kind from being written.
- **The md5 of `pg_proc.prosrc` is compared** between repository and production
  after applying.

### 6.4 The RPC contract is enforced by a static test

One release shipped code calling 13 functions that **staging had and production
did not**. Nothing in CI compared "RPCs the code calls" against "RPCs production
actually provides", so the gap surfaced only as a runtime failure for a logged-in
operator.

Now: **every RPC the application calls must be declared in exactly one bucket** of
`lib/production-rpc-contract.ts`, with the evidence that verified it. Adding a
`.rpc("...")` without declaring it **fails the build** — the precise failure class
that broke production. The file is **deliberately credential-free**: a static
declaration checked by a static test, so ordinary CI needs no production
credentials and makes no network call.

### 6.5 Operator documentation ships as one-page PDFs

Seven operator guides in `docs/huong-dan/`: granting reviewer rights · AI tools ·
Canva AI · the Mail module · the Events module · interview scheduling ·
self-service password reset. Each has a **contract test** pinning its quoted
strings to the source and counting `/Type /Page` to hold it to a single page — a
guide that contradicts the software is worse than no guide.

---

## 7. Six angles for the showcase narrative

These are the points where an education ERP differs most visibly from an
enterprise one. Each has a true story behind it.

### 7.1 The users are volunteers, not employees

An employee who meets difficult software still has to use it. A mentor who meets
difficult software simply does not come back next season. That is why
`/dat-lich/<token>` and `/renew/<token>` exist, why the confirmation phrase
validates as you type, and why forms preserve what was typed.

### 7.2 Errors are not symmetric

Nearly every design decision in this system comes from asking *"of these two ways
to be wrong, which costs more?"*:

- A blog post: wrongly internal = fewer readers. Wrongly public = **cannot be
  recalled**. → Default to internal.
- A blank seat count: read as "unlimited" = the session is overrun. Read as
  "closed" = somebody has to type a number. → Blank means closed.
- A misdirected email = **already in someone's inbox**. → The narrowest gate in
  the system.
- An unreadable scope rendered as 0 = a false alarm escalated to the executive
  board, phrased entirely plausibly. → Unreadable must surface as an error.

### 7.3 Real people's real data, on every deploy

1,360 people in the system are 1,360 people with names, emails and phone numbers.
A CSV exported by mistake is not a wrong record — it is the personal data of
hundreds of students who have already left. That is why **the download gate is
narrower than the page-read gate**, and it is deliberate.

### 7.4 A season is not a fiscal year

Enterprise ERPs revolve around quarters and fiscal years. A mentoring ERP revolves
around **seasons** — and seasons overlap: Season 11 mentors renew into Season 12
while Season 11 is still running. That is why `person_season_memberships` is the
central table rather than a flat "employees" table, and why every permission scope
is **programme × season**.

### 7.5 Permissions are a lattice, not a tree

In a company, permissions usually form a tree: a superior sees everything a
subordinate sees. Not here. `support_team` decides **mentee outcomes** all the way
through official approval, but **cannot** touch mentors. A `reviewer` scores
applications but cannot open the operations pages. A mentor invited to interview
holds an `admin_users` row but **no Auth account at all**.

That is why `lib/permissions.ts` holds 41 individually named predicates instead of
three tiers of "admin / user / guest" — and why each predicate carries a comment
recording **the date the programme owner decided** and **the reason**.

### 7.6 The system explains itself

Code comments in this project are written in Vietnamese and say **why**, never
restating the line below. They record the cost of the alternative, and the date of
the decision. Someone reading `lib/blog-core.ts` for the first time learns
immediately why the default is internal, without asking anyone.

For an organisation whose team turns over every season, this is not decoration —
it is the only way a decision outlives the person who made it.

---

## 8. Development timeline

| Milestone | Work |
|---|---|
| 28 Apr 2026 | First commit — read-only MVP, no login, no RLS |
| May–Jun 2026 | Auth, RLS, programme-scoped access, S11 historical import |
| Jul–Aug 2026 | Events, recaps, CRM lifecycle, matching |
| Sep 2026 | S12 recruitment: public forms, scoring, interviews, Mail, AI tools |
| 16 Sep 2026 | Security audit — closed 27 tables readable/writable from outside |
| 22–24 Sep 2026 | Mentor interview scheduling, mentee session booking, self-service password reset |

**753 commits in 5 months**, deployed automatically on every merge to `main`.

---

## 9. Boundaries — keep this section in the internal version

The architecture covers the full lifecycle of a mentoring season — Section 4 lists
all of it, including the layers already built on branches. What follows is the
**real boundary**.

**Deliberately out of scope — this system does not do, and is not meant to do:**
- Accounting, cash flow, sponsorship management.
- Inventory, asset management.
- Payroll, timekeeping.

This is an ERP for **the human lifecycle inside a training programme**, not a
financial ERP. An organisation needing both should pair VAM OS with accounting
software rather than extend VAM OS.

**Known technical debt — stated so technical readers can see the system knows
itself:**

| Item | Effect |
|---|---|
| The "one mentee, one mentor" rule is currently enforced in the application layer (read-then-write), not in the database — 637 legacy pairs lack `mentee_profile_id`, so the unique index has nothing to bite on | A backfill + row-locking RPC is designed; this is **priority 1** before opening a console to 100+ mentors acting concurrently |
| Event session capacity is checked only in the application layer | Not yet safe against hundreds of concurrent registrations |
| `lib/interview-claim.ts` always refuses a self-claim while the button still shows | A button that does nothing — against the principle in 5.5 |
| The matching screen does not yet read interview results | The scores and notes of the person who actually met the applicant are still invisible to the person matching |
| Brevo's 300-emails-per-day limit | A ~500-email batch must be split across days; the sender already backs off on 429 and resumes next run |

**Operational work pending — not engineering work:**
- Apply migration `20260924210000` and merge the stacked PRs #160 → #161 → #162.
- The invitation email carrying the booking link for mentee applicants — the
  booking page works, but nobody has a way in yet.

> **Note for whoever synthesises this.** The technical-debt table above **should
> be kept** in a version sent to a technical partner, and dropped from a general
> introduction. An education organisation choosing a vendor will read that table
> as evidence that somebody is watching the system — not as a list of defects.

---

## 10. Summary card — for when a short paragraph is needed

> **VAM OS** is the in-house ERP of Vietnam Alumni Mentoring, running live at
> `os.alumni-mentoring.edu.vn`, serving 9 mentoring programmes and more than
> 1,360 people. It covers the full lifecycle of a mentoring season: public
> application forms, multi-reviewer scoring on a 25-point scale, interview
> scheduling by personal link, per-application and bulk decisions, capacity-aware
> matching, events with QR tickets and up to 20 scan stations, a log of 2,447
> mentoring sessions, bulk email behind three separate approval gates, six AI
> tools that store nothing, and monthly reporting. Plus a cross-mentoring layer
> and an AI-assisted matching layer in which **the model only scores and the code
> assigns**, and no identifying information ever leaves the system.
>
> 98,000 lines of application code, 92,500 lines of test code, 7,649 test cases,
> 82 tables all under RLS, 127 database functions — plus a further 54,000 lines
> built and tested on branches. Built in 5 months, 753 commits, deployed
> automatically on every merge.
>
> What makes it unlike an enterprise ERP: **the users are volunteers**. Nobody
> gets fired for abandoning a task, so every action has to work on a phone, no
> login is required where a login is not needed, and getting one field wrong never
> means starting over.

---

*Figures fixed at commit `536446a`, 24 Sep 2026. Every number is read from the
production database (`qkkroesfiazsejkzflcd`) or counted from source.*
