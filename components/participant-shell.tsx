import Link from "next/link";
import { PreviewEnvironmentBanner } from "@/components/preview-environment-banner";
import { logoutAction } from "@/app/login/actions";

/**
 * Khung màn hình cho mentor và mentee.
 *
 * ---------------------------------------------------------------------------
 * VÌ SAO KHÔNG DÙNG CHUNG KHUNG VỚI BAN TỔ CHỨC
 * ---------------------------------------------------------------------------
 * `AppShell` mang thanh điều hướng của ban tổ chức: Vận hành, Ứng tuyển, Ghép
 * cặp, Quản trị. Ẩn từng mục bằng điều kiện hiển thị nghĩa là mỗi lần thêm một
 * mục mới, ai đó phải nhớ thêm điều kiện ấy — và quên một lần là một mentor
 * nhìn thấy đường dẫn vào màn hình quản trị.
 *
 * Một khung riêng thì không có gì để quên: những mục kia không có mặt trong
 * cây, chứ không phải bị giấu đi.
 *
 * Nó cũng nói đúng chuyện đang xảy ra với người đọc. Mentor không đăng nhập vào
 * "cổng quản trị" — họ vào trang của chương trình mình tham gia.
 */
export function ParticipantShell({
  displayName,
  children
}: {
  displayName: string | null;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-[#f7faf8]">
      <PreviewEnvironmentBanner />

      <header className="border-b border-vam-line bg-white">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6">
          <Link href="/ct" className="min-w-0">
            <span className="block text-lg font-semibold text-vam-ink">UEH Mentoring</span>
            <span className="block text-xs text-slate-500">Vietnam Alumni Mentoring</span>
          </Link>

          <div className="flex items-center gap-3">
            {displayName ? (
              <span className="max-w-[14rem] truncate text-sm text-slate-600">{displayName}</span>
            ) : null}
            {/* Dùng lại đúng thao tác đăng xuất của ban tổ chức. Nó xoá cookie
                và gọi Supabase kết thúc phiên; viết một đường thứ hai nghĩa là
                có hai chỗ phải nhớ sửa khi cách kết thúc phiên thay đổi. */}
            <form action={logoutAction}>
              <button
                type="submit"
                className="rounded-md border border-vam-line px-3 py-1.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
              >
                Đăng xuất
              </button>
            </form>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6">{children}</main>

      <footer className="mx-auto max-w-4xl px-4 pb-10 text-xs text-slate-500 sm:px-6">
        Cần hỗ trợ? Liên hệ ban tổ chức UEH Mentoring.
      </footer>
    </div>
  );
}
