"use client";

import Link from "next/link";
import { useFormState, useFormStatus } from "react-dom";
import {
  initialEventSupporterActionState,
  type EventSupporterActionState
} from "@/lib/event-supporter-action-types";
import {
  addEventSupporterAction,
  removeEventSupporterAction
} from "@/app/actions/event-supporters";

export type SupporterRow = {
  id: string;
  fullName: string;
  email: string;
};

export type SupporterChoice = {
  adminUserId: string;
  fullName: string;
  email: string;
};

/** Tên nếu có, không thì email — đừng bao giờ hiện ra một dòng trống. */
function personLabel(person: { fullName: string; email: string }): string {
  const name = person.fullName.trim();
  const email = person.email.trim();
  if (name && email) return `${name} — ${email}`;
  return name || email || "(không có tên)";
}

function Button({ label, busyLabel, quiet }: { label: string; busyLabel: string; quiet?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className={`rounded-md px-3 py-2 text-sm font-semibold transition-colors disabled:opacity-60 ${
        quiet
          ? "border border-vam-line bg-white text-slate-600 hover:bg-slate-50"
          : "bg-vam-green text-white hover:bg-vam-green/90"
      }`}
    >
      {pending ? busyLabel : label}
    </button>
  );
}

function Notice({ state }: { state: EventSupporterActionState }) {
  if (!state.message) return null;
  return (
    <p
      role="status"
      className={`rounded-md border px-3 py-2 text-sm ${
        state.ok
          ? "border-vam-green/40 bg-vam-mint text-vam-ink"
          : "border-red-200 bg-red-50 text-red-800"
      }`}
    >
      {state.message}
    </p>
  );
}

/**
 * Ai được quét mã điểm danh cho buổi này.
 *
 * Danh sách gắn theo BUỔI, không phải một vai trò toàn cục: sáu bạn hỗ trợ
 * buổi orientation không có việc gì ở buổi phỏng vấn tuần sau, và hết buổi thì
 * bỏ tên khỏi danh sách là xong — không phải hạ cấp một tài khoản.
 */
export function SupportersPanel({
  eventId,
  supporters,
  candidates,
  canManage
}: {
  eventId: string;
  supporters: SupporterRow[];
  /** Support team chưa có trong danh sách của buổi này. */
  candidates: SupporterChoice[];
  canManage: boolean;
}) {
  const [addState, addAction] = useFormState(
    addEventSupporterAction,
    initialEventSupporterActionState
  );
  const [removeState, removeAction] = useFormState(
    removeEventSupporterAction,
    initialEventSupporterActionState
  );

  return (
    <section className="rounded-md border border-vam-line bg-white p-4">
      <h2 className="text-sm font-semibold text-vam-ink">Người hỗ trợ điểm danh</h2>
      <p className="mt-1 text-xs text-slate-500">
        Chỉ những người trong danh sách này (và quản trị sự kiện) mở được máy quét của buổi này.
      </p>

      {supporters.length ? (
        <ul className="mt-3 divide-y divide-vam-line">
          {supporters.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span className="min-w-0">
                <span className="block truncate text-sm text-vam-ink">
                  {row.fullName || row.email}
                </span>
                {row.fullName ? (
                  <span className="block truncate text-xs text-slate-500">{row.email}</span>
                ) : null}
              </span>
              {canManage ? (
                <form action={removeAction}>
                  <input type="hidden" name="event_id" value={eventId} />
                  <input type="hidden" name="supporter_id" value={row.id} />
                  <Button label="Bỏ" busyLabel="Đang bỏ…" quiet />
                </form>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-slate-500">
          Chưa có ai. Quản trị sự kiện vẫn quét được mà không cần thêm vào đây.
        </p>
      )}

      {canManage ? (
        <>
          {candidates.length ? (
            <>
              <form
                action={addAction}
                className="mt-4 flex flex-wrap items-end gap-2 border-t border-vam-line pt-4"
              >
                <input type="hidden" name="event_id" value={eventId} />
                <label className="block">
                  <span className="text-xs font-medium uppercase text-slate-500">
                    Chọn từ support team
                  </span>
                  <select
                    name="admin_user_id"
                    defaultValue={candidates[0].adminUserId}
                    className="mt-1 w-72 rounded-md border border-vam-line bg-white px-3 py-2 text-sm"
                  >
                    {candidates.map((person) => (
                      <option key={person.adminUserId} value={person.adminUserId}>
                        {personLabel(person)}
                      </option>
                    ))}
                  </select>
                </label>
                <Button label="Thêm" busyLabel="Đang thêm…" />
              </form>
              <p className="mt-2 text-xs text-slate-500">
                Chỉ hiện những người thuộc Support team và chưa có trong danh sách của buổi này.
              </p>
            </>
          ) : (
            // Không có ai để chọn thì nói thẳng vì sao và chỉ đường, thay vì
            // để lại một ô chọn rỗng cho người ta bấm mãi không ra gì.
            <p className="mt-4 border-t border-vam-line pt-4 text-sm text-slate-500">
              {supporters.length
                ? "Đã thêm hết Support team vào buổi này."
                : "Chưa có tài khoản nào thuộc Support team."}{" "}
              Đặt vai trò Support team cho tài khoản trong{" "}
              <Link href="/admin/users" className="text-vam-green underline underline-offset-2">
                Quản trị tài khoản
              </Link>
              , rồi quay lại đây.
            </p>
          )}
          <div className="mt-3 flex flex-col gap-2">
            <Notice state={addState} />
            <Notice state={removeState} />
          </div>
        </>
      ) : null}
    </section>
  );
}
