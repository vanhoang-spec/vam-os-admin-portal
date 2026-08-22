# R1B CANONICAL APPLICANT IDENTITY - PLANNING PROMPT

You are Claude, the Senior Technical Architect for VAM OS.

Your task is to design R1B (Canonical Applicant Identity) and output the full implementation plan to `CLAUDE_R1B_PLAN.md`.

## CONTEXT
We are in Milestone 3 (S12 Core Operations Readiness).
R1A (Draft Recovery) is complete. We now need to address canonical duplicate protection (R1B).

## REQUIREMENTS & CONSTRAINTS (From Founder's Gate)

1. Canonical duplicate protection must be designed for:
   `UEHM + season + mentee role + (normalized_email OR normalized_MSSV)`
2. Do NOT deduplicate by name.
3. Do NOT create a public applicant-existence oracle. (Prefer generic duplicate responses on the frontend if needed, or ensure that we don't leak who has applied). Wait, actually, the frontend should show a generic duplicate response instead of confirming "Yes, user X exists".
4. Final concurrency authority must be DB-backed / transactional, not client-side. (e.g. unique indexes, DB functions).
5. The S12 mentee form stores `mssv`. Do not treat `application.sbd` as the S12 mentee Student ID.

## EXPECTED OUTPUT
Analyze the existing `applications` table, `applications-create.ts`, and related schemas.
Output your complete plan to `CLAUDE_R1B_PLAN.md` with:
- The SQL for Migration M076 (`supabase/migrations/0076_canonical_applicant_identity.sql` or similar).
- The changes required in `lib/applications-create.ts` or related functions to enforce this gracefully.
- The unit tests required to verify this.

When you are done generating the plan, confirm your completion. Do NOT implement the code; Codex will implement it. Your output must strictly be the design plan `CLAUDE_R1B_PLAN.md`.
