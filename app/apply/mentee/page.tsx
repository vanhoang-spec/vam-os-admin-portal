import { evaluateApplyGate } from "@/lib/apply-gate";
import { ClosedFormView, PilotModeBanner } from "../_components/gate-views";
import { ApplyMenteeForm } from "./apply-mentee-form";

export const metadata = {
  title: "Đăng ký mentee — UEH Mentoring Season 12",
  description: "Đơn đăng ký mentee UEH Mentoring Season 12."
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
          Vietnam Alumni Mentoring - UEH Mentoring Season 12
        </p>
        <h1 className="mt-1 text-2xl font-semibold text-vam-ink sm:text-3xl">
          Đơn đăng ký mentee
        </h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          Cảm ơn bạn quan tâm đến chương trình. Vui lòng dành khoảng <strong>10-15 phút</strong> để
          hoàn thành. Trường có dấu <span className="text-red-600">*</span> là bắt buộc.
        </p>
        <p className="mt-2 text-xs leading-5 text-slate-500">
          Lưu ý: Việc gửi đơn không đồng nghĩa với việc tự động trở thành Mentee chính thức. BTC
          sẽ xem xét hồ sơ dựa trên mức độ phù hợp với tinh thần và cam kết của chương trình, mời
          phỏng vấn khi cần và liên hệ về kết quả tiếp theo.
        </p>
      </header>

      <section className="mb-6 rounded-lg border border-vam-line bg-white p-5 shadow-soft sm:p-6">
        <div className="max-w-3xl">
          <h2 className="text-base font-semibold text-vam-ink sm:text-lg">
            Chân dung Mentee chúng tôi tìm kiếm
          </h2>
          <div className="mt-3 space-y-4 text-sm leading-6 text-slate-600">
            <p>
              UEH Mentoring không tìm kiếm những người “giỏi nhất” hay đã có sẵn mọi câu trả lời.
              Chúng tôi tìm kiếm những bạn thực sự mong muốn thay đổi và phát triển, đang cần một
              người Mentor có kinh nghiệm đồng hành để giúp mình nhìn rõ hơn con đường phía trước,
              đồng thời sẵn sàng trở thành một phần của cộng đồng mentoring nơi mọi người cùng học
              hỏi, hỗ trợ và thúc đẩy nhau tiến bộ.
            </p>
            <p>
              Một Mentee phù hợp là người hiểu rằng Mentor không thể thay mình giải quyết vấn đề.
              Bạn cần chủ động trong hành trình phát triển của chính mình, cởi mở với phản hồi, sẵn
              sàng thử những điều mới và biến những trao đổi với Mentor thành hành động cụ thể. Bạn
              cũng cần thể hiện trách nhiệm, kỷ luật và sự tôn trọng cam kết: chủ động chuẩn bị cho
              các buổi mentoring, đúng giờ, theo đuổi những việc đã thống nhất và thông báo sớm khi
              có thay đổi.
            </p>
            <p>
              Nếu bạn chưa biết chính xác mình muốn trở thành ai nhưng thật sự muốn tiến lên, sẵn
              sàng học hỏi và cam kết với quá trình thay đổi, UEH Mentoring có thể là một hành trình
              phù hợp với bạn.
            </p>
          </div>
        </div>
      </section>

      <ApplyMenteeForm applyToken={carriedToken} />
    </>
  );
}
