"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { completeEmailLinkSignIn } from "./actions";

/**
 * Landing page for every emailed auth link: invite, magic link, recovery.
 *
 * The tokens arrive in the URL FRAGMENT, which no server ever receives, so the
 * reading has to happen here. It is done by parsing `location.hash` directly
 * rather than by booting a Supabase client with `detectSessionInUrl`: the
 * parse is deterministic, there is no listener to race, and the token is
 * verified server-side in the action anyway, so the client gains nothing by
 * validating it first.
 */
type PageState = "working" | "error";

function readHashParams(): URLSearchParams {
  if (typeof window === "undefined") return new URLSearchParams();
  return new URLSearchParams(window.location.hash.replace(/^#/, ""));
}

export default function AuthCallbackPage() {
  const router = useRouter();
  const [state, setState] = useState<PageState>("working");
  const [message, setMessage] = useState<string>("");
  // Strict Mode double-invokes effects in development; exchanging the same
  // token twice would race two cookie writes for one sign-in.
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    const params = readHashParams();
    const linkError = params.get("error_description") ?? params.get("error");
    const accessToken = params.get("access_token");
    const refreshToken = params.get("refresh_token");
    const expiresIn = Number(params.get("expires_in") ?? "3600");

    const search = new URLSearchParams(window.location.search);
    const next = search.get("next");

    // Take the tokens out of the address bar (and out of the history entry)
    // before anything else can read them over the user's shoulder.
    window.history.replaceState(null, "", window.location.pathname + window.location.search);

    if (linkError) {
      setState("error");
      setMessage(
        "Liên kết đã hết hạn hoặc đã được dùng. Vui lòng yêu cầu một liên kết đăng nhập mới."
      );
      return;
    }

    if (!accessToken || !refreshToken) {
      setState("error");
      setMessage(
        "Không tìm thấy thông tin đăng nhập trong liên kết. Vui lòng mở lại liên kết trong email, hoặc yêu cầu liên kết mới."
      );
      return;
    }

    completeEmailLinkSignIn({ accessToken, refreshToken, expiresIn, next })
      .then((result) => {
        if (result.ok) {
          router.replace(result.next);
          return;
        }
        setState("error");
        setMessage(result.error);
      })
      .catch(() => {
        setState("error");
        setMessage("Không hoàn tất được đăng nhập. Vui lòng thử lại.");
      });
  }, [router]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-md rounded-lg border border-vam-line bg-white p-6 shadow-soft">
        {state === "working" ? (
          <div className="flex items-center gap-3 text-sm text-slate-600">
            <Loader2 className="h-5 w-5 animate-spin text-vam-green" />
            Đang đăng nhập...
          </div>
        ) : (
          <>
            <h1 className="text-lg font-semibold text-vam-ink">Không đăng nhập được</h1>
            <p className="mt-2 text-sm leading-6 text-slate-600">{message}</p>
            <Link
              href="/login"
              className="mt-4 inline-flex h-11 items-center justify-center rounded-md bg-vam-green px-4 text-sm font-semibold text-white hover:bg-vam-ink"
            >
              Về trang đăng nhập
            </Link>
          </>
        )}
      </div>
    </main>
  );
}
