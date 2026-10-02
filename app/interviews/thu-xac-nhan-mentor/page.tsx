import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { canSendBulkEmail } from "@/lib/permissions";
import { ConfirmationClient } from "./confirmation-client";

export const dynamic = "force-dynamic";

/** Một lượt gửi gọi nhà cung cấp thư tuần tự cho hàng chục người. */
export const maxDuration = 60;

export const metadata = { title: "Thư xác nhận lịch phỏng vấn cho mentor — VAM OS" };

export default async function MentorConfirmationPage() {
  const adminUser = await getCurrentAdminUser();
  if (!adminUser) redirect("/login");
  if (!canSendBulkEmail(adminUser.role)) {
    return <PageHeader title="Không có quyền truy cập" description="Chỉ quản trị viên gửi được thư cho mentor." />;
  }
  return (
    <>
      <PageHeader
        title="Thư xác nhận lịch phỏng vấn cho mentor"
        description="Đọc sheet mentor đăng ký phỏng vấn, ghép buổi – phòng – cơ sở – tài khoản của từng người, xem trước rồi mới gửi. Chỉ mentor đã có quyền phỏng vấn mùa này mới nhận thư; ai đã nhận thư của đợt này không nhận lần hai."
      />
      <ConfirmationClient />
    </>
  );
}
