"use client";

import { useEffect, useRef, useState } from "react";
// useFormState, không phải useActionState: dự án chạy React 18.3.1, nơi hook đó
// chưa tồn tại. @types/react khai báo nó nên tsc vẫn cho qua — chỉ tới lúc
// dựng component mới vỡ.
import { useFormState, useFormStatus } from "react-dom";
import {
  MAX_BODY_LENGTH,
  MAX_SUBJECT_LENGTH,
  TEMPLATE_SPECS,
  placeholderToken,
  renderTemplate,
  sampleValues,
  validateTemplate,
  type TemplateKind
} from "@/lib/email-templates-core";
import {
  initialEmailTemplateActionState,
  type EmailTemplateActionState
} from "@/lib/email-template-action-types";
import {
  approveEmailTemplateAction,
  saveEmailTemplateAction
} from "@/app/actions/email-templates";

export type EditableTemplate = {
  id: string;
  kind: TemplateKind;
  name: string;
  subject: string;
  body: string;
  status: "draft" | "approved" | "archived";
};

/** Hai ô văn bản mà nút chèn có thể chèn vào. */
type TargetField = "subject" | "body";

function SubmitButton({ label, busyLabel }: { label: string; busyLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md bg-vam-green px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-vam-green/90 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? busyLabel : label}
    </button>
  );
}

function Notice({ state }: { state: EmailTemplateActionState }) {
  if (!state.message) return null;
  return (
    <p
      role="status"
      className={`rounded-md border px-3 py-2 text-sm ${
        state.ok
          ? "border-vam-green/40 bg-vam-mint text-vam-ink"
          : "border-red-200 bg-red-50 text-red-800"
      }`}
    >
      {state.message}
    </p>
  );
}

/**
 * Soạn một mẫu thư.
 *
 * ---------------------------------------------------------------------------
 * NÚT CHÈN Ô
 * ---------------------------------------------------------------------------
 * Người soạn không phải nhớ `{{ten_nguoi_nhan}}` viết ra sao, cũng không phải
 * gõ tay hai cặp ngoặc — bấm một nút là ô được chèn vào đúng chỗ con trỏ đang
 * đứng, ở ô văn bản vừa gõ dở. Gõ tay vẫn được, và vẫn được kiểm như nhau.
 *
 * Vì thế cả tiêu đề lẫn nội dung đều là controlled input: chèn vào giữa một
 * đoạn văn cần biết con trỏ ở đâu và ghép lại chuỗi, thứ mà uncontrolled input
 * không cho làm gọn.
 *
 * ---------------------------------------------------------------------------
 * KIỂM Ở ĐÂY CHỈ LÀ ĐỂ NHÌN
 * ---------------------------------------------------------------------------
 * `validateTemplate` chạy ngay lúc gõ để người soạn thấy lỗi sớm. Nó KHÔNG phải
 * hàng rào: hàng rào nằm trong server action, chạy đúng hàm này một lần nữa.
 * Một server action nhận được bất kỳ FormData nào gửi tới nó.
 */
export function TemplateEditor({
  kind,
  template,
  canApprove,
  onDone
}: {
  kind: TemplateKind;
  template: EditableTemplate | null;
  canApprove: boolean;
  onDone?: () => void;
}) {
  const spec = TEMPLATE_SPECS[kind];

  const [name, setName] = useState(template?.name ?? "");
  const [subject, setSubject] = useState(template?.subject ?? "");
  const [body, setBody] = useState(template?.body ?? "");

  const subjectRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  // Ô văn bản gần nhất người soạn chạm vào, và vị trí con trỏ trong đó. Mặc
  // định là thân thư: đó là chỗ hầu hết các ô được chèn vào.
  const targetRef = useRef<TargetField>("body");
  const caretRef = useRef<{ start: number; end: number }>({ start: 0, end: 0 });

  // Đặt lại con trỏ sau khi chèn phải chờ React vẽ xong giá trị mới, nên nó
  // nằm trong một effect chứ không ngay trong hàm xử lý bấm.
  const [pendingCaret, setPendingCaret] = useState<{ field: TargetField; at: number } | null>(null);

  const [saveState, saveAction] = useFormState(
    saveEmailTemplateAction,
    initialEmailTemplateActionState
  );
  const [approveState, approveAction] = useFormState(
    approveEmailTemplateAction,
    initialEmailTemplateActionState
  );

  useEffect(() => {
    if (!pendingCaret) return;
    const element = pendingCaret.field === "subject" ? subjectRef.current : bodyRef.current;
    setPendingCaret(null);
    if (!element) return;
    element.focus();
    element.setSelectionRange(pendingCaret.at, pendingCaret.at);
  }, [pendingCaret]);

  // Lưu xong thì báo lên trên để danh sách đọc lại — nhưng chỉ khi thành công,
  // và chỉ một lần cho mỗi lần lưu.
  const lastHandledRef = useRef<EmailTemplateActionState | null>(null);
  useEffect(() => {
    if (!saveState.ok || lastHandledRef.current === saveState) return;
    lastHandledRef.current = saveState;
    onDone?.();
  }, [saveState, onDone]);

  function rememberCaret(field: TargetField) {
    const element = field === "subject" ? subjectRef.current : bodyRef.current;
    if (!element) return;
    targetRef.current = field;
    caretRef.current = {
      start: element.selectionStart ?? element.value.length,
      end: element.selectionEnd ?? element.value.length
    };
  }

  function insertPlaceholder(key: string) {
    const token = placeholderToken(key);
    const field = targetRef.current;
    const current = field === "subject" ? subject : body;
    const { start, end } = caretRef.current;

    // Kẹp lại phòng khi vị trí nhớ được đã cũ hơn nội dung hiện tại (người soạn
    // xoá bớt chữ rồi mới bấm nút).
    const from = Math.min(Math.max(start, 0), current.length);
    const to = Math.min(Math.max(end, from), current.length);

    const next = `${current.slice(0, from)}${token}${current.slice(to)}`;
    if (field === "subject") setSubject(next);
    else setBody(next);

    const caret = from + token.length;
    caretRef.current = { start: caret, end: caret };
    setPendingCaret({ field, at: caret });
  }

  // Khung cảnh báo nói về THỨ NGƯỜI TA ĐANG GÕ, không phải về những ô còn
  // trống.
  //
  // `validateTemplate` trả về lỗi ĐẦU TIÊN nó gặp, và nó kiểm tên rồi tiêu đề
  // trước khi tới thân thư. Truyền thẳng các ô đang rỗng vào đây thì suốt lúc
  // viết thân thư, khung cảnh báo kẹt ở "vui lòng đặt tên" rồi "vui lòng nhập
  // tiêu đề" — người soạn gõ nhầm một ô điền, hoặc dán vào một thẻ HTML, và
  // không hề biết cho tới lúc bấm lưu.
  //
  // Nên ô rỗng được thay bằng một ký tự giữ chỗ ở đây, và việc "chưa điền" được
  // nhắc ngay dưới chính ô đó, nơi mắt đang nhìn. Một ô rỗng không chứa ô điền
  // nào, nên không lỗi nội dung nào bị bỏ sót vì cách này.
  const missingName = !name.trim();
  const missingSubject = !subject.trim();
  const check = validateTemplate({
    kind,
    name: name.trim() || "—",
    subject: subject.trim() || "—",
    body
  });
  const preview = renderTemplate({ kind, subject, body, values: sampleValues(kind) });

  const isEditing = Boolean(template);
  const wasApproved = template?.status === "approved";

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <form action={saveAction} className="flex flex-col gap-4">
        <input type="hidden" name="kind" value={kind} />
        {template ? <input type="hidden" name="template_id" value={template.id} /> : null}

        <div>
          <label htmlFor="template-name" className="mb-1 block text-sm font-medium text-vam-ink">
            Tên mẫu thư
          </label>
          <input
            id="template-name"
            name="name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Ví dụ: Nhắc hạn nộp hồ sơ đợt 1"
            className="w-full rounded-md border border-vam-line px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-vam-green"
          />
          <p className={`mt-1 text-xs ${missingName ? "text-amber-800" : "text-slate-500"}`}>
            {missingName
              ? "Chưa đặt tên. Cần có tên trước khi lưu."
              : "Chỉ Core Team thấy tên này. Người nhận không thấy."}
          </p>
        </div>

        <div>
          <label htmlFor="template-subject" className="mb-1 block text-sm font-medium text-vam-ink">
            Tiêu đề thư
          </label>
          <input
            id="template-subject"
            name="subject"
            ref={subjectRef}
            value={subject}
            maxLength={MAX_SUBJECT_LENGTH}
            onChange={(event) => {
              setSubject(event.target.value);
              rememberCaret("subject");
            }}
            onFocus={() => rememberCaret("subject")}
            onClick={() => rememberCaret("subject")}
            onKeyUp={() => rememberCaret("subject")}
            placeholder="Thông báo từ Ban tổ chức {{mua}}"
            className="w-full rounded-md border border-vam-line px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-vam-green"
          />
          {missingSubject ? (
            <p className="mt-1 text-xs text-amber-800">Chưa có tiêu đề. Cần có trước khi lưu.</p>
          ) : null}
        </div>

        <div>
          <div className="mb-1 flex items-baseline justify-between gap-2">
            <label htmlFor="template-body" className="block text-sm font-medium text-vam-ink">
              Nội dung thư
            </label>
            <span className="text-xs tabular-nums text-slate-500">
              {body.length}/{MAX_BODY_LENGTH} ký tự
            </span>
          </div>
          <textarea
            id="template-body"
            name="body"
            ref={bodyRef}
            value={body}
            rows={14}
            maxLength={MAX_BODY_LENGTH}
            onChange={(event) => {
              setBody(event.target.value);
              rememberCaret("body");
            }}
            onFocus={() => rememberCaret("body")}
            onClick={() => rememberCaret("body")}
            onKeyUp={() => rememberCaret("body")}
            placeholder={"Chào {{ten_nguoi_nhan}},\n\nBan tổ chức xin thông báo..."}
            className="w-full rounded-md border border-vam-line px-3 py-2 font-mono text-sm leading-relaxed focus:outline-none focus:ring-1 focus:ring-vam-green"
          />
          <p className="mt-1 text-xs text-slate-500">
            Thư nhận văn bản thuần. Phần định dạng, chữ ký và khung thư do hệ thống tự dựng.
          </p>
        </div>

        {!check.ok ? (
          <p role="alert" className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            {check.message}
          </p>
        ) : check.warnings.length ? (
          <ul className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
            {check.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        ) : null}

        <Notice state={saveState} />

        <div className="flex flex-wrap items-center gap-3">
          <SubmitButton
            label={isEditing ? "Lưu thay đổi" : "Tạo bản nháp"}
            busyLabel="Đang lưu…"
          />
          {missingName || missingSubject ? (
            <p className="text-xs text-amber-800">
              {missingName && missingSubject
                ? "Còn thiếu tên mẫu thư và tiêu đề."
                : missingName
                  ? "Đặt tên cho mẫu thư trước đã."
                  : "Nhập tiêu đề thư trước đã."}
            </p>
          ) : null}
          {wasApproved ? (
            <p className="text-xs text-amber-800">
              Mẫu thư này đã được duyệt. Lưu thay đổi sẽ đưa nó về bản nháp và cần duyệt lại.
            </p>
          ) : null}
        </div>
      </form>

      <div className="flex flex-col gap-4">
        <section className="rounded-md border border-vam-line bg-white p-4">
          <h3 className="text-sm font-semibold text-vam-ink">Chèn thông tin vào thư</h3>
          <p className="mt-1 text-xs text-slate-500">
            Bấm một nút để chèn vào chỗ con trỏ đang đứng. Hệ thống điền giá trị thật của từng
            người lúc gửi.
          </p>
          <ul className="mt-3 flex flex-col gap-2">
            {spec.placeholders.map((placeholder) => (
              <li key={placeholder.key}>
                <button
                  type="button"
                  onClick={() => insertPlaceholder(placeholder.key)}
                  className="w-full rounded-md border border-vam-line px-3 py-2 text-left transition-colors hover:border-vam-green hover:bg-vam-mint"
                >
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="text-sm font-medium text-vam-ink">{placeholder.label}</span>
                    <code className="text-[11px] text-slate-500">
                      {placeholderToken(placeholder.key)}
                    </code>
                  </span>
                  <span className="mt-0.5 block text-xs text-slate-500">{placeholder.hint}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-md border border-vam-line bg-white p-4">
          <h3 className="text-sm font-semibold text-vam-ink">Xem trước</h3>
          <p className="mt-1 text-xs text-slate-500">
            Dùng dữ liệu mẫu, không phải người thật.
          </p>
          {preview.ok ? (
            <div className="mt-3">
              <p className="text-sm font-semibold text-vam-ink">{preview.subject}</p>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
                {preview.body}
              </p>
            </div>
          ) : (
            <p className="mt-3 text-sm text-slate-500">
              {subject || body
                ? "Chưa xem trước được: kiểm lại các ô đang dùng trong thư."
                : "Gõ tiêu đề và nội dung để xem trước."}
            </p>
          )}
        </section>

        {canApprove && template && template.status === "draft" ? (
          <form action={approveAction} className="rounded-md border border-vam-green/40 bg-vam-mint p-4">
            <input type="hidden" name="template_id" value={template.id} />
            <h3 className="text-sm font-semibold text-vam-ink">Duyệt mẫu thư</h3>
            <p className="mt-1 text-xs text-slate-600">
              Duyệt xong là mẫu thư này dùng được cho một lượt gửi hàng loạt. Gõ lại tiêu đề để
              xác nhận bạn đã đọc đúng bản này:
            </p>
            <p className="mt-2 rounded border border-vam-line bg-white px-2 py-1 text-sm font-medium text-vam-ink">
              {template.subject}
            </p>
            <input
              name="confirm_subject"
              autoComplete="off"
              placeholder="Gõ lại tiêu đề ở trên"
              className="mt-2 w-full rounded-md border border-vam-line px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-vam-green"
            />
            <div className="mt-3">
              <Notice state={approveState} />
            </div>
            <div className="mt-3">
              <SubmitButton label="Duyệt mẫu thư" busyLabel="Đang duyệt…" />
            </div>
          </form>
        ) : null}
      </div>
    </div>
  );
}
