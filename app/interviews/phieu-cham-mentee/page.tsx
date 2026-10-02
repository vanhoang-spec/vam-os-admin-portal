import Link from "next/link";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { getRubricEditorData } from "@/lib/mentee-interview-rubric";
import { OFFLINE_GUIDE_PATH, RUBRIC_EDITOR_PATH } from "@/lib/mentee-offline-core";
import { formatDateTime } from "@/lib/utils";
import { HandbookUpload } from "./handbook-upload";
import { RubricEditor } from "./rubric-editor";

export const dynamic = "force-dynamic";

/**
 * Phiếu chấm & Handbook phỏng vấn mentee — mỗi mùa một bộ. Mỗi mùa mới chỉ cần
 * sửa phiếu và tải Handbook; mùa chưa có phiếu riêng dùng phiếu lưu gần nhất.
 * Quyền: lib/mentee-interview-rubric.ts (vai trò + vận hành mùa) và RPC vam106_*.
 */
export default async function InterviewRubricPage({ searchParams }: { searchParams: Promise<{ season?: string }> }) {
  const { season } = await searchParams;
  const result = await getRubricEditorData(season);
  if (!result.ok) {
    return (
      <div className="grid gap-4">
        <PageHeader title="Phiếu chấm & hướng dẫn mentee" />
        <Card><EmptyState message={result.message} /></Card>
      </div>
    );
  }
  const { guide, seasonId, seasonCode, seasons } = result;
  const rubric = guide.rubric;
  const own = !!rubric?.own;

  return (
    <div className="grid gap-4">
      <PageHeader
        title="Phiếu chấm & hướng dẫn mentee"
        description="Mỗi mùa chỉ cần cập nhật phiếu chấm phỏng vấn và Handbook. Mùa chưa có phiếu riêng dùng phiếu lưu gần nhất."
      />

      {seasons.length > 1 ? (
        <nav aria-label="Chọn mùa" className="flex flex-wrap gap-2">
          {seasons.map((s) => (
            <Link key={s.id} href={`${RUBRIC_EDITOR_PATH}?season=${encodeURIComponent(s.code)}`}
              aria-current={s.id === seasonId ? "page" : undefined}
              className={s.id === seasonId ? "rounded bg-vam-green px-3 py-1 text-white" : "rounded border px-3 py-1"}>
              {s.code}
            </Link>
          ))}
        </nav>
      ) : null}

      <div role="status" className={own ? "rounded-md border border-vam-green bg-vam-mint/40 p-3 text-sm" : "rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"}>
        {!rubric
          ? `Mùa ${seasonCode} chưa có phiếu chấm, và chưa mùa nào có phiếu để dùng lại. Soạn phiếu bên dưới rồi lưu.`
          : own
            ? `Phiếu riêng của mùa ${seasonCode} · phiên bản ${rubric.version}${rubric.updatedByName ? ` · sửa lần cuối bởi ${rubric.updatedByName}` : ""} lúc ${formatDateTime(rubric.updatedAt)}${rubric.copiedFromSeasonCode ? ` · tạo từ phiếu ${rubric.copiedFromSeasonCode}` : ""}.`
            : `Mùa ${seasonCode} chưa có phiếu riêng — đang dùng phiếu của ${rubric.seasonCode} (lần cài đặt gần nhất). Lưu bất kỳ phần nào sẽ tạo phiếu riêng cho mùa này, bắt đầu từ nội dung đang dùng.`}
      </div>

      {guide.submittedCount > 0 ? (
        <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          Mùa này đã có {guide.submittedCount} phiếu chấm nộp. Điểm đã nộp giữ nguyên nội dung lúc chấm; mentor đang mở form sẽ phải tải lại trang sau khi bạn lưu.
        </p>
      ) : null}

      <Card>
        <h2 className="mb-3 text-base font-semibold text-vam-ink">Phiếu chấm phỏng vấn</h2>
        <RubricEditor
          key={`${seasonId}:${rubric?.id ?? "none"}:${rubric?.version ?? 0}`}
          seasonId={seasonId}
          seasonCode={seasonCode}
          expectedVersion={own ? rubric!.version : 0}
          initialCriteria={rubric?.criteria ?? []}
          initialGuidance={rubric?.guidance ?? {}}
        />
      </Card>

      <Card>
        <h2 className="mb-1 text-base font-semibold text-vam-ink">Handbook phỏng vấn</h2>
        <p className="mb-3 text-sm text-slate-600">
          {rubric?.hasHandbook
            ? `Đang dùng: ${rubric.handbookFileName ?? "Handbook"}${rubric.handbookUpdatedAt ? ` · cập nhật ${formatDateTime(rubric.handbookUpdatedAt)}` : ""}${rubric.handbookUpdatedByName ? ` · ${rubric.handbookUpdatedByName}` : ""}${own ? "" : ` (của ${rubric.seasonCode})`}.`
            : "Chưa có Handbook."}{" "}
          <Link href={OFFLINE_GUIDE_PATH} className="text-vam-green underline">Xem trang hướng dẫn mentor đang thấy</Link>
        </p>
        <HandbookUpload key={`${seasonId}:${rubric?.handbookVersion ?? 0}:${own}`} seasonId={seasonId} expectedHandbookVersion={own ? rubric!.handbookVersion : 0} />
      </Card>
    </div>
  );
}
