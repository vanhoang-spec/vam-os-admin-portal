import type { Metadata } from "next";
import "./globals.css";
import { AppShell } from "@/components/app-shell";
import { getCurrentAdminUser } from "@/lib/admin-auth";

export const metadata: Metadata = {
  title: "VAM OS Admin Portal",
  description: "Cổng quản trị nội bộ cho Vietnam Alumni Mentoring"
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
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
        <AppShell adminUser={adminUser}>{children}</AppShell>
      </body>
    </html>
  );
}
