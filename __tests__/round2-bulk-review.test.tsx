/** @vitest-environment jsdom */
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render, fireEvent, within, waitFor } from "@testing-library/react";
import { BulkGroupReview, MentorReviewCheckbox } from "@/app/matches/vong-2/bulk-group-review";
import { TableSearch } from "@/components/table-search";
import { parseGroupApprovals } from "@/lib/matching-round2-bulk-core";
(globalThis as typeof globalThis & { React: typeof React }).React = React;
vi.mock("@/app/actions/matching-round2", () => ({ confirmMentorGroupsAction: vi.fn() }));
vi.mock("react-dom", async (original) => ({ ...await original<typeof import("react-dom")>(),
  useFormState: (_action: unknown, initial: unknown) => [initial, vi.fn()], useFormStatus: () => ({ pending: false }) }));
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
});
