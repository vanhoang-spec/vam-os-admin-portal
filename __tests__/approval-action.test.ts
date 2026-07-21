/**
 * Authorization-boundary tests for the approveApplicationAction server action.
 *
 * approveApplication() (the library function) has no internal auth check —
 * authorization is the server action's responsibility.
 * These tests verify that the server action enforces role before calling the
 * library mutation, and that no mutation occurs for unauthorized callers.
 *
 * Classification: DIRECT SERVER ACTION TESTS (call actual server action export).
 */
import { vi, describe, it, expect, beforeEach, type Mock } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/admin-auth", () => ({ getCurrentAdminUser: vi.fn() }));
vi.mock("@/lib/application-approvals", () => ({ approveApplication: vi.fn() }));

import { getCurrentAdminUser } from "@/lib/admin-auth";
import { approveApplication } from "@/lib/application-approvals";
import { approveApplicationAction } from "@/app/actions/application-approvals";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeFormData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

const validFormData = () =>
  makeFormData({
    application_id: "00000000-0000-4000-8000-000000000010",
    target_role: "mentor",
    full_name: "Nguyễn Văn Test",
    email_primary: "test@example.com",
    phone_primary: "",
    gender: "",
    season_code: "UEHM-S12",
    intake_batch_id: "",
    previous_status: "submitted",
  });

const prev = { ok: false as const, message: null };

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.resetAllMocks();
});

// ── Authorization boundary ────────────────────────────────────────────────────

describe("approveApplicationAction — authorization boundary", () => {
  it("viewer role → rejected before approveApplication is called", async () => {
    (getCurrentAdminUser as Mock).mockResolvedValue({ id: "viewer-1", role: "viewer" });
    const result = await approveApplicationAction(prev, validFormData());
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/admin|core team|duyệt/i);
    expect(approveApplication).not.toHaveBeenCalled();
  });

  it("support_team role → rejected before approveApplication is called", async () => {
    (getCurrentAdminUser as Mock).mockResolvedValue({ id: "support-1", role: "support_team" });
    const result = await approveApplicationAction(prev, validFormData());
    expect(result.ok).toBe(false);
    expect(approveApplication).not.toHaveBeenCalled();
  });

  it("reviewer role → rejected before approveApplication is called", async () => {
    (getCurrentAdminUser as Mock).mockResolvedValue({ id: "reviewer-1", role: "reviewer" });
    const result = await approveApplicationAction(prev, validFormData());
    expect(result.ok).toBe(false);
    expect(approveApplication).not.toHaveBeenCalled();
  });

  it("null adminUser (unauthenticated) → rejected before approveApplication is called", async () => {
    (getCurrentAdminUser as Mock).mockResolvedValue(null);
    const result = await approveApplicationAction(prev, validFormData());
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/đăng nhập/i);
    expect(approveApplication).not.toHaveBeenCalled();
  });

  it("core_team role → passes auth and calls approveApplication", async () => {
    (getCurrentAdminUser as Mock).mockResolvedValue({ id: "core-1", role: "core_team", full_name: "Core User" });
    (approveApplication as Mock).mockResolvedValue({
      ok: true,
      personId: "pid-1",
      profileId: "prof-1",
      personCreated: false,
      profileCreated: false,
    });
    const result = await approveApplicationAction(prev, validFormData());
    expect(result.ok).toBe(true);
    expect(approveApplication).toHaveBeenCalledOnce();
  });

  it("admin role → passes auth and calls approveApplication", async () => {
    (getCurrentAdminUser as Mock).mockResolvedValue({ id: "admin-1", role: "admin", full_name: "Admin User" });
    (approveApplication as Mock).mockResolvedValue({
      ok: true,
      personId: "pid-2",
      profileId: "prof-2",
      personCreated: true,
      profileCreated: true,
    });
    const result = await approveApplicationAction(prev, validFormData());
    expect(result.ok).toBe(true);
    expect(approveApplication).toHaveBeenCalledOnce();
  });

  it("authorized caller receives safe error when approveApplication returns ok:false", async () => {
    (getCurrentAdminUser as Mock).mockResolvedValue({ id: "admin-1", role: "admin", full_name: "Admin" });
    (approveApplication as Mock).mockResolvedValue({
      ok: false,
      message: "Không thể tạo hồ sơ người. Không thể thực hiện thao tác. Vui lòng thử lại hoặc liên hệ admin.",
    });
    const result = await approveApplicationAction(prev, validFormData());
    expect(result.ok).toBe(false);
    // The action echoes the library message — confirm it contains no raw DB detail
    if (!result.ok) {
      expect(result.message).not.toContain("INTERNAL");
      expect(result.message).not.toContain("row-level-security");
    }
  });
});

// ── Input validation (server action layer) ────────────────────────────────────

describe("approveApplicationAction — server-action input validation", () => {
  beforeEach(() => {
    (getCurrentAdminUser as Mock).mockResolvedValue({ id: "admin-1", role: "admin" });
  });

  it("missing application_id → rejected without calling approveApplication", async () => {
    const fd = makeFormData({ target_role: "mentor", full_name: "Test" });
    const result = await approveApplicationAction(prev, fd);
    expect(result.ok).toBe(false);
    expect(approveApplication).not.toHaveBeenCalled();
  });

  it("invalid target_role → rejected without calling approveApplication", async () => {
    const fd = makeFormData({
      application_id: "00000000-0000-4000-8000-000000000010",
      target_role: "super_villain",
      full_name: "Test",
    });
    const result = await approveApplicationAction(prev, fd);
    expect(result.ok).toBe(false);
    expect(approveApplication).not.toHaveBeenCalled();
  });

  it("missing full_name → rejected without calling approveApplication", async () => {
    const fd = makeFormData({
      application_id: "00000000-0000-4000-8000-000000000010",
      target_role: "mentor",
      full_name: "",
    });
    const result = await approveApplicationAction(prev, fd);
    expect(result.ok).toBe(false);
    expect(approveApplication).not.toHaveBeenCalled();
  });
});
