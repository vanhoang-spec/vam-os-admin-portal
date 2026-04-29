import type { Metadata } from "next";
import "./globals.css";
import { AppShell } from "@/components/app-shell";
import { getCurrentAdminUser } from "@/lib/admin-auth";

export const metadata: Metadata = {
  title: "VAM OS Admin Portal",
  description: "Cổng quản trị nội bộ cho Vietnam Alumni Mentoring"
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const adminUser = await getCurrentAdminUser();

  return (
    <html lang="vi">
      <body>
        <AppShell adminUser={adminUser}>{children}</AppShell>
      </body>
    </html>
  );
}
