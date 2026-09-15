import { FormRichText } from "@/components/form-rich-text";
import { evaluateApplyGate } from "@/lib/apply-gate";
import { getApplicationFormTexts } from "@/lib/application-form-texts";
import { ClosedFormView, PilotModeBanner } from "../_components/gate-views";
import { ApplyMentorForm } from "./apply-mentor-form";

export const metadata = {
  title: "Đăng ký mentor — UEH Mentoring Season 12",
  description: "Đơn đăng ký dành cho mentor mùa 12."
};

/**
 * Server Action nộp đơn gửi thư xác nhận ngay trong luồng, và lời gọi tới nhà
 * cung cấp email có thể treo tới 20 giây trước khi bị cắt. Trần mặc định của
 * Vercel ngắn hơn thế, nên đơn đã lưu xong vẫn có thể bị báo là hỏng.
 */
export const maxDuration = 60;

export const dynamic = "force-dynamic";

export default async function ApplyMentorPage(props: { searchParams?: Promise<{ token?: string | string[] }> }) {
  const searchParams = await props.searchParams;

  const tokenRaw = Array.isArray(searchParams?.token) ? searchParams?.token[0] : searchParams?.token;
  const gate = await evaluateApplyGate(tokenRaw, "mentor");

  if (gate.status === "closed") {
    return <ClosedFormView reason={gate.reason} />;
  }

  // In pilot the token travels into the Server Action so the submission is
  // judged by the same gate the render was. In open state nothing is carried.
  const carriedToken = gate.state === "pilot" ? String(tokenRaw ?? "").trim() : null;

  // Chữ trên form do admin sửa ở /admin/seasons-forms/form-texts. Đọc hỏng thì là
  // chữ mặc định — không bao giờ là một form trống hay một form đóng.
  const texts = await getApplicationFormTexts();

  return (
    <>
      {gate.state === "pilot" ? <PilotModeBanner /> : null}
      <header className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-wide text-vam-green">{texts["mentor.header.eyebrow"]}</p>
        <h1 className="mt-1 text-2xl font-semibold text-vam-ink sm:text-3xl">{texts["mentor.header.title"]}</h1>
        <FormRichText
          text={texts["mentor.header.intro"]}
          className="mt-2 space-y-2 text-sm leading-6 text-slate-600"
          strongClassName="font-semibold"
        />
        <FormRichText
          text={texts["mentor.header.note"]}
          className="mt-2 space-y-2 text-xs text-slate-500"
          strongClassName="font-semibold"
        />
      </header>

      <ApplyMentorForm applyToken={carriedToken} texts={texts} />
    </>
  );
}
