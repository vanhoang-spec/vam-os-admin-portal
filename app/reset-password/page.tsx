"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// Browser Supabase client — created fresh for this page so that
// detectSessionInUrl is explicitly enabled and we have a clean auth state.
// ---------------------------------------------------------------------------

function createBrowserClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = (
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  )?.trim();
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: true
    }
  });
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PageState =
  | "loading"    // waiting for onAuthStateChange / timeout
  | "ready"      // PASSWORD_RECOVERY event received — show form
  | "invalid"    // token missing, expired, or env misconfigured
  | "submitting" // updateUser call in-flight
  | "success"    // password updated
  | "error";     // updateUser failed

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ResetPasswordPage() {
  const [pageState, setPageState] = useState<PageState>("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  // Stable client ref — createBrowserClient is called once on mount.
  const [client] = useState<SupabaseClient | null>(() => createBrowserClient());

  useEffect(() => {
    if (!client) {
      setPageState("invalid");
      setErrorMessage("Cấu hình hệ thống chưa đầy đủ. Vui lòng liên hệ quản trị viên.");
      return;
    }

    let settled = false;

    // Supabase detects the recovery token from the URL hash and fires
    // PASSWORD_RECOVERY (or SIGNED_IN when the session is established).
    const {
      data: { subscription }
    } = client.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") {
        if (!settled) {
          settled = true;
          setPageState("ready");
        }
      }
    });

    // Fallback: if no event fires within 4 s the token is invalid/expired.
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        setPageState("invalid");
        setErrorMessage(
          "Link đặt lại mật khẩu không hợp lệ hoặc đã hết hạn. " +
          "Vui lòng yêu cầu gửi lại email khôi phục mật khẩu."
        );
      }
    }, 4000);

    return () => {
      subscription.unsubscribe();
      clearTimeout(timer);
    };
  }, [client]);

  // ---------------------------------------------------------------------------
  // Submit handler
  // ---------------------------------------------------------------------------

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!client) return;

    setErrorMessage(null);

    if (password.length < 8) {
      setErrorMessage("Mật khẩu phải có ít nhất 8 ký tự.");
      return;
    }
    if (password !== confirm) {
      setErrorMessage("Mật khẩu nhập lại không khớp.");
      return;
    }

    setPageState("submitting");

    const { error } = await client.auth.updateUser({ password });
    if (error) {
      setPageState("error");
      setErrorMessage(`Không thể cập nhật mật khẩu: ${error.message}`);
      return;
    }

    // Sign out so the recovery session doesn't linger.
    await client.auth.signOut();
    setPageState("success");
  }

  // ---------------------------------------------------------------------------
  // Render helpers
  // ---------------------------------------------------------------------------

  const isFormVisible =
    pageState === "ready" || pageState === "submitting" || pageState === "error";

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f7faf8] px-4 py-12">
      <div className="w-full max-w-md rounded-2xl border border-vam-line bg-white p-8 shadow-sm">
        {/* Logo / brand */}
        <div className="mb-6 text-center">
          <span className="inline-block rounded-xl bg-vam-green px-4 py-1.5 text-sm font-bold tracking-wide text-white">
            VAM OS
          </span>
          <h1 className="mt-4 text-xl font-bold text-vam-ink">Đặt lại mật khẩu</h1>
        </div>

        {/* ── Loading ── */}
        {pageState === "loading" && (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-vam-mint border-t-vam-green" />
            <p className="text-sm text-slate-500">Đang xác thực link khôi phục…</p>
          </div>
        )}

        {/* ── Invalid token ── */}
        {pageState === "invalid" && (
          <div className="space-y-4 py-2 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-50">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-6 w-6 text-red-500"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
                />
              </svg>
            </div>
            <p className="text-sm font-medium text-red-700">Link không hợp lệ</p>
            {errorMessage && (
              <p className="text-sm text-slate-600">{errorMessage}</p>
            )}
            <Link
              href="/login"
              className="mt-2 inline-block rounded-md border border-vam-line px-4 py-2 text-sm font-medium text-vam-green hover:bg-vam-mint"
            >
              Quay lại đăng nhập
            </Link>
          </div>
        )}

        {/* ── Password form (ready / submitting / error) ── */}
        {isFormVisible && (
          <form onSubmit={handleSubmit} className="space-y-4">
            <p className="text-sm text-slate-600">
              Nhập mật khẩu mới cho tài khoản VAM OS của bạn.
            </p>

            <div>
              <label
                htmlFor="password"
                className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500"
              >
                Mật khẩu mới
              </label>
              <input
                id="password"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={pageState === "submitting"}
                placeholder="Tối thiểu 8 ký tự"
                className="w-full rounded-md border border-vam-line bg-white px-3 py-2 text-sm text-vam-ink outline-none focus:border-vam-green focus:ring-2 focus:ring-vam-mint disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400"
              />
            </div>

            <div>
              <label
                htmlFor="confirm"
                className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500"
              >
                Nhập lại mật khẩu
              </label>
              <input
                id="confirm"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                disabled={pageState === "submitting"}
                placeholder="Nhập lại mật khẩu ở trên"
                className="w-full rounded-md border border-vam-line bg-white px-3 py-2 text-sm text-vam-ink outline-none focus:border-vam-green focus:ring-2 focus:ring-vam-mint disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400"
              />
            </div>

            {errorMessage && (
              <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {errorMessage}
              </p>
            )}

            <button
              type="submit"
              disabled={pageState === "submitting"}
              className="w-full rounded-md bg-vam-green px-4 py-2 text-sm font-medium text-white hover:bg-vam-green/90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {pageState === "submitting" ? "Đang cập nhật…" : "Đặt lại mật khẩu"}
            </button>

            <div className="text-center">
              <Link
                href="/login"
                className="text-xs text-slate-500 hover:text-vam-green hover:underline"
              >
                Quay lại đăng nhập
              </Link>
            </div>
          </form>
        )}

        {/* ── Success ── */}
        {pageState === "success" && (
          <div className="space-y-4 py-2 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-green-50">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-6 w-6 text-vam-green"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M5 13l4 4L19 7"
                />
              </svg>
            </div>
            <p className="text-sm font-semibold text-vam-ink">Mật khẩu đã được cập nhật!</p>
            <p className="text-sm text-slate-600">
              Bạn có thể đăng nhập bằng mật khẩu mới ngay bây giờ.
            </p>
            <Link
              href="/login"
              className="inline-block rounded-md bg-vam-green px-5 py-2 text-sm font-medium text-white hover:bg-vam-green/90"
            >
              Đăng nhập
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
