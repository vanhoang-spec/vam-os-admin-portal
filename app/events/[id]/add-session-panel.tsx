"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useFormState, useFormStatus } from "react-dom";
import {
  addEventSessionAction,
  notifyScheduleChangeAction,
  removeEventSessionAction,
  updateEventSessionTimeAction
} from "@/app/actions/events";
import type { EventActionState } from "@/lib/event-action-types";
import type { SeriesSession } from "@/lib/events";
import { toVietnamInputValue } from "@/lib/event-datetime";
import { formatDate, formatTime } from "@/lib/utils";
import { VietnamDateTimeField } from "../vietnam-datetime-field";

const initialState: EventActionState = { ok: false, message: null };

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md bg-vam-green px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-vam-green/90 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? "Đang thêm…" : "Thêm buổi"}
    </button>
  );
}

function RemoveButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-label={label}
      className="rounded-md border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-700 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? "Đang xoá…" : "Xoá buổi"}
    </button>
  );
}

function SaveTimeButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md bg-vam-green px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-vam-green/90 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? "Đang lưu…" : "Lưu giờ"}
    </button>
  );
}

function NotifyButton({ count }: { count: number }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md bg-amber-700 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-amber-800 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? "Đang gửi…" : `Gửi thư báo đổi lịch cho ${count} người`}
    </button>
  );
}

function sessionLine(session: SeriesSession): string {
  if (!session.startsAt) return "Chưa đặt ngày giờ";
  const start = `${formatDate(session.startsAt)} lúc ${formatTime(session.startsAt)}`;
  return session.endsAt ? `${start} – ${formatTime(session.endsAt)}` : start;
}

/**
 * Danh sách các buổi của chuỗi, kèm đường xoá buổi thêm nhầm.
 *
 * ---------------------------------------------------------------------------
 * VÌ SAO PHẢI LIỆT KÊ RA ĐÂY
 * ---------------------------------------------------------------------------
 * Mỗi buổi là một dòng sự kiện riêng, nên trước đây muốn thấy đủ chuỗi thì
 * phải quay ra danh sách sự kiện và tự nhận ra những dòng cùng tên. Ai bấm
 * "Thêm buổi" nhầm hai lần cũng không thấy mình vừa làm gì — chỉ người đăng ký
 * mới thấy, khi mở link ra và gặp hai buổi giống hệt nhau.
 *
 * Chỗ tự nhiên để sửa một cú bấm nhầm là ngay cạnh cái nút đã gây ra nó.
 */
function SessionRow({
  session,
  eventId
}: {
  session: SeriesSession;
  eventId: string;
}) {
  const [state, formAction] = useFormState(removeEventSessionAction, initialState);
  const [timeState, timeAction] = useFormState(updateEventSessionTimeAction, initialState);
  const [noticeState, noticeAction] = useFormState(notifyScheduleChangeAction, initialState);
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const locked = session.registrationCount > 0;

  // Số người chưa được báo, đọc từ máy chủ nên vẫn còn sau khi tải lại trang.
  // Lượt gửi vừa xong ghi đè lên nó, vì trang chưa kịp vẽ lại.
  const stillPending = noticeState.ok
    ? (noticeState.scheduleChange?.holders ?? 0)
    : session.pendingNotice;

  // Giờ CŨ chỉ có ngay sau lượt sửa trong chính phiên làm việc này. Không có
  // thì thư vẫn gửi được, chỉ là nói mỗi giờ mới.
  const previous = noticeState.scheduleChange ?? timeState.scheduleChange ?? null;

  // Lưu xong thì đóng ô sửa lại và để lời báo ở dòng của buổi. Giữ ô mở với
  // đúng giá trị vừa gõ trông y như lúc chưa lưu, nên người ta bấm Lưu lần nữa.
  useEffect(() => {
    if (timeState.ok && timeState.message) {
      setSaved(timeState.message);
      setEditing(false);
    }
  }, [timeState]);

  return (
    <li className="border-b border-vam-line py-2 last:border-b-0">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <span className="text-sm text-vam-ink">
            <span className="font-semibold">Buổi {session.seriesIndex ?? "?"}</span>
            {session.isCurrent ? (
              <span className="ml-2 rounded-full bg-vam-mint px-2 py-0.5 text-[11px] font-medium text-vam-ink">
                đang xem
              </span>
            ) : null}
          </span>
          <span className="mt-0.5 block text-xs text-slate-600">{sessionLine(session)}</span>
          <span className="mt-0.5 block text-[11px] text-slate-500">
            {locked
              ? `${session.registrationCount} người đã đăng ký`
              : "Chưa ai đăng ký"}
          </span>
          {state.message ? (
            <span
              role="status"
              className={`mt-1 block text-[11px] font-medium ${
                state.ok ? "text-vam-green" : "text-red-700"
              }`}
            >
              {state.message}
            </span>
          ) : null}
          {saved && !editing ? (
            <span role="status" className="mt-1 block text-[11px] font-medium text-vam-green">
              {saved}
            </span>
          ) : null}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setSaved(null);
              setEditing((open) => !open);
            }}
            aria-expanded={editing}
            className="rounded-md border border-vam-line px-3 py-1.5 text-xs font-semibold text-vam-ink transition-colors hover:bg-slate-50"
          >
            {editing ? "Thôi" : "Sửa giờ"}
          </button>
          {session.isCurrent ? null : (
            <Link
              href={`/events/${session.id}`}
              className="text-xs font-medium text-vam-green underline-offset-2 hover:underline"
            >
              Mở buổi này
            </Link>
          )}
          {locked ? (
            // Buổi đã có người đăng ký thì những tấm vé đã gửi đi đang trỏ vào
            // dòng này. Xoá nó là làm các vé ấy trỏ vào hư không mà không ai
            // được báo — đường đúng là "Huỷ sự kiện", nó giữ dữ liệu lại.
            //
            // Đổi GIỜ thì vẫn cho, vì dời lịch là chuyện có thật; hàm ghi sẽ
            // nhắc lại rằng có bao nhiêu người đang giữ thư ghi giờ cũ.
            <span className="text-[11px] text-slate-500">
              Đã có người đăng ký — dùng “Huỷ sự kiện” nếu buổi này không diễn ra nữa.
            </span>
          ) : (
            <form action={formAction}>
              <input type="hidden" name="session_id" value={session.id} />
              <input type="hidden" name="event_id" value={eventId} />
              <RemoveButton label={`Xoá buổi ${session.seriesIndex ?? ""}`} />
            </form>
          )}
        </div>
      </div>

      {editing ? (
        <form
          action={timeAction}
          className="mt-2 flex flex-wrap items-start gap-3 rounded-md border border-vam-line bg-white p-3"
        >
          <input type="hidden" name="session_id" value={session.id} />
          <input type="hidden" name="event_id" value={eventId} />

          <VietnamDateTimeField
            name="starts_at"
            label={`Buổi ${session.seriesIndex ?? ""} bắt đầu`}
            required
            defaultValue={session.startsAt}
          />
          {/* Kèm số buổi vào nhãn: trên màn hình này có nhiều ô "Kết thúc" —
              của từng buổi và của phần thêm buổi mới — và một nhãn trần thì
              người đọc màn hình nghe xong không biết mình đang ở ô nào. */}
          <VietnamDateTimeField
            name="ends_at"
            label={`Buổi ${session.seriesIndex ?? ""} kết thúc`}
            defaultValue={session.endsAt}
          />

          <div className="pt-5">
            <SaveTimeButton />
          </div>

          {timeState.message && !timeState.ok ? (
            <p
              role="status"
              className="w-full rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800"
            >
              {timeState.message}
            </p>
          ) : null}
        </form>
      ) : null}

      {stillPending > 0 ? (
        // Nằm ngoài ô sửa giờ, và không biến mất khi đóng ô lại: người đổi giờ
        // xong rồi đóng tab đi họp vẫn thấy lời nhắc này ở lần mở sau. Hệ thống
        // không tự gửi — xem `notifyScheduleChange` về lý do — nên đây là chỗ
        // duy nhất việc này được nhớ hộ.
        <div className="mt-2 flex flex-wrap items-center gap-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2">
          <span className="text-xs text-amber-900">
            <strong className="font-semibold">{stillPending} người</strong> đang giữ thư xác nhận
            ghi giờ cũ và chưa được báo về giờ hiện tại.
          </span>
          <form action={noticeAction}>
            <input type="hidden" name="session_id" value={session.id} />
            <input type="hidden" name="event_id" value={eventId} />
            <input
              type="hidden"
              name="previous_starts_at"
              value={previous?.previousStartsAt ?? ""}
            />
            <input type="hidden" name="previous_ends_at" value={previous?.previousEndsAt ?? ""} />
            <NotifyButton count={stillPending} />
          </form>
        </div>
      ) : null}

      {noticeState.message ? (
        <p
          role="status"
          className={`mt-2 text-[11px] font-medium ${
            noticeState.ok ? "text-vam-green" : "text-red-700"
          }`}
        >
          {noticeState.message}
        </p>
      ) : null}
    </li>
  );
}

/**
 * Thêm một buổi nữa vào chuỗi.
 *
 * ---------------------------------------------------------------------------
 * VÌ SAO CÓ Ô NÀY, KHI LÚC TẠO ĐÃ CÓ "SỰ KIỆN LẶP LẠI"
 * ---------------------------------------------------------------------------
 * Lịch đổi sau khi sự kiện đã tạo là chuyện bình thường: chốt thêm một buổi vì
 * đăng ký vượt dự kiến, hoặc lúc tạo chưa biết có mấy buổi. Không có ô này thì
 * cách duy nhất là xoá đi tạo lại — và mất luôn những đăng ký đã có.
 *
 * Giờ mặc định lấy đúng khung giờ của buổi đang mở, chỉ đẩy sang tuần sau:
 * gần như mọi lần thêm buổi đều là "y như vậy, tuần tới", nên gõ lại từ đầu là
 * bắt người ta làm việc thừa.
 */
export function AddSessionPanel({
  eventId,
  startsAt,
  endsAt,
  seriesIndex,
  seriesTotal,
  sessions
}: {
  eventId: string;
  startsAt: string | null;
  endsAt: string | null;
  seriesIndex: number | null;
  seriesTotal: number | null;
  sessions: SeriesSession[];
}) {
  const [state, formAction] = useFormState(addEventSessionAction, initialState);

  const nextWeek = (iso: string | null): string => {
    if (!iso) return "";
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "";
    return toVietnamInputValue(new Date(date.getTime() + 7 * 86_400_000).toISOString());
  };

  const [start] = useState(() => nextWeek(startsAt));
  const [end] = useState(() => nextWeek(endsAt));

  const inSeries = seriesIndex !== null && seriesTotal !== null;

  return (
    <section className="rounded-md border border-vam-line bg-white p-4">
      <h2 className="text-sm font-semibold text-vam-ink">
        {inSeries ? `Chuỗi ${seriesTotal} buổi — đang xem buổi ${seriesIndex}` : "Thêm buổi cho sự kiện này"}
      </h2>
      <p className="mt-1 text-xs text-slate-500">
        {inSeries
          ? "Thêm một buổi nữa vào chuỗi. Buổi mới chép lại toàn bộ cấu hình của buổi này, chỉ khác ngày giờ."
          : "Sự kiện này đang là buổi đơn lẻ. Thêm một buổi sẽ biến nó thành chuỗi, và một link đăng ký duy nhất sẽ cho người tham dự chọn buổi."}
      </p>

      {sessions.length > 1 ? (
        <div className="mt-4 rounded-md border border-vam-line bg-slate-50/60 p-3">
          <h3 className="text-xs font-semibold uppercase text-slate-500">Các buổi của chuỗi</h3>
          <ul className="mt-1">
            {sessions.map((session) => (
              <SessionRow key={session.id} session={session} eventId={eventId} />
            ))}
          </ul>
        </div>
      ) : null}

      <form action={formAction} className="mt-4 flex flex-wrap items-start gap-3">
        <input type="hidden" name="event_id" value={eventId} />

        <VietnamDateTimeField
          name="starts_at"
          label="Bắt đầu buổi mới"
          required
          defaultValue={start}
        />

        <VietnamDateTimeField name="ends_at" label="Kết thúc" defaultValue={end} />

        <div className="pt-5">
          <Submit />
        </div>
      </form>

      {state.message ? (
        <p
          role="status"
          className={`mt-3 rounded-md border px-3 py-2 text-sm ${
            state.ok
              ? "border-vam-green/40 bg-vam-mint text-vam-ink"
              : "border-red-200 bg-red-50 text-red-800"
          }`}
        >
          {state.message}
        </p>
      ) : null}
    </section>
  );
}
