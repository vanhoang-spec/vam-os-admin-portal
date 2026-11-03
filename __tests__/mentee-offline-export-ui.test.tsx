// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import path from "node:path";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import PizZip from "pizzip";
import { ExportPanel } from "@/app/interviews/mentee-offline/xuat-excel/export-panel";
import { buildExportTable, summaryRows } from "@/lib/mentee-offline-export-core";
import { menteeOfflineXlsx } from "@/lib/mentee-offline-export-xlsx";
import { dataset, uuid } from "./support/mentee-offline-export-fixture";

const source = (file: string) => readFileSync(path.resolve(file), "utf8");
const rows = summaryRows(dataset());
const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn(() => "blob:test"), revokeObjectURL: vi.fn() }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const hiddenIds = () => (document.querySelector('input[name="ids"]') as HTMLInputElement).value;
const exportButton = () => screen.getByRole("button", { name: /^(Xuất Excel|Đang tạo)/ });

describe("trang chọn mentee và bộ lọc", () => {
  it("hiện đủ mentee, đếm đúng, nút xuất tất cả bạn đang hiện", () => {
    render(<ExportPanel rows={rows} />);
    expect(screen.getByTestId("export-count").textContent).toContain("3");
    expect(exportButton().textContent).toBe("Xuất Excel tất cả 3 mentee đang hiện");
    expect(hiddenIds()).toBe("");
  });

  it("các bộ lọc kết hợp cùng lúc thu hẹp danh sách", () => {
    render(<ExportPanel rows={rows} />);
    fireEvent.change(screen.getByLabelText("Kết quả vòng hồ sơ"), { target: { value: "waitlist" } });
    expect(screen.getAllByRole("checkbox")).toHaveLength(1);
    expect(exportButton().textContent).toBe("Xuất Excel tất cả 1 mentee đang hiện");
    fireEvent.change(screen.getByLabelText("Kết quả vòng phỏng vấn"), { target: { value: "passed" } });
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    expect(screen.getByText("Không có mentee nào khớp bộ lọc.")).toBeTruthy();
    expect((exportButton() as HTMLButtonElement).disabled).toBe(true);
  });

  it("tick một số bạn thì chỉ xuất những bạn đó; mã đi theo ô ẩn", () => {
    render(<ExportPanel rows={rows} />);
    fireEvent.click(screen.getByLabelText("Chọn Nguyễn Văn An"));
    expect(exportButton().textContent).toBe("Xuất Excel 1 mentee đã chọn");
    expect(hiddenIds()).toBe(uuid(1));
  });

  it("chọn tất cả đang hiện chỉ chọn những bạn đang lọc; bạn bị lọc ẩn không tính vào số xuất", () => {
    render(<ExportPanel rows={rows} />);
    fireEvent.click(screen.getByLabelText("Chọn Nguyễn Văn An"));
    fireEvent.change(screen.getByLabelText("Kết quả vòng hồ sơ"), { target: { value: "waitlist" } });
    // An đã tick nhưng đang bị lọc ẩn: không tính, và không gửi đi.
    expect(hiddenIds()).toBe("");
    fireEvent.click(screen.getByRole("button", { name: "Chọn tất cả đang hiện" }));
    expect(hiddenIds()).toBe(uuid(2));
    fireEvent.click(screen.getByRole("button", { name: "Xoá bộ lọc" }));
    expect(hiddenIds().split(",").sort()).toEqual([uuid(1), uuid(2)].sort());
  });

  it("ô tìm không dấu", () => {
    render(<ExportPanel rows={rows} />);
    fireEvent.change(screen.getByPlaceholderText(/Gõ tên hoặc email/), { target: { value: "dang chi" } });
    expect(screen.getAllByRole("checkbox")).toHaveLength(1);
  });
});

describe("tải file", () => {
  it("gửi POST kèm các điều kiện và mã đã chọn, rồi báo đã tạo file", async () => {
    fetchMock.mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-disposition": 'attachment; filename="mentee-phong-van-truc-tiep-S12-20261103.xlsx"' } }));
    render(<ExportPanel rows={rows} />);
    fireEvent.click(screen.getByLabelText("Chọn Trần Thị Bình"));
    fireEvent.change(screen.getByLabelText("Kết quả vòng phỏng vấn"), { target: { value: "needs_review" } });
    fireEvent.submit(screen.getByTestId("export-form"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/exports/mentee-offline");
    expect(init.method).toBe("POST");
    const body = init.body as FormData;
    expect(body.get("ids")).toBe(uuid(2));
    expect(body.get("interview_result")).toBe("needs_review");
    await waitFor(() => expect(screen.getByText(/Đã tạo file mentee-phong-van-truc-tiep-S12-20261103\.xlsx với 1 mentee/)).toBeTruthy());
  });

  it("máy chủ từ chối thì hiện đúng lời từ chối, không tải gì", async () => {
    fetchMock.mockResolvedValue(new Response("Bạn chưa có quyền xuất file này.", { status: 403 }));
    render(<ExportPanel rows={rows} />);
    fireEvent.submit(screen.getByTestId("export-form"));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Bạn chưa có quyền xuất file này."));
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it("mất mạng thì báo, nút xuất dùng lại được", async () => {
    fetchMock.mockRejectedValue(new Error("offline"));
    render(<ExportPanel rows={rows} />);
    fireEvent.submit(screen.getByTestId("export-form"));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Mất kết nối"));
    expect((exportButton() as HTMLButtonElement).disabled).toBe(false);
  });

  it("không có ai để xuất thì không gửi gì", () => {
    render(<ExportPanel rows={[]} />);
    fireEvent.submit(screen.getByTestId("export-form"));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("file Excel dựng ra là XML hợp lệ", () => {
  it("mọi phần của gói XLSX đều đọc được bằng trình phân tích XML, kể cả khi có ký tự đặc biệt trong nội dung", () => {
    const data = dataset();
    data.reviews[1].reviewer_note = 'Nhận xét có <thẻ> & "dấu nháy" và \u0001 ký tự điều khiển';
    const zip = new PizZip(menteeOfflineXlsx(buildExportTable(data, [uuid(1), uuid(2), uuid(3)])));
    const parts = ["[Content_Types].xml", "_rels/.rels", "xl/workbook.xml", "xl/_rels/workbook.xml.rels", "xl/styles.xml", "xl/worksheets/sheet1.xml"];
    for (const part of parts) {
      const parsed = new DOMParser().parseFromString(zip.file(part)!.asText(), "application/xml");
      expect(parsed.getElementsByTagName("parsererror").length, part).toBe(0);
    }
    const sheet = zip.file("xl/worksheets/sheet1.xml")!.asText();
    expect(sheet).toContain("Nhận xét có &lt;thẻ&gt; &amp; &quot;dấu nháy&quot;");
    expect(sheet.includes(String.fromCharCode(1))).toBe(false);
  });
});

describe("nối vào màn hình phỏng vấn", () => {
  it("nút xuất chỉ hiện cho nhóm được tải; trang đích kiểm quyền ở máy chủ, không đọc database trực tiếp", () => {
    const page = source("app/interviews/mentee-offline/page.tsx");
    expect(page).toContain("canExportMenteeOffline(adminUser?.role)");
    expect(page).toContain("{canExport ?");
    expect(page).toContain("/xuat-excel");
    const exportPage = source("app/interviews/mentee-offline/xuat-excel/page.tsx");
    expect(exportPage).toContain("getMenteeOfflineExportOptions");
    expect(exportPage).not.toContain("getSupabaseServiceRoleClient");
  });
  it("biểu mẫu gửi tới đường tải POST, và hướng dẫn trong app nhắc tới chức năng", () => {
    expect(source("app/interviews/mentee-offline/xuat-excel/export-panel.tsx")).toContain('action="/api/exports/mentee-offline"');
    expect(source("lib/help-guides.ts")).toContain("Xuất Excel hồ sơ và đánh giá");
  });
});
