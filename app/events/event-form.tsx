"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useFormState } from "react-dom";
import { createEventAction, updateEventAction } from "@/app/actions/events";
import { InlineActionMessage, LoadingButton, useActionTiming } from "@/components/action-feedback";
import type { EventActionState } from "@/lib/event-action-types";
import { EVENT_TYPE_OPTIONS } from "@/lib/event-constants";
import {
  EVENT_FORMATS,
  EVENT_FORMAT_LABELS,
  isEventFormat,
  needsJoinUrl,
  needsVenue,
  type EventFormat
} from "@/lib/event-location";
import { toVietnamInputValue } from "@/lib/event-datetime";
import { VietnamDateTimeField } from "./vietnam-datetime-field";
import { RecurrenceFields } from "./recurrence-fields";
import type { Event, IntakeBatch, Season } from "@/lib/types";
import { SEASON_CONFIG } from "@/lib/season-config";

const initialState: EventActionState = { ok: false, message: null };

/**
 * Uy quyen cho lib/event-datetime.
 *
 * Ban cu dung getTimezoneOffset() cua may. Mot quan tri vien dang o nuoc ngoai
 * mo form sua se thay gio noi ho dung, sua mot cho khac, va luu de len gio that
 * cua su kien. Su kien dien ra o Viet Nam thi form phai noi gio Viet Nam.
 */
const toLocalInputValue = toVietnamInputValue;

export function EventForm({
  mode,
  event,
  seasons,
  intakeBatches = [],
  defaultSeasonCode = SEASON_CONFIG.CURRENT_OPERATING_SEASON_CODE
}: {
  mode: "create" | "edit";
  event?: Event | null;
  seasons: Season[];
  /** Phase 045A: list of available intake batches for the selector. */
  intakeBatches?: IntakeBatch[];
  defaultSeasonCode?: string;
}) {
  // Hình thức quyết định form hỏi địa chỉ hay hỏi đường dẫn phòng họp, nên nó
  // phải là state chứ không phải một ô select bình thường.
  // Hai ô thời gian là controlled vì phần xem trước lịch lặp phải đổi theo
  // ngay lúc gõ — danh sách ngày đứng yên trong khi người dùng đổi ngày là một
  // danh sách nói dối.
  const [startsAt, setStartsAt] = useState(toLocalInputValue(event?.starts_at));
  const [endsAt, setEndsAt] = useState(toLocalInputValue(event?.ends_at));

  const [format, setFormat] = useState<EventFormat>(
    isEventFormat(event?.event_format) ? event.event_format : "offline"
  );

  const action = mode === "create" ? createEventAction : updateEventAction;
  const [state, formAction] = useFormState(action, initialState);
  const timing = useActionTiming(mode === "create" ? "event.create" : "event.update", state);

  const seasonsById = new Map(seasons.map((season) => [season.id, season]));
  const eventSeasonCode = event?.season_id ? seasonsById.get(event.season_id)?.code ?? "" : "";
  const seasonCodeDefault = mode === "edit" ? eventSeasonCode || defaultSeasonCode : defaultSeasonCode;

  const [capacityEnabled, setCapacityEnabled] = useState(event?.capacity_limit_enabled === true);
  const [windowEnabled, setWindowEnabled] = useState(event?.checkin_window_enabled === true);
  const [proofEnabled, setProofEnabled] = useState(event?.proof_required === true);
  const [questionEnabled, setQuestionEnabled] = useState(event?.question_collection_enabled === true);
  const [noShowEnabled, setNoShowEnabled] = useState(event?.no_show_policy_enabled === true);
  const [feeEnabled, setFeeEnabled] = useState(event?.fee_required === true);
  const [mealOptionEnabled, setMealOptionEnabled] = useState(event?.meal_option_enabled === true);
  const [studentIdEnabled, setStudentIdEnabled] = useState(event?.show_student_id_field !== false);
  const [menteeCodeEnabled, setMenteeCodeEnabled] = useState(event?.show_mentee_code_field === true);
  // SF-1: track approval_required to show coupling hint
  const [approvalRequired, setApprovalRequired] = useState(event?.approval_required === true);

  // Track save success independently of useFormState, which can be reset by
  // revalidatePath('/events/[id]/edit') triggering a Next.js router refresh.
  // Rule: set true on ok=true; clear only when there is an explicit error message
  // (state reset to {ok:false, message:null} must NOT clear the banner).
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (state.ok && mode === "edit") {
      setSaved(true);
    } else if (!state.ok && state.message !== null) {
      // An actual server error arrived — hide the stale success banner.
      setSaved(false);
    }
  }, [state.ok, state.message, mode]);

  return (
    <form action={formAction} onSubmit={timing.markSubmitStart} className="grid gap-4">
      {mode === "edit" && event ? <input type="hidden" name="id" value={event.id} /> : null}

      <InlineActionMessage
        state={state}
        successFallback={mode === "create" ? "Đã tạo sự kiện." : "Đã lưu thay đổi sự kiện."}
        errorFallback="Không thể lưu sự kiện. Vui lòng thử lại."
        showSavedAt={mode === "edit"}
      />

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
        <span className="text-xs font-medium uppercase text-slate-500">Đợt tuyển (tuỳ chọn)</span>
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

      <VietnamDateTimeField
        name="starts_at"
        label="Thời điểm bắt đầu"
        required
        defaultValue={event?.starts_at ?? null}
        onChange={setStartsAt}
      />

      <VietnamDateTimeField
        name="ends_at"
        label="Thời điểm kết thúc"
        defaultValue={event?.ends_at ?? null}
        helper="Để trống nếu chưa chốt. Người tham dự sẽ chỉ thấy giờ bắt đầu."
        onChange={setEndsAt}
      />

      {/* --- HÌNH THỨC & ĐỊA ĐIỂM --- */}
      <div className="rounded-md border border-slate-200 bg-slate-50 p-4">
        <h3 className="mb-3 font-semibold text-slate-800">Hình thức và địa điểm</h3>

        <fieldset className="mb-4">
          <legend className="text-xs font-medium uppercase text-slate-500">Hình thức tổ chức</legend>
          <div className="mt-2 flex flex-wrap gap-3">
            {EVENT_FORMATS.map((value) => (
              <label key={value} className="flex items-center gap-2 text-sm text-vam-ink">
                <input
                  type="radio"
                  name="event_format"
                  value={value}
                  checked={format === value}
                  onChange={() => setFormat(value)}
                  className="h-4 w-4 border-slate-300 text-vam-green focus:ring-vam-green"
                />
                {EVENT_FORMAT_LABELS[value]}
              </label>
            ))}
          </div>
        </fieldset>

        {needsVenue(format) ? (
          <div className="flex flex-col gap-3">
            <label className="block">
              <span className="text-xs font-medium uppercase text-slate-500">Tên địa điểm</span>
              <input
                name="location_name"
                defaultValue={event?.location_name ?? ""}
                placeholder="ví dụ: Hội trường A, cơ sở B"
                className="mt-1 w-full rounded-md border border-vam-line bg-white px-3 py-2 text-sm text-vam-ink outline-none focus:border-vam-green focus:ring-2 focus:ring-vam-mint"
              />
            </label>

            <label className="block">
              <span className="text-xs font-medium uppercase text-slate-500">Địa chỉ</span>
              <input
                name="location_address"
                defaultValue={event?.location_address ?? ""}
                placeholder="ví dụ: 59C Nguyễn Đình Chiểu, Quận 3, TP.HCM"
                className="mt-1 w-full rounded-md border border-vam-line bg-white px-3 py-2 text-sm text-vam-ink outline-none focus:border-vam-green focus:ring-2 focus:ring-vam-mint"
              />
              <span className="mt-1 block text-[11px] text-slate-500">
                Hệ thống tự dựng đường dẫn Google Maps từ địa chỉ này và gửi kèm trong thư mời.
              </span>
            </label>

            <label className="block">
              <span className="text-xs font-medium uppercase text-slate-500">
                Đường dẫn Google Maps (tuỳ chọn)
              </span>
              <input
                name="location_map_url"
                type="url"
                defaultValue={event?.location_map_url ?? ""}
                placeholder="https://maps.app.goo.gl/..."
                className="mt-1 w-full rounded-md border border-vam-line bg-white px-3 py-2 text-sm text-vam-ink outline-none focus:border-vam-green focus:ring-2 focus:ring-vam-mint"
              />
              <span className="mt-1 block text-[11px] text-slate-500">
                Chỉ cần khi địa chỉ ở trên không trỏ đúng chỗ trên bản đồ. Đường dẫn này được gửi
                cho người tham dự, nên hệ thống chỉ nhận đường dẫn Google Maps.
              </span>
            </label>
          </div>
        ) : null}

        {needsJoinUrl(format) ? (
          <label className="mt-3 block">
            <span className="text-xs font-medium uppercase text-slate-500">
              Đường dẫn tham gia trực tuyến <span className="text-red-600">*</span>
            </span>
            <span className="mt-0.5 block text-xs font-normal normal-case text-slate-500">
              Bắt buộc với buổi trực tuyến. Thư xác nhận gửi cho người đăng ký lấy đường dẫn từ ô này.
            </span>
            <input
              name="online_join_url"
              type="url"
              required
              defaultValue={event?.online_join_url ?? ""}
              placeholder="https://meet.google.com/..."
              className="mt-1 w-full rounded-md border border-vam-line bg-white px-3 py-2 text-sm text-vam-ink outline-none focus:border-vam-green focus:ring-2 focus:ring-vam-mint"
            />
          </label>
        ) : null}
      </div>

      <label className="block">
        <span className="text-xs font-medium uppercase text-slate-500">Mã tham chiếu (legacy_event_temp_id)</span>
        <input
          name="legacy_event_temp_id"
          defaultValue={event?.legacy_event_temp_id ?? ""}
          placeholder="ví dụ: UEHM-S12-CLOSING"
          className="mt-1 w-full rounded-md border border-vam-line bg-white px-3 py-2 text-sm text-vam-ink outline-none focus:border-vam-green focus:ring-2 focus:ring-vam-mint"
        />
      </label>

      <label className="block">
        <span className="text-xs font-medium uppercase text-slate-500">Mô tả / Ghi chú</span>
        <textarea
          name="source_notes"
          rows={4}
          defaultValue={event?.source_notes ?? ""}
          placeholder="Mô tả nội dung, link tài liệu..."
          className="mt-1 w-full rounded-md border border-vam-line bg-white px-3 py-2 text-sm text-vam-ink outline-none focus:border-vam-green focus:ring-2 focus:ring-vam-mint"
        />
      </label>

      {mode === "create" ? <RecurrenceFields startsAt={startsAt} endsAt={endsAt} /> : null}

      {event?.series_id ? (
        <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
          Buổi {event.series_index}/{event.series_total} của một chuỗi lặp lại. Thay đổi ở đây chỉ
          áp dụng cho buổi này.
        </p>
      ) : null}

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
              <span className="text-sm font-medium">Cho phép vãng lai</span>
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

        {/* Luôn hiện, ở cả form tạo lẫn form sửa: action đọc ô này bằng
            formData.has(), nên một form thiếu ô này sẽ âm thầm tắt QR. */}
        <label className="mb-4 flex items-start gap-2 rounded-md border border-slate-200 bg-white px-3 py-2">
          <input
            type="checkbox"
            name="qr_checkin_enabled"
            value="true"
            defaultChecked={event?.qr_checkin_enabled !== false}
            className="mt-1"
          />
          <div>
            <span className="text-sm font-medium">Dùng mã QR check-in</span>
            <p className="text-xs text-slate-500">
              Bật: mỗi người đăng ký nhận mã QR cá nhân trong thư xác nhận để quét ở cửa. Tắt: thư xác
              nhận không kèm mã QR, ban tổ chức điểm danh thủ công theo danh sách. Mã đã gửi trước đó vẫn
              quét được.
            </p>
          </div>
        </label>

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
                <VietnamDateTimeField name="checkin_opens_at" label="Mở check-in từ" defaultValue={event?.checkin_opens_at ?? null} />
              </label>
              <label className="block">
                <span className="text-xs text-slate-500">Đóng check-in lúc</span>
                <VietnamDateTimeField name="checkin_closes_at" label="Đóng check-in lúc" defaultValue={event?.checkin_closes_at ?? null} />
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

        {/* Tuỳ chọn bữa trưa / Meal add-on (Phase 2B) */}
        <div className="mb-4 border-t border-slate-200 pt-4">
          <label className="flex items-start gap-2 mb-2">
            <input type="checkbox" name="meal_option_enabled" value="true" checked={mealOptionEnabled} onChange={(e) => setMealOptionEnabled(e.target.checked)} className="mt-1" />
            <span className="text-sm font-medium">Bật tuỳ chọn bữa trưa / meal add-on</span>
          </label>
          {mealOptionEnabled && (
            <div className="ml-6 grid gap-4">
              <label className="block">
                <span className="text-xs text-slate-500">Nhãn hiển thị (ví dụ: Cơm trưa)</span>
                <input type="text" name="meal_label" defaultValue={event?.meal_label ?? ""} className="mt-1 w-full rounded border px-3 py-1.5 text-sm" />
              </label>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="text-xs text-slate-500">Phí bữa trưa</span>
                  <input type="number" name="meal_fee_amount" defaultValue={event?.meal_fee_amount ?? ""} className="mt-1 w-full rounded border px-3 py-1.5 text-sm" />
                </label>
                <label className="block">
                  <span className="text-xs text-slate-500">Tiền tệ</span>
                  <input type="text" name="meal_fee_currency" defaultValue={event?.meal_fee_currency ?? "VND"} className="mt-1 w-full rounded border px-3 py-1.5 text-sm" />
                </label>
              </div>
              <label className="block">
                <span className="text-xs text-slate-500">Thông tin chuyển khoản bữa trưa</span>
                <textarea name="meal_payment_instruction" defaultValue={event?.meal_payment_instruction ?? ""} rows={2} className="mt-1 w-full rounded border px-3 py-1.5 text-sm" />
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" name="meal_payment_proof_required" value="true" defaultChecked={event?.meal_payment_proof_required !== false} />
                <span className="text-sm">Bắt buộc minh chứng chuyển khoản khi chọn bữa trưa</span>
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

      {saved && !state.message ? (
        <div className="mt-4 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm font-medium text-green-700">
          Đã lưu thay đổi sự kiện thành công.
        </div>
      ) : null}

      <div className="mt-2 flex flex-wrap gap-3">
        <LoadingButton pendingLabel={mode === "create" ? "Đang tạo..." : "Đang lưu..."} className="w-fit rounded-md bg-vam-green px-4 py-2 text-sm font-medium text-white hover:bg-vam-green/90">
          {mode === "create" ? "Tạo sự kiện" : "Lưu thay đổi"}
        </LoadingButton>
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
