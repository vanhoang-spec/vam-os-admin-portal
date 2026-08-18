/**
 * Shared types and limits for the post-matching sends.
 *
 * Plain (non-"use server", non-server-only) module: the send screen is a client
 * component and reads both the readiness shape and the batch ceiling, so
 * neither may live in lib/post-match-emails.ts.
 */
import type { TemplateKind } from "@/lib/email-templates-core";

export type PostMatchEmailActionState = {
  ok: boolean;
  message: string | null;
  sent?: number;
  remaining?: number;
};

export const initialPostMatchEmailActionState: PostMatchEmailActionState = {
  ok: false,
  message: null
};

/** One click sends at most this many, so a failure never costs the whole cohort. */
export const MAX_PER_BATCH = 50;

/** What stands between one letter and its recipients. */
export type ReadinessKindState = {
  kind: TemplateKind;
  label: string;
  templateApproved: boolean;
  recipients: number;
  alreadySent: number;
  pending: number;
  blockers: string[];
};

export type CommunicationReadiness = {
  ok: boolean;
  error: string | null;
  seasonLabel: string | null;
  menteesSelected: number;
  menteesWaiting: number;
  activePairs: number;
  mentorsWithMentees: number;
  mentorsMissingBio: number;
  /** True when every selected mentee has a mentor: the gate for stage 2. */
  everybodyMatched: boolean;
  documentsReady: { mentee: boolean; mentor: boolean };
  kinds: ReadinessKindState[];
};
