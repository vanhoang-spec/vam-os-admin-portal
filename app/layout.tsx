import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";
import { AppShell } from "@/components/app-shell";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { PreviewEnvironmentBanner } from "@/components/preview-environment-banner";

export const metadata: Metadata = {
  title: "VAM OS",
  description: "Cổng quản trị nội bộ cho Vietnam Alumni Mentoring"
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const publicRoute = headers().get("x-vam-public-route");
  if (
    publicRoute === "register" ||
    publicRoute === "checkin" ||
    publicRoute === "confirm" ||
    publicRoute === "documents" ||
    publicRoute === "mentee-dossier"
  ) {
    return (
      <html lang="vi">
        <body><PreviewEnvironmentBanner />{children}</body>
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

  // A participant route reached by somebody who is not staff renders bare: the
  // page supplies its own frame (components/participant-shell.tsx), which has no
  // operations navigation in it at all. Staff visiting the same route — the
  // programme picker is shared — keep the shell they know.
  //
  // The header is set by middleware from the pathname, so it cannot be spoofed;
  // the decision to strip the shell still rests on the admin lookup, not on the
  // header alone.
  if (headers().get("x-vam-participant-route") && !adminUser) {
    return (
      <html lang="vi">
        <body><PreviewEnvironmentBanner />{children}</body>
      </html>
    );
  }

  return (
    <html lang="vi">
      <body>
        <PreviewEnvironmentBanner />
        <AppShell adminUser={adminUser}>{children}</AppShell>
      </body>
    </html>
  );
}
