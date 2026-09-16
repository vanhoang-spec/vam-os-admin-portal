"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useFormState } from "react-dom";
import {
  addApplicationBonusRuleAction,
  deleteApplicationBonusRuleAction
} from "@/app/actions/submission-bonus";
import { InlineActionMessage, LoadingButton } from "@/components/action-feedback";
import { maskVietnamDate, parseVietnamDateInput } from "@/lib/event-datetime";
import {
  BONUS_LABEL_MAX,
  BONUS_POINTS_MAX,
  BONUS_POINTS_MIN,
  initialBonusRuleActionState
} from "@/lib/submission-bonus-core";

const LF = String.fromCharCode(10);

const FIELD_CLASS =
  "mt-1 w-full rounded-md border border-vam-line bg-white px-3 py-2 text-sm text-vam-ink outline-none focus:border-vam-green focus:ring-2 focus:ring-vam-mint";

/**
 * Ô ngày DD/MM/YYYY. Gửi thẳng chữ người vận hành gõ, để máy chủ phân biệt được ô
 * TRỐNG với ô GÕ DỞ — gửi một ngày ISO rỗng cho cả hai thì "10/09/20" thành
 * "không có mốc", tức cộng điểm cho mọi đơn về sau.
 */
function DateInput({
  id,
  name,
  label,
  hint,
  value,
  onChange
}: {
  id: string;
  name: string;
  label: string;
  hint: string;
  value: string;
  onChange: (next: string) => void;
}) {
  const complete = value.replace(/[^0-9]/g, "").length === 8;
  const bad = (value !== "" && !complete) || (complete && !parseVietnamDateInput(value));
  return (
    <div className="grid">
      {/* Nhãn chỉ chứa tên ô; lời nhắc nối bằng aria-describedby, để trình đọc màn hình không đọc cả câu nhắc làm tên ô. */}
      <label htmlFor={id} className="text-sm font-medium text-vam-ink">
        {label}
      </label>
      <input
        id={id}
        name={name}
        aria-describedby={`${id}-hint`}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder="dd/mm/yyyy"
        value={value}
        onChange={(event) => onChange(maskVietnamDate(event.target.value))}
        className={`${FIELD_CLASS} tabular-nums`}
      />
      <span id={`${id}-hint`} className={`mt-1 text-xs ${bad ? "font-medium text-amber-800" : "text-slate-500"}`}>
        {bad ? (complete ? "Ngày không có thật." : "Chưa gõ đủ ngày/tháng/năm.") : hint}
      </span>
    </div>
  );
}

export function AddBonusRuleForm({ role, roleLabel }: { role: "mentor" | "mentee"; roleLabel: string }) {
  const [state, formAction] = useFormState(addApplicationBonusRuleAction, initialBonusRuleActionState);
  const [label, setLabel] = useState("");
  const [startsOn, setStartsOn] = useState("");
  const [endsOn, setEndsOn] = useState("");
  const [points, setPoints] = useState("3");
  const formRef = useRef<HTMLFormElement>(null);
  const baseId = useId();

  // Next đặt lại form sau mỗi lần action chạy xong, kể cả khi lưu hỏng. Lưu hỏng
  // mà mất chữ vừa gõ thì người dùng phải gõ lại cả bốn ô chỉ vì một ô sai.
  useEffect(() => {
    const form = formRef.current;
    if (!form) return;
    const keep = (event: Event) => event.preventDefault();
    form.addEventListener("reset", keep);
    return () => form.removeEventListener("reset", keep);
  }, []);

  // Thêm xong thì dọn ô, để lần bấm tiếp theo không thêm trùng mốc vừa thêm.
  useEffect(() => {
    if (!state.ok) return;
    setLabel("");
    setStartsOn("");
    setEndsOn("");
    setPoints("3");
  }, [state]);

  return (
    <form ref={formRef} action={formAction} className="grid gap-4" data-testid={`add-bonus-${role}`}>
      <input type="hidden" name="role" value={role} />
      <div className="grid gap-4 sm:grid-cols-2">
        <DateInput
          id={`${baseId}-from`}
          name="starts_on"
          label="Nộp từ ngày"
          hint="Để trống nếu tính từ lúc mở form."
          value={startsOn}
          onChange={setStartsOn}
        />
        <DateInput
          id={`${baseId}-to`}
          name="ends_on"
          label="Đến hết ngày"
          hint="Tính đến 23:59 ngày này. Để trống nếu không có mốc cuối."
          value={endsOn}
          onChange={setEndsOn}
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-[10rem_1fr]">
        <label htmlFor={`${baseId}-points`} className="grid text-sm font-medium text-vam-ink">
          Cộng thêm (điểm)
          <input
            id={`${baseId}-points`}
            name="points"
            type="number"
            inputMode="numeric"
            min={BONUS_POINTS_MIN}
            max={BONUS_POINTS_MAX}
            step={1}
            required
            value={points}
            onChange={(event) => setPoints(event.target.value)}
            className={`${FIELD_CLASS} tabular-nums`}
          />
        </label>
        <label htmlFor={`${baseId}-label`} className="grid text-sm font-medium text-vam-ink">
          Tên mốc (không bắt buộc)
          <input
            id={`${baseId}-label`}
            name="label"
            type="text"
            maxLength={BONUS_LABEL_MAX}
            placeholder="Ví dụ: Nộp sớm đợt 1"
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            className={FIELD_CLASS}
          />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <LoadingButton
          pendingLabel="Đang thêm…"
          className="inline-flex h-10 items-center rounded-md bg-vam-green px-4 text-sm font-medium text-white hover:bg-vam-ink disabled:opacity-50"
        >
          Thêm mốc cho form {roleLabel}
        </LoadingButton>
        <InlineActionMessage state={state} />
      </div>
    </form>
  );
}

export function DeleteBonusRuleButton({
  role,
  ruleId,
  description
}: {
  role: "mentor" | "mentee";
  ruleId: string;
  description: string;
}) {
  const [state, formAction] = useFormState(deleteApplicationBonusRuleAction, initialBonusRuleActionState);
  return (
    <form action={formAction} className="grid justify-items-end gap-1">
      <input type="hidden" name="role" value={role} />
      <input type="hidden" name="rule_id" value={ruleId} />
      {/* Chặn ở nút, như nút mở/đóng form: cùng một cách hỏi lại ở mọi thao tác đổi thứ người khác đang dựa vào. */}
      <LoadingButton
        onClick={(event) => {
          if (!window.confirm(`Xoá mốc "${description}"?${LF}${LF}Các đơn đang được cộng điểm từ mốc này sẽ không còn được cộng.`)) {
            event.preventDefault();
          }
        }}
        pendingLabel="Đang xoá…"
        className="inline-flex h-8 items-center rounded-md border border-red-200 bg-white px-3 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
      >
        Xoá
      </LoadingButton>
      {!state.ok && state.message ? <InlineActionMessage state={state} /> : null}
    </form>
  );
}
