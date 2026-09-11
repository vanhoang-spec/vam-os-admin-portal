/**
 * Lý do database từ chối một lần giao hồ sơ — nói đúng, và không bỏ sót câu nào.
 *
 * Phần canh gác đọc chính định nghĩa MỚI NHẤT của hai hàm giao trong
 * `supabase/migrations/`: mỗi câu `raise exception` phải hoặc có một câu tiếng
 * Việt, hoặc được ghi rõ là lỗi hệ thống (thứ ứng dụng đã chặn trước khi gọi). Một
 * migration sau thêm hay đổi một câu mà quên ở đây thì test đỏ — thay vì người
 * vận hành lại thấy "Không thể thực hiện thao tác".
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { WITHDRAWN_APPLICATION_REVIEW_MESSAGE } from "@/lib/application-review-assignability";
import {
  ASSIGNMENT_REFUSAL_RULES,
  ASSIGNMENT_SAFE_ERROR,
  describeAssignmentRefusal
} from "@/lib/review-assignment-refusals";

const MIGRATIONS = join(__dirname, "..", "supabase", "migrations");

/** Thân của định nghĩa MỚI NHẤT (theo tên file) của một hàm. */
function latestFunctionBody(name: string): { file: string; body: string } {
  const header = new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${name}\\s*\\(`, "i");
  let found: { file: string; body: string } | null = null;
  for (const file of readdirSync(MIGRATIONS).filter((entry) => entry.endsWith(".sql")).sort()) {
    const sql = readFileSync(join(MIGRATIONS, file), "utf8");
    const match = header.exec(sql);
    if (!match) continue;
    const rest = sql.slice(match.index);
    const end = rest.search(/\$(fn|function)\$\s*;/);
    found = { file, body: end > 0 ? rest.slice(0, end) : rest };
  }
  if (!found) throw new Error(`không thấy định nghĩa ${name}`);
  return found;
}

const raisedMessages = (body: string) =>
  Array.from(body.matchAll(/raise\s+exception\s+'([^']*)'/gi)).map((match) => match[1]);

/** Ứng dụng đã kiểm những điều này trước khi gọi, nên gặp chúng là lỗi hệ thống thật. */
const SYSTEM_ONLY: Record<string, string[]> = {
  vam094_assign_selected_application_reviews: [
    "Trusted server context required",
    "Invalid review round",
    "Application IDs must not be empty",
    "Application IDs must be unique"
  ],
  vam090_bulk_assign_application_reviews: [
    "Trusted server context required",
    "Intake batch is required",
    "Invalid review round",
    "Invalid applied role",
    "Assignment filters and reviewers must be non-empty and unique",
    "Assignment status filter is invalid for the review round"
  ]
};

describe("canh gác: mọi câu database raise đều đã được phân loại", () => {
  for (const name of Object.keys(SYSTEM_ONLY)) {
    const { file, body } = latestFunctionBody(name);
    const raised = raisedMessages(body);

    it(`${name} (${file}): đọc được các câu raise`, () => {
      // Bộ đọc hỏng thì mọi khẳng định dưới đây xanh vô nghĩa.
      expect(raised.length).toBeGreaterThan(3);
    });

    it(`${name}: câu nào không phải lỗi hệ thống thì có lời tiếng Việt riêng`, () => {
      const unclassified = raised.filter(
        (message) =>
          !SYSTEM_ONLY[name].includes(message) &&
          describeAssignmentRefusal(message, "profile_screening").message === ASSIGNMENT_SAFE_ERROR
      );
      expect(unclassified).toEqual([]);
    });

    it(`${name}: danh sách lỗi hệ thống không mang câu đã không còn trong hàm`, () => {
      for (const message of SYSTEM_ONLY[name]) expect(raised, message).toContain(message);
    });
  }

  it("mỗi câu được dịch vẫn còn nằm trong một trong hai hàm", () => {
    const bodies = Object.keys(SYSTEM_ONLY).map((name) => latestFunctionBody(name).body).join("\n");
    for (const rule of ASSIGNMENT_REFUSAL_RULES) expect(bodies, rule.match).toContain(`'${rule.match}'`);
  });

  it("không câu nào là chuỗi con của câu khác, nên thứ tự luật không đổi kết quả", () => {
    for (const rule of ASSIGNMENT_REFUSAL_RULES) {
      for (const other of ASSIGNMENT_REFUSAL_RULES) {
        if (rule !== other) expect(other.match.includes(rule.match), `${rule.match} ⊂ ${other.match}`).toBe(false);
      }
    }
  });
});

describe("lời báo", () => {
  const ALREADY = "One or more applications are already assigned for this round";

  it("hồ sơ đã có người giao: nói rõ, và bảo màn hình tải lại danh sách", () => {
    const refusal = describeAssignmentRefusal({ code: "P0001", message: ALREADY }, "profile_screening");
    expect(refusal.refreshList).toBe(true);
    expect(refusal.message).toContain("đã được giao chấm hồ sơ trước đó");
    expect(refusal.message).toContain("Danh sách đã được tải lại.");
  });

  it("nói đúng việc theo vòng", () => {
    expect(describeAssignmentRefusal(ALREADY, "interview").message).toContain("đã được giao phỏng vấn trước đó");
  });

  it("người chấm chưa đủ điều kiện: chỉ chỗ kiểm quyền", () => {
    const refusal = describeAssignmentRefusal(
      "Target assignee is not an active participant for this season and stage",
      "profile_screening"
    );
    expect(refusal.message).toContain("chưa đủ điều kiện chấm hồ sơ");
    expect(refusal.message).toContain("Danh sách nhân sự tuyển sinh");
    expect(refusal.refreshList).toBe(true);
  });

  it("không có quyền mùa: nói thẳng, không tải lại gì", () => {
    expect(describeAssignmentRefusal("Assignment batch scope denied", "profile_screening")).toEqual({
      message: "Bạn không có quyền vận hành mùa của các hồ sơ này.",
      refreshList: false
    });
  });

  it("hồ sơ đã rút: giữ đúng lời báo đã có", () => {
    const refusal = describeAssignmentRefusal("APPLICATION_WITHDRAWN", "profile_screening");
    expect(refusal.message.startsWith(WITHDRAWN_APPLICATION_REVIEW_MESSAGE)).toBe(true);
    expect(refusal.refreshList).toBe(true);
  });

  it("câu lạ, rỗng, hay null: câu chung, không tải lại, và KHÔNG lộ nguyên văn", () => {
    const raw = 'relation "public.application_reviews" violates check constraint x';
    expect(describeAssignmentRefusal({ message: raw }, "profile_screening")).toEqual({
      message: ASSIGNMENT_SAFE_ERROR,
      refreshList: false
    });
    expect(describeAssignmentRefusal(null, "profile_screening").message).toBe(ASSIGNMENT_SAFE_ERROR);
    expect(describeAssignmentRefusal("", "interview").message).toBe(ASSIGNMENT_SAFE_ERROR);
  });

  it("không lời báo nào chép lại câu tiếng Anh của database", () => {
    for (const rule of ASSIGNMENT_REFUSAL_RULES) {
      const message = describeAssignmentRefusal(rule.match, "profile_screening").message;
      expect(message).not.toBe(ASSIGNMENT_SAFE_ERROR);
      expect(message).not.toContain(rule.match);
    }
  });
});
