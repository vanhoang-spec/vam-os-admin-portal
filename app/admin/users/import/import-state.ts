import type { AccountImportOutcome } from "@/lib/account-import-server";
import type { AccountImportRow } from "@/lib/account-import";

export type ImportActionState = {
  phase: "idle" | "preview" | "complete";
  ok: boolean;
  message: string;
  previewId?: string;
  previewIntegrity?: string;
  previewExpiresAt?: number;
  rows: AccountImportRow[];
  outcomes: AccountImportOutcome[];
};

export const initialImportState: ImportActionState = { phase: "idle", ok: false, message: "", rows: [], outcomes: [] };
