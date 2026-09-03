"use client";

import { useMemo, useState } from "react";
import type { ReviewerOption } from "@/lib/review-reviewer-options";

/**
 * The export endpoints reject an out-of-domain parameter with a 400 rather
 * than silently widening the request, and an empty string is out of domain.
 * A plain GET <form> would submit `?role_applied=` for an "Tất cả" option and
 * be refused, so the URL is built here instead and empty selections are
 * omitted entirely. That keeps the strict server contract intact rather than
 * loosening it to suit the markup.
 */
const ALL = "";

function buildUrl(base: string, seasonId: string, params: Record<string, string>) {
  const search = new URLSearchParams({ season_id: seasonId });
  for (const [key, value] of Object.entries(params)) {
    if (value !== ALL) search.set(key, value);
  }
  return `${base}?${search.toString()}`;
}

const selectClass =
  "h-10 w-full rounded-md border border-vam-line bg-white px-3 text-sm text-vam-ink focus:border-vam-green focus:outline-none";
const labelClass = "block text-sm font-medium text-vam-ink";
const downloadClass =
  "inline-flex items-center rounded-md bg-vam-green px-4 py-2 text-sm font-medium text-white hover:opacity-90";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className={labelClass}>{label}</span>
      <span className="mt-1 block">{children}</span>
    </label>
  );
}

export function ResultsExportPanel({ seasonId, seasonLabel }: { seasonId: string; seasonLabel: string }) {
  const [role, setRole] = useState(ALL);
  const [group, setGroup] = useState(ALL);
  const [advanced, setAdvanced] = useState(false);
  const [screening, setScreening] = useState(ALL);
  const [interview, setInterview] = useState(ALL);
  const [final, setFinal] = useState(ALL);
  const [status, setStatus] = useState(ALL);

  const href = useMemo(
    () =>
      buildUrl("/api/exports/recruitment-results", seasonId, {
        role_applied: role,
        operational_group: group,
        ...(advanced
          ? {
              screening_decision: screening,
              interview_decision: interview,
              final_decision: final,
              status
            }
          : {})
      }),
    [seasonId, role, group, advanced, screening, interview, final, status]
  );

  return (
    <section className="mb-6 rounded-lg border border-vam-line bg-white p-4">
      <h2 className="text-base font-semibold text-vam-ink">Xuất kết quả tuyển</h2>
      <p className="mt-1 text-sm text-slate-600">
        Mùa {seasonLabel}. Nhóm vận hành dựa trên trạng thái hiện tại của đơn; các cột &quot;Kết quả&quot; giữ
        nguyên bằng chứng audit và để trống khi chưa từng có quyết định được ghi nhận.
      </p>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Field label="Vai trò">
          <select className={selectClass} value={role} onChange={(e) => setRole(e.target.value)} aria-label="Vai trò">
            <option value={ALL}>Tất cả</option>
            <option value="mentor">Mentor</option>
            <option value="mentee">Mentee</option>
          </select>
        </Field>
        <Field label="Nhóm vận hành">
          <select className={selectClass} value={group} onChange={(e) => setGroup(e.target.value)} aria-label="Nhóm vận hành">
            <option value={ALL}>Tất cả</option>
            <option value="passed_screening">Đã qua vòng hồ sơ</option>
            <option value="passed_interview">Đã qua vòng phỏng vấn</option>
            <option value="approved">Đã duyệt chính thức</option>
            <option value="rejected">Không phù hợp / từ chối</option>
            <option value="needs_more_review">Cần review thêm</option>
          </select>
        </Field>
      </div>

      <button
        type="button"
        onClick={() => setAdvanced((value) => !value)}
        className="mt-4 text-sm font-medium text-vam-green underline"
      >
        {advanced ? "Ẩn bộ lọc nâng cao" : "Nâng cao"}
      </button>

      {advanced && (
        <div className="mt-3 grid gap-4 rounded-md bg-slate-50 p-3 sm:grid-cols-2">
          <p className="text-xs text-slate-600 sm:col-span-2">
            Các bộ lọc dưới đây chỉ dựa trên bằng chứng audit đã ghi nhận. Đơn thiếu audit lịch sử sẽ không xuất
            hiện, kể cả khi trạng thái hiện tại cho thấy đã qua vòng.
          </p>
          <Field label="Kết quả sơ loại (audit)">
            <select className={selectClass} value={screening} onChange={(e) => setScreening(e.target.value)} aria-label="Kết quả sơ loại (audit)">
              <option value={ALL}>Tất cả</option>
              <option value="passed">Đạt</option>
              <option value="rejected">Từ chối</option>
              <option value="waitlisted">Danh sách chờ</option>
              <option value="needs_more_review">Cần review thêm</option>
              <option value="pending">Chưa có quyết định</option>
            </select>
          </Field>
          <Field label="Kết quả phỏng vấn (audit)">
            <select className={selectClass} value={interview} onChange={(e) => setInterview(e.target.value)} aria-label="Kết quả phỏng vấn (audit)">
              <option value={ALL}>Tất cả</option>
              <option value="passed">Đạt</option>
              <option value="rejected">Từ chối</option>
              <option value="waitlisted">Danh sách chờ</option>
              <option value="needs_more_review">Cần review thêm</option>
              <option value="pending">Chưa có quyết định</option>
            </select>
          </Field>
          <Field label="Kết quả cuối cùng (audit)">
            <select className={selectClass} value={final} onChange={(e) => setFinal(e.target.value)} aria-label="Kết quả cuối cùng (audit)">
              <option value={ALL}>Tất cả</option>
              <option value="passed">Đã duyệt</option>
              <option value="rejected">Từ chối</option>
              <option value="waitlisted">Danh sách chờ</option>
              <option value="pending">Chưa có quyết định</option>
            </select>
          </Field>
          <Field label="Trạng thái hiện tại">
            <select className={selectClass} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Trạng thái hiện tại">
              <option value={ALL}>Tất cả</option>
              <option value="submitted">Đã nộp</option>
              <option value="screening_completed">Hoàn tất sơ loại</option>
              <option value="screening_passed">Qua vòng hồ sơ</option>
              <option value="invited_to_interview">Mời phỏng vấn</option>
              <option value="ready_for_final_decision">Sẵn sàng ra quyết định cuối</option>
              <option value="interview_passed">Qua vòng phỏng vấn</option>
              <option value="approved_as_mentor">Đã duyệt — Mentor</option>
              <option value="approved_as_mentee">Đã duyệt — Mentee</option>
              <option value="needs_more_review">Cần review thêm</option>
              <option value="rejected_or_not_fit">Không phù hợp</option>
            </select>
          </Field>
        </div>
      )}

      <div className="mt-4">
        <a href={href} download className={downloadClass} data-testid="results-export-link">
          Tải CSV kết quả tuyển
        </a>
      </div>
    </section>
  );
}

export function ScoresExportPanel({
  seasonId,
  seasonLabel,
  reviewers
}: {
  seasonId: string;
  seasonLabel: string;
  reviewers: ReviewerOption[];
}) {
  const [role, setRole] = useState(ALL);
  const [round, setRound] = useState(ALL);
  const [status, setStatus] = useState(ALL);
  const [reviewer, setReviewer] = useState(ALL);

  const href = useMemo(
    () =>
      buildUrl("/api/exports/review-scores", seasonId, {
        role_applied: role,
        review_round: round,
        review_status: status,
        reviewer
      }),
    [seasonId, role, round, status, reviewer]
  );

  return (
    <section className="mb-6 rounded-lg border border-vam-line bg-white p-4">
      <h2 className="text-base font-semibold text-vam-ink">Xuất điểm review</h2>
      <p className="mt-1 text-sm text-slate-600">
        Mùa {seasonLabel}. Danh sách reviewer lấy từ các review đã tồn tại trong mùa này, nên vẫn lọc được cả
        người đã thôi tham gia và tài khoản admin/core team từng chấm.
      </p>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Field label="Vai trò">
          <select className={selectClass} value={role} onChange={(e) => setRole(e.target.value)} aria-label="Vai trò">
            <option value={ALL}>Tất cả</option>
            <option value="mentor">Mentor</option>
            <option value="mentee">Mentee</option>
          </select>
        </Field>
        <Field label="Vòng review">
          <select className={selectClass} value={round} onChange={(e) => setRound(e.target.value)} aria-label="Vòng review">
            <option value={ALL}>Tất cả</option>
            <option value="profile_screening">Hồ sơ</option>
            <option value="interview">Phỏng vấn</option>
          </select>
        </Field>
        <Field label="Trạng thái">
          <select className={selectClass} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Trạng thái">
            <option value={ALL}>Tất cả</option>
            <option value="assigned">Chưa bắt đầu</option>
            <option value="in_progress">Đang làm</option>
            <option value="submitted">Đã nộp</option>
            <option value="cancelled">Đã huỷ</option>
          </select>
        </Field>
        <Field label="Reviewer">
          <select className={selectClass} value={reviewer} onChange={(e) => setReviewer(e.target.value)} aria-label="Reviewer">
            <option value={ALL}>Tất cả</option>
            {reviewers.map((option) => (
              <option key={option.adminUserId} value={option.adminUserId}>
                {option.fullName || option.email || option.adminUserId} ({option.reviewCount})
              </option>
            ))}
          </select>
        </Field>
      </div>

      {!reviewers.length && (
        <p className="mt-3 text-sm text-slate-500">Chưa có review nào trong mùa này.</p>
      )}

      <div className="mt-4">
        <a href={href} download className={downloadClass} data-testid="scores-export-link">
          Tải CSV điểm review
        </a>
      </div>
    </section>
  );
}
