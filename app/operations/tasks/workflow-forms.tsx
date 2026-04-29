"use client";

import { useFormState } from "react-dom";
import {
  addActionItemCommentAction,
  createActionItemAction,
  generateMonthlyFollowupAction,
  updateActionItemAction,
  type WorkflowActionState
} from "@/app/actions/workflow";
import type { WorkflowOwner } from "@/lib/types";

const initialState: WorkflowActionState = { ok: false, message: null };

function ActionMessage({ state }: { state: WorkflowActionState }) {
  if (!state.message) return null;
  return (
    <div className={state.ok ? "rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700" : "rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"}>
      {state.message}
    </div>
  );
}

const inputClass = "mt-1 w-full rounded-md border border-vam-line bg-white px-3 py-2 text-sm text-vam-ink outline-none focus:border-vam-green focus:ring-2 focus:ring-vam-mint";
const buttonClass = "inline-flex rounded-md bg-vam-green px-3 py-2 text-sm font-medium text-white hover:bg-vam-green/90";
const quietButtonClass = "inline-flex rounded-md border border-vam-line px-3 py-2 text-sm font-medium text-vam-green hover:bg-vam-mint";

export function GenerateFollowupForm({ selectedMonth }: { selectedMonth: string }) {
  const [state, formAction] = useFormState(generateMonthlyFollowupAction, initialState);
  return (
    <form action={formAction} className="grid gap-3 rounded-md border border-vam-line bg-slate-50 p-3">
      <input type="hidden" name="selected_month" value={selectedMonth} />
      <ActionMessage state={state} />
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <div className="text-xs font-medium uppercase text-slate-500">Tháng kiểm tra</div>
          <div className="text-sm font-semibold text-vam-ink">{selectedMonth}</div>
        </div>
        <button type="submit" className={buttonClass}>
          Tạo danh sách follow-up tháng
        </button>
      </div>
    </form>
  );
}

export function CreateActionItemForm({ owners, canManage }: { owners: WorkflowOwner[]; canManage: boolean }) {
  const [state, formAction] = useFormState(createActionItemAction, initialState);
  if (!canManage) return null;
  return (
    <form action={formAction} className="grid gap-3 rounded-md border border-vam-line bg-white p-3">
      <ActionMessage state={state} />
      <div className="grid gap-3 md:grid-cols-2">
        <label className="block">
          <span className="text-xs font-medium uppercase text-slate-500">Tiêu đề</span>
          <input name="title" required className={inputClass} placeholder="Việc cần xử lý" />
        </label>
        <label className="block">
          <span className="text-xs font-medium uppercase text-slate-500">Loại công việc</span>
          <select name="action_type" defaultValue="manual_task" className={inputClass}>
            <option value="manual_task">Việc thủ công</option>
            <option value="data_issue">Lỗi dữ liệu</option>
            <option value="correction_request">Yêu cầu chỉnh sửa</option>
            <option value="event_attendance_issue">Lỗi điểm danh event</option>
          </select>
        </label>
        <label className="block">
          <span className="text-xs font-medium uppercase text-slate-500">Mức độ ưu tiên</span>
          <select name="priority" defaultValue="medium" className={inputClass}>
            <option value="low">Thấp</option>
            <option value="medium">Vừa</option>
            <option value="high">Cao</option>
            <option value="urgent">Khẩn cấp</option>
          </select>
        </label>
        <label className="block">
          <span className="text-xs font-medium uppercase text-slate-500">Người phụ trách</span>
          <select name="owner_admin_user_id" defaultValue="" className={inputClass}>
            <option value="">Chưa gán</option>
            {owners.map((owner) => (
              <option key={owner.id} value={owner.id}>
                {owner.full_name || owner.email}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-xs font-medium uppercase text-slate-500">Hạn xử lý</span>
          <input name="due_date" type="date" className={inputClass} />
        </label>
      </div>
      <label className="block">
        <span className="text-xs font-medium uppercase text-slate-500">Mô tả</span>
        <textarea name="description" rows={3} className={inputClass} placeholder="Bối cảnh và bước xử lý tiếp theo" />
      </label>
      <button type="submit" className={buttonClass}>
        Tạo công việc
      </button>
    </form>
  );
}

export function UpdateActionItemForm({ id, owners, canManage }: { id: string; owners: WorkflowOwner[]; canManage: boolean }) {
  const [state, formAction] = useFormState(updateActionItemAction, initialState);
  if (!canManage) return null;
  return (
    <form action={formAction} className="grid gap-2">
      <input type="hidden" name="id" value={id} />
      <ActionMessage state={state} />
      <div className="grid gap-2 sm:grid-cols-2">
        <select name="status" defaultValue="" className={inputClass}>
          <option value="">Giữ trạng thái</option>
          <option value="open">Đang mở</option>
          <option value="in_progress">Đang xử lý</option>
          <option value="resolved">Đã xử lý</option>
          <option value="dropped">Đã dừng tham gia</option>
          <option value="no_response">Không phản hồi</option>
          <option value="parked">Tạm để sau</option>
        </select>
        <select name="owner_admin_user_id" defaultValue="" className={inputClass}>
          <option value="">Giữ người phụ trách</option>
          {owners.map((owner) => (
            <option key={owner.id} value={owner.id}>
              {owner.full_name || owner.email}
            </option>
          ))}
        </select>
      </div>
      <button type="submit" className={quietButtonClass}>
        Cập nhật
      </button>
    </form>
  );
}

export function AddCommentForm({ id, canManage }: { id: string; canManage: boolean }) {
  const [state, formAction] = useFormState(addActionItemCommentAction, initialState);
  if (!canManage) return null;
  return (
    <form action={formAction} className="grid gap-2">
      <input type="hidden" name="id" value={id} />
      <ActionMessage state={state} />
      <textarea name="comment_text" required rows={2} className={inputClass} placeholder="Ghi chú nội bộ" />
      <button type="submit" className={quietButtonClass}>
        Thêm ghi chú
      </button>
    </form>
  );
}
