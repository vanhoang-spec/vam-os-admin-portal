"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { cancelMatchAction, createManualMatchAction } from "@/app/actions/matches";
import type { MatchActionState } from "@/lib/match-action-types";
import type { MenteeCandidate, MentorCandidate } from "@/lib/matches";

const initialState: MatchActionState = { ok: false, message: null };
const MAX_LOAD = 3;

// ── Helpers ───────────────────────────────────────────────────────────────────

function loadBar(count: number) {
  if (count === 0) return { label: `0/${MAX_LOAD}`, cls: "text-green-700 bg-green-100" };
  if (count < MAX_LOAD) return { label: `${count}/${MAX_LOAD}`, cls: "text-amber-700 bg-amber-100" };
  return { label: `${count}/${MAX_LOAD} — FULL`, cls: "text-red-700 bg-red-100" };
}

// ── Submit buttons ────────────────────────────────────────────────────────────

function CreateSubmit() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex rounded-md bg-vam-green px-4 py-2 text-sm font-medium text-white hover:bg-vam-green/90 disabled:opacity-50"
    >
      {pending ? "Đang tạo..." : "Tạo matching"}
    </button>
  );
}

function CancelSubmit() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex rounded border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-medium text-red-700 hover:bg-red-100 disabled:opacity-50"
    >
      {pending ? "..." : "Hủy match"}
    </button>
  );
}

// ── Manual create form ────────────────────────────────────────────────────────

export function ManualMatchForm({
  intakeBatchId,
  mentors,
  mentees
}: {
  intakeBatchId: string;
  mentors: MentorCandidate[];
  mentees: MenteeCandidate[];
}) {
  const router = useRouter();
  const [state, formAction] = useFormState(createManualMatchAction, initialState);
  const [selectedMentorId, setSelectedMentorId] = useState("");
  const [selectedMenteeId, setSelectedMenteeId] = useState("");

  const selectedMentor = mentors.find((m) => m.profile_id === selectedMentorId) ?? null;
  const selectedMentee = mentees.find((m) => m.profile_id === selectedMenteeId) ?? null;

  // Refresh page on success so counts update
  useEffect(() => {
    if (state.ok) {
      router.refresh();
      setSelectedMentorId("");
      setSelectedMenteeId("");
    }
  }, [state.ok, router]);

  const availableMentors = mentors.filter((m) => m.active_match_count < MAX_LOAD);
  const availableMentees = mentees.filter((m) => !m.has_active_match);

  return (
    <form action={formAction} className="grid gap-4">
      <input type="hidden" name="intake_batch_id" value={intakeBatchId} />

      {state.message ? (
        <div
          className={
            state.ok
              ? "rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700"
              : "rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
          }
        >
          {state.message}
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        {/* Mentor selector */}
        <div>
          <label className="block">
            <span className="text-xs font-medium uppercase text-slate-500">Mentor (*)</span>
            <select
              name="mentor_profile_id"
              value={selectedMentorId}
              onChange={(e) => setSelectedMentorId(e.target.value)}
              required
              className="mt-1 w-full rounded-md border border-vam-line bg-white px-3 py-2 text-sm text-vam-ink outline-none focus:border-vam-green focus:ring-2 focus:ring-vam-mint"
            >
              <option value="">-- Chọn Mentor --</option>
              {mentors.map((m) => {
                const lb = loadBar(m.active_match_count);
                const isFull = m.active_match_count >= MAX_LOAD;
                return (
                  <option key={m.profile_id} value={m.profile_id} disabled={isFull}>
                    {`[${lb.label}] ${m.full_name ?? m.email_primary ?? m.profile_id}`}
                    {m.company_current ? ` — ${m.company_current}` : ""}
                    {isFull ? " (FULL)" : ""}
                  </option>
                );
              })}
            </select>
          </label>
          {selectedMentor ? (
            <div className="mt-2 rounded-md border border-vam-line bg-slate-50 px-3 py-2 text-xs text-slate-600">
              <div className="font-medium text-vam-ink">{selectedMentor.full_name ?? "—"}</div>
              <div>{selectedMentor.email_primary}</div>
              {selectedMentor.company_current ? <div>{selectedMentor.title_current} @ {selectedMentor.company_current}</div> : null}
              <div className="mt-1">
                <span className={`rounded px-2 py-0.5 text-[11px] font-semibold ${loadBar(selectedMentor.active_match_count).cls}`}>
                  Mentee hiện tại: {loadBar(selectedMentor.active_match_count).label}
                </span>
              </div>
            </div>
          ) : (
            <p className="mt-1 text-[11px] text-slate-500">
              Mentor đang FULL ({availableMentors.length}/{mentors.length} khả dụng)
            </p>
          )}
        </div>

        {/* Mentee selector */}
        <div>
          <label className="block">
            <span className="text-xs font-medium uppercase text-slate-500">Mentee (*)</span>
            <select
              name="mentee_profile_id"
              value={selectedMenteeId}
              onChange={(e) => setSelectedMenteeId(e.target.value)}
              required
              className="mt-1 w-full rounded-md border border-vam-line bg-white px-3 py-2 text-sm text-vam-ink outline-none focus:border-vam-green focus:ring-2 focus:ring-vam-mint"
            >
              <option value="">-- Chọn Mentee --</option>
              {mentees.map((m) => {
                const hasMatch = m.has_active_match;
                return (
                  <option key={m.profile_id} value={m.profile_id} disabled={hasMatch}>
                    {`${m.full_name ?? m.email_primary ?? m.profile_id}`}
                    {m.school_code ? ` (${m.school_code})` : ""}
                    {hasMatch ? " — Đã có mentor" : ""}
                  </option>
                );
              })}
            </select>
          </label>
          {selectedMentee ? (
            <div className="mt-2 rounded-md border border-vam-line bg-slate-50 px-3 py-2 text-xs text-slate-600">
              <div className="font-medium text-vam-ink">{selectedMentee.full_name ?? "—"}</div>
              <div>{selectedMentee.email_primary}</div>
              {selectedMentee.school_code ? <div>{selectedMentee.major} — {selectedMentee.school_code}</div> : null}
              <div className="mt-1">
                {selectedMentee.has_active_match ? (
                  <span className="rounded bg-red-100 px-2 py-0.5 text-[11px] font-semibold text-red-700">Đã có mentor</span>
                ) : (
                  <span className="rounded bg-green-100 px-2 py-0.5 text-[11px] font-semibold text-green-700">Chưa có mentor</span>
                )}
              </div>
            </div>
          ) : (
            <p className="mt-1 text-[11px] text-slate-500">
              Mentee chưa có mentor: {availableMentees.length}/{mentees.length}
            </p>
          )}
        </div>
      </div>

      <label className="block">
        <span className="text-xs font-medium uppercase text-slate-500">Ghi chú nội bộ</span>
        <textarea
          name="admin_notes"
          rows={2}
          placeholder="Lý do ghép, điểm tương đồng... (tuỳ chọn)"
          className="mt-1 w-full rounded-md border border-vam-line bg-white px-3 py-2 text-sm text-vam-ink outline-none focus:border-vam-green focus:ring-2 focus:ring-vam-mint"
        />
      </label>

      <div className="flex flex-wrap items-center gap-3">
        <CreateSubmit />
        {!selectedMentorId || !selectedMenteeId ? (
          <span className="text-xs text-slate-500">Chọn cả mentor và mentee để tạo match.</span>
        ) : selectedMentor && selectedMentor.active_match_count >= MAX_LOAD ? (
          <span className="text-xs text-red-600">Mentor này đã đạt giới hạn {MAX_LOAD} mentee.</span>
        ) : selectedMentee?.has_active_match ? (
          <span className="text-xs text-red-600">Mentee này đã có mentor active.</span>
        ) : null}
      </div>
    </form>
  );
}

// ── Cancel form (per row) ─────────────────────────────────────────────────────

export function MatchCancelForm({ matchId }: { matchId: string }) {
  const router = useRouter();
  const [state, formAction] = useFormState(cancelMatchAction, initialState);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (state.ok) {
      router.refresh();
      setOpen(false);
    }
  }, [state.ok, router]);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex rounded border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-medium text-red-700 hover:bg-red-100"
      >
        Hủy match
      </button>
    );
  }

  return (
    <form action={formAction} className="grid gap-1.5">
      <input type="hidden" name="match_id" value={matchId} />
      <input
        type="text"
        name="end_reason"
        placeholder="Lý do hủy (tuỳ chọn)"
        autoFocus
        className="rounded-md border border-vam-line bg-white px-2 py-1 text-xs text-vam-ink outline-none focus:border-red-400"
      />
      <div className="flex gap-2">
        <CancelSubmit />
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="inline-flex rounded border border-vam-line bg-white px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
        >
          Không
        </button>
      </div>
      {state.message && !state.ok ? (
        <span className="text-xs text-red-700">{state.message}</span>
      ) : null}
    </form>
  );
}
