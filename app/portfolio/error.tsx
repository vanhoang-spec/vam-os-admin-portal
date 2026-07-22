"use client";

import { ErrorBox } from "@/components/ui";

export default function PortfolioError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="space-y-4">
      <ErrorBox message="Không thể tải dashboard danh mục chương trình. Không có dữ liệu cá nhân nào được hiển thị." />
      <button type="button" onClick={reset} className="rounded-md bg-vam-green px-4 py-2 text-sm font-medium text-white">
        Thử lại
      </button>
    </div>
  );
}
