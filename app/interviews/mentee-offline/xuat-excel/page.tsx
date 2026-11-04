import Link from "next/link";
import { Card, PageHeader } from "@/components/ui";
import { OFFLINE_PATH } from "@/lib/mentee-offline-core";
import { getMenteeOfflineExportOptions } from "@/lib/mentee-offline-export";
import { ExportPanel } from "./export-panel";

export const dynamic = "force-dynamic";

/**
 * VAM00023 — xuất một file Excel hồ sơ + đánh giá của các mentee phỏng vấn trực tiếp. Quyền kiểm ở máy chủ
 * (getMenteeOfflineExportOptions): không đủ quyền thì trang chỉ hiện lời giải thích, không đọc dữ liệu mentee nào.
 */
export default async function MenteeOfflineExportPage() {
  const result = await getMenteeOfflineExportOptions();
  return (
    <div className="grid gap-4">
      <PageHeader
        title="Xuất Excel hồ sơ và đánh giá mentee"
        description="Một file Excel, mỗi mentee một dòng: hồ sơ, đánh giá vòng hồ sơ và đánh giá vòng phỏng vấn."
      />
      <Link href={OFFLINE_PATH} className="w-fit text-sm font-medium text-vam-green hover:underline">
        ← Về màn hình Phỏng vấn mentee trực tiếp
      </Link>
      {result.ok ? (
        <>
          <Card>
            <ul className="list-disc space-y-1 pl-5 text-sm text-vam-ink">
              <li>Lọc theo mentee, người đánh giá và kết quả của từng vòng; các điều kiện kết hợp cùng lúc.</li>
              <li>Không chọn ai thì xuất tất cả mentee đang lọc; chọn một số thì chỉ xuất những bạn đó.</li>
              <li>Chỉ lấy dữ liệu hiện tại và người đánh giá hiện tại; vòng nào chưa có phiếu thì để trống.</li>
              <li>CV và tệp đính kèm xuất dưới dạng đường dẫn. File chứa thông tin cá nhân: chỉ dùng nội bộ.</li>
            </ul>
          </Card>
          <ExportPanel rows={result.rows} />
        </>
      ) : (
        <Card>
          <p role="alert">{result.message}</p>
        </Card>
      )}
    </div>
  );
}
