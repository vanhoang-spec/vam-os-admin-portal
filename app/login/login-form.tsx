"use client";

import React, { useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import {
  loginAction,
  requestMagicLinkAction,
  requestPasswordResetAction,
  type LoginActionState,
  type MagicLinkActionState,
  type PasswordResetActionState
} from "./actions";
import { Eye, EyeOff, Loader2 } from "lucide-react";

const initialState: LoginActionState = {
  error: null
};

const initialMagicLinkState: MagicLinkActionState = {
  error: null,
  sent: false
};

const initialPasswordResetState: PasswordResetActionState = {
  error: null,
  sent: false
};

/**
 * Sign-in link button.
 *
 * Its own submit button because it lives in its own <form>: two form actions
 * cannot share one, and useFormStatus only reports on the form it sits inside.
 */
function MagicLinkButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="flex h-11 items-center justify-center gap-2 rounded-md border border-vam-green px-4 text-sm font-semibold text-vam-green hover:bg-vam-mint disabled:cursor-not-allowed disabled:opacity-70"
    >
      {pending && <Loader2 className="h-4 w-4 animate-spin" data-testid="magic-link-spinner" />}
      {pending ? "Đang gửi..." : "Gửi liên kết đăng nhập qua email"}
    </button>
  );
}

/**
 * Nút xin link đặt lại mật khẩu. Cũng phải nằm trong <form> của riêng nó, cùng
 * lý do với nút bên trên: useFormStatus chỉ báo về đúng form nó đứng trong.
 */
function PasswordResetButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="flex h-11 items-center justify-center gap-2 rounded-md border border-vam-green px-4 text-sm font-semibold text-vam-green hover:bg-vam-mint disabled:cursor-not-allowed disabled:opacity-70"
    >
      {pending && <Loader2 className="h-4 w-4 animate-spin" data-testid="password-reset-spinner" />}
      {pending ? "Đang gửi..." : "Đặt lại mật khẩu"}
    </button>
  );
}

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
  const [magicLinkState, magicLinkAction] = useFormState(
    requestMagicLinkAction,
    initialMagicLinkState
  );
  const [passwordResetState, passwordResetAction] = useFormState(
    requestPasswordResetAction,
    initialPasswordResetState
  );
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
    <>
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

    {/*
      A second, separate route in for people who hold an account for one season
      and use it a handful of times — the mentors invited to score applications.
      A password they must invent and remember is the largest piece of friction
      in that flow, and clicking a link in their own mailbox proves the same
      thing. It is a sibling form, not a second button on the one above: two
      form actions cannot share a single <form>.
    */}
    <div className="mt-6 border-t border-vam-line pt-5">
      <p className="text-sm text-slate-600">
        Chưa đặt mật khẩu, hoặc không nhớ mật khẩu?
      </p>

      {/*
        Đặt lại mật khẩu đứng TRƯỚC liên kết đăng nhập, và đó là chủ ý. Người
        vào đây phần lớn muốn lấy lại quyền kiểm soát tài khoản chứ không chỉ
        vào một lần: liên kết đăng nhập cho họ vào được hôm nay rồi để họ quên
        y như cũ vào lần sau. Ai chỉ cần vào nhanh vẫn có nút thứ hai ngay dưới.
      */}
      <form action={passwordResetAction} className="mt-3 grid gap-3">
        <input type="hidden" name="email" value={email} />
        {passwordResetState.sent ? (
          <div
            className="rounded-md border border-vam-green bg-vam-mint/40 px-3 py-2 text-sm text-vam-ink"
            role="status"
          >
            Nếu email này có tài khoản, chúng tôi đã gửi một liên kết đặt lại mật khẩu. Vui
            lòng kiểm tra hộp thư, kể cả mục Spam.
          </div>
        ) : (
          <>
            {passwordResetState.error ? (
              <div
                className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
                role="alert"
              >
                {passwordResetState.error}
              </div>
            ) : null}
            <PasswordResetButton />
            <p className="text-xs leading-5 text-slate-500">
              Chúng tôi gửi một liên kết tới email ở trên để anh/chị tự đặt mật khẩu mới.
              Không cần nhờ ban tổ chức.
            </p>
          </>
        )}
      </form>

      <form action={magicLinkAction} className="mt-4 grid gap-3 border-t border-dashed border-vam-line pt-4">
        <input type="hidden" name="next" value={next} />
        <input type="hidden" name="email" value={email} />
        {magicLinkState.sent ? (
          <div
            className="rounded-md border border-vam-green bg-vam-mint/40 px-3 py-2 text-sm text-vam-ink"
            role="status"
          >
            Nếu email này có tài khoản, chúng tôi đã gửi một liên kết đăng nhập. Vui lòng
            kiểm tra hộp thư, kể cả mục Spam.
          </div>
        ) : (
          <>
            {magicLinkState.error ? (
              <div
                className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
                role="alert"
              >
                {magicLinkState.error}
              </div>
            ) : null}
            <MagicLinkButton />
            <p className="text-xs leading-5 text-slate-500">
              Chỉ cần vào một lần? Chúng tôi gửi một liên kết tới email ở trên. Bấm vào liên
              kết đó là vào thẳng, không cần mật khẩu.
            </p>
          </>
        )}
      </form>
    </div>
    </>
  );
}
