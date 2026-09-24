import { redirect } from "next/navigation";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { LoginForm } from "./login-form";

import { safeNext } from "@/lib/auth-error-messages";

export default async function LoginPage(props: { searchParams?: Promise<{ next?: string | string[] }> }) {
  const searchParams = await props.searchParams;

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
        {/*
          Câu này từng nói "không đăng nhập được thì liên hệ người phụ trách".
          Từ 24/09/2026 quên mật khẩu đã tự xử lý được ngay bên dưới, nên để
          nguyên là chỉ người dùng đi hỏi một việc họ tự làm xong trong một phút.
          Việc thật sự còn cần người phụ trách chỉ còn là chưa có tài khoản.
        */}
        <p className="mt-4 text-xs leading-5 text-slate-500">
          Chưa có tài khoản? Vui lòng liên hệ người phụ trách để được cấp quyền.
        </p>
      </section>
    </main>
  );
}
