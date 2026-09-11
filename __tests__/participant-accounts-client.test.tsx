/** @vitest-environment jsdom */
/**
 * Bảng tài khoản và khung mời hàng loạt.
 *
 * Mỗi khẳng định soi đúng dòng của một người (`tr[data-person-id]`), không tìm
 * chung cả trang: tên nút "Mời" có mặt ở dòng bên cạnh sẽ làm một ca "dòng này
 * không có nút Mời" xanh vô nghĩa.
 */
import React from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ bulkState: null as any, refresh: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/app/actions/participants", () => ({ inviteParticipantAction: vi.fn(), runBulkInviteAction: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: h.refresh }) }));
vi.mock("react-dom", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useFormState: (action: unknown, initial: Record<string, unknown>) => [
      "problems" in initial ? h.bulkState ?? initial : initial,
      action
    ],
    useFormStatus: () => ({ pending: false })
  };
});

import { BulkInvitePanel } from "@/app/participant-accounts/bulk-invite-panel";
import { RosterClient, type RosterViewRow } from "@/app/participant-accounts/roster-client";
import { initialBulkInviteState } from "@/lib/participant-action-types";

const SEASON = "11111111-1111-4111-8111-111111111111";

function viewRow(n: number, overrides: Partial<RosterViewRow> = {}): RosterViewRow {
  return {
    personId: `p-${n}`,
    fullName: `Người ${String(n).padStart(3, "0")}`,
    email: `p${n}@example.com`,
    roles: ["mentor"],
    roleLabel: "Mentor",
    status: "not_invited",
    statusLabel: "Chưa mời",
    detail: null,
    lastInviteLabel: "Chưa gửi",
    activatedLabel: "Chưa",
    action: "invite",
    lockedUntilLabel: null,
    inFlight: false,
    ...overrides
  };
}

function renderRoster(rows: RosterViewRow[]) {
  return render(React.createElement(RosterClient, { rows, seasonId: SEASON }));
}

function rowOf(personId: string): HTMLElement {
  const element = document.querySelector(`tr[data-person-id="${personId}"]`);
  if (!element) throw new Error(`không thấy dòng ${personId}`);
  return element as HTMLElement;
}

function formFields(form: HTMLFormElement) {
  return Object.fromEntries(Array.from(form.querySelectorAll("input[type=hidden]")).map((input) => [
    (input as HTMLInputElement).name,
    (input as HTMLInputElement).value
  ]));
}

beforeEach(() => {
  h.bulkState = null;
  h.refresh.mockReset();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("nút trên từng dòng", () => {
  it("người đã vào: không có Mời hay Gửi lại, chỉ có đặt lại mật khẩu", () => {
    renderRoster([
      viewRow(1, { status: "active", statusLabel: "Đã vào", action: "reset" }),
      viewRow(2, { status: "invited_pending", statusLabel: "Đã gửi thư, chưa vào", action: "resend" })
    ]);

    const active = within(rowOf("p-1"));
    expect(active.queryByRole("button", { name: "Mời" })).toBeNull();
    expect(active.queryByRole("button", { name: "Gửi lại" })).toBeNull();
    expect(active.getByRole("button", { name: "Gửi link đặt lại mật khẩu" })).toBeTruthy();
    expect(within(rowOf("p-2")).getByRole("button", { name: "Gửi lại" })).toBeTruthy();
  });

  it("biểu mẫu mang đúng người, đúng mùa, đúng kiểu", () => {
    renderRoster([viewRow(1), viewRow(2, { status: "active", action: "reset" })]);

    const inviteForm = within(rowOf("p-1")).getByRole("button", { name: "Mời" }).closest("form") as HTMLFormElement;
    const resetForm = within(rowOf("p-2")).getByRole("button", { name: "Gửi link đặt lại mật khẩu" }).closest("form") as HTMLFormElement;
    expect(formFields(inviteForm)).toEqual({ person_id: "p-1", season_id: SEASON, mode: "invite" });
    expect(formFields(resetForm)).toEqual({ person_id: "p-2", season_id: SEASON, mode: "reset" });
  });

  it("Gửi lại hỏi xác nhận; bấm Huỷ thì không gửi", () => {
    renderRoster([viewRow(1, { status: "invited_pending", action: "resend" })]);
    const button = within(rowOf("p-1")).getByRole("button", { name: "Gửi lại" });
    const form = button.closest("form") as HTMLFormElement;
    const submitted = vi.fn((event: Event) => event.preventDefault());
    form.addEventListener("submit", submitted);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);

    fireEvent.click(button);
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("p1@example.com"));
    expect(submitted).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    fireEvent.click(button);
    expect(submitted).toHaveBeenCalledTimes(1);
  });

  it("Mời lần đầu không hỏi xác nhận", () => {
    renderRoster([viewRow(1)]);
    const button = within(rowOf("p-1")).getByRole("button", { name: "Mời" });
    const form = button.closest("form") as HTMLFormElement;
    const submitted = vi.fn((event: Event) => event.preventDefault());
    form.addEventListener("submit", submitted);
    const confirm = vi.spyOn(window, "confirm");

    fireEvent.click(button);

    expect(confirm).not.toHaveBeenCalled();
    expect(submitted).toHaveBeenCalledTimes(1);
  });

  it("không mời được: không có nút, có lý do", () => {
    renderRoster([viewRow(1, { status: "blocked", statusLabel: "Không mời được", action: null, detail: "Chưa có email" })]);
    const blocked = within(rowOf("p-1"));
    expect(blocked.queryByRole("button")).toBeNull();
    expect(blocked.getByText("Chưa có email")).toBeTruthy();
  });

  it("đang gửi ở lượt khác: không có nút", () => {
    renderRoster([viewRow(1, { inFlight: true, action: null })]);
    expect(within(rowOf("p-1")).queryByRole("button")).toBeNull();
    expect(within(rowOf("p-1")).getByText("Đang gửi ở lượt khác…")).toBeTruthy();
  });

  it("vừa gửi thì nút bị khoá và nói mở lại lúc nào", () => {
    renderRoster([viewRow(1, { status: "invited_pending", action: "resend", lockedUntilLabel: "10:15" })]);
    const row = within(rowOf("p-1"));
    expect((row.getByRole("button", { name: "Gửi lại" }) as HTMLButtonElement).disabled).toBe(true);
    expect(row.getByText("Gửi lại được sau 10:15")).toBeTruthy();
  });
});

describe("lọc và tìm", () => {
  it("tìm không dấu vẫn ra đúng người, và chỉ người đó", () => {
    renderRoster([viewRow(1, { fullName: "Nguyễn Văn An" }), viewRow(2, { fullName: "Trần Thị Bình" })]);

    fireEvent.change(screen.getByRole("searchbox", { name: "Tìm theo tên hoặc email" }), {
      target: { value: "nguyen van an" }
    });

    const body = screen.getByRole("table").querySelector("tbody") as HTMLElement;
    expect(within(body).getAllByRole("row")).toHaveLength(1);
    expect(within(body).getByText("Nguyễn Văn An")).toBeTruthy();
  });

  it("lọc theo trạng thái", () => {
    renderRoster([viewRow(1), viewRow(2, { status: "active", statusLabel: "Đã vào", action: "reset" })]);

    fireEvent.click(screen.getByRole("button", { name: "Đã vào (1)" }));

    const body = screen.getByRole("table").querySelector("tbody") as HTMLElement;
    expect(within(body).getAllByRole("row")).toHaveLength(1);
    expect(body.querySelector('tr[data-person-id="p-2"]')).toBeTruthy();
  });

  it("mùa lớn: hiện 50 dòng một lần, bấm Xem thêm thì thêm 50", () => {
    renderRoster(Array.from({ length: 120 }, (_, index) => viewRow(index + 1)));
    const body = () => screen.getByRole("table").querySelector("tbody") as HTMLElement;

    expect(within(body()).getAllByRole("row")).toHaveLength(50);
    fireEvent.click(screen.getByRole("button", { name: "Xem thêm 50" }));
    expect(within(body()).getAllByRole("row")).toHaveLength(100);
  });
});

describe("khung mời hàng loạt", () => {
  const panel = (props: Partial<React.ComponentProps<typeof BulkInvitePanel>> = {}) =>
    render(
      React.createElement(BulkInvitePanel, {
        seasonId: SEASON,
        seasonLabel: "Mùa 12",
        eligible: 45,
        budgetLeft: 200,
        gateOpen: true,
        batchMax: 20,
        ...props
      })
    );

  it("bước đầu không có nút gửi; mở ra mới có ô gõ số người", () => {
    panel();

    expect(screen.queryByRole("button", { name: "Bắt đầu gửi" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Mời hàng loạt…" }));

    const submit = screen.getByRole("button", { name: "Bắt đầu gửi" });
    const form = submit.closest("form") as HTMLFormElement;
    expect(formFields(form)).toEqual({ season_id: SEASON, phase: "start" });
    expect(form.querySelector('input[name="typed_count"]')).toBeTruthy();
  });

  it.each([
    [{ gateOpen: false }, "đang tắt gửi thư"],
    [{ budgetLeft: null }, "Không đọc được số thư"],
    [{ budgetLeft: 0 }, "ngày mai"],
    [{ eligible: 0 }, "Không còn ai"]
  ])("không mở được khi %j", (props, text) => {
    panel(props as never);
    expect(screen.queryByRole("button", { name: "Mời hàng loạt…" })).toBeNull();
    expect(screen.getByText(new RegExp(text))).toBeTruthy();
  });

  it("không được gửi tiếp thì không có nút Gửi tiếp, dù còn người", () => {
    h.bulkState = { ...initialBulkInviteState, ok: true, message: "Dừng.", remaining: 5, canContinue: false, at: 1 };
    panel();
    expect(screen.queryByRole("button", { name: /Gửi tiếp/ })).toBeNull();
  });

  it("được gửi tiếp: mang theo số người còn lại để máy chủ so", () => {
    h.bulkState = { ...initialBulkInviteState, ok: true, message: "Đã gửi 20 thư mời.", remaining: 45, canContinue: true, at: 1 };
    panel();

    const button = screen.getByRole("button", { name: "Gửi tiếp 20 người" });
    expect(formFields(button.closest("form") as HTMLFormElement)).toEqual({
      season_id: SEASON,
      phase: "continue",
      previous_remaining: "45"
    });
  });

  it("chi tiết từng trường hợp nằm trong phần mở rộng", () => {
    h.bulkState = { ...initialBulkInviteState, ok: false, message: "Có lỗi.", problems: ["Người 001: Chưa có email."], at: 1 };
    panel();
    expect(screen.getByText("Người 001: Chưa có email.")).toBeTruthy();
    expect(screen.getByText("Chi tiết 1 trường hợp")).toBeTruthy();
  });
});
