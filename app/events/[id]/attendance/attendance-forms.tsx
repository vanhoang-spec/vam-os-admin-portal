"use client";

import { useFormState } from "react-dom";
import { useMemo, useState } from "react";
import {
  addParticipationAction,
  removeParticipationAction,
  updateParticipationAction,
  type EventActionState
} from "@/app/actions/events";
import { ATTENDANCE_STATUS_OPTIONS, EVENT_ROLE_OPTIONS } from "@/lib/event-constants";
import type { EventParticipation, Person } from "@/lib/types";
import { displayText, formatDate } from "@/lib/utils";

const initialState: EventActionState = { ok: false, message: null };

export function AddParticipantForm({
  eventId,
  people,
  existingPersonIds
}: {
  eventId: string;
  people: Person[];
  existingPersonIds: Set<string>;
}) {
  const [state, formAction] = useFormState(addParticipationAction, initialState);
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = people.filter((person) => !existingPersonIds.has(person.id));
    if (!q) return list.slice(0, 200);
    return list
      .filter((person) => {
        const text = `${person.full_name ?? ""} ${person.email_primary ?? ""}`.toLowerCase();
        return text.includes(q);
      })
      .slice(0, 200);
  }, [people, existingPersonIds, search]);

  return (
    <form action={formAction} className="grid gap-3">
      <input type="hidden" name="event_id" value={eventId} />

      {state.message ? (
        <div className={state.ok ? "rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700" : "rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"}>
          {state.message}
        </div>
      ) : null}

      <label className="block">
        <span className="text-xs font-medium uppercase text-slate-500">Tìm mentor / mentee</span>
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Nhập tên hoặc email..."
          className="mt-1 w-full rounded-md border border-vam-line bg-white px-3 py-2 text-sm text-vam-ink outline-none focus:border-vam-green focus:ring-2 focus:ring-vam-mint"
        />
      </label>

      <label className="block">
        <span className="text-xs font-medium uppercase text-slate-500">Người tham gia (*)</span>
        <select
          name="person_id"
          required
          className="mt-1 w-full rounded-md border border-vam-line bg-white px-3 py-2 text-sm text-vam-ink outline-none focus:border-vam-green focus:ring-2 focus:ring-vam-mint"
        >
          <option value="">-- Chọn người --</option>
          {filtered.map((person) => (
            <option key={person.id} value={person.id}>
              {person.full_name || person.email_primary || person.id}
              {person.email_primary ? ` <${person.email_primary}>` : ""}
            </option>
          ))}
        </select>
        <p className="mt-1 text-xs text-slate-500">
          Đang hiển thị {filtered.length} người (chưa có mặt trong sự kiện).
        </p>
      </label>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="text-xs font-medium uppercase text-slate-500">Vai trò (*)</span>
          <select
            name="role_at_event"
            defaultValue="mentee"
            className="mt-1 w-full rounded-md border border-vam-line bg-white px-3 py-2 text-sm text-vam-ink outline-none focus:border-vam-green focus:ring-2 focus:ring-vam-mint"
          >
            {EVENT_ROLE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
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

      <button type="submit" className="inline-flex w-fit rounded-md bg-vam-green px-4 py-2 text-sm font-medium text-white hover:bg-vam-green/90">
        Thêm người tham gia
      </button>
    </form>
  );
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

  return (
    <tr className="hover:bg-vam-mint/40">
      <td className="px-4 py-3 align-top">
        <div className="font-medium text-vam-ink">{displayText(displayName)}</div>
        <div className="mt-1 text-xs text-slate-500">{displayText(person?.email_primary)}</div>
      </td>
      <td className="px-4 py-3 align-top">
        <form action={updateAction} className="grid gap-2">
          <input type="hidden" name="id" value={row.id} />
          <input type="hidden" name="event_id" value={eventId} />
          <select
            name="role_at_event"
            defaultValue={String(row.role_at_event ?? "mentee")}
            className="w-full rounded-md border border-vam-line bg-white px-2 py-1 text-xs text-vam-ink outline-none focus:border-vam-green focus:ring-2 focus:ring-vam-mint"
          >
            {EVENT_ROLE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
          <select
            name="attendance_status"
            defaultValue={String(row.attendance_status ?? "registered_absent")}
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
