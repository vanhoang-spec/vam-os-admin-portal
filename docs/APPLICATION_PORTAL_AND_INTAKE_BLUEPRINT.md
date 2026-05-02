# PHASE G: Application Portal & Intake System Blueprint

This blueprint details the future "front-door" application flow, replacing manual Google Form and CSV import workflows with native VAM OS forms.

## 1. Native VAM OS Application Forms
VAM OS will eventually support native application forms for both Mentors and Mentees. This reduces reliance on external tools and manual imports.

**Example Routes:**
- `/apply/mentor`
- `/apply/mentee`
- `/apply/[program]/mentor`
- `/apply/[program]/mentee`
- `/apply/[program]/[season]/mentor`
- `/apply/[program]/[season]/mentee`

## 2. End-to-End Application Flow
1. **Applicant** opens the application link.
2. Selects or lands on a program/season-specific form.
3. Fills out the application form.
4. Submits the form.
5. **Application record is created** in the system (Status: `new`). 
   *Note: Submitting a form does NOT automatically create an active mentor or mentee profile.*
6. **Core Team** reviews the application (Status: `reviewed`).
7. (Optional) Interview is conducted (Status: `interviewing`).
8. **Decision** is made: `accepted`, `rejected`, `waitlisted`, or `withdrawn`.
9. If **accepted**, the application is converted into a mentor/mentee profile.
10. The applicant is added to the active season pool.
11. Proceed to matching workflow.

## 3. Application Status Model
*Application status is strictly distinct from profile status, match status, and long-term person status.*

**Mentor Application Statuses:**
- `new`
- `reviewed`
- `interviewing`
- `accepted`
- `rejected`
- `waitlisted`
- `withdrawn`
- `duplicate`
- `incomplete`

**Mentee Application Statuses:**
- `new`
- `reviewed`
- `interviewing`
- `accepted`
- `rejected`
- `waitlisted`
- `withdrawn`
- `duplicate`
- `incomplete`

## 4. Conceptual Data Model
- **programs**
- **seasons**
- **people** (Long-term entity)
- **mentor_profiles**
- **mentee_profiles**
- **mentor_applications** (Per program/season)
- **mentee_applications** (Per program/season)
- **season_participants** (Per season)
- **matches** (Per season)
- **admin_review_notes**
- **audit_logs**

*Principle: A Person is long-term. Applications are per program/season. Season participation and Matches are per season.*

## 5. Mentor Application Form Fields

### Basic Information:
- Full Name
- Email
- Phone
- LinkedIn/Facebook (Optional)
- Current Company
- Current Job Title
- Industry
- Function
- Years of Experience
- Location/City
- Preferred Language

### Mentoring Specifics:
- Why do you want to mentor?
- Prior mentoring experience
- Areas you can support
- Preferred mentee profile
- Time commitment
- Preferred meeting format
- Availability
- Consent to VAM principles / Code of Conduct

### Internal Review Fields (Admin Only):
- Reviewer
- Review Status
- Review Note
- Risk Note
- Recommended Mentee Segment
- Accepted/Rejected Reason
- Interview Note

## 6. Mentee Application Form Fields

### Basic Information:
- Full Name
- Email
- Phone
- School/University
- Major
- Year of Study
- Expected Graduation Year
- Location/City

### Career / Learning Specifics:
- Career Interests
- Industries of Interest
- Functions of Interest
- Current Challenges
- Mentoring Goals
- What kind of mentor are you looking for?
- Commitment Expectation
- Availability
- Consent to VAM principles / Code of Conduct

### Internal Review Fields (Admin Only):
- Reviewer
- Review Status
- Review Note
- Interview Note
- Accepted/Rejected Reason
- Urgency/Priority
- Recommended Mentor Profile
- Support Needs

## 7. Core Team Review UI
A dedicated admin interface will allow the core team to process applications efficiently:
- View all new applications.
- Filter by program, season, role, and status.
- Open application details.
- Add internal notes.
- Update statuses (`reviewed`, `interviewing`).
- Record decisions (`accept`, `reject`, `waitlist`).
- Identify duplicates.
- Convert accepted applications into profiles.
- Add accepted persons to the active season pool.
- View audit history of review decisions.

## 8. Duplicate Handling
System logic to manage potential duplicates (e.g., same email, same phone, same name + school/company):
- **Do not create duplicate person records automatically.**
- If an existing person is found, link the new application to the existing person record.
- For returning mentors: Allow "continue to new season" rather than creating a new profile.
- For returning mentees/alumni: Flag the application for admin review.

## 9. Permissions & Privacy

**Applicant:**
- Can submit the form.
- May receive a confirmation email.
- **Cannot** access the admin dashboard.

**Core Team / Program Operations Admin:**
- Can review applications for their assigned program/season.

**Program Admin:**
- Can accept/reject applications for their assigned program/season.

**Super Admin:**
- Can manage all programs, seasons, and forms.

**Privacy Guards:**
- Phone/Email must not be shown in the public/community directory.
- Internal notes are strictly admin-only.
- Rejection reasons remain internal unless explicitly communicated to the applicant.

## 10. Google Form Transition Strategy
Google Forms may remain as a temporary fallback while native features are developed.
- **Short-term:** Google Form &rarr; Export to CSV &rarr; Import &rarr; Review in VAM OS.
- **Medium-term:** Native VAM OS form &rarr; Application table &rarr; Review UI.
- **Long-term:** Full VAM OS portal with applicant account activation and self-service status tracking.

## 11. Roadmap Placement & Implementation Order
**Phase G:** Application Portal & Intake System (Should come before or alongside Multi-Program scaling).

**Implementation Order Recommendation:**
1. **Step 1:** Document application model and statuses (Completed).
2. **Step 2:** Create admin-only review table/UI for imported applications.
3. **Step 3:** Support Google Form import directly into application records.
4. **Step 4:** Build native VAM OS public application forms.
5. **Step 5:** Add duplicate detection mechanisms.
6. **Step 6:** Build the "Convert Application &rarr; Profile &rarr; Season Pool" action.
7. **Step 7:** Add applicant confirmation emails and an optional applicant portal.
