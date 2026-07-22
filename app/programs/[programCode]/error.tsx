"use client";

import Link from "next/link";
import { ErrorBox } from "@/components/ui";

export default function ProgramWorkspaceError() {
  return (
    <div className="space-y-4">
      <ErrorBox message="Không thể mở workspace chương trình hoặc bạn không có quyền truy cập phạm vi này." />
      <Link href="/" className="inline-flex rounded-md border border-vam-line px-4 py-2 text-sm font-medium text-vam-green">
        Về tổng quan
      </Link>
    </div>
  );
}
