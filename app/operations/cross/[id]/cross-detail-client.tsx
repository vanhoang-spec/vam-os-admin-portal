"use client";

import { useFormState, useFormStatus } from "react-dom";

import {
  cancelCrossRequestAction,
  completeCrossSessionAction,
  decideInvitationsAction,
  draftCrossPostAction,
  publishCrossSessionAction,
  reviewCrossRequestAction,
  saveCrossPostDraftAction,
  scheduleCrossSessionAction,
  sweepInvitationsAction
} from "@/app/actions/cross";
import {
  initialCrossActionState,
  initialCrossSweepActionState
} from "@/lib/cross-action-types";

/**
 * The organiser's controls for one request.
 *
 * Split into small forms rather than one big one, so each button does exactly
 * one thing and its result is reported next to it. The irreversible ones —
 * choosing mentors, scheduling, publishing, closing the books — are rendered
 * only when the server says this person may take them; the library checks
 * again regardless.
 */

function Pending({ label, pendingLabel, tone = "primary", confirm }: {
  label: string;
  pendingLabel: string;
  tone?: "primary" | "quiet" | "danger";
  confirm?: string;
}) {
  const { pending } = useFormStatus();

  const className =
    tone === "primary"
      ? "rounded-md bg-vam-green px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
      : tone === "danger"
        ? "rounded-md border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-700 disabled:opacity-60"
        : "rounded-md border border-vam-line bg-white px-4 py-2 text-sm font-medium text-vam-ink disabled:opacity-60";

  return (
    <button
      type="submit"
      disabled={pending}
      className={className}
      onClick={(event) => {
        if (confirm && !window.confirm(confirm)) event.preventDefault();
      }}
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

function Panel({ title, hint, children }: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-vam-line bg-white p-4">
      <h2 className="text-sm font-semibold text-vam-ink">{title}</h2>
      {hint ? <p className="mt-1 text-sm text-vam-muted">{hint}</p> : null}
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  );
}

// ── Triage ───────────────────────────────────────────────────────────────────

export function ReviewPanel({ requestId }: { requestId: string }) {
  const [state, formAction] = useFormState(reviewCrossRequestAction, initialCrossActionState);

  return (
    <Panel
      title="Duyệt đề xuất"
      hint="Từ chối thì bắt buộc ghi lý do — mentee sẽ hỏi, và người trả lời không nên phải nhớ."
    >
      <form action={formAction} className="space-y-3">
        <input type="hidden" name="request_id" value={requestId} />
        <textarea
          name="review_note"
          rows={2}
          maxLength={1000}
          placeholder="Ghi chú / lý do"
          className="w-full rounded-md border border-vam-line px-3 py-2 text-sm"
        />
        <Feedback state={state} />
        <div className="flex flex-wrap gap-2">
          <button
            type="submit"
            name="decision"
            value="approved"
            className="rounded-md bg-vam-green px-4 py-2 text-sm font-semibold text-white"
          >
            Duyệt
          </button>
          <button
            type="submit"
            name="decision"
            value="rejected"
            className="rounded-md border border-vam-line bg-white px-4 py-2 text-sm font-medium text-vam-ink"
          >
            Từ chối
          </button>
        </div>
      </form>
    </Panel>
  );
}

export function SweepPanel({ requestId, fieldLabel }: { requestId: string; fieldLabel: string }) {
  const [state, formAction] = useFormState(sweepInvitationsAction, initialCrossSweepActionState);

  return (
    <Panel
      title="Mời mentor"
      hint={`Gửi thư tới các mentor đã khai lĩnh vực “${fieldLabel}” trong mùa này. Mỗi mentor chỉ nhận đúng một thư cho đề xuất này, và người đã hai lần nhận lời mà chưa được chọn sẽ được nghỉ.`}
    >
      <form action={formAction} className="space-y-3">
        <input type="hidden" name="request_id" value={requestId} />
        <Feedback state={state} />
        <Pending
          label="Gửi thư mời"
          pendingLabel="Đang gửi…"
          confirm="Gửi thư mời tới các mentor của lĩnh vực này?"
        />
      </form>
    </Panel>
  );
}

// ── Choosing ─────────────────────────────────────────────────────────────────

export type SelectableInvitation = {
  id: string;
  mentorName: string | null;
  status: string;
  statusLabel: string;
  note: string | null;
  slots: string[];
  timesPassedOver: number;
};

export function DecidePanel({
  requestId,
  invitations
}: {
  requestId: string;
  invitations: SelectableInvitation[];
}) {
  const [state, formAction] = useFormState(decideInvitationsAction, initialCrossActionState);
  const selectable = invitations.filter((item) => item.status === "accepted");

  if (!selectable.length) {
    return (
      <Panel title="Chốt mentor" hint="Chưa có mentor nào nhận lời.">
        <p className="text-sm text-vam-muted">
          Khi có mentor bấm nhận lời trong email, danh sách sẽ hiện ở đây.
        </p>
      </Panel>
    );
  }

  return (
    <Panel
      title="Chốt mentor"
      hint="Chọn người phụ trách buổi này. Ngay khi bấm, hệ thống gửi thư báo cho người được chọn và thư cảm ơn cho những người còn lại — cả hai đều không rút lại được."
    >
      <form action={formAction} className="space-y-3">
        <input type="hidden" name="request_id" value={requestId} />

        <ul className="space-y-2">
          {selectable.map((invitation) => (
            <li key={invitation.id} className="rounded-md border border-vam-line p-3">
              <label className="flex items-start gap-3 text-sm">
                <input type="checkbox" name="selected" value={invitation.id} className="mt-1" />
                <span className="min-w-0">
                  <span className="font-medium text-vam-ink">
                    {invitation.mentorName ?? "(chưa rõ tên)"}
                  </span>
                  {invitation.timesPassedOver > 0 ? (
                    <span className="ml-2 rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-800">
                      đã {invitation.timesPassedOver} lần chưa được chọn trong mùa
                    </span>
                  ) : null}
                  {invitation.slots.length ? (
                    <span className="mt-1 block text-vam-muted">
                      Khung giờ đề nghị: {invitation.slots.join(" · ")}
                    </span>
                  ) : (
                    <span className="mt-1 block text-vam-muted">
                      Không nêu khung giờ — cần liên hệ để thống nhất.
                    </span>
                  )}
                  {invitation.note ? (
                    <span className="mt-1 block text-vam-muted">Ghi chú: {invitation.note}</span>
                  ) : null}
                </span>
              </label>
            </li>
          ))}
        </ul>

        <Feedback state={state} />
        <Pending
          label="Chốt và gửi thư"
          pendingLabel="Đang gửi…"
          confirm="Gửi thư cho mentor được chọn và thư cảm ơn cho những người còn lại? Không rút lại được."
        />
      </form>
    </Panel>
  );
}

// ── Scheduling and publishing ────────────────────────────────────────────────

export function SchedulePanel({
  requestId,
  defaultEventName,
  scheduledAt,
  location
}: {
  requestId: string;
  defaultEventName: string;
  scheduledAt: string | null;
  location: string | null;
}) {
  const [state, formAction] = useFormState(scheduleCrossSessionAction, initialCrossActionState);

  return (
    <Panel
      title="Chốt giờ và địa điểm"
      hint="Bấm nút này sẽ tạo sự kiện trên hệ thống. Từ lúc đó đề xuất không quay lui được nữa — muốn đổi ý thì dùng nút huỷ."
    >
      <form action={formAction} className="space-y-3">
        <input type="hidden" name="request_id" value={requestId} />

        <div>
          <label htmlFor="event_name" className="block text-sm font-medium text-vam-ink">
            Tên sự kiện
          </label>
          <input
            id="event_name"
            name="event_name"
            defaultValue={defaultEventName}
            maxLength={200}
            className="mt-1 w-full rounded-md border border-vam-line px-3 py-2 text-sm"
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="scheduled_at" className="block text-sm font-medium text-vam-ink">
              Thời gian <span className="text-red-600">*</span>
            </label>
            <input
              id="scheduled_at"
              name="scheduled_at"
              type="datetime-local"
              required
              defaultValue={scheduledAt ?? ""}
              className="mt-1 w-full rounded-md border border-vam-line px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label htmlFor="location" className="block text-sm font-medium text-vam-ink">
              Địa điểm hoặc link <span className="text-red-600">*</span>
            </label>
            <input
              id="location"
              name="location"
              required
              defaultValue={location ?? ""}
              maxLength={500}
              className="mt-1 w-full rounded-md border border-vam-line px-3 py-2 text-sm"
            />
          </div>
        </div>

        <Feedback state={state} />
        <Pending label="Chốt lịch và tạo sự kiện" pendingLabel="Đang tạo…" />
      </form>
    </Panel>
  );
}

export function PostPanel({
  requestId,
  draft,
  aiModel
}: {
  requestId: string;
  draft: string | null;
  aiModel: string | null;
}) {
  const [draftState, draftAction] = useFormState(draftCrossPostAction, initialCrossActionState);
  const [saveState, saveAction] = useFormState(saveCrossPostDraftAction, initialCrossActionState);

  return (
    <Panel
      title="Bài đăng fanpage"
      hint="AI viết bản nháp từ tên và chức danh mentor — những thông tin sẽ đăng công khai. Không có thông tin nào của mentee được gửi đi. Team truyền thông vẫn phải đọc lại và sửa."
    >
      <form action={draftAction}>
        <input type="hidden" name="request_id" value={requestId} />
        <Feedback state={draftState} />
        <Pending label="Nhờ AI viết nháp" pendingLabel="Đang viết…" tone="quiet" />
      </form>

      <form action={saveAction} className="space-y-3">
        <input type="hidden" name="request_id" value={requestId} />
        <textarea
          name="draft"
          rows={10}
          maxLength={8000}
          defaultValue={draft ?? ""}
          placeholder="Nội dung bài đăng…"
          className="w-full rounded-md border border-vam-line px-3 py-2 text-sm"
        />
        {aiModel ? (
          <p className="text-xs text-vam-muted">Bản nháp gần nhất do {aiModel} viết.</p>
        ) : null}
        <Feedback state={saveState} />
        <Pending label="Lưu bài đăng" pendingLabel="Đang lưu…" tone="quiet" />
      </form>
    </Panel>
  );
}

export function PublishPanel({ requestId }: { requestId: string }) {
  const [state, formAction] = useFormState(publishCrossSessionAction, initialCrossActionState);

  return (
    <Panel
      title="Mở đăng ký"
      hint="Tạo link đăng ký và QR cho sự kiện, để mentee đăng ký tham dự."
    >
      <form action={formAction} className="space-y-3">
        <input type="hidden" name="request_id" value={requestId} />
        <Feedback state={state} />
        <Pending label="Mở đăng ký" pendingLabel="Đang mở…" />
      </form>
    </Panel>
  );
}

export function ClosePanel({ requestId }: { requestId: string }) {
  const [state, formAction] = useFormState(completeCrossSessionAction, initialCrossActionState);

  return (
    <Panel
      title="Chốt sổ buổi gặp"
      hint="Bấm sau khi buổi gặp đã diễn ra. Những bạn đăng ký mà không check-in sẽ được ghi nhận vắng, và mentor được chốt sẽ được ghi nhận có mặt. Đây là lúc tỷ lệ tham dự trở nên đúng."
    >
      <form action={formAction} className="space-y-3">
        <input type="hidden" name="request_id" value={requestId} />
        <Feedback state={state} />
        <Pending
          label="Chốt sổ"
          pendingLabel="Đang chốt…"
          confirm="Buổi gặp đã diễn ra xong? Những bạn đăng ký mà không tới sẽ được ghi nhận vắng."
        />
      </form>
    </Panel>
  );
}

export function CancelPanel({ requestId }: { requestId: string }) {
  const [state, formAction] = useFormState(cancelCrossRequestAction, initialCrossActionState);

  return (
    <Panel
      title="Huỷ buổi này"
      hint="Các mentor đang chờ sẽ được thả ra, và lần huỷ này không tính vào số lần chưa được chọn của họ."
    >
      <form action={formAction} className="space-y-3">
        <input type="hidden" name="request_id" value={requestId} />
        <textarea
          name="reason"
          rows={2}
          required
          maxLength={1000}
          placeholder="Lý do huỷ"
          className="w-full rounded-md border border-vam-line px-3 py-2 text-sm"
        />
        <Feedback state={state} />
        <Pending
          label="Huỷ đề xuất"
          pendingLabel="Đang huỷ…"
          tone="danger"
          confirm="Huỷ buổi cross-mentoring này?"
        />
      </form>
    </Panel>
  );
}
