"use client";

import { useFormState } from "react-dom";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  addParticipationAction,
  removeParticipationAction,
  updateParticipationAction
} from "@/app/actions/events";
import type { EventActionState } from "@/lib/event-action-types";
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

type ParticipantOption = {
  id: string;
  primary: string;
  secondary: string | null;
  hint: string | null;
  searchKey: string;
  defaultRole: EventRoleValue;
  knownAs: "mentor" | "mentee" | "other";
};

function normalize(value: unknown) {
  return String(value ?? "").trim();
}

function buildParticipantOptions(
  people: Person[],
  mentorProfiles: MentorProfile[],
  menteeProfiles: MenteeProfile[],
  excludePersonIds: Set<string>
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
      return {
        id: person.id,
        primary,
        secondary,
        hint: hintParts.join(" · ") || null,
        searchKey,
        defaultRole,
        knownAs
      };
    })
    .sort((a, b) => a.primary.localeCompare(b.primary, "vi"));
}

function ParticipantCombobox({
  options,
  value,
  onSelect
}: {
  options: ParticipantOption[];
  value: string;
  onSelect: (option: ParticipantOption | null) => void;
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
    if (!q || q === selected?.primary.toLowerCase()) return options.slice(0, 50);
    return options.filter((option) => option.searchKey.includes(q)).slice(0, 50);
  }, [options, query, selected?.primary]);

  return (
    <div ref={containerRef} className="relative">
      <label htmlFor={inputId} className="block">
        <span className="text-xs font-medium uppercase text-slate-500">Người tham gia (*) — tìm theo tên / email / công ty / trường</span>
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
              {filtered.map((option) => (
                <li key={option.id}>
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

export function AddParticipantForm({
  eventId,
  people,
  mentorProfiles,
  menteeProfiles,
  existingPersonIds
}: {
  eventId: string;
  people: Person[];
  mentorProfiles: MentorProfile[];
  menteeProfiles: MenteeProfile[];
  existingPersonIds: Set<string>;
}) {
  const [state, formAction] = useFormState(addParticipationAction, initialState);

  const options = useMemo(
    () => buildParticipantOptions(people, mentorProfiles, menteeProfiles, existingPersonIds),
    [people, mentorProfiles, menteeProfiles, existingPersonIds]
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
    if (knownAs === "mentor") {
      return EVENT_ROLE_OPTIONS.filter((option) => option.value !== "mentee");
    }
    if (knownAs === "mentee") {
      return EVENT_ROLE_OPTIONS.filter((option) => option.value !== "mentor");
    }
    return EVENT_ROLE_OPTIONS.filter((option) => option.value !== "mentor" && option.value !== "mentee");
  }, [knownAs]);

  return (
    <form action={formAction} className="grid gap-3">
      <input type="hidden" name="event_id" value={eventId} />
      <input type="hidden" name="person_id" value={personId} />

      {state.message ? (
        <div className={state.ok ? "rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700" : "rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"}>
          {state.message}
        </div>
      ) : null}

      <ParticipantCombobox options={options} value={personId} onSelect={handleSelect} />

      <p className="text-xs text-slate-500">
        Tổng: {options.length} người chưa có mặt trong sự kiện. Có thể thêm cả người không phải mentor/mentee (core team, diễn giả, trainer, khách mời).
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="text-xs font-medium uppercase text-slate-500">Vai trò (*)</span>
          <select
            name="role_at_event"
            value={role}
            onChange={(event) => setRole(event.target.value as EventRoleValue)}
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
            defaultValue="registered_absent"
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

      <button
        type="submit"
        disabled={!personId}
        className="inline-flex w-fit rounded-md bg-vam-green px-4 py-2 text-sm font-medium text-white hover:bg-vam-green/90 disabled:opacity-50"
      >
        Thêm người tham gia
      </button>
    </form>
  );
}

function roleBadgeClass(role: unknown) {
  const value = String(role ?? "").trim();
  if (value === "mentor") return "rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700";
  if (value === "mentee") return "rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-medium text-sky-700";
  if (value === "core_team") return "rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-medium text-violet-700";
  if (value === "speaker" || value === "trainer") return "rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700";
  if (value === "guest") return "rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600";
  return "rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600";
}

function statusBadgeClass(status: unknown) {
  const value = String(status ?? "").trim();
  if (value === "attended") return "rounded bg-green-100 px-1.5 py-0.5 text-[10px] font-medium text-green-700";
  return "rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700";
}

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

  const displayName = person?.full_name || person?.email_primary || row.person_id || "Chưa rõ";
  const currentRole = String(row.role_at_event ?? "unknown");
  const currentStatus = String(row.attendance_status ?? "registered_absent");

  return (
    <tr className="hover:bg-vam-mint/40">
      <td className="px-4 py-3 align-top">
        <div className="font-medium text-vam-ink">{displayText(displayName)}</div>
        <div className="mt-1 text-xs text-slate-500">{displayText(person?.email_primary)}</div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <span className={roleBadgeClass(currentRole)}>{eventRoleLabel(currentRole)}</span>
          <span className={statusBadgeClass(currentStatus)}>{attendanceStatusLabel(currentStatus)}</span>
        </div>
      </td>
      <td className="px-4 py-3 align-top">
        <form action={updateAction} className="grid gap-2">
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
            defaultValue={currentStatus}
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
          <button type="submit" className="inline-flex w-fit rounded-md bg-vam-green px-3 py-1 text-xs font-medium text-white hover:bg-vam-green/90">
            Cập nhật
          </button>
          {updateState.message ? (
            <span className={updateState.ok ? "text-xs text-green-700" : "text-xs text-red-700"}>{updateState.message}</span>
          ) : null}
        </form>
      </td>
      <td className="px-4 py-3 text-xs text-slate-500 align-top">
        <div>updated_by: {displayText(row.captured_by)}</div>
        <div className="mt-1">attendance_date: {formatDate(row.attendance_date)}</div>
      </td>
      <td className="px-4 py-3 align-top">
        <form action={removeAction} className="grid gap-2">
          <input type="hidden" name="id" value={row.id} />
          <input type="hidden" name="event_id" value={eventId} />
          <input
            type="text"
            name="reason"
            placeholder="Lý do xoá"
            className="w-full rounded-md border border-vam-line bg-white px-2 py-1 text-xs text-vam-ink outline-none focus:border-vam-green focus:ring-2 focus:ring-vam-mint"
          />
          <button type="submit" className="inline-flex w-fit rounded-md border border-red-200 bg-red-50 px-3 py-1 text-xs font-medium text-red-700 hover:bg-red-100">
            Xoá
          </button>
          {removeState.message ? (
            <span className={removeState.ok ? "text-xs text-green-700" : "text-xs text-red-700"}>{removeState.message}</span>
          ) : null}
        </form>
      </td>
    </tr>
  );
}
