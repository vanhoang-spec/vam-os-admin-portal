import Link from "next/link";
import { Card, EmptyState, ErrorBox, PageHeader } from "@/components/ui";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { canEditRecaps } from "@/lib/auth-constants";
import { getAdminScopeContext, getScopeFilter } from "@/lib/program-scope";
import { getRegistrationDetail, isValidUuid } from "@/lib/events";
import { displayText, formatDate } from "@/lib/utils";
import type { EventRegistration } from "@/lib/types";

// ---------------------------------------------------------------------------
// Local display helpers
// ---------------------------------------------------------------------------

function field(value: unknown): string {
  const text = String(value ?? "").trim();
  return text || "—";
}

function registrationStatusLabel(v: unknown) {
  const s = String(v ?? "");
  if (s === "registered") return "Đã đăng ký";
  if (s === "pending_review") return "Chờ duyệt";
  if (s === "confirmed") return "Đã xác nhận";
  if (s === "waitlisted") return "Danh sách chờ";
  if (s === "rejected") return "Đã từ chối";
  if (s === "cancelled") return "Đã hủy";
  return s || "—";
}

function attendanceStatusLabel(v: unknown) {
  const s = String(v ?? "");
  if (s === "pending") return "Chưa check-in";
  if (s === "checked_in") return "Đã check-in";
  if (s === "no_show") return "Không tham dự (No-show)";
  if (s === "cancelled") return "Đã hủy";
  return s || "—";
}

function proofStatusLabel(v: unknown) {
  const s = String(v ?? "");
  if (s === "not_required") return "Không yêu cầu";
  if (s === "submitted") return "Đã nộp";
  if (s === "accepted") return "Đã chấp nhận";
  if (s === "rejected") return "Đã từ chối";
  return s || "—";
}

function paymentStatusLabel(v: unknown) {
  const s = String(v ?? "");
  if (s === "not_required") return "Không yêu cầu";
  if (s === "pending") return "Chờ nộp";
  if (s === "submitted") return "Đã nộp";
  if (s === "confirmed") return "Đã xác nhận";
  if (s === "rejected") return "Đã từ chối";
  return s || "—";
}

function matchReviewLabel(v: unknown) {
  const s = String(v ?? "");
  if (s === "auto_linked") return "Đã khớp tự động";
  if (s === "pending_review") return "Chờ rà soát";
  if (s === "confirmed") return "Đã xác nhận";
  if (s === "rejected") return "Đã từ chối";
  if (s === "unlinked") return "Chưa khớp hồ sơ";
  return s || "—";
}

// Badge colour by registration_status
function regStatusCls(v: unknown) {
  const s = String(v ?? "");
  if (s === "confirmed") return "inline-block rounded bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800";
  if (s === "pending_review") return "inline-block rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800";
  if (s === "waitlisted") return "inline-block rounded bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800";
  if (s === "rejected" || s === "cancelled")
    return "inline-block rounded bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800";
  return "inline-block rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700";
}

// Badge colour by proof/payment status
function proofStatusCls(v: unknown) {
  const s = String(v ?? "");
  if (s === "accepted" || s === "confirmed")
    return "inline-block rounded bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800";
  if (s === "rejected") return "inline-block rounded bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800";
  if (s === "submitted" || s === "pending")
    return "inline-block rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800";
  return "inline-block rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600";
}

// ---------------------------------------------------------------------------
// Local layout primitives
// ---------------------------------------------------------------------------

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card>
      <h2 className="mb-3 text-base font-semibold text-vam-ink">{title}</h2>
      {children}
    </Card>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-vam-line py-2.5 last:border-b-0 sm:grid sm:grid-cols-[200px_1fr] sm:gap-4 sm:py-2">
      <dt className="text-xs font-medium uppercase text-slate-500 sm:pt-0.5">{label}</dt>
      <dd className="mt-1 break-words text-sm text-vam-ink sm:mt-0">{children}</dd>
    </div>
  );
}

function ProofLink({ url, label }: { url: string | null | undefined; label: string }) {
  if (!url) return <span className="text-slate-400">—</span>;
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 rounded border border-vam-line bg-white px-2 py-0.5 text-xs font-medium text-vam-green hover:bg-vam-mint"
    >
      {label} ↗
    </a>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function RegistrationDetailPage({
  params
}: {
  params: { id: string; regId: string };
}) {
  const adminUser = await getCurrentAdminUser();
  if (!canEditRecaps(adminUser)) {
    return (
      <>
        <PageHeader title="Không có quyền truy cập" />
        <ErrorBox message="Bạn không có quyền xem chi tiết đăng ký sự kiện." />
      </>
    );
  }

  if (!isValidUuid(params.id) || !isValidUuid(params.regId)) {
    return (
      <>
        <PageHeader title="ID không hợp lệ" />
        <ErrorBox message="Đường dẫn không chứa UUID hợp lệ." />
      </>
    );
  }

  const scopeContext = await getAdminScopeContext();
  const scope = await getScopeFilter(scopeContext);
  const detail = await getRegistrationDetail(params.id, params.regId, scope);

  if (!detail.registration) {
    return (
      <>
        <PageHeader title="Không tìm thấy đăng ký" />
        {detail.error ? <ErrorBox message={detail.error} /> : null}
        <EmptyState message="Đăng ký không tồn tại hoặc bạn không có quyền truy cập." />
        <div className="mt-4">
          <Link
            href={`/events/${params.id}`}
            className="text-sm font-medium text-vam-green hover:underline"
          >
            ← Quay lại sự kiện
          </Link>
        </div>
      </>
    );
  }

  const reg: EventRegistration = detail.registration;
  const eventName = displayText(detail.event?.event_name, "Sự kiện");

  const hasProof =
    reg.proof_url ||
    reg.proof_note ||
    (reg.proof_status && reg.proof_status !== "not_required");
  const hasPayment =
    reg.payment_proof_url ||
    reg.payment_proof_note ||
    (reg.payment_status && reg.payment_status !== "not_required");
  const hasWorkflow =
    reg.confirmed_at ||
    reg.rejected_at ||
    reg.waitlisted_at ||
    reg.cancelled_at ||
    reg.proof_reviewed_at ||
    reg.payment_confirmed_at ||
    reg.payment_rejected_at ||
    reg.no_show_flagged_at;

  return (
    <>
      <PageHeader
        title={`Chi tiết đăng ký: ${displayText(reg.full_name)}`}
        description={`${eventName} · Đăng ký lúc ${formatDate(reg.registered_at)}`}
      />
      {detail.error ? <ErrorBox message={detail.error} /> : null}

      {/* Navigation */}
      <div className="mb-4 flex flex-wrap gap-3">
        <Link
          href={`/events/${params.id}`}
          className="inline-flex items-center justify-center rounded-md border border-vam-line bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          ← Trang sự kiện
        </Link>
        <Link
          href={`/events/${params.id}/attendance`}
          className="inline-flex items-center justify-center rounded-md border border-vam-line bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Quản lý tham gia
        </Link>
      </div>

      <div className="grid gap-4">
        {/* ─── A: Người đăng ký ─── */}
        <Section title="A · Người đăng ký">
          <dl className="divide-y divide-vam-line">
            <Row label="Họ và tên">{field(reg.full_name)}</Row>
            <Row label="Email">{field(reg.email)}</Row>
            <Row label="Số điện thoại">{field(reg.phone)}</Row>
            <Row label="Mã số sinh viên (MSSV)">{field(reg.student_id)}</Row>
            <Row label="Mã Mentee">{field(reg.mentee_code)}</Row>
            <Row label="Đồng ý điều khoản">
              {reg.consent_given ? (
                <span className="text-green-700">✓ Đã đồng ý</span>
              ) : (
                <span className="text-red-600">✗ Chưa đồng ý</span>
              )}
            </Row>
            <Row label="Nguồn đăng ký">{field(reg.registration_source)}</Row>
            <Row label="Thời điểm đăng ký">{formatDate(reg.registered_at)}</Row>
          </dl>
        </Section>

        {/* ─── B: Học tập / vai trò ─── */}
        <Section title="B · Thông tin học tập / vai trò">
          <dl className="divide-y divide-vam-line">
            <Row label="Trường">{field(reg.school)}</Row>
            <Row label="Ngành học">{field(reg.program_of_study)}</Row>
            <Row label="Vai trò / nhóm tham gia">{field(reg.role_text)}</Row>
          </dl>
        </Section>

        {/* ─── C: Câu hỏi & ghi chú ─── */}
        <Section title="C · Câu hỏi & ghi chú">
          <dl className="divide-y divide-vam-line">
            <Row label="Câu hỏi cho diễn giả">
              {reg.speaker_question ? (
                <span className="whitespace-pre-wrap">{reg.speaker_question}</span>
              ) : (
                <span className="text-slate-400">—</span>
              )}
            </Row>
            <Row label="Ghi chú chung">
              {reg.notes ? (
                <span className="whitespace-pre-wrap">{reg.notes}</span>
              ) : (
                <span className="text-slate-400">—</span>
              )}
            </Row>
          </dl>
        </Section>

        {/* ─── D: Minh chứng & thanh toán ─── */}
        {hasProof || hasPayment ? (
          <Section title="D · Minh chứng & thanh toán">
            <dl className="divide-y divide-vam-line">
              {hasProof ? (
                <>
                  <Row label="Đường dẫn minh chứng">
                    <ProofLink url={reg.proof_url} label="Mở liên kết minh chứng" />
                  </Row>
                  <Row label="Ghi chú minh chứng">
                    {reg.proof_note ? (
                      <span className="whitespace-pre-wrap">{reg.proof_note}</span>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </Row>
                  <Row label="Trạng thái minh chứng">
                    <span className={proofStatusCls(reg.proof_status)}>
                      {proofStatusLabel(reg.proof_status)}
                    </span>
                  </Row>
                  <Row label="Ghi chú rà soát minh chứng">
                    {reg.proof_review_note ? (
                      <span className="whitespace-pre-wrap">{reg.proof_review_note}</span>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </Row>
                </>
              ) : null}
              {hasPayment ? (
                <>
                  <Row label="Ảnh chuyển khoản">
                    <ProofLink url={reg.payment_proof_url} label="Mở ảnh chuyển khoản" />
                  </Row>
                  <Row label="Ghi chú thanh toán">
                    {reg.payment_proof_note ? (
                      <span className="whitespace-pre-wrap">{reg.payment_proof_note}</span>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </Row>
                  <Row label="Trạng thái thanh toán">
                    <span className={proofStatusCls(reg.payment_status)}>
                      {paymentStatusLabel(reg.payment_status)}
                    </span>
                  </Row>
                  <Row label="Ghi chú từ chối thanh toán">
                    {reg.payment_rejection_note ? (
                      <span className="whitespace-pre-wrap">{reg.payment_rejection_note}</span>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </Row>
                </>
              ) : null}
            </dl>
          </Section>
        ) : null}

        {/* ─── E: Trạng thái & rà soát ─── */}
        <Section title="E · Trạng thái & rà soát">
          <dl className="divide-y divide-vam-line">
            <Row label="Trạng thái đăng ký">
              <span className={regStatusCls(reg.registration_status)}>
                {registrationStatusLabel(reg.registration_status)}
              </span>
            </Row>
            <Row label="Trạng thái check-in">{attendanceStatusLabel(reg.attendance_status)}</Row>
            <Row label="Check-in lúc">
              {reg.checked_in_at ? formatDate(reg.checked_in_at) : <span className="text-slate-400">—</span>}
            </Row>
            <Row label="Nguồn check-in">{field(reg.checkin_source)}</Row>
            <Row label="Trạng thái rà soát (admin)">{field(reg.review_status)}</Row>
            <Row label="Ghi chú rà soát">
              {reg.review_note ? (
                <span className="whitespace-pre-wrap">{reg.review_note}</span>
              ) : (
                <span className="text-slate-400">—</span>
              )}
            </Row>
            <Row label="No-show">
              {reg.no_show_flagged ? (
                <span className="inline-block rounded bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                  Đã đánh dấu no-show
                </span>
              ) : (
                "Không"
              )}
            </Row>
            <Row label="Blacklist">
              {reg.blacklist_flag ? (
                <span className="inline-block rounded bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                  Đã blacklist
                </span>
              ) : (
                "Không"
              )}
            </Row>
            {reg.blacklist_flag && reg.blacklist_note ? (
              <Row label="Ghi chú blacklist">
                <span className="whitespace-pre-wrap">{reg.blacklist_note}</span>
              </Row>
            ) : null}
          </dl>
        </Section>

        {/* ─── E2: Khớp hồ sơ ─── */}
        <Section title="E2 · Khớp hồ sơ (Person matching)">
          <dl className="divide-y divide-vam-line">
            <Row label="ID hồ sơ đã khớp">{field(reg.linked_person_id)}</Row>
            <Row label="Phương thức khớp">{field(reg.match_method)}</Row>
            <Row label="Trạng thái rà soát khớp">{matchReviewLabel(reg.match_review_status)}</Row>
            <Row label="Khớp lúc">
              {reg.matched_at ? formatDate(reg.matched_at) : <span className="text-slate-400">—</span>}
            </Row>
          </dl>
        </Section>

        {/* ─── F: Lịch sử workflow admin ─── */}
        {hasWorkflow ? (
          <Section title="F · Lịch sử workflow admin">
            <dl className="divide-y divide-vam-line">
              {reg.confirmed_at ? (
                <Row label="Xác nhận lúc">{formatDate(reg.confirmed_at)}</Row>
              ) : null}
              {reg.confirmed_by ? (
                <Row label="Xác nhận bởi">{field(reg.confirmed_by)}</Row>
              ) : null}
              {reg.waitlisted_at ? (
                <Row label="Đưa vào waitlist lúc">{formatDate(reg.waitlisted_at)}</Row>
              ) : null}
              {reg.waitlist_position != null ? (
                <Row label="Vị trí waitlist">{String(reg.waitlist_position)}</Row>
              ) : null}
              {reg.waitlisted_by ? (
                <Row label="Waitlist bởi">{field(reg.waitlisted_by)}</Row>
              ) : null}
              {reg.rejected_at ? (
                <Row label="Từ chối lúc">{formatDate(reg.rejected_at)}</Row>
              ) : null}
              {reg.rejected_by ? (
                <Row label="Từ chối bởi">{field(reg.rejected_by)}</Row>
              ) : null}
              {reg.reject_reason ? (
                <Row label="Lý do từ chối">
                  <span className="whitespace-pre-wrap">{reg.reject_reason}</span>
                </Row>
              ) : null}
              {reg.cancelled_at ? (
                <Row label="Hủy lúc">{formatDate(reg.cancelled_at)}</Row>
              ) : null}
              {reg.cancelled_by ? (
                <Row label="Hủy bởi">{field(reg.cancelled_by)}</Row>
              ) : null}
              {reg.cancel_reason ? (
                <Row label="Lý do hủy">
                  <span className="whitespace-pre-wrap">{reg.cancel_reason}</span>
                </Row>
              ) : null}
              {reg.proof_reviewed_at ? (
                <Row label="Rà soát minh chứng lúc">{formatDate(reg.proof_reviewed_at)}</Row>
              ) : null}
              {reg.proof_reviewed_by ? (
                <Row label="Rà soát minh chứng bởi">{field(reg.proof_reviewed_by)}</Row>
              ) : null}
              {reg.payment_confirmed_at ? (
                <Row label="Xác nhận thanh toán lúc">{formatDate(reg.payment_confirmed_at)}</Row>
              ) : null}
              {reg.payment_confirmed_by ? (
                <Row label="Xác nhận thanh toán bởi">{field(reg.payment_confirmed_by)}</Row>
              ) : null}
              {reg.payment_rejected_at ? (
                <Row label="Từ chối thanh toán lúc">{formatDate(reg.payment_rejected_at)}</Row>
              ) : null}
              {reg.payment_rejected_by ? (
                <Row label="Từ chối thanh toán bởi">{field(reg.payment_rejected_by)}</Row>
              ) : null}
              {reg.no_show_flagged_at ? (
                <Row label="No-show flagged lúc">{formatDate(reg.no_show_flagged_at)}</Row>
              ) : null}
              {reg.no_show_flagged_by ? (
                <Row label="No-show flagged bởi">{field(reg.no_show_flagged_by)}</Row>
              ) : null}
            </dl>
          </Section>
        ) : null}

        {/* ─── Placeholder for admin actions (next pass) ─── */}
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <strong>Admin actions</strong> (Duyệt / Từ chối / Waitlist / Rà soát minh chứng / Thanh toán) sẽ được triển khai ở phase tiếp theo.
        </div>
      </div>

      {/* Bottom navigation */}
      <div className="mt-6 flex flex-wrap gap-3">
        <Link
          href={`/events/${params.id}`}
          className="inline-flex items-center justify-center rounded-md border border-vam-line bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          ← Trang sự kiện
        </Link>
        <Link
          href={`/events/${params.id}/attendance`}
          className="inline-flex items-center justify-center rounded-md border border-vam-line bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Quản lý tham gia
        </Link>
      </div>
    </>
  );
}
