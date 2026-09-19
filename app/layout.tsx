import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";
import { AppShell } from "@/components/app-shell";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { PreviewEnvironmentBanner } from "@/components/preview-environment-banner";
import { ParticipantShell } from "@/components/participant-shell";
import { getParticipantDisplayName } from "@/lib/participant-person";

export const metadata: Metadata = {
  title: "VAM OS",
  description: "Cổng quản trị nội bộ cho Vietnam Alumni Mentoring"
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const requestHeaders = await headers();
  const publicRoute = requestHeaders.get("x-vam-public-route");
  if (
    publicRoute === "register" ||
    publicRoute === "checkin" ||
    // Vé cá nhân: người mở là người dự sự kiện, trên một điện thoại chưa đăng
    // nhập. Thiếu dòng này, /ve/<mã> rơi xuống AppShell và hiện "Cần đăng nhập"
    // thay cho tấm vé (13/09/2026) — dù middleware đã gắn nhãn "ticket" từ trước.
    publicRoute === "ticket" ||
    // Phiếu khảo sát cuối buổi, mở từ mã QR trong hội trường.
    publicRoute === "survey" ||
    publicRoute === "renewal" ||
    publicRoute === "blog"
  ) {
    return (
      <html lang="vi">
        <body><PreviewEnvironmentBanner />{children}</body>
      </html>
    );
  }

  // Mentor và mentee dùng khung riêng, không phải khung của ban tổ chức.
  //
  // Dấu này do middleware đặt TỪ ĐƯỜNG DẪN — không bao giờ đọc từ đầu vào của
  // client. Nhận nó từ ngoài vào nghĩa là để người ta tự chọn khung của mình,
  // và một người có thể yêu cầu khung participant trên một đường của ban tổ
  // chức. Khung không cấp quyền, nhưng nó quyết định thanh điều hướng nào hiện
  // ra, và đó đã là một chỉ dẫn sai.
  if (requestHeaders.get("x-vam-participant-route") === "1") {
    const displayName = await getParticipantDisplayName();
    return (
      <html lang="vi">
        <body>
          <ParticipantShell displayName={displayName}>{children}</ParticipantShell>
        </body>
      </html>
    );
  }

  // No silent fallback. If getCurrentAdminUser() throws (env mis-config,
  // DB error, mis-linked admin_users row), we let the error propagate to
  // Next.js so the failure is loudly visible instead of demoting every
  // visitor to a viewer-equivalent UI. The earlier swallowing try/catch
  // here was the exact reason core_team users were rendering as "Viewer"
  // even though server-side resolution succeeded — the throw from the
  // resolver was caught here and replaced with `null`.
  //
  // The only re-raise we used to honor was Next.js's "Dynamic server
  // usage" sentinel, but `getCurrentAdminUser` always reads cookies, so
  // the layout is dynamic by construction and that sentinel never fires.
  const adminUser = await getCurrentAdminUser();

  return (
    <html lang="vi">
      <body>
        <PreviewEnvironmentBanner />
        <AppShell adminUser={adminUser}>{children}</AppShell>
      </body>
    </html>
  );
}
