"use client";

import { useEffect, useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import {
  addMenteeExemptionsAction,
  revokeMenteeExemptionAction,
  sendMenteeExemptionInvitesAction,
  sendMenteeExemptionTestAction
} from "@/app/actions/mentee-exemption";
import { EXEMPTION_IDLE, type ExemptionActionState } from "@/lib/mentee-exemption-action-types";

function Message({ state }: { state: ExemptionActionState }) {
  if (state.status === "idle") return null;
  return (
    <p role="status" className={`text-sm ${state.status === "ok" ? "text-green-700" : "text-red-600"}`}>
      {state.message}
    </p>
  );
}

function Submit({ label, pendingLabel, disabled, tone = "primary" }: { label: string; pendingLabel: string; disabled?: boolean; tone?: "primary" | "danger" }) {
  const { pending } = useFormStatus();
  const cls = tone === "danger" ? "bg-red-600 text-white hover:bg-red-700" : "bg-vam-green text-white hover:bg-vam-green/90";
  return (
    <button type="submit" disabled={pending || disabled} className={`rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50 ${cls}`}>
      {pending ? pendingLabel : label}
    </button>
  );
}

export type CandidateRow = { personId: string; name: string; email: string | null; signals: string[]; application: string };

/**
 * Người hệ thống GỢI Ý — có dấu hiệu đang được đặc cách — để BTC tick thêm vào danh sách.
 * Mặc định không tick ai: thêm một người vào đây là gửi được thư mời cho người đó, nên đó
 * phải là thao tác có chủ ý của BTC, không phải mặc định của hệ thống.
 */
export function CandidatePicker({ candidates }: { candidates: CandidateRow[] }) {
  const [state, action] = useFormState(addMenteeExemptionsAction, EXEMPTION_IDLE);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  // Thêm xong thì danh sách gợi ý ngắn lại; bỏ các dấu tick cũ để con số "đã chọn" không
  // còn đếm những người đã rời khỏi bảng.
  useEffect(() => {
    if (state.status === "ok") setPicked(new Set());
  }, [state]);
  const pickedCount = candidates.filter((c) => picked.has(c.personId)).length;
  const toggle = (id: string, on: boolean) => {
    const next = new Set(picked);
    if (on) next.add(id);
    else next.delete(id);
    setPicked(next);
  };
  return (
    <form action={action} className="grid gap-3" data-testid="exemption-candidates">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <button type="button" onClick={() => setPicked(new Set(candidates.map((c) => c.personId)))} className="rounded-md border border-vam-line px-3 py-1.5 text-slate-700">
          Chọn tất cả
        </button>
        <button type="button" onClick={() => setPicked(new Set())} className="rounded-md border border-vam-line px-3 py-1.5 text-slate-700">
          Bỏ chọn
        </button>
        <span className="text-slate-600">
          Đã chọn <strong>{pickedCount}</strong>/{candidates.length}
        </span>
      </div>
      <div className="vam-table-frame overflow-x-auto rounded-lg border border-vam-line bg-white">
        <table className="min-w-full divide-y divide-vam-line text-sm">
          <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2">Chọn</th>
              <th className="px-3 py-2">Họ tên</th>
              <th className="px-3 py-2">Email</th>
              <th className="px-3 py-2">Vì sao được gợi ý</th>
              <th className="px-3 py-2">Đơn mentee mùa này</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-vam-line">
            {candidates.map((c) => (
              <tr key={c.personId} data-person={c.personId}>
                <td className="px-3 py-2">
                  <input
                    type="checkbox"
                    name="personId"
                    value={c.personId}
                    checked={picked.has(c.personId)}
                    onChange={(event) => toggle(c.personId, event.target.checked)}
                    aria-label={`Chọn ${c.name}`}
                    className="h-4 w-4 rounded border-vam-line text-vam-green"
                  />
                </td>
                <td className="px-3 py-2 font-medium text-vam-ink">{c.name}</td>
                <td className="px-3 py-2 text-slate-600">{c.email ?? "—"}</td>
                <td className="px-3 py-2 text-slate-600">{c.signals.join("; ")}</td>
                <td className="px-3 py-2 text-slate-600">{c.application}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Submit label={`Thêm ${pickedCount} người đã chọn vào danh sách`} pendingLabel="Đang thêm…" disabled={pickedCount === 0} />
        <Message state={state} />
      </div>
    </form>
  );
}

/**
 * Nút gỡ hai bước NGAY TRÊN TRANG (không window.confirm — trình duyệt tích hợp chặn hộp
 * hỏi đó). Bước một chỉ mở xác nhận; bước hai mới gửi.
 */
export function RevokeButton({ exemptionId, name }: { exemptionId: string; name: string }) {
  const [state, action] = useFormState(revokeMenteeExemptionAction, EXEMPTION_IDLE);
  const [confirming, setConfirming] = useState(false);
  if (state.status === "ok") return <Message state={state} />;
  return (
    <div className="flex flex-col gap-1" data-testid="exemption-revoke">
      {confirming ? (
        <form action={action} className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="exemptionId" value={exemptionId} />
          <input type="hidden" name="confirmed" value="yes" />
          <span className="text-sm text-vam-ink">Gỡ {name} khỏi danh sách?</span>
          <Submit label="Xác nhận gỡ" pendingLabel="Đang gỡ…" tone="danger" />
          <button type="button" onClick={() => setConfirming(false)} className="text-sm text-slate-600">
            Giữ lại
          </button>
        </form>
      ) : (
        <button type="button" onClick={() => setConfirming(true)} className="self-start text-sm font-medium text-red-600">
          Gỡ khỏi danh sách
        </button>
      )}
      <Message state={state} />
    </div>
  );
}

export type SendPanelProps = { pending: number; sentInWindow: number | null; allowance: number };

/** Gửi thử cho chính mình, rồi gửi thật với bước xác nhận thứ hai ngay trên trang. */
export function ExemptionSendPanel(props: SendPanelProps) {
  const [testState, testAction] = useFormState(sendMenteeExemptionTestAction, EXEMPTION_IDLE);
  const [sendState, sendAction] = useFormState(sendMenteeExemptionInvitesAction, EXEMPTION_IDLE);
  const [confirming, setConfirming] = useState(false);
  const batch = Math.min(props.pending, props.allowance);
  const blocked =
    props.pending === 0
      ? "Không có ai đang chờ thư: người chưa xác nhận đều đã nhận thư trong 20 giờ qua, hoặc danh sách còn trống."
      : props.allowance === 0
        ? props.sentInWindow === null
          ? "Không đếm được số thư đã gửi trong 24 giờ qua, nên tạm khoá nút gửi."
          : "Đã chạm phần hạn mức thư trong 24 giờ qua. Thử lại sau vài giờ."
        : null;

  return (
    <div className="grid gap-3" data-testid="exemption-send">
      <p className="text-sm text-slate-600">
        Đang chờ thư: <strong>{props.pending}</strong> người · Thư cả hệ thống trong 24 giờ: {props.sentInWindow ?? "?"}/1.000 · Mỗi lần bấm gửi tối đa{" "}
        {props.allowance} thư.
      </p>
      <form action={testAction} className="flex flex-wrap items-center gap-3">
        <Submit label="Gửi thử cho tôi" pendingLabel="Đang gửi thử…" />
        <Message state={testState} />
      </form>
      <p className="text-xs text-slate-500" data-testid="exemption-test-note">
        Thư thử gửi về hộp thư của bạn, tiêu đề có [THƯ THỬ], chỉ để xem thư hiển thị thế nào — nút xác nhận trong thư thử cố ý không bấm được.
        Thư thật gửi tới từng bạn có đường dẫn xác nhận riêng và bấm được.
      </p>
      {blocked ? (
        <p className="text-sm text-amber-700">{blocked}</p>
      ) : confirming ? (
        <form action={sendAction} className="flex flex-wrap items-center gap-3">
          <input type="hidden" name="confirmed" value="yes" />
          <span className="text-sm text-vam-ink">Gửi {batch} thư mời xác nhận tới người thật?</span>
          <Submit label="Xác nhận gửi" pendingLabel="Đang gửi…" />
          <button type="button" onClick={() => setConfirming(false)} className="rounded-md border border-vam-line px-3 py-2 text-sm text-slate-700">
            Huỷ
          </button>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="self-start rounded-md bg-vam-green px-4 py-2 text-sm font-medium text-white hover:bg-vam-green/90"
        >
          Gửi thư mời xác nhận (tối đa {batch} thư)
        </button>
      )}
      <Message state={sendState} />
    </div>
  );
}
