/**
 * @vitest-environment jsdom
 */
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    const error: any = new Error("NEXT_REDIRECT");
    error.digest = `NEXT_REDIRECT;${url}`;
    error.redirectUrl = url;
    throw error;
  })
}));
vi.mock("@/lib/admin-auth", () => ({ getCurrentAdminUser: vi.fn() }));
vi.mock("@/lib/data", () => ({ getApplication: vi.fn() }));
vi.mock("@/lib/application-decisions", () => ({
  // Cổng chia mentor/mentee: vai trò trong các ca này quyết được mọi hồ sơ.
  refuseApplicationsBeyondDecisionRole: vi.fn(async () => ({ ok: true })),
  recordApplicationDecision: vi.fn()
}));
vi.mock("@/lib/program-scope", () => ({
  getAdminScopeContext: vi.fn(async () => ({ scope: "s" })),
  getScopeFilter: vi.fn(async () => ({ scope: "s" }))
}));

import { bulkS12ScreeningAction } from "@/app/actions/s12-screening-bulk";
import { BULK_SCREENING_MAX } from "@/lib/bulk-screening";
import {
  BulkScreeningRowCheckbox,
  BulkScreeningToolbar
} from "@/app/applications/_components/bulk-screening-controls";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import {
  recordApplicationDecision,
  refuseApplicationsBeyondDecisionRole
} from "@/lib/application-decisions";
import { getApplication } from "@/lib/data";

const mockedGetApplication = vi.mocked(getApplication);
const mockedRecord = vi.mocked(recordApplicationDecision);

function appId(n: number) {
  // Distinct in the first 8 characters: the row aria-label uses the short id,
  // so a shared prefix would make the labels ambiguous in queries.
  return `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`;
}

/** The human-readable bulk_result carried on the redirect URL. */
function resultMessage(url: string): string {
  return new URL(url, "https://t").searchParams.get("bulk_result") ?? "";
}

/** Runs the action and returns the URL it redirected to. */
async function runAction(form: FormData): Promise<string> {
  try {
    await bulkS12ScreeningAction(form);
  } catch (error: any) {
    if (error?.redirectUrl) return error.redirectUrl;
    throw error;
  }
  throw new Error("action did not redirect");
}

function formFor(
  role: string,
  ids: string[],
  newStatus: string,
  opts: { expected?: string; note?: string; page?: string; q?: string; mentorType?: string } = {}
) {
  const form = new FormData();
  form.set("queue_role", role);
  for (const id of ids) {
    form.append("application_id", id);
    form.set(`expected_status_${id}`, opts.expected ?? "submitted");
  }
  form.set("new_status", newStatus);
  if (opts.note) form.set("decision_note", opts.note);
  if (opts.page) form.set("return_page", opts.page);
  if (opts.q) form.set("return_q", opts.q);
  if (opts.mentorType) form.set("return_mentor_type", opts.mentorType);
  return form;
}

function application(role: string, status = "submitted") {
  return { data: { id: "x", role_applied: role, status }, error: null } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getCurrentAdminUser).mockResolvedValue({
    id: "admin-1",
    role: "admin",
    email: "admin@example.com",
    full_name: "Admin"
  } as never);
  mockedRecord.mockResolvedValue({ ok: true, id: "x", applied: 1, failed: 0 } as never);
});

afterEach(() => cleanup());

// ── One generic implementation ───────────────────────────────────────────────

describe("one generic screening implementation", () => {
  it("no longer ships a second Mentor-only mutation implementation", () => {
    expect(() => readFileSync("app/actions/mentor-review-bulk.ts", "utf8")).toThrow();
    expect(() => readFileSync("app/applications/mentor-review/bulk-controls.tsx", "utf8")).toThrow();
  });

  it("drives both queues through the same action and control layer", () => {
    const mentor = readFileSync("app/applications/mentor-review/page.tsx", "utf8");
    const mentee = readFileSync("app/applications/mentee-review/page.tsx", "utf8");
    for (const page of [mentor, mentee]) {
      expect(page).toContain("bulkS12ScreeningAction");
      expect(page).toContain("BulkScreeningToolbar");
      expect(page).toContain("BulkScreeningRowCheckbox");
    }
    expect(mentor).toContain('name="queue_role" value="mentor"');
    expect(mentee).toContain('name="queue_role" value="mentee"');
  });

  it("does not add the Mentor-type filter to the Mentee queue", () => {
    const mentee = readFileSync("app/applications/mentee-review/page.tsx", "utf8");
    expect(mentee).not.toContain("mentor_type");
    expect(mentee).not.toContain("Loại Mentor");
  });
});

// ── Mentor path ─────────────────────────────────────────────────────────────

describe("mentor bulk screening through the generic action", () => {
  it.each(["needs_more_review", "rejected_or_not_fit"])(
    "applies %s to mentor applications",
    async (status) => {
      mockedGetApplication.mockResolvedValue(application("mentor"));
      const url = await runAction(formFor("mentor", [appId(1), appId(2)], status));
      expect(mockedRecord).toHaveBeenCalledTimes(2);
      expect(mockedRecord.mock.calls[0][0]).toMatchObject({
        newStatus: status,
        previousStatus: "submitted",
        decidedByAdminUserId: "admin-1"
      });
      expect(url).toContain("/applications/mentor-review");
      expect(url).toContain("bulk_ok=1");
    }
  );

  it("rejects a Mentee application submitted through the Mentor queue", async () => {
    mockedGetApplication.mockResolvedValue(application("mentee"));
    const url = await runAction(formFor("mentor", [appId(1)], "needs_more_review"));
    expect(mockedRecord).not.toHaveBeenCalled();
    expect(resultMessage(url)).toContain("không phải hồ sơ Mentor");
    expect(url).toContain("bulk_ok=0");
  });

  it("preserves the Mentor queue return context", async () => {
    mockedGetApplication.mockResolvedValue(application("mentor"));
    const url = await runAction(
      formFor("mentor", [appId(1)], "needs_more_review", { page: "3", q: "an", mentorType: "returning" })
    );
    expect(url).toContain("page=3");
    expect(url).toContain("q=an");
    expect(url).toContain("mentor_type=returning");
  });
});

// ── Mentee path ─────────────────────────────────────────────────────────────

describe("mentee bulk screening through the generic action", () => {
  it.each(["needs_more_review", "rejected_or_not_fit"])(
    "applies %s to mentee applications",
    async (status) => {
      mockedGetApplication.mockResolvedValue(application("mentee"));
      const url = await runAction(formFor("mentee", [appId(1)], status));
      expect(mockedRecord).toHaveBeenCalledTimes(1);
      expect(mockedRecord.mock.calls[0][0]).toMatchObject({ newStatus: status });
      expect(url).toContain("/applications/mentee-review");
    }
  );

  it("rejects a Mentor application submitted through the Mentee queue", async () => {
    mockedGetApplication.mockResolvedValue(application("mentor"));
    const url = await runAction(formFor("mentee", [appId(1)], "needs_more_review"));
    expect(mockedRecord).not.toHaveBeenCalled();
    expect(resultMessage(url)).toContain("không phải hồ sơ Mentee");
  });

  it("never carries the Mentor-only filter onto the Mentee return URL", async () => {
    mockedGetApplication.mockResolvedValue(application("mentee"));
    const url = await runAction(
      formFor("mentee", [appId(1)], "needs_more_review", { mentorType: "returning", page: "2" })
    );
    expect(url).toContain("/applications/mentee-review");
    expect(url).not.toContain("mentor_type");
    expect(url).toContain("page=2");
  });
});

// ── Shared safety contract ──────────────────────────────────────────────────

describe("bulk screening safety contract", () => {
  it.each(["mentor", "mentee"])("caps %s submissions at 25", async (role) => {
    mockedGetApplication.mockResolvedValue(application(role));
    const ids = Array.from({ length: BULK_SCREENING_MAX + 1 }, (_, i) => appId(i + 1));
    const url = await runAction(formFor(role, ids, "needs_more_review"));
    expect(mockedRecord).not.toHaveBeenCalled();
    expect(resultMessage(url)).toContain("1 đến 25");
  });

  it.each(["mentor", "mentee"])("accepts exactly 25 for %s", async (role) => {
    mockedGetApplication.mockResolvedValue(application(role));
    const ids = Array.from({ length: BULK_SCREENING_MAX }, (_, i) => appId(i + 1));
    await runAction(formFor(role, ids, "needs_more_review"));
    expect(mockedRecord).toHaveBeenCalledTimes(BULK_SCREENING_MAX);
  });

  it("rejects an empty selection", async () => {
    const url = await runAction(formFor("mentor", [], "needs_more_review"));
    expect(mockedRecord).not.toHaveBeenCalled();
    expect(resultMessage(url)).toContain("1 đến 25");
  });

  it("skips a row whose status moved since the page rendered", async () => {
    mockedGetApplication.mockResolvedValue(application("mentor", "needs_more_review"));
    const url = await runAction(formFor("mentor", [appId(1)], "needs_more_review", { expected: "submitted" }));
    expect(mockedRecord).not.toHaveBeenCalled();
    expect(resultMessage(url)).toContain("trạng thái đã thay đổi");
  });

  it("skips a row that has left the pending queue", async () => {
    mockedGetApplication.mockResolvedValue(application("mentor", "invited_to_interview"));
    const url = await runAction(
      formFor("mentor", [appId(1)], "needs_more_review", { expected: "invited_to_interview" })
    );
    expect(mockedRecord).not.toHaveBeenCalled();
    expect(resultMessage(url)).toContain("không còn ở hàng đợi chờ xử lý");
  });

  it("skips a row outside the caller's scope", async () => {
    mockedGetApplication.mockResolvedValue({ data: null, error: "scope" } as never);
    const url = await runAction(formFor("mentor", [appId(1)], "needs_more_review"));
    expect(mockedRecord).not.toHaveBeenCalled();
    expect(resultMessage(url)).toContain("ngoài phạm vi");
  });

  it("reports partial failures instead of hiding them", async () => {
    mockedGetApplication
      .mockResolvedValueOnce(application("mentor"))
      .mockResolvedValueOnce(application("mentee"));
    const url = await runAction(formFor("mentor", [appId(1), appId(2)], "needs_more_review"));
    const decoded = resultMessage(url);
    expect(decoded).toContain("Đã cập nhật 1 hồ sơ");
    expect(decoded).toContain("1 hồ sơ bị chặn");
    expect(url).toContain("bulk_ok=0");
  });

  it("surfaces the atomic decision path's own error message", async () => {
    mockedGetApplication.mockResolvedValue(application("mentor"));
    mockedRecord.mockResolvedValue({ ok: false, message: "Đơn chưa đủ số review hồ sơ tối thiểu." } as never);
    const url = await runAction(formFor("mentor", [appId(1)], "needs_more_review"));
    expect(resultMessage(url)).toContain("Đơn chưa đủ số review hồ sơ tối thiểu.");
  });

  it.each(["interview_passed", "approved_as_mentor", "withdrawn", "waitlisted"])(
    "refuses the non-screening transition %s",
    async (status) => {
      mockedGetApplication.mockResolvedValue(application("mentor"));
      const url = await runAction(formFor("mentor", [appId(1)], status));
      expect(mockedRecord).not.toHaveBeenCalled();
      expect(resultMessage(url)).toContain("không hợp lệ");
    }
  );

  it("refuses an unrecognised queue role", async () => {
    const url = await runAction(formFor("reviewer", [appId(1)], "needs_more_review"));
    expect(mockedRecord).not.toHaveBeenCalled();
    expect(resultMessage(url)).toContain("Hàng đợi duyệt không hợp lệ.");
  });
});

// ── Authorization ───────────────────────────────────────────────────────────

describe("bulk screening authorization follows the mentor/mentee split", () => {
  it.each(["reviewer", "viewer"])("denies %s", async (role) => {
    vi.mocked(getCurrentAdminUser).mockResolvedValue({ id: "u", role } as never);
    const url = await runAction(formFor("mentor", [appId(1)], "needs_more_review"));
    expect(mockedRecord).not.toHaveBeenCalled();
    expect(resultMessage(url)).toContain("Bạn không có quyền duyệt hàng loạt.");
  });

  // 18/09/2026: support_team đi qua được cổng vai trò, rồi dừng lại ở phép chia
  // mentor/mentee — hàng đợi mentor không mở cho họ, hàng đợi mentee thì có.
  it("support_team: bị chặn ở hồ sơ mentor", async () => {
    vi.mocked(refuseApplicationsBeyondDecisionRole).mockResolvedValueOnce({
      ok: false,
      message: "Support Team chỉ đổi được kết quả hồ sơ mentee."
    } as never);
    vi.mocked(getCurrentAdminUser).mockResolvedValue({ id: "u", role: "support_team" } as never);
    const url = await runAction(formFor("mentor", [appId(1)], "needs_more_review"));
    expect(mockedRecord).not.toHaveBeenCalled();
    expect(resultMessage(url)).toContain("chỉ đổi được kết quả hồ sơ mentee");
  });

  it("support_team: quyết được hồ sơ mentee", async () => {
    vi.mocked(getCurrentAdminUser).mockResolvedValue({ id: "u", role: "support_team" } as never);
    mockedGetApplication.mockResolvedValue(application("mentee"));
    await runAction(formFor("mentee", [appId(1)], "needs_more_review"));
    expect(mockedRecord).toHaveBeenCalledTimes(1);
  });

  it.each(["core_team", "admin", "super_admin"])("allows %s", async (role) => {
    vi.mocked(getCurrentAdminUser).mockResolvedValue({ id: "u", role } as never);
    mockedGetApplication.mockResolvedValue(application("mentor"));
    await runAction(formFor("mentor", [appId(1)], "needs_more_review"));
    expect(mockedRecord).toHaveBeenCalledTimes(1);
  });

  it("denies an unauthenticated caller", async () => {
    vi.mocked(getCurrentAdminUser).mockResolvedValue(null as never);
    const url = await runAction(formFor("mentor", [appId(1)], "needs_more_review"));
    expect(mockedRecord).not.toHaveBeenCalled();
    expect(resultMessage(url)).toContain("Bạn không có quyền");
  });

  it("applies the caller's season scope to every row read", async () => {
    mockedGetApplication.mockResolvedValue(application("mentor"));
    await runAction(formFor("mentor", [appId(1), appId(2)], "needs_more_review"));
    for (const call of mockedGetApplication.mock.calls) {
      expect(call[1]).toEqual({ scope: "s" });
    }
  });
});

// ── Selection UX ────────────────────────────────────────────────────────────

function renderQueue(role: "mentor" | "mentee", ids: string[], resetKey = "k1") {
  return render(
    <form>
      <BulkScreeningToolbar key={resetKey} role={role} />
      <table>
        <tbody>
          {ids.map((id) => (
            <tr key={id}>
              <td>
                <BulkScreeningRowCheckbox role={role} applicationId={id} expectedStatus="submitted" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </form>
  );
}

describe("bulk selection UX", () => {
  const ids = [appId(1), appId(2), appId(3)];

  it("says explicitly that selection is limited to the current page", () => {
    renderQueue("mentor", ids);
    expect(screen.getByText("Chọn tất cả hồ sơ trên trang này")).toBeTruthy();
    expect(screen.queryByText("Chọn tất cả trang")).toBeNull();
  });

  it("select-all selects only the visible rows of this queue", async () => {
    const user = userEvent.setup();
    renderQueue("mentor", ids);
    await user.click(screen.getByTestId("bulk-select-all"));
    const rows = screen.getAllByRole("checkbox").filter((c) => c.getAttribute("name") === "application_id");
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => (r as HTMLInputElement).checked)).toBe(true);
    expect(screen.getByTestId("bulk-selected-count").textContent).toBe("Đã chọn 3 hồ sơ");
  });

  it("unchecking select-all clears the visible rows", async () => {
    const user = userEvent.setup();
    renderQueue("mentor", ids);
    const all = screen.getByTestId("bulk-select-all");
    await user.click(all);
    await user.click(all);
    const rows = screen.getAllByRole("checkbox").filter((c) => c.getAttribute("name") === "application_id");
    expect(rows.some((r) => (r as HTMLInputElement).checked)).toBe(false);
    expect(screen.queryByTestId("bulk-selected-count")).toBeNull();
  });

  it("shows the selected count only once something is selected", async () => {
    const user = userEvent.setup();
    renderQueue("mentor", ids);
    expect(screen.queryByTestId("bulk-selected-count")).toBeNull();
    const rows = screen.getAllByRole("checkbox").filter((c) => c.getAttribute("name") === "application_id");
    await user.click(rows[0]);
    expect(screen.getByTestId("bulk-selected-count").textContent).toBe("Đã chọn 1 hồ sơ");
  });

  it("goes indeterminate on a partial selection and checked when all are selected", async () => {
    const user = userEvent.setup();
    renderQueue("mentor", ids);
    const all = screen.getByTestId("bulk-select-all") as HTMLInputElement;
    const rows = screen
      .getAllByRole("checkbox")
      .filter((c) => c.getAttribute("name") === "application_id") as HTMLInputElement[];

    await user.click(rows[0]);
    expect(all.indeterminate).toBe(true);
    expect(all.checked).toBe(false);

    await user.click(rows[1]);
    await user.click(rows[2]);
    expect(all.indeterminate).toBe(false);
    expect(all.checked).toBe(true);

    await user.click(rows[2]);
    expect(all.indeterminate).toBe(true);
  });

  it("never leaves the header checked while zero rows are selected", async () => {
    const user = userEvent.setup();
    renderQueue("mentor", ids);
    const all = screen.getByTestId("bulk-select-all") as HTMLInputElement;
    await user.click(all);
    const rows = screen
      .getAllByRole("checkbox")
      .filter((c) => c.getAttribute("name") === "application_id") as HTMLInputElement[];
    for (const row of rows) await user.click(row);
    expect(all.checked).toBe(false);
    expect(all.indeterminate).toBe(false);
    expect(screen.queryByTestId("bulk-selected-count")).toBeNull();
  });

  it("resets selection when the page or filter changes", async () => {
    const user = userEvent.setup();
    const { rerender } = renderQueue("mentor", ids, "page:1");
    await user.click(screen.getByTestId("bulk-select-all"));
    expect(screen.getByTestId("bulk-selected-count").textContent).toBe("Đã chọn 3 hồ sơ");

    // A page/filter change remounts the toolbar and renders fresh rows.
    rerender(
      <form>
        <BulkScreeningToolbar key="page:2" role="mentor" />
        <table>
          <tbody>
            {[appId(9)].map((id) => (
              <tr key={id}>
                <td>
                  <BulkScreeningRowCheckbox role="mentor" applicationId={id} expectedStatus="submitted" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </form>
    );
    expect(screen.queryByTestId("bulk-selected-count")).toBeNull();
    expect((screen.getByTestId("bulk-select-all") as HTMLInputElement).checked).toBe(false);
  });

  it("cannot select rows belonging to the other role's queue", async () => {
    const user = userEvent.setup();
    render(
      <form>
        <BulkScreeningToolbar role="mentee" />
        <BulkScreeningRowCheckbox role="mentee" applicationId={appId(1)} expectedStatus="submitted" />
        <BulkScreeningRowCheckbox role="mentor" applicationId={appId(2)} expectedStatus="submitted" />
      </form>
    );
    await user.click(screen.getByTestId("bulk-select-all"));
    expect(screen.getByTestId("bulk-selected-count").textContent).toBe("Đã chọn 1 hồ sơ");
    const mentorRow = screen.getByLabelText(`Chọn hồ sơ ${appId(2).slice(0, 8)}`) as HTMLInputElement;
    expect(mentorRow.checked).toBe(false);
  });

  it("keeps submission disabled until something is selected", async () => {
    const user = userEvent.setup();
    renderQueue("mentee", ids);
    const pass = screen.getByRole("button", { name: "Cần review thêm" }) as HTMLButtonElement;
    expect(pass.disabled).toBe(true);
    await user.click(screen.getByTestId("bulk-select-all"));
    expect(pass.disabled).toBe(false);
  });

  it("blocks submission and explains when a page would exceed the server cap", async () => {
    const user = userEvent.setup();
    renderQueue("mentor", Array.from({ length: 26 }, (_, i) => appId(i + 1)));
    await user.click(screen.getByTestId("bulk-select-all"));
    expect(screen.getByTestId("bulk-selected-count").textContent).toBe("Đã chọn 26 hồ sơ");
    expect(screen.getByTestId("bulk-over-limit").textContent).toContain("Tối đa 25");
    for (const name of ["Cần review thêm", "Không phù hợp"]) {
      expect((screen.getByRole("button", { name }) as HTMLButtonElement).disabled).toBe(true);
    }
  });

  it("does not persist selection anywhere outside the form", () => {
    const source = readFileSync("app/applications/_components/bulk-screening-controls.tsx", "utf8");
    // Strip comments first: the module documents WHY it avoids these APIs, so
    // a raw text match would fail on the explanation rather than on real use.
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toContain("localStorage");
    expect(code).not.toContain("sessionStorage");
  });
});
