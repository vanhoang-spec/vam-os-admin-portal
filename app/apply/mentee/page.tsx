import { evaluateApplyGate } from "@/lib/apply-gate";
import { ClosedFormView, PilotModeBanner } from "../_components/gate-views";
import { ApplyMenteeForm } from "./apply-mentee-form";

export const metadata = {
  title: "Đăng ký mentee — VAM Mentoring Season 12",
  description: "Đơn đăng ký pilot dành cho mentee mùa 12."
};

export const dynamic = "force-dynamic";

export default async function ApplyMenteePage(props: { searchParams?: Promise<{ token?: string | string[] }> }) {
  const searchParams = await props.searchParams;

  const tokenRaw = Array.isArray(searchParams?.token) ? searchParams?.token[0] : searchParams?.token;
  const gate = await evaluateApplyGate(tokenRaw, "mentee");

  if (gate.status === "closed") {
    return <ClosedFormView reason={gate.reason} />;
  }

  // In pilot the token travels into the Server Action so the submission is
  // judged by the same gate the render was. In open state nothing is carried.
  const carriedToken = gate.state === "pilot" ? String(tokenRaw ?? "").trim() : null;

  return (
    <>
      {gate.state === "pilot" ? <PilotModeBanner /> : null}
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

      <ApplyMenteeForm applyToken={carriedToken} />
    </>
  );
}
