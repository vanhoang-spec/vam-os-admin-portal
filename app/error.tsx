"use client";

import { useEffect } from "react";

export default function RootError({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[route-error]", {
      message: error.message,
      digest: error.digest
    });
  }, [error]);

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
        <h1 className="text-base font-semibold">Không thể tải trang</h1>
        <p className="mt-2">
          VAM OS gặp lỗi runtime khi tải route này. Vui lòng thử lại; chi tiết kỹ thuật đã được ghi vào server/client logs.
        </p>
        <button
          type="button"
          onClick={reset}
          className="mt-4 rounded-md border border-red-200 bg-white px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-100"
        >
          Thử lại
        </button>
      </div>
    </main>
  );
}
