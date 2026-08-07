"use client";

import React from "react";
import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface SubmitButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  pendingText?: string;
  variant?: "primary" | "secondary" | "danger" | "outline";
}

export const SubmitButton = React.forwardRef<HTMLButtonElement, SubmitButtonProps>(
  ({ children, pendingText, disabled, className, variant = "primary", ...props }, ref) => {
    const { pending } = useFormStatus();
    const isDisabled = pending || disabled;

    const baseClasses =
      "inline-flex h-11 items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50";

    const variants = {
      primary: "bg-vam-green text-white hover:bg-vam-green/90",
      secondary: "bg-slate-100 text-slate-900 hover:bg-slate-200",
      danger: "bg-red-600 text-white hover:bg-red-700",
      outline: "border border-vam-line bg-white text-vam-green hover:bg-slate-50",
    };

    return (
      <button
        ref={ref}
        type="submit"
        disabled={isDisabled}
        aria-disabled={isDisabled}
        aria-busy={pending}
        className={cn(baseClasses, variants[variant], className)}
        {...props}
      >
        {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
        <span aria-live="polite" className="sr-only">
          {pending ? (pendingText || "Đang xử lý...") : ""}
        </span>
        {pending && pendingText ? pendingText : children}
      </button>
    );
  }
);

SubmitButton.displayName = "SubmitButton";
