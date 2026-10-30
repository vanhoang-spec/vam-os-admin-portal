"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Card } from "@/components/ui";
import type { CustomFormAdminResult } from "@/lib/custom-form-action-types";
import {
  BRANCH_END,
  CHOICE_TYPES,
  CUSTOM_FORM_FIELD_TYPES,
  CUSTOM_FORM_STATUS_LABELS,
  CUSTOM_FORMS_PATH,
  FIELD_TYPE_LABELS,
  isQuestion,
  newFieldId,
  type CustomFormField,
  type CustomFormFieldType,
  type CustomFormStatus
} from "@/lib/custom-form-core";
import { combineVietnamDateTime, maskVietnamDate, maskVietnamTime, splitVietnamDateTime } from "@/lib/event-datetime";
import { createEventForFormAction, saveCustomFormAction, sendCustomFormReceiptTestAction, setCustomFormStatusAction } from "../actions";
import { formatDateTime } from "@/lib/utils";

const BOX =
  "w-full rounded-md border border-vam-line bg-white px-3 py-2 text-sm text-vam-ink outline-none focus:border-vam-green focus:ring-2 focus:ring-vam-mint";
const SMALL_BUTTON = "rounded-md border border-vam-line bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40";

type EditableField = CustomFormField & { optionsText: string };

export type BuilderForm = {
  id: string;
  publicCode: string;
  title: string;
  description: string;
  programId: string | null;
  status: CustomFormStatus;
  opensAt: string | null;
  closesAt: string | null;
  thankYou: string;
  onePerEmail: boolean;
  autoReply: boolean;
  autoReplySubject: string;
  autoReplyBody: string;
  fields: CustomFormField[];
  /** Sự kiện liên kết (VAM00008). */
  eventId: string | null;
  registrationLimit: number | null;
  /** Chỉ nhận người đã có trên hệ thống (VAM00009). */
  requireKnownPerson: boolean;
  themeColor: string | null;
};

export type BuilderEvent = { id: string; name: string; startsAt: string | null; capacity: number | null; status: string; blocker: string | null };

const toEditable = (f: CustomFormField): EditableField => ({ ...f, optionsText: f.options.join("\n") });
const lines = (value: string) => value.split("\n").map((l) => l.trim()).filter(Boolean);

/**
 * Trình tạo form (BTC 15/10/2026). Mọi thay đổi chỉ nằm trên trang cho tới khi bấm "Lưu form"; máy
 * chủ kiểm lại toàn bộ khi lưu. Form đã có câu trả lời thì câu hỏi cũ không xoá / không đổi loại được
 * (chỉ ẩn) — trang khoá sẵn những nút đó và máy chủ cũng từ chối, để dữ liệu cũ không lệch cột.
 */
export function FormBuilder({
  form,
  programs,
  events: initialEvents = [],
  responseCount,
  publicUrl
}: {
  form: BuilderForm;
  programs: Array<{ id: string; name: string }>;
  events?: BuilderEvent[];
  responseCount: number;
  publicUrl: string;
}) {
  const router = useRouter();
  const opens = splitVietnamDateTime(form.opensAt);
  const closes = splitVietnamDateTime(form.closesAt);
  const [title, setTitle] = useState(form.title);
  const [description, setDescription] = useState(form.description);
  const [programId, setProgramId] = useState(form.programId ?? "");
  const [thankYou, setThankYou] = useState(form.thankYou);
  const [eventId, setEventId] = useState(form.eventId ?? "");
  const [registrationLimit, setRegistrationLimit] = useState(form.registrationLimit === null ? "" : String(form.registrationLimit));
  const [requireKnownPerson, setRequireKnownPerson] = useState(form.requireKnownPerson);
  const [themeColor, setThemeColor] = useState(form.themeColor ?? "");
  const [events, setEvents] = useState<BuilderEvent[]>(initialEvents);
  const [quickOpen, setQuickOpen] = useState(false);
  const [quickName, setQuickName] = useState("");
  const [quickDate, setQuickDate] = useState("");
  const [quickTime, setQuickTime] = useState("");
  const [quickPlace, setQuickPlace] = useState("");
  const [quickCapacity, setQuickCapacity] = useState("");
  const [onePerEmail, setOnePerEmail] = useState(form.onePerEmail);
  const [autoReply, setAutoReply] = useState(form.autoReply);
  const [autoReplySubject, setAutoReplySubject] = useState(form.autoReplySubject);
  const [autoReplyBody, setAutoReplyBody] = useState(form.autoReplyBody);
  const [opensDate, setOpensDate] = useState(opens.date);
  const [opensTime, setOpensTime] = useState(opens.time);
  const [closesDate, setClosesDate] = useState(closes.date);
  const [closesTime, setClosesTime] = useState(closes.time);
  const [fields, setFields] = useState<EditableField[]>(() => form.fields.map(toEditable));
  const [status, setStatus] = useState<CustomFormStatus>(form.status);
  const [newType, setNewType] = useState<CustomFormFieldType>("short_text");
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<{ ok: boolean; message: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const locked = responseCount > 0;
  // Số thứ tự chỉ đếm câu hỏi: khối tiêu đề và ngắt trang không chiếm số.
  const questionNumber = useMemo(() => {
    const out = new Map<string, number>();
    for (const f of fields) if (isQuestion(f)) out.set(f.id, out.size + 1);
    return out;
  }, [fields]);
  // Câu hỏi đã có câu trả lời: theo bản đã lưu lúc mở trang.
  const lockedIds = useMemo(() => new Set(locked ? form.fields.filter(isQuestion).map((f) => f.id) : []), [locked, form.fields]);
  const lockedOptions = useMemo(() => new Map(form.fields.map((f) => [f.id, f.options])), [form.fields]);

  const touch = () => {
    setDirty(true);
    setReport(null);
  };
  /** Ô nhập của phần thông tin form: ghi giá trị (qua `map` nếu có, vd. chèn dấu `/` cho ngày) rồi đánh dấu chưa lưu. */
  const edit =
    (set: (value: string) => void, map?: (value: string) => string) =>
    (e: { target: { value: string } }) => {
      set(map ? map(e.target.value) : e.target.value);
      touch();
    };
  const updateField = (id: string, patch: Partial<EditableField>) => {
    setFields((prev) => prev.map((f) => (f.id === id ? { ...f, ...patch } : f)));
    touch();
  };
  const move = (index: number, delta: number) => {
    setFields((prev) => {
      const next = prev.slice();
      const target = index + delta;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
    touch();
  };
  const remove = (id: string) => {
    setFields((prev) => prev.filter((f) => f.id !== id));
    touch();
  };
  const addField = () => {
    const choice = CHOICE_TYPES.has(newType);
    setFields((prev) => [
      ...prev,
      {
        id: newFieldId(),
        type: newType,
        label: "",
        help: "",
        required: newType !== "section",
        hidden: false,
        options: [],
        optionsText: choice ? "Lựa chọn 1\nLựa chọn 2" : ""
      }
    ]);
    touch();
  };
  const changeType = (field: EditableField, type: CustomFormFieldType) => {
    const choice = CHOICE_TYPES.has(type);
    updateField(field.id, {
      type,
      required: type === "section" ? false : field.required,
      optionsText: choice && !field.optionsText.trim() ? "Lựa chọn 1\nLựa chọn 2" : field.optionsText
    });
  };

  const run = async (action: () => Promise<CustomFormAdminResult>, after?: () => void) => {
    setBusy(true);
    setReport(null);
    try {
      const result = await action();
      setReport(result);
      if (result.ok) {
        after?.();
        router.refresh();
      }
    } catch {
      setReport({ ok: false, message: "Chưa lưu được — kiểm tra kết nối mạng rồi thử lại. Thay đổi vẫn còn trên trang." });
    } finally {
      setBusy(false);
    }
  };

  const save = () => {
    const opensAt = combineVietnamDateTime(opensDate, opensTime);
    const closesAt = combineVietnamDateTime(closesDate, closesTime);
    if ((opensDate || opensTime) && !opensAt) return setReport({ ok: false, message: "Giờ mở cần đủ ngày (DD/MM/YYYY) và giờ (HH:mm), hoặc để trống cả hai." });
    if ((closesDate || closesTime) && !closesAt) return setReport({ ok: false, message: "Giờ đóng cần đủ ngày (DD/MM/YYYY) và giờ (HH:mm), hoặc để trống cả hai." });
    void run(
      () =>
        saveCustomFormAction(form.id, {
          title,
          description,
          programId,
          thankYou,
          onePerEmail,
          autoReply,
          autoReplySubject,
          autoReplyBody,
          opensAt,
          closesAt,
          eventId,
          registrationLimit,
          requireKnownPerson,
          themeColor,
          fields: fields.map(({ optionsText, ...f }) => ({ ...f, options: CHOICE_TYPES.has(f.type) ? lines(optionsText) : [] }))
        }),
      () => setDirty(false)
    );
  };
  const createQuickEvent = () => {
    const startsAt = combineVietnamDateTime(quickDate, quickTime);
    if (!quickName.trim()) return setReport({ ok: false, message: "Sự kiện mới cần có tên." });
    if (!startsAt) return setReport({ ok: false, message: "Sự kiện mới cần ngày (DD/MM/YYYY) và giờ (HH:mm) bắt đầu." });
    void run(async () => {
      const result = await createEventForFormAction({ name: quickName, startsAt, location: quickPlace, capacity: quickCapacity });
      if (result.ok && result.event) {
        const created = result.event;
        setEvents((prev) => [created, ...prev.filter((e) => e.id !== created.id)]);
        setEventId(created.id);
        setOnePerEmail(true);
        setQuickOpen(false);
        setDirty(true);
      }
      return { ok: result.ok, message: result.message };
    });
  };
  const selectedEvent = events.find((e) => e.id === eventId) ?? null;
  const testReceipt = () => void run(() => sendCustomFormReceiptTestAction(form.id, { subject: autoReplySubject, body: autoReplyBody }));
  const changeStatus = (next: CustomFormStatus) => void run(() => setCustomFormStatusAction(form.id, next), () => setStatus(next));
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(publicUrl);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="grid gap-4" data-testid="form-builder">
      <Card>
        <div className="grid gap-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium text-vam-ink">Trạng thái:</span>
            <span data-testid="form-status" className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
              {CUSTOM_FORM_STATUS_LABELS[status]}
            </span>
            <span className="text-slate-500">· {responseCount} câu trả lời</span>
          </div>
          <div className="grid gap-1 text-sm">
            <span className="font-medium text-vam-ink">Link gửi cho người điền</span>
            <div className="flex flex-wrap items-center gap-2">
              <code data-testid="public-url" className="break-all rounded bg-slate-50 px-2 py-1 text-xs text-slate-700">
                {publicUrl}
              </code>
              <button type="button" className={SMALL_BUTTON} onClick={() => void copy()}>
                {copied ? "Đã sao chép" : "Sao chép link"}
              </button>
            </div>
            {status !== "published" ? <span className="text-xs text-amber-700">Link chỉ nhận câu trả lời khi form đang công khai.</span> : null}
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href={`${CUSTOM_FORMS_PATH}/${form.id}/xem-thu`} className={SMALL_BUTTON}>
              Xem thử form
            </Link>
            <Link href={`${CUSTOM_FORMS_PATH}/${form.id}/tra-loi`} className={SMALL_BUTTON}>
              Xem câu trả lời ({responseCount})
            </Link>
            {status === "published" ? (
              <button type="button" data-testid="close-form" disabled={busy} className={SMALL_BUTTON} onClick={() => changeStatus("closed")}>
                Đóng form
              </button>
            ) : (
              <button
                type="button"
                data-testid="publish-form"
                disabled={busy || dirty}
                className="rounded-md bg-vam-green px-3 py-1 text-xs font-semibold text-white disabled:opacity-40"
                onClick={() => changeStatus("published")}
              >
                {status === "closed" ? "Mở lại form" : "Công khai form"}
              </button>
            )}
            {status !== "draft" && !locked ? (
              <button type="button" disabled={busy} className={SMALL_BUTTON} onClick={() => changeStatus("draft")}>
                Đưa về nháp
              </button>
            ) : null}
          </div>
          {dirty && status !== "published" ? <p className="text-xs text-amber-700">Lưu form trước khi công khai.</p> : null}
        </div>
      </Card>

      {locked ? (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900" data-testid="locked-note">
          Form đã có {responseCount} câu trả lời: câu hỏi cũ không xoá hay đổi loại được (bấm “Ẩn” để bỏ khỏi form); câu chọn chỉ thêm được lựa chọn
          mới. Sửa chữ của câu hỏi và thêm câu mới vẫn được.
        </p>
      ) : null}

      <Card>
        <div className="grid gap-3">
          <h2 className="text-base font-semibold text-vam-ink">Thông tin form</h2>
          <label className="grid gap-1 text-sm">
            <span className="font-medium">Tiêu đề *</span>
            <input className={BOX} value={title} maxLength={200} onChange={edit(setTitle)} />
          </label>
          <label className="grid gap-1 text-sm">
            <span className="font-medium">Giới thiệu (hiện dưới tiêu đề)</span>
            <textarea className={BOX} rows={4} value={description} onChange={edit(setDescription)} />
          </label>
          <label className="grid gap-1 text-sm">
            <span className="font-medium">Chương trình</span>
            <select className={BOX} value={programId} onChange={edit(setProgramId)}>
              <option value="">— Không gắn chương trình —</option>
              {programs.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <div className="grid gap-2 rounded-md border border-vam-line p-3" data-testid="event-link">
            <label className="grid gap-1 text-sm">
              <span className="font-medium">Đăng ký sự kiện</span>
              <select
                className={BOX}
                data-testid="event-select"
                value={eventId}
                disabled={locked}
                onChange={(e) => {
                  setEventId(e.target.value);
                  if (e.target.value) setOnePerEmail(true);
                  touch();
                }}
              >
                <option value="">— Không gắn sự kiện (form độc lập) —</option>
                {events.map((ev) => (
                  <option key={ev.id} value={ev.id} disabled={Boolean(ev.blocker) && ev.id !== eventId}>
                    {ev.name}
                    {ev.startsAt ? ` · ${formatDateTime(ev.startsAt)}` : ""}
                    {ev.capacity !== null ? ` · ${ev.capacity} chỗ` : ""}
                    {ev.blocker ? " · không gắn được" : ""}
                  </option>
                ))}
              </select>
            </label>
            {selectedEvent?.blocker ? <p className="text-xs text-red-700">{selectedEvent.blocker}</p> : null}
            <p className="text-xs text-slate-600">
              Gắn sự kiện thì người điền vào thẳng danh sách người tham gia của sự kiện: nhận thư xác nhận kèm vé QR của sự kiện (thay thư tự động của
              form), check-in và huỷ ở trang Sự kiện. Gửi lại cùng email và họ tên thì cập nhật đăng ký cũ; cùng email mà khác họ tên thì không ghi
              đè, BTC xem cảnh báo ở trang câu trả lời.
              {locked ? " Form đã có câu trả lời nên không đổi sự kiện được nữa." : ""}
            </p>
            {!locked ? (
              <div className="grid gap-2">
                <button type="button" data-testid="quick-event-toggle" className={`${SMALL_BUTTON} justify-self-start`} onClick={() => setQuickOpen((v) => !v)}>
                  {quickOpen ? "Đóng tạo sự kiện mới" : "+ Tạo sự kiện mới"}
                </button>
                {quickOpen ? (
                  <div className="grid gap-2 sm:grid-cols-2" data-testid="quick-event">
                    <input className={BOX} aria-label="Tên sự kiện mới" placeholder="Tên sự kiện" value={quickName} onChange={(e) => setQuickName(e.target.value)} />
                    <input className={BOX} aria-label="Địa điểm" placeholder="Địa điểm (tuỳ chọn)" value={quickPlace} onChange={(e) => setQuickPlace(e.target.value)} />
                    <div className="flex gap-2">
                      <input className={BOX} aria-label="Ngày sự kiện" placeholder="DD/MM/YYYY" inputMode="numeric" value={quickDate} onChange={(e) => setQuickDate(maskVietnamDate(e.target.value))} />
                      <input className={`${BOX} max-w-[6rem]`} aria-label="Giờ sự kiện" placeholder="HH:mm" inputMode="numeric" value={quickTime} onChange={(e) => setQuickTime(maskVietnamTime(e.target.value))} />
                    </div>
                    <input className={BOX} aria-label="Sức chứa" placeholder="Sức chứa (để trống = không giới hạn)" inputMode="numeric" value={quickCapacity} onChange={(e) => setQuickCapacity(e.target.value)} />
                    <button type="button" data-testid="quick-event-create" disabled={busy} className="justify-self-start rounded-md bg-vam-green px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40 sm:col-span-2" onClick={createQuickEvent}>
                      Tạo sự kiện và chọn cho form
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}
            <label className="grid gap-1 text-sm">
              <span className="font-medium">Giới hạn số đăng ký của form (để trống = không giới hạn)</span>
              <input className={`${BOX} max-w-[10rem]`} data-testid="registration-limit" inputMode="numeric" value={registrationLimit} onChange={edit(setRegistrationLimit)} />
              <span className="text-xs text-slate-600">
                Form gắn sự kiện: giới hạn này không thay sức chứa của sự kiện — form nhận tối đa phần còn trống của cả hai.
              </span>
            </label>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1 text-sm">
              <span className="font-medium">Mở nhận câu trả lời (để trống = ngay khi công khai)</span>
              <div className="flex gap-2">
                <input className={BOX} aria-label="Ngày mở" placeholder="DD/MM/YYYY" inputMode="numeric" value={opensDate} onChange={edit(setOpensDate, maskVietnamDate)} />
                <input className={`${BOX} max-w-[6rem]`} aria-label="Giờ mở" placeholder="HH:mm" inputMode="numeric" value={opensTime} onChange={edit(setOpensTime, maskVietnamTime)} />
              </div>
            </div>
            <div className="grid gap-1 text-sm">
              <span className="font-medium">Đóng nhận câu trả lời (để trống = không hạn)</span>
              <div className="flex gap-2">
                <input className={BOX} aria-label="Ngày đóng" placeholder="DD/MM/YYYY" inputMode="numeric" value={closesDate} onChange={edit(setClosesDate, maskVietnamDate)} />
                <input className={`${BOX} max-w-[6rem]`} aria-label="Giờ đóng" placeholder="HH:mm" inputMode="numeric" value={closesTime} onChange={edit(setClosesTime, maskVietnamTime)} />
              </div>
            </div>
          </div>
          <label className="grid gap-1 text-sm">
            <span className="font-medium">Lời cảm ơn sau khi gửi</span>
            <textarea
              className={BOX}
              rows={2}
              placeholder="Đã nhận câu trả lời của bạn. Cảm ơn bạn đã dành thời gian!"
              value={thankYou}
              onChange={edit(setThankYou)}
            />
          </label>
          <div className="grid gap-1 text-sm">
            <span className="font-medium">Màu chủ đạo của form</span>
            <div className="flex flex-wrap items-center gap-2">
              <input type="color" aria-label="Màu chủ đạo" data-testid="theme-color" className="h-9 w-14 rounded border border-vam-line bg-white p-1" value={themeColor || "#0f766e"} onChange={edit(setThemeColor)} />
              {themeColor ? (
                <button type="button" className={SMALL_BUTTON} onClick={() => { setThemeColor(""); touch(); }}>
                  Dùng màu mặc định
                </button>
              ) : (
                <span className="text-xs text-slate-500">Đang dùng màu mặc định.</span>
              )}
            </div>
            <span className="text-xs text-slate-600">Áp cho viền đầu form và nút Tiếp, Gửi. Chữ trên nút tự chọn trắng hoặc đen cho dễ đọc.</span>
          </div>
          <label className="flex items-start gap-2 text-sm" data-testid="known-person">
            <input type="checkbox" data-testid="known-person-toggle" className="mt-0.5 h-4 w-4" checked={requireKnownPerson} onChange={(e) => {
                setRequireKnownPerson(e.target.checked);
                touch();
              }} />
            <span>
              <span className="font-medium">Chỉ nhận người đã có trên hệ thống</span> — email và họ tên phải khớp một mentor hoặc mentee đã được duyệt của
              mùa hiện tại. Người khác không gửi được và thấy câu “Thông tin của bạn chưa có trên hệ thống. Vui lòng liên hệ BTC để được hỗ trợ.”
              Form cần trường Email và ô Họ và tên bắt buộc.
            </span>
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-0.5 h-4 w-4" checked={onePerEmail} onChange={(e) => {
                setOnePerEmail(e.target.checked);
                touch();
              }} />
            <span>
              <span className="font-medium">Mỗi email chỉ gửi một lần</span> — dùng trường Email bắt buộc đầu tiên; gửi lần hai bị báo “Email này đã gửi
              form rồi”, câu trả lời cũ giữ nguyên.
            </span>
          </label>
          <div className="grid gap-2 rounded-md border border-vam-line p-3" data-testid="auto-reply">
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                data-testid="auto-reply-toggle"
                className="mt-0.5 h-4 w-4"
                checked={autoReply}
                onChange={(e) => {
                  setAutoReply(e.target.checked);
                  touch();
                }}
              />
              <span>
                <span className="font-medium">Gửi thư tự động cho người điền</span> — ngay sau khi bấm Gửi, tới email người điền nhập ở trường Email
                bắt buộc đầu tiên của form.
              </span>
            </label>
            {autoReply ? (
              <>
                <input
                  className={BOX}
                  aria-label="Tiêu đề thư tự động"
                  maxLength={200}
                  placeholder={`Đã nhận câu trả lời: ${title || "tên form"}`}
                  value={autoReplySubject}
                  onChange={edit(setAutoReplySubject)}
                />
                <textarea
                  className={BOX}
                  rows={6}
                  aria-label="Nội dung thư tự động"
                  placeholder={"Chào bạn,\n\nBan tổ chức đã nhận câu trả lời của bạn. …"}
                  value={autoReplyBody}
                  onChange={edit(setAutoReplyBody)}
                />
                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" data-testid="test-receipt" disabled={busy} className={SMALL_BUTTON} onClick={testReceipt}>
                    Gửi thử cho tôi
                  </button>
                  <span className="text-xs text-slate-500">
                    Thư thử dùng chữ đang trên trang, gửi tới email của bạn. Mỗi form gửi tối đa 300 lá thư tự động trong 24 giờ; chữ là chữ
                    thường, xuống dòng được giữ nguyên.
                  </span>
                </div>
              </>
            ) : null}
          </div>
        </div>
      </Card>

      <div className="grid gap-3" data-testid="field-list">
        {fields.map((field, index) => {
          const fieldLocked = lockedIds.has(field.id);
          const question = isQuestion(field);
          const pageBreak = field.type === "page_break";
          return (
            <Card key={field.id} className={pageBreak ? "border-dashed bg-slate-50" : undefined}>
              <div className="grid gap-2" data-field={field.id}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-semibold uppercase text-slate-500">{question ? `Câu ${questionNumber.get(field.id)}` : pageBreak ? "Ngắt trang — phần dưới sang trang mới" : "Khối tiêu đề"}</span>
                  <select
                    aria-label="Loại trường"
                    className="rounded-md border border-vam-line bg-white px-2 py-1 text-xs"
                    value={field.type}
                    disabled={fieldLocked}
                    onChange={(e) => changeType(field, e.target.value as CustomFormFieldType)}
                  >
                    {CUSTOM_FORM_FIELD_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {FIELD_TYPE_LABELS[t]}
                      </option>
                    ))}
                  </select>
                  {field.hidden ? <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-900">Đang ẩn</span> : null}
                  <span className="ml-auto flex gap-1">
                    <button type="button" className={SMALL_BUTTON} disabled={index === 0} onClick={() => move(index, -1)} aria-label="Đưa lên">
                      ↑
                    </button>
                    <button type="button" className={SMALL_BUTTON} disabled={index === fields.length - 1} onClick={() => move(index, 1)} aria-label="Đưa xuống">
                      ↓
                    </button>
                    <button type="button" className={SMALL_BUTTON} onClick={() => updateField(field.id, { hidden: !field.hidden })}>
                      {field.hidden ? "Hiện" : "Ẩn"}
                    </button>
                    <button
                      type="button"
                      className={SMALL_BUTTON}
                      disabled={fieldLocked}
                      title={fieldLocked ? "Đã có câu trả lời — dùng Ẩn" : undefined}
                      onClick={() => remove(field.id)}
                    >
                      Xoá
                    </button>
                  </span>
                </div>
                <input
                  className={BOX}
                  aria-label={question ? "Câu hỏi" : pageBreak ? "Tiêu đề trang tiếp theo" : "Tiêu đề phần"}
                  placeholder={question ? "Câu hỏi" : pageBreak ? "Tiêu đề trang tiếp theo (không bắt buộc)" : "Tiêu đề phần"}
                  maxLength={300}
                  value={field.label}
                  onChange={(e) => updateField(field.id, { label: e.target.value })}
                />
                <textarea
                  className={BOX}
                  rows={question ? 1 : 3}
                  aria-label="Mô tả thêm"
                  placeholder={
                    question ? "Mô tả thêm (không bắt buộc)" : pageBreak ? "Mô tả ngắn cho trang tiếp theo (không bắt buộc)" : "Đoạn giới thiệu cho phần này (không bắt buộc)"
                  }
                  value={field.help}
                  onChange={(e) => updateField(field.id, { help: e.target.value })}
                />
                {CHOICE_TYPES.has(field.type) ? (
                  <label className="grid gap-1 text-xs text-slate-600">
                    <span>
                      Các lựa chọn — mỗi dòng một lựa chọn
                      {fieldLocked && (lockedOptions.get(field.id) ?? []).length ? " (đã có câu trả lời: giữ các lựa chọn cũ, chỉ thêm dòng mới)" : ""}
                    </span>
                    <textarea className={BOX} rows={4} value={field.optionsText} onChange={(e) => updateField(field.id, { optionsText: e.target.value })} />
                  </label>
                ) : null}
                {field.type === "yes_no" ? (
                  <div className="grid gap-2 rounded-md border border-vam-line p-2 sm:grid-cols-2" data-testid="branch-targets">
                    {(["yes", "no"] as const).map((side) => (
                      <label key={side} className="grid gap-1 text-xs text-slate-600">
                        <span>Trả lời “{side === "yes" ? "Có" : "Không"}” thì đến</span>
                        <select
                          className={BOX}
                          aria-label={`Đích khi trả lời ${side === "yes" ? "Có" : "Không"}`}
                          value={field.branches?.[side] ?? ""}
                          onChange={(e) => updateField(field.id, { branches: { yes: field.branches?.yes ?? "", no: field.branches?.no ?? "", [side]: e.target.value } })}
                        >
                          <option value="">Trang kế tiếp</option>
                          {fields.slice(index + 1).filter((f) => f.type === "page_break" && !f.hidden).map((f) => (
                            <option key={f.id} value={f.id}>
                              Trang: {f.label || "(chưa đặt tên)"}
                            </option>
                          ))}
                          <option value={BRANCH_END}>Kết thúc form (tới nút Gửi)</option>
                        </select>
                      </label>
                    ))}
                    <p className="text-xs text-slate-500 sm:col-span-2">Chỉ đến được các “Ngắt trang” nằm sau câu này. Câu ở trang bị bỏ qua không bắt buộc và không được lưu.</p>
                  </div>
                ) : null}
                {question ? (
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" className="h-4 w-4" checked={field.required} onChange={(e) => updateField(field.id, { required: e.target.checked })} />
                    Bắt buộc trả lời
                  </label>
                ) : null}
              </div>
            </Card>
          );
        })}
      </div>

      <Card>
        <div className="flex flex-wrap items-center gap-2">
          <select aria-label="Loại trường mới" className="rounded-md border border-vam-line bg-white px-2 py-2 text-sm" value={newType} onChange={(e) => setNewType(e.target.value as CustomFormFieldType)}>
            {CUSTOM_FORM_FIELD_TYPES.map((t) => (
              <option key={t} value={t}>
                {FIELD_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
          <button type="button" data-testid="add-field" className={SMALL_BUTTON} onClick={addField}>
            + Thêm trường
          </button>
        </div>
      </Card>

      <div className="sticky bottom-2 z-10 flex flex-wrap items-center gap-3 rounded-lg border border-vam-line bg-white px-4 py-3 shadow-sm">
        <button
          type="button"
          data-testid="save-form"
          disabled={busy}
          onClick={save}
          className="rounded-md bg-vam-green px-4 py-2 text-sm font-semibold text-white hover:bg-vam-green/90 disabled:opacity-60"
        >
          {busy ? "Đang lưu…" : "Lưu form"}
        </button>
        {dirty ? <span className="text-xs text-amber-700">Có thay đổi chưa lưu</span> : null}
        {report ? (
          <span role={report.ok ? "status" : "alert"} data-testid="builder-report" className={`text-sm ${report.ok ? "text-green-700" : "text-red-600"}`}>
            {report.message}
          </span>
        ) : null}
      </div>
    </div>
  );
}
