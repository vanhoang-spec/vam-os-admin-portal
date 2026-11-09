/**
 * Email ngoài VAM cho Danh sách tùy chỉnh (VAM00027) — phần thuần.
 *
 * Mỗi ca canh một cách gửi nhầm mà không ai thấy:
 *   - email sai vẫn lọt vào lô, hoặc bị bỏ đi mà không báo;
 *   - một email nhận hai lá (trùng trong danh sách ngoài, hay trùng người lấy từ VAM);
 *   - người ngoài mang tên/mã/xưng hô của ai đó, hoặc tên chèn được link vào thư;
 *   - một khoá `external:` không có trong chữ đã xem trước lọt qua bước gửi;
 *   - vượt trần người ngoài một lô, hay vượt hạn mức chung 24 giờ.
 *
 * Phân loại: DIRECT PRODUCTION TESTS — gọi thẳng lib/bulk-mail-external-core và lib/bulk-mail-custom-core.
 */
import { describe, expect, it } from "vitest";
import { BULK_SEND_CHUNK, buildRecipientValues, type BulkRecipient } from "@/lib/bulk-mail-core";
import {
  BULK_CUSTOM_QUOTA_RESERVE,
  EXTERNAL_FILE_MAX_ROWS,
  EXTERNAL_MAX_PER_BATCH,
  appendExternalRecipients,
  cleanExternalName,
  customRunAllowance,
  externalEmailAddress,
  externalEntriesToText,
  namelessExternals,
  outboundRelationFor,
  parseExternalRecipientTable,
  parseExternalRecipientText,
  templateUsesRecipientName,
  withExternalLabel
} from "@/lib/bulk-mail-external-core";
import {
  customListSignature,
  readCustomListSpec,
  recipientKey,
  selectCustomRecipients,
  type CustomListSpec
} from "@/lib/bulk-mail-custom-core";
import { DAILY_EMAIL_LIMIT } from "@/lib/email-quota-core";

const u = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function ok<T extends { ok: boolean }>(result: T): Extract<T, { ok: true }> {
  if (!result.ok) throw new Error(`mong ok, được: ${JSON.stringify(result)}`);
  return result as Extract<T, { ok: true }>;
}

describe("định dạng email ngoài VAM", () => {
  it.each([
    ["khach@congty.vn", "khach@congty.vn"],
    ["  Khach.Moi+vam@Truong.Edu.VN ", "khach.moi+vam@truong.edu.vn"],
    ["mailto:ban@x-y.org", "ban@x-y.org"]
  ])("nhận %s", (input, expected) => {
    expect(externalEmailAddress(input)).toBe(expected);
  });

  it.each([
    "khach@congty",
    "khach@congty,vn",
    "khach@@congty.vn",
    "khach@cong ty.vn",
    "khach..moi@congty.vn",
    ".khach@congty.vn",
    "khach@-congty.vn",
    "khach@congty.v",
    "khach@congty.123",
    "@congty.vn",
    "khach@",
    "khách@congty.vn",
    "a@b.c\nBcc: x@y.vn"
  ])("từ chối %j", (input) => {
    expect(externalEmailAddress(input)).toBeNull();
  });
});

describe("ô gõ tay", () => {
  it("đọc ba kiểu dòng, kèm tên; dòng dán từ Excel bỏ STT và số điện thoại", () => {
    const parsed = ok(
      parseExternalRecipientText(
        ["khach@congty.vn", "ban@truong.edu.vn, Trần Thị Bình", "Lê Văn Cường <cuong@x.org>", "7\tdung@y.vn\t0901234567\tPhạm Dung"].join("\n")
      )
    );
    expect(parsed.entries).toEqual([
      { email: "khach@congty.vn", name: "" },
      { email: "ban@truong.edu.vn", name: "Trần Thị Bình" },
      { email: "cuong@x.org", name: "Lê Văn Cường" },
      { email: "dung@y.vn", name: "Phạm Dung" }
    ]);
    expect(parsed.invalidCount).toBe(0);
  });

  it("một dòng nhiều email (dán từ Outlook): mỗi email một người, không đoán tên", () => {
    const parsed = ok(parseExternalRecipientText("a@x.vn; b@y.vn, Tên Lạc"));
    expect(parsed.entries).toEqual([
      { email: "a@x.vn", name: "" },
      { email: "b@y.vn", name: "" }
    ]);
  });

  it("email sai được BÁO theo số dòng và không vào danh sách", () => {
    const parsed = ok(parseExternalRecipientText(["dung@x.vn", "sai@congty", "chỉ có tên thôi", "", "tot@y.org"].join("\n")));
    expect(parsed.entries.map((entry) => entry.email)).toEqual(["dung@x.vn", "tot@y.org"]);
    expect(parsed.invalidCount).toBe(2);
    expect(parsed.problems).toEqual([
      "Dòng 2: “sai@congty” không phải email hợp lệ",
      "Dòng 3: không thấy địa chỉ email (“chỉ có tên thôi”)"
    ]);
  });

  it("trùng email trong danh sách (khác hoa thường) chỉ giữ một, đếm số trùng, bổ sung tên nếu lần đầu trống", () => {
    const parsed = ok(parseExternalRecipientText(["Khach@CongTy.vn", "khach@congty.vn, Nguyễn An", "khach@congty.vn, Tên Khác"].join("\n")));
    expect(parsed.entries).toEqual([{ email: "khach@congty.vn", name: "Nguyễn An" }]);
    expect(parsed.duplicates).toBe(2);
  });

  it("tên có link, ô điền hay ký tự điều khiển: bỏ tên chứ không bỏ người, và báo ra", () => {
    const parsed = ok(parseExternalRecipientText(["a@x.vn, Bấm http://lua.dao/x", "b@x.vn, {{ma_thanh_vien}}", "c@x.vn, www.lua.vn"].join("\n")));
    expect(parsed.entries.map((entry) => entry.name)).toEqual(["", "", ""]);
    expect(parsed.problems).toHaveLength(3);
    expect(parsed.invalidCount).toBe(0);
    expect(cleanExternalName(`An${String.fromCharCode(13)}Bcc: x`).name).toBe("An Bcc: x");
    expect(cleanExternalName("x".repeat(300)).name).toHaveLength(120);
  });

  it(`quá ${EXTERNAL_MAX_PER_BATCH} email ngoài một lô thì từ chối cả danh sách, không cắt bớt`, () => {
    const lines = Array.from({ length: EXTERNAL_MAX_PER_BATCH + 1 }, (_, index) => `k${index}@x.vn`);
    const parsed = parseExternalRecipientText(lines.join("\n"));
    expect(parsed.ok).toBe(false);
    expect(ok(parseExternalRecipientText(lines.slice(0, EXTERNAL_MAX_PER_BATCH).join("\n"))).entries).toHaveLength(EXTERNAL_MAX_PER_BATCH);
  });

  it("chữ rỗng là danh sách rỗng", () => {
    expect(ok(parseExternalRecipientText("  \n ")).entries).toEqual([]);
    expect(ok(parseExternalRecipientText(null)).entries).toEqual([]);
  });
});

describe("bảng từ file Excel", () => {
  const table = (rows: Array<[number, ...string[]]>) => rows.map((row) => row.join("\t")).join("\n");

  it("dòng tiêu đề Email / Họ và tên ở cột bất kỳ; lỗi báo theo SỐ DÒNG EXCEL", () => {
    const parsed = ok(
      parseExternalRecipientTable(
        table([
          [3, "STT", "Họ và tên", "Số điện thoại", "E-mail"],
          [4, "1", "Nguyễn An", "0901", "an@x.vn"],
          [5, "2", "", "0902", "binh@y.org"],
          [7, "3", "Cường", "0903", "cuong@sai"],
          [8, "4", "Dũng", "0904", ""],
          [9, "5", "Em", "", "a@x.vn; b@x.vn"]
        ])
      )
    );
    expect(parsed.entries).toEqual([
      { email: "an@x.vn", name: "Nguyễn An" },
      { email: "binh@y.org", name: "" }
    ]);
    expect(parsed.invalidCount).toBe(3);
    expect(parsed.problems[0]).toBe("Dòng 7: “cuong@sai” không phải email hợp lệ");
    expect(parsed.problems[1]).toBe("Dòng 8: không có email");
    expect(parsed.problems[2]).toMatch(/^Dòng 9: một ô có nhiều địa chỉ/);
  });

  it("“Họ tên” thắng “Tên” khi có cả hai cột", () => {
    const parsed = ok(parseExternalRecipientTable(table([[1, "Tên", "Email", "Họ tên"], [2, "An", "an@x.vn", "Nguyễn Văn An"]])));
    expect(parsed.entries).toEqual([{ email: "an@x.vn", name: "Nguyễn Văn An" }]);
  });

  it("không có tiêu đề: lấy ô đầu có @, tên để trống (không đoán cột tên)", () => {
    const parsed = ok(parseExternalRecipientTable(table([[1, "Nguyễn An", "an@x.vn"], [2, "Bình", "binh@x.vn"]])));
    expect(parsed.entries).toEqual([
      { email: "an@x.vn", name: "" },
      { email: "binh@x.vn", name: "" }
    ]);
  });

  it(`quá ${EXTERNAL_FILE_MAX_ROWS} dòng dữ liệu thì từ chối cả file`, () => {
    const rows: Array<[number, ...string[]]> = [[1, "Email"]];
    // Cùng một email lặp lại: số người ngoài dưới trần một lô, nên chỉ trần số dòng mới chặn được.
    for (let index = 0; index <= EXTERNAL_FILE_MAX_ROWS; index++) rows.push([index + 2, "lap@x.vn"]);
    const parsed = parseExternalRecipientTable(table(rows));
    expect(parsed.ok).toBe(false);
    expect(!parsed.ok && parsed.message).toMatch(/tối đa 2000 dòng/);
    expect(parseExternalRecipientTable(table(rows.slice(0, EXTERNAL_FILE_MAX_ROWS + 1))).ok).toBe(true);
  });

  it("file không có dòng dữ liệu nào thì báo, không trả danh sách rỗng như thể đã đọc được", () => {
    expect(parseExternalRecipientTable("").ok).toBe(false);
  });

  it("viết lại thành chữ của ô gõ tay rồi đọc lại ra đúng danh sách đó", () => {
    const entries = [
      { email: "an@x.vn", name: "Nguyễn An" },
      { email: "binh@y.org", name: "" }
    ];
    expect(ok(parseExternalRecipientText(externalEntriesToText(entries))).entries).toEqual(entries);
  });
});

describe("gộp với người lấy từ VAM", () => {
  const vam: BulkRecipient[] = [
    { personId: u(1), fullName: "An Mentor", email: "an@x.org", role: "mentor", relationTable: "people", memberCode: "UEHR0001", gender: "male" }
  ];

  it("người VAM đứng trước và thắng khi trùng email; người ngoài là khách mời, không có id, không có mã", () => {
    const merged = appendExternalRecipients({ sendable: vam, unreachable: [] }, [
      { email: "an@x.org", name: "Tên Trong Excel" },
      { email: "khach@y.vn", name: "Khách" }
    ]);
    expect(merged.overlap).toBe(1);
    expect(merged.added).toBe(1);
    expect(merged.partition.sendable).toEqual([
      vam[0],
      { personId: "", fullName: "Khách", email: "khach@y.vn", role: "external", relationTable: "external" }
    ]);
  });

  it("ô điền của người ngoài: tên từ danh sách, vai trò “khách mời”, mã và xưng hô TRỐNG", () => {
    const values = buildRecipientValues({
      kind: "general_announcement",
      recipient: { personId: u(9), fullName: "Khách", email: "khach@y.vn", role: "external", relationTable: "external" },
      seasonCode: "UEHM-S12"
    });
    expect(values).toEqual({ ten_nguoi_nhan: "Khách", mua: "UEHM-S12", vai_tro: "khách mời", ma_thanh_vien: "", xung_ho: "" });
  });

  it("khoá của người ngoài là email; khoá không có trong danh sách đọc lại thì cả lượt bị từ chối", () => {
    const universe = appendExternalRecipients({ sendable: vam, unreachable: [] }, [{ email: "khach@y.vn", name: "" }]).partition.sendable;
    expect(recipientKey(universe[1])).toBe("external:khach@y.vn");
    expect(ok(selectCustomRecipients(universe, [`people:${u(1)}`, "external:khach@y.vn"])).rows).toHaveLength(2);
    expect(selectCustomRecipients(universe, ["external:la@z.vn"]).ok).toBe(false);
    expect(selectCustomRecipients(universe, ["external:KHACH@y.vn"]).ok).toBe(false);
    expect(selectCustomRecipients(universe, ["external:"]).ok).toBe(false);
    // Một email gửi kèm khoá `people:` không biến người đó thành người khác.
    expect(selectCustomRecipients(universe, ["people:khach@y.vn"]).ok).toBe(false);
  });

  it("người ngoài trống tên được đếm; mẫu thư có ô tên thì biết", () => {
    const rows = appendExternalRecipients({ sendable: vam, unreachable: [] }, [
      { email: "a@y.vn", name: "" },
      { email: "b@y.vn", name: "Bình" }
    ]).partition.sendable;
    expect(namelessExternals(rows).map((row) => row.email)).toEqual(["a@y.vn"]);
    expect(templateUsesRecipientName("Thông báo", "Chào {{ten_nguoi_nhan}},")).toBe(true);
    expect(templateUsesRecipientName("Gửi {{ten_nguoi_nhan}}", "")).toBe(true);
    expect(templateUsesRecipientName("Thông báo {{mua}}", "Chào bạn,")).toBe(false);
  });

  it("sổ thư của người ngoài nối về dòng chốt, của người VAM nối về bảng nguồn như cũ", () => {
    expect(outboundRelationFor({ relationTable: "external", personId: u(77) })).toEqual({ table: "email_batch_recipients", id: u(77) });
    expect(outboundRelationFor({ relationTable: "event_registrations", personId: u(5) })).toEqual({ table: "event_registrations", id: u(5) });
    expect(outboundRelationFor({ personId: u(6) })).toEqual({ table: "people", id: u(6) });
  });

  it("nhãn lô nói rõ phần người ngoài", () => {
    expect(withExternalLabel("Danh sách tùy chỉnh: mentor", 3)).toBe("Danh sách tùy chỉnh: mentor + 3 email ngoài VAM");
    expect(withExternalLabel("Danh sách tùy chỉnh", 3)).toBe("Danh sách tùy chỉnh: 3 email ngoài VAM");
    expect(withExternalLabel("Danh sách tùy chỉnh: mentor", 0)).toBe("Danh sách tùy chỉnh: mentor");
  });
});

describe("nguồn và dấu vân tay của bản xem trước", () => {
  const form = (fields: Record<string, string>) => {
    const data = new FormData();
    for (const [key, value] of Object.entries(fields)) data.append(key, value);
    return data;
  };

  it("chỉ có email ngoài VAM cũng là một danh sách hợp lệ; trống hết thì vẫn từ chối", () => {
    expect(readCustomListSpec(form({ external_recipients: "khach@y.vn" })).ok).toBe(true);
    expect(readCustomListSpec(form({ external_recipients: "   " })).ok).toBe(false);
  });

  it("đổi chữ ô người ngoài là đổi dấu vân tay; không có người ngoài thì dấu vân tay như cũ", () => {
    const spec: CustomListSpec = { mentor: true, mentee: false, staff: false, event: null, addedPersonIds: [] };
    expect(customListSignature(spec, "")).toBe(customListSignature(spec));
    expect(customListSignature(spec, "a@x.vn")).not.toBe(customListSignature(spec));
    expect(customListSignature(spec, "a@x.vn")).not.toBe(customListSignature(spec, "b@x.vn"));
  });
});

describe("hạn mức chung 24 giờ cho lô Danh sách tùy chỉnh", () => {
  it("không quá một lượt, không ăn vào phần chừa, không âm", () => {
    expect(customRunAllowance(0)).toBe(BULK_SEND_CHUNK);
    expect(customRunAllowance(DAILY_EMAIL_LIMIT - BULK_CUSTOM_QUOTA_RESERVE - 3)).toBe(3);
    expect(customRunAllowance(DAILY_EMAIL_LIMIT - BULK_CUSTOM_QUOTA_RESERVE)).toBe(0);
    expect(customRunAllowance(DAILY_EMAIL_LIMIT + 50)).toBe(0);
    expect(customRunAllowance(Number.NaN)).toBe(BULK_SEND_CHUNK);
  });
});
