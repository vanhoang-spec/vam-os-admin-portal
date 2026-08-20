/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/app/actions/renewals", () => ({ createRenewalInviteBatchAction: vi.fn() }));

// The picker's state is driven by useFormState. Tests set `formState` to
// simulate what the Server Action returned, which is the only place raw links
// ever exist.
let formState: any = {
  ok: false,
  message: "",
  createdCount: 0,
  failedCount: 0,
  skippedCount: 0,
  results: []
};

vi.mock("react-dom", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useFormState: (action: unknown) => [formState, action],
    useFormStatus: () => ({ pending: false })
  };
});

import { BatchRenewalInviteForm } from "@/app/admin/renewals/mentor-batch-form";
import { RENEWAL_BATCH_MAX_SIZE } from "@/lib/renewal-types";
import type { RenewalMentorOption } from "@/lib/renewal-console";

const PROGRAM = "22222222-2222-4222-8222-222222222222";
const SEASON = "33333333-3333-4333-8333-333333333333";

function mentor(n: number, over: Partial<RenewalMentorOption> = {}): RenewalMentorOption {
  const fullName = over.fullName ?? `Validation Mentor ${String(n).padStart(2, "0")}`;
  const mentorCode = over.mentorCode !== undefined ? over.mentorCode : `VM-${String(n).padStart(3, "0")}`;
  const email = over.email !== undefined ? over.email : `mentor${String(n).padStart(2, "0")}@example.com`;
  const status = over.status ?? "eligible";
  return {
    personId: over.personId ?? `11111111-1111-4111-8111-${String(n).padStart(12, "0")}`,
    label: `${fullName} · ${mentorCode} · ${email}`,
    fullName,
    mentorCode,
    email,
    status,
    // Mirrors lib/renewal-console.ts: a declined mentor stays ELIGIBLE for the
    // trusted create path (so the individual re-invite flow still offers them)
    // but is withheld from bulk selection.
    selectable: over.selectable ?? (status === "eligible" || status === "renewal_declined"),
    batchSelectable: over.batchSelectable ?? status === "eligible"
  };
}

const ROSTER = [
  mentor(1),
  mentor(2),
  mentor(3, { fullName: "Nguyễn Đức Thắng", mentorCode: "UEHM-S9-114", email: "thang@example.com" }),
  mentor(4, { status: "has_live_invite" }),
  mentor(5, { status: "renewal_accepted" }),
  // Named without "Validation" on purpose so it does not disturb the existing
  // "Validation" match-count assertions.
  mentor(6, { fullName: "Declined Mentor 06", status: "renewal_declined" })
];

function renderPicker(mentors: RenewalMentorOption[] = ROSTER) {
  return render(<BatchRenewalInviteForm mentors={mentors} programId={PROGRAM} seasonId={SEASON} />);
}

function searchBox() {
  return screen.getByLabelText(/Tìm mentor/i);
}

function checkboxFor(name: string | RegExp) {
  const label = screen.getByText(name).closest("label") as HTMLLabelElement;
  return within(label).getByRole("checkbox") as HTMLInputElement;
}

function personIdsField(container: HTMLElement) {
  return container.querySelector('input[name="person_ids"]') as HTMLInputElement;
}

beforeEach(() => {
  formState = { ok: false, message: "", createdCount: 0, failedCount: 0, skippedCount: 0, results: [] };
});
afterEach(cleanup);

describe("M075 picker — search", () => {
  it("shows a search input without first opening a dropdown", () => {
    renderPicker();
    expect(searchBox()).toBeTruthy();
    // Every eligible mentor is already listed, not hidden behind a control.
    expect(screen.getByText("Validation Mentor 01")).toBeTruthy();
  });

  it("filters by partial name", () => {
    renderPicker();
    fireEvent.change(searchBox(), { target: { value: "Mentor 02" } });
    expect(screen.queryByText("Validation Mentor 02")).toBeTruthy();
    expect(screen.queryByText("Validation Mentor 01")).toBeNull();
  });

  it("filters by mentor code", () => {
    renderPicker();
    fireEvent.change(searchBox(), { target: { value: "VM-003" } });
    expect(screen.queryByText("Nguyễn Đức Thắng")).toBeNull();
    expect(screen.queryByText("Validation Mentor 01")).toBeNull();
  });

  it("filters by email", () => {
    renderPicker();
    fireEvent.change(searchBox(), { target: { value: "mentor01@" } });
    expect(screen.queryByText("Validation Mentor 01")).toBeTruthy();
    expect(screen.queryByText("Validation Mentor 02")).toBeNull();
  });

  it("finds a Vietnamese name typed without diacritics", () => {
    renderPicker();
    fireEvent.change(searchBox(), { target: { value: "nguyen duc" } });
    expect(screen.queryByText("Nguyễn Đức Thắng")).toBeTruthy();
    expect(screen.queryByText("Validation Mentor 01")).toBeNull();
  });

  it("announces a no-result state", () => {
    renderPicker();
    fireEvent.change(searchBox(), { target: { value: "khong-ton-tai" } });
    expect(screen.getByText(/Không tìm thấy mentor phù hợp/i)).toBeTruthy();
    expect(screen.getByText(/Không có kết quả/i)).toBeTruthy();
  });

  it("reports the match count in a live region", () => {
    renderPicker();
    fireEvent.change(searchBox(), { target: { value: "Validation" } });
    const live = document.querySelector('[aria-live="polite"]');
    expect(live?.textContent).toMatch(/4 mentor phù hợp/);
  });

  it("caps how many rows it renders and says so", () => {
    const many = Array.from({ length: 120 }, (_, i) => mentor(i + 1));
    renderPicker(many);
    const live = document.querySelector('[aria-live="polite"]');
    expect(live?.textContent).toMatch(/120 mentor phù hợp/);
    expect(live?.textContent).toMatch(/đang hiển thị 50/);
    expect(screen.getAllByRole("checkbox").length).toBe(50);
  });
});

describe("M075 picker — selection", () => {
  it("starts with nothing selected", () => {
    renderPicker();
    expect(screen.getByText("Đã chọn 0 mentor")).toBeTruthy();
  });

  it("selects and deselects an individual mentor", () => {
    renderPicker();
    const box = checkboxFor("Validation Mentor 01");
    fireEvent.click(box);
    expect(screen.getByText("Đã chọn 1 mentor")).toBeTruthy();
    fireEvent.click(box);
    expect(screen.getByText("Đã chọn 0 mentor")).toBeTruthy();
  });

  it("counts multiple selections", () => {
    renderPicker();
    fireEvent.click(checkboxFor("Validation Mentor 01"));
    fireEvent.click(checkboxFor("Validation Mentor 02"));
    expect(screen.getByText("Đã chọn 2 mentor")).toBeTruthy();
  });

  it("carries the selection in the submitted hidden field", () => {
    const { container } = renderPicker();
    fireEvent.click(checkboxFor("Validation Mentor 01"));
    fireEvent.click(checkboxFor("Validation Mentor 02"));
    const ids = JSON.parse(personIdsField(container).value);
    expect(ids).toHaveLength(2);
    expect(ids).toContain(ROSTER[0].personId);
    expect(ids).toContain(ROSTER[1].personId);
  });

  it("keeps a selected mentor when the query no longer matches them", () => {
    renderPicker();
    fireEvent.click(checkboxFor("Validation Mentor 01"));
    fireEvent.change(searchBox(), { target: { value: "Mentor 02" } });
    // Removed from the result list, still selected and still visible as a chip.
    expect(screen.getByText("Đã chọn 1 mentor")).toBeTruthy();
    expect(screen.getByLabelText(/Bỏ chọn Validation Mentor 01/i)).toBeTruthy();
  });

  it("clears the whole selection", () => {
    renderPicker();
    fireEvent.click(checkboxFor("Validation Mentor 01"));
    fireEvent.click(checkboxFor("Validation Mentor 02"));
    fireEvent.click(screen.getByText("Bỏ chọn tất cả"));
    expect(screen.getByText("Đã chọn 0 mentor")).toBeTruthy();
  });

  it("removes one mentor from the selection via its chip", () => {
    renderPicker();
    fireEvent.click(checkboxFor("Validation Mentor 01"));
    fireEvent.click(screen.getByLabelText(/Bỏ chọn Validation Mentor 01/i));
    expect(screen.getByText("Đã chọn 0 mentor")).toBeTruthy();
  });

  it("labels the submit button with the selected count", () => {
    renderPicker();
    expect(screen.getByRole("button", { name: /Tạo link hàng loạt/i })).toBeTruthy();
    fireEvent.click(checkboxFor("Validation Mentor 01"));
    expect(screen.getByRole("button", { name: /Tạo link cho 1 mentor/i })).toBeTruthy();
  });

  it("disables submit when nothing is selected", () => {
    renderPicker();
    const button = screen.getByRole("button", { name: /Tạo link hàng loạt/i }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });
});

describe("M075 picker — select all filtered", () => {
  it("selects only the CURRENTLY FILTERED eligible mentors", () => {
    renderPicker();
    fireEvent.change(searchBox(), { target: { value: "Validation" } });
    fireEvent.click(screen.getByText(/Chọn tất cả kết quả đang lọc/i));
    // Roster has 5; "Validation" matches 4 (01, 02, 04-live, 05-accepted);
    // only the two eligible Validation rows may be selected.
    expect(screen.getByText("Đã chọn 2 mentor")).toBeTruthy();
  });

  it("never selects mentors outside the current filter", () => {
    const { container } = renderPicker();
    fireEvent.change(searchBox(), { target: { value: "Mentor 02" } });
    fireEvent.click(screen.getByText(/Chọn tất cả kết quả đang lọc/i));
    const ids = JSON.parse(personIdsField(container).value);
    expect(ids).toEqual([ROSTER[1].personId]);
  });

  it("never exceeds the batch ceiling", () => {
    const many = Array.from({ length: RENEWAL_BATCH_MAX_SIZE + 20 }, (_, i) => mentor(i + 1));
    const { container } = renderPicker(many);
    fireEvent.click(screen.getByText(/Chọn tất cả kết quả đang lọc/i));
    const ids = JSON.parse(personIdsField(container).value);
    expect(ids).toHaveLength(RENEWAL_BATCH_MAX_SIZE);
    expect(screen.getByText(`Đã chọn ${RENEWAL_BATCH_MAX_SIZE} mentor`)).toBeTruthy();
  });

  it("warns and stops offering more once the ceiling is reached", () => {
    const many = Array.from({ length: RENEWAL_BATCH_MAX_SIZE + 20 }, (_, i) => mentor(i + 1));
    renderPicker(many);
    fireEvent.click(screen.getByText(/Chọn tất cả kết quả đang lọc/i));
    expect(screen.getByText(new RegExp(`Đã đạt giới hạn ${RENEWAL_BATCH_MAX_SIZE} mentor`))).toBeTruthy();
    expect(screen.queryByText(/Chọn tất cả kết quả đang lọc/i)).toBeNull();
  });
});

describe("M075 picker — active-invite protection", () => {
  it("shows 'Đã có link' for a mentor holding a live invite", () => {
    renderPicker();
    expect(screen.getByText("Đã có link")).toBeTruthy();
  });

  it("shows 'Đã gia hạn' for a mentor who already accepted", () => {
    renderPicker();
    expect(screen.getByText("Đã gia hạn")).toBeTruthy();
  });

  it("disables the checkbox for a mentor with a live invite", () => {
    renderPicker();
    expect(checkboxFor("Validation Mentor 04").disabled).toBe(true);
  });

  it("disables the checkbox for a mentor who already accepted", () => {
    renderPicker();
    expect(checkboxFor("Validation Mentor 05").disabled).toBe(true);
  });

  it("cannot be batch-selected even if the checkbox is clicked", () => {
    const { container } = renderPicker();
    fireEvent.click(checkboxFor("Validation Mentor 04"));
    expect(screen.getByText("Đã chọn 0 mentor")).toBeTruthy();
    expect(JSON.parse(personIdsField(container).value)).toEqual([]);
  });

  it("is excluded from select-all-filtered", () => {
    const { container } = renderPicker();
    fireEvent.change(searchBox(), { target: { value: "Mentor 04" } });
    expect(screen.queryByText(/Chọn tất cả kết quả đang lọc/i)).toBeNull();
    expect(JSON.parse(personIdsField(container).value)).toEqual([]);
  });
});

describe("M075 picker — one-time raw link handoff", () => {
  const RESULTS = [
    {
      personId: ROSTER[0].personId,
      fullName: "Validation Mentor 01",
      mentorCode: "VM-001",
      email: "mentor01@example.com",
      outcome: "created" as const,
      expiresAt: "2026-09-02T00:00:00.000Z",
      renewalPath: "/renew/abc123"
    },
    {
      personId: ROSTER[1].personId,
      fullName: "Validation Mentor 02",
      mentorCode: "VM-002",
      email: "mentor02@example.com",
      outcome: "skipped_live_invite" as const,
      expiresAt: null
    },
    {
      personId: ROSTER[2].personId,
      fullName: "Nguyễn Đức Thắng",
      mentorCode: "UEHM-S9-114",
      email: "thang@example.com",
      outcome: "failed" as const,
      expiresAt: null
    }
  ];

  beforeEach(() => {
    formState = {
      ok: false,
      message: "Đã tạo 1/3 link, bỏ qua 1, lỗi 1.",
      createdCount: 1,
      failedCount: 1,
      skippedCount: 1,
      results: RESULTS
    };
  });

  it("renders one row per mentor with its own outcome", () => {
    renderPicker();
    expect(screen.getByText("Thành công")).toBeTruthy();
    expect(screen.getByText("Đã có invite đang hiệu lực")).toBeTruthy();
    expect(screen.getByText("Lỗi tạo link")).toBeTruthy();
  });

  it("shows a raw link only for the created mentor", () => {
    renderPicker();
    expect(screen.getByText("/renew/abc123")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /Sao chép link gia hạn của/i })).toHaveLength(1);
  });

  it("warns that the links are shown once and cannot be reconstructed", () => {
    renderPicker();
    expect(screen.getByText(/Link chỉ hiển thị một lần/i)).toBeTruthy();
    expect(screen.getByText(/không lưu và không thể tạo lại chúng từ cơ sở dữ liệu/i)).toBeTruthy();
  });

  it("does not persist raw links to localStorage or sessionStorage", () => {
    const local = vi.spyOn(Storage.prototype, "setItem");
    renderPicker();
    expect(local).not.toHaveBeenCalled();
    local.mockRestore();
  });

  it("builds the CSV entirely in the browser from the held result", () => {
    const created = vi.fn((_blob: Blob) => "blob:fake");
    const revoked = vi.fn();
    (URL as any).createObjectURL = created;
    (URL as any).revokeObjectURL = revoked;
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    renderPicker();
    fireEvent.click(screen.getByText("Tải CSV"));

    expect(created).toHaveBeenCalledTimes(1);
    expect(revoked).toHaveBeenCalledTimes(1);
    // No network call is made to produce the file.
    expect(fetchSpy).not.toHaveBeenCalled();
    const blob = created.mock.calls[0][0] as unknown as Blob;
    expect(blob.type).toContain("text/csv");
  });

  it("writes the agreed CSV columns, the full URL and the per-row result", async () => {
    let captured: Blob | null = null;
    (URL as any).createObjectURL = vi.fn((b: Blob) => {
      captured = b;
      return "blob:fake";
    });
    (URL as any).revokeObjectURL = vi.fn();

    renderPicker();
    fireEvent.click(screen.getByText("Tải CSV"));

    const text = await (captured as unknown as Blob).text();
    expect(text).toContain("mentor_name,mentor_code,email,renewal_url,expires_at,result");
    expect(text).toContain(`${window.location.origin}/renew/abc123`);
    expect(text).toContain("Thành công");
    expect(text).toContain("Đã có invite đang hiệu lực");
    expect(text).toContain("Lỗi tạo link");
    // A skipped mentor has no URL cell content.
    expect(text).toMatch(/"Validation Mentor 02","VM-002","mentor02@example\.com",""/);
  });

  it("quotes CSV cells so a comma in a name cannot shift columns", async () => {
    formState = {
      ...formState,
      results: [{ ...RESULTS[0], fullName: 'Tran, Bao "Ngoc"' }]
    };
    let captured: Blob | null = null;
    (URL as any).createObjectURL = vi.fn((b: Blob) => {
      captured = b;
      return "blob:fake";
    });
    (URL as any).revokeObjectURL = vi.fn();

    renderPicker();
    fireEvent.click(screen.getByText("Tải CSV"));

    const text = await (captured as unknown as Blob).text();
    expect(text).toContain('"Tran, Bao ""Ngoc"""');
  });
});

describe("M075 picker — never escalates a bad state into a route error", () => {
  // A throw in this Client Component unwinds to app/error.tsx and replaces the
  // whole /admin/renewals console with the generic runtime error, destroying the
  // operator's selection AND any raw links the batch had already produced. These
  // are the shapes that previously did exactly that.
  const BAD_STATES: Array<[string, any]> = [
    ["missing results", { ok: false, message: "boom" }],
    ["null results", { ok: false, message: "boom", results: null }],
    ["results not an array", { ok: false, message: "boom", results: { a: 1 } }],
    ["null state", null],
    ["undefined state", undefined],
    ["empty object", {}],
    ["message not a string", { ok: false, message: 42, results: [] }],
    ["results containing null rows", { ok: true, message: "x", results: [null, undefined] }]
  ];

  for (const [name, bad] of BAD_STATES) {
    it(`renders without throwing: ${name}`, () => {
      formState = bad;
      expect(() => renderPicker()).not.toThrow();
    });
  }

  it("still shows the picker so the operator can retry", () => {
    formState = { ok: false, message: "boom" };
    renderPicker();
    expect(searchBox()).toBeTruthy();
    expect(screen.getByText("Đã chọn 0 mentor")).toBeTruthy();
  });

  it("renders an unrecognised outcome as text rather than a blank cell", () => {
    formState = {
      ok: true,
      message: "x",
      results: [
        {
          personId: ROSTER[0].personId,
          fullName: "Validation Mentor 01",
          mentorCode: "VM-001",
          email: "a@b.c",
          outcome: "some_future_outcome",
          expiresAt: null
        }
      ]
    };
    expect(() => renderPicker()).not.toThrow();
    expect(screen.getByText("some_future_outcome")).toBeTruthy();
  });
});

describe("M076 picker — explicit batch confirmation", () => {
  function confirmTrigger() {
    return screen.getByRole("button", { name: /Tạo link (cho \d+ mentor|hàng loạt)/i });
  }
  function submitButtons() {
    return Array.from(document.querySelectorAll('button[type="submit"]'));
  }

  it("renders NO submit control before confirmation, so nothing can be minted", () => {
    renderPicker();
    fireEvent.click(checkboxFor("Validation Mentor 01"));
    // Structural guarantee: there is no submit button to press, so neither a
    // click nor an Enter keypress can dispatch the action.
    expect(submitButtons()).toHaveLength(0);
    expect(screen.queryByText(/Bạn sắp tạo/i)).toBeNull();
  });

  it("shows the confirmation with the exact count", () => {
    renderPicker();
    fireEvent.click(checkboxFor("Validation Mentor 01"));
    fireEvent.click(checkboxFor("Validation Mentor 02"));
    fireEvent.click(confirmTrigger());
    expect(screen.getByText(/Bạn sắp tạo 2 link gia hạn Mentor — UEHM Season 12\./i)).toBeTruthy();
  });

  it("lists every selected mentor with name and mentor code", () => {
    renderPicker();
    fireEvent.click(checkboxFor("Validation Mentor 01"));
    fireEvent.click(checkboxFor("Validation Mentor 02"));
    fireEvent.click(confirmTrigger());
    expect(screen.getByText("Validation Mentor 01 — VM-001")).toBeTruthy();
    expect(screen.getByText("Validation Mentor 02 — VM-002")).toBeTruthy();
  });

  it("exposes exactly one submit control once confirmed", () => {
    renderPicker();
    fireEvent.click(checkboxFor("Validation Mentor 01"));
    fireEvent.click(confirmTrigger());
    expect(submitButtons()).toHaveLength(1);
    expect(screen.getByRole("button", { name: /Xác nhận tạo 1 link/i })).toBeTruthy();
  });

  it("hides the picker while confirming so the selection cannot drift", () => {
    renderPicker();
    fireEvent.click(checkboxFor("Validation Mentor 01"));
    fireEvent.click(confirmTrigger());
    expect(screen.queryByLabelText(/Tìm mentor/i)).toBeNull();
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
  });

  it("cancel creates nothing and preserves the selection exactly", () => {
    const { container } = renderPicker();
    fireEvent.click(checkboxFor("Validation Mentor 01"));
    fireEvent.click(checkboxFor("Validation Mentor 02"));
    const before = personIdsField(container).value;
    fireEvent.click(confirmTrigger());
    fireEvent.click(screen.getByRole("button", { name: "Hủy" }));

    expect(submitButtons()).toHaveLength(0);          // back to a mint-proof phase
    expect(screen.getByText("Đã chọn 2 mentor")).toBeTruthy();
    expect(personIdsField(container).value).toBe(before);
    expect(screen.getByLabelText(/Tìm mentor/i)).toBeTruthy();
  });

  it("submits exactly the confirmed people", () => {
    const { container } = renderPicker();
    fireEvent.click(checkboxFor("Validation Mentor 01"));
    fireEvent.click(checkboxFor("Validation Mentor 02"));
    fireEvent.click(confirmTrigger());
    const ids = JSON.parse(personIdsField(container).value);
    expect(ids).toHaveLength(2);
    expect(ids).toEqual([ROSTER[0].personId, ROSTER[1].personId]);
  });

  it("works for a single mentor", () => {
    renderPicker();
    fireEvent.click(checkboxFor("Validation Mentor 01"));
    fireEvent.click(confirmTrigger());
    expect(screen.getByText(/Bạn sắp tạo 1 link/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Xác nhận tạo 1 link/i })).toBeTruthy();
  });

  it("works at the 25-mentor ceiling", () => {
    const many = Array.from({ length: RENEWAL_BATCH_MAX_SIZE + 10 }, (_, i) => mentor(i + 1));
    renderPicker(many);
    fireEvent.click(screen.getByText(/Chọn tất cả kết quả đang lọc/i));
    fireEvent.click(confirmTrigger());
    expect(screen.getByText(new RegExp(`Bạn sắp tạo ${RENEWAL_BATCH_MAX_SIZE} link`))).toBeTruthy();
    expect(screen.getByRole("button", { name: new RegExp(`Xác nhận tạo ${RENEWAL_BATCH_MAX_SIZE} link`) })).toBeTruthy();
  });

  it("carries the operator's expiry through confirmation instead of reverting it", () => {
    const { container } = renderPicker();
    fireEvent.click(checkboxFor("Validation Mentor 01"));
    fireEvent.change(container.querySelector('input[name="expires_days"]') as HTMLInputElement, {
      target: { value: "21" }
    });
    fireEvent.click(confirmTrigger());
    expect(screen.getByText(/Hiệu lực: 21 ngày/i)).toBeTruthy();
    expect((container.querySelector('input[name="expires_days"]') as HTMLInputElement).value).toBe("21");
  });

  it("cannot open confirmation with an empty selection", () => {
    renderPicker();
    expect((confirmTrigger() as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByText(/Bạn sắp tạo/i)).toBeNull();
  });
});

describe("M076 picker — previously declined mentors", () => {
  it("labels a mentor who declined and has no newer live invite", () => {
    renderPicker();
    expect(screen.getByText("Đã từ chối")).toBeTruthy();
  });

  it("does not offer them for ordinary batch selection", () => {
    renderPicker();
    expect(checkboxFor("Declined Mentor 06").disabled).toBe(true);
  });

  it("cannot be swept into a selection even if the checkbox is driven directly", () => {
    const { container } = renderPicker();
    fireEvent.click(checkboxFor("Declined Mentor 06"));
    expect(screen.getByText("Đã chọn 0 mentor")).toBeTruthy();
    expect(JSON.parse(personIdsField(container).value)).toEqual([]);
  });

  it("is excluded from select-all-filtered", () => {
    const { container } = renderPicker();
    fireEvent.change(searchBox(), { target: { value: "Declined" } });
    expect(screen.queryByText(/Chọn tất cả kết quả đang lọc/i)).toBeNull();
    expect(JSON.parse(personIdsField(container).value)).toEqual([]);
  });

  it("keeps the accepted and live-invite protections unchanged", () => {
    renderPicker();
    expect(checkboxFor("Validation Mentor 04").disabled).toBe(true);   // live invite
    expect(checkboxFor("Validation Mentor 05").disabled).toBe(true);   // accepted
    expect(screen.getByText("Đã có link")).toBeTruthy();
    expect(screen.getByText("Đã gia hạn")).toBeTruthy();
  });

  it("still allows ordinary eligible mentors through", () => {
    renderPicker();
    expect(checkboxFor("Validation Mentor 01").disabled).toBe(false);
    fireEvent.click(checkboxFor("Validation Mentor 01"));
    expect(screen.getByText("Đã chọn 1 mentor")).toBeTruthy();
  });
});
