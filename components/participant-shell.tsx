import Link from "next/link";

import { logoutAction } from "@/app/login/actions";

/**
 * The frame a mentor or a mentee sees.
 *
 * Deliberately not `AppShell`. That component carries the operations navigation
 * — people, matches, applications, reviews — and a participant has no business
 * seeing those words, let alone the links. Rendering a stripped-down version of
 * the staff shell would mean one forgotten condition away from showing them.
 *
 * A single strip across the top instead, saying which programme and which season
 * they are in, because the whole point of the new sign-in is that the same
 * person sees a different season depending on which school they entered.
 */
export function ParticipantShell({
  children,
  programName,
  seasonLabel,
  personName,
  showSwitcher = false
}: {
  children: React.ReactNode;
  programName?: string | null;
  seasonLabel?: string | null;
  personName?: string | null;
  showSwitcher?: boolean;
}) {
  const context = [programName, seasonLabel].filter(Boolean).join(" · ");

  return (
    <div className="min-h-screen bg-[#f7faf8]">
      <header className="border-b border-vam-line bg-white">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3 px-5 py-3">
          <div className="min-w-0">
            <div className="text-xs font-semibold uppercase tracking-wide text-vam-green">
              VAM Mentoring
            </div>
            {context ? (
              <div className="mt-0.5 truncate text-sm font-medium text-vam-ink">{context}</div>
            ) : null}
          </div>

          <div className="flex items-center gap-4 text-sm">
            {showSwitcher ? (
              <Link href="/chon-chuong-trinh" className="font-medium text-vam-green hover:underline">
                Đổi chương trình
              </Link>
            ) : null}
            <form action={logoutAction}>
              <button
                type="submit"
                className="rounded-md border border-vam-line px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
              >
                Đăng xuất
              </button>
            </form>
          </div>
        </div>
      </header>

      <main id="main-content" className="mx-auto max-w-3xl px-5 py-8">
        {personName ? (
          <p className="mb-5 text-sm text-slate-500">Xin chào {personName}</p>
        ) : null}
        {children}
      </main>

      <footer className="mx-auto max-w-3xl px-5 pb-10">
        <p className="border-t border-vam-line pt-5 text-xs text-slate-500">
          Ban tổ chức VAM Mentoring · Vietnam Alumni Mentoring · Cần hỗ trợ, vui lòng liên hệ ban tổ
          chức chương trình của bạn.
        </p>
      </footer>
    </div>
  );
}
