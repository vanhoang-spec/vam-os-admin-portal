import type { Metadata } from "next";
import "./globals.css";
import { AppShell } from "@/components/app-shell";
import { getCurrentAdminUser } from "@/lib/admin-auth";

export const metadata: Metadata = {
  title: "VAM OS Admin Portal",
  description: "Cổng quản trị nội bộ cho Vietnam Alumni Mentoring"
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  let adminUser = null;
  try {
    adminUser = await getCurrentAdminUser();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("Dynamic server usage")) throw error;
    console.error("[layout] getCurrentAdminUser failed", message);
  }

  return (
    <html lang="vi">
      <body>
        <AppShell adminUser={adminUser}>{children}</AppShell>
      </body>
    </html>
  );
}
