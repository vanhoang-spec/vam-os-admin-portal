"use client";

import React, { useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { loginAction, type LoginActionState } from "./actions";
import { Eye, EyeOff, Loader2 } from "lucide-react";

const initialState: LoginActionState = {
  error: null
};

function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="flex h-11 items-center justify-center gap-2 rounded-md bg-vam-green px-4 text-sm font-semibold text-white hover:bg-vam-ink disabled:cursor-not-allowed disabled:opacity-70"
    >
      {pending && <Loader2 className="h-4 w-4 animate-spin" data-testid="login-spinner" />}
      {pending ? "Đang đăng nhập..." : "Đăng nhập"}
    </button>
  );
}

export function LoginForm({ next }: { next: string }) {
  const [state, formAction] = useFormState(loginAction, initialState);
  const [showPassword, setShowPassword] = useState(false);
  const [email, setEmail] = useState("");
  const submitLock = React.useRef(false);

  // `state` only changes when the server action RETURNED a value, i.e. it
  // completed without redirecting. Releasing the lock here therefore happens
  // exactly once per failed submission, and never on the success path (where
  // `redirect()` means the action never resolves to a new state and the lock
  // stays engaged through navigation).
  React.useEffect(() => {
    submitLock.current = false;
  }, [state]);

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    if (submitLock.current) {
      // A submission is already in flight. Cancelling the default here makes
      // React's form-action plugin bail out before it can start a second
      // server-action invocation (it skips the action when the submit event
      // was already default-prevented).
      e.preventDefault();
      return;
    }
    // Acquire synchronously, then let React handle the submit natively. We
    // deliberately do NOT preventDefault and do NOT call formAction() by hand:
    // only the native path runs startHostTransition(), which is what makes
    // useFormStatus() report `pending` to <SubmitButton />.
    submitLock.current = true;
  };

  const handleEmailBlur = () => {
    setEmail((prev) => prev.trim().toLowerCase());
  };

  return (
    <form action={formAction} onSubmit={handleSubmit} className="grid gap-4">
      <input type="hidden" name="next" value={next} />
      <label className="grid gap-2">
        <span className="text-sm font-medium text-vam-ink">Email</span>
        <input
          name="email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onBlur={handleEmailBlur}
          className="h-11 rounded-md border border-vam-line bg-white px-3 text-sm outline-none focus:border-vam-green"
          required
        />
      </label>
      <label className="grid gap-2">
        <span className="text-sm font-medium text-vam-ink">Mật khẩu</span>
        <div className="relative">
          <input
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            className="h-11 w-full rounded-md border border-vam-line bg-white px-3 pr-10 text-sm outline-none focus:border-vam-green"
            required
          />
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            className="absolute right-0 top-0 flex h-11 w-11 items-center justify-center text-slate-400 hover:text-slate-600 focus:outline-none focus:ring-2 focus:ring-vam-green focus:ring-offset-1 rounded-md"
            aria-label={showPassword ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
          >
            {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
          </button>
        </div>
      </label>
      {state.error ? <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{state.error}</div> : null}
      <SubmitButton />
    </form>
  );
}
