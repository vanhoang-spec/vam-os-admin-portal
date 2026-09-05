import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/admin-auth", () => ({ getCurrentAdminUser: vi.fn() }));
vi.mock("@/lib/application-decisions", () => ({
  recordApplicationDecision: vi.fn(),
  restoreWithdrawnApplication: vi.fn()
}));

import { getCurrentAdminUser } from "@/lib/admin-auth";
import { restoreWithdrawnApplication } from "@/lib/application-decisions";
import { restoreWithdrawnApplicationAction } from "@/app/actions/application-decisions";

const APP_ID = "00000000-0000-4000-8000-000000000101";

function form(reason = "Khôi phục do xác nhận nhầm") {
  const data = new FormData();
  data.set("application_id", APP_ID);
  data.set("restore_reason", reason);
  return data;
}

describe("restore withdrawn application action", () => {
  beforeEach(() => vi.resetAllMocks());

  it.each(["reviewer", "support_team"])("denies %s", async (role) => {
    vi.mocked(getCurrentAdminUser).mockResolvedValue({ id: "actor", role } as never);
    const result = await restoreWithdrawnApplicationAction({ ok: false, message: null }, form());
    expect(result.ok).toBe(false);
    expect(restoreWithdrawnApplication).not.toHaveBeenCalled();
  });

  it("requires a meaningful internal reason", async () => {
    vi.mocked(getCurrentAdminUser).mockResolvedValue({ id: "actor", role: "admin" } as never);
    const result = await restoreWithdrawnApplicationAction({ ok: false, message: null }, form(" "));
    expect(result.ok).toBe(false);
    expect(restoreWithdrawnApplication).not.toHaveBeenCalled();
  });

  it("passes only application, actor and reason to the trusted restore boundary", async () => {
    vi.mocked(getCurrentAdminUser).mockResolvedValue({ id: "actor", role: "core_team" } as never);
    vi.mocked(restoreWithdrawnApplication).mockResolvedValue({
      ok: true,
      applicationId: APP_ID,
      restoredStatus: "submitted"
    });
    const result = await restoreWithdrawnApplicationAction({ ok: false, message: null }, form("Khôi phục do xác nhận nhầm"));
    expect(result.ok).toBe(true);
    expect(restoreWithdrawnApplication).toHaveBeenCalledWith({
      applicationId: APP_ID,
      actorAdminUserId: "actor",
      reason: "Khôi phục do xác nhận nhầm"
    });
  });
});
