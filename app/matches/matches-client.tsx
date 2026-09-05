"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useFormState } from "react-dom";
import { cancelMatchAction, createManualMatchAction } from "@/app/actions/matches";
import { loadMatchingQuickViewAction } from "@/app/actions/matching-quick-view";
import { InlineActionMessage, LoadingButton, useActionTiming } from "@/components/action-feedback";
import type { MatchActionState } from "@/lib/match-action-types";
import { filterMentees, filterMentors } from "@/lib/match-search";
import type { QuickViewPayload } from "@/lib/matching-quick-view-core";
import type { MenteeCandidate, MentorCandidate } from "@/lib/matches";
import { QuickViewDrawer } from "./quick-view-drawer";

const initialState: MatchActionState = { ok: false, message: null };

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * The load bar reads the mentor's OWN capacity, which the server sends on every
 * candidate as `effective_capacity`. There is deliberately no local constant to
 * fall back on: a default here could disagree with the one the mutation
 * enforces, and showing "1/3" for a mentor the server refuses at 1 is worse than
 * showing nothing at all.
 */
function loadBar(count: number, capacity: number) {
  if (count === 0) return { label: `0/${capacity}`, cls: "text-green-700 bg-green-100" };
  if (count < capacity) return { label: `${count}/${capacity}`, cls: "text-amber-700 bg-amber-100" };
  return { label: `${count}/${capacity} — FULL`, cls: "text-red-700 bg-red-100" };
}

function isMentorFull(mentor: Pick<MentorCandidate, "active_match_count" | "effective_capacity">) {
  return mentor.active_match_count >= mentor.effective_capacity;
}

// ── Submit buttons ────────────────────────────────────────────────────────────

function CreateSubmit() {
  return (
    <LoadingButton pendingLabel="Đang tạo..." className="rounded-md bg-vam-green px-4 py-2 text-sm font-medium text-white hover:bg-vam-green/90">
      Tạo matching
    </LoadingButton>
  );
}

function CancelSubmit() {
  return (
    <LoadingButton pendingLabel="Đang hủy ghép cặp..." className="rounded border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-medium text-red-700 hover:bg-red-100">
      Xác nhận hủy
    </LoadingButton>
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
  const timing = useActionTiming("match.create", state);
  const [selectedMentorId, setSelectedMentorId] = useState("");
  const [selectedMenteeId, setSelectedMenteeId] = useState("");
  const [mentorSearch, setMentorSearch] = useState("");
  const [menteeSearch, setMenteeSearch] = useState("");

  const selectedMentor = mentors.find((m) => m.profile_id === selectedMentorId) ?? null;
  const selectedMentee = mentees.find((m) => m.profile_id === selectedMenteeId) ?? null;

  // Quick-view drawer state. Deliberately separate from every selection above:
  // opening or closing it touches nothing the form depends on, so search text,
  // both selections and the note survive by construction rather than by care.
  const [quickView, setQuickView] = useState<{
    role: "mentor" | "mentee";
    title: string;
  } | null>(null);
  const [quickViewPayload, setQuickViewPayload] = useState<QuickViewPayload | null>(null);
  const [quickViewLoading, setQuickViewLoading] = useState(false);
  const [quickViewError, setQuickViewError] = useState<string | null>(null);

  /**
   * Which request the drawer is currently showing.
   *
   * Two loads can be in flight at once — open Mentor A, change your mind, open
   * Mentee B — and they can resolve in either order. Without this, A resolving
   * after B would overwrite B's payload while the header still said B: the
   * operator would read one person's answers under another person's name and
   * have no way to tell. On a screen whose entire job is deciding who to pair,
   * that is the worst possible failure, so every write below is gated on the
   * request still being the current one.
   *
   * A ref, not state: it must be readable synchronously by a callback that
   * closed over an earlier render, and bumping it must never itself re-render.
   * Server actions cannot be cancelled, so the stale response still arrives —
   * it is simply ignored.
   */
  const quickViewRequestRef = useRef(0);

  const openQuickView = async (role: "mentor" | "mentee") => {
    const candidate = role === "mentor" ? selectedMentor : selectedMentee;
    const personId = candidate?.person_id ?? null;
    const title = candidate?.full_name ?? candidate?.email_primary ?? "Hồ sơ";

    // Claim a generation FIRST. Everything already in flight is stale from here.
    const generation = ++quickViewRequestRef.current;
    const isCurrent = () => quickViewRequestRef.current === generation;

    // Only one drawer at a time: opening the other role replaces this one.
    setQuickView({ role, title });
    setQuickViewPayload(null);
    setQuickViewError(null);

    if (!personId) {
      setQuickViewError("Hồ sơ này chưa gắn person_id nên không thể xem chi tiết.");
      setQuickViewLoading(false);
      return;
    }

    setQuickViewLoading(true);
    try {
      // Loaded here, on demand, for ONE person — never preloaded for the pool.
      const result = await loadMatchingQuickViewAction({ personId, role, intakeBatchId });
      if (!isCurrent()) return;
      if (result.ok) setQuickViewPayload(result.data);
      else setQuickViewError(result.message);
    } catch {
      // A stale failure must not replace newer content either: an error from the
      // request the operator abandoned is not an error about the one they are
      // looking at.
      if (!isCurrent()) return;
      setQuickViewError("Không thể tải hồ sơ. Vui lòng thử lại.");
    } finally {
      // Guarded too. An unguarded `finally` would clear the CURRENT request's
      // loading state when an older one settled, leaving a permanently blank
      // drawer with no spinner and no error.
      if (isCurrent()) setQuickViewLoading(false);
    }
  };

  const closeQuickView = () => {
    // Bumping the generation invalidates anything in flight, so a response that
    // arrives after the drawer is closed cannot reopen or repopulate it.
    quickViewRequestRef.current += 1;
    // Clears only drawer state. Selections and search are untouched.
    setQuickView(null);
    setQuickViewPayload(null);
    setQuickViewError(null);
    setQuickViewLoading(false);
  };

  // Refresh page on success so counts update
  useEffect(() => {
    if (state.ok) {
      router.refresh();
      setSelectedMentorId("");
      setSelectedMenteeId("");
      setMentorSearch("");
      setMenteeSearch("");
    }
  }, [state.ok, router]);

  const availableMentors = mentors.filter((m) => !isMentorFull(m));
  const availableMentees = mentees.filter((m) => !m.has_active_match);

  const visibleMentors = filterMentors(mentors, mentorSearch);
  const visibleMentees = filterMentees(mentees, menteeSearch);

  return (
    <form action={formAction} onSubmit={timing.markSubmitStart} className="grid gap-4">
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
          <label htmlFor="mentor-search" className="block text-xs font-medium uppercase text-slate-500">
            Mentor (*)
          </label>
          <input
            id="mentor-search"
            type="text"
            value={mentorSearch}
            onChange={(e) => { setMentorSearch(e.target.value); setSelectedMentorId(""); }}
            placeholder="Tìm theo tên, công ty…"
            className="mt-1 w-full rounded-md border border-vam-line bg-white px-3 py-1.5 text-sm text-vam-ink outline-none focus:border-vam-green focus:ring-2 focus:ring-vam-mint"
          />
          <label htmlFor="mentor-select" className="sr-only">Chọn Mentor</label>
          <select
            id="mentor-select"
            name="mentor_profile_id"
            value={selectedMentorId}
            onChange={(e) => setSelectedMentorId(e.target.value)}
            required
            className="mt-1 w-full rounded-md border border-vam-line bg-white px-3 py-2 text-sm text-vam-ink outline-none focus:border-vam-green focus:ring-2 focus:ring-vam-mint"
          >
            <option value="">-- Chọn Mentor {mentorSearch ? `(${visibleMentors.length} kết quả)` : ""} --</option>
            {visibleMentors.map((m) => {
              const lb = loadBar(m.active_match_count, m.effective_capacity);
              const isFull = isMentorFull(m);
              return (
                <option key={m.profile_id} value={m.profile_id} disabled={isFull}>
                  {`[${lb.label}] ${m.full_name ?? m.email_primary ?? m.profile_id}`}
                  {m.company_current ? ` — ${m.company_current}` : ""}
                  {isFull ? " (FULL)" : ""}
                </option>
              );
            })}
          </select>
          {selectedMentor ? (
            <div className="mt-2 rounded-md border border-vam-line bg-slate-50 px-3 py-2 text-xs text-slate-600">
              <div className="font-medium text-vam-ink">{selectedMentor.full_name ?? "—"}</div>
              <div>{selectedMentor.email_primary}</div>
              {selectedMentor.company_current ? <div>{selectedMentor.title_current} @ {selectedMentor.company_current}</div> : null}
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <span className={`rounded px-2 py-0.5 text-[11px] font-semibold ${loadBar(selectedMentor.active_match_count, selectedMentor.effective_capacity).cls}`}>
                  Mentee hiện tại: {loadBar(selectedMentor.active_match_count, selectedMentor.effective_capacity).label}
                </span>
                {/* type="button" is load-bearing: this sits inside the create
                    form and a default submit would try to create the match. */}
                <button
                  type="button"
                  onClick={() => void openQuickView("mentor")}
                  className="rounded-md border border-vam-line bg-white px-2 py-0.5 text-[11px] font-medium text-vam-green hover:bg-vam-mint"
                >
                  Xem hồ sơ
                </button>
              </div>
            </div>
          ) : (
            // Was "Mentor đang FULL (X/Y khả dụng)", which read as though every
            // mentor were full while actually reporting how many were free.
            <p className="mt-1 text-[11px] text-slate-500">
              Mentor khả dụng: {availableMentors.length}/{mentors.length}
            </p>
          )}
        </div>

        {/* Mentee selector */}
        <div>
          <label htmlFor="mentee-search" className="block text-xs font-medium uppercase text-slate-500">
            Mentee (*)
          </label>
          <input
            id="mentee-search"
            type="text"
            value={menteeSearch}
            onChange={(e) => { setMenteeSearch(e.target.value); setSelectedMenteeId(""); }}
            placeholder="Tìm theo tên, trường…"
            className="mt-1 w-full rounded-md border border-vam-line bg-white px-3 py-1.5 text-sm text-vam-ink outline-none focus:border-vam-green focus:ring-2 focus:ring-vam-mint"
          />
          <label htmlFor="mentee-select" className="sr-only">Chọn Mentee</label>
          <select
            id="mentee-select"
            name="mentee_profile_id"
            value={selectedMenteeId}
            onChange={(e) => setSelectedMenteeId(e.target.value)}
            required
            className="mt-1 w-full rounded-md border border-vam-line bg-white px-3 py-2 text-sm text-vam-ink outline-none focus:border-vam-green focus:ring-2 focus:ring-vam-mint"
          >
            <option value="">-- Chọn Mentee {menteeSearch ? `(${visibleMentees.length} kết quả)` : ""} --</option>
            {visibleMentees.map((m) => {
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
          {selectedMentee ? (
            <div className="mt-2 rounded-md border border-vam-line bg-slate-50 px-3 py-2 text-xs text-slate-600">
              <div className="font-medium text-vam-ink">{selectedMentee.full_name ?? "—"}</div>
              <div>{selectedMentee.email_primary}</div>
              {selectedMentee.school_code ? <div>{selectedMentee.major} — {selectedMentee.school_code}</div> : null}
              <div className="mt-1 flex flex-wrap items-center gap-2">
                {selectedMentee.has_active_match ? (
                  <span className="rounded bg-red-100 px-2 py-0.5 text-[11px] font-semibold text-red-700">Đã có mentor</span>
                ) : (
                  <span className="rounded bg-green-100 px-2 py-0.5 text-[11px] font-semibold text-green-700">Chưa có mentor</span>
                )}
                <button
                  type="button"
                  onClick={() => void openQuickView("mentee")}
                  className="rounded-md border border-vam-line bg-white px-2 py-0.5 text-[11px] font-medium text-vam-green hover:bg-vam-mint"
                >
                  Xem hồ sơ
                </button>
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
        ) : selectedMentor && isMentorFull(selectedMentor) ? (
          <span className="text-xs text-red-600">Mentor này đã đạt giới hạn {selectedMentor.effective_capacity} mentee.</span>
        ) : selectedMentee?.has_active_match ? (
          <span className="text-xs text-red-600">Mentee này đã có mentor active.</span>
        ) : null}
      </div>

      {/* Rendered inside the form but positioned fixed, so the drawer overlays
          the page without unmounting a single field. Nothing here submits. */}
      <QuickViewDrawer
        open={quickView !== null}
        title={quickView?.title ?? ""}
        loading={quickViewLoading}
        error={quickViewError}
        payload={quickViewPayload}
        onClose={closeQuickView}
      />
    </form>
  );
}

// ── Cancel form (per row) ─────────────────────────────────────────────────────

export function MatchCancelForm({ matchId }: { matchId: string }) {
  const router = useRouter();
  const [state, formAction] = useFormState(cancelMatchAction, initialState);
  const timing = useActionTiming("match.cancel", state);
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
    <form action={formAction} onSubmit={timing.markSubmitStart} className="grid gap-1.5">
      <input type="hidden" name="match_id" value={matchId} />
      <p className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-800">Hủy ghép cặp sẽ chuyển match khỏi trạng thái active. Lịch sử ghép cặp không bị xóa.</p>
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
      <InlineActionMessage state={state} errorFallback="Không thể hủy ghép cặp. Vui lòng thử lại." className="px-2 py-1 text-xs" />
    </form>
  );
}
