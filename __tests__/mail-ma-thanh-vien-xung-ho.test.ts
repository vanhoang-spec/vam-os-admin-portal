/**
 * VAM00024 — hai ô điền mới cho Mail: {{ma_thanh_vien}} và {{xung_ho}}.
 *
 * Khác ba ô cũ ở một điểm: hai ô này được phép rỗng. Mentee không có "Anh/Chị",
 * BTC không có mã thành viên — rỗng thì điền chuỗi rỗng và gộp khoảng trắng thừa,
 * thay vì chặn cả bức thư. Ba ô cũ vẫn chặn như trước, và một mẫu thư đã lưu
 * không dùng ô mới phải ra đúng từng byte như trước.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({ getSupabaseServiceRoleClient: vi.fn() }));
vi.mock("@/lib/email", () => ({ sendTemplatedEmail: vi.fn() }));

import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import { sendTemplatedEmail } from "@/lib/email";
import { listBulkRecipients, runEmailBatch, type EmailBatchRow } from "@/lib/bulk-mail";
import {
  buildRecipientValues,
  formOfAddressForGender,
  partitionRecipients,
  type BulkRecipient
} from "@/lib/bulk-mail-core";
import {
  TEMPLATE_SPECS,
  renderTemplate,
  sampleValues,
  validateTemplate
} from "@/lib/email-templates-core";
import { HELP_GUIDES } from "@/lib/help-guides";

function recipient(overrides: Partial<BulkRecipient> = {}): BulkRecipient {
  return { personId: "p1", fullName: "Nguyễn Thị B", email: "b@example.com", role: "mentor", ...overrides };
}

function valuesFor(overrides: Partial<BulkRecipient> = {}) {
  return buildRecipientValues({ kind: "general_announcement", recipient: recipient(overrides), seasonCode: "UEHM-S12" });
}

function render(subject: string, body: string, values: Record<string, string>) {
  return renderTemplate({ kind: "general_announcement", subject, body, values });
}

describe("tên và cú pháp của hai ô mới theo đúng quy ước ô cũ", () => {
  it("là snake_case tiếng Việt không dấu, đứng sau ba ô cũ, ba ô cũ không đổi", () => {
    const keys = TEMPLATE_SPECS.general_announcement.placeholders.map((row) => row.key);
    expect(keys).toEqual(["ten_nguoi_nhan", "mua", "vai_tro", "ma_thanh_vien", "xung_ho"]);
  });

  it("chỉ hai ô mới được phép rỗng", () => {
    const blankable = TEMPLATE_SPECS.general_announcement.placeholders
      .filter((row) => row.emptyAllowed)
      .map((row) => row.key);
    expect(blankable).toEqual(["ma_thanh_vien", "xung_ho"]);
  });

  it("mẫu thư dùng hai ô mới lưu được, không bị coi là ô lạ", () => {
    const check = validateTemplate({
      kind: "general_announcement",
      name: "Thư mentor",
      subject: "{{mua}} — {{ma_thanh_vien}}",
      body: "Kính gửi {{xung_ho}} {{ten_nguoi_nhan}},"
    });
    expect(check.ok).toBe(true);
    if (check.ok) expect(check.warnings).toEqual([]);
  });

  it("có giá trị mẫu cho xem trước và gửi thử", () => {
    const sample = sampleValues("general_announcement");
    expect(sample.ma_thanh_vien).toBe("UEHR0012");
    expect(sample.xung_ho).toBe("Anh");
    const preview = render("{{ma_thanh_vien}}", "Kính gửi {{xung_ho}} {{ten_nguoi_nhan}},", sample);
    expect(preview).toEqual({ ok: true, subject: "UEHR0012", body: "Kính gửi Anh Nguyễn Văn A," });
  });
});

describe("xưng hô theo giới tính", () => {
  it.each([
    ["female", "Chị"],
    ["FEMALE", "Chị"],
    ["  Female ", "Chị"],
    ["Nữ", "Chị"],
    ["Nữ".normalize("NFD"), "Chị"],
    ["male", "Anh"],
    [" MALE", "Anh"],
    ["Nam", "Anh"]
  ])("%j là %s", (gender, expected) => {
    expect(formOfAddressForGender(gender)).toBe(expected);
  });

  it.each([["other"], ["undisclosed"], [""], ["   "], ["f"], ["femalee"], ["nam nữ"]])(
    "%j không đoán, để trống",
    (gender) => {
      expect(formOfAddressForGender(gender)).toBe("");
    }
  );

  it("null hay undefined cũng để trống", () => {
    expect(formOfAddressForGender(null)).toBe("");
    expect(formOfAddressForGender(undefined)).toBe("");
  });
});

describe("giá trị điền cho từng người nhận", () => {
  it("mentor nữ là Chị, mentor nam là Anh", () => {
    expect(valuesFor({ gender: "female" }).xung_ho).toBe("Chị");
    expect(valuesFor({ gender: "male" }).xung_ho).toBe("Anh");
  });

  it("mentor thiếu giới tính hoặc giới tính khác thì trống", () => {
    expect(valuesFor({}).xung_ho).toBe("");
    expect(valuesFor({ gender: "other" }).xung_ho).toBe("");
    expect(valuesFor({ gender: "undisclosed" }).xung_ho).toBe("");
  });

  it("mentee, BTC, người tham dự không có xưng hô dù có giới tính", () => {
    for (const role of ["mentee", "staff", "attendee"] as const) {
      expect(valuesFor({ role, gender: "female" }).xung_ho).toBe("");
    }
  });

  it("mã thành viên của cả mentor lẫn mentee; không có mã thì trống", () => {
    expect(valuesFor({ memberCode: "UEHR0012" }).ma_thanh_vien).toBe("UEHR0012");
    expect(valuesFor({ role: "mentee", memberCode: "UEHE0034" }).ma_thanh_vien).toBe("UEHE0034");
    expect(valuesFor({}).ma_thanh_vien).toBe("");
  });

  it("ba ô cũ giữ nguyên giá trị", () => {
    const values = valuesFor({ memberCode: "UEHR0012", gender: "male" });
    expect(values.ten_nguoi_nhan).toBe("Nguyễn Thị B");
    expect(values.mua).toBe("UEHM-S12");
    expect(values.vai_tro).toBe("mentor");
  });

  it("partitionRecipients giữ lại mã và giới tính, không làm rơi dữ liệu", () => {
    const { sendable } = partitionRecipients([recipient({ memberCode: "UEHR0012", gender: "female" })]);
    expect(sendable[0].memberCode).toBe("UEHR0012");
    expect(sendable[0].gender).toBe("female");
  });
});

describe("ô rỗng được xoá gọn, không để lại khoảng trắng thừa", () => {
  const base = { ten_nguoi_nhan: "Nguyễn Văn Nam", mua: "UEHM-S12", vai_tro: "mentor" };
  const blank = { ...base, ma_thanh_vien: "", xung_ho: "" };

  it("giữa câu: 'Kính gửi {xung_ho} Nam' thành 'Kính gửi Nam'", () => {
    const result = render("Thư", "Kính gửi {{xung_ho}} {{ten_nguoi_nhan}},", blank);
    expect(result).toEqual({ ok: true, subject: "Thư", body: "Kính gửi Nguyễn Văn Nam," });
  });

  it("có giá trị thì điền bình thường", () => {
    const result = render("Thư", "Kính gửi {{xung_ho}} {{ten_nguoi_nhan}},", { ...blank, xung_ho: "Anh" });
    expect(result.ok && result.body).toBe("Kính gửi Anh Nguyễn Văn Nam,");
  });

  it("đầu thư, đầu dòng và đầu câu", () => {
    const result = render(
      "Thư",
      "{{xung_ho}} {{ten_nguoi_nhan}} thân mến,\n{{xung_ho}} vui lòng đọc kỹ. Cảm ơn. {{xung_ho}} nhớ trả lời nhé.",
      blank
    );
    expect(result.ok && result.body).toBe(
      "Nguyễn Văn Nam thân mến,\nvui lòng đọc kỹ. Cảm ơn. nhớ trả lời nhé."
    );
  });

  it("cuối dòng và sát dấu câu", () => {
    const result = render(
      "Thư",
      "Mã của bạn: {{ma_thanh_vien}}\nChào {{xung_ho}}, hẹn gặp {{xung_ho}}.",
      blank
    );
    expect(result.ok && result.body).toBe("Mã của bạn:\nChào, hẹn gặp.");
  });

  it("hai ô rỗng đứng cạnh nhau chỉ để lại một dấu cách", () => {
    const result = render("Thư", "Kính gửi {{xung_ho}} {{ma_thanh_vien}} {{ten_nguoi_nhan}}", blank);
    expect(result.ok && result.body).toBe("Kính gửi Nguyễn Văn Nam");
  });

  it("trong tiêu đề", () => {
    const result = render("{{xung_ho}} {{ten_nguoi_nhan}} {{ma_thanh_vien}} — {{mua}}", "x", blank);
    expect(result.ok && result.subject).toBe("Nguyễn Văn Nam — UEHM-S12");
  });

  it("ô rỗng không bị tính là thiếu dữ liệu", () => {
    const result = render("Thư", "{{ma_thanh_vien}} {{xung_ho}} {{ten_nguoi_nhan}}", {
      ten_nguoi_nhan: "Nguyễn Văn Nam"
    });
    expect(result.ok).toBe(true);
  });

  it("ba ô cũ rỗng vẫn chặn bức thư như trước, kể cả khi thư có ô mới", () => {
    const result = render("Thư", "Kính gửi {{xung_ho}} {{ten_nguoi_nhan}} ({{vai_tro}})", {
      ...blank,
      ten_nguoi_nhan: "",
      vai_tro: " "
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.missing).toEqual(["ten_nguoi_nhan", "vai_tro"]);
  });
});

/**
 * Bản sao NGUYÊN VĂN của `renderTemplate` trước VAM00024, để so từng byte.
 * Đừng sửa bản này theo mã mới — nó là chuẩn để đối chiếu.
 */
function renderBeforeVam00024(input: { subject: string; body: string; values: Record<string, string | undefined> }) {
  const pattern = /\{\{\s*([a-z0-9_]{1,40})\s*\}\}/g;
  const missing: string[] = [];
  const fill = (text: string) =>
    String(text ?? "").replace(pattern, (_match, key: string) => {
      const value = input.values[key];
      const filled = value === null || value === undefined ? "" : String(value).trim();
      if (!filled) {
        if (!missing.includes(key)) missing.push(key);
        return "";
      }
      return filled;
    });
  const subject = fill(input.subject).replace(/\s+/g, " ").trim();
  const body = fill(input.body).trim();
  if (missing.length) return { ok: false, missing };
  return { ok: true, subject, body };
}

describe("mẫu thư đã lưu không dùng ô mới ra đúng từng byte như trước", () => {
  const savedTemplates = [
    {
      subject: "Thông báo từ Ban tổ chức {{mua}}",
      body: "Chào {{ten_nguoi_nhan}},\n\nBan tổ chức xin thông báo lịch mới của {{mua}}.\n\nTrân trọng,\nBTC"
    },
    {
      // Khoảng trắng lạ: hai dấu cách, tab, dấu cách cuối dòng, dòng trống liền nhau.
      subject: "  {{mua}}  —  nhắc  {{vai_tro}} ",
      body: "Chào  {{ ten_nguoi_nhan }} ,\t({{vai_tro}})  \n\n\n  Xin  cảm ơn.  \n"
    },
    { subject: "Không có ô nào", body: "Nội dung   không có ô điền nào cả.\r\nDòng hai." }
  ];

  savedTemplates.forEach((template, index) => {
    it(`mẫu ${index + 1}, cho mentor nữ có mã, mentee và người không có mã`, () => {
      for (const who of [
        recipient({ memberCode: "UEHR0012", gender: "female" }),
        recipient({ role: "mentee", memberCode: "UEHE0034" }),
        recipient({ role: "staff" })
      ]) {
        const values = buildRecipientValues({ kind: "general_announcement", recipient: who, seasonCode: "UEHM-S12" });
        const before = renderBeforeVam00024({ ...template, values });
        expect(render(template.subject, template.body, values)).toEqual(before);
      }
    });
  });

  it("cả khi thiếu dữ liệu: cùng danh sách ô thiếu như trước", () => {
    const values = { ten_nguoi_nhan: "", mua: "UEHM-S12", vai_tro: "", ma_thanh_vien: "", xung_ho: "" };
    const before = renderBeforeVam00024({ ...savedTemplates[1], values });
    const now = render(savedTemplates[1].subject, savedTemplates[1].body, values);
    expect(now.ok).toBe(false);
    expect(!now.ok && now.missing).toEqual(before.missing);
  });
});

describe("hướng dẫn sử dụng trang Mail nhắc hai ô mới", () => {
  it("liệt kê Mã thành viên và Xưng hô cạnh ba ô cũ", () => {
    const guide = HELP_GUIDES["/operations/mail"];
    // Soi đúng bước nói về khung "Chèn thông tin vào thư" — ghi chú bên dưới
    // cũng nhắc tên hai ô, tìm chung cả hướng dẫn thì bước này thiếu vẫn xanh.
    const step = guide.steps.find((row) => row.includes("Chèn thông tin vào thư")) ?? "";
    for (const label of ["Tên người nhận", "Tên mùa", "Vai trò", "Mã thành viên", "Xưng hô (Anh/Chị)"]) {
      expect(step).toContain(label);
    }
    const notes = (guide.notes ?? []).join("\n");
    expect(notes).toContain("chỉ dành cho Mentor");
  });
});

// ---------------------------------------------------------------------------
// Đường lấy dữ liệu thật: danh bạ → mã mới, hồ sơ → mã cũ, rồi tới bức thư.
// ---------------------------------------------------------------------------

const SEASON = "00000000-0000-4000-8000-0000000000aa";

type Tables = Record<string, Array<Record<string, unknown>>>;
const selects: Array<{ table: string; columns: string }> = [];
let failingTable: string | null = null;

function fakeClient(tables: Tables) {
  return {
    from(table: string) {
      const chain: Record<string, unknown> = {};
      const passthrough = () => chain;
      for (const method of ["eq", "in", "order", "limit", "range", "update"]) {
        chain[method] = vi.fn(passthrough);
      }
      chain.select = vi.fn((columns: string) => {
        selects.push({ table, columns });
        return chain;
      });
      chain.then = (resolve: (value: { data: unknown; error: unknown }) => unknown) =>
        Promise.resolve(
          resolve(
            table === failingTable
              ? { data: null, error: { message: "hỏng" } }
              : { data: tables[table] ?? [], error: null }
          )
        );
      return chain;
    }
  };
}

function directory(): Tables {
  return {
    person_season_memberships: [
      { person_id: "m-new", role: "mentor" },
      { person_id: "m-old", role: "mentor" },
      { person_id: "m-none", role: "mentor" },
      { person_id: "e-old", role: "mentee" }
    ],
    people: [
      { id: "m-new", full_name: "Trần Thị Mới", email_primary: "moi@example.com", member_code: "UEHR0012", gender: "female" },
      { id: "m-old", full_name: "Lê Văn Cũ", email_primary: "cu@example.com", member_code: null, gender: "male" },
      { id: "m-none", full_name: "Phạm Không Mã", email_primary: "khong@example.com", member_code: null, gender: null },
      { id: "e-old", full_name: "Võ Mentee", email_primary: "mentee@example.com", member_code: null, gender: "female" }
    ],
    mentor_profiles: [
      { person_id: "m-new", mentor_code: "MT-CU-1" },
      { person_id: "m-old", mentor_code: "MT-CU-2" }
    ],
    mentee_profiles: [{ person_id: "e-old", mentee_code: "ME-CU-3" }]
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  selects.length = 0;
  failingTable = null;
  vi.mocked(sendTemplatedEmail).mockResolvedValue({ ok: true, skipped: false } as never);
});

describe("listBulkRecipients đọc mã và giới tính", () => {
  async function list(tables: Tables) {
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(fakeClient(tables) as never);
    return listBulkRecipients({ seasonId: SEASON, audience: "both" });
  }

  it("đọc member_code và gender từ danh bạ", async () => {
    await list(directory());
    const people = selects.find((row) => row.table === "people");
    expect(people?.columns).toContain("member_code");
    expect(people?.columns).toContain("gender");
  });

  it("mã mới trước; chưa có thì mã cũ theo vai trò; không có gì thì trống", async () => {
    const result = await list(directory());
    expect(result.error).toBeNull();
    const byId = new Map(result.partition.sendable.map((row) => [row.personId, row]));
    // Có mã mới thì KHÔNG kèm mã cũ, như cột "Mã thành viên" ở trang Mentor.
    expect(byId.get("m-new")?.memberCode).toBe("UEHR0012");
    expect(byId.get("m-old")?.memberCode).toBe("MT-CU-2");
    expect(byId.get("e-old")?.memberCode).toBe("ME-CU-3");
    expect(byId.get("m-none")?.memberCode).toBeUndefined();
    expect(byId.get("m-new")?.gender).toBe("female");
    expect(byId.get("m-old")?.gender).toBe("male");
  });

  it("chỉ hỏi mã cũ của người chưa có mã mới", async () => {
    await list(directory());
    const legacy = selects.filter((row) => row.table === "mentor_profiles" || row.table === "mentee_profiles");
    expect(legacy.map((row) => row.columns).sort()).toEqual(["person_id, mentee_code", "person_id, mentor_code"]);
  });

  it("đọc hồ sơ mentor hỏng thì báo lỗi, không gửi với mã thiếu", async () => {
    failingTable = "mentor_profiles";
    const result = await list(directory());
    expect(result.error).toBeTruthy();
    expect(result.partition.sendable).toEqual([]);
  });
});

describe("runEmailBatch điền hai ô mới vào thư thật", () => {
  function batch(): EmailBatchRow {
    return {
      id: "00000000-0000-4000-8000-0000000000bb",
      seasonId: SEASON,
      kind: "general_announcement",
      templateId: "t1",
      audience: "both",
      audienceEventId: null,
      audienceCoversSeries: false,
      status: "running",
      requestedCount: 0,
      sentCount: 0,
      skippedCount: 0,
      failedCount: 0,
      note: null,
      createdAt: "",
      completedAt: null
    };
  }

  it("mỗi người nhận đúng xưng hô và mã của mình", async () => {
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(fakeClient(directory()) as never);
    const result = await runEmailBatch({
      batch: batch(),
      seasonCode: "UEHM-S12",
      subject: "[{{ma_thanh_vien}}] Thông báo {{mua}}",
      body: "Kính gửi {{xung_ho}} {{ten_nguoi_nhan}},\nMã thành viên: {{ma_thanh_vien}}"
    });
    expect(result.ok).toBe(true);
    expect(result.sent).toBe(4);

    const sentTo = new Map(
      vi.mocked(sendTemplatedEmail).mock.calls.map(([arg]) => [arg.toEmail, { subject: arg.subject, body: arg.body }])
    );
    expect(sentTo.get("moi@example.com")).toEqual({
      subject: "[UEHR0012] Thông báo UEHM-S12",
      body: "Kính gửi Chị Trần Thị Mới,\nMã thành viên: UEHR0012"
    });
    expect(sentTo.get("cu@example.com")).toEqual({
      subject: "[MT-CU-2] Thông báo UEHM-S12",
      body: "Kính gửi Anh Lê Văn Cũ,\nMã thành viên: MT-CU-2"
    });
    expect(sentTo.get("khong@example.com")).toEqual({
      subject: "[] Thông báo UEHM-S12",
      body: "Kính gửi Phạm Không Mã,\nMã thành viên:"
    });
    // Mentee nữ: không có "Chị", vẫn có mã cũ.
    expect(sentTo.get("mentee@example.com")).toEqual({
      subject: "[ME-CU-3] Thông báo UEHM-S12",
      body: "Kính gửi Võ Mentee,\nMã thành viên: ME-CU-3"
    });
  });
});
