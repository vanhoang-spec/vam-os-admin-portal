import { redirect } from "next/navigation";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { LoginForm } from "./login-form";

import { safeNext } from "@/lib/auth-error-messages";

export default async function LoginPage({ searchParams }: { searchParams?: { next?: string | string[] } }) {
  const adminUser = await getCurrentAdminUser();
  if (adminUser) redirect(safeNext(searchParams?.next));

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f7faf8] px-4 py-10">
      <section className="w-full max-w-md rounded-lg border border-vam-line bg-white p-6 shadow-soft">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold text-vam-ink">Đăng nhập VAM OS</h1>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Dùng tài khoản đã được cấp quyền bởi người quản trị VAM OS.
          </p>
        </div>
        <LoginForm next={safeNext(searchParams?.next)} />
        <p className="mt-4 text-xs leading-5 text-slate-500">
          Nếu bạn chưa có tài khoản hoặc không đăng nhập được, vui lòng liên hệ người phụ trách.
        </p>
      </section>
    </main>
  );
}
