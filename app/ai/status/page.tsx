import Link from "next/link";
import { redirect } from "next/navigation";
import { CheckCircle2, XCircle } from "lucide-react";
import { PageHeader } from "@/components/ui";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { evaluateAiConfig } from "@/lib/ai/ai-core";
import { canViewAiStatus } from "@/lib/permissions";

export const dynamic = "force-dynamic";

/**
 * Trạng thái kết nối của Công cụ AI.
 *
 * KHÔNG cho nhập hay sửa khoá API qua giao diện, và không bao giờ hiện khoá: khoá nằm
 * trong biến môi trường của Vercel. Lưu khoá trong database rồi hiện lên form thì ai
 * vào được trang này cũng đọc được một khoá đang bị tính tiền.
 */

function StatusRow({ on, label, hint }: { on: boolean; label: string; hint: string }) {
  return (
    <div className="flex gap-3">
      {on ? (
        <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-green-700" aria-hidden="true" />
      ) : (
        <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-slate-400" aria-hidden="true" />
      )}
      <div>
        <p className="text-sm font-medium text-vam-ink">{label}</p>
        <p className="mt-0.5 text-sm text-slate-500">{hint}</p>
      </div>
    </div>
  );
}

export default async function AiStatusPage() {
  const adminUser = await getCurrentAdminUser();
  if (!adminUser?.id) redirect("/login");
  if (!canViewAiStatus(adminUser.role)) redirect("/ai");

  const config = evaluateAiConfig(process.env);

  return (
    <div className="max-w-2xl space-y-5">
      <div>
        <Link href="/ai" className="text-sm font-medium text-vam-green hover:underline">
          ← Công cụ AI
        </Link>
        <div className="mt-2">
          <PageHeader title="Trạng thái Công cụ AI" description="Khoá API nào đã được khai trên máy chủ. Trang này không hiện và không sửa được khoá." />
        </div>
      </div>

      <section className="space-y-4 rounded-lg border border-vam-line bg-white p-4 shadow-soft sm:p-5">
        <StatusRow
          on={config.deepseek}
          label={config.deepseek ? `DeepSeek: đã kết nối (model ${config.model})` : "DeepSeek: chưa cấu hình"}
          hint={config.deepseek ? "Sáu công cụ trên trang Công cụ AI chạy bằng DeepSeek." : "Chưa có khoá thì mọi công cụ AI báo lỗi \"chưa cấu hình\"; phần còn lại của VAM OS không bị ảnh hưởng."}
        />
        <StatusRow
          on={config.tavily}
          label={config.tavily ? "Tìm kiếm web (Tavily): đã bật" : "Tìm kiếm web (Tavily): chưa cấu hình"}
          hint={
            config.tavily
              ? "Công cụ Xu hướng ngành đọc nguồn thật trên internet rồi tổng hợp, kèm link kiểm chứng."
              : "Chưa bật thì Xu hướng ngành chỉ trả lời bằng kiến thức chung của mô hình, không có link kiểm chứng và không biết tin mới."
          }
        />
      </section>

      <section className="rounded-lg border border-vam-line bg-white p-4 shadow-soft sm:p-5">
        <h2 className="text-base font-semibold text-vam-ink">Cách cấu hình</h2>
        <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-slate-600">
          <li>Tạo khoá API tại platform.deepseek.com (mục API keys). Nên đặt hạn mức chi tiêu trên tài khoản.</li>
          <li>Tuỳ chọn: đăng ký tavily.com để lấy khoá tìm kiếm web.</li>
          <li>
            Vercel → project VAM OS → Settings → Environment Variables → môi trường Production: thêm{" "}
            <code className="rounded bg-slate-100 px-1">DEEPSEEK_API_KEY</code> và{" "}
            <code className="rounded bg-slate-100 px-1">TAVILY_API_KEY</code>. Tuỳ chọn:{" "}
            <code className="rounded bg-slate-100 px-1">DEEPSEEK_MODEL</code>.
          </li>
          <li>Redeploy bản production để biến mới có hiệu lực.</li>
        </ol>
        <p className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Khoá API tính tiền theo lượng dùng. Không dán khoá vào tin nhắn hay ảnh chụp màn hình, và không đặt tên biến có tiền tố NEXT_PUBLIC_ — biến có tiền tố đó bị gửi xuống trình duyệt.
        </p>
      </section>
    </div>
  );
}
