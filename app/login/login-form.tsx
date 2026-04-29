"use client";

import { useFormState } from "react-dom";
import { loginAction, type LoginActionState } from "./actions";

const initialState: LoginActionState = {
  error: null
};

export function LoginForm({ next }: { next: string }) {
  const [state, formAction] = useFormState(loginAction, initialState);

  return (
    <form action={formAction} className="grid gap-4">
      <input type="hidden" name="next" value={next} />
      <label className="grid gap-2">
        <span className="text-sm font-medium text-vam-ink">Email</span>
        <input
          name="email"
          type="email"
          autoComplete="email"
          className="h-11 rounded-md border border-vam-line bg-white px-3 text-sm outline-none focus:border-vam-green"
          required
        />
      </label>
      <label className="grid gap-2">
        <span className="text-sm font-medium text-vam-ink">Mật khẩu</span>
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          className="h-11 rounded-md border border-vam-line bg-white px-3 text-sm outline-none focus:border-vam-green"
          required
        />
      </label>
      {state.error ? <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</div> : null}
      <button type="submit" className="h-11 rounded-md bg-vam-green px-4 text-sm font-semibold text-white hover:bg-vam-ink">
        Đăng nhập
      </button>
    </form>
  );
}
