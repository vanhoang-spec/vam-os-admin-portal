"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useFormState } from "react-dom";
import type { ManagedAdminUser } from "@/lib/admin-users";
import type { ProgramCatalogRow, SeasonCatalogRow } from "@/lib/program-context-core";
import {
  createAdminUserAction,
  removeAdminAccessAction,
  resendAdminInviteAction,
  setAdminUserStatusAction,
  syncAdminUserAuthAction,
  updateAdminUserAction,
  type AdminUserActionState
} from "./actions";

export type ScopeCatalogOptions = {
  programs: ProgramCatalogRow[];
  seasons: SeasonCatalogRow[];
  selectedProgramId: string;
  selectedSeasonId: string;
};

const initialState: AdminUserActionState = { ok: false, message: "" };
const inputClass = "mt-1 w-full rounded-md border border-vam-line bg-white px-3 py-2 text-sm text-vam-ink outline-none focus:border-vam-green focus:ring-2 focus:ring-vam-mint";
const buttonClass = "inline-flex rounded-md bg-vam-green px-3 py-2 text-sm font-medium text-white hover:bg-vam-green/90";
const quietButtonClass = "inline-flex rounded-md border border-vam-line px-3 py-2 text-sm font-medium text-vam-green hover:bg-vam-mint";
const dangerButtonClass = "inline-flex rounded-md border border-red-200 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50";

function ActionMessage({ state }: { state: AdminUserActionState }) {
  const router = useRouter();
  const refreshedMessage = useRef("");
  useEffect(() => {
    if (state.ok && state.message && refreshedMessage.current !== state.message) {
      refreshedMessage.current = state.message;
      router.refresh();
    }
  }, [router, state.message, state.ok]);

  if (!state.message) return null;
  return (
    <div className={state.ok ? "rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700" : "rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"}>
      {state.message}
    </div>
  );
}

function RoleSelect({ defaultValue }: { defaultValue: string }) {
  return (
    <select name="role" defaultValue={defaultValue} className={inputClass}>
      <option value="viewer">Viewer</option>
      <option value="reviewer">Reviewer</option>
      <option value="support_team">Support team</option>
      <option value="core_team">Core team</option>
      <option value="admin">Admin</option>
      <option value="super_admin">Super admin</option>
    </select>
  );
}

function StatusSelect({ defaultValue }: { defaultValue: string }) {
  return (
    <select name="status" defaultValue={defaultValue} className={inputClass}>
      <option value="invited">Đã mời — chưa kích hoạt</option>
      <option value="active">Kích hoạt</option>
      <option value="suspended">Tạm khóa</option>
      <option value="inactive">Ngừng quyền truy cập</option>
    </select>
  );
}

function ScopeRoleSelect({ defaultValue }: { defaultValue: string }) {
  return (
    <select name="scope_role" defaultValue={defaultValue} className={inputClass}>
      <option value="read">Read</option>
      <option value="review">Review</option>
      <option value="operations">Operations</option>
      <option value="full_access">Full access</option>
    </select>
  );
}

function ScopeStatusSelect({ defaultValue }: { defaultValue: string }) {
  return (
    <select name="scope_status" defaultValue={defaultValue} className={inputClass}>
      <option value="active">Kích hoạt</option>
      <option value="inactive">Tạm khóa</option>
    </select>
  );
}

export function CreateAdminUserForm({ scopeOptions }: { scopeOptions: ScopeCatalogOptions }) {
  type ProvisioningUiState = "idle" | "pending" | "success" | "rejected" | "reconciliation" | "ambiguous";
  const [uiState, setUiState] = useState<ProvisioningUiState>("idle");
  const [result, setResult] = useState<AdminUserActionState>(initialState);
  const [selectedProgramId, setSelectedProgramId] = useState(scopeOptions.selectedProgramId);
  const [selectedSeasonId, setSelectedSeasonId] = useState(scopeOptions.selectedSeasonId);
  const [validationError, setValidationError] = useState("");
  const [submittedSummary, setSubmittedSummary] = useState({ fullName: "", role: "", programCode: "", seasonCode: "", scopeRole: "", accountStatus: "", scopeStatus: "" });
  const submittingRef = useRef(false);
  const resultRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const router = useRouter();
  const seasons = scopeOptions.seasons.filter((season) => season.programId === selectedProgramId);
  const terminal = uiState !== "idle" && uiState !== "pending";

  useEffect(() => {
    if (terminal) resultRef.current?.focus();
  }, [terminal]);

  async function submitProvisioning(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submittingRef.current || uiState === "pending" || uiState === "ambiguous" || uiState === "reconciliation") return;
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    const validSeason = scopeOptions.seasons.some((season) => season.id === selectedSeasonId && season.programId === selectedProgramId);
    if (!validSeason) {
      setValidationError("Season không thuộc chương trình đã chọn. Vui lòng chọn lại season.");
      return;
    }
    setValidationError("");
    submittingRef.current = true;
    setResult(initialState);
    setUiState("pending");
    const formData = new FormData(form);
    const clientReference = crypto.randomUUID();
    formData.set("client_reference_id", clientReference);
    setResult({ ok: false, message: "", operationId: clientReference });
    const selectedProgram = scopeOptions.programs.find((row) => row.id === selectedProgramId);
    const selectedSeason = scopeOptions.seasons.find((row) => row.id === selectedSeasonId);
    setSubmittedSummary({
      fullName: String(formData.get("full_name") ?? ""),
      role: String(formData.get("role") ?? ""),
      programCode: selectedProgram?.code ?? "",
      seasonCode: selectedSeason?.code ?? "",
      scopeRole: String(formData.get("scope_role") ?? ""),
      accountStatus: String(formData.get("status") ?? ""),
      scopeStatus: String(formData.get("scope_status") ?? "")
    });
    let timedOut = false;
    const timeout = window.setTimeout(() => {
      timedOut = true;
      setResult({ ok: false, message: "Trạng thái thao tác chưa xác định. Hãy kiểm tra danh sách người dùng và nhật ký trước khi thử lại.", operationId: clientReference });
      setUiState("ambiguous");
      submittingRef.current = false;
    }, 45_000);
    try {
      const next = await createAdminUserAction(initialState, formData);
      window.clearTimeout(timeout);
      if (timedOut) return;
      setResult(next);
      if (next.ok) {
        setUiState("success");
        form.reset();
        setSelectedProgramId(scopeOptions.selectedProgramId);
        setSelectedSeasonId(scopeOptions.selectedSeasonId);
        router.refresh();
      } else if (next.reconciliationRequired) {
        setUiState("reconciliation");
      } else if (next.status === "rejected") {
        setUiState("rejected");
      } else {
        setUiState("ambiguous");
      }
    } catch {
      window.clearTimeout(timeout);
      if (!timedOut) {
        setResult({ ok: false, message: "Không nhận được kết quả xác nhận. Hãy kiểm tra danh sách người dùng và nhật ký trước khi thử lại.", operationId: clientReference });
        setUiState("ambiguous");
      }
    } finally {
      if (!timedOut) submittingRef.current = false;
    }
  }

  const stageLabel = result.failureStage === "journal" ? "Khởi tạo nhật ký" : result.failureStage === "pre_lookup" ? "Kiểm tra danh tính" : result.failureStage === "provider" ? "Nhà cung cấp Auth" : result.failureStage === "application" ? "Ghi nhận tài khoản" : result.failureStage === "compensation" ? "Hoàn tác an toàn" : result.failureStage === "reconciliation" ? "Đối soát" : "Chưa xác định";
  const safeFailureCategory = result.status === "rejected" ? "Yêu cầu bị từ chối an toàn" : result.reconciliationRequired ? "Cần đối soát" : "Không hoàn tất an toàn";
  return (
    <form ref={formRef} onSubmit={submitProvisioning} noValidate={false} aria-busy={uiState === "pending"} className="grid gap-3">
      {terminal ? (
        <div ref={resultRef} tabIndex={-1} role={uiState === "success" ? "status" : "alert"} className={uiState === "success" ? "rounded-md border border-green-200 bg-green-50 p-4 text-sm text-green-800" : "rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"}>
          <h3 className="font-semibold">{uiState === "success" ? "Tạo / mời người dùng thành công" : uiState === "rejected" ? "Yêu cầu bị từ chối an toàn" : uiState === "reconciliation" ? "Cần đối soát thủ công" : "Trạng thái chưa xác định"}</h3>
          {uiState === "success" ? (
            <dl className="mt-2 grid gap-1 sm:grid-cols-2">
              <div><dt className="font-medium">Họ tên</dt><dd>{submittedSummary.fullName}</dd></div>
              <div><dt className="font-medium">Vai trò</dt><dd>{submittedSummary.role}</dd></div>
              <div><dt className="font-medium">Program / season</dt><dd>{submittedSummary.programCode} / {submittedSummary.seasonCode}</dd></div>
              <div><dt className="font-medium">Phạm vi</dt><dd>{submittedSummary.scopeRole} · Tài khoản {submittedSummary.accountStatus} · Scope {submittedSummary.scopeStatus}</dd></div>
              <div><dt className="font-medium">Liên kết Auth</dt><dd>Đã liên kết</dd></div>
            </dl>
          ) : (
            <p className="mt-2">Loại kết quả: {safeFailureCategory}. Giai đoạn: {stageLabel}. {result.reconciliationRequired || uiState === "ambiguous" ? "Không tự động thử lại. Hãy kiểm tra danh sách người dùng và nhật ký/audit trước mọi lần thử lại." : "Các trường đã nhập được giữ nguyên để kiểm tra."}</p>
          )}
          <p className="mt-2 font-mono text-xs">Mã tham chiếu: {result.operationId ?? "Chưa nhận được từ máy chủ"}</p>
          {uiState === "success" ? <a href="#managed-users" className="mt-3 inline-flex font-medium text-vam-green underline">Xem tài khoản mới trong danh sách đã làm mới</a> : null}
        </div>
      ) : null}
      {validationError ? <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{validationError}</div> : null}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <label className="block">
          <span className="text-xs font-medium uppercase text-slate-500">Email</span>
          <input name="email" type="email" required className={inputClass} placeholder="name@example.com" />
        </label>
        <label className="block">
          <span className="text-xs font-medium uppercase text-slate-500">Họ tên</span>
          <input name="full_name" required minLength={2} className={inputClass} placeholder="Tên người dùng" />
        </label>
        <label className="block">
          <span className="text-xs font-medium uppercase text-slate-500">Vai trò</span>
          <RoleSelect defaultValue="viewer" />
        </label>
        <label className="block">
          <span className="text-xs font-medium uppercase text-slate-500">Trạng thái</span>
          <select name="status" required defaultValue="invited" className={inputClass}><option value="invited">Đã mời — chưa kích hoạt</option></select>
        </label>
        <label className="block">
          <span className="text-xs font-medium uppercase text-slate-500">Season</span>
          <select name="season_id" required className={inputClass} value={selectedSeasonId} onChange={(event) => setSelectedSeasonId(event.target.value)}>
            <option value="" disabled>Chọn season</option>
            {seasons.map((season) => <option key={season.id} value={season.id}>{season.name} ({season.code})</option>)}
          </select>
        </label>
        <label className="block">
          <span className="text-xs font-medium uppercase text-slate-500">Program</span>
          <select name="program_id" required className={inputClass} value={selectedProgramId} onChange={(event) => { setSelectedProgramId(event.target.value); setSelectedSeasonId(""); }}>
            <option value="" disabled>Chọn chương trình</option>
            {scopeOptions.programs.map((program) => <option key={program.id} value={program.id}>{program.name} ({program.code})</option>)}
          </select>
        </label>
        <label className="block">
          <span className="text-xs font-medium uppercase text-slate-500">Phân quyền</span>
          <ScopeRoleSelect defaultValue="read" />
        </label>
        <label className="block">
          <span className="text-xs font-medium uppercase text-slate-500">Trạng thái phân quyền</span>
          <ScopeStatusSelect defaultValue="active" />
        </label>
      </div>
      <button type="submit" disabled={uiState === "pending" || uiState === "ambiguous" || uiState === "reconciliation"} className={`${buttonClass} items-center gap-2 disabled:cursor-not-allowed disabled:opacity-60`}>
        {uiState === "pending" ? <span aria-hidden="true" className="h-4 w-4 animate-spin rounded-full border-2 border-white border-r-transparent" /> : null}
        {uiState === "pending" ? "Đang tạo / mời người dùng…" : "Tạo / mời người dùng"}
      </button>
    </form>
  );
}

export function EditAdminUserForm({ user, scopeOptions }: { user: ManagedAdminUser; scopeOptions: ScopeCatalogOptions }) {
  const [state, formAction] = useFormState(updateAdminUserAction, initialState);
  const scopes = Array.isArray(user.scopes) ? user.scopes : [];
  const scope = scopes[0];
  const canSaveScope = Boolean(user.auth_user_id);
  const scopeProgram = scope?.program_id ?? scope?.program ?? scopeOptions.selectedProgramId;
  const scopeSeason = scope?.season_id ?? scope?.season_code ?? scopeOptions.selectedSeasonId;
  const scopeLevel = scope?.role ?? scope?.scope_level ?? "read";
  return (
    <div className="grid gap-3">
      <div className={canSaveScope ? "rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700" : "rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"}>
        {canSaveScope ? "Danh tính Auth: đã liên kết" : "Danh tính Auth: chưa liên kết; cần Đồng bộ Auth trước khi lưu scope."}
      </div>
      {!canSaveScope ? <SyncAuthForm user={user} /> : null}
      {canSaveScope && !scope ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Chưa có row trong admin_scope_access. Bấm Lưu thay đổi sẽ tạo scope mặc định cho user này.
        </div>
      ) : null}
      <form action={formAction} className="grid gap-3 rounded-md border border-vam-line bg-slate-50 p-3">
        <input type="hidden" name="id" value={user.id} />
        <input type="hidden" name="scope_id" value={scope?.id ?? ""} />
        <ActionMessage state={state} />
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <label className="block">
            <span className="text-xs font-medium uppercase text-slate-500">Họ tên</span>
            <input name="full_name" defaultValue={user.full_name ?? ""} className={inputClass} />
          </label>
          <label className="block">
            <span className="text-xs font-medium uppercase text-slate-500">Vai trò</span>
            <RoleSelect defaultValue={user.role} />
          </label>
          <label className="block">
            <span className="text-xs font-medium uppercase text-slate-500">Trạng thái</span>
            <StatusSelect defaultValue={user.status} />
          </label>
          <label className="block">
            <span className="text-xs font-medium uppercase text-slate-500">Program</span>
            <select name="program_id" defaultValue={scopeProgram} disabled={!canSaveScope} required className={inputClass}>
              <option value="" disabled>Chọn chương trình</option>
              {scopeOptions.programs.map((program) => <option key={program.id} value={program.id}>{program.name} ({program.code})</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-medium uppercase text-slate-500">Season</span>
            <select name="season_id" defaultValue={scopeSeason} disabled={!canSaveScope} required className={inputClass}>
              <option value="" disabled>Chọn season</option>
              {scopeOptions.seasons.filter((season) => season.programId === scopeProgram).map((season) => <option key={season.id} value={season.id}>{season.name} ({season.code})</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-medium uppercase text-slate-500">scope_level</span>
            <div className={!canSaveScope ? "pointer-events-none opacity-60" : undefined}>
              <ScopeRoleSelect defaultValue={scopeLevel} />
            </div>
          </label>
          <label className="block">
            <span className="text-xs font-medium uppercase text-slate-500">scope_status</span>
            <div className={!canSaveScope ? "pointer-events-none opacity-60" : undefined}>
              <ScopeStatusSelect defaultValue={scope?.status ?? "active"} />
            </div>
          </label>
          <div className="flex items-end">
            <button type="submit" className={quietButtonClass}>
              Lưu thay đổi
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

export function StatusToggleForm({ user, disabled }: { user: ManagedAdminUser; disabled: boolean }) {
  const [state, formAction] = useFormState(setAdminUserStatusAction, initialState);
  const nextStatus = user.status === "active" ? "inactive" : "active";
  return (
    <form action={formAction} className="grid gap-1" onSubmit={(event) => { if (nextStatus !== "active" && !window.confirm("Tạm khóa tài khoản này? Người dùng sẽ mất quyền truy cập.")) event.preventDefault(); }}>
      <input type="hidden" name="id" value={user.id} />
      <input type="hidden" name="status" value={nextStatus} />
      <button type="submit" disabled={disabled} className={nextStatus === "active" ? quietButtonClass : dangerButtonClass}>
        {nextStatus === "active" ? "Kích hoạt lại" : "Tạm khóa"}
      </button>
      <ActionMessage state={state} />
    </form>
  );
}

export function SyncAuthForm({ user }: { user: ManagedAdminUser }) {
  const [state, formAction] = useFormState(syncAdminUserAuthAction, initialState);
  return (
    <form action={formAction} className="grid gap-1">
      <input type="hidden" name="id" value={user.id} />
      <button type="submit" className={quietButtonClass}>
        Đồng bộ Auth
      </button>
      <ActionMessage state={state} />
    </form>
  );
}

export function RemoveAccessForm({ user, disabled }: { user: ManagedAdminUser; disabled: boolean }) {
  const [state, formAction] = useFormState(removeAdminAccessAction, initialState);
  return (
    <form action={formAction} className="grid gap-1" onSubmit={(event) => { if (!window.confirm("Ngừng quyền quản trị? Auth user sẽ không bị xóa.")) event.preventDefault(); }}>
      <input type="hidden" name="id" value={user.id} />
      <button type="submit" disabled={disabled} className={dangerButtonClass}>
        Xóa quyền admin
      </button>
      <ActionMessage state={state} />
    </form>
  );
}

/**
 * Gửi lại thư mời — chỉ hiện với tài khoản còn ở trạng thái đã mời.
 *
 * Hỏi lại trước khi gửi, vì mỗi lần gửi làm link trong thư cũ hết dùng được: bấm
 * hai lần là người nhận cầm hai lá thư mà chỉ lá sau còn chạy.
 */
export function ResendInviteForm({ user }: { user: ManagedAdminUser }) {
  const [state, formAction] = useFormState(resendAdminInviteAction, initialState);
  if (user.status !== "invited") return null;
  return (
    <form action={formAction} className="grid gap-1" onSubmit={(event) => { if (!window.confirm("Gửi lại thư mời đặt mật khẩu? Link trong thư cũ sẽ không còn dùng được.")) event.preventDefault(); }}>
      <input type="hidden" name="id" value={user.id} />
      <button type="submit" className={quietButtonClass}>
        Gửi lại thư mời
      </button>
      <ActionMessage state={state} />
    </form>
  );
}
