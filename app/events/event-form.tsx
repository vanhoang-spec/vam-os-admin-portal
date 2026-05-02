"use client";

import Link from "next/link";
import { useFormState } from "react-dom";
import { createEventAction, updateEventAction, type EventActionState } from "@/app/actions/events";
import { EVENT_TYPE_OPTIONS } from "@/lib/event-constants";
import type { Event, Season } from "@/lib/types";

const initialState: EventActionState = { ok: false, message: null };

function toLocalInputValue(value: string | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const tzOffset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - tzOffset).toISOString().slice(0, 16);
}

export function EventForm({
  mode,
  event,
  seasons,
  defaultSeasonCode = "UEHM-S11"
}: {
  mode: "create" | "edit";
  event?: Event | null;
  seasons: Season[];
  defaultSeasonCode?: string;
}) {
  const action = mode === "create" ? createEventAction : updateEventAction;
  const [state, formAction] = useFormState(action, initialState);

  const seasonsById = new Map(seasons.map((season) => [season.id, season]));
  const eventSeasonCode = event?.season_id ? seasonsById.get(event.season_id)?.code ?? "" : "";
  const seasonCodeDefault = mode === "edit" ? eventSeasonCode || defaultSeasonCode : defaultSeasonCode;

  return (
    <form action={formAction} className="grid gap-4">
      {mode === "edit" && event ? <input type="hidden" name="id" value={event.id} /> : null}

      {state.message ? (
        <div className={state.ok ? "rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700" : "rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"}>
          {state.message}
        </div>
      ) : null}

      <label className="block">
        <span className="text-xs font-medium uppercase text-slate-500">Tên sự kiện (*)</span>
        <input
          name="event_name"
          required
          defaultValue={event?.event_name ?? ""}
          className="mt-1 w-full rounded-md border border-vam-line bg-white px-3 py-2 text-sm text-vam-ink outline-none focus:border-vam-green focus:ring-2 focus:ring-vam-mint"
        />
      </label>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="text-xs font-medium uppercase text-slate-500">Loại sự kiện (*)</span>
          <select
            name="event_type"
            required
            defaultValue={(event?.event_type as string) ?? "training"}
            className="mt-1 w-full rounded-md border border-vam-line bg-white px-3 py-2 text-sm text-vam-ink outline-none focus:border-vam-green focus:ring-2 focus:ring-vam-mint"
          >
            {EVENT_TYPE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="text-xs font-medium uppercase text-slate-500">Mùa (*)</span>
          <select
            name="season_code"
            required
            defaultValue={seasonCodeDefault}
            className="mt-1 w-full rounded-md border border-vam-line bg-white px-3 py-2 text-sm text-vam-ink outline-none focus:border-vam-green focus:ring-2 focus:ring-vam-mint"
          >
            {seasons.map((season) => (
              <option key={season.id} value={season.code ?? ""}>{season.code ?? season.name ?? season.id}</option>
            ))}
          </select>
        </label>
      </div>

      <label className="block">
        <span className="text-xs font-medium uppercase text-slate-500">Thời điểm bắt đầu (*)</span>
        <input
          name="starts_at"
          type="datetime-local"
          required
          defaultValue={toLocalInputValue(event?.starts_at)}
          className="mt-1 w-full rounded-md border border-vam-line bg-white px-3 py-2 text-sm text-vam-ink outline-none focus:border-vam-green focus:ring-2 focus:ring-vam-mint"
        />
      </label>

      <label className="block">
        <span className="text-xs font-medium uppercase text-slate-500">Mã tham chiếu (legacy_event_temp_id)</span>
        <input
          name="legacy_event_temp_id"
          defaultValue={event?.legacy_event_temp_id ?? ""}
          placeholder="ví dụ: UEHM-S11-CLOSING"
          className="mt-1 w-full rounded-md border border-vam-line bg-white px-3 py-2 text-sm text-vam-ink outline-none focus:border-vam-green focus:ring-2 focus:ring-vam-mint"
        />
      </label>

      <label className="block">
        <span className="text-xs font-medium uppercase text-slate-500">Mô tả / Ghi chú (gồm địa điểm)</span>
        <textarea
          name="source_notes"
          rows={4}
          defaultValue={event?.source_notes ?? ""}
          placeholder="Mô tả nội dung, địa điểm, link tài liệu..."
          className="mt-1 w-full rounded-md border border-vam-line bg-white px-3 py-2 text-sm text-vam-ink outline-none focus:border-vam-green focus:ring-2 focus:ring-vam-mint"
        />
      </label>

      <div className="mt-2 flex flex-wrap gap-3">
        <button type="submit" className="inline-flex w-fit rounded-md bg-vam-green px-4 py-2 text-sm font-medium text-white hover:bg-vam-green/90">
          {mode === "create" ? "Tạo sự kiện" : "Lưu thay đổi"}
        </button>
        {state.ok && mode === "create" && state.createdEventId ? (
          <Link
            href={`/events/${state.createdEventId}/attendance`}
            className="inline-flex w-fit items-center justify-center rounded-md border border-vam-line bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Đi tới trang Quản lý tham gia
          </Link>
        ) : null}
        <Link
          href="/events"
          className="inline-flex w-fit items-center justify-center rounded-md border border-vam-line bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Quay lại danh sách
        </Link>
      </div>
    </form>
  );
}
