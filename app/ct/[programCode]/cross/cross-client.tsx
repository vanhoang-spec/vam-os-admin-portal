"use client";

import Link from "next/link";
import { useFormState, useFormStatus } from "react-dom";

import {
  registerForSessionAction,
  saveMyCrossFieldsAction,
  submitCrossRequestAction
} from "@/app/actions/cross";
import { initialCrossActionState } from "@/lib/cross-action-types";
import type { FieldOption } from "@/lib/cross-fields-core";

/**
 * The participant's cross-mentoring screen.
 *
 * One component for two audiences, because one person can be both: a mentee
 * asks for a session, a mentor says which fields they can take. Whichever
 * applies is what renders.
 */

function SubmitButton({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md bg-vam-green px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
    >
      {pending ? pendingLabel : label}
    </button>
  );
}

function Feedback({ state }: { state: { ok: boolean; message: string | null } }) {
  if (!state.message) return null;

  return (
    <p
      role="status"
      className={`rounded-md border px-3 py-2 text-sm ${
        state.ok
          ? "border-emerald-200 bg-emerald-50 text-emerald-800"
          : "border-amber-300 bg-amber-50 text-amber-900"
      }`}
    >
      {state.message}
    </p>
  );
}

export type MyRequest = {
  id: string;
  fieldLabel: string;
  topic: string | null;
  statusLabel: string;
  status: string;
  reviewNote: string | null;
  scheduledAt: string | null;
  location: string | null;
  createdAt: string;
};

export function MenteeRequestPanel({
  programCode,
  industries,
  functions,
  requests,
  atLimit
}: {
  programCode: string;
  industries: FieldOption[];
  functions: FieldOption[];
  requests: MyRequest[];
  atLimit: boolean;
}) {
  const [state, formAction] = useFormState(submitCrossRequestAction, initialCrossActionState);

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-vam-ink">Đề xuất cross-mentoring</h2>
        <p className="mt-1 text-sm text-vam-muted">
          Bạn muốn nghe chia sẻ từ một mentor ở lĩnh vực khác? Gửi đề xuất ở đây. Ban tổ chức sẽ
          xem, mời mentor phù hợp và báo lại bạn.
        </p>
      </div>

      {requests.length > 0 ? (
        <ul className="space-y-3">
          {requests.map((request) => (
            <li
              key={request.id}
              className="rounded-lg border border-vam-line bg-white p-4 text-sm"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-semibold text-vam-ink">{request.fieldLabel}</span>
                <span className="rounded-full bg-[#eef5f1] px-2.5 py-0.5 text-xs font-medium text-vam-green">
                  {request.statusLabel}
                </span>
              </div>

              {request.topic ? (
                <p className="mt-2 text-vam-muted">{request.topic}</p>
              ) : null}

              {request.scheduledAt ? (
                <p className="mt-2 text-vam-ink">
                  Đã có lịch: {request.scheduledAt}
                  {request.location ? ` — ${request.location}` : ""}
                </p>
              ) : null}

              {request.status === "rejected" && request.reviewNote ? (
                <p className="mt-2 rounded-md bg-[#fdf6ec] px-3 py-2 text-vam-ink">
                  Ban tổ chức phản hồi: {request.reviewNote}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {atLimit ? (
        <p className="rounded-md border border-vam-line bg-white px-3 py-2 text-sm text-vam-muted">
          Bạn đang có đủ số đề xuất chờ xử lý. Khi ban tổ chức phản hồi xong, bạn gửi thêm được.
        </p>
      ) : (
        <form action={formAction} className="space-y-4 rounded-lg border border-vam-line bg-white p-4">
          <input type="hidden" name="program_code" value={programCode} />

          <div>
            <label htmlFor="field" className="block text-sm font-medium text-vam-ink">
              Lĩnh vực bạn muốn nghe <span className="text-red-600">*</span>
            </label>
            <select
              id="field"
              name="field"
              required
              defaultValue=""
              className="mt-1 w-full rounded-md border border-vam-line px-3 py-2 text-sm"
            >
              <option value="" disabled>
                — Chọn lĩnh vực —
              </option>
              <optgroup label="Ngành nghề">
                {industries.map((option) => (
                  <option key={option.code} value={`industry:${option.code}`}>
                    {option.label}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Mảng công việc">
                {functions.map((option) => (
                  <option key={option.code} value={`function:${option.code}`}>
                    {option.label}
                  </option>
                ))}
              </optgroup>
            </select>
          </div>

          <div>
            <label htmlFor="topic" className="block text-sm font-medium text-vam-ink">
              Bạn muốn nghe chia sẻ về điều gì? <span className="text-red-600">*</span>
            </label>
            <textarea
              id="topic"
              name="topic"
              required
              minLength={20}
              maxLength={1000}
              rows={4}
              placeholder="Ví dụ: em muốn hiểu lộ trình từ kiểm toán sang tài chính doanh nghiệp, và cần chuẩn bị gì trong 2 năm đầu."
              className="mt-1 w-full rounded-md border border-vam-line px-3 py-2 text-sm"
            />
            <p className="mt-1 text-xs text-vam-muted">
              Viết càng cụ thể, ban tổ chức càng mời đúng mentor. Ít nhất 20 ký tự.
            </p>
          </div>

          <div>
            <label htmlFor="note" className="block text-sm font-medium text-vam-ink">
              Ghi chú thêm cho ban tổ chức
            </label>
            <textarea
              id="note"
              name="note"
              maxLength={1000}
              rows={2}
              className="mt-1 w-full rounded-md border border-vam-line px-3 py-2 text-sm"
            />
          </div>

          <Feedback state={state} />
          <SubmitButton label="Gửi đề xuất" pendingLabel="Đang gửi…" />
        </form>
      )}
    </section>
  );
}

export function MentorFieldsPanel({
  programCode,
  seasonId,
  industries,
  functions,
  selectedIndustries,
  selectedFunctions,
  source
}: {
  programCode: string;
  seasonId: string;
  industries: FieldOption[];
  functions: FieldOption[];
  selectedIndustries: string[];
  selectedFunctions: string[];
  source: string | null;
}) {
  const [state, formAction] = useFormState(saveMyCrossFieldsAction, initialCrossActionState);

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-vam-ink">Lĩnh vực anh/chị nhận chia sẻ</h2>
        <p className="mt-1 text-sm text-vam-muted">
          Khi có bạn mentee đề xuất một buổi cross-mentoring về lĩnh vực anh/chị chọn ở đây, hệ
          thống sẽ gửi thư mời. Nhận lời hay không vẫn là quyền của anh/chị ở từng lần.
        </p>
        {source === "application" ? (
          <p className="mt-2 rounded-md border border-vam-line bg-[#f7faf8] px-3 py-2 text-sm text-vam-muted">
            Các lĩnh vực dưới đây lấy từ đơn đăng ký của anh/chị. Vui lòng kiểm tra và sửa nếu chưa
            đúng.
          </p>
        ) : null}
      </div>

      <form action={formAction} className="space-y-5 rounded-lg border border-vam-line bg-white p-4">
        <input type="hidden" name="program_code" value={programCode} />
        <input type="hidden" name="season_id" value={seasonId} />

        <fieldset>
          <legend className="text-sm font-medium text-vam-ink">Ngành nghề</legend>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {industries.map((option) => (
              <label key={option.code} className="flex items-start gap-2 text-sm text-vam-ink">
                <input
                  type="checkbox"
                  name="industries"
                  value={option.code}
                  defaultChecked={selectedIndustries.includes(option.code)}
                  className="mt-0.5"
                />
                <span>{option.label}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend className="text-sm font-medium text-vam-ink">Mảng công việc</legend>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {functions.map((option) => (
              <label key={option.code} className="flex items-start gap-2 text-sm text-vam-ink">
                <input
                  type="checkbox"
                  name="functions"
                  value={option.code}
                  defaultChecked={selectedFunctions.includes(option.code)}
                  className="mt-0.5"
                />
                <span>{option.label}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <Feedback state={state} />
        <SubmitButton label="Lưu lĩnh vực" pendingLabel="Đang lưu…" />
      </form>
    </section>
  );
}

export function BackLink({ programCode }: { programCode: string }) {
  return (
    <Link
      href={`/ct/${encodeURIComponent(programCode)}`}
      className="text-sm font-medium text-vam-green hover:underline"
    >
      ← Về trang chương trình
    </Link>
  );
}

export type OpenSessionRow = {
  eventId: string;
  eventName: string;
  timeLabel: string | null;
  description: string | null;
  registered: boolean;
};

/**
 * Sessions open for registration.
 *
 * Registering here writes the person id straight from the session, so this
 * mentee's attendance is attributable — which the public form, matching on a
 * typed email, cannot guarantee.
 */
export function OpenSessionsPanel({
  programCode,
  sessions
}: {
  programCode: string;
  sessions: OpenSessionRow[];
}) {
  const [state, formAction] = useFormState(registerForSessionAction, initialCrossActionState);

  if (!sessions.length) return null;

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-vam-ink">Buổi đang mở đăng ký</h2>
        <p className="mt-1 text-sm text-vam-muted">
          Các buổi cross-mentoring mùa này. Bạn đăng ký được kể cả khi không phải người đề xuất.
        </p>
      </div>

      {state.message ? (
        <p
          role="status"
          className={`rounded-md border px-3 py-2 text-sm ${
            state.ok
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border-amber-300 bg-amber-50 text-amber-900"
          }`}
        >
          {state.message}
        </p>
      ) : null}

      <ul className="space-y-3">
        {sessions.map((session) => (
          <li key={session.eventId} className="rounded-lg border border-vam-line bg-white p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="font-semibold text-vam-ink">{session.eventName}</span>
              {session.timeLabel ? (
                <span className="text-sm text-vam-muted">{session.timeLabel}</span>
              ) : null}
            </div>

            {session.description ? (
              <p className="mt-2 whitespace-pre-line text-sm text-vam-muted">
                {session.description}
              </p>
            ) : null}

            <div className="mt-3">
              {session.registered ? (
                <span className="inline-block rounded-full bg-[#eef5f1] px-3 py-1 text-xs font-medium text-vam-green">
                  Bạn đã đăng ký
                </span>
              ) : (
                <form action={formAction}>
                  <input type="hidden" name="program_code" value={programCode} />
                  <input type="hidden" name="event_id" value={session.eventId} />
                  <SubmitButton label="Đăng ký tham dự" pendingLabel="Đang đăng ký…" />
                </form>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
