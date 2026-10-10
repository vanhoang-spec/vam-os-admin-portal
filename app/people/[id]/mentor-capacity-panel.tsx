"use client";

// useFormState của react-dom, không phải useActionState: dự án chạy React 18.3.1 — xem CLAUDE.md.
import { useFormState, useFormStatus } from "react-dom";
import type { MentorCapacityActionState } from "@/app/actions/mentor-capacity";
import type { MentorCapacityView } from "@/lib/mentor-capacity";

const IDLE: MentorCapacityActionState = { status: "idle", message: null };

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md bg-vam-green px-3 py-2 text-sm font-medium text-white hover:bg-vam-green/90 disabled:opacity-60"
    >
      {pending ? "Đang lưu…" : "Lưu"}
    </button>
  );
}

/**
 * Khung "Số mentee tối đa" trên hồ sơ mentor (BTC 10/10/2026): ai mở hồ sơ cũng thấy
 * trần của mùa, đang nhận bao nhiêu, còn bao nhiêu chỗ; Core team trở lên có ô sửa.
 *
 * Ô nhập chỉ là tiện dụng — cận dưới (số đang nhận) và cận trên do máy chủ và hàm
 * vam116_set_mentor_capacity kiểm lại, vì giá trị của ô là thứ người gửi tự đặt được.
 */
export function MentorCapacityPanel({
  action,
  seasonLabel,
  view,
  expected,
  canEdit,
  lockedReason,
  max,
  round2Cap
}: {
  action: (previous: MentorCapacityActionState, formData: FormData) => Promise<MentorCapacityActionState>;
  seasonLabel: string;
  view: MentorCapacityView;
  /** Giá trị đang lưu, gửi kèm để database từ chối khi người khác vừa đổi. null = chưa khai. */
  expected: number | null;
  canEdit: boolean;
  /** Vì sao người có quyền vẫn chưa sửa được (vd. chưa là mentor của mùa). */
  lockedReason?: string | null;
  max: number;
  round2Cap: number;
}) {
  const [state, formAction] = useFormState(action, IDLE);
  const floor = Math.max(1, view.active);

  return (
    <div className="rounded-md border border-vam-line bg-slate-50 px-3 py-2" data-testid="mentor-capacity">
      <div className="text-xs font-medium uppercase text-slate-500">Số mentee tối đa mùa {seasonLabel}</div>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-2xl font-semibold text-vam-ink" data-testid="mentor-capacity-value">{view.effective}</span>
        <span className="text-sm text-slate-600" data-testid="mentor-capacity-usage">
          Đang nhận {view.active} · còn {view.remaining} chỗ
        </span>
      </div>
      {view.declared === null ? (
        <p className="mt-1 text-xs text-amber-700" data-testid="mentor-capacity-default">
          Mentor chưa khai số này — hệ thống đang tính mặc định {view.effective}.
        </p>
      ) : null}
      {view.effective > round2Cap ? (
        <p className="mt-1 text-xs text-slate-500">
          Ở Vòng 2 ghép cặp, mỗi mentor tự chọn tối đa {round2Cap} mentee dù số này lớn hơn.
        </p>
      ) : null}

      {canEdit ? (
        // key theo giá trị đang lưu: lưu xong trang tải lại số mới thì ô nhập cũng về số mới.
        <form action={formAction} key={expected ?? "chua-khai"} className="mt-3 flex flex-wrap items-end gap-2" data-testid="mentor-capacity-form">
          <input type="hidden" name="expected" value={expected ?? ""} />
          <label className="block">
            <span className="text-xs font-medium text-slate-600">Đổi thành</span>
            <input
              name="capacity"
              type="number"
              inputMode="numeric"
              required
              min={floor}
              max={max}
              step={1}
              defaultValue={Math.min(max, Math.max(floor, view.effective))}
              className="mt-1 block w-24 rounded-md border border-vam-line bg-white px-3 py-2 text-sm text-vam-ink outline-none focus:border-vam-green focus:ring-2 focus:ring-vam-mint"
            />
          </label>
          <SaveButton />
          <p className="w-full text-xs text-slate-500">
            Từ {floor} đến {max}. Không đặt thấp hơn số mentee mentor đang nhận; muốn hạ thì huỷ cặp ở trang Ghép cặp trước.
          </p>
        </form>
      ) : lockedReason ? (
        <p className="mt-2 text-xs text-slate-500" data-testid="mentor-capacity-locked">{lockedReason}</p>
      ) : null}

      {state.status !== "idle" && state.message ? (
        <p role="status" className={`mt-2 text-sm ${state.status === "ok" ? "text-green-700" : "text-red-600"}`} data-testid="mentor-capacity-message">
          {state.message}
        </p>
      ) : null}
    </div>
  );
}
