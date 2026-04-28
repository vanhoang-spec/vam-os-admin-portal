import { unlockAdminPortal } from "@/app/unlock/actions";

export default function UnlockPage({ searchParams }: { searchParams: { error?: string; next?: string } }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f7faf8] px-4 py-10">
      <section className="w-full max-w-md rounded-lg border border-vam-line bg-white p-6 shadow-soft">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold text-vam-ink">VAM OS – Truy cập nội bộ</h1>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Hệ thống đang ở giai đoạn MVP nội bộ. Vui lòng nhập mật khẩu để tiếp tục.
          </p>
        </div>
        <form action={unlockAdminPortal} className="grid gap-4">
          <input type="hidden" name="next" value={searchParams.next ?? "/"} />
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
          {searchParams.error ? <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">Mật khẩu không đúng.</div> : null}
          <button type="submit" className="h-11 rounded-md bg-vam-green px-4 text-sm font-semibold text-white hover:bg-vam-ink">
            Tiếp tục
          </button>
        </form>
      </section>
    </main>
  );
}
