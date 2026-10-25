/**
 * Đối chiếu form với danh sách mentee/mentor chính thức (Support team 25/10/2026) — phần thuần.
 *
 * Báo nhầm "đã nộp" là Support team bỏ sót người cần nhắc; báo nhầm "chưa nộp" là nhắc người đã
 * nộp. Mỗi ca dưới đây là một cách khớp sai có thật trên dữ liệu S12: email khác email hồ sơ, gõ sai
 * tên một chữ, mentor nộp form mentee, hai bạn trùng tên.
 */
import { describe, expect, it } from "vitest";
import {
  checkFormAgainstRoster,
  nameField,
  normalizeMatchPhone,
  submissionIdentity,
  type FormSubmission,
  type RosterPerson
} from "@/lib/form-roster-check-core";
import type { CustomFormField } from "@/lib/custom-form-core";

const field = (id: string, type: CustomFormField["type"], label: string, extra: Partial<CustomFormField> = {}): CustomFormField =>
  ({ id, type, label, help: "", required: true, hidden: false, options: [], ...extra }) as CustomFormField;

const person = (personId: string, name: string, emails: string[], phones: string[] = [], roles: RosterPerson["roles"] = ["mentee"]): RosterPerson => ({
  personId,
  name,
  emails,
  phones,
  roles
});
const sub = (responseId: string, name: string, emails: string[] = [], phones: string[] = [], createdAt = `2026-10-25T0${responseId.length % 9}:00:00Z`): FormSubmission => ({
  responseId,
  createdAt,
  name,
  emails,
  phones
});

const ROSTER = [
  person("p-an", "Nguyễn Văn An", ["an@st.ueh.edu.vn", "an.app@gmail.com"], ["0912345678"]),
  person("p-binh", "Trần Thị Bình", ["binh@gmail.com"], ["0987654321"]),
  person("p-vy", "Trần Lương Yến Vy", ["vy@gmail.com"], []),
  person("p-tuan1", "Lê Minh Tuấn", ["tuan1@gmail.com"]),
  person("p-tuan2", "Lê Minh Tuấn", ["tuan2@gmail.com"]),
  person("p-cuong", "Phạm Cường", ["cuong@gmail.com"]),
  person("m-loan", "Đặng Phạm Minh Loan", ["loan@yahoo.com"], ["0901111222"], ["mentor"]),
  person("both", "Vừa Mentor Vừa Mentee", ["both@gmail.com"], [], ["mentor", "mentee"])
];

const run = (submissions: FormSubmission[], role: "mentee" | "mentor" = "mentee") => checkFormAgainstRoster({ role, people: ROSTER, submissions });
const ids = (list: Array<{ personId: string }>) => list.map((p) => p.personId).sort();

describe("1. khớp người nộp với danh sách", () => {
  it("email trong hồ sơ, email trên đơn mùa đó, SĐT có +84 và dấu cách — đều tính là đã nộp", () => {
    const r = run([
      sub("r1", "An", ["AN.APP@gmail.com"]),
      sub("r2", "Bình", [], ["+84 987 654 321"])
    ]);
    expect(ids(r.submitted.map((e) => e.person))).toEqual(["p-an", "p-binh"]);
    expect(r.submitted.find((e) => e.person.personId === "p-an")!.matchedBy).toBe("email");
    expect(r.submitted.find((e) => e.person.personId === "p-binh")!.matchedBy).toBe("phone");
  });

  it("không khớp email/SĐT mà họ tên (bỏ dấu, hoa thường) khớp đúng MỘT người → đã nộp, cờ 'cần xem lại'", () => {
    const r = run([sub("r1", "tran luong YEN vy", ["khac@st.ueh.edu.vn"])]);
    expect(r.submitted.map((e) => [e.person.personId, e.matchedBy])).toEqual([["p-vy", "name"]]);
  });

  it("hai người trùng họ tên → KHÔNG đoán: người nộp vào 'ngoài danh sách' kèm ghi chú, cả hai vẫn 'chưa nộp'", () => {
    const r = run([sub("r1", "Lê Minh Tuấn", ["la@gmail.com"])]);
    expect(r.submitted).toEqual([]);
    expect(r.outsiders).toHaveLength(1);
    expect(r.outsiders[0].note).toContain("Trùng họ tên với 2 người");
    expect(ids(r.notSubmitted)).toContain("p-tuan1");
    expect(ids(r.notSubmitted)).toContain("p-tuan2");
  });

  it("email đúng nhưng tên gõ khác → vẫn khớp theo email (email đứng trước tên)", () => {
    const r = run([sub("r1", "Trầm Lương Yến Vy", ["vy@gmail.com"])]);
    expect(r.submitted.map((e) => [e.person.personId, e.matchedBy])).toEqual([["p-vy", "email"]]);
  });

  it("email trùng một mentor khi đối chiếu mentee → ngoài danh sách, ghi rõ là mentor; không tính là đã nộp", () => {
    const r = run([sub("r1", "loan", ["loan@yahoo.com"])]);
    expect(r.submitted).toEqual([]);
    expect(r.outsiders[0].note).toBe("Email/SĐT trùng mentor Đặng Phạm Minh Loan — không phải mentee");
  });

  it("đổi sang đối chiếu mentor: chính người đó thành 'đã nộp', mentee thành 'ngoài danh sách'", () => {
    const r = run([sub("r1", "loan", ["loan@yahoo.com"]), sub("r2", "An", ["an@st.ueh.edu.vn"])], "mentor");
    expect(ids(r.submitted.map((e) => e.person))).toEqual(["m-loan"]);
    expect(r.outsiders.map((o) => o.note)).toEqual(["Email/SĐT trùng mentee Nguyễn Văn An — không phải mentor"]);
    expect(r.rosterSize).toBe(2);
  });

  it("người vừa là mentor vừa là mentee có trong cả hai danh sách", () => {
    expect(run([], "mentee").rosterSize).toBe(7);
    expect(ids(run([], "mentor").notSubmitted)).toEqual(["both", "m-loan"]);
  });

  it("không khớp gì → ngoài danh sách, ghi chú trống", () => {
    const r = run([sub("r1", "Người Lạ", ["la@gmail.com"], ["0900000000"])]);
    expect(r.outsiders.map((o) => o.note)).toEqual([""]);
  });

  it("form không có ô tên, không có email/SĐT → ngoài danh sách, không khớp tên rỗng với ai", () => {
    const r = run([sub("r1", "", [], [])]);
    expect(r.submitted).toEqual([]);
    expect(r.outsiders).toHaveLength(1);
  });
});

describe("2. đếm và xếp", () => {
  it("một người nộp ba lần → một dòng 'đã nộp', 3 lần, mới nhất trước, cách khớp tin cậy nhất", () => {
    const r = run([
      sub("a", "Nguyễn Văn An", ["khac@gmail.com"], [], "2026-10-25T01:00:00Z"),
      sub("b", "x", [], ["0912345678"], "2026-10-25T03:00:00Z"),
      sub("c", "x", ["an@st.ueh.edu.vn"], [], "2026-10-25T02:00:00Z")
    ]);
    expect(r.submitted).toHaveLength(1);
    expect(r.submitted[0].submissions.map((s) => s.responseId)).toEqual(["b", "c", "a"]);
    expect(r.submitted[0].matchedBy).toBe("email");
  });

  it("đã nộp + chưa nộp = đúng cỡ danh sách; chưa nộp xếp theo tên", () => {
    const r = run([sub("r1", "", ["binh@gmail.com"])]);
    expect(r.submitted.length + r.notSubmitted.length).toBe(r.rosterSize);
    expect(r.notSubmitted.map((p) => p.name)).toEqual([...r.notSubmitted.map((p) => p.name)].sort((a, b) => a.localeCompare(b, "vi")));
  });
});

describe("3. đọc danh tính từ câu trả lời", () => {
  const FIELDS = [
    field("f_note", "short_text", "Lớp"),
    field("f_name", "short_text", "Họ và tên"),
    field("f_mail", "email", "Email"),
    field("f_mail2", "email", "Email phụ", { required: false, hidden: true }),
    field("f_tel", "phone", "Số điện thoại")
  ];

  it("ô tên là ô chữ ngắn có nhãn 'Họ và tên', không phải ô chữ ngắn đầu tiên", () => {
    expect(nameField(FIELDS)?.id).toBe("f_name");
    expect(nameField([field("x", "short_text", "Lớp")])?.id).toBe("x");
    expect(nameField([field("x", "email", "Email")])).toBeNull();
  });

  it("lấy mọi email (kể cả câu đang ẩn), chuẩn hoá; SĐT chuẩn hoá; bỏ trống", () => {
    const s = submissionIdentity(FIELDS, {
      id: "r1",
      createdAt: "2026-10-25T00:00:00Z",
      answers: { f_note: "K49", f_name: " Nguyễn Văn An ", f_mail: " An@Gmail.com ", f_mail2: "an2@gmail.com", f_tel: "84 912.345.678" }
    });
    expect(s).toEqual({ responseId: "r1", createdAt: "2026-10-25T00:00:00Z", name: "Nguyễn Văn An", emails: ["an@gmail.com", "an2@gmail.com"], phones: ["0912345678"] });
  });

  it("SĐT quá ngắn không dùng để khớp", () => {
    expect(normalizeMatchPhone("12345")).toBe("");
    expect(normalizeMatchPhone("0912 345 678")).toBe("0912345678");
  });
});
