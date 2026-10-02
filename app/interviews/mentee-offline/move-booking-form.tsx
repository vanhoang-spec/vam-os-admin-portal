"use client";
import { useState } from "react";
import { formatDateTime, formatTime } from "@/lib/utils";

type Session = { id: string; starts_at: string; ends_at: string; venue: string | null; seat_limit: number | null };

/**
 * BTC/Support đổi ca cho một mentee — kể cả sau hạn tự đổi ca (17:00 02/10/2026).
 *
 * Chỉ liệt kê ca CHƯA bắt đầu, có số ghế; ca kín vẫn hiện nhưng không chọn được,
 * để BTC thấy vì sao không đổi vào đó. Database (vam107) kiểm lại tất cả — số chỗ
 * ở đây chỉ là ảnh chụp lúc tải trang.
 *
 * Xác nhận bằng bước thứ hai ngay trên trang, không dùng window.confirm/prompt:
 * trình duyệt tích hợp của Claude chặn hộp hỏi và trả "Không".
 */
export function MoveBookingForm({ sessions, currentSessionId, takenBySession, candidateName, busy, nowIso, onMove }: {
  sessions: Session[];
  currentSessionId: string | null;
  takenBySession: Map<string, number>;
  candidateName: string;
  busy: boolean;
  nowIso: string;
  onMove: (sessionId: string, reason: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [sessionId, setSessionId] = useState("");
  const [reason, setReason] = useState("");
  const [confirming, setConfirming] = useState(false);
  const options = sessions
    // So bằng thời điểm, không so chuỗi: database trả "+00:00", trình duyệt trả "Z".
    .filter((s) => s.id !== currentSessionId && s.seat_limit != null && Date.parse(s.starts_at) > Date.parse(nowIso))
    .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at));
  const chosen = options.find((s) => s.id === sessionId);
  const label = (s: Session) => `${formatDateTime(s.starts_at)} – ${formatTime(s.ends_at)}`;

  if (!open) {
    return (
      <button type="button" disabled={busy} className="w-fit rounded border border-vam-green px-4 py-2 text-vam-green disabled:opacity-50" onClick={() => setOpen(true)}>
        Đổi ca phỏng vấn
      </button>
    );
  }
  return (
    <div className="grid gap-2 rounded border border-slate-300 bg-white p-3 text-sm">
      <p className="font-semibold">Đổi ca cho {candidateName}</p>
      <label>
        Ca mới
        <select value={sessionId} onChange={(e) => { setSessionId(e.target.value); setConfirming(false); }} className="w-full rounded-md border border-slate-300 bg-white p-2">
          <option value="">Chọn ca</option>
          {options.map((s) => {
            const left = (s.seat_limit ?? 0) - (takenBySession.get(s.id) ?? 0);
            return <option key={s.id} value={s.id} disabled={left <= 0}>{label(s)} · {left > 0 ? `còn ${left} chỗ` : "đã kín"}</option>;
          })}
        </select>
      </label>
      <label>
        Lý do đổi ca
        <input value={reason} onChange={(e) => { setReason(e.target.value); setConfirming(false); }} maxLength={500}
          className="w-full rounded-md border border-slate-300 bg-white p-2" placeholder="Ví dụ: mentee bận đột xuất, xin chuyển sang chiều" />
      </label>
      {confirming && chosen ? (
        <div className="flex flex-wrap items-center gap-2 rounded border border-amber-300 bg-amber-50 p-2">
          <span>Chuyển {candidateName} sang ca {label(chosen)}?</span>
          <button type="button" disabled={busy} className="rounded-md bg-vam-green px-3 py-2 text-white disabled:opacity-50"
            onClick={() => { setConfirming(false); onMove(chosen.id, reason.trim()); }}>Xác nhận đổi ca</button>
          <button type="button" className="rounded-md border px-3 py-2" onClick={() => setConfirming(false)}>Huỷ</button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={busy || !chosen || !reason.trim()} className="rounded-md border border-vam-green px-3 py-2 text-vam-green disabled:opacity-50"
            onClick={() => setConfirming(true)}>Đổi sang ca này</button>
          <button type="button" className="rounded-md border px-3 py-2" onClick={() => { setOpen(false); setConfirming(false); }}>Đóng</button>
        </div>
      )}
    </div>
  );
}
