"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import {
  LINK_MALFORMED_BODY,
  LINK_USED_BODY,
  LINK_USED_TITLE,
  MIN_PASSWORD_LENGTH,
  mapPasswordUpdateError,
  parsePasswordLinkHash,
  passwordLinkCopy,
  validateNewPassword,
  type ParsedPasswordLink,
  type PasswordLinkType
} from "@/lib/password-link-core";

/**
 * /reset-password — trang đặt mật khẩu, cho hai loại người.
 *
 * ---------------------------------------------------------------------------
 * HAI LUỒNG, TÁCH THEO PHẦN SAU DẤU #
 * ---------------------------------------------------------------------------
 * 1. `#token_hash=…&type=invite|recovery` — link VAM OS tự dựng trong thư mời
 *    mentor/mentee (lib/participant-invites.ts). Trang KHÔNG xác thực mã khi
 *    vừa mở: máy quét thư của công ty mở thử mọi link trong thư, và một mã bị
 *    tiêu lúc đó thì người nhận bấm vào chỉ gặp "đã hết hạn". Người nhận phải
 *    bấm "Tiếp tục" rồi mới gọi `verifyOtp`.
 * 2. Mọi link khác — link khôi phục của nhân sự do Supabase gửi, mang
 *    `access_token`. Luồng cũ, giữ nguyên.
 *
 * Sau khi đặt mật khẩu, trang ĐĂNG XUẤT và đưa người ta về /login. Nó không tự
 * dựng phiên đăng nhập: đường đăng nhập bằng mật khẩu là đường duy nhất kiểm
 * người này là nhân sự hay mentor/mentee, và một cửa thứ hai là một chỗ để hai
 * cửa nói khác nhau.
 */

function createBrowserClient(detectSessionInUrl: boolean): SupabaseClient | null {
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
      detectSessionInUrl
    }
  });
}

const CONFIG_ERROR = "Cấu hình hệ thống chưa đầy đủ. Vui lòng liên hệ quản trị viên.";

const INPUT_CLASS =
  "w-full rounded-md border border-vam-line bg-white px-3 py-2 text-sm text-vam-ink outline-none focus:border-vam-green focus:ring-2 focus:ring-vam-mint disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400";
const PRIMARY_BUTTON_CLASS =
  "w-full rounded-md bg-vam-green px-4 py-2 text-sm font-medium text-white hover:bg-vam-green/90 disabled:cursor-not-allowed disabled:opacity-60";
const LABEL_CLASS = "mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500";

function Brand({ title }: { title: string }) {
  return (
    <div className="mb-6 text-center">
      <span className="inline-block rounded-xl bg-vam-green px-4 py-1.5 text-sm font-bold tracking-wide text-white">
        VAM OS
      </span>
      <h1 className="mt-4 text-xl font-bold text-vam-ink">{title}</h1>
    </div>
  );
}

function Spinner({ text }: { text: string }) {
  return (
    <div className="flex flex-col items-center gap-3 py-6 text-center">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-vam-mint border-t-vam-green" />
      <p className="text-sm text-slate-500">{text}</p>
    </div>
  );
}

function BackToLogin({ primary = false, label = "Quay lại đăng nhập" }: { primary?: boolean; label?: string }) {
  return (
    <Link
      href="/login"
      className={
        primary
          ? "inline-block rounded-md bg-vam-green px-5 py-2 text-sm font-medium text-white hover:bg-vam-green/90"
          : "mt-2 inline-block rounded-md border border-vam-line px-4 py-2 text-sm font-medium text-vam-green hover:bg-vam-mint"
      }
    >
      {label}
    </Link>
  );
}

function PasswordFields({
  password,
  confirm,
  disabled,
  onPassword,
  onConfirm
}: {
  password: string;
  confirm: string;
  disabled: boolean;
  onPassword: (value: string) => void;
  onConfirm: (value: string) => void;
}) {
  return (
    <>
      <div>
        <label htmlFor="password" className={LABEL_CLASS}>
          Mật khẩu mới
        </label>
        <input
          id="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={MIN_PASSWORD_LENGTH}
          value={password}
          onChange={(event) => onPassword(event.target.value)}
          disabled={disabled}
          placeholder={`Tối thiểu ${MIN_PASSWORD_LENGTH} ký tự`}
          className={INPUT_CLASS}
        />
      </div>
      <div>
        <label htmlFor="confirm" className={LABEL_CLASS}>
          Nhập lại mật khẩu
        </label>
        <input
          id="confirm"
          type="password"
          autoComplete="new-password"
          required
          minLength={MIN_PASSWORD_LENGTH}
          value={confirm}
          onChange={(event) => onConfirm(event.target.value)}
          disabled={disabled}
          placeholder="Nhập lại mật khẩu ở trên"
          className={INPUT_CLASS}
        />
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Trang
// ─────────────────────────────────────────────────────────────────────────────

export default function ResetPasswordPage() {
  const [mode, setMode] = useState<"detecting" | "staff" | "link">("detecting");
  const [link, setLink] = useState<ParsedPasswordLink>({ status: "none" });

  // Strict Mode chạy effect hai lần. Lần hai sẽ thấy phần # đã bị gỡ và rơi
  // nhầm sang luồng của nhân sự.
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    const parsed = parsePasswordLinkHash(window.location.hash);
    if (parsed.status === "none") {
      setMode("staff");
      return;
    }

    // Gỡ mã khỏi thanh địa chỉ và lịch sử trình duyệt trước khi làm gì khác.
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
    setLink(parsed);
    setMode("link");
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f7faf8] px-4 py-12">
      <div className="w-full max-w-md rounded-2xl border border-vam-line bg-white p-8 shadow-sm">
        {mode === "detecting" ? (
          <>
            <Brand title="Đặt mật khẩu" />
            <Spinner text="Đang mở trang…" />
          </>
        ) : mode === "staff" ? (
          <StaffRecoveryFlow />
        ) : (
          <PasswordLinkFlow link={link} />
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Luồng 1: link mời / link đặt lại mật khẩu của mentor, mentee
// ─────────────────────────────────────────────────────────────────────────────

type LinkPhase = "confirm" | "verifying" | "verify_error" | "ready" | "submitting" | "expired" | "invalid" | "success";

function PasswordLinkFlow({ link }: { link: ParsedPasswordLink }) {
  const type: PasswordLinkType = link.status === "ok" ? link.type : "recovery";
  const copy = passwordLinkCopy(type);

  const [phase, setPhase] = useState<LinkPhase>(link.status === "ok" ? "confirm" : "invalid");
  const [message, setMessage] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  const tokenRef = useRef<{ tokenHash: string; type: PasswordLinkType } | null>(
    link.status === "ok" ? { tokenHash: link.tokenHash, type: link.type } : null
  );
  // Bấm hai lần liền tay không được gửi mã hai lần: lần hai chắc chắn hỏng, và
  // nó có thể về trước lần một.
  const verifyingRef = useRef(false);
  const clientRef = useRef<SupabaseClient | null>(null);

  async function handleContinue() {
    if (verifyingRef.current) return;
    const token = tokenRef.current;
    if (!token) {
      setPhase("expired");
      return;
    }

    verifyingRef.current = true;
    setMessage(null);
    setPhase("verifying");

    const client = createBrowserClient(false);
    if (!client) {
      verifyingRef.current = false;
      setMessage(CONFIG_ERROR);
      setPhase("verify_error");
      return;
    }

    try {
      const { data, error } = await client.auth.verifyOtp({ token_hash: token.tokenHash, type: token.type });
      // Mã đã được dùng tới, dù thành hay hỏng: không bao giờ gửi lại chính nó.
      tokenRef.current = null;
      if (error || !data?.session) {
        setPhase("expired");
        return;
      }
      clientRef.current = client;
      setEmail(data.user?.email ?? null);
      setPhase("ready");
    } catch {
      // Lỗi mạng: mã có thể còn nguyên. Cho bấm lại.
      verifyingRef.current = false;
      setMessage("Không kết nối được để xác nhận đường dẫn. Kiểm tra mạng rồi bấm Tiếp tục lần nữa.");
      setPhase("verify_error");
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const client = clientRef.current;
    if (!client) {
      setPhase("expired");
      return;
    }

    const problem = validateNewPassword(password, confirm);
    if (problem) {
      setMessage(problem);
      return;
    }

    setMessage(null);
    setPhase("submitting");

    try {
      const { error } = await client.auth.updateUser({ password });
      if (error) {
        const mapped = mapPasswordUpdateError(error);
        if (mapped.expired) {
          setPhase("expired");
          return;
        }
        setMessage(mapped.message);
        setPhase("ready");
        return;
      }
    } catch {
      setMessage("Không đặt được mật khẩu. Vui lòng thử lại.");
      setPhase("ready");
      return;
    }

    // Phiên xác nhận chỉ để đặt mật khẩu. Từ đây họ đăng nhập bằng mật khẩu vừa đặt.
    await client.auth.signOut().catch(() => undefined);
    clientRef.current = null;
    setPhase("success");
  }

  if (phase === "invalid") {
    return (
      <div className="space-y-4 text-center">
        <Brand title="Link không hợp lệ" />
        <p className="text-sm text-slate-600">{LINK_MALFORMED_BODY}</p>
        <BackToLogin />
      </div>
    );
  }

  if (phase === "expired") {
    return (
      <div className="space-y-4 text-center">
        <Brand title={LINK_USED_TITLE} />
        <p className="text-sm text-slate-600">{LINK_USED_BODY}</p>
        <BackToLogin />
      </div>
    );
  }

  if (phase === "success") {
    return (
      <div className="space-y-4 text-center">
        <Brand title={copy.successTitle} />
        <p className="text-sm text-slate-600">
          Từ giờ anh/chị đăng nhập VAM OS bằng {email ? <strong>{email}</strong> : "email của mình"} và mật khẩu vừa đặt.
        </p>
        <BackToLogin primary label="Đăng nhập" />
      </div>
    );
  }

  if (phase === "ready" || phase === "submitting") {
    return (
      <>
        <Brand title={copy.title} />
        <form onSubmit={handleSubmit} className="space-y-4">
          <p className="text-sm text-slate-600">{copy.formBody}</p>
          {email ? (
            <p className="rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-600">
              Tài khoản: <strong>{email}</strong>
            </p>
          ) : null}
          <PasswordFields
            password={password}
            confirm={confirm}
            disabled={phase === "submitting"}
            onPassword={setPassword}
            onConfirm={setConfirm}
          />
          {message ? (
            <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {message}
            </p>
          ) : null}
          <button type="submit" disabled={phase === "submitting"} className={PRIMARY_BUTTON_CLASS}>
            {phase === "submitting" ? "Đang đặt mật khẩu…" : copy.submitLabel}
          </button>
        </form>
      </>
    );
  }

  return (
    <div className="space-y-4">
      <Brand title={copy.title} />
      <p className="text-sm text-slate-600">{copy.confirmBody}</p>
      {message ? (
        <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {message}
        </p>
      ) : null}
      <button type="button" onClick={handleContinue} disabled={phase === "verifying"} className={PRIMARY_BUTTON_CLASS}>
        {phase === "verifying" ? "Đang xác nhận…" : copy.continueLabel}
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Luồng 2: link khôi phục mật khẩu của nhân sự (Supabase gửi)
// ─────────────────────────────────────────────────────────────────────────────

type StaffPhase =
  | "loading" // chờ onAuthStateChange hoặc hết giờ
  | "ready" // đã nhận PASSWORD_RECOVERY — hiện biểu mẫu
  | "invalid" // thiếu mã, mã hết hạn, hoặc thiếu cấu hình
  | "submitting"
  | "success"
  | "error";

function StaffRecoveryFlow() {
  const [pageState, setPageState] = useState<StaffPhase>("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  // Tạo một lần khi mở trang, với detectSessionInUrl để Supabase tự đọc mã.
  const [client] = useState<SupabaseClient | null>(() => createBrowserClient(true));

  useEffect(() => {
    if (!client) {
      setPageState("invalid");
      setErrorMessage(CONFIG_ERROR);
      return;
    }

    let settled = false;

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

    // Không có sự kiện nào trong 4 giây thì mã không hợp lệ hoặc đã hết hạn.
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        setPageState("invalid");
        setErrorMessage(
          "Link đặt lại mật khẩu không hợp lệ hoặc đã hết hạn. Vui lòng yêu cầu gửi lại email khôi phục mật khẩu."
        );
      }
    }, 4000);

    return () => {
      subscription.unsubscribe();
      clearTimeout(timer);
    };
  }, [client]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!client) return;

    setErrorMessage(null);
    const problem = validateNewPassword(password, confirm);
    if (problem) {
      setErrorMessage(problem);
      return;
    }

    setPageState("submitting");

    const { error } = await client.auth.updateUser({ password });
    if (error) {
      setPageState("error");
      setErrorMessage(mapPasswordUpdateError(error).message);
      return;
    }

    // Đăng xuất để phiên khôi phục không ở lại.
    await client.auth.signOut();
    setPageState("success");
  }

  const isFormVisible = pageState === "ready" || pageState === "submitting" || pageState === "error";

  return (
    <>
      <Brand title="Đặt lại mật khẩu" />

      {pageState === "loading" && <Spinner text="Đang xác thực link khôi phục…" />}

      {pageState === "invalid" && (
        <div className="space-y-4 py-2 text-center">
          <p className="text-sm font-medium text-red-700">Link không hợp lệ</p>
          {errorMessage && <p className="text-sm text-slate-600">{errorMessage}</p>}
          <BackToLogin />
        </div>
      )}

      {isFormVisible && (
        <form onSubmit={handleSubmit} className="space-y-4">
          <p className="text-sm text-slate-600">Nhập mật khẩu mới cho tài khoản VAM OS của bạn.</p>
          <PasswordFields
            password={password}
            confirm={confirm}
            disabled={pageState === "submitting"}
            onPassword={setPassword}
            onConfirm={setConfirm}
          />
          {errorMessage && (
            <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{errorMessage}</p>
          )}
          <button type="submit" disabled={pageState === "submitting"} className={PRIMARY_BUTTON_CLASS}>
            {pageState === "submitting" ? "Đang cập nhật…" : "Đặt lại mật khẩu"}
          </button>
          <div className="text-center">
            <Link href="/login" className="text-xs text-slate-500 hover:text-vam-green hover:underline">
              Quay lại đăng nhập
            </Link>
          </div>
        </form>
      )}

      {pageState === "success" && (
        <div className="space-y-4 py-2 text-center">
          <p className="text-sm font-semibold text-vam-ink">Mật khẩu đã được cập nhật!</p>
          <p className="text-sm text-slate-600">Bạn có thể đăng nhập bằng mật khẩu mới ngay bây giờ.</p>
          <BackToLogin primary label="Đăng nhập" />
        </div>
      )}
    </>
  );
}
