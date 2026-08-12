import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/admin-auth", () => ({ getCurrentAdminUser: vi.fn() }));
vi.mock("@/lib/program-scope", () => ({
  getAdminScopeContext: vi.fn(),
  canOperateSeason: vi.fn()
}));
vi.mock("@/lib/application-form-controls", async () => {
  const actual = await vi.importActual<typeof import("../lib/application-form-controls")>(
    "../lib/application-form-controls"
  );
  return { ...actual, readApplicationFormControls: vi.fn() };
});
vi.mock("@/lib/supabase-server", () => ({ getSupabaseServiceRoleClient: vi.fn() }));

import { setApplicationFormStateAction } from "../app/actions/application-form-controls";
import { canToggleApplicationForm, canViewApplicationFormControls } from "../lib/permissions";
import { readApplicationFormControls } from "@/lib/application-form-controls";
import { canOperateSeason, getAdminScopeContext } from "@/lib/program-scope";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";

const SEASON_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ADMIN_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const DENIED = "Bạn không có quyền thay đổi trạng thái form đăng ký của mùa này.";

function formData(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  return fd;
}

function toggleRequest(overrides: Record<string, string> = {}) {
  return formData({
    applicant_role: "mentor",
    next_state: "open",
    expected_state: "closed",
    ...overrides
  });
}

function control(role: "mentor" | "mentee", state: string) {
  return {
    role,
    state,
    programCode: "UEHM",
    seasonCode: "UEHM-S12",
    intakeBatchCode: "UEHM-S12-B1",
    seasonId: SEASON_ID,
    intakeBatchId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    updatedAt: null,
    updatedByName: null,
    updatedByEmail: null
  };
}

function arrange(options: {
  role?: string;
  status?: string;
  scopeError?: string | null;
  seasonAllowed?: boolean;
  rpcResult?: unknown;
  rpcError?: unknown;
  controlsOk?: boolean;
} = {}) {
  const {
    role = "admin",
    status = "active",
    scopeError = null,
    seasonAllowed = true,
    rpcResult = [{ outcome_status: "changed", previous_state: "closed", new_state: "open" }],
    rpcError = null,
    controlsOk = true
  } = options;

  vi.mocked(getAdminScopeContext).mockResolvedValue({
    adminUser: { id: ADMIN_ID, email: "a@example.com", full_name: "A", role, status },
    authUserId: "auth-1",
    globalRole: role,
    isSuperAdmin: role === "super_admin",
    programScopes: [],
    scopeError
  } as never);

  vi.mocked(canOperateSeason).mockResolvedValue(seasonAllowed as never);

  vi.mocked(readApplicationFormControls).mockResolvedValue(
    (controlsOk
      ? { ok: true, controls: { mentor: control("mentor", "closed"), mentee: control("mentee", "closed") } }
      : { ok: false, reason: "control_rows_missing" }) as never
  );

  const rpc = vi.fn(async () => ({ data: rpcResult, error: rpcError }));
  vi.mocked(getSupabaseServiceRoleClient).mockReturnValue({ rpc } as never);
  return { rpc };
}

describe("M069 — permission predicates", () => {
  it.each(["super_admin", "admin"])("%s may toggle", (role) => {
    expect(canToggleApplicationForm(role)).toBe(true);
  });

  it.each(["core_team", "reviewer", "support_team", "viewer", "", null, undefined])(
    "%s may NOT toggle",
    (role) => {
      expect(canToggleApplicationForm(role as never)).toBe(false);
    }
  );

  it("core_team can still VIEW the screen read-only", () => {
    expect(canViewApplicationFormControls("core_team")).toBe(true);
    expect(canToggleApplicationForm("core_team")).toBe(false);
  });

  it.each(["reviewer", "viewer", "support_team"])("%s cannot even view", (role) => {
    expect(canViewApplicationFormControls(role)).toBe(false);
  });
});

describe("M069 — setApplicationFormStateAction authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("allows a super admin", async () => {
    const { rpc } = arrange({ role: "super_admin" });
    const result = await setApplicationFormStateAction({ ok: false, message: null }, toggleRequest());
    expect(result.ok).toBe(true);
    expect(rpc).toHaveBeenCalledOnce();
  });

  it("allows an admin scoped to UEHM-S12", async () => {
    const { rpc } = arrange({ role: "admin", seasonAllowed: true });
    const result = await setApplicationFormStateAction({ ok: false, message: null }, toggleRequest());
    expect(result.ok).toBe(true);
    expect(rpc).toHaveBeenCalledWith(
      "vam069_set_application_form_state",
      expect.objectContaining({
        p_actor_admin_user_id: ADMIN_ID,
        p_intake_batch_code: "UEHM-S12-B1",
        p_applicant_role: "mentor",
        p_expected_state: "closed",
        p_new_state: "open"
      })
    );
  });

  it("denies an admin with NO scope on UEHM-S12", async () => {
    const { rpc } = arrange({ role: "admin", seasonAllowed: false });
    const result = await setApplicationFormStateAction({ ok: false, message: null }, toggleRequest());
    expect(result).toEqual({ ok: false, message: DENIED });
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each(["core_team", "reviewer", "viewer", "support_team"])(
    "denies %s even with full season scope",
    async (role) => {
      const { rpc } = arrange({ role, seasonAllowed: true });
      const result = await setApplicationFormStateAction({ ok: false, message: null }, toggleRequest());
      expect(result).toEqual({ ok: false, message: DENIED });
      expect(rpc).not.toHaveBeenCalled();
    }
  );

  it("denies an INACTIVE admin", async () => {
    const { rpc } = arrange({ role: "admin", status: "inactive" });
    const result = await setApplicationFormStateAction({ ok: false, message: null }, toggleRequest());
    expect(result).toEqual({ ok: false, message: DENIED });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("denies when the scope grant table is unreadable", async () => {
    // An unreadable grants table looks identical to an ungranted user.
    // Refusing is the only safe reading.
    const { rpc } = arrange({ role: "admin", scopeError: "scope unreadable" });
    const result = await setApplicationFormStateAction({ ok: false, message: null }, toggleRequest());
    expect(result).toEqual({ ok: false, message: DENIED });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("denies when scope resolution throws", async () => {
    vi.mocked(getAdminScopeContext).mockRejectedValue(new Error("db down"));
    const result = await setApplicationFormStateAction({ ok: false, message: null }, toggleRequest());
    expect(result).toEqual({ ok: false, message: DENIED });
  });
});

describe("M069 — request validation and concurrency", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it.each([
    ["an unknown role", { applicant_role: "coordinator" }],
    ["a missing role", { applicant_role: "" }],
    ["an unknown state", { next_state: "enabled" }],
    ["an uppercase state", { next_state: "OPEN" }],
    ["a missing expected state", { expected_state: "" }],
    ["a malformed expected state", { expected_state: "unknown" }]
  ])("rejects %s before authenticating anything", async (_label, overrides) => {
    const { rpc } = arrange();
    const result = await setApplicationFormStateAction(
      { ok: false, message: null },
      toggleRequest(overrides)
    );
    expect(result).toEqual({ ok: false, message: "Yêu cầu không hợp lệ." });
    expect(getAdminScopeContext).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("surfaces the stale-page conflict as a reload instruction", async () => {
    arrange({ rpcError: { message: "vam069: state changed since page load (now open)" } });
    const result = await setApplicationFormStateAction(
      { ok: false, message: null },
      toggleRequest()
    );
    expect(result.ok).toBe(false);
    expect(result.message).toContain("tải lại trang");
  });

  it("maps an RPC authorization failure back to the generic denial", async () => {
    arrange({ rpcError: { message: "vam069: actor not authorized to change application form state" } });
    const result = await setApplicationFormStateAction(
      { ok: false, message: null },
      toggleRequest()
    );
    expect(result).toEqual({ ok: false, message: DENIED });
  });

  it("reports a missing control row as an unapplied migration", async () => {
    arrange({ controlsOk: false });
    const result = await setApplicationFormStateAction(
      { ok: false, message: null },
      toggleRequest()
    );
    expect(result.ok).toBe(false);
    expect(result.message).toContain("069");
  });

  it("never claims success when the RPC returns an unrecognised outcome", async () => {
    arrange({ rpcResult: [{ outcome_status: "" }] });
    const result = await setApplicationFormStateAction(
      { ok: false, message: null },
      toggleRequest()
    );
    expect(result.ok).toBe(false);
  });

  it("never claims success when the RPC returns no rows", async () => {
    arrange({ rpcResult: [] });
    const result = await setApplicationFormStateAction(
      { ok: false, message: null },
      toggleRequest()
    );
    expect(result.ok).toBe(false);
  });

  it("reports a no-op distinctly from a real change", async () => {
    arrange({ rpcResult: [{ outcome_status: "noop" }] });
    const result = await setApplicationFormStateAction(
      { ok: false, message: null },
      toggleRequest()
    );
    expect(result.ok).toBe(true);
    expect(result.outcome).toBe("noop");
    expect(result.message).toContain("không có thay đổi");
  });

  it("never leaks raw SQL text into the admin-facing message", async () => {
    arrange({ rpcError: { message: 'relation "application_form_controls" does not exist' } });
    const result = await setApplicationFormStateAction(
      { ok: false, message: null },
      toggleRequest()
    );
    expect(result.message).not.toContain("application_form_controls");
    expect(result.message).not.toContain("relation");
  });

  it.each(["closed", "pilot", "open"] as const)("can target the %s state", async (next) => {
    const { rpc } = arrange({ role: "super_admin" });
    await setApplicationFormStateAction(
      { ok: false, message: null },
      toggleRequest({ next_state: next })
    );
    expect(rpc).toHaveBeenCalledWith(
      "vam069_set_application_form_state",
      expect.objectContaining({ p_new_state: next })
    );
  });

  it.each(["mentor", "mentee"] as const)("targets role %s independently", async (role) => {
    const { rpc } = arrange({ role: "super_admin" });
    await setApplicationFormStateAction(
      { ok: false, message: null },
      toggleRequest({ applicant_role: role })
    );
    expect(rpc).toHaveBeenCalledWith(
      "vam069_set_application_form_state",
      expect.objectContaining({ p_applicant_role: role })
    );
  });

  it("always sends the fixed UEHM-S12-B1 intake code, never a caller-supplied one", async () => {
    const { rpc } = arrange({ role: "super_admin" });
    const fd = toggleRequest();
    fd.set("intake_batch_code", "UEHM-S11-B1");
    await setApplicationFormStateAction({ ok: false, message: null }, fd);
    expect(rpc).toHaveBeenCalledWith(
      "vam069_set_application_form_state",
      expect.objectContaining({ p_intake_batch_code: "UEHM-S12-B1" })
    );
  });
});
