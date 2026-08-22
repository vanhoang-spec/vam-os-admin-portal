# M3 R1A - DRAFT RECOVERY DESIGN

We are implementing R1A (Draft Recovery) for the VAM OS application forms.
The goal is to implement local-storage based draft recovery for `app/apply/mentee/apply-mentee-form.tsx` and `app/apply/mentor/apply-mentor-form.tsx`.

## REQUIREMENTS (From BROWSER_UAT_MATRIX)
1. **Restore Prompt**: If a draft exists in localStorage on mount, show a restore prompt. Accepting restores sections 1-4. Declining clears the draft and yields a clean form.
2. **Discard Draft**: Clicking "discard draft" (or similar UI) clears the draft and reloads/yields an empty form.
3. **Clear on Success**: Submitting successfully must clear the draft from localStorage.
4. **Preserve on Error**: Submitting with a deliberate validation error must keep the draft intact.
5. **Consent Re-affirmation**: When restoring a draft, all consent checkboxes MUST be unticked. Submission is blocked until re-affirmed.
6. **Token Security**: The persisted draft object MUST NOT contain the apply-token value under any key.

## CURRENT ARCHITECTURE
The forms use `react-hook-form` (via `useForm`) with Zod resolvers.
Forms are in `app/apply/mentee/apply-mentee-form.tsx` and `app/apply/mentor/apply-mentor-form.tsx`.

## YOUR TASK
Provide the technical design and exact implementation steps (files to create/modify) to implement R1A for both mentee and mentor forms.
Keep the design clean, preferably extracting a React hook (e.g. `useDraftRecovery`) to be shared between both forms if possible.

## OUTPUT FORMAT
Output your plan within a `CLAUDE_R1A_PLAN_FINAL` marker. Include exact code modifications.
