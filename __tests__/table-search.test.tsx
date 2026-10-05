/** @vitest-environment jsdom */
/**
 * Bảng dữ liệu của CRM (BTC 05/10/2026): tiêu đề cột dính ở đầu khung khi kéo
 * xuống, và ô tìm kiếm thông minh — gõ tới đâu lọc tới đó, theo bất kỳ thông tin
 * nào trên dòng, không cần dấu.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));

import { FilterableTable } from "@/components/filterable-table";
import { TableSearch } from "@/components/table-search";
import { ProgressiveTable, SimpleTable } from "@/components/ui";
import { matchesTableQuery, parseTableQuery, prepareRowText, rowMatchesQuery, rowMatchesTerms, tableSearchTerms } from "@/lib/table-search-core";

afterEach(cleanup);

describe("1. so khớp", () => {
  const matches = (text: string, query: string) => rowMatchesTerms(prepareRowText(text), tableSearchTerms(query));

  it("không dấu, không phân biệt hoa thường, đ thành d", () => {
    expect(matches("Lê Bá Khánh Hưng", "hung")).toBe(true);
    expect(matches("Đặng Phạm Minh Loan", "dang loan")).toBe(true);
    expect(matches("NGUYỄN THÀNH DANH", "Nguyễn thành")).toBe(true);
  });

  it("nhiều từ: dòng phải chứa ĐỦ mọi từ, ở cột nào cũng được", () => {
    const row = "Nguyễn Thành Danh ntdanhvn@gmail.com Lê Bá Khánh Hưng UEHM-S12-B1 Đang đồng hành";
    expect(matches(row, "danh b1")).toBe(true);
    expect(matches(row, "danh hung dang dong hanh")).toBe(true);
    expect(matches(row, "danh b2")).toBe(false);
  });

  it("email gõ nguyên, có @ và dấu chấm", () => {
    expect(matches("ntdanhvn@gmail.com", "ntdanhvn@gmail.com")).toBe(true);
    expect(matches("ntdanhvn@gmail.com", "danhvn@gm")).toBe(true);
  });

  it("SĐT và mã gõ liền tìm ra chỗ hiện có khoảng trắng hoặc gạch nối", () => {
    expect(matches("0912 345 678", "0912345678")).toBe(true);
    expect(matches("UEHM-S12-B1", "s12b1")).toBe(true);
  });

  it("SĐT: +84 và 0 đầu là một, gõ cách hay liền đều được, cả hai chiều", () => {
    const phone = (text: string, query: string) => rowMatchesQuery(prepareRowText(text), parseTableQuery(query));
    expect(phone("Mentee A 0901234567", "+84 901 234 567")).toBe(true);
    expect(phone("Mentee A +84 901 234 567", "0901234567")).toBe(true);
    expect(phone("Mentee A 0901.234.567", "0901 234567")).toBe(true);
    expect(phone("Mentee A 0901234567", "0999999999")).toBe(false);
    // Không phải SĐT (có chữ) thì vẫn là các từ thường.
    expect(parseTableQuery("S12 0901").phoneDigits).toBeNull();
    // Dưới 3 chữ số thì chưa coi là SĐT.
    expect(parseTableQuery("+84").phoneDigits).toBeNull();
  });

  it("chữ không có số thì không khớp xuyên ranh giới hai cột", () => {
    expect(matches("Danh B1", "anhb")).toBe(false);
  });

  it("câu tìm rỗng hoặc chỉ dấu câu khớp mọi dòng", () => {
    expect(tableSearchTerms("   ")).toEqual([]);
    expect(tableSearchTerms(" - ")).toEqual([]);
    expect(matches("bất kỳ", "")).toBe(true);
  });
});

const ROWS = [
  { mentor: "Nguyễn Thành Danh", email: "ntdanhvn@gmail.com", mentee: "Lê Bá Khánh Hưng", phone: "0912 345 678" },
  { mentor: "Phạm Hữu Nghị", email: "mr.nghi2006@gmail.com", mentee: "Huỳnh Nhật Hà", phone: "0987 654 321" },
  { mentor: "Trần Khánh Trang", email: "khanhtrangtran679@gmail.com", mentee: "Lê Uyên Vy", phone: "0901 222 333" }
];

function Table({ rows = ROWS, extra }: { rows?: typeof ROWS; extra?: Record<string, string> }) {
  return (
    <table>
      <thead>
        <tr>
          <th>Mentor</th>
          <th>Mentee</th>
          <th>Hành động</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.mentor} data-search={extra?.[row.mentor]}>
            <td>
              {row.mentor}
              <div>{row.email}</div>
            </td>
            <td>
              {row.mentee} · {row.phone}
            </td>
            <td>
              <button type="button">Hủy match</button>
              <select defaultValue="active" aria-label="Trạng thái">
                <option value="active">Đang đồng hành</option>
                <option value="ended">Kết thúc sớm</option>
              </select>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function visibleMentors(container: HTMLElement) {
  return Array.from(container.querySelectorAll("tbody tr"))
    .filter((row) => !row.hasAttribute("data-search-hidden"))
    .map((row) => row.querySelector("td")?.firstChild?.textContent);
}

function type(value: string) {
  fireEvent.change(screen.getByRole("searchbox"), { target: { value } });
}

describe("2. ô tìm kiếm trên bảng", () => {
  it("chưa gõ gì: không ẩn dòng nào, không hiện bộ đếm", () => {
    const { container } = render(<TableSearch><Table /></TableSearch>);
    expect(container.querySelectorAll("[data-search-hidden]")).toHaveLength(0);
    expect(screen.getByRole("status").textContent).toBe("");
  });

  it("gõ không dấu lọc đúng dòng, và báo đang hiện bao nhiêu/tổng", () => {
    const { container } = render(<TableSearch><Table /></TableSearch>);
    type("hung");
    expect(visibleMentors(container)).toEqual(["Nguyễn Thành Danh"]);
    expect(screen.getByRole("status").textContent).toBe("Đang hiện 1/3 dòng");
  });

  it("tìm theo email, theo SĐT gõ liền, theo nhiều từ ở nhiều cột", () => {
    const { container } = render(<TableSearch><Table /></TableSearch>);
    type("mr.nghi2006");
    expect(visibleMentors(container)).toEqual(["Phạm Hữu Nghị"]);
    type("0901222333");
    expect(visibleMentors(container)).toEqual(["Trần Khánh Trang"]);
    type("khanh le");
    // "Khánh" ở cả dòng 1 (mentee) và dòng 3 (mentor); "Lê" ở mentee dòng 1 và 3.
    expect(visibleMentors(container)).toEqual(["Nguyễn Thành Danh", "Trần Khánh Trang"]);
  });

  it("chữ trên nút và trong ô chọn không bị tìm — 'huy' không khớp nút Hủy match ở mọi dòng", () => {
    const { container } = render(<TableSearch><Table /></TableSearch>);
    type("huy");
    // Chỉ "Huỳnh Nhật Hà" thật sự chứa "huy".
    expect(visibleMentors(container)).toEqual(["Phạm Hữu Nghị"]);
    type("ket thuc som");
    expect(visibleMentors(container)).toEqual([]);
  });

  it("data-search thêm chữ không hiện ra để tìm", () => {
    const { container } = render(
      <TableSearch><Table extra={{ "Trần Khánh Trang": "UEHRF07045 marketing" }} /></TableSearch>
    );
    type("marketing");
    expect(visibleMentors(container)).toEqual(["Trần Khánh Trang"]);
  });

  it("không dòng nào khớp: nói rõ, không để một bảng trống trơn", () => {
    render(<TableSearch><Table /></TableSearch>);
    type("zzz");
    expect(screen.getByText("Không có dòng nào khớp «zzz».")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe("Đang hiện 0/3 dòng");
  });

  it("Escape và nút × xoá ô tìm, mọi dòng hiện lại", () => {
    const { container } = render(<TableSearch><Table /></TableSearch>);
    type("hung");
    fireEvent.keyDown(screen.getByRole("searchbox"), { key: "Escape" });
    expect(container.querySelectorAll("[data-search-hidden]")).toHaveLength(0);
    type("hung");
    fireEvent.click(screen.getByRole("button", { name: "Xoá ô tìm" }));
    expect(container.querySelectorAll("[data-search-hidden]")).toHaveLength(0);
    expect((screen.getByRole("searchbox") as HTMLInputElement).value).toBe("");
  });

  it("dòng tới sau (trang tự làm mới) cũng đi qua bộ lọc đang gõ", async () => {
    const { container, rerender } = render(<TableSearch><Table rows={ROWS.slice(0, 2)} /></TableSearch>);
    type("trang");
    expect(visibleMentors(container)).toEqual([]);
    // Dòng mới KHÔNG khớp là thứ phải bị ẩn — dòng khớp thì đằng nào cũng hiện.
    const newcomer = { mentor: "Võ Văn Mới", email: "moi@gmail.com", mentee: "Ai Đó", phone: "0900 000 000" };
    await act(async () => {
      rerender(<TableSearch><Table rows={[...ROWS, newcomer]} /></TableSearch>);
      await Promise.resolve();
    });
    expect(visibleMentors(container)).toEqual(["Trần Khánh Trang"]);
    expect(screen.getByRole("status").textContent).toBe("Đang hiện 1/4 dòng");
  });

  it("bảng lồng trong một ô không bị lọc riêng, không bị đếm", () => {
    const { container } = render(
      <TableSearch>
        <table>
          <tbody>
            <tr>
              <td>
                Ngoài Alpha
                <table>
                  <tbody>
                    <tr>
                      <td>Trong X</td>
                    </tr>
                  </tbody>
                </table>
              </td>
            </tr>
            <tr>
              <td>Ngoài Beta</td>
            </tr>
          </tbody>
        </table>
      </TableSearch>
    );
    type("alpha");
    expect(screen.getByRole("status").textContent).toBe("Đang hiện 1/2 dòng");
    expect(container.querySelectorAll("[data-search-hidden]")).toHaveLength(1);
  });
});

describe("3. bảng dùng chung", () => {
  const columns = [
    { key: "mentor", label: "Mentor" },
    { key: "mentee", label: "Mentee" }
  ];

  it("SimpleTable nằm trong khung dính tiêu đề; không bật tìm thì không có ô tìm", () => {
    const { container } = render(<SimpleTable rows={ROWS} columns={columns} />);
    const table = container.querySelector("table") as HTMLTableElement;
    expect(table.parentElement?.classList.contains("vam-table-frame")).toBe(true);
    expect(screen.queryByRole("searchbox")).toBeNull();
  });

  it("SimpleTable search: có ô tìm, lọc được", () => {
    const { container } = render(<SimpleTable rows={ROWS} columns={columns} search />);
    type("vy");
    expect(Array.from(container.querySelectorAll("tbody tr")).filter((r) => !r.hasAttribute("data-search-hidden")).map((r) => r.textContent)).toEqual([
      "Trần Khánh TrangLê Uyên Vy"
    ]);
  });

  it("nút 'Xem' dùng chung ở mọi dòng không bị tìm", () => {
    const linked = ROWS.map((row, i) => ({ ...row, id: `m${i}` }));
    render(
      <SimpleTable
        rows={linked}
        columns={[...columns, { key: "id", label: "Hồ sơ", internalHrefKey: "id", internalHrefPrefix: "/people/" }]}
        search
      />
    );
    type("xem");
    expect(screen.getByRole("status").textContent).toBe("Đang hiện 0/3 dòng");
  });

  it("ProgressiveTable search: một ô cho cả phần 'Xem thêm'; đang tìm thì mở phần gập, xoá thì gập lại", () => {
    const many = Array.from({ length: 25 }, (_, i) => ({ mentor: `Mentor ${i + 1}`, mentee: i === 23 ? "Đặng Mai" : `Mentee ${i + 1}` }));
    const { container } = render(<ProgressiveTable rows={many} columns={columns} search />);
    expect(screen.getAllByRole("searchbox")).toHaveLength(1);
    const details = container.querySelector("details") as HTMLDetailsElement;
    expect(details.open).toBe(false);
    type("dang mai");
    expect(details.open).toBe(true);
    expect(screen.getByRole("status").textContent).toBe("Đang hiện 1/25 dòng");
    type("");
    expect(details.open).toBe(false);
  });
});

describe("4. luật CSS của khung", () => {
  const css = readFileSync("app/globals.css", "utf8");

  it("khung tự cuộn với chiều cao giới hạn — thiếu thì sticky bám vào một khung không bao giờ cuộn", () => {
    expect(css).toMatch(/\.vam-table-frame\s*\{[^}]*max-height:\s*\d+vh;[^}]*overflow:\s*auto;/);
  });

  it("khung cô lập z-index (ô dính không đè thanh đầu trang z-10) và nằm trong @layer components (max-h riêng của bảng thắng)", () => {
    const layer = /@layer components\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? "";
    expect(layer).toMatch(/\.vam-table-frame\s*\{[^}]*isolation:\s*isolate;/);
    expect(layer).toMatch(/\.vam-table-frame\s*\{[^}]*max-height:/);
  });

  it("ô tiêu đề dính đỉnh, nền đặc, z trên cột dính trái; độ ưu tiên 0 để lớp riêng của bảng thắng", () => {
    const rule = /:where\(\.vam-table-frame\) thead th\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(rule).toMatch(/position:\s*sticky;/);
    expect(rule).toMatch(/top:\s*0;/);
    expect(rule).toMatch(/z-index:\s*20;/);
    expect(rule).toMatch(/background-color:\s*inherit;/);
    expect(css).toMatch(/:where\(\.vam-table-frame\) thead\s*\{[^}]*background-color:\s*#[0-9a-f]{6};/);
  });

  it("dòng bị lọc ẩn bằng thuộc tính riêng; in ra giấy thì in cả bảng", () => {
    expect(css).toMatch(/tr\[data-search-hidden\]\s*\{[^}]*display:\s*none !important;/);
    expect(css).toMatch(/@media print\s*\{[^@]*\.vam-table-frame\s*\{[^}]*max-height:\s*none;/);
  });
});

describe("5. FilterableTable (Ứng tuyển, Người, Mentor, Mentee): tìm trên dữ liệu, mọi cột, bỏ dấu", () => {
  const people = Array.from({ length: 30 }, (_, i) => ({
    id: `p${i}`,
    full_name: i === 27 ? "Đặng Thị Hưng" : `Người ${i}`,
    email_primary: `nguoi${i}@gmail.com`,
    school: i === 3 ? "Đại học Kinh tế" : "Trường khác",
    phone_primary: i === 12 ? "0912 345 678" : ""
  }));
  const columns = [
    { key: "full_name", label: "Họ tên" },
    { key: "school", label: "Trường" },
    { key: "phone_primary", label: "SĐT" }
  ];
  const renderTable = () =>
    render(<FilterableTable rows={people} columns={columns} searchPlaceholder="Tìm" searchKeys={["full_name", "email_primary"]} />);
  const shownNames = (container: HTMLElement) => Array.from(container.querySelectorAll("tbody tr")).map((row) => row.querySelector("td")?.textContent);
  const typeIn = (value: string) => fireEvent.change(screen.getByPlaceholderText("Tìm"), { target: { value } });

  it("bỏ dấu: 'dang hung' tìm ra 'Đặng Thị Hưng' — kể cả khi dòng đó nằm ở trang 2", () => {
    const { container } = renderTable();
    expect(shownNames(container)).not.toContain("Đặng Thị Hưng");
    typeIn("dang hung");
    expect(shownNames(container)).toEqual(["Đặng Thị Hưng"]);
  });

  it("tìm được theo cột đang hiện dù cột đó không có trong searchKeys", () => {
    const { container } = renderTable();
    typeIn("kinh te");
    expect(shownNames(container)).toEqual(["Người 3"]);
    typeIn("0912345678");
    expect(shownNames(container)).toEqual(["Người 12"]);
  });

  it("searchKeys vẫn được tìm dù không hiện thành cột (email)", () => {
    const { container } = renderTable();
    typeIn("nguoi7@gmail");
    expect(shownNames(container)).toEqual(["Người 7"]);
  });
});

describe("6. phép khớp trên dữ liệu", () => {
  it("chuỗi, số, mảng chuỗi; null/đối tượng bỏ qua", () => {
    expect(matchesTableQuery(["Lê Uyên Vy", 2026, ["S12", "B1"], null, { x: "ẩn" }], "vy 2026 s12 b1")).toBe(true);
    expect(matchesTableQuery([{ x: "ẩn" }], "an")).toBe(false);
    expect(matchesTableQuery([null], "")).toBe(true);
  });
});

describe("7. rà toàn CRM: mọi bảng nằm trong khung dính tiêu đề", () => {
  // Bảng nhỏ cố định, không bao giờ dài tới mức phải cuộn. Thêm vào đây phải có lý do.
  const EXEMPT: Record<string, string> = {
    "app/admin/renewals/page.tsx": "đối chiếu hồ sơ một mentor, tối đa 7 trường",
    "app/admin/seasons-forms/bonus-points/page.tsx": "vài quy tắc điểm cộng",
    "app/reviews/guide/page.tsx": "5 tiêu chí và 4 đề xuất, cố định",
    "components/doc-blocks-view.tsx": "bảng trong tài liệu AI, đã nằm trong khung cuộn riêng"
  };

  function tsxFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return tsxFiles(path);
      return path.endsWith(".tsx") ? [path.replace(/\\/g, "/")] : [];
    });
  }

  it("mỗi <table> có div bọc ngay ngoài mang lớp vam-table-frame", () => {
    const missing: string[] = [];
    for (const file of [...tsxFiles("app"), ...tsxFiles("components")]) {
      if (EXEMPT[file]) continue;
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, i) => {
        const at = line.indexOf("<table");
        if (at < 0) return;
        // Div bọc nằm cùng dòng (trước <table) hoặc ở dòng có chữ gần nhất phía trên.
        let wrapper = line.slice(0, at);
        for (let j = i - 1; !wrapper.trim() && j >= 0; j--) wrapper = lines[j];
        if (!/<div\b[^>]*className="[^"]*\bvam-table-frame\b/.test(wrapper)) missing.push(`${file}:${i + 1}`);
      });
    }
    expect(missing).toEqual([]);
  });

  it("danh sách miễn trừ không còn tên file đã mất (miễn trừ cũ không được che bảng mới)", () => {
    for (const file of Object.keys(EXEMPT)) expect(readFileSync(file, "utf8")).toContain("<table");
  });

  // Bảng liệt kê người/đơn/cặp/việc của cả mùa: phải có ô tìm. Bảng phân trang phía
  // máy chủ (Đánh giá, Thư đã gửi, hàng chờ chấm) giữ ô tìm máy chủ của nó — ô lọc
  // trên DOM chỉ thấy trang đang mở, sẽ nói dối là "không có".
  it.each([
    ["app/matches/page.tsx", "<TableSearch"],
    ["app/data-issues/page.tsx", "<TableSearch"],
    ["app/data-issues/page.tsx", "columns={columns} search"],
    ["app/events/[id]/attendance/page.tsx", "<TableSearch"],
    ["app/admin/users/page.tsx", "<TableSearch"],
    ["app/admin/renewals/legacy/legacy-client.tsx", "<TableSearch"],
    ["app/admin/seasons-forms/audit-table.tsx", "<TableSearch"],
    ["app/reviews/progress/page.tsx", "<TableSearch"],
    ["app/interviews/lich/btc-panel.tsx", "<TableSearch"],
    ["app/interviews/thu-xac-nhan-mentor/confirmation-client.tsx", "<TableSearch"]
  ])("%s có ô tìm (%s)", (file, marker) => {
    expect(readFileSync(file, "utf8")).toContain(marker);
  });

  it.each([
    ["app/team/page.tsx", 3],
    ["app/events/page.tsx", 1],
    ["app/events/[id]/page.tsx", 1],
    ["app/operations/page.tsx", 3],
    ["app/operations/tasks/page.tsx", 2],
    ["app/admin/page.tsx", 1],
    ["app/admin/users/page.tsx", 1],
    ["app/people/[id]/page.tsx", 4]
  ])("%s: %i bảng dùng chung bật search", (file, count) => {
    const source = readFileSync(file, "utf8");
    expect(source.match(/<(?:SimpleTable|ProgressiveTable)\s+search\b/g) ?? []).toHaveLength(count);
  });

  it.each([
    "app/reviews/reviewer-pool/reviewer-pool-client.tsx",
    "app/interviews/interviews-client.tsx",
    "app/reviews/assign-bulk/assign-bulk-form.tsx",
    "app/interviews/tien-do-mentor/mentor-progress-board.tsx",
    "app/interviews/tien-do-mentee/progress-board.tsx",
    "app/interviews/mentee-offline/workflow.tsx",
    "app/interviews/ket-qua-mentor/results-client.tsx",
    "components/filterable-table.tsx"
  ])("%s lọc bằng phép khớp chung (bỏ dấu, đủ mọi từ)", (file) => {
    const source = readFileSync(file, "utf8");
    expect(source).toContain("matchesTableQuery(");
    expect(source).not.toMatch(/toLocaleLowerCase\("vi"\)\.includes|toLowerCase\(\)\.includes\(q\)/);
  });
});

