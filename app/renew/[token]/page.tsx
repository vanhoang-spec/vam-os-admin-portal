import type { Metadata } from "next";
import { loadRenewalPage } from "@/lib/renewal-runtime";
import { RenewalForm } from "./renewal-form";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

export const metadata: Metadata = {
  title: "Gia hạn Mentor Season 12 — VAM",
  robots: { index: false, follow: false },
  referrer: "no-referrer"
};

export default async function RenewalPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const data = await loadRenewalPage(token);

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-10">
      <div className="mx-auto max-w-3xl">
        <header className="mb-6">
          <p className="text-sm font-semibold uppercase tracking-wide text-vam-green">Vietnam Alumni Mentoring</p>
          <h1 className="mt-2 text-3xl font-semibold text-vam-ink">Gia hạn Mentor — Season 12</h1>
          <p className="mt-2 text-sm text-slate-600">Quy trình xác nhận ngắn dành cho mentor đã đồng hành cùng VAM.</p>
        </header>

        {data.status === "denied" ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-5 text-sm text-red-800">{data.message}</div>
        ) : null}

        {data.status === "completed" ? (
          <div className="rounded-lg border border-green-200 bg-green-50 p-5">
            <h2 className="text-lg font-semibold text-green-900">Phản hồi đã được ghi nhận</h2>
            <p className="mt-2 text-sm text-green-800">
              {data.displayName ? `${data.displayName}, ` : ""}
              {data.outcome === "accepted"
                ? "Ban Tổ chức đã nhận xác nhận tiếp tục đồng hành của anh/chị."
                : "Ban Tổ chức đã ghi nhận anh/chị không tiếp tục trong Season 12."}
            </p>
          </div>
        ) : null}

        {data.status === "renewable" ? (
          <RenewalForm token={token} display={data.display} />
        ) : null}
      </div>
    </main>
  );
}
