"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { cancelBookingByBtcAction, runInterviewDispatchAction } from "@/app/actions/interview-schedule";
import {
  DispatchResult,
  dispatchMaxRounds,
  shouldContinueDispatch
} from "@/lib/interview-schedule-core";

/**
 * Bảng điều hành của ban tổ chức trên trang Lịch phỏng vấn.
 *
 * Vòng tự động 20 giây: hệ thống không có bộ hẹn giờ nền, nên "tự gửi thư
 * mời/nhắc" nghĩa là CÓ MỘT TAB đang mở trang này (hoặc cron sáng đã được
 * bật). `busyRef` giữ cho một lượt đang chạy không bị lượt sau giẫm lên —
 * cùng khuôn với panel khảo sát sự kiện.
 */

const AUTO_TICK_MS = 20_000;

type PerInterviewer = {
  adminUserId: string;
  name: string;
  phone: string | null;
  stats: { total: number; done: number; bookedUpcoming: number; open: number; expired: number };
};
type UpcomingBooking = {
  bookingId: string;
  slotStartsAtIso: string;
  slotLabel: string;
  candidateName: string;
  candidateEmail: string;
  interviewerName: string;
};
type OverviewProp = {
  openFutureHours: number;
  mentors: { eligibleTotal: number; notBooked: number; bookedUpcoming: number; bookedPast: number };
  invitesDueNow: number;
  perInterviewer: PerInterviewer[];
  upcomingBookings: UpcomingBooking[];
};

function Tile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-vam-line bg-white px-4 py-3">
      <p className="text-2xl font-semibold tabular-nums text-vam-ink">{value}</p>
      <p className="mt-1 text-xs text-slate-600">{label}</p>
    </div>
  );
}

export function BtcPanel({ overview }: { overview: OverviewProp }) {
  const router = useRouter();
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  const setWorking = (value: boolean) => {
    busyRef.current = value;
    setBusy(value);
  };

  // Gọi bộ gửi tới khi hàng đợi cạn — có trần vòng lặp để một lỗi lặp không quay mãi.
  const runUntilDone = useCallback(async (first: DispatchResult): Promise<DispatchResult> => {
    let last = first;
    const rounds = dispatchMaxRounds(first);
    for (let round = 0; round < rounds && shouldContinueDispatch(last); round++) {
      last = await runInterviewDispatchAction();
    }
    return last;
  }, []);

  const sendNow = async () => {
    if (busyRef.current) return;
    setWorking(true);
    try {
      const first = await runInterviewDispatchAction();
      const last = await runUntilDone(first);
      setNotice({ tone: last.ok ? "success" : "error", text: last.message });
      router.refresh();
    } catch {
      setNotice({ tone: "error", text: "Không gửi được — thử lại sau ít phút." });
    } finally {
      setWorking(false);
    }
  };

  useEffect(() => {
    let stopped = false;
    async function tick() {
      if (stopped || busyRef.current) return;
      if (typeof document !== "undefined" && document.hidden) return;
      setWorking(true);
      try {
        const first = await runInterviewDispatchAction();
        if (stopped) return;
        const last = await runUntilDone(first);
        if (last.sent > 0) {
          setNotice({ tone: "success", text: `Tự gửi: ${last.message}` });
          router.refresh();
        }
      } catch {
        // Vòng nền — mất mạng một nhịp không được phép nháy đỏ giữa màn hình.
      } finally {
        setWorking(false);
      }
    }
    void tick();
    const timer = setInterval(() => void tick(), AUTO_TICK_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [router, runUntilDone]);

  const cancelBooking = async (booking: UpcomingBooking) => {
    if (busyRef.current) return;
    const note = window.prompt(
      `Huỷ buổi ${booking.slotLabel} của ${booking.candidateName} (interviewer: ${booking.interviewerName})?\n\nGhi lý do (không bắt buộc) rồi bấm OK — khung giờ sẽ mở lại và hai bên nhận thư báo huỷ.`
    );
    if (note === null) return;
    setWorking(true);
    try {
      const result = await cancelBookingByBtcAction({ bookingId: booking.bookingId, note: note || undefined });
      setNotice({ tone: result.ok ? "success" : "error", text: result.message });
      router.refresh();
    } catch {
      setNotice({ tone: "error", text: "Không huỷ được — thử lại sau ít phút." });
    } finally {
      setWorking(false);
    }
  };

  return (
    <section className="grid gap-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Tile label="Giờ còn trống đến hết 05/10" value={overview.openFutureHours} />
        <Tile label="Mentor sẵn sàng phỏng vấn" value={overview.mentors.eligibleTotal} />
        <Tile label="Chưa đặt lịch" value={overview.mentors.notBooked} />
        <Tile label="Đã đặt, sắp diễn ra" value={overview.mentors.bookedUpcoming} />
        <Tile label="Đã qua giờ hẹn" value={overview.mentors.bookedPast} />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void sendNow()}
          disabled={busy}
          className="inline-flex items-center rounded-md bg-vam-green px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
        >
          {busy ? "Đang gửi..." : `Gửi thư mời/nhắc ngay (${overview.invitesDueNow} đến hạn)`}
        </button>
        <span className="text-xs text-slate-500">
          Thư tự gửi khi tab này đang mở; đóng tab thì đợt gửi kế tiếp chờ người mở lại trang (hoặc cron sáng, nếu
          đã bật).
        </span>
      </div>

      {notice ? (
        <p
          role={notice.tone === "error" ? "alert" : "status"}
          className={`rounded-md border px-3 py-2 text-sm ${
            notice.tone === "error"
              ? "border-red-200 bg-red-50 text-red-800"
              : "border-vam-green/40 bg-vam-mint/40 text-vam-ink"
          }`}
        >
          {notice.text}
        </p>
      ) : null}

      <div className="overflow-x-auto rounded-lg border border-vam-line bg-white">
        <table className="min-w-[640px] w-full text-left text-sm">
          <thead>
            <tr className="bg-slate-50 text-xs uppercase tracking-wide text-slate-600">
              <th className="px-3 py-2">Interviewer</th>
              <th className="px-3 py-2">SĐT</th>
              <th className="px-3 py-2 text-right">Đăng ký</th>
              <th className="px-3 py-2 text-right">Đã xong</th>
              <th className="px-3 py-2 text-right">Sắp tới</th>
              <th className="px-3 py-2 text-right">Còn trống</th>
            </tr>
          </thead>
          <tbody>
            {overview.perInterviewer.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-4 text-sm text-slate-500">
                  Chưa interviewer nào đăng giờ rảnh.
                </td>
              </tr>
            ) : (
              overview.perInterviewer.map((row) => (
                <tr key={row.adminUserId} className="border-t border-vam-line">
                  <td className="px-3 py-2 font-medium text-vam-ink">{row.name}</td>
                  <td className="px-3 py-2 text-slate-600">{row.phone ?? "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{row.stats.total}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{row.stats.done}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{row.stats.bookedUpcoming}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{row.stats.open}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="rounded-lg border border-vam-line bg-white">
        <h3 className="border-b border-vam-line px-3 py-2 text-sm font-semibold text-vam-ink">
          Lịch hẹn sắp diễn ra ({overview.upcomingBookings.length})
        </h3>
        {overview.upcomingBookings.length === 0 ? (
          <p className="px-3 py-4 text-sm text-slate-500">Chưa có buổi nào được đặt.</p>
        ) : (
          <ul className="divide-y divide-vam-line">
            {overview.upcomingBookings.map((booking) => (
              <li key={booking.bookingId} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-vam-ink">{booking.slotLabel}</p>
                  <p className="text-xs text-slate-600">
                    {booking.candidateName} ({booking.candidateEmail}) × {booking.interviewerName}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void cancelBooking(booking)}
                  disabled={busy}
                  className="rounded-md border border-red-200 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-60"
                >
                  Huỷ lịch
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
