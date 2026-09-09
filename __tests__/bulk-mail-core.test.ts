/**
 * Phần lõi của một lượt gửi hàng loạt.
 *
 * Ba tính chất được khoá ở đây, và hỏng bất kỳ cái nào là gửi sai thư cho
 * người thật: không ai nhận hai lá, không ai bị lặng lẽ bỏ qua, và không lượt
 * gửi nào đi mà thiếu bước xác nhận con số.
 */
import { describe, expect, it } from "vitest";
import {
  BULK_AUDIENCES,
  BULK_AUDIENCE_LABELS,
  BULK_SEND_CHUNK,
  BULK_TIME_BUDGET_MS,
  buildRecipientValues,
  confirmBulkSend,
  describeRunResult,
  isBulkAudience,
  partitionRecipients,
  remainingRecipients,
  rolesForAudience,
  type BulkRecipient
} from "@/lib/bulk-mail-core";
import { TEMPLATE_SPECS, renderTemplate } from "@/lib/email-templates-core";

function person(overrides: Partial<BulkRecipient> = {}): BulkRecipient {
  return {
    personId: "p1",
    fullName: "Nguyễn Văn A",
    email: "a@example.com",
    role: "mentee",
    ...overrides
  };
}

describe("đối tượng nhận thư", () => {
  it("có nhãn tiếng Việt cho cả ba", () => {
    for (const audience of BULK_AUDIENCES) {
      expect(BULK_AUDIENCE_LABELS[audience].trim()).not.toBe("");
    }
  });

  it("suy ra đúng vai trò membership", () => {
    expect(rolesForAudience("mentor")).toEqual(["mentor"]);
    expect(rolesForAudience("mentee")).toEqual(["mentee"]);
    expect(rolesForAudience("both").sort()).toEqual(["mentee", "mentor"]);
  });

  it("isBulkAudience chỉ nhận đúng ba giá trị", () => {
    expect(BULK_AUDIENCES.every(isBulkAudience)).toBe(true);
    expect(isBulkAudience("reviewer")).toBe(false);
    expect(isBulkAudience(null)).toBe(false);
  });
});

describe("partitionRecipients", () => {
  it("giữ người có đủ tên và địa chỉ", () => {
    const result = partitionRecipients([person()]);
    expect(result.sendable).toHaveLength(1);
    expect(result.unreachable).toHaveLength(0);
  });

  it("không lặng lẽ bỏ qua người thiếu địa chỉ — đưa vào danh sách nêu tên", () => {
    // "Gửi cho 180 người" mà thật ra là 174 là câu trả lời sai cho câu hỏi
    // quan trọng nhất sau một lượt gửi.
    const result = partitionRecipients([person({ email: "  " })]);
    expect(result.sendable).toHaveLength(0);
    expect(result.unreachable[0].reason).toContain("email");
    expect(result.unreachable[0].fullName).toBe("Nguyễn Văn A");
  });

  it("không gửi cho người chưa có họ tên", () => {
    // Thư mở đầu bằng "Chào ," thì thà không gửi.
    const result = partitionRecipients([person({ fullName: "   " })]);
    expect(result.sendable).toHaveLength(0);
    expect(result.unreachable[0].reason).toContain("họ tên");
  });

  it("loại địa chỉ không hợp lệ", () => {
    const result = partitionRecipients([person({ email: "khong-phai-email" })]);
    expect(result.sendable).toHaveLength(0);
    expect(result.unreachable).toHaveLength(1);
  });

  it("một địa chỉ chỉ nhận một lá dù xuất hiện hai lần", () => {
    // Một người vừa là mentor vừa là mentee của cùng một mùa là chuyện có thật,
    // và họ không nên nhận hai bản của cùng một thông báo.
    const result = partitionRecipients([
      person({ personId: "p1", role: "mentor" }),
      person({ personId: "p2", role: "mentee" })
    ]);
    expect(result.sendable).toHaveLength(1);
    expect(result.sendable[0].role).toBe("mentor");
  });

  it("coi hoa thường và khoảng trắng là cùng một địa chỉ", () => {
    const result = partitionRecipients([
      person({ email: "A@Example.com" }),
      person({ personId: "p2", email: "  a@example.com  " })
    ]);
    expect(result.sendable).toHaveLength(1);
  });

  it("chuẩn hoá địa chỉ và tên trước khi gửi", () => {
    const result = partitionRecipients([
      person({ email: "  A@Example.COM ", fullName: "  Nguyễn Văn A  " })
    ]);
    expect(result.sendable[0].email).toBe("a@example.com");
    expect(result.sendable[0].fullName).toBe("Nguyễn Văn A");
  });

  it("giữ nguyên thứ tự đưa vào", () => {
    const result = partitionRecipients([
      person({ personId: "p1", email: "b@example.com", fullName: "B" }),
      person({ personId: "p2", email: "a@example.com", fullName: "A" })
    ]);
    expect(result.sendable.map((row) => row.email)).toEqual(["b@example.com", "a@example.com"]);
  });
});

describe("remainingRecipients", () => {
  const all = [
    person({ personId: "p1", email: "a@example.com" }),
    person({ personId: "p2", email: "b@example.com" }),
    person({ personId: "p3", email: "c@example.com" })
  ];

  it("bỏ những người đã có kết quả trong lô", () => {
    expect(remainingRecipients(all, ["a@example.com"]).map((row) => row.email)).toEqual([
      "b@example.com",
      "c@example.com"
    ]);
  });

  it("so khớp không phân biệt hoa thường", () => {
    expect(remainingRecipients(all, ["A@EXAMPLE.COM"])).toHaveLength(2);
  });

  it("không bỏ ai khi lô chưa gửi lá nào", () => {
    expect(remainingRecipients(all, [])).toHaveLength(3);
  });

  it("trả về rỗng khi đã gửi hết", () => {
    const done = all.map((row) => row.email);
    expect(remainingRecipients(all, done)).toHaveLength(0);
  });
});

describe("buildRecipientValues", () => {
  it("điền đủ mọi ô mà loại thư khai báo", () => {
    const values = buildRecipientValues({
      kind: "general_announcement",
      recipient: person(),
      seasonCode: "UEHM-S12"
    });
    for (const placeholder of TEMPLATE_SPECS.general_announcement.placeholders) {
      expect(values[placeholder.key]).toBeTruthy();
    }
  });

  it("không trả về ô nào ngoài danh mục của loại thư đó", () => {
    // Nửa còn lại của lời hứa "danh mục là danh sách đóng": danh mục nói được
    // dùng ô nào, hàm này nói ô đó lấy dữ liệu ở đâu, và không đâu khác.
    const values = buildRecipientValues({
      kind: "general_announcement",
      recipient: person(),
      seasonCode: "UEHM-S12"
    });
    const allowed = TEMPLATE_SPECS.general_announcement.placeholders.map((row) => row.key);
    expect(Object.keys(values).sort()).toEqual([...allowed].sort());
  });

  it("dịch vai trò sang chữ người nhận đọc được", () => {
    expect(
      buildRecipientValues({
        kind: "general_announcement",
        recipient: person({ role: "mentor" }),
        seasonCode: "UEHM-S12"
      }).vai_tro
    ).toBe("mentor");
  });

  it("đủ để renderTemplate dựng ra một bức thư trọn vẹn", () => {
    // Hai module phải khớp nhau: thêm một ô vào danh mục mà quên chỗ lấy dữ
    // liệu thì ca này đỏ, thay vì một bức thư có chỗ trống đi tới người thật.
    const spec = TEMPLATE_SPECS.general_announcement;
    const result = renderTemplate({
      kind: "general_announcement",
      subject: "Thông báo",
      body: spec.placeholders.map((row) => `{{${row.key}}}`).join(" "),
      values: buildRecipientValues({
        kind: "general_announcement",
        recipient: person(),
        seasonCode: "UEHM-S12"
      })
    });
    expect(result.ok).toBe(true);
  });
});

describe("confirmBulkSend", () => {
  it("nhận khi gõ đúng con số", () => {
    expect(confirmBulkSend({ typed: "180", expected: 180 }).ok).toBe(true);
  });

  it("bỏ qua khoảng trắng thừa", () => {
    expect(confirmBulkSend({ typed: " 180 ", expected: 180 }).ok).toBe(true);
  });

  it("từ chối khi gõ sai số", () => {
    // Đây là bước duy nhất buộc mắt nhìn vào quy mô của việc mình đang làm.
    const result = confirmBulkSend({ typed: "18", expected: 180 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("180");
  });

  it("từ chối khi bỏ trống", () => {
    expect(confirmBulkSend({ typed: "", expected: 180 }).ok).toBe(false);
    expect(confirmBulkSend({ typed: null, expected: 180 }).ok).toBe(false);
  });

  it("từ chối chuỗi không phải số dù nó tình cờ ép kiểu ra đúng", () => {
    // Number("180.0") === 180, nhưng đó không phải thứ người ta được yêu cầu gõ.
    expect(confirmBulkSend({ typed: "180.0", expected: 180 }).ok).toBe(false);
    expect(confirmBulkSend({ typed: "+180", expected: 180 }).ok).toBe(false);
    expect(confirmBulkSend({ typed: "một trăm tám mươi", expected: 180 }).ok).toBe(false);
  });

  it("từ chối khi không có ai để gửi, kể cả khi gõ số 0", () => {
    expect(confirmBulkSend({ typed: "0", expected: 0 }).ok).toBe(false);
  });
});

describe("describeRunResult", () => {
  it("mời gửi tiếp khi còn người chưa nhận", () => {
    const text = describeRunResult({ sent: 25, failed: 0, skipped: 0, remaining: 155 });
    expect(text).toContain("25");
    expect(text).toContain("155");
    expect(text).toContain("Gửi tiếp");
  });

  it("nói rõ đã xong khi không còn ai", () => {
    const text = describeRunResult({ sent: 5, failed: 0, skipped: 0, remaining: 0 });
    expect(text).toContain("đã gửi xong");
    expect(text).not.toContain("Gửi tiếp");
  });

  it("nêu số lỗi và số bị chặn khi có", () => {
    const text = describeRunResult({ sent: 3, failed: 2, skipped: 1, remaining: 0 });
    expect(text).toContain("2 thư lỗi");
    expect(text).toContain("1 thư bị cấu hình chặn");
  });

  it("không nhắc tới lỗi khi không có lỗi nào", () => {
    const text = describeRunResult({ sent: 3, failed: 0, skipped: 0, remaining: 0 });
    expect(text).not.toContain("lỗi");
  });
});

describe("giới hạn một lần chạy", () => {
  it("ngân sách thời gian ngắn hơn trần 60 giây của route", () => {
    // Bị cắt giữa chừng nghĩa là dòng ghi sổ của bức thư cuối không kịp viết,
    // và bức thư đó biến mất khỏi mọi câu trả lời cho "đã gửi cho ai".
    expect(BULK_TIME_BUDGET_MS).toBeLessThan(60_000);
  });

  it("mỗi lần chạy gửi một số lượng vừa phải", () => {
    expect(BULK_SEND_CHUNK).toBeGreaterThan(0);
    expect(BULK_SEND_CHUNK).toBeLessThanOrEqual(50);
  });
});
