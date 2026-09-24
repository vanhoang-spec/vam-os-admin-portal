import { Card, EmptyState, KpiCard, PageHeader } from "@/components/ui";
import { getSessionAdminData } from "@/lib/mentee-session-admin";
import { BulkPanel, SessionRowForm } from "./session-config-client";

/**
 * Cấu hình 12 ca phỏng vấn mentee — ngày 3 và 4/10/2026.
 *
 * 12 ca sinh ra với số ghế để trống, và để trống nghĩa là ĐÓNG: chưa điền số
 * thì không ứng viên nào đặt được. Trang này là chỗ điền số đó.
 *
 * Phép kiểm quyền nằm trong lib/mentee-session-admin.ts, chạy cho cả lượt đọc
 * lẫn mọi lượt ghi — trang chỉ vẽ lại câu từ chối.
 */

export const dynamic = "force-dynamic";

export default async function MenteeSessionConfigPage() {
  const data = await getSessionAdminData();

  if (!data.ok) {
    return (
      <div className="grid gap-4">
        <PageHeader title="Ca phỏng vấn mentee" />
        <Card>
          <EmptyState message={data.message} />
        </Card>
      </div>
    );
  }

  const chuaDienGhe = data.totals.sessions - data.totals.configured;

  return (
    <div className="grid gap-4">
      <PageHeader
        title="Ca phỏng vấn mentee"
        description="12 ca ngày 03 và 04/10/2026. Ứng viên chọn một ca; ban tổ chức phân mentor tại chỗ."
      />

      <div className="grid gap-3 sm:grid-cols-4">
        <KpiCard label="Ca đã điền ghế" value={`${data.totals.configured}/${data.totals.sessions}`} />
        <KpiCard label="Tổng số ghế" value={String(data.totals.seats)} />
        <KpiCard label="Đã giữ chỗ" value={String(data.totals.booked)} />
        <KpiCard label="Còn trống" value={String(Math.max(0, data.totals.seats - data.totals.booked))} />
      </div>

      {chuaDienGhe > 0 ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <strong>{chuaDienGhe} ca chưa điền số ghế.</strong> Ca chưa điền thì ứng viên mở link ra
          thấy “Chưa mở” và không đặt được — đây là chủ ý, để một ô bị quên không biến thành một ca
          nhận vô hạn người. Điền số vào là ca mở ngay.
        </div>
      ) : null}

      <Card>
        <h2 className="mb-3 text-base font-semibold text-vam-ink">Điền nhanh cho cả 12 ca</h2>
        <BulkPanel />
      </Card>

      {data.deadlineLabel ? (
        <p className="text-xs text-slate-500">
          Hạn ứng viên đăng ký: <strong>{data.deadlineLabel}</strong>. Cần gia hạn thì sửa cột
          <code className="mx-1 rounded bg-slate-100 px-1">booking_closes_at</code>
          của bảng <code className="rounded bg-slate-100 px-1">interview_sessions</code>.
        </p>
      ) : null}

      {data.days.map((day) => (
        <Card key={day.dateKey}>
          <h2 className="text-base font-semibold text-vam-ink">{day.label}</h2>
          <div className="mt-1">
            {day.rows.map((row) => (
              <SessionRowForm key={row.id} row={row} />
            ))}
          </div>
        </Card>
      ))}
    </div>
  );
}
