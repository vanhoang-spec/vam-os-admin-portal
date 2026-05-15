"use client";

import Link from "next/link";
import { useState } from "react";
import { useFormState } from "react-dom";
import { createEventAction, updateEventAction } from "@/app/actions/events";
import type { EventActionState } from "@/lib/event-action-types";
import { EVENT_TYPE_OPTIONS } from "@/lib/event-constants";
import type { Event, IntakeBatch, Season } from "@/lib/types";

const initialState: EventActionState = { ok: false, message: null };

function toLocalInputValue(value: string | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const tzOffset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - tzOffset).toISOString().slice(0, 16);
}

export function EventForm({
  mode,
  event,
  seasons,
  intakeBatches = [],
  defaultSeasonCode = "UEHM-S11"
}: {
  mode: "create" | "edit";
  event?: Event | null;
  seasons: Season[];
  /** Phase 045A: list of available intake batches for the selector. */
  intakeBatches?: IntakeBatch[];
  defaultSeasonCode?: string;
}) {
  const action = mode === "create" ? createEventAction : updateEventAction;
  const [state, formAction] = useFormState(action, initialState);

  const seasonsById = new Map(seasons.map((season) => [season.id, season]));
  const eventSeasonCode = event?.season_id ? seasonsById.get(event.season_id)?.code ?? "" : "";
  const seasonCodeDefault = mode === "edit" ? eventSeasonCode || defaultSeasonCode : defaultSeasonCode;

  const [capacityEnabled, setCapacityEnabled] = useState(event?.capacity_limit_enabled === true);
  const [windowEnabled, setWindowEnabled] = useState(event?.checkin_window_enabled === true);
  const [proofEnabled, setProofEnabled] = useState(event?.proof_required === true);
  const [questionEnabled, setQuestionEnabled] = useState(event?.question_collection_enabled === true);
  const [noShowEnabled, setNoShowEnabled] = useState(event?.no_show_policy_enabled === true);
  const [feeEnabled, setFeeEnabled] = useState(event?.fee_required === true);
  const [studentIdEnabled, setStudentIdEnabled] = useState(event?.show_student_id_field !== false);
  const [menteeCodeEnabled, setMenteeCodeEnabled] = useState(event?.show_mentee_code_field === true);
  // SF-1: track approval_required to show coupling hint
  const [approvalRequired, setApprovalRequired] = useState(event?.approval_required === true);

  return (
    <form action={formAction} className="grid gap-4">
      {mode === "edit" && event ? <input type="hidden" name="id" value={event.id} /> : null}

      {state.message ? (
        <div className={state.ok ? "rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700" : "rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"}>
          {state.message}
        </div>
      ) : null}

      <label className="block">
        <span className="text-xs font-medium uppercase text-slate-500">Tên sự kiện (*)</span>
        <input
          name="event_name"
          required
          defaultValue={event?.event_name ?? ""}
          className="mt-1 w-full rounded-md border border-vam-line bg-white px-3 py-2 text-sm text-vam-ink outline-none focus:border-vam-green focus:ring-2 focus:ring-vam-mint"
        />
      </label>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="text-xs font-medium uppercase text-slate-500">Loại sự kiện (*)</span>
          <select
            name="event_type"
            required
            defaultValue={(event?.event_type as string) ?? "training"}
            className="mt-1 w-full rounded-md border border-vam-line bg-white px-3 py-2 text-sm text-vam-ink outline-none focus:border-vam-green focus:ring-2 focus:ring-vam-mint"
          >
            {EVENT_TYPE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="text-xs font-medium uppercase text-slate-500">Mùa (*)</span>
          <select
            name="season_code"
            required
            defaultValue={seasonCodeDefault}
            className="mt-1 w-full rounded-md border border-vam-line bg-white px-3 py-2 text-sm text-vam-ink outline-none focus:border-vam-green focus:ring-2 focus:ring-vam-mint"
          >
            {seasons.map((season) => (
              <option key={season.id} value={season.code ?? ""}>{season.code ?? season.name ?? season.id}</option>
            ))}
          </select>
        </label>
      </div>

      {/* Phase 045A: cancelled badge in edit mode */}
      {mode === "edit" && event?.status === "cancelled" && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
          Sự kiện này đã bị hủy (status: cancelled).
        </div>
      )}

      {/* Phase 045A: intake_batch_id selector */}
      <label className="block">
        <span className="text-xs font-medium uppercase text-slate-500">Intake Batch (tuỳ chọn)</span>
        <select
          name="intake_batch_id"
          defaultValue={event?.intake_batch_id ?? ""}
          className="mt-1 w-full rounded-md border border-vam-line bg-white px-3 py-2 text-sm text-vam-ink outline-none focus:border-vam-green focus:ring-2 focus:ring-vam-mint"
        >
          <option value="">Không gắn batch cụ thể</option>
          {intakeBatches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.code ?? b.name ?? b.id}
              {b.name && b.code ? ` — ${b.name}` : ""}
            </option>
          ))}
        </select>
        <span className="mt-1 block text-[11px] text-slate-500">
          Chỉ chọn nếu sự kiện dành riêng cho một batch. Để trống nếu áp dụng cho cả mùa.
        </span>
      </label>

      <label className="block">
        <span className="text-xs font-medium uppercase text-slate-500">Thời điểm bắt đầu (*)</span>
        <input
          name="starts_at"
          type="datetime-local"
          required
          defaultValue={toLocalInputValue(event?.starts_at)}
          className="mt-1 w-full rounded-md border border-vam-line bg-white px-3 py-2 text-sm text-vam-ink outline-none focus:border-vam-green focus:ring-2 focus:ring-vam-mint"
        />
      </label>

      <label className="block">
        <span className="text-xs font-medium uppercase text-slate-500">Mã tham chiếu (legacy_event_temp_id)</span>
        <input
          name="legacy_event_temp_id"
          defaultValue={event?.legacy_event_temp_id ?? ""}
          placeholder="ví dụ: UEHM-S11-CLOSING"
          className="mt-1 w-full rounded-md border border-vam-line bg-white px-3 py-2 text-sm text-vam-ink outline-none focus:border-vam-green focus:ring-2 focus:ring-vam-mint"
        />
      </label>

      <label className="block">
        <span className="text-xs font-medium uppercase text-slate-500">Mô tả / Ghi chú (gồm địa điểm)</span>
        <textarea
          name="source_notes"
          rows={4}
          defaultValue={event?.source_notes ?? ""}
          placeholder="Mô tả nội dung, địa điểm, link tài liệu..."
          className="mt-1 w-full rounded-md border border-vam-line bg-white px-3 py-2 text-sm text-vam-ink outline-none focus:border-vam-green focus:ring-2 focus:ring-vam-mint"
        />
      </label>

      {/* --- CẤU HÌNH ĐĂNG KÝ & CHECK-IN --- */}
      <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-4">
        <h3 className="mb-4 font-semibold text-slate-800">Cấu hình Đăng ký & Check-in (Phase 2A)</h3>
        
        <div className="grid gap-4 sm:grid-cols-2 mb-4">
          <label className="flex items-start gap-2">
            <input type="checkbox" name="registration_required" value="true" defaultChecked={event?.registration_required === true} className="mt-1" />
            <div>
              <span className="text-sm font-medium">Bắt buộc đăng ký trước</span>
              <p className="text-xs text-slate-500">Người tham gia phải có đăng ký hợp lệ mới được check-in.</p>
            </div>
          </label>
          <label className="flex items-start gap-2">
            <input type="checkbox" name="approval_required" value="true" checked={approvalRequired} onChange={(e) => setApprovalRequired(e.target.checked)} className="mt-1" />
            <div>
              <span className="text-sm font-medium">Cần Admin phê duyệt</span>
              <p className="text-xs text-slate-500">Đăng ký mới sẽ ở trạng thái pending_review.</p>
              {approvalRequired && (
                <p className="mt-1 text-xs font-medium text-amber-700">⚠ Nên chọn chế độ Check-in &ldquo;Chỉ người đã xác nhận&rdquo; để chỉ cho check-in sau khi được duyệt.</p>
              )}
            </div>
          </label>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 mb-4">
          <label className="flex items-start gap-2">
            <input type="checkbox" name="allow_walk_in" value="true" defaultChecked={event?.allow_walk_in !== false} className="mt-1" />
            <div>
              <span className="text-sm font-medium">Cho phép Walk-in</span>
              <p className="text-xs text-slate-500">Cho phép người chưa đăng ký quét QR để tự check-in vào sự kiện.</p>
            </div>
          </label>
          <label className="block">
            <span className="text-sm font-medium">Chế độ Check-in</span>
            <select name="checkin_mode" defaultValue={event?.checkin_mode ?? "open"} className="mt-1 w-full rounded border px-3 py-1.5 text-sm">
              <option value="open">Mở (Open)</option>
              <option value="registration_required">Bắt buộc đăng ký (Registration Required)</option>
              <option value="confirmed_only">Chỉ người đã xác nhận (Confirmed Only)</option>
              <option value="manual_admin_only">Chỉ admin duyệt thủ công</option>
            </select>
          </label>
        </div>

        {/* Cấu hình giới hạn số lượng */}
        <div className="mb-4 border-t border-slate-200 pt-4">
          <label className="flex items-start gap-2 mb-2">
            <input type="checkbox" name="capacity_limit_enabled" value="true" checked={capacityEnabled} onChange={(e) => setCapacityEnabled(e.target.checked)} className="mt-1" />
            <span className="text-sm font-medium">Bật giới hạn số lượng tham gia</span>
          </label>
          {capacityEnabled && (
            <div className="ml-6 grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="text-xs text-slate-500">Số lượng tối đa</span>
                <input type="number" name="capacity_limit" defaultValue={event?.capacity_limit ?? ""} className="mt-1 w-full rounded border px-3 py-1.5 text-sm" />
              </label>
              <label className="flex items-center gap-2 mt-6">
                <input type="checkbox" name="waitlist_enabled" value="true" defaultChecked={event?.waitlist_enabled === true} />
                <span className="text-sm">Cho phép danh sách chờ (Waitlist) khi đầy</span>
              </label>
            </div>
          )}
        </div>

        {/* Khung giờ check-in */}
        <div className="mb-4 border-t border-slate-200 pt-4">
          <label className="flex items-start gap-2 mb-2">
            <input type="checkbox" name="checkin_window_enabled" value="true" checked={windowEnabled} onChange={(e) => setWindowEnabled(e.target.checked)} className="mt-1" />
            <span className="text-sm font-medium">Bật khung giờ check-in</span>
          </label>
          {windowEnabled && (
            <div className="ml-6 grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="text-xs text-slate-500">Mở check-in lúc</span>
                <input type="datetime-local" name="checkin_opens_at" defaultValue={toLocalInputValue(event?.checkin_opens_at)} className="mt-1 w-full rounded border px-3 py-1.5 text-sm" />
              </label>
              <label className="block">
                <span className="text-xs text-slate-500">Đóng check-in lúc</span>
                <input type="datetime-local" name="checkin_closes_at" defaultValue={toLocalInputValue(event?.checkin_closes_at)} className="mt-1 w-full rounded border px-3 py-1.5 text-sm" />
              </label>
            </div>
          )}
        </div>

        {/* Minh chứng */}
        <div className="mb-4 border-t border-slate-200 pt-4">
          <label className="flex items-start gap-2 mb-2">
            <input type="checkbox" name="proof_required" value="true" checked={proofEnabled} onChange={(e) => setProofEnabled(e.target.checked)} className="mt-1" />
            <span className="text-sm font-medium">Yêu cầu minh chứng (Screenshot, CV...)</span>
          </label>
          {proofEnabled && (
            <div className="ml-6 grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="text-xs text-slate-500">Nhãn hiển thị</span>
                <input type="text" name="proof_label" defaultValue={event?.proof_label ?? ""} placeholder="Ví dụ: Link CV / Ảnh chụp..." className="mt-1 w-full rounded border px-3 py-1.5 text-sm" />
              </label>
              <label className="block">
                <span className="text-xs text-slate-500">Mô tả / Hướng dẫn</span>
                <textarea name="proof_description" defaultValue={event?.proof_description ?? ""} rows={1} className="mt-1 w-full rounded border px-3 py-1.5 text-sm" />
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" name="proof_required_for_registration" value="true" defaultChecked={event?.proof_required_for_registration === true} />
                <span className="text-sm">Bắt buộc tải lên khi đăng ký</span>
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" name="proof_required_for_checkin" value="true" defaultChecked={event?.proof_required_for_checkin === true} />
                <span className="text-sm">Bắt buộc phải duyệt trước check-in</span>
              </label>
            </div>
          )}
        </div>

        {/* Học phí / Thanh toán */}
        <div className="mb-4 border-t border-slate-200 pt-4">
          <label className="flex items-start gap-2 mb-2">
            <input type="checkbox" name="fee_required" value="true" checked={feeEnabled} onChange={(e) => setFeeEnabled(e.target.checked)} className="mt-1" />
            <span className="text-sm font-medium">Thu phí tham dự</span>
          </label>
          {feeEnabled && (
            <div className="ml-6 grid gap-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="text-xs text-slate-500">Số tiền</span>
                  <input type="number" name="fee_amount" defaultValue={event?.fee_amount ?? ""} className="mt-1 w-full rounded border px-3 py-1.5 text-sm" />
                </label>
                <label className="block">
                  <span className="text-xs text-slate-500">Tiền tệ</span>
                  <input type="text" name="fee_currency" defaultValue={event?.fee_currency ?? "VND"} className="mt-1 w-full rounded border px-3 py-1.5 text-sm" />
                </label>
              </div>
              <label className="block">
                <span className="text-xs text-slate-500">Mô tả khoản phí</span>
                <textarea name="fee_description" defaultValue={event?.fee_description ?? ""} rows={1} className="mt-1 w-full rounded border px-3 py-1.5 text-sm" />
              </label>
              <label className="block">
                <span className="text-xs text-slate-500">Thông tin chuyển khoản (Bank/Momo/QR)</span>
                <textarea name="payment_instruction" defaultValue={event?.payment_instruction ?? ""} rows={2} className="mt-1 w-full rounded border px-3 py-1.5 text-sm" />
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" name="payment_proof_required" value="true" defaultChecked={event?.payment_proof_required === true} />
                <span className="text-sm">Bắt buộc tải ảnh minh chứng chuyển khoản</span>
              </label>
            </div>
          )}
        </div>

        {/* Câu hỏi & Chính sách */}
        <div className="mb-4 border-t border-slate-200 pt-4">
          <label className="flex items-start gap-2 mb-2">
            <input type="checkbox" name="question_collection_enabled" value="true" checked={questionEnabled} onChange={(e) => setQuestionEnabled(e.target.checked)} className="mt-1" />
            <span className="text-sm font-medium">Thu thập câu hỏi cho diễn giả</span>
          </label>
          {questionEnabled && (
            <div className="ml-6 mb-3 block">
              <span className="text-xs text-slate-500">Nhãn hiển thị</span>
              <input type="text" name="speaker_question_label" defaultValue={event?.speaker_question_label ?? ""} className="mt-1 w-full rounded border px-3 py-1.5 text-sm" />
            </div>
          )}

          <label className="flex items-start gap-2 mb-2 mt-4">
            <input type="checkbox" name="no_show_policy_enabled" value="true" checked={noShowEnabled} onChange={(e) => setNoShowEnabled(e.target.checked)} className="mt-1" />
            <span className="text-sm font-medium">Hiển thị cam kết / chính sách No-show</span>
          </label>
          {noShowEnabled && (
            <div className="ml-6 block">
              <span className="text-xs text-slate-500">Nội dung chính sách</span>
              <textarea name="no_show_policy_text" defaultValue={event?.no_show_policy_text ?? ""} rows={2} className="mt-1 w-full rounded border px-3 py-1.5 text-sm" />
            </div>
          )}
        </div>

        {/* Hiển thị trường thông tin Form */}
        <div className="border-t border-slate-200 pt-4">
          <h4 className="mb-2 text-sm font-semibold text-slate-700">Trường thông tin (Form)</h4>
          <div className="grid gap-4 sm:grid-cols-2 ml-2">
            <div className="space-y-2">
              <label className="flex items-center gap-2">
                <input type="checkbox" name="show_student_id_field" value="true" checked={studentIdEnabled} onChange={(e) => setStudentIdEnabled(e.target.checked)} />
                <span className="text-sm">Hiển thị MSSV</span>
              </label>
              {studentIdEnabled && (
                <label className="flex items-center gap-2 ml-6">
                  <input type="checkbox" name="student_id_required" value="true" defaultChecked={event?.student_id_required === true} />
                  <span className="text-sm text-slate-500">Bắt buộc nhập</span>
                </label>
              )}
              
              <label className="flex items-center gap-2 pt-2">
                <input type="checkbox" name="show_mentee_code_field" value="true" checked={menteeCodeEnabled} onChange={(e) => setMenteeCodeEnabled(e.target.checked)} />
                <span className="text-sm">Hiển thị Mentee Code</span>
              </label>
              {menteeCodeEnabled && (
                <label className="flex items-center gap-2 ml-6">
                  <input type="checkbox" name="mentee_code_required" value="true" defaultChecked={event?.mentee_code_required === true} />
                  <span className="text-sm text-slate-500">Bắt buộc nhập</span>
                </label>
              )}
            </div>
            
            <div className="space-y-2">
              <label className="flex items-center gap-2">
                <input type="checkbox" name="show_school_field" value="true" defaultChecked={event ? event.show_school_field !== false : true} />
                <span className="text-sm">Hiển thị Trường</span>
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" name="show_program_field" value="true" defaultChecked={event ? event.show_program_field !== false : true} />
                <span className="text-sm">Hiển thị Ngành học</span>
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" name="show_role_text_field" value="true" defaultChecked={event?.show_role_text_field === true} />
                <span className="text-sm">Hiển thị Vai trò</span>
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" name="show_notes_field" value="true" defaultChecked={event ? event.show_notes_field !== false : true} />
                <span className="text-sm">Hiển thị Ghi chú</span>
              </label>
            </div>
          </div>
          
          <label className="block mt-4">
            <span className="text-sm font-medium">Mô tả sự kiện (hiển thị trên form Public)</span>
            <textarea name="event_description" defaultValue={event?.event_description ?? ""} rows={3} className="mt-1 w-full rounded border px-3 py-2 text-sm" />
          </label>
        </div>

      </div>

      <div className="mt-2 flex flex-wrap gap-3">
        <button type="submit" className="inline-flex w-fit rounded-md bg-vam-green px-4 py-2 text-sm font-medium text-white hover:bg-vam-green/90">
          {mode === "create" ? "Tạo sự kiện" : "Lưu thay đổi"}
        </button>
        {state.ok && mode === "create" && state.createdEventId ? (
          <Link
            href={`/events/${state.createdEventId}/attendance`}
            className="inline-flex w-fit items-center justify-center rounded-md border border-vam-line bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Đi tới trang Quản lý tham gia
          </Link>
        ) : null}
        <Link
          href="/events"
          className="inline-flex w-fit items-center justify-center rounded-md border border-vam-line bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Quay lại danh sách
        </Link>
      </div>
    </form>
  );
}
