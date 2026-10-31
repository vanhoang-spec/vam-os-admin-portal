"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Card } from "@/components/ui";
import type { CustomFormAdminResult } from "@/lib/custom-form-action-types";
import {
  BRANCH_END,
  BRANCHING_CHOICE_TYPES,
  CHOICE_TYPES,
  CUSTOM_FORM_FIELD_TYPES,
  CUSTOM_FORM_STATUS_LABELS,
  CUSTOM_FORMS_PATH,
  FIELD_TYPE_LABELS,
  LOGO_POSITIONS,
  LOGO_POSITION_LABELS,
  YES_NO_OPTIONS,
  branchBlockers,
  branchWarnings,
  hasBranching,
  isQuestion,
  newFieldId,
  optionTargetsOf,
  removePageLinks,
  type CustomFormField,
  type CustomFormFieldType,
  type CustomFormStatus,
  type LogoPosition
} from "@/lib/custom-form-core";
import { combineVietnamDateTime, maskVietnamDate, maskVietnamTime, splitVietnamDateTime } from "@/lib/event-datetime";
import { createEventForFormAction, saveCustomFormAction, sendCustomFormReceiptTestAction, setCustomFormStatusAction } from "../actions";
import { formatDateTime } from "@/lib/utils";
import { FormImageField } from "./form-image-field";

const BOX =
  "w-full rounded-md border border-vam-line bg-white px-3 py-2 text-sm text-vam-ink outline-none focus:border-vam-green focus:ring-2 focus:ring-vam-mint";
const SMALL_BUTTON = "rounded-md border border-vam-line bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40";

/**
 * `rowTargets[i]` là đích của dòng thứ i trong `optionsText`. Lúc soạn, đích bám theo DÒNG chứ không theo
 * chữ: `optionTargets` khoá theo chữ lựa chọn, nên giữ dạng đó ở đây thì sửa một chữ là mất đích.
 */
type EditableField = CustomFormField & { optionsText: string; rowTargets: string[] };

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
  bannerPath: string | null;
  logoPath: string | null;
  logoPosition: LogoPosition;
};

export type BuilderEvent = { id: string; name: string; startsAt: string | null; capacity: number | null; status: string; blocker: string | null };

const toEditable = (f: CustomFormField): EditableField => {
  const targets = optionTargetsOf(f);
  return { ...f, optionsText: f.options.join("\n"), rowTargets: f.options.map((o) => targets.get(o) ?? "") };
};
const lines = (value: string) => value.split("\n").map((l) => l.trim()).filter(Boolean);
/** Từ dòng đang soạn về định nghĩa gửi lên máy chủ: đây là chỗ đích được khoá lại theo chữ lựa chọn. */
const toField = ({ optionsText, rowTargets, ...f }: EditableField): CustomFormField => {
  const options = CHOICE_TYPES.has(f.type) ? lines(optionsText) : f.type === "yes_no" ? [...YES_NO_OPTIONS] : [];
  const saved: CustomFormField = { ...f, options };
  delete saved.optionTargets;
  if (BRANCHING_CHOICE_TYPES.has(f.type)) {
    const set = optionsText.split("\n").map((row, i): [string, string] => [row.trim(), rowTargets[i] ?? ""]).filter(([option, target]) => option && target);
    if (set.length) saved.optionTargets = Object.fromEntries(set);
  }
  return saved;
};

/** Ô chọn đích, dùng chung cho lựa chọn, câu Có/Không và mặc định của trang. Chỉ liệt kê trang nằm sau: nhảy lùi không chọn được. */
function TargetSelect({
  label,
  value,
  emptyLabel,
  pages,
  onChange
}: {
  label: string;
  value: string;
  emptyLabel: string;
  pages: EditableField[];
  onChange: (value: string) => void;
}) {
  // Đích đã thành sai (đổi thứ tự, ẩn trang) vẫn phải hiện ra: thiếu dòng này ô chọn tự vẽ dòng đầu, trông như chưa đặt gì.
  const stale = value && value !== BRANCH_END && !pages.some((f) => f.id === value);
  return (
    <select className={BOX} aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{emptyLabel}</option>
      {stale ? <option value={value}>Đích không còn hợp lệ — chọn lại</option> : null}
      {pages.map((f) => (
        <option key={f.id} value={f.id}>
          Trang: {f.label || "(chưa đặt tên)"}
        </option>
      ))}
      <option value={BRANCH_END}>Kết thúc form (tới nút Gửi)</option>
    </select>
  );
}

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
  publicUrl,
  bannerUrl: initialBannerUrl = "",
  logoUrl: initialLogoUrl = ""
}: {
  form: BuilderForm;
  programs: Array<{ id: string; name: string }>;
  events?: BuilderEvent[];
  responseCount: number;
  publicUrl: string;
  bannerUrl?: string;
  logoUrl?: string;
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
  const [bannerPath, setBannerPath] = useState(form.bannerPath ?? "");
  const [bannerUrl, setBannerUrl] = useState(initialBannerUrl);
  const [logoPath, setLogoPath] = useState(form.logoPath ?? "");
  const [logoUrl, setLogoUrl] = useState(initialLogoUrl);
  const [logoPosition, setLogoPosition] = useState<LogoPosition>(form.logoPosition);
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
  // Lần xoá trang gần đây còn chưa lưu: chỗ nào mất đích phải đọc được, vì ô chọn lúc này chỉ hiện là trống.
  const [lostLinks, setLostLinks] = useState<Array<{ page: string; lost: string[] }>>([]);

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
  /** Bỏ mọi đích trỏ tới một ngắt trang sắp biến mất, và ghi lại những chỗ mất đích. */
  const dropPageLinks = (list: EditableField[], breakField: EditableField) => {
    const { lost } = removePageLinks(list.map(toField), breakField.id);
    if (lost.length) setLostLinks((prev) => [...prev, { page: breakField.label || "(chưa đặt tên)", lost }]);
    const clear = (target: string | undefined) => (target === breakField.id ? "" : target);
    return list.map((f) => ({
      ...f,
      nextPage: clear(f.nextPage),
      rowTargets: f.rowTargets.map((t) => (t === breakField.id ? "" : t)),
      ...(f.branches ? { branches: { yes: clear(f.branches.yes) ?? "", no: clear(f.branches.no) ?? "" } } : {})
    }));
  };
  const remove = (id: string) => {
    const target = fields.find((f) => f.id === id);
    const rest = fields.filter((f) => f.id !== id);
    setFields(target?.type === "page_break" ? dropPageLinks(rest, target) : rest);
    touch();
  };
  /** Trang đầu không có ngắt trang nên không có chỗ đặt đích mặc định: chèn một cái là có, không cần đổi dữ liệu. */
  const addFirstPageBreak = () => {
    setFields((prev) => [{ id: newFieldId(), type: "page_break", label: "", help: "", required: false, hidden: false, options: [], optionsText: "", rowTargets: [] }, ...prev]);
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
        optionsText: choice ? "Lựa chọn 1\nLựa chọn 2" : "",
        rowTargets: []
      }
    ]);
    touch();
  };
  const changeType = (field: EditableField, type: CustomFormFieldType) => {
    const choice = CHOICE_TYPES.has(type);
    // Đổi ngắt trang sang loại khác cũng là xoá trang đó.
    if (field.type === "page_break" && type !== "page_break") setFields(dropPageLinks(fields, field));
    updateField(field.id, {
      type,
      required: type === "section" ? false : field.required,
      optionsText: choice && !field.optionsText.trim() ? "Lựa chọn 1\nLựa chọn 2" : field.optionsText
    });
  };

  /** Đặt lại danh sách dòng lựa chọn, giữ `rowTargets` đi cùng từng dòng. */
  const setRows = (field: EditableField, rows: Array<{ text: string; target: string }>) =>
    updateField(field.id, { optionsText: rows.map((r) => r.text).join("\n"), rowTargets: rows.map((r) => r.target) });
  const rowsOf = (field: EditableField) => field.optionsText.split("\n").map((row, i) => ({ text: row, target: field.rowTargets[i] ?? "" }));

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
          bannerPath,
          logoPath,
          logoPosition,
          fields: fields.map(toField)
        }),
      () => {
        setDirty(false);
        setLostLinks([]);
      }
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
  const liveFields = useMemo(() => fields.map(toField), [fields]);
  const blockers = useMemo(() => branchBlockers(liveFields), [liveFields]);
  const warnings = useMemo(() => branchWarnings(liveFields), [liveFields]);
  const firstVisible = fields.find((f) => !f.hidden);
  const needsFirstBreak = useMemo(() => hasBranching(liveFields) || liveFields.some((f) => f.type === "page_break" && !f.hidden), [liveFields]) && firstVisible?.type !== "page_break";
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
          <FormImageField
            formId={form.id}
            kind="banner"
            label="Ảnh banner đầu form"
            hint="PNG, JPG hoặc WebP, ảnh ngang (khoảng 1600 × 400) nhìn đẹp nhất. Chọn xong bấm “Lưu form”."
            url={bannerUrl}
            onChange={(path, url) => {
              setBannerPath(path);
              setBannerUrl(url);
              touch();
            }}
          />
          <FormImageField
            formId={form.id}
            kind="logo"
            label="Logo đơn vị tổ chức"
            hint="Nên dùng PNG nền trong suốt. Chọn xong bấm “Lưu form”."
            url={logoUrl}
            onChange={(path, url) => {
              setLogoPath(path);
              setLogoUrl(url);
              touch();
            }}
          />
          {logoUrl ? (
            <label className="grid gap-1 text-sm">
              <span className="font-medium">Vị trí logo</span>
              <select
                className={`${BOX} max-w-[12rem]`}
                data-testid="logo-position"
                value={logoPosition}
                onChange={(e) => {
                  setLogoPosition(e.target.value as LogoPosition);
                  touch();
                }}
              >
                {LOGO_POSITIONS.map((p) => (
                  <option key={p} value={p}>
                    {LOGO_POSITION_LABELS[p]}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
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

      {needsFirstBreak ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900" data-testid="first-page-hint">
          <span>Trang đầu chưa có ngắt trang nên chưa đặt được “Trang tiếp theo” cho trang đầu. Cần thì thêm một ngắt trang ở đầu form; người điền không thấy trang trống nào.</span>
          <button type="button" data-testid="add-first-break" className={SMALL_BUTTON} onClick={addFirstPageBreak}>
            Thêm ngắt trang ở đầu form
          </button>
        </div>
      ) : null}

      {lostLinks.length ? (
        <div className="grid gap-1 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900" role="status" data-testid="lost-links">
          {lostLinks.map((entry, i) => (
            <div key={i}>
              <p className="font-medium">Đã xoá trang “{entry.page}”. Những chỗ sau mất đích, giờ đi theo đường mặc định — đặt lại nếu cần:</p>
              <ul className="list-disc pl-5">
                {entry.lost.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ) : null}

      {blockers.length || warnings.length ? (
        <div className="grid gap-2 rounded-md border border-vam-line bg-white px-3 py-2 text-sm" data-testid="branch-report">
          {blockers.length ? (
            <div className="text-red-700" data-testid="branch-blockers">
              <p className="font-medium">Phải sửa trước khi công khai:</p>
              <ul className="list-disc pl-5">
                {blockers.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {warnings.length ? (
            <div className="text-amber-800" data-testid="branch-warnings">
              <p className="font-medium">Cần xem lại (không chặn công khai):</p>
              <ul className="list-disc pl-5">
                {warnings.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="grid gap-3" data-testid="field-list">
        {fields.map((field, index) => {
          const fieldLocked = lockedIds.has(field.id);
          const question = isQuestion(field);
          const pageBreak = field.type === "page_break";
          const laterPages = fields.slice(index + 1).filter((f) => f.type === "page_break" && !f.hidden);
          const savedOptions = lockedOptions.get(field.id) ?? [];
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
                {pageBreak ? (
                  <label className="grid gap-1 text-xs text-slate-600" data-testid="page-default-target">
                    <span>Trang tiếp theo sau khi xong trang này (câu trả lời có đích riêng thì đi theo đích đó)</span>
                    <TargetSelect
                      label="Trang tiếp theo"
                      value={field.nextPage ?? ""}
                      emptyLabel="Trang kế tiếp (mặc định)"
                      pages={laterPages}
                      onChange={(value) => updateField(field.id, { nextPage: value })}
                    />
                  </label>
                ) : null}
                {BRANCHING_CHOICE_TYPES.has(field.type) ? (
                  <div className="grid gap-2 rounded-md border border-vam-line p-2" data-testid="option-rows">
                    <p className="text-xs text-slate-600">
                      Các lựa chọn và đích đến{fieldLocked && savedOptions.length ? " (đã có câu trả lời: giữ các lựa chọn cũ, chỉ thêm lựa chọn mới)" : ""}. Dán nhiều dòng vào một ô thì tự tách thành nhiều lựa chọn.
                    </p>
                    {rowsOf(field).map((row, rowIndex, rows) => {
                      const rowLocked = fieldLocked && savedOptions.includes(row.text.trim());
                      return (
                        <div key={rowIndex} className="grid items-center gap-2 sm:grid-cols-[1fr_1fr_auto]" data-testid="option-row">
                          <input
                            className={BOX}
                            aria-label={`Lựa chọn ${rowIndex + 1}`}
                            maxLength={200}
                            readOnly={rowLocked}
                            value={row.text}
                            onChange={(e) => setRows(field, rows.map((r, i) => (i === rowIndex ? { ...r, text: e.target.value } : r)))}
                            onPaste={(e) => {
                              const pasted = e.clipboardData.getData("text").split(/\r?\n/).map((t) => t.trim()).filter(Boolean);
                              if (rowLocked || pasted.length < 2) return;
                              e.preventDefault();
                              setRows(field, [...rows.slice(0, rowIndex), { text: pasted[0], target: row.target }, ...pasted.slice(1).map((text) => ({ text, target: "" })), ...rows.slice(rowIndex + 1)]);
                            }}
                          />
                          <TargetSelect
                            label={`Đích của lựa chọn ${rowIndex + 1}`}
                            value={row.target}
                            emptyLabel="Theo Trang tiếp theo của trang"
                            pages={laterPages}
                            onChange={(value) => setRows(field, rows.map((r, i) => (i === rowIndex ? { ...r, target: value } : r)))}
                          />
                          <button type="button" className={SMALL_BUTTON} disabled={rowLocked} aria-label={`Xoá lựa chọn ${rowIndex + 1}`} onClick={() => setRows(field, rows.filter((_, i) => i !== rowIndex))}>
                            Xoá
                          </button>
                        </div>
                      );
                    })}
                    <button type="button" data-testid="add-option" className={`${SMALL_BUTTON} justify-self-start`} onClick={() => setRows(field, [...rowsOf(field), { text: "", target: "" }])}>
                      + Thêm lựa chọn
                    </button>
                    <p className="text-xs text-slate-500">Chỉ đến được các “Ngắt trang” nằm sau câu này. Câu ở trang bị bỏ qua không bắt buộc và không được lưu.</p>
                  </div>
                ) : field.type === "multi_choice" ? (
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
                        <TargetSelect
                          label={`Đích khi trả lời ${side === "yes" ? "Có" : "Không"}`}
                          value={field.branches?.[side] ?? ""}
                          emptyLabel="Theo Trang tiếp theo của trang"
                          pages={laterPages}
                          onChange={(value) => updateField(field.id, { branches: { yes: field.branches?.yes ?? "", no: field.branches?.no ?? "", [side]: value } })}
                        />
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
