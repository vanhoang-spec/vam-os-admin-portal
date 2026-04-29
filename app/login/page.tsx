import { redirect } from "next/navigation";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { LoginForm } from "./login-form";

function safeNext(value: string | string[] | undefined) {
  const next = Array.isArray(value) ? value[0] : value;
  const normalized = String(next ?? "/operations");
  if (!normalized.startsWith("/") || normalized.startsWith("//")) return "/operations";
  if (normalized.startsWith("/login") || normalized.startsWith("/unlock")) return "/operations";
  return normalized;
}

export default async function LoginPage({ searchParams }: { searchParams?: { next?: string | string[] } }) {
  const adminUser = await getCurrentAdminUser({ allowPasswordGateFallback: true });
  if (adminUser) redirect(safeNext(searchParams?.next));

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f7faf8] px-4 py-10">
      <section className="w-full max-w-md rounded-lg border border-vam-line bg-white p-6 shadow-soft">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold text-vam-ink">Đăng nhập VAM OS</h1>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Dùng tài khoản Supabase Auth đã được cấp quyền trong bảng admin_users.
          </p>
        </div>
        <LoginForm next={safeNext(searchParams?.next)} />
        <p className="mt-4 text-xs leading-5 text-slate-500">
          Sprint 1A dùng đăng nhập bằng email/mật khẩu. Admin user phải được tạo trong Supabase Auth Dashboard với email khớp admin_users.
        </p>
      </section>
    </main>
  );
}
