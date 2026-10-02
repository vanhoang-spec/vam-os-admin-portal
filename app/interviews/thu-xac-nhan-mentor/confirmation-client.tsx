"use client";

import { useState, useTransition } from "react";
import { useFormState, useFormStatus } from "react-dom";
import {
  previewMentorConfirmationsAction,
  sendMentorConfirmationsAction,
  sendMentorConfirmationTestAction
} from "@/app/actions/mentor-interview-confirmation";
import { Card } from "@/components/ui";
import { RECIPIENT_STATUS_LABELS, type RecipientStatus } from "@/lib/mentor-interview-confirmation-core";
import type { PreviewResult } from "@/lib/mentor-interview-confirmation";

const field = "w-full rounded-md border border-slate-300 bg-white p-2 text-sm";
const STATUS_ORDER: RecipientStatus[] = ["ready", "no_access", "already_sent", "no_blocks"];

function ReadButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="w-fit rounded-md border border-vam-green px-4 py-2 text-sm text-vam-green disabled:opacity-50">
      {pending ? "Đang đọc…" : "Đọc danh sách"}
    </button>
  );
}

export function ConfirmationClient() {
  const [state, readAction] = useFormState<PreviewResult | null, FormData>(previewMentorConfirmationsAction, null);
  const [link, setLink] = useState("");
  const [typed, setTyped] = useState("");
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const plan = state?.ok ? state.plan : null;
  const ready = plan ? plan.recipients.filter((r) => r.status === "ready").length : 0;
  const blockLabel = (key: string) => plan?.blocks.find((b) => b.key === key)?.label ?? key;

  return (
    <div className="grid gap-4">
      <Card>
        <form action={(fd) => { setResult(null); setTyped(""); readAction(fd); }} className="grid gap-2">
          <label className="text-sm font-medium" htmlFor="sheet_link">Link Google Sheet mentor đăng ký phỏng vấn</label>
          <input id="sheet_link" name="sheet_link" className={field} value={link} onChange={(e) => setLink(e.target.value)}
            placeholder="https://docs.google.com/spreadsheets/d/…/edit?gid=…" required />
          <p className="text-xs text-slate-500">Sheet cần chia sẻ “Bất kỳ ai có đường liên kết đều xem được”. Mỗi lần đọc và mỗi lần gửi đều đọc lại sheet mới nhất.</p>
          <ReadButton />
        </form>
        {state && !state.ok ? <p role="alert" className="mt-2 text-sm text-red-700">{state.message}</p> : null}
      </Card>

      {plan ? (
        <>
          <Card>
            <h2 className="font-semibold">Các buổi của đợt này (đọc từ ca phỏng vấn)</h2>
            <ul className="mt-2 grid gap-1 text-sm">
              {plan.blocks.map((b) => (
                <li key={b.key}><strong>{b.label}</strong> · {b.timeLabel} · Phòng {b.rooms || "—"} · {b.place || "—"}</li>
              ))}
            </ul>
            <p className="mt-3 text-sm">
              {STATUS_ORDER.map((s) => `${RECIPIENT_STATUS_LABELS[s]}: ${plan.recipients.filter((r) => r.status === s).length}`).join(" · ")}
            </p>
            {plan.duplicates.length ? <p className="mt-1 text-sm text-amber-800">Email điền hơn một dòng (đã gộp buổi): {plan.duplicates.join(", ")}</p> : null}
          </Card>

          <Card>
            <h2 className="font-semibold">Danh sách</h2>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead><tr className="border-b"><th className="p-2">Mentor</th><th className="p-2">Gửi tới (tài khoản)</th><th className="p-2">Buổi</th><th className="p-2">Trạng thái</th></tr></thead>
                <tbody>
                  {[...plan.recipients].sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status)).map((r) => (
                    <tr key={r.email} className="border-b align-top" data-status={r.status}>
                      <td className="p-2">{r.name}<div className="text-xs text-slate-500">{r.email}</div></td>
                      <td className="p-2">{r.loginEmail ?? "—"}{r.matchedBy === "phone_and_name" ? <div className="text-xs text-amber-800">Khác email trên sheet — khớp theo SĐT + tên</div> : null}</td>
                      <td className="p-2">{r.blockKeys.map(blockLabel).join("; ") || "—"}{r.note ? <div className="text-xs text-slate-500">Ghi chú: {r.note}</div> : null}</td>
                      <td className="p-2">{RECIPIENT_STATUS_LABELS[r.status]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {state?.ok && state.sample ? (
            <Card>
              <h2 className="font-semibold">Xem trước thư gửi {state.sample.to}</h2>
              <p className="mt-2 text-sm"><strong>Tiêu đề:</strong> {state.sample.subject}</p>
              <pre className="mt-2 whitespace-pre-wrap break-words rounded border bg-slate-50 p-3 text-sm font-sans">{state.sample.body}</pre>
            </Card>
          ) : null}

          <Card>
            <h2 className="font-semibold">Gửi</h2>
            <div className="mt-2 grid gap-3">
              <button type="button" disabled={pending || ready === 0} className="w-fit rounded-md border px-4 py-2 text-sm disabled:opacity-50"
                onClick={() => startTransition(async () => {
                  const r = await sendMentorConfirmationTestAction(link);
                  setResult({ ok: r.ok, text: r.message });
                })}>
                Gửi thử cho tôi
              </button>
              <label className="text-sm" htmlFor="confirm_count">Gõ đúng số người sẽ nhận ({ready}) để mở nút gửi</label>
              <input id="confirm_count" className={`${field} max-w-40`} inputMode="numeric" value={typed} onChange={(e) => setTyped(e.target.value)} />
              <button type="button" disabled={pending || ready === 0 || typed.trim() !== String(ready)}
                className="w-fit rounded-md bg-vam-green px-4 py-2 text-sm text-white disabled:opacity-50"
                onClick={() => startTransition(async () => {
                  const r = await sendMentorConfirmationsAction(link, typed);
                  setResult({ ok: r.ok, text: r.message + (r.failed.length ? ` Lỗi: ${r.failed.join(", ")}` : "") });
                  setTyped("");
                })}>
                {pending ? "Đang gửi…" : `Gửi thư cho ${ready} mentor`}
              </button>
              <p className="text-xs text-slate-500">Gửi xong bấm “Đọc danh sách” lại để xem ai còn thiếu. Đừng bấm gửi ở hai máy cùng lúc.</p>
            </div>
            {result ? <p role={result.ok ? "status" : "alert"} className={result.ok ? "mt-2 text-sm text-vam-green" : "mt-2 text-sm text-red-700"}>{result.text}</p> : null}
          </Card>
        </>
      ) : null}
    </div>
  );
}
