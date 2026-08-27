import type { LegacyMentorRow } from "@/lib/legacy-mentor-import";
import type { LegacyMentorApplyOutcome } from "@/lib/legacy-mentor-service";

export type LegacyImportState = {
  phase: "idle" | "preview" | "complete";
  ok: boolean;
  message: string;
  previewId?: string;
  previewIntegrity?: string;
  rows: LegacyMentorRow[];
  outcomes: LegacyMentorApplyOutcome[];
};

export type LegacyManualState = { ok: boolean; message: string; outcome?: LegacyMentorApplyOutcome };

export const initialLegacyImportState: LegacyImportState = {
  phase: "idle",
  ok: false,
  message: "",
  rows: [],
  outcomes: []
};

export const initialLegacyManualState: LegacyManualState = { ok: false, message: "" };
