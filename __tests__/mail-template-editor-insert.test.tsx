/** @vitest-environment jsdom */
/**
 * Nút chèn ô điền.
 *
 * Đây là thứ chủ chương trình hỏi bằng đúng chữ "cho chọn các trường là các
 * nội dung sẽ pick thông tin đưa vào nội dung email". Nó chèn vào ĐÚNG CHỖ con
 * trỏ đang đứng, ở ĐÚNG ô văn bản vừa gõ dở — chèn nối vào cuối thì người soạn
 * phải cắt dán lại, và cái nút mất luôn lý do tồn tại.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/app/actions/email-templates", () => ({
  saveEmailTemplateAction: vi.fn(),
  approveEmailTemplateAction: vi.fn(),
  archiveEmailTemplateAction: vi.fn()
}));
vi.mock("react-dom", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useFormState: (action: unknown, initial: unknown) => [initial, action],
    useFormStatus: () => ({ pending: false })
  };
});

import { TemplateEditor } from "@/app/operations/mail/template-editor";

afterEach(cleanup);

function renderEditor(overrides: Partial<Parameters<typeof TemplateEditor>[0]> = {}) {
  return render(
    <TemplateEditor kind="general_announcement" template={null} canApprove={false} {...overrides} />
  );
}

function body() {
  return screen.getByLabelText("Nội dung thư") as HTMLTextAreaElement;
}

function subject() {
  return screen.getByLabelText("Tiêu đề thư") as HTMLInputElement;
}

function clickField(label: string) {
  fireEvent.click(screen.getByRole("button", { name: new RegExp(label) }));
}

describe("danh mục ô điền hiện ra", () => {
  it("liệt kê đủ ba ô của thông báo chung, kèm nhãn tiếng Việt", () => {
    renderEditor();
    for (const label of ["Tên người nhận", "Tên mùa", "Vai trò"]) {
      expect(screen.getByRole("button", { name: new RegExp(label) })).toBeTruthy();
    }
  });

  it("hiện cả dạng gõ tay của mỗi ô, để ai muốn gõ vẫn gõ được", () => {
    renderEditor();
    expect(screen.getByText("{{ten_nguoi_nhan}}")).toBeTruthy();
  });
});

describe("chèn vào đúng chỗ", () => {
  it("chèn vào thân thư khi chưa chạm vào ô nào", () => {
    // Mặc định là thân thư: đó là nơi hầu hết các ô được chèn vào.
    renderEditor();
    clickField("Tên người nhận");
    expect(body().value).toBe("{{ten_nguoi_nhan}}");
    expect(subject().value).toBe("");
  });

  it("chèn vào giữa đoạn văn, không nối vào cuối", () => {
    renderEditor();
    const area = body();
    fireEvent.change(area, { target: { value: "Chào , rất vui gặp bạn." } });
    // Con trỏ ngay trước dấu phẩy.
    area.setSelectionRange(5, 5);
    fireEvent.keyUp(area);

    clickField("Tên người nhận");
    expect(body().value).toBe("Chào {{ten_nguoi_nhan}}, rất vui gặp bạn.");
  });

  it("thay phần đang bôi đen chứ không đẩy nó sang bên", () => {
    renderEditor();
    const area = body();
    fireEvent.change(area, { target: { value: "Chào XXXXX nhé" } });
    area.setSelectionRange(5, 10);
    fireEvent.keyUp(area);

    clickField("Tên người nhận");
    expect(body().value).toBe("Chào {{ten_nguoi_nhan}} nhé");
  });

  it("chèn vào tiêu đề sau khi người soạn chạm vào tiêu đề", () => {
    renderEditor();
    const field = subject();
    fireEvent.change(field, { target: { value: "Thông báo " } });
    field.setSelectionRange(10, 10);
    fireEvent.focus(field);

    clickField("Tên mùa");
    expect(subject().value).toBe("Thông báo {{mua}}");
    expect(body().value).toBe("");
  });

  it("quay lại thân thư khi người soạn quay lại thân thư", () => {
    renderEditor();
    fireEvent.focus(subject());
    fireEvent.focus(body());

    clickField("Tên mùa");
    expect(body().value).toBe("{{mua}}");
    expect(subject().value).toBe("");
  });

  it("chèn được nhiều ô liên tiếp mà không đè lên nhau", () => {
    renderEditor();
    clickField("Tên người nhận");
    clickField("Tên mùa");
    expect(body().value).toBe("{{ten_nguoi_nhan}}{{mua}}");
  });

  it("không vỡ khi vị trí con trỏ nhớ được đã cũ hơn nội dung", () => {
    // Người soạn để con trỏ ở cuối một đoạn dài, xoá gần hết, rồi mới bấm nút.
    renderEditor();
    const area = body();
    fireEvent.change(area, { target: { value: "một đoạn văn khá dài" } });
    area.setSelectionRange(20, 20);
    fireEvent.keyUp(area);
    fireEvent.change(area, { target: { value: "ngắn" } });

    clickField("Tên mùa");
    expect(body().value).toContain("{{mua}}");
    expect(body().value.startsWith("ngắn")).toBe(true);
  });
});

describe("xem trước", () => {
  it("hiện giá trị mẫu chứ không hiện ô điền", () => {
    renderEditor();
    fireEvent.change(subject(), { target: { value: "Thông báo {{mua}}" } });
    fireEvent.change(body(), { target: { value: "Chào {{ten_nguoi_nhan}}." } });

    expect(screen.getByText("Thông báo UEHM-S12")).toBeTruthy();
    expect(screen.getByText("Chào Nguyễn Văn A.")).toBeTruthy();
  });

  it("nói rõ là dữ liệu mẫu, không phải người thật", () => {
    renderEditor();
    expect(screen.getByText(/dữ liệu mẫu, không phải người thật/)).toBeTruthy();
  });
});

describe("kiểm lúc gõ", () => {
  it("báo ngay khi thư dùng một ô không có dữ liệu", () => {
    renderEditor();
    fireEvent.change(body(), { target: { value: "Chào {{ten_that}}" } });
    expect(screen.getByRole("alert").textContent).toContain("{{ten_that}}");
  });

  it("báo ngay khi thư có thẻ HTML", () => {
    renderEditor();
    fireEvent.change(body(), { target: { value: "<b>khẩn</b>" } });
    expect(screen.getByRole("alert").textContent).toContain("văn bản thuần");
  });

  it("đếm ký tự đã gõ", () => {
    renderEditor();
    fireEvent.change(body(), { target: { value: "Chào bạn" } });
    expect(screen.getByText("8/8000 ký tự")).toBeTruthy();
  });
});

describe("duyệt mẫu thư", () => {
  const draft = {
    id: "t1",
    kind: "general_announcement" as const,
    name: "Nhắc hạn",
    subject: "Thông báo UEHM-S12",
    body: "Chào {{ten_nguoi_nhan}}.",
    status: "draft" as const
  };

  it("không hiện khung duyệt cho người không có quyền duyệt", () => {
    renderEditor({ template: draft, canApprove: false });
    expect(screen.queryByText("Duyệt mẫu thư")).toBeNull();
  });

  it("bắt gõ lại tiêu đề, và cho thấy tiêu đề đang duyệt", () => {
    renderEditor({ template: draft, canApprove: true });
    expect(screen.getByPlaceholderText("Gõ lại tiêu đề ở trên")).toBeTruthy();
    expect(screen.getAllByText("Thông báo UEHM-S12").length).toBeGreaterThan(0);
  });

  it("không hiện khung duyệt cho mẫu đã duyệt rồi", () => {
    renderEditor({ template: { ...draft, status: "approved" }, canApprove: true });
    expect(screen.queryByPlaceholderText("Gõ lại tiêu đề ở trên")).toBeNull();
  });

  it("cảnh báo rằng sửa một mẫu đã duyệt sẽ phải duyệt lại", () => {
    renderEditor({ template: { ...draft, status: "approved" }, canApprove: true });
    expect(screen.getByText(/đưa nó về bản nháp và cần duyệt lại/)).toBeTruthy();
  });
});
