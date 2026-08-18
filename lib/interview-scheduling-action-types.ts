/**
 * Shared types for the interview-scheduling server actions.
 *
 * Plain (non-"use server") module so client components can import these without
 * violating the Next.js rule that a "use server" file may only export async
 * functions.
 */

export type InterviewScheduleActionState = {
  ok: boolean;
  message: string | null;
  scheduled?: number;
};

export const initialInterviewScheduleActionState: InterviewScheduleActionState = {
  ok: false,
  message: null
};
