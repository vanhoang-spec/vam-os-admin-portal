"use client";

import Link from "next/link";
import { useFormState, useFormStatus } from "react-dom";
import { approveApplicationAction } from "@/app/actions/application-approvals";
import { initialApprovalActionState } from "@/lib/approval-action-types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex h-9 items-center gap-2 rounded-md bg-vam-green px-4 text-sm font-medium text-white hover:bg-vam-ink disabled:opacity-50"
    >
      {pending ? "Đang xử lý…" : label}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export type ApprovalFormProps = {
  applicationId: string;
  currentStatus: string | null;
  /** Coalesced from application + person */
  fullName: string | null;
  emailPrimary: string | null;
  phonePrimary: string | null;
  gender: string | null;
  roleApplied: string | null;
  seasonCode: string | null;
  /** Phase 043: intake batch id from application.intake_batch_id */
  intakeBatchId?: string | null;
  /** True when application already has a person_id set */
  alreadyApproved: boolean;
  personId?: string | null;
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ApprovalForm({
  applicationId,
  currentStatus,
  fullName,
  emailPrimary,
  phonePrimary,
  gender,
  roleApplied,
  seasonCode,
  intakeBatchId,
  alreadyApproved,
  personId
}: ApprovalFormProps) {
  const [state, action] = useFormState(
    approveApplicationAction,
    initialApprovalActionState
  );

  // Derive suggested target_role from role_applied
  const suggestedRole =
    roleApplied?.toLowerCase().includes("mentor") ? "mentor"
    : roleApplied?.toLowerCase().includes("mentee") ? "mentee"
    : null;

  const effectivePersonId = state.personId ?? personId;

  return (
    <div className="space-y-4">
      {/* Action feedback */}
      {state.message && (
        <div
          className={`rounded-md border px-3 py-2 text-sm ${
            state.ok
              ? "border-green-200 bg-green-50 text-green-700"
              : "border-red-200 bg-red-50 text-red-700"
          }`}
        >
          {state.message}
          {state.ok && effectivePersonId && (
            <div className="mt-2 flex gap-3">
              <Link
                href={`/people/${effectivePersonId}`}
                className="inline-flex rounded-md border border-green-300 px-2 py-0.5 text-xs font-medium text-green-800 hover:bg-green-100"
              >
                Xem hồ sơ người →
              </Link>
              {state.profileId && (
                <Link
                  href={
                    roleApplied?.toLowerCase().includes("mentor")
                      ? `/mentors/${state.profileId}`
                      : `/mentees/${state.profileId}`
                  }
                  className="inline-flex rounded-md border border-green-300 px-2 py-0.5 text-xs font-medium text-green-800 hover:bg-green-100"
                >
                  {roleApplied?.toLowerCase().includes("mentor") ? "Xem mentor profile →" : "Xem mentee profile →"}
                </Link>
              )}
            </div>
          )}
        </div>
      )}

      {/* Already-approved notice */}
      {alreadyApproved && !state.ok && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
          Đơn này đã được duyệt (person_id đã được liên kết). Nếu tiếp tục, hệ thống sẽ
          kiểm tra trùng email và dùng lại hồ sơ người / profile sẵn có nếu tìm thấy.
        </div>
      )}

      {/* Preview card — data that will be used to create/find the person */}
      <div className="rounded-md border border-vam-line bg-slate-50 px-4 py-3 text-sm">
        <div className="mb-2 text-xs font-semibold uppercase text-slate-500">
          Dữ liệu sẽ dùng để tạo / tìm hồ sơ người
        </div>
        <dl className="grid gap-x-4 gap-y-1.5 sm:grid-cols-2">
          <div>
            <dt className="text-xs text-slate-500">Họ tên</dt>
            <dd className="font-medium text-vam-ink">{fullName ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Email</dt>
            <dd className="text-vam-ink">{emailPrimary ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">SĐT</dt>
            <dd className="text-vam-ink">{phonePrimary ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Giới tính</dt>
            <dd className="text-vam-ink">{gender ?? "—"}</dd>
          </div>
        </dl>
        {!emailPrimary && (
          <p className="mt-2 text-xs text-amber-600">
            Không có email — sẽ tạo người mới mà không kiểm tra trùng.
          </p>
        )}
      </div>

      {/* Approval form */}
      <form action={action} className="space-y-3">
        {/* Hidden identity fields passed to the action */}
        <input type="hidden" name="application_id" value={applicationId} />
        <input type="hidden" name="full_name" value={fullName ?? ""} />
        <input type="hidden" name="email_primary" value={emailPrimary ?? ""} />
        <input type="hidden" name="phone_primary" value={phonePrimary ?? ""} />
        <input type="hidden" name="gender" value={gender ?? ""} />
        <input type="hidden" name="season_code" value={seasonCode ?? ""} />
        <input type="hidden" name="intake_batch_id" value={intakeBatchId ?? ""} />
        <input type="hidden" name="previous_status" value={currentStatus ?? ""} />

        <div>
          <label className="block text-xs font-medium uppercase text-slate-500">
            Duyệt làm <span className="text-red-500">*</span>
          </label>
          <select
            name="target_role"
            required
            defaultValue={suggestedRole ?? ""}
            className="mt-1 w-full rounded-md border border-vam-line bg-white px-2 py-1.5 text-sm text-vam-ink focus:outline-none focus:ring-1 focus:ring-vam-green"
          >
            <option value="" disabled>-- Chọn vai trò --</option>
            <option value="mentee">Mentee</option>
            <option value="mentor">Mentor</option>
          </select>
          {suggestedRole && (
            <p className="mt-0.5 text-xs text-slate-500">
              Đề xuất dựa trên role_applied: <strong>{roleApplied}</strong>
            </p>
          )}
        </div>

        <SubmitButton
          label={
            suggestedRole === "mentor"
              ? "Duyệt làm Mentor chính thức"
              : suggestedRole === "mentee"
              ? "Duyệt làm Mentee chính thức"
              : "Duyệt thành viên chính thức"
          }
        />
      </form>
    </div>
  );
}
