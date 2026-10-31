import Link from "next/link";
import { ErrorBox, PageHeader, SimpleTable } from "@/components/ui";
import { answerText, CUSTOM_FORMS_PATH, responseColumns } from "@/lib/custom-form-core";
import { MENTOR_SEND_STATUSES, MENTOR_SEND_STATUS_LABELS, mentorSendStatusLabel } from "@/lib/custom-form-mentor-core";
import { listCustomFormDuplicateFlags, listCustomFormMentorSends, listCustomFormResponses } from "@/lib/custom-forms";
import { formatDateTime } from "@/lib/utils";
import { MentorSendButton } from "./mentor-send-button";

/**
 * /forms/[id]/tra-loi — câu trả lời của một form, mới nhất trước (BTC 15/10/2026). Mỗi câu hỏi một
 * cột, kể cả câu đã ẩn: dữ liệu cũ vẫn phải xem được.
 */
export const dynamic = "force-dynamic";
// Nút "Gửi các bản đang chờ" chạy ngay trong trang này, có thể gửi nhiều thư một lượt.
export const maxDuration = 60;

const AT_KEY = "__gui_luc";
const MENTOR_KEY = "__gui_mentor";

export default async function CustomFormResponsesPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const result = await listCustomFormResponses(id);
  if (!result.ok) {
    return (
      <div className="grid gap-4">
        <PageHeader title="Câu trả lời" />
        <ErrorBox message={result.message} />
      </div>
    );
  }
  const { form, responses } = result.data;
  // Cảnh báo trùng chỉ có ở form gắn sự kiện; đọc hỏng thì báo ngay trên khối đó, không giấu đi.
  const flags = form.eventId ? await listCustomFormDuplicateFlags(form.id) : null;
  const columns = responseColumns(form.fields);
  // Tắt tính năng thì trang như cũ, không đọc gì thêm. Đọc hỏng thì báo, không vẽ cột "chưa có gì".
  const mentorSends = form.mentorForward ? await listCustomFormMentorSends(form.id) : null;
  const sendOf = new Map(mentorSends?.ok ? mentorSends.data.map((s) => [s.responseId, s]) : []);
  const mentorCell = (responseId: string) => {
    const send = sendOf.get(responseId);
    if (!send) return mentorSends?.ok ? "Trước khi bật" : "";
    const who = send.status === "da_gui" && send.mentorName ? ` tới ${send.mentorName}` : "";
    const at = send.sentAt ? ` (${formatDateTime(send.sentAt)})` : "";
    const why = send.status === "da_gui" || !send.lastError ? "" : `: ${send.lastError}`;
    return `${mentorSendStatusLabel(send.status)}${who}${at}${why}`;
  };
  const rows = responses.map((r) => ({
    [AT_KEY]: formatDateTime(r.createdAt),
    ...(form.mentorForward ? { [MENTOR_KEY]: mentorCell(r.id) } : {}),
    ...Object.fromEntries(columns.map((c) => [c.id, answerText(r.answers[c.id])]))
  }));
  return (
    <div className="grid gap-4">
      <Link href={`${CUSTOM_FORMS_PATH}/${form.id}`} className="text-sm text-vam-green underline">
        ← Về form “{form.title}”
      </Link>
      <PageHeader title={`Câu trả lời — ${form.title}`} description={`Tổng cộng ${responses.length} câu trả lời, mới nhất ở trên.`} />
      <div className="flex flex-wrap gap-2">
        <a
          href={`/api/exports/custom-form/${form.id}`}
          data-testid="download-csv"
          className="rounded-md bg-vam-green px-4 py-2 text-sm font-semibold text-white hover:bg-vam-green/90"
        >
          Tải CSV
        </a>
        <Link
          href={`${CUSTOM_FORMS_PATH}/${form.id}/doi-chieu?doi_tuong=mentee`}
          data-testid="roster-check-link"
          className="rounded-md border border-vam-green px-4 py-2 text-sm font-semibold text-vam-green hover:bg-vam-mint/40"
        >
          Đối chiếu với danh sách mentee/mentor
        </Link>
      </div>
      {form.eventId ? (
        <section className="grid gap-2 rounded-md border border-vam-line p-3" data-testid="event-link-info">
          <p className="text-sm text-vam-ink">
            Form gắn sự kiện: người điền nằm trong danh sách người tham gia của sự kiện (số đăng ký, vé QR, check-in, huỷ xem ở đó).{" "}
            <Link href={`/events/${form.eventId}`} className="text-vam-green underline">
              Mở trang sự kiện
            </Link>
          </p>
          <h2 className="text-sm font-semibold text-vam-ink">Cảnh báo: email trùng, họ tên khác ({flags?.ok ? flags.data.length : "?"})</h2>
          <p className="text-xs text-slate-600">
            Lần gửi này KHÔNG ghi đè đăng ký đã có; người điền không thấy cảnh báo. Kiểm tra xem là cùng một người gõ khác tên hay hai người dùng
            chung email, rồi sửa ở trang sự kiện nếu cần.
          </p>
          {flags && !flags.ok ? (
            <ErrorBox message={flags.message} />
          ) : (
            <SimpleTable
              rows={(flags?.ok ? flags.data : []).map((f) => ({
                at: formatDateTime(f.createdAt),
                submittedName: f.submittedName,
                submittedEmail: f.submittedEmail,
                existingName: f.existingName
              }))}
              columns={[
                { key: "at", label: "Gửi lúc", nowrap: true },
                { key: "submittedName", label: "Họ tên vừa gửi" },
                { key: "submittedEmail", label: "Email" },
                { key: "existingName", label: "Họ tên đã đăng ký" }
              ]}
            />
          )}
        </section>
      ) : null}
      {form.mentorForward ? (
        <section className="grid gap-2 rounded-md border border-vam-line p-3" data-testid="mentor-send-panel">
          <h2 className="text-sm font-semibold text-vam-ink">Gửi cho mentor</h2>
          {mentorSends && !mentorSends.ok ? (
            <ErrorBox message={mentorSends.message} />
          ) : (
            <p className="text-sm text-slate-700" data-testid="mentor-send-counts">
              {MENTOR_SEND_STATUSES.map((status) => `${MENTOR_SEND_STATUS_LABELS[status]}: ${(mentorSends?.ok ? mentorSends.data : []).filter((s) => s.status === status).length}`).join(" · ")}
            </p>
          )}
          <p className="text-xs text-slate-600">
            Hệ thống quét các bản đang chờ mỗi ngày một lần. Vừa ghép cặp xong và muốn gửi ngay thì bấm nút dưới đây; nút cũng xét lại các bản không nhận ra
            mentee, nên sửa email trên hồ sơ xong bấm là đi. Bản đã gửi không bao giờ gửi lại, kể cả khi mentee đổi mentor.
          </p>
          <MentorSendButton formId={form.id} />
        </section>
      ) : null}
      <SimpleTable
        rows={rows}
        search="Tìm theo tên, email, MSSV…"
        columns={[
          { key: AT_KEY, label: "Gửi lúc", nowrap: true },
          ...(form.mentorForward ? [{ key: MENTOR_KEY, label: "Gửi mentor" }] : []),
          ...columns.map((c) => ({ key: c.id, label: c.label }))
        ]}
      />
    </div>
  );
}
