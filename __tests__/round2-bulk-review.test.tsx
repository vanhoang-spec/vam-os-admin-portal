/** @vitest-environment jsdom */
import React from "react";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { cleanup, render, fireEvent, within, waitFor } from "@testing-library/react";
import { BulkGroupReview, MenteeReviewCheckbox, MentorReviewCheckbox } from "@/app/matches/vong-2/bulk-group-review";
import { TableSearch } from "@/components/table-search";
import { parseGroupApprovals } from "@/lib/matching-round2-bulk-core";
(globalThis as typeof globalThis & { React: typeof React }).React = React;

// Hai hành động khác nhau để biết nút nối đúng hành động của từng vai trò; useFormState ghi lại hành động nó nhận.
const actions = vi.hoisted(() => ({ mentor: vi.fn(), mentee: vi.fn(), received: [] as unknown[] }));
vi.mock("@/app/actions/matching-round2", () => ({ confirmMentorGroupsAction: actions.mentor, confirmMenteeGroupsAction: actions.mentee }));
vi.mock("react-dom", async (original) => ({ ...await original<typeof import("react-dom")>(),
  useFormState: (action: unknown, initial: unknown) => { actions.received.push(action); return [initial, vi.fn()]; }, useFormStatus: () => ({ pending: false }) }));
beforeEach(() => { actions.received.length = 0; });
afterEach(cleanup);
const items = [
  { assignmentId: "11111111-1111-4111-8111-111111111111", name: "Lan", expectedGroup: 3, expectedDrift: null },
  { assignmentId: "22222222-2222-4222-8222-222222222222", name: "Minh", expectedGroup: 4, expectedDrift: null }
];
function setup() {
  return render(<BulkGroupReview items={items}><TableSearch><table><tbody>{items.map((item) =>
    <tr key={item.assignmentId}><td>{item.name}</td><td><MentorReviewCheckbox item={item} /></td></tr>
  )}</tbody></table></TableSearch></BulkGroupReview>);
}
describe("duyệt nhóm mentor hàng loạt", () => {
  it("chọn tất cả chỉ lấy dòng đang hiện sau tìm kiếm, xác nhận mang đúng nhóm", async () => {
    const view = setup();
    fireEvent.change(view.getByRole("searchbox"), { target: { value: "Lan" } });
    await waitFor(() => expect(view.getByLabelText(/Chọn tất cả.*\(1\)/)).toBeTruthy());
    fireEvent.click(view.getByLabelText(/Chọn tất cả/));
    expect((view.getByLabelText("Duyệt nhóm của Minh") as HTMLInputElement).checked).toBe(false);
    expect(view.queryByRole("dialog")).toBeNull();
    fireEvent.click(view.getByRole("button", { name: "Duyệt 1 mentor đã chọn" }));
    const dialog = view.getByRole("dialog");
    expect(within(dialog).getByText("Lan")).toBeTruthy();
    expect(within(dialog).queryByText("Minh")).toBeNull();
    expect(JSON.parse(dialog.querySelector<HTMLInputElement>('input[name="rows"]')!.value)).toEqual([
      { assignmentId: items[0].assignmentId, expectedGroup: 3, expectedDrift: null }
    ]);
    fireEvent.click(within(dialog).getByRole("button", { name: "Quay lại" }));
    expect(view.queryByRole("dialog")).toBeNull();
  });
  it("bỏ chọn dòng bị ẩn khi thay đổi tìm kiếm", async () => {
    const view = setup();
    fireEvent.click(view.getByLabelText(/Chọn tất cả/));
    fireEvent.change(view.getByRole("searchbox"), { target: { value: "Minh" } });
    await waitFor(() => expect(view.getByRole("button", { name: "Duyệt 1 mentor đã chọn" })).toBeTruthy());
    expect((view.getByLabelText("Duyệt nhóm của Lan") as HTMLInputElement).checked).toBe(false);
  });
  it("từ chối danh sách rỗng, trùng ID, nhóm sai, hoặc quá 500 dòng", () => {
    expect(parseGroupApprovals([])).toBeNull();
    expect(parseGroupApprovals([items[0], items[0]])).toBeNull();
    expect(parseGroupApprovals([{ ...items[0], expectedGroup: 10 }])).toBeNull();
    expect(parseGroupApprovals(Array(501).fill(items[0]))).toBeNull();
    expect(parseGroupApprovals(items)).toHaveLength(2);
  });
  it("mặc định là mentor: nối hành động của mentor, lời nói 'mentor'", () => {
    const view = setup();
    expect(actions.received.every((a) => a === actions.mentor)).toBe(true);
    expect(view.getByText(/Chọn tất cả mentor chưa duyệt đang hiện \(2\)/)).toBeTruthy();
    expect(view.getByText(/Mentor đã duyệt có nhãn/)).toBeTruthy();
  });
});

// BTC 13/10/2026: thêm duyệt hàng loạt cho mentee, cùng khuôn với mentor.
function setupMentee(list: Array<(typeof items)[number] & { needsReview?: boolean }> = items, note?: string) {
  return render(<BulkGroupReview items={list} role="mentee" note={note}><TableSearch><table><tbody>{list.map((item) =>
    <tr key={item.assignmentId}><td>{item.name}</td><td><MenteeReviewCheckbox item={item} /></td></tr>
  )}</tbody></table></TableSearch></BulkGroupReview>);
}
describe("duyệt nhóm mentee hàng loạt", () => {
  it("nối hành động của MENTEE (không phải của mentor)", () => {
    setupMentee();
    expect(actions.received.length).toBeGreaterThan(0);
    expect(actions.received.every((a) => a === actions.mentee)).toBe(true);
    expect(actions.received).not.toContain(actions.mentor);
  });

  it("mọi lời trên thanh và trong hộp xác nhận đều nói 'mentee', không còn chữ 'mentor'", () => {
    const view = setupMentee();
    expect(view.getByText(/Chọn tất cả mentee chưa duyệt đang hiện \(2\)/)).toBeTruthy();
    expect(view.getByText(/Mentee đã duyệt có nhãn/)).toBeTruthy();
    fireEvent.click(view.getByLabelText(/Chọn tất cả/));
    fireEvent.click(view.getByRole("button", { name: "Duyệt 2 mentee đã chọn" }));
    const dialog = view.getByRole("dialog");
    expect(within(dialog).getByRole("heading").textContent).toBe("Xác nhận duyệt nhóm cho 2 mentee");
    expect(within(dialog).getByText(/Các mentee sau sẽ được ghi nhận/)).toBeTruthy();
    expect(within(dialog).getByText("Mentee")).toBeTruthy();
    expect(within(dialog).getByText("Tổng: 2 mentee")).toBeTruthy();
    expect(view.container.textContent).not.toMatch(/mentor/i);
  });

  it("chọn tất cả chỉ lấy dòng đang hiện sau tìm kiếm và gửi đúng mã + nhóm đang xem", async () => {
    const view = setupMentee();
    fireEvent.change(view.getByRole("searchbox"), { target: { value: "Minh" } });
    await waitFor(() => expect(view.getByLabelText(/Chọn tất cả.*\(1\)/)).toBeTruthy());
    fireEvent.click(view.getByLabelText(/Chọn tất cả/));
    expect((view.getByLabelText("Duyệt nhóm của Lan") as HTMLInputElement).checked).toBe(false);
    fireEvent.click(view.getByRole("button", { name: "Duyệt 1 mentee đã chọn" }));
    const dialog = view.getByRole("dialog");
    expect(JSON.parse(dialog.querySelector<HTMLInputElement>('input[name="rows"]')!.value)).toEqual([
      { assignmentId: items[1].assignmentId, expectedGroup: 4, expectedDrift: null }
    ]);
    expect(dialog.querySelector<HTMLInputElement>('input[name="confirmed"]')!.value).toBe("yes");
  });

  it("người còn cờ 'Cần BTC xem': hộp xác nhận cảnh báo và đánh dấu từng người, nhưng cờ KHÔNG đi lên máy chủ", () => {
    const flagged = [{ ...items[0], needsReview: true }, { ...items[1], needsReview: false }];
    const view = setupMentee(flagged);
    fireEvent.click(view.getByLabelText(/Chọn tất cả/));
    fireEvent.click(view.getByRole("button", { name: "Duyệt 2 mentee đã chọn" }));
    const dialog = view.getByRole("dialog");
    expect(within(dialog).getByTestId("bulk-flagged-warning").textContent).toContain("1 người trong danh sách đang có cờ “Cần BTC xem”");
    expect(within(dialog).getAllByText("Cần BTC xem")).toHaveLength(1);
    // Chỉ ba trường của GroupApproval đi lên.
    const rows = JSON.parse(dialog.querySelector<HTMLInputElement>('input[name="rows"]')!.value) as Array<Record<string, unknown>>;
    for (const row of rows) expect(Object.keys(row).sort()).toEqual(["assignmentId", "expectedDrift", "expectedGroup"]);
  });

  it("không ai còn cờ thì không có lời cảnh báo", () => {
    const view = setupMentee();
    fireEvent.click(view.getByLabelText(/Chọn tất cả/));
    fireEvent.click(view.getByRole("button", { name: "Duyệt 2 mentee đã chọn" }));
    expect(within(view.getByRole("dialog")).queryByTestId("bulk-flagged-warning")).toBeNull();
  });

  it("dòng nhắc (khi xem cả hai vai trò) hiện trên thanh; không có thì không hiện", () => {
    const withNote = setupMentee(items, "Chọn Vai trò = Mentee để duyệt mentee.");
    expect(withNote.getByTestId("bulk-note").textContent).toBe("Chọn Vai trò = Mentee để duyệt mentee.");
    cleanup();
    expect(setupMentee().queryByTestId("bulk-note")).toBeNull();
  });

  it("thanh duyệt ẩn hẳn khi không có quyền sửa nhóm (enabled = false)", () => {
    const view = render(<BulkGroupReview items={items} role="mentee" enabled={false}><div>nội dung</div></BulkGroupReview>);
    expect(view.queryByLabelText(/Chọn tất cả/)).toBeNull();
    expect(view.queryByRole("button", { name: /Duyệt/ })).toBeNull();
    expect(view.getByText("nội dung")).toBeTruthy();
  });
});

// BTC 13/10/2026: có 661 mentee chờ duyệt mà một lượt chỉ nhận 500. "Chọn tất cả" phải tự giới hạn và nói rõ,
// không để người dùng bấm xác nhận xong mới gặp lỗi "Danh sách không hợp lệ".
const many = (n: number) => Array.from({ length: n }, (_, i) => ({
  assignmentId: `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`, name: `Bạn ${i + 1}`, expectedGroup: 3, expectedDrift: null
}));
describe("trần 500 người mỗi lượt duyệt", () => {
  it("kiểm hình dạng: 500 người khác nhau qua, 501 người khác nhau bị từ chối (không nhờ trùng mã)", () => {
    expect(parseGroupApprovals(many(500))).toHaveLength(500);
    expect(parseGroupApprovals(many(501))).toBeNull();
  });

  it("đúng 500 người: nhãn như cũ, không có lời nhắc về trần, chọn được cả 500", () => {
    const view = setupMentee(many(500));
    expect(view.getByText("Chọn tất cả mentee chưa duyệt đang hiện (500)")).toBeTruthy();
    expect(view.queryByTestId("bulk-cap-note")).toBeNull();
    fireEvent.click(view.getByLabelText(/Chọn tất cả/));
    expect(view.getByRole("button", { name: "Duyệt 500 mentee đã chọn" })).toBeTruthy();
  });

  it("501 người: 'chọn' lấy đúng 500 người đầu, nói rõ còn bao nhiêu người để lượt sau, và danh sách gửi lên qua được kiểm hình dạng", () => {
    const view = setupMentee(many(501));
    expect(view.getByText("Chọn 500 mentee đầu tiên trong 501 đang hiện")).toBeTruthy();
    expect(view.getByTestId("bulk-cap-note").textContent).toBe("Mỗi lượt duyệt tối đa 500 người. Duyệt xong, 1 người còn lại vẫn ở trên bảng — chọn tiếp để duyệt lượt sau.");
    fireEvent.click(view.getByLabelText(/Chọn 500 mentee đầu tiên/));
    fireEvent.click(view.getByRole("button", { name: "Duyệt 500 mentee đã chọn" }));
    const rows = JSON.parse(view.getByRole("dialog").querySelector<HTMLInputElement>('input[name="rows"]')!.value) as Array<{ assignmentId: string }>;
    expect(rows).toHaveLength(500);
    expect(rows[0].assignmentId).toBe(many(1)[0].assignmentId);
    expect(rows.some((r) => r.assignmentId === many(501)[500].assignmentId)).toBe(false);
    expect(parseGroupApprovals(rows)).not.toBeNull();
  });

  it("lời nhắc nói đúng số người CÒN LẠI, không lẫn với tổng số đang hiện", () => {
    const view = setupMentee(many(507));
    expect(view.getByTestId("bulk-cap-note").textContent).toBe("Mỗi lượt duyệt tối đa 500 người. Duyệt xong, 7 người còn lại vẫn ở trên bảng — chọn tiếp để duyệt lượt sau.");
  });

  it("đã chọn đủ 500 thì tick thêm người thứ 501 không được; bỏ một người rồi tick lại thì được", () => {
    const view = setupMentee(many(501));
    fireEvent.click(view.getByLabelText(/Chọn 500 mentee đầu tiên/));
    fireEvent.click(view.getByLabelText("Duyệt nhóm của Bạn 501"));
    expect((view.getByLabelText("Duyệt nhóm của Bạn 501") as HTMLInputElement).checked).toBe(false);
    expect(view.getByRole("button", { name: "Duyệt 500 mentee đã chọn" })).toBeTruthy();
    fireEvent.click(view.getByLabelText("Duyệt nhóm của Bạn 1"));
    fireEvent.click(view.getByLabelText("Duyệt nhóm của Bạn 501"));
    expect((view.getByLabelText("Duyệt nhóm của Bạn 501") as HTMLInputElement).checked).toBe(true);
    expect(view.getByRole("button", { name: "Duyệt 500 mentee đã chọn" })).toBeTruthy();
  });

  it("bấm lại chính ô chọn khi đang vượt trần thì bỏ chọn hết (không kẹt ở 500)", () => {
    const view = setupMentee(many(501));
    fireEvent.click(view.getByLabelText(/Chọn 500 mentee đầu tiên/));
    expect((view.getByLabelText(/Chọn 500 mentee đầu tiên/) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(view.getByLabelText(/Chọn 500 mentee đầu tiên/));
    expect((view.getByLabelText(/Chọn 500 mentee đầu tiên/) as HTMLInputElement).checked).toBe(false);
    expect(view.getByRole("button", { name: "Duyệt 0 mentee đã chọn" })).toBeTruthy();
  });
});
