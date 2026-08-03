import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(join(__dirname, "..", path), "utf8");
const form = read("app/admin/users/user-management-forms.tsx");
const action = read("app/admin/users/actions.ts");
const journal = read("lib/manual-staff-provisioning.ts");
const resultBanner = form.slice(form.indexOf("{terminal ?"), form.indexOf("{validationError ?"));

describe("staff provisioning visible state machine", () => {
  it("shows immediate pending feedback and an accessibility-safe busy state", () => {
    expect(form).toContain('setUiState("pending")');
    expect(form).toContain('aria-busy={uiState === "pending"}');
    expect(form).toContain("Đang tạo / mời người dùng…");
    expect(form).toContain("animate-spin");
  });

  it("disables pending submission and guards duplicate click or Enter submission", () => {
    expect(form).toContain("submittingRef.current");
    expect(form).toContain('uiState === "pending"');
    expect(form).toContain('disabled={uiState === "pending" || uiState === "ambiguous" || uiState === "reconciliation"}');
  });

  it("refreshes, links the list, and clears only after confirmed success", () => {
    const success = form.slice(form.indexOf("if (next.ok)"), form.indexOf("} else if (next.reconciliationRequired)"));
    expect(success).toContain('setUiState("success")');
    expect(success).toContain("form.reset()");
    expect(success).toContain("router.refresh()");
    expect(resultBanner).toContain('#managed-users');
  });

  it("preserves fields on failure and displays safe stage plus correlation ID", () => {
    const resetCalls = form.match(/form\.reset\(\)/g) ?? [];
    expect(resetCalls).toHaveLength(1);
    expect(resultBanner).toContain("stageLabel");
    expect(resultBanner).toContain("safeFailureCategory");
    expect(resultBanner).toContain("result.operationId");
  });

  it("treats timeouts and unconfirmed responses as ambiguous without blind retry", () => {
    expect(form).toContain("45_000");
    expect(form).toContain("crypto.randomUUID()");
    expect(form).toContain('formData.set("client_reference_id", clientReference)');
    expect(form).toContain('setUiState("ambiguous")');
    expect(resultBanner).toContain("Không tự động thử lại");
    expect(resultBanner).not.toMatch(/<button[^>]*>[^<]*(Thử lại|retry)/i);
  });

  it("does not render email, Auth IDs, credentials, or provider payload in result banners", () => {
    expect(resultBanner).not.toMatch(/submittedSummary\.email|auth_user_id|password|credential|provider payload|token|cookie/i);
  });

  it("moves keyboard focus to every terminal result banner", () => {
    expect(form).toContain("resultRef.current?.focus()");
    expect(resultBanner).toContain("tabIndex={-1}");
    expect(resultBanner).toContain('role={uiState === "success" ? "status" : "alert"}');
  });
});

describe("authoritative provisioning validation", () => {
  it("uses catalog selectors with dependent season options", () => {
    expect(form).toContain('select name="program_id"');
    expect(form).toContain('select name="season_id"');
    expect(form).toContain("season.programId === selectedProgramId");
    expect(form).toContain('setSelectedSeasonId("")');
  });

  it("blocks invalid program/season pairs before provider activity on client and server", () => {
    expect(form).toContain("season.id === selectedSeasonId && season.programId === selectedProgramId");
    expect(action).toContain("row.id === seasonId && row.programId === program?.id");
    expect(action).toContain("Chưa gọi nhà cung cấp Auth");
  });

  it("requires every authoritative field", () => {
    for (const field of ["full_name", "role", "status", "program_id", "season_id", "scope_role", "scope_status"]) {
      expect(form).toContain(`name="${field}"`);
    }
    expect(form).toContain("required minLength={2}");
  });

  it("retains the durable journal before provider activity", () => {
    expect(journal.indexOf("deps.beginJournal()")).toBeLessThan(journal.indexOf("deps.invite()"));
    expect(journal).toContain("reconciliationRequired");
    expect(journal).toContain("operationId");
  });
});
