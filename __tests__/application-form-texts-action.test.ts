/**
 * Action lưu chữ trên form nộp đơn.
 *
 * Quyền nằm ở hàm ghi. Ca này canh rằng action chỉ chuyển xuống khối trong danh mục
 * kèm chữ màn hình đã hiện, và chỉ làm mới form công khai khi thật sự có gì đã ghi.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/application-form-text-write", () => ({ saveApplicationFormTexts: vi.fn() }));

import { revalidatePath } from "next/cache";
import { saveApplicationFormTextsAction } from "@/app/actions/application-form-texts";
import { saveApplicationFormTexts } from "@/lib/application-form-text-write";

const initial = { ok: false, message: null };

function groupForm(entries: Array<[string, string]>) {
  const formData = new FormData();
  for (const [key, value] of entries) formData.set(key, value);
  return formData;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("lưu chữ trên form nộp đơn", () => {
  it("chỉ chuyển khối trong danh mục và chữ màn hình đã hiện của chúng", async () => {
    vi.mocked(saveApplicationFormTexts).mockResolvedValue({ ok: true, message: "Đã lưu 1 khối chữ.", changed: 1 });

    await saveApplicationFormTextsAction(
      initial,
      groupForm([
        ["mentor.header.title", "Đơn mentor"],
        ["expected:mentor.header.title", "Đơn đăng ký mentor"],
        ["mentor.header.note", ""],
        ["expected:mentor.header.note", "Lưu ý cũ"],
        ["consent_data_storage", "on"],
        ["expected:bogus", "x"]
      ])
    );

    expect(saveApplicationFormTexts).toHaveBeenCalledWith({
      submitted: { "mentor.header.title": "Đơn mentor", "mentor.header.note": "" },
      expected: { "mentor.header.title": "Đơn đăng ký mentor", "mentor.header.note": "Lưu ý cũ" }
    });
  });

  it("có khối đã ghi: làm mới hai form công khai và trang quản trị", async () => {
    vi.mocked(saveApplicationFormTexts).mockResolvedValue({ ok: true, message: "Đã lưu 1 khối chữ.", changed: 1 });

    const state = await saveApplicationFormTextsAction(initial, groupForm([["mentor.header.title", "Đơn mentor"]]));

    expect(state).toEqual({ ok: true, message: "Đã lưu 1 khối chữ." });
    expect(vi.mocked(revalidatePath).mock.calls.map((call) => call[0])).toEqual([
      "/apply/mentor",
      "/apply/mentee",
      "/admin/seasons-forms/form-texts"
    ]);
  });

  it("không có gì đã ghi: không làm mới gì", async () => {
    vi.mocked(saveApplicationFormTexts).mockResolvedValue({ ok: true, message: "Không có khối chữ nào thay đổi.", changed: 0 });

    await saveApplicationFormTextsAction(initial, groupForm([["mentor.header.title", "Đơn đăng ký mentor"]]));

    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("từ chối: nói nguyên lời từ chối, không làm mới", async () => {
    vi.mocked(saveApplicationFormTexts).mockResolvedValue({
      ok: false,
      message: "Bạn không có quyền sửa chữ trên form đăng ký của mùa này.",
      changed: 0
    });

    const state = await saveApplicationFormTextsAction(initial, groupForm([["mentor.header.title", "x"]]));

    expect(state).toEqual({ ok: false, message: "Bạn không có quyền sửa chữ trên form đăng ký của mùa này." });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("lưu được một phần: vẫn làm mới để form hiện phần đã lưu, và nói ra", async () => {
    vi.mocked(saveApplicationFormTexts).mockResolvedValue({ ok: false, message: "Đã lưu phần chữ vừa sửa, nhưng…", changed: 1 });

    const state = await saveApplicationFormTextsAction(initial, groupForm([["mentor.header.title", "x"]]));

    expect(state.ok).toBe(false);
    expect(revalidatePath).toHaveBeenCalledWith("/apply/mentor");
  });

  it("lỗi bất ngờ: báo lỗi, không ném ra màn hình trắng", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(saveApplicationFormTexts).mockRejectedValue(new Error("hỏng"));

    expect(await saveApplicationFormTextsAction(initial, groupForm([["mentor.header.title", "x"]]))).toEqual({
      ok: false,
      message: "Lỗi hệ thống. Thử lưu lại."
    });
  });
});
