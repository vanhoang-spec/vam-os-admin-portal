"use client";

import { useFormState } from "react-dom";
import { InlineActionMessage, LoadingButton, useActionTiming } from "@/components/action-feedback";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  addParticipationAction,
  bulkAddEventParticipantsAction,
  quickMarkParticipationAction,
  removeParticipationAction,
  updateParticipationAction
} from "@/app/actions/events";
import type { BulkAddActionState, EventActionState } from "@/lib/event-action-types";
import {
  ATTENDANCE_STATUS_OPTIONS,
  EVENT_ROLE_OPTIONS,
  attendanceStatusLabel,
  eventRoleLabel,
  type EventRoleValue
} from "@/lib/event-constants";
import type { EventParticipation, MenteeProfile, MentorProfile, Person } from "@/lib/types";
import { displayText, formatDate } from "@/lib/utils";

const initialState: EventActionState = { ok: false, message: null };
const initialBulkState: BulkAddActionState = { ok: false, message: null };

// ---------------------------------------------------------------------------
// Participant option model
// ---------------------------------------------------------------------------

type ParticipantOption = {
  id: string;
  primary: string;
  secondary: string | null;
  hint: string | null;
  searchKey: string;
  defaultRole: EventRoleValue;
  knownAs: "mentor" | "mentee" | "other";
  inPriorityBatch: boolean;
};

function normalize(value: unknown) {
  return String(value ?? "").trim();
}

function buildParticipantOptions(
  people: Person[],
  mentorProfiles: MentorProfile[],
  menteeProfiles: MenteeProfile[],
  excludePersonIds: Set<string>,
  priorityBatchId: string | null = null
): ParticipantOption[] {
  const mentorByPersonId = new Map<string, MentorProfile>();
  for (const profile of mentorProfiles) {
    if (profile.person_id) mentorByPersonId.set(profile.person_id, profile);
  }
  const menteeByPersonId = new Map<string, MenteeProfile>();
  for (const profile of menteeProfiles) {
    if (profile.person_id) menteeByPersonId.set(profile.person_id, profile);
  }

  return people
    .filter((person) => !excludePersonIds.has(person.id))
    .map((person): ParticipantOption => {
      const mentor = mentorByPersonId.get(person.id);
      const mentee = menteeByPersonId.get(person.id);
      const primary = normalize(person.full_name) || normalize(person.email_primary) || person.id;
      const secondary = normalize(person.email_primary) || null;
      let hintParts: string[] = [];
      let knownAs: ParticipantOption["knownAs"] = "other";
      let defaultRole: EventRoleValue = "unknown";
      if (mentor) {
        knownAs = "mentor";
        defaultRole = "mentor";
        const code = normalize(mentor.mentor_code);
        const company = normalize(mentor.company_current);
        const title = normalize(mentor.title_current);
        hintParts = ["Mentor", code, [title, company].filter(Boolean).join(" @ ")].filter(Boolean);
      } else if (mentee) {
        knownAs = "mentee";
        defaultRole = "mentee";
        const code = normalize(mentee.mentee_code);
        const school = normalize(mentee.school_code) || normalize(mentee.school_raw);
        const major = normalize(mentee.major);
        hintParts = ["Mentee", code, [major, school].filter(Boolean).join(" · ")].filter(Boolean);
      } else {
        hintParts = ["Khác (chưa phải mentor/mentee)"];
      }
      const searchKey = [
        primary,
        secondary,
        normalize(mentor?.mentor_code),
        normalize(mentor?.company_current),
        normalize(mentor?.title_current),
        normalize(mentee?.mentee_code),
        normalize(mentee?.school_code),
        normalize(mentee?.school_raw),
        normalize(mentee?.major)
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      const inPriorityBatch = priorityBatchId
        ? (mentor?.intake_batch_id === priorityBatchId || mentee?.intake_batch_id === priorityBatchId)
        : false;

      return {
        id: person.id,
        primary,
        secondary,
        hint: hintParts.join(" · ") || null,
        searchKey,
        defaultRole,
        knownAs,
        inPriorityBatch
      };
    })
    .sort((a, b) => {
      // Batch members first when a priority batch is set
      if (priorityBatchId) {
        if (a.inPriorityBatch && !b.inPriorityBatch) return -1;
        if (!a.inPriorityBatch && b.inPriorityBatch) return 1;
      }
      return a.primary.localeCompare(b.primary, "vi");
    });
}

// ---------------------------------------------------------------------------
// Participant combobox
// ---------------------------------------------------------------------------

function ParticipantCombobox({
  options,
  value,
  onSelect,
  priorityBatchId
}: {
  options: ParticipantOption[];
  value: string;
  onSelect: (option: ParticipantOption | null) => void;
  priorityBatchId: string | null;
}) {
  const inputId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const selected = useMemo(() => options.find((option) => option.id === value) ?? null, [options, value]);
  const [query, setQuery] = useState(selected?.primary ?? "");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setQuery(selected?.primary ?? "");
  }, [selected?.id, selected?.primary]);

  useEffect(() => {
    function onDocumentClick(event: MouseEvent) {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(event.target as Node)) {
        setOpen(false);
        setQuery(selected?.primary ?? "");
      }
    }
    document.addEventListener("mousedown", onDocumentClick);
    return () => document.removeEventListener("mousedown", onDocumentClick);
  }, [selected?.primary]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || q === selected?.primary.toLowerCase()) return options.slice(0, 60);
    return options.filter((option) => option.searchKey.includes(q)).slice(0, 60);
  }, [options, query, selected?.primary]);

  // Find where non-batch entries start for showing a separator
  const firstNonBatchIdx = priorityBatchId
    ? filtered.findIndex((o) => !o.inPriorityBatch)
    : -1;

  return (
    <div ref={containerRef} className="relative">
      <label htmlFor={inputId} className="block">
        <span className="text-xs font-medium uppercase text-slate-500">
          Người tham gia (*) — tìm theo tên / email / công ty / trường
        </span>
        <input
          id={inputId}
          type="search"
          autoComplete="off"
          placeholder="Gõ tên, email, công ty hoặc trường..."
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
            if (selected && event.target.value !== selected.primary) onSelect(null);
          }}
          onFocus={() => setOpen(true)}
          className="mt-1 w-full rounded-md border border-vam-line bg-white px-3 py-2 text-sm text-vam-ink outline-none focus:border-vam-green focus:ring-2 focus:ring-vam-mint"
        />
      </label>
      {selected ? (
        <div className="mt-1 flex items-center justify-between gap-2 text-xs text-slate-500">
          <span className="truncate">
            Đã chọn: <span className="font-medium text-vam-ink">{selected.primary}</span>
            {selected.secondary ? ` <${selected.secondary}>` : ""}
            {selected.hint ? ` — ${selected.hint}` : ""}
          </span>
          <button
            type="button"
            onClick={() => {
              onSelect(null);
              setQuery("");
              setOpen(true);
            }}
            className="rounded border border-vam-line px-2 py-0.5 text-xs text-slate-600 hover:bg-slate-50"
          >
            Xoá
          </button>
        </div>
      ) : null}
      {open ? (
        <div className="absolute z-20 mt-1 max-h-80 w-full overflow-auto rounded-md border border-vam-line bg-white shadow-lg">
          {filtered.length === 0 ? (
            <div className="px-3 py-2 text-xs text-slate-500">Không tìm thấy người phù hợp.</div>
          ) : (
            <ul className="divide-y divide-vam-line">
              {filtered.map((option, idx) => (
                <li key={option.id}>
                  {/* Separator between batch-priority and rest */}
                  {priorityBatchId && idx === firstNonBatchIdx && firstNonBatchIdx > 0 ? (
                    <div className="bg-slate-50 px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                      Ngoài batch
                    </div>
                  ) : null}
                  {priorityBatchId && idx === 0 && option.inPriorityBatch ? (
                    <div className="bg-vam-mint/40 px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-vam-green">
                      Trong batch (ưu tiên)
                    </div>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => {
                      onSelect(option);
                      setQuery(option.primary);
                      setOpen(false);
                    }}
                    className="flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left text-sm hover:bg-vam-mint"
                  >
                    <span className="flex items-center gap-2">
                      <span className="font-medium text-vam-ink">{option.primary}</span>
                      <span
                        className={
                          option.knownAs === "mentor"
                            ? "rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700"
                            : option.knownAs === "mentee"
                              ? "rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-medium text-sky-700"
                              : "rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600"
                        }
                      >
                        {option.knownAs === "mentor" ? "Mentor" : option.knownAs === "mentee" ? "Mentee" : "Khác"}
                      </span>
                      {option.inPriorityBatch ? (
                        <span className="rounded bg-vam-mint px-1.5 py-0.5 text-[10px] font-medium text-vam-green">
                          batch
                        </span>
                      ) : null}
                    </span>
                    {option.secondary ? <span className="text-xs text-slate-500">{option.secondary}</span> : null}
                    {option.hint ? <span className="text-xs text-slate-500">{option.hint}</span> : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Add participant form (one at a time)
// ---------------------------------------------------------------------------

export function AddParticipantForm({
  eventId,
  people,
  mentorProfiles,
  menteeProfiles,
  existingPersonIds,
  intakeBatchId = null
}: {
  eventId: string;
  people: Person[];
  mentorProfiles: MentorProfile[];
  menteeProfiles: MenteeProfile[];
  existingPersonIds: Set<string>;
  /** Phase 045B: when set, batch members are sorted to the top of the combobox. */
  intakeBatchId?: string | null;
}) {
  const [state, formAction] = useFormState(addParticipationAction, initialState);
  const timing = useActionTiming("event.attendance.add", state);

  const options = useMemo(
    () => buildParticipantOptions(people, mentorProfiles, menteeProfiles, existingPersonIds, intakeBatchId),
    [people, mentorProfiles, menteeProfiles, existingPersonIds, intakeBatchId]
  );

  const [personId, setPersonId] = useState("");
  const [knownAs, setKnownAs] = useState<ParticipantOption["knownAs"] | null>(null);
  const [role, setRole] = useState<EventRoleValue>("unknown");

  function handleSelect(option: ParticipantOption | null) {
    if (!option) {
      setPersonId("");
      setKnownAs(null);
      setRole("unknown");
      return;
    }
    setPersonId(option.id);
    setKnownAs(option.knownAs);
    setRole(option.defaultRole);
  }

  const roleOptionsForUI = useMemo(() => {
    if (knownAs === "mentor") return EVENT_ROLE_OPTIONS.filter((o) => o.value !== "mentee");
    if (knownAs === "mentee") return EVENT_ROLE_OPTIONS.filter((o) => o.value !== "mentor");
    return EVENT_ROLE_OPTIONS.filter((o) => o.value !== "mentor" && o.value !== "mentee");
  }, [knownAs]);

  return (
    <form action={formAction} onSubmit={timing.markSubmitStart} className="grid gap-3">
      <input type="hidden" name="event_id" value={eventId} />
      <input type="hidden" name="person_id" value={personId} />

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

      <ParticipantCombobox
        options={options}
        value={personId}
        onSelect={handleSelect}
        priorityBatchId={intakeBatchId}
      />

      <p className="text-xs text-slate-500">
        {intakeBatchId
          ? `Thành viên trong batch hiển thị trước. `
          : null}
        Tổng: {options.length} người chưa có mặt trong sự kiện.
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="text-xs font-medium uppercase text-slate-500">Vai trò (*)</span>
          <select
            name="role_at_event"
            value={role}
            onChange={(e) => setRole(e.target.value as EventRoleValue)}
            className="mt-1 w-full rounded-md border border-vam-line bg-white px-3 py-2 text-sm text-vam-ink outline-none focus:border-vam-green focus:ring-2 focus:ring-vam-mint"
          >
            {roleOptionsForUI.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
          <span className="mt-1 block text-[11px] text-slate-500">
            {knownAs === "mentor" ? "Mặc định: Mentor (đã được phát hiện)." : null}
            {knownAs === "mentee" ? "Mặc định: Mentee (đã được phát hiện)." : null}
            {knownAs === "other" ? "Người này không phải mentor/mentee — vui lòng chọn vai trò phù hợp." : null}
            {knownAs === null ? "Chọn người tham gia để hệ thống đề xuất vai trò." : null}
          </span>
        </label>

        <label className="block">
          <span className="text-xs font-medium uppercase text-slate-500">Trạng thái tham gia</span>
          <select
            name="attendance_status"
            defaultValue="unknown"
            className="mt-1 w-full rounded-md border border-vam-line bg-white px-3 py-2 text-sm text-vam-ink outline-none focus:border-vam-green focus:ring-2 focus:ring-vam-mint"
          >
            {ATTENDANCE_STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
      </div>

      <label className="block">
        <span className="text-xs font-medium uppercase text-slate-500">Ghi chú</span>
        <textarea
          name="admin_notes"
          rows={2}
          placeholder="Ghi chú nội bộ (tuỳ chọn)..."
          className="mt-1 w-full rounded-md border border-vam-line bg-white px-3 py-2 text-sm text-vam-ink outline-none focus:border-vam-green focus:ring-2 focus:ring-vam-mint"
        />
      </label>

      <LoadingButton pendingLabel="Đang thêm..." disabled={!personId} className="w-fit rounded-md bg-vam-green px-4 py-2 text-sm font-medium text-white hover:bg-vam-green/90">
        Thêm người tham gia
      </LoadingButton>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Bulk add form (Phase 045B)
// ---------------------------------------------------------------------------

function BulkAddGroupSubmit({ label }: { label: string }) {
  return (
    <LoadingButton pendingLabel="Đang thêm..." className="w-fit rounded-md border border-vam-line bg-white px-3 py-2 text-sm font-medium text-vam-ink hover:bg-vam-mint">
      {label}
    </LoadingButton>
  );
}

function BulkAddGroupForm({
  eventId,
  group,
  label
}: {
  eventId: string;
  group: "approved_mentees_in_batch" | "approved_mentors_in_batch";
  label: string;
}) {
  const [state, formAction] = useFormState(bulkAddEventParticipantsAction, initialBulkState);
  const timing = useActionTiming(`event.attendance.bulk.${group}`, state);
  return (
    <form action={formAction} onSubmit={timing.markSubmitStart} className="flex flex-wrap items-center gap-3">
      <input type="hidden" name="event_id" value={eventId} />
      <input type="hidden" name="group" value={group} />
      <BulkAddGroupSubmit label={label} />
      {state.message ? (
        <span
          className={
            state.ok ? "text-sm font-medium text-green-700" : "text-sm text-red-700"
          }
        >
          {state.message}
          {state.ok && state.addedCount !== undefined
            ? ` (+${state.addedCount} mới, bỏ qua ${state.skippedCount ?? 0})`
            : null}
        </span>
      ) : null}
    </form>
  );
}

export function BulkAddForm({ eventId }: { eventId: string }) {
  return (
    <div className="grid gap-3">
      <p className="text-xs text-slate-500">
        Chỉ thêm người chưa có trong sự kiện. Chạy nhiều lần không tạo bản ghi trùng.
        Trạng thái mặc định: <em>Chưa rõ</em> — cập nhật sau khi điểm danh xong.
      </p>
      <BulkAddGroupForm
        eventId={eventId}
        group="approved_mentees_in_batch"
        label="Thêm tất cả Mentee trong batch"
      />
      <BulkAddGroupForm
        eventId={eventId}
        group="approved_mentors_in_batch"
        label="Thêm tất cả Mentor trong batch"
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Per-row badges
// ---------------------------------------------------------------------------

function roleBadgeClass(role: unknown) {
  const value = String(role ?? "").trim();
  if (value === "mentor") return "rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700";
  if (value === "mentee") return "rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-medium text-sky-700";
  if (value === "core_team") return "rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-medium text-violet-700";
  if (value === "speaker" || value === "trainer")
    return "rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700";
  return "rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600";
}

function statusBadgeClass(status: unknown) {
  const value = String(status ?? "").trim();
  if (value === "attended") return "rounded bg-green-100 px-1.5 py-0.5 text-[10px] font-medium text-green-700";
  if (value === "absent_excused" || value === "absent_unexcused" || value === "registered_absent")
    return "rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700";
  if (value === "registered_no_response")
    return "rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-medium text-blue-700";
  return "rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500";
}

// ---------------------------------------------------------------------------
// Quick mark (Phase 045B): one-click attended / vắng, preserves role + notes
// ---------------------------------------------------------------------------

function QuickMarkForm({
  id,
  eventId,
  targetStatus,
  label,
  activeClass,
  currentStatus
}: {
  id: string;
  eventId: string;
  targetStatus: string;
  label: string;
  activeClass: string;
  currentStatus: string;
}) {
  const [state, formAction] = useFormState(quickMarkParticipationAction, initialState);
  const timing = useActionTiming(`event.attendance.quick.${targetStatus}`, state);
  const isActive = currentStatus === targetStatus;
  return (
    <form action={formAction} onSubmit={timing.markSubmitStart} className="inline-grid gap-1">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="event_id" value={eventId} />
      <input type="hidden" name="attendance_status" value={targetStatus} />
      <LoadingButton
        pendingLabel="Đang cập nhật..."
        title={isActive ? `Đang là: ${label}` : `Đánh dấu: ${label}`}
        className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
          isActive ? activeClass : "border border-vam-line bg-white text-slate-500 hover:bg-slate-50"
        }`}
      >
        {label}{state.ok ? " ✓" : ""}
      </LoadingButton>
      <InlineActionMessage state={state} errorFallback="Không thể cập nhật điểm danh. Vui lòng thử lại." className="px-2 py-1 text-xs" />
    </form>
  );
}

// ---------------------------------------------------------------------------
// Participation row
// ---------------------------------------------------------------------------

export function ParticipationRow({
  eventId,
  row,
  person
}: {
  eventId: string;
  row: EventParticipation;
  person?: Person;
}) {
  const [updateState, updateAction] = useFormState(updateParticipationAction, initialState);
  const [removeState, removeAction] = useFormState(removeParticipationAction, initialState);
  const updateTiming = useActionTiming("event.attendance.update", updateState);
  const removeTiming = useActionTiming("event.attendance.remove", removeState);

  const displayName = person?.full_name || person?.email_primary || row.person_id || "Chưa rõ";
  const currentRole = String(row.role_at_event ?? "unknown");
  const currentStatus = String(row.attendance_status ?? "");
  const isWalkIn = row.walk_in === true || String(row.walk_in) === "true";

  return (
    <tr className="hover:bg-vam-mint/40">
      {/* Column 1: identity + badges */}
      <td className="px-4 py-3 align-top">
        <div className="font-medium text-vam-ink">{displayText(displayName)}</div>
        <div className="mt-0.5 text-xs text-slate-500">{displayText(person?.email_primary)}</div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <span className={roleBadgeClass(currentRole)}>{eventRoleLabel(currentRole)}</span>
          <span className={statusBadgeClass(currentStatus)}>
            {currentStatus ? attendanceStatusLabel(currentStatus) : "Chưa cập nhật"}
          </span>
          {isWalkIn ? (
            <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-medium text-blue-700">
              Walk-in
            </span>
          ) : null}
        </div>
      </td>

      {/* Column 2: quick mark + full edit form */}
      <td className="px-4 py-3 align-top">
        {/* Quick mark buttons */}
        <div className="mb-3 flex flex-wrap gap-2">
          <QuickMarkForm
            id={row.id}
            eventId={eventId}
            targetStatus="attended"
            label="✓ Đã tham gia"
            activeClass="bg-green-100 text-green-700 border border-green-200"
            currentStatus={currentStatus}
          />
          <QuickMarkForm
            id={row.id}
            eventId={eventId}
            targetStatus="absent_unexcused"
            label="✗ Vắng"
            activeClass="bg-amber-100 text-amber-700 border border-amber-200"
            currentStatus={currentStatus}
          />
        </div>

        {/* Full edit form */}
        <form action={updateAction} onSubmit={updateTiming.markSubmitStart} className="grid gap-2">
          <input type="hidden" name="id" value={row.id} />
          <input type="hidden" name="event_id" value={eventId} />
          <select
            name="role_at_event"
            defaultValue={currentRole}
            className="w-full rounded-md border border-vam-line bg-white px-2 py-1 text-xs text-vam-ink outline-none focus:border-vam-green focus:ring-2 focus:ring-vam-mint"
          >
            {EVENT_ROLE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
          <select
            name="attendance_status"
            defaultValue={currentStatus || "unknown"}
            className="w-full rounded-md border border-vam-line bg-white px-2 py-1 text-xs text-vam-ink outline-none focus:border-vam-green focus:ring-2 focus:ring-vam-mint"
          >
            {ATTENDANCE_STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
          <textarea
            name="admin_notes"
            defaultValue={String(row.admin_notes ?? "")}
            rows={2}
            placeholder="Ghi chú (tuỳ chọn)"
            className="w-full rounded-md border border-vam-line bg-white px-2 py-1 text-xs text-vam-ink outline-none focus:border-vam-green focus:ring-2 focus:ring-vam-mint"
          />
          <LoadingButton pendingLabel="Đang cập nhật..." className="w-fit rounded-md bg-vam-green px-3 py-1 text-xs font-medium text-white hover:bg-vam-green/90">
            Cập nhật chi tiết
          </LoadingButton>
          <InlineActionMessage state={updateState} errorFallback="Không thể cập nhật người tham gia. Vui lòng thử lại." className="px-2 py-1 text-xs" />
        </form>
      </td>

      {/* Column 3: metadata */}
      <td className="px-4 py-3 text-xs text-slate-500 align-top">
        {row.attendance_date ? (
          <div>Ngày tham gia: {formatDate(row.attendance_date)}</div>
        ) : null}
        {row.captured_by ? (
          <div className="mt-1">Ghi nhận bởi: {displayText(row.captured_by)}</div>
        ) : null}
      </td>

      {/* Column 4: remove */}
      <td className="px-4 py-3 align-top">
        <form action={removeAction} onSubmit={removeTiming.markSubmitStart} className="grid gap-2">
          <input type="hidden" name="id" value={row.id} />
          <input type="hidden" name="event_id" value={eventId} />
          <input
            type="text"
            name="reason"
            placeholder="Lý do xoá"
            className="w-full rounded-md border border-vam-line bg-white px-2 py-1 text-xs text-vam-ink outline-none focus:border-vam-green focus:ring-2 focus:ring-vam-mint"
          />
          <LoadingButton pendingLabel="Đang xoá..." className="w-fit rounded-md border border-red-200 bg-red-50 px-3 py-1 text-xs font-medium text-red-700 hover:bg-red-100">
            Xoá
          </LoadingButton>
          <InlineActionMessage state={removeState} errorFallback="Không thể xoá người tham gia. Vui lòng thử lại." className="px-2 py-1 text-xs" />
        </form>
      </td>
    </tr>
  );
}
