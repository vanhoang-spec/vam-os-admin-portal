import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "UEH Mentoring — Đăng ký",
  description: "Đăng ký tham gia chương trình Vietnam Alumni Mentoring."
};

/**
 * Layout for the public pilot intake forms (/apply/mentor, /apply/mentee).
 *
 * Intentionally minimal — no admin sidebar, no Supabase auth check, no
 * password gate. The middleware matcher excludes `/apply/*` and the root
 * AppShell renders children straight through for any path starting with
 * `/apply`. Each `apply/*` page enforces its own per-route token check
 * via VAM_OS_APPLICATION_PILOT_TOKEN.
 */
export default function ApplyLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-white text-vam-ink">
      <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-12">{children}</main>
    </div>
  );
}
