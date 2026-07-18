import { evaluateApplyGate } from "@/lib/apply-gate";
import { ClosedFormView, DevWarningBanner } from "../_components/gate-views";
import { ApplyMenteeForm } from "./apply-mentee-form";

export const metadata = {
  title: "Đăng ký mentee — VAM Mentoring Season 12",
  description: "Đơn đăng ký pilot dành cho mentee mùa 12."
};

export const dynamic = "force-dynamic";

export default function ApplyMenteePage({
  searchParams
}: {
  searchParams?: { token?: string | string[] };
}) {
  const tokenRaw = Array.isArray(searchParams?.token) ? searchParams?.token[0] : searchParams?.token;
  const gate = evaluateApplyGate(tokenRaw, "mentee");

  if (gate.status === "closed") {
    return <ClosedFormView />;
  }

  return (
    <>
      {gate.status === "dev_warning" ? <DevWarningBanner reason={gate.reason} /> : null}
      <header className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-wide text-vam-green">
          Vietnam Alumni Mentoring · Season 12 · Batch 1 (Pilot)
        </p>
        <h1 className="mt-1 text-2xl font-semibold text-vam-ink sm:text-3xl">
          Đơn đăng ký mentee
        </h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          Cảm ơn bạn quan tâm đến chương trình. Vui lòng dành khoảng <strong>10-15 phút</strong> để
          hoàn thành. Trường có dấu <span className="text-red-600">*</span> là bắt buộc.
        </p>
        <p className="mt-2 text-xs text-slate-500">
          Lưu ý: việc gửi đơn không tự động trở thành mentee chính thức. BTC sẽ review hồ sơ,
          mời phỏng vấn nếu phù hợp, và liên hệ về kết quả cuối cùng.
        </p>
      </header>

      <ApplyMenteeForm />
    </>
  );
}
