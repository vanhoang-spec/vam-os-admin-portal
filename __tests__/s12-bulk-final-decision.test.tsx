/** @vitest-environment jsdom */
/**
 * S12 — Bulk final decision (post-interview ruling) UI remediation.
 *
 * The screen shipped in M090 as an unbounded "set any status on any
 * application" surface and Slice 2A hid its entry point rather than fix it.
 * This suite pins the narrowed behaviour that makes it safe to surface again:
 *
 *   * the entry point exists on /applications and is gated on canDecide;
 *   * the screen sources candidates from ready_for_final_decision by default
 *     and cannot be widened to "all applications" from the query string;
 *   * exactly the four post-interview rulings are offered, with the earlier
 *     pipeline transitions gone from THIS screen only;
 *   * every bulk mutation goes through a confirmation, cancelling it mutates
 *     nothing, and rejecting carries destructive wording;
 *   * the existing applied/blocked server result is still what the operator
 *     reads, and M092 official approval is untouched beside it.
 *
 * Everything here renders the real components. The only file-content
 * assertions are the ones whose whole point is that a module was NOT touched.
 */
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    const error = new Error("NEXT_REDIRECT") as Error & { digest: string; redirectUrl: string };
    error.digest = `NEXT_REDIRECT;${url}`;
    error.redirectUrl = url;
    throw error;
  }),
  useSearchParams: () => new URLSearchParams()
}));
vi.mock("@/lib/admin-auth", () => ({ getCurrentAdminUser: vi.fn() }));
vi.mock("@/lib/program-scope", () => ({
  getAdminScopeContext: vi.fn(async () => ({ scope: "s12" })),
  getScopeFilter: vi.fn(async () => ({ scope: "s12" }))
}));
vi.mock("@/lib/data", () => ({
  getApplications: vi.fn(),
  getIntakeBatches: vi.fn(async () => ({ data: [], error: null })),
  getReviewsForApplications: vi.fn(async () => ({ data: [], error: null })),
  getPeople: vi.fn(async () => ({ data: [], error: null })),
  getSeasons: vi.fn(async () => ({ data: [], error: null })),
  getAllApplicationReviews: vi.fn(async () => ({ data: [], error: null })),
  getActiveAdminUsers: vi.fn(async () => ({ data: [], error: null })),
  keyById: (rows: Array<{ id: string }>) => new Map(rows.map((r) => [r.id, r]))
}));
vi.mock("@/app/actions/bulk-application-decisions", () => ({
  bulkApplicationDecisionAction: vi.fn()
}));

const mockUseFormState = vi.fn();
const mockUseFormStatus = vi.fn();
vi.mock("react-dom", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useFormState: (...args: unknown[]) => mockUseFormState(...args),
    useFormStatus: () => mockUseFormStatus()
  };
});

import ApplicationsPage from "@/app/applications/page";
import BulkDecisionPage from "@/app/applications/bulk-decision/page";
import { BulkDecisionForm } from "@/app/applications/bulk-decision/bulk-decision-form";
import {
  BULK_FINAL_DECISION_SOURCE_STATUS,
  BULK_FINAL_DECISION_STATUSES,
  resolveSourceStatus
} from "@/app/applications/bulk-decision/decision-options";
import { bulkApplicationDecisionAction } from "@/app/actions/bulk-application-decisions";
import { initialDecisionActionState, type DecisionActionState } from "@/lib/decision-action-types";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { getApplications } from "@/lib/data";

const READY = "ready_for_final_decision";
const ENTRY_LABEL = "Quyết định sau phỏng vấn";

/** Statuses the remediation removes from THIS screen. */
const REMOVED_FROM_SCREEN = ["screening_passed", "invited_to_interview", "interview_scheduled"] as const;

function appId(n: number) {
  return `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`;
}

function application(n: number, status: string, overrides: Record<string, unknown> = {}) {
  return {
    id: appId(n),
    full_name: `Ứng viên ${n}`,
    email_primary: `c${n}@example.com`,
    role_applied: "mentor",
    status,
    intake_batch_id: null,
    season_id: null,
    person_id: null,
    ...overrides
  };
}

function row(n: number, status = READY) {
  return {
    id: appId(n),
    fullName: `Ứng viên ${n}`,
    role: "mentor",
    status: BULK_FINAL_DECISION_SOURCE_STATUS,
    statusLabel: "Sẵn sàng ra quyết định cuối",
    reviews: []
  };
}

/** Renders the client form and taps the real submit path the server action rides on. */
function renderForm(rows = [row(1), row(2)], state: DecisionActionState = initialDecisionActionState) {
  mockUseFormState.mockReturnValue([state, vi.fn()]);
  const utils = render(<BulkDecisionForm rows={rows} />);
  const form = utils.container.querySelector("form");
  const submitSpy = vi.fn((event: Event) => event.preventDefault());
  form?.addEventListener("submit", submitSpy);
  return { ...utils, form, submitSpy };
}

/** Selects a decision and checks `count` candidate rows. */
async function prepareBatch(user: ReturnType<typeof userEvent.setup>, decision: string, count = 1) {
  await user.selectOptions(screen.getByLabelText(/Quyết định/), decision);
  const boxes = screen.getAllByRole("checkbox");
  for (let i = 0; i < count; i += 1) await user.click(boxes[i]);
}

/** Runs an async server page and returns the route it redirected to, if any. */
async function redirectFrom(run: () => Promise<unknown>): Promise<string | null> {
  try {
    await run();
    return null;
  } catch (error) {
    const redirectUrl = (error as { redirectUrl?: string }).redirectUrl;
    if (redirectUrl) return redirectUrl;
    throw error;
  }
}

function asActor(role: string | null) {
  (getCurrentAdminUser as Mock).mockResolvedValue(role ? { id: "actor-1", role } : null);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUseFormStatus.mockReturnValue({ pending: false });
  mockUseFormState.mockReturnValue([initialDecisionActionState, vi.fn()]);
  asActor("admin");
  (getApplications as Mock).mockResolvedValue({ data: [], error: null });
});
afterEach(cleanup);

// ── 1-2. Entry point on /applications ───────────────────────────────────────

describe("the /applications entry point is gated on canDecide", () => {
  it.each(["super_admin", "admin", "core_team"])("%s sees it next to bulk official approval", async (role) => {
    asActor(role);
    render(await ApplicationsPage());

    const entry = screen.getByRole("link", { name: ENTRY_LABEL });
    expect(entry.getAttribute("href")).toBe("/applications/bulk-decision");
    // Distinct from M092 official approval, which must still be offered.
    const m092 = screen.getByRole("link", { name: "Duyệt chính thức hàng loạt" });
    expect(m092.getAttribute("href")).toBe("/applications/bulk-approval");
    expect(entry).not.toBe(m092);
  });

  it("does not use the English 'Bulk Final Decision' wording in the operator UI", async () => {
    render(await ApplicationsPage());
    expect(document.body.textContent).not.toContain("Bulk Final Decision");
  });

  it("support_team can browse applications but is not offered the entry point", async () => {
    asActor("support_team");
    render(await ApplicationsPage());
    expect(screen.queryByRole("link", { name: ENTRY_LABEL })).toBeNull();
    expect(screen.queryByRole("link", { name: "Duyệt chính thức hàng loạt" })).toBeNull();
  });

  it("reviewer never reaches the page that carries the entry point", async () => {
    asActor("reviewer");
    expect(await redirectFrom(() => ApplicationsPage())).toBe("/reviews");
  });

  it("viewer never reaches the page that carries the entry point", async () => {
    asActor("viewer");
    expect(await redirectFrom(() => ApplicationsPage())).toBe("/");
  });
});

// ── 3. Default filter ───────────────────────────────────────────────────────

describe("/applications/bulk-decision opens on ready_for_final_decision only", () => {
  const MIXED = [
    application(1, READY),
    application(2, "screening_passed"),
    application(3, "invited_to_interview"),
    application(4, "interview_scheduled"),
    application(5, "submitted"),
    application(6, READY)
  ];

  it("lists only the awaiting-final-ruling applications with no query string", async () => {
    (getApplications as Mock).mockResolvedValue({ data: MIXED, error: null });
    render(await BulkDecisionPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByText("Ứng viên 1")).toBeTruthy();
    expect(screen.getByText("Ứng viên 6")).toBeTruthy();
    for (const name of ["Ứng viên 2", "Ứng viên 3", "Ứng viên 4", "Ứng viên 5"]) {
      expect(screen.queryByText(name)).toBeNull();
    }
    // Two candidates → two selectable rows, not the whole scope.
    expect(screen.getAllByRole("checkbox")).toHaveLength(2);
  });

  it("cannot be widened to all applications by an empty or foreign status param", async () => {
    (getApplications as Mock).mockResolvedValue({ data: MIXED, error: null });
    for (const status of ["", "   ", "submitted", "screening_passed", "all"]) {
      render(await BulkDecisionPage({ searchParams: Promise.resolve({ status }) }));
      expect(screen.getAllByRole("checkbox")).toHaveLength(2);
      expect(screen.queryByText("Ứng viên 5")).toBeNull();
      cleanup();
    }
  });

  it("resolves any out-of-domain status back to the canonical source state", () => {
    expect(resolveSourceStatus(undefined)).toBe(READY);
    expect(resolveSourceStatus("")).toBe(READY);
    expect(resolveSourceStatus("interview_passed")).toBe(READY);
    expect(resolveSourceStatus(READY)).toBe(READY);
    expect(BULK_FINAL_DECISION_SOURCE_STATUS).toBe(READY);
  });

  it("offers a bounded status select, not a free-text status input", async () => {
    (getApplications as Mock).mockResolvedValue({ data: MIXED, error: null });
    const { container } = render(await BulkDecisionPage({ searchParams: Promise.resolve({}) }));

    const statusControl = container.querySelector('[name="status"]') as HTMLInputElement;
    expect(statusControl.tagName).toBe("INPUT");
    expect(statusControl.type).toBe("hidden");
    expect(statusControl.value).toBe(READY);
    // No blank "all statuses" escape hatch on this screen.
    expect(statusControl.value).not.toBe("");
  });

  it("keeps the intake batch and role filters", async () => {
    (getApplications as Mock).mockResolvedValue({ data: MIXED, error: null });
    const { container } = render(await BulkDecisionPage({ searchParams: Promise.resolve({}) }));
    expect(container.querySelector('select[name="intake_batch_id"]')).toBeTruthy();
    expect(container.querySelector('select[name="role_applied"]')).toBeTruthy();
  });

  it("applies the role filter on top of the source state", async () => {
    (getApplications as Mock).mockResolvedValue({
      data: [application(1, READY, { role_applied: "mentor" }), application(2, READY, { role_applied: "mentee" })],
      error: null
    });
    render(await BulkDecisionPage({ searchParams: Promise.resolve({ role_applied: "mentee" }) }));
    expect(screen.getByText("Ứng viên 2")).toBeTruthy();
    expect(screen.queryByText("Ứng viên 1")).toBeNull();
  });

  it("keeps the 500-row ceiling and warns when the filter is wider than one batch", async () => {
    (getApplications as Mock).mockResolvedValue({
      data: Array.from({ length: 520 }, (_, i) => application(i + 1, READY)),
      error: null
    });
    render(await BulkDecisionPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getAllByRole("checkbox")).toHaveLength(500);
    expect(screen.getByText(/Có 520 đơn phù hợp/)).toBeTruthy();
  });
});

// ── 4-7. Decision options ───────────────────────────────────────────────────

describe("the decision dropdown offers exactly the four post-interview rulings", () => {
  function decisionOptionValues() {
    const select = screen.getByLabelText(/Quyết định/) as HTMLSelectElement;
    return Array.from(select.options).map((o) => o.value).filter(Boolean);
  }

  it("renders the four rulings and nothing else", () => {
    renderForm();
    expect(decisionOptionValues()).toEqual([
      "interview_passed",
      "waitlisted",
      "rejected_or_not_fit",
      "needs_more_review"
    ]);
    expect(BULK_FINAL_DECISION_STATUSES).toHaveLength(4);
  });

  it.each(REMOVED_FROM_SCREEN)("no longer offers %s on this screen", (status) => {
    renderForm();
    expect(decisionOptionValues()).not.toContain(status);
    const select = screen.getByLabelText(/Quyết định/) as HTMLSelectElement;
    expect(select.innerHTML).not.toContain(status);
  });

  it("labels the rulings with the canonical Vietnamese status labels", () => {
    renderForm();
    const select = screen.getByLabelText(/Quyết định/) as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual([
      "-- Chọn --",
      "Qua vòng phỏng vấn",
      "Danh sách chờ",
      "Không phù hợp",
      "Cần xem thêm"
    ]);
  });

  it("does not remove those statuses from the global decision allowlist", () => {
    // Other surfaces (the individual decision form, S12 screening) still use
    // them — the narrowing belongs to this screen, not to the domain.
    const types = readFileSync("lib/decision-action-types.ts", "utf8");
    for (const status of REMOVED_FROM_SCREEN) expect(types).toContain(status);
  });
});

// ── 8-10. Confirmation gate ─────────────────────────────────────────────────

describe("every bulk mutation goes through a confirmation", () => {
  it("submits nothing when the trigger is clicked — it opens a dialog instead", async () => {
    const user = userEvent.setup();
    const { submitSpy } = renderForm();
    await prepareBatch(user, "interview_passed", 2);

    expect(screen.queryByRole("dialog")).toBeNull();
    await user.click(screen.getByRole("button", { name: /Áp dụng quyết định cho 2 đơn/ }));

    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(submitSpy).not.toHaveBeenCalled();
    expect(bulkApplicationDecisionAction).not.toHaveBeenCalled();
  });

  it("states the count, the decision and that this is a bulk status change", async () => {
    const user = userEvent.setup();
    renderForm([row(1), row(2), row(3)]);
    await prepareBatch(user, "waitlisted", 3);
    await user.click(screen.getByRole("button", { name: /Áp dụng quyết định cho 3 đơn/ }));

    const dialog = within(screen.getByRole("dialog"));
    expect(dialog.getByText(/3 đơn/)).toBeTruthy();
    expect(dialog.getByText(/Danh sách chờ/)).toBeTruthy();
    expect(dialog.getByText(/thay đổi trạng thái hàng loạt/i)).toBeTruthy();
  });

  it("cancelling closes the dialog and mutates nothing", async () => {
    const user = userEvent.setup();
    const { submitSpy } = renderForm();
    await prepareBatch(user, "interview_passed", 2);
    await user.click(screen.getByRole("button", { name: /Áp dụng quyết định cho 2 đơn/ }));
    await user.click(screen.getByRole("button", { name: "Hủy" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(submitSpy).not.toHaveBeenCalled();
    expect(bulkApplicationDecisionAction).not.toHaveBeenCalled();
  });

  it("only confirming reaches the form submit the server action rides on", async () => {
    const user = userEvent.setup();
    const { submitSpy } = renderForm();
    await prepareBatch(user, "interview_passed", 1);
    await user.click(screen.getByRole("button", { name: /Áp dụng quyết định cho 1 đơn/ }));
    expect(submitSpy).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Xác nhận quyết định" }));
    expect(submitSpy).toHaveBeenCalledTimes(1);
  });

  it("uses stronger destructive wording for rejected_or_not_fit", async () => {
    const user = userEvent.setup();
    renderForm();
    await prepareBatch(user, "rejected_or_not_fit", 2);

    const trigger = screen.getByRole("button", { name: /Áp dụng quyết định cho 2 đơn/ });
    expect(trigger.className).toContain("bg-red-600");
    await user.click(trigger);

    const dialog = within(screen.getByRole("dialog"));
    expect(dialog.getByText("Xác nhận từ chối hàng loạt")).toBeTruthy();
    expect(dialog.getByText(/có tính kết thúc/i)).toBeTruthy();
    expect(dialog.getByText(/loại khỏi quy trình tuyển/i)).toBeTruthy();
    expect(dialog.getByText(/không thể hoàn tác hàng loạt/i)).toBeTruthy();
    expect(dialog.getByRole("button", { name: "Xác nhận từ chối" }).className).toContain("bg-red-600");
  });

  it("does not dress a non-terminal ruling up as destructive", async () => {
    const user = userEvent.setup();
    renderForm();
    await prepareBatch(user, "interview_passed", 1);
    await user.click(screen.getByRole("button", { name: /Áp dụng quyết định cho 1 đơn/ }));

    const dialog = within(screen.getByRole("dialog"));
    expect(dialog.getByText("Xác nhận quyết định hàng loạt")).toBeTruthy();
    expect(dialog.queryByText(/không thể hoàn tác hàng loạt/i)).toBeNull();
    expect(dialog.getByRole("button", { name: "Xác nhận quyết định" }).className).not.toContain("bg-red-600");
  });
});

// ── 6. Empty / safety states ────────────────────────────────────────────────

describe("empty and no-selection states cannot start a mutation", () => {
  it("keeps the trigger disabled until a row AND a decision are chosen", async () => {
    const user = userEvent.setup();
    const { submitSpy } = renderForm();
    const trigger = () => screen.getByRole("button", { name: /Áp dụng quyết định cho/ }) as HTMLButtonElement;

    expect(trigger().disabled).toBe(true);

    await user.selectOptions(screen.getByLabelText(/Quyết định/), "interview_passed");
    expect(trigger().disabled).toBe(true); // a decision, but no rows

    await user.click(screen.getAllByRole("checkbox")[0]);
    expect(trigger().disabled).toBe(false);

    await user.click(screen.getAllByRole("checkbox")[0]); // deselect again
    expect(trigger().disabled).toBe(true);

    await user.click(trigger());
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(submitSpy).not.toHaveBeenCalled();
  });

  it("shows an explanatory empty state instead of a blank table and a live button", () => {
    const { container } = renderForm([]);
    expect(screen.getByText("Không có đơn nào đang chờ quyết định cuối.")).toBeTruthy();
    expect(screen.getByText(/đủ số đánh giá phỏng vấn tối thiểu/i)).toBeTruthy();
    expect(container.querySelector("table")).toBeNull();
    expect(screen.queryByRole("button", { name: /Áp dụng quyết định/ })).toBeNull();
  });

  it("shows the empty state end-to-end when the season has no candidates yet", async () => {
    (getApplications as Mock).mockResolvedValue({
      data: [application(1, "screening_passed"), application(2, "submitted")],
      error: null
    });
    const { container } = render(await BulkDecisionPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByText("Không có đơn nào đang chờ quyết định cuối.")).toBeTruthy();
    expect(container.querySelector("table")).toBeNull();
  });
});

// ── 5. Result reporting ─────────────────────────────────────────────────────

describe("the existing server result stays the operator's report", () => {
  it("shows the applied count, blocked count and Vietnamese reason summary", () => {
    renderForm([row(1), row(2), row(3)], {
      ok: true,
      message: "Đã cập nhật 2 đơn; 1 đơn bị chặn. Đơn chưa đủ số đánh giá phỏng vấn tối thiểu.: 1"
    });
    const banner = screen.getByRole("status").textContent ?? "";
    expect(banner).toContain("Đã cập nhật 2 đơn");
    expect(banner).toContain("1 đơn bị chặn");
    expect(banner).toContain("Đơn chưa đủ số đánh giá phỏng vấn tối thiểu.: 1");
  });

  it("shows a blocked-everything result as an error, not a success", () => {
    renderForm([row(1)], { ok: false, message: "Trạng thái đơn đã thay đổi. Vui lòng tải lại trước khi quyết định." });
    expect(screen.getByRole("alert").textContent).toContain("Trạng thái đơn đã thay đổi");
  });

  it("does not build a per-row result table in this slice", () => {
    const { container } = renderForm([row(1)], { ok: true, message: "Đã cập nhật 1 đơn." });
    // Only the candidate-selection table exists.
    expect(container.querySelectorAll("table")).toHaveLength(1);
  });

  it("leaves the server action and its RPC contract untouched", () => {
    const action = readFileSync("app/actions/bulk-application-decisions.ts", "utf8");
    expect(action).toContain("ALLOWED_DECISION_STATUSES");
    expect(action).toContain("applyApplicationDecisions");
    expect(action).toContain("canDecide(actor.role)");
    expect(readFileSync("lib/application-decisions.ts", "utf8")).toContain(
      "vam084_apply_application_decisions"
    );
  });
});

// ── 13. Route authorization ─────────────────────────────────────────────────

describe("route authorization is unchanged", () => {
  it("sends an anonymous caller to /login", async () => {
    asActor(null);
    expect(await redirectFrom(() => BulkDecisionPage({ searchParams: Promise.resolve({}) }))).toBe("/login");
  });

  it.each(["reviewer", "support_team", "viewer"])("bounces %s back to /applications", async (role) => {
    asActor(role);
    expect(await redirectFrom(() => BulkDecisionPage({ searchParams: Promise.resolve({}) }))).toBe("/applications");
  });

  it.each(["super_admin", "admin", "core_team"])("lets %s in", async (role) => {
    asActor(role);
    (getApplications as Mock).mockResolvedValue({ data: [application(1, READY)], error: null });
    expect(await redirectFrom(() => BulkDecisionPage({ searchParams: Promise.resolve({}) }))).toBeNull();
  });
});
