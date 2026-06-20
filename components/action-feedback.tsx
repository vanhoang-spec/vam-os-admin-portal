"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { cn } from "@/lib/utils";
import { logActionTiming } from "@/lib/action-feedback";

type ActionStateLike = {
  ok?: boolean;
  message?: string | null;
};

export function LoadingButton({
  children,
  pendingLabel,
  className,
  disabled,
  type = "submit",
  onClick,
  title
}: {
  children: React.ReactNode;
  pendingLabel: string;
  className?: string;
  disabled?: boolean;
  type?: "submit" | "button";
  onClick?: React.MouseEventHandler<HTMLButtonElement>;
  title?: string;
}) {
  const { pending } = useFormStatus();
  const isDisabled = Boolean(disabled || pending);

  return (
    <button
      type={type}
      disabled={isDisabled}
      onClick={onClick}
      title={title}
      aria-busy={pending}
      className={cn("inline-flex items-center justify-center gap-2 disabled:cursor-not-allowed disabled:opacity-60", className)}
    >
      {pending ? (
        <>
          <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-r-transparent" aria-hidden="true" />
          <span>{pendingLabel}</span>
        </>
      ) : (
        children
      )}
    </button>
  );
}

export function InlineActionMessage({
  state,
  successFallback,
  errorFallback = "Không thể thực hiện thao tác. Vui lòng thử lại.",
  showSavedAt = false,
  className
}: {
  state: ActionStateLike;
  successFallback?: string;
  errorFallback?: string;
  showSavedAt?: boolean;
  className?: string;
}) {
  const hasMessage = Boolean(state.message);
  const text = state.message ?? (state.ok ? successFallback : null);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  useEffect(() => {
    if (state.ok && showSavedAt) {
      setSavedAt(new Intl.DateTimeFormat("vi-VN", { hour: "2-digit", minute: "2-digit" }).format(new Date()));
    }
  }, [state.ok, state.message, showSavedAt]);

  if (!text && !hasMessage) return null;

  const isSuccess = Boolean(state.ok);
  return (
    <div
      role={isSuccess ? "status" : "alert"}
      className={cn(
        "rounded-md border px-3 py-2 text-sm",
        isSuccess ? "border-green-200 bg-green-50 text-green-700" : "border-red-200 bg-red-50 text-red-700",
        className
      )}
    >
      {text ?? errorFallback}
      {isSuccess && showSavedAt && savedAt ? <span className="ml-1 font-medium">Đã lưu lúc {savedAt}.</span> : null}
    </div>
  );
}

export function ConfirmActionDialog({
  triggerLabel,
  pendingLabel,
  title,
  description,
  confirmLabel,
  cancelLabel = "Hủy",
  triggerClassName,
  confirmClassName,
  disabled,
  warning,
  onOpen
}: {
  triggerLabel: React.ReactNode;
  pendingLabel: string;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
  triggerClassName?: string;
  confirmClassName?: string;
  disabled?: boolean;
  warning?: string | null;
  onOpen?: () => void;
}) {
  const { pending } = useFormStatus();
  const titleId = useId();
  const descriptionId = useId();
  const [open, setOpen] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) cancelRef.current?.focus();
  }, [open]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && open && !pending) setOpen(false);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, pending]);

  return (
    <>
      <button
        type="button"
        disabled={disabled || pending}
        onClick={() => {
          onOpen?.();
          setOpen(true);
        }}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={cn("inline-flex items-center justify-center disabled:cursor-not-allowed disabled:opacity-60", triggerClassName)}
      >
        {pending ? pendingLabel : triggerLabel}
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4" role="presentation">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={descriptionId}
            className="w-full max-w-md rounded-lg border border-vam-line bg-white p-4 shadow-lg"
          >
            <h2 id={titleId} className="text-base font-semibold text-vam-ink">
              {title}
            </h2>
            <p id={descriptionId} className="mt-2 text-sm text-slate-600">
              {description}
            </p>
            {warning ? (
              <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800">
                {warning}
              </div>
            ) : null}
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <button
                ref={cancelRef}
                type="button"
                disabled={pending}
                onClick={() => setOpen(false)}
                className="rounded-md border border-vam-line bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
              >
                {cancelLabel}
              </button>
              <LoadingButton
                pendingLabel={pendingLabel}
                className={cn("rounded-md px-3 py-2 text-sm font-medium", confirmClassName)}
              >
                {confirmLabel}
              </LoadingButton>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

export function useActionTiming(actionName: string, state: ActionStateLike) {
  const startedAtRef = useRef<number | null>(null);
  const resultCountRef = useRef(0);

  useEffect(() => {
    if (!state.message || startedAtRef.current === null) return;
    resultCountRef.current += 1;
    logActionTiming(actionName, {
      durationMs: Math.round(performance.now() - startedAtRef.current),
      ok: Boolean(state.ok),
      resultCount: resultCountRef.current
    });
    startedAtRef.current = null;
  }, [actionName, state.message, state.ok]);

  return {
    markSubmitStart() {
      startedAtRef.current = performance.now();
    }
  };
}
