"use client";

// React 18.3.1: useFormState của react-dom — hook thay thế của React 19 qua
// được cả bốn cổng rồi mới vỡ trắng trang lúc chạy, nên cấm dùng ở đây.
import { useFormState, useFormStatus } from "react-dom";
import { matchMentorAtHourAction } from "@/app/actions/interview-schedule";
import { INITIAL_MATCH_STATE } from "@/lib/interview-schedule-action-types";
import type { WaitingDayGroup } from "@/lib/interview-schedule-core";

/**
 * Chiều ngược: mentor đã tự khai giờ rảnh, ở đây interviewer bấm ghép.
 *
 * Nút không mang tên ai — chỉ mang khung giờ. Người được ghép do database chọn
 * (ai khai giờ đó sớm nhất), nên hai interviewer bấm cùng lúc không thể cùng
 * nhắm vào một người, và không ai chọn mặt gửi vàng được.
 *
 * Bấm là CHỐT: buổi hẹn có thật ngay, ba lá thư đi ngay. Vì vậy có một bước
 * xác nhận trước khi gửi — cùng lý do nút Huỷ lịch phải qua hộp thoại.
 */

function HourButtons({ waiting }: { waiting: WaitingDayGroup[] }) {
  const { pending } = useFormStatus();
  return (
    <div className="grid gap-3">
      {waiting.map((day) => (
        <div key={day.dateKey} className="rounded-lg border border-vam-line bg-white p-3">
          <p className="text-sm font-semibold text-vam-ink">{day.label}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {day.hours.map((hour) => (
              <button
                key={hour.startsAtIso}
                type="submit"
                name="slotStartsAt"
                value={hour.startsAtIso}
                disabled={pending}
                className="rounded-md border border-vam-green bg-vam-mint/40 px-2.5 py-2 text-sm text-vam-ink disabled:opacity-60"
              >
                {String(hour.hour).padStart(2, "0")}h ·{" "}
                <strong className="font-semibold">{hour.waitingCount} chờ</strong>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function WaitingPanel({
  waiting,
  waitingTotal
}: {
  waiting: WaitingDayGroup[];
  waitingTotal: number;
}) {
  const [state, formAction] = useFormState(matchMentorAtHourAction, INITIAL_MATCH_STATE);

  if (waiting.length === 0) {
    return (
      <p className="text-sm text-slate-600">
        Chưa có mentor nào tự khai giờ rảnh. Khi có, khung giờ họ chờ sẽ hiện ở đây để anh/chị bấm ghép.
      </p>
    );
  }

  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        if (
          !window.confirm(
            "Ghép người khai giờ này sớm nhất vào khung giờ đã chọn? Buổi hẹn được chốt ngay và thư xác nhận gửi luôn cho cả hai bên."
          )
        ) {
          event.preventDefault();
        }
      }}
      className="grid gap-3"
    >
      <p className="text-sm text-vam-ink">
        Có <strong>{waitingTotal} mentor</strong> đã tự khai giờ rảnh và đang chờ được ghép. Bấm vào một khung giờ
        để ghép người khai sớm nhất — hệ thống tự mở giờ đó cho anh/chị, không cần đăng trước.
      </p>

      {state.status !== "idle" ? (
        <p
          role={state.status === "error" ? "alert" : "status"}
          className={`rounded-md border px-3 py-2 text-sm ${
            state.status === "error"
              ? "border-red-200 bg-red-50 text-red-800"
              : "border-vam-green/40 bg-vam-mint/40 text-vam-ink"
          }`}
        >
          {state.message}
        </p>
      ) : null}

      <HourButtons waiting={waiting} />
    </form>
  );
}
