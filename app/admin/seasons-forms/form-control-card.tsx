"use client";

import { useState } from "react";
import { useFormState } from "react-dom";
import { Check, Copy, ExternalLink } from "lucide-react";
import { SubmitButton } from "@/components/submit-button";
import { setApplicationFormStateAction } from "@/app/actions/application-form-controls";
import { initialFormControlActionState } from "@/lib/application-form-control-types";
import type { ApplicantRole, ApplicationFormState } from "@/lib/application-form-controls";
import { formatDateTime } from "@/lib/utils";

export type RoleControlView = {
  role: ApplicantRole;
  state: ApplicationFormState;
  updatedAt: string | null;
  updatedByName: string | null;
  updatedByEmail: string | null;
  publicPath: string;
};

const ROLE_LABEL: Record<ApplicantRole, string> = {
  mentor: "Mentor",
  mentee: "Mentee"
};

const STATE_LABEL: Record<ApplicationFormState, string> = {
  closed: "ĐÓNG",
  pilot: "PILOT (chỉ người có link token)",
  open: "MỞ CÔNG KHAI"
};

const STATE_CLASS: Record<ApplicationFormState, string> = {
  closed: "bg-slate-100 text-slate-700 border-slate-300",
  pilot: "bg-amber-50 text-amber-800 border-amber-300",
  open: "bg-vam-mint text-vam-green border-vam-green"
};

/**
 * The confirmation each transition demands. Opening to the public internet
 * gets the loudest wording; closing gets its own warning because it silently
 * strands anyone part-way through the form.
 */
function confirmationText(role: ApplicantRole, next: ApplicationFormState) {
  const who = ROLE_LABEL[role];
  if (next === "open") {
    return `Mở công khai form ${who} Season 12?\n\nBất kỳ ai có đường link đều có thể nộp đơn ngay lập tức. Mùa: UEHM-S12 · Đợt: UEHM-S12-B1.`;
  }
  if (next === "pilot") {
    return `Chuyển form ${who} Season 12 sang chế độ PILOT?\n\nChỉ người có đường link kèm token mới truy cập và nộp đơn được. Mùa: UEHM-S12 · Đợt: UEHM-S12-B1.`;
  }
  return `Đóng form ${who} Season 12?\n\nĐơn mới sẽ bị từ chối ngay lập tức, kể cả với người đang mở sẵn form. Đơn đã nộp không bị ảnh hưởng. Mùa: UEHM-S12 · Đợt: UEHM-S12-B1.`;
}

function CopyLinkButton({ path }: { path: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    // Resolved in the browser so the copied link matches the origin the
    // admin is actually on (preview vs production), rather than a value
    // baked in at build time.
    const url = `${window.location.origin}${path}`;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // Clipboard is blocked in some embedded/insecure contexts.
      window.prompt("Sao chép đường link:", url);
      return;
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <button
      type="button"
      onClick={copy}
      className="inline-flex h-9 items-center gap-1.5 rounded-md border border-vam-line bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50"
    >
      {copied ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
      {copied ? "Đã sao chép" : "Sao chép link"}
    </button>
  );
}

function StateButton({
  control,
  next,
  canToggle
}: {
  control: RoleControlView;
  next: ApplicationFormState;
  canToggle: boolean;
}) {
  const isCurrent = control.state === next;

  const label =
    next === "open" ? "Mở công khai" : next === "pilot" ? "Pilot (cần token)" : "Đóng";

  if (isCurrent) {
    return (
      <span className="inline-flex h-11 items-center rounded-md border border-vam-green bg-vam-mint px-4 text-sm font-medium text-vam-green">
        {label} · hiện tại
      </span>
    );
  }

  return (
    <SubmitButton
      name="next_state"
      value={next}
      variant={next === "open" ? "primary" : next === "closed" ? "danger" : "secondary"}
      disabled={!canToggle}
      pendingText="Đang cập nhật..."
      onClick={(event) => {
        if (!window.confirm(confirmationText(control.role, next))) {
          event.preventDefault();
        }
      }}
    >
      {label}
    </SubmitButton>
  );
}

export function FormControlCard({
  control,
  canToggle
}: {
  control: RoleControlView;
  canToggle: boolean;
}) {
  const [state, formAction] = useFormState(
    setApplicationFormStateAction,
    initialFormControlActionState
  );

  // Only ever renders what the server last confirmed. There is no optimistic
  // local state: after a successful action the page revalidates and this
  // component is re-rendered from a fresh server read.
  const feedback = state.message;

  return (
    <div className="rounded-lg border border-vam-line bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-vam-ink">{ROLE_LABEL[control.role]}</h3>
          <p className="mt-1 text-sm text-slate-600">
            Trạng thái:{" "}
            <span
              className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${STATE_CLASS[control.state]}`}
            >
              {STATE_LABEL[control.state]}
            </span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <CopyLinkButton path={control.publicPath} />
          <a
            href={control.publicPath}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-vam-line bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            Mở trang
          </a>
        </div>
      </div>

      <p className="mt-2 break-all font-mono text-xs text-slate-500">{control.publicPath}</p>

      <p className="mt-3 text-xs text-slate-500">
        {control.updatedAt
          ? `Thay đổi lần cuối: ${formatDateTime(control.updatedAt)} · ${
              control.updatedByName || control.updatedByEmail || "không rõ người thực hiện"
            }`
          : "Chưa có thay đổi nào được ghi nhận."}
      </p>

      <form action={formAction} className="mt-4 flex flex-wrap items-center gap-2">
        <input type="hidden" name="applicant_role" value={control.role} />
        {/*
          The state this page was rendered with. The RPC compares it to the
          row it locks and refuses if they differ, so an admin acting on a
          stale tab cannot silently undo someone else's change.
        */}
        <input type="hidden" name="expected_state" value={control.state} />

        <StateButton control={control} next="closed" canToggle={canToggle} />
        <StateButton control={control} next="pilot" canToggle={canToggle} />
        <StateButton control={control} next="open" canToggle={canToggle} />
      </form>

      {!canToggle ? (
        <p className="mt-3 text-xs text-slate-500">
          Bạn chỉ có quyền xem trạng thái này.
        </p>
      ) : null}

      {feedback ? (
        <p
          role="status"
          className={`mt-3 rounded-md border px-3 py-2 text-sm ${
            state.ok
              ? "border-vam-green bg-vam-mint text-vam-green"
              : "border-red-200 bg-red-50 text-red-700"
          }`}
        >
          {feedback}
        </p>
      ) : null}
    </div>
  );
}
