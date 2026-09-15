import Link from "next/link";
import { Card, ErrorBox, PageHeader } from "@/components/ui";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { S12_BINDING } from "@/lib/application-form-controls";
import {
  APPLICATION_FORM_TEXT_GROUPS,
  APPLICATION_FORM_TEXT_SLOTS,
  resolveApplicationFormTexts
} from "@/lib/application-form-text-core";
import { canEditFormTextsForSeason } from "@/lib/application-form-text-write";
import { overrideBodies, readApplicationFormTextOverrides } from "@/lib/application-form-texts";
import { canEditApplicationFormTexts } from "@/lib/permissions";
import { getAdminScopeContext } from "@/lib/program-scope";
import { formatDateTime } from "@/lib/utils";
import { FormTextGroupEditor, type FormTextEditorSlot } from "./form-text-group-editor";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Chữ trên form đăng ký — VAM OS"
};

const TITLE = "Chữ trên form đăng ký";

function Refused({ message }: { message: string }) {
  return (
    <>
      <PageHeader title={TITLE} />
      <ErrorBox message={message} />
    </>
  );
}

export default async function ApplicationFormTextsPage() {
  const ctx = await getAdminScopeContext();
  const admin = ctx.adminUser ?? (await getCurrentAdminUser());

  if (!admin?.id || admin.status !== "active" || !canEditApplicationFormTexts(admin.role)) {
    return <Refused message="Bạn không có quyền sửa chữ trên form đăng ký." />;
  }
  if (ctx.scopeError) return <Refused message={ctx.scopeError} />;

  const lookup = await readApplicationFormTextOverrides();
  if (!lookup.ok) {
    return (
      <Refused message="Chưa đọc được bảng chữ của form (application_form_texts). Nhiều khả năng migration 20260915100000_application_form_texts.sql chưa được chạy. Trong lúc đó form công khai vẫn hiện chữ mặc định." />
    );
  }

  if (!(await canEditFormTextsForSeason(lookup.seasonId))) {
    return <Refused message={`Bạn cần quyền vận hành mùa ${S12_BINDING.seasonCode} để sửa chữ trên form.`} />;
  }

  const texts = resolveApplicationFormTexts(overrideBodies(lookup.overrides));

  return (
    <>
      <PageHeader
        title={TITLE}
        description={`Phần chữ người nộp đơn đọc trên form mentor và mentee của đợt ${S12_BINDING.intakeBatchCode}. Bấm lưu là có hiệu lực ngay, không cần deploy.`}
      />

      <Card>
        <p className="text-sm text-slate-700">
          Ô cần điền, các lựa chọn và những câu cam kết người nộp tick đồng ý <strong>không</strong> sửa ở đây.
        </p>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-600">
          <li>
            Viết <code className="font-mono">{"**chữ đậm**"}</code> để in đậm.
          </li>
          <li>
            Dòng bắt đầu bằng <code className="font-mono">{"- "}</code> là một gạch đầu dòng.
          </li>
          <li>Để một dòng trống giữa hai đoạn.</li>
          <li>Email và số điện thoại tự thành đường dẫn bấm được.</li>
        </ul>
        <p className="mt-3 flex flex-wrap gap-4 text-sm">
          <a href="/apply/mentor" target="_blank" rel="noopener noreferrer" className="font-medium text-vam-green hover:underline">
            Mở form mentor →
          </a>
          <a href="/apply/mentee" target="_blank" rel="noopener noreferrer" className="font-medium text-vam-green hover:underline">
            Mở form mentee →
          </a>
          <Link href="/admin/seasons-forms" className="text-slate-600 hover:underline">
            ← Mùa & Form đăng ký
          </Link>
        </p>
      </Card>

      {APPLICATION_FORM_TEXT_GROUPS.map((group) => {
        const slots: FormTextEditorSlot[] = APPLICATION_FORM_TEXT_SLOTS.filter((entry) => entry.group === group.id).map(
          (entry) => {
            const override = lookup.overrides[entry.key];
            return {
              key: entry.key,
              label: entry.label,
              kind: entry.kind,
              optional: entry.optional,
              defaultText: entry.defaultText,
              value: texts[entry.key],
              edited: Boolean(override),
              updatedLabel: override
                ? [override.updatedAt ? formatDateTime(override.updatedAt) : null, override.updatedByName]
                    .filter(Boolean)
                    .join(" · ") || null
                : null
            };
          }
        );
        return (
          <Card key={group.id} className="mt-6">
            <FormTextGroupEditor title={group.title} shownOn={group.shownOn} slots={slots} />
          </Card>
        );
      })}
    </>
  );
}
