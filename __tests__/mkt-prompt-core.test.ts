import { describe, expect, it } from "vitest";

import { generateWeekSlots } from "@/lib/mkt-core";
import {
  buildChannelBlock,
  buildDirectionBlock,
  buildMasterPlanPrompt,
  buildPostRewritePrompt,
  buildSystemPrompt,
  buildWeekPlanPrompt,
  draftNeedsChecking,
  formatCalendar,
  formatOrders,
  formatPillars,
  HUMAN_VOICE_RULES,
  resolveBrandName,
  resolveBrandScope,
  SHARED_SPACE_NAME,
  sortOrders
} from "@/lib/mkt-prompt-core";

/**
 * Three things these tests hold, and they are the three the owner asked for:
 * the prompt is addressed to the right programme by name, the steering block is
 * always present, and nothing belonging to a student leaves the building.
 */

const BRAND = {
  description: "Chương trình mentoring cho sinh viên UEH",
  audience: "Sinh viên năm 3, năm 4",
  voice: "Thân thiện, xưng em - anh/chị",
  pillars: [
    { name: "Câu chuyện mentee", ratio: 30, note: "kết quả thật" },
    { name: "Hậu trường", ratio: 20 }
  ],
  cta: ["Đăng ký tại đây"],
  hashtags: ["#UEHMentoring"],
  doList: ["Mỗi bài một ý"],
  avoidList: ["Hứa hẹn kết quả tuyệt đối"],
  diagnosis: "Trang 12.000 người theo dõi nhưng bài gần đây chỉ 5-10 tương tác."
};

const SLOTS = generateWeekSlots({
  weekStart: "2026-09-14",
  channels: [{ channel: "facebook", postsPerWeek: 3, bestTimes: ["12:00", "20:00"] }]
});

// ── The name in the prompt is the programme's own ────────────────────────────

describe("resolveBrandName — every programme is called by its own name", () => {
  it("calls UEH Mentoring by its name", () => {
    expect(resolveBrandName({ programName: "UEH Mentoring" })).toBe("UEH Mentoring");
  });

  it("calls BK Mentoring by its name", () => {
    expect(resolveBrandName({ programName: "BK Mentoring" })).toBe("BK Mentoring");
  });

  it("handles every programme in the system", () => {
    const programmes = [
      "UEH Mentoring",
      "BK Mentoring",
      "Hanoi Alumni Mentoring",
      "Banking Mentoring",
      "HUFLIT Mentoring"
    ];

    for (const name of programmes) {
      expect(resolveBrandName({ programName: name })).toBe(name);
    }
  });

  it("speaks for the organisation on the shared space", () => {
    expect(resolveBrandName({ isShared: true })).toBe(SHARED_SPACE_NAME);
    // Even if a programme name were passed by mistake, shared wins.
    expect(resolveBrandName({ isShared: true, programName: "UEH Mentoring" })).toBe(
      SHARED_SPACE_NAME
    );
  });

  it("falls back to the organisation rather than to an empty name", () => {
    expect(resolveBrandName({ programName: "   " })).toBe(SHARED_SPACE_NAME);
    expect(resolveBrandName({})).toBe(SHARED_SPACE_NAME);
  });

  it("describes a programme and the shared space differently", () => {
    expect(resolveBrandScope({ isShared: false })).toContain("sinh viên");
    expect(resolveBrandScope({ isShared: true })).toContain("doanh nghiệp");
  });
});

describe("no placeholder ever reaches the model", () => {
  const PLACEHOLDERS = ["[TÊN THƯƠNG HIỆU]", "TÊN THƯƠNG HIỆU", "[BRAND]", "[MÔ TẢ NGÀNH]"];

  it("keeps placeholders out of the system prompt", () => {
    const prompt = buildSystemPrompt({
      brandName: resolveBrandName({ programName: "UEH Mentoring" }),
      brandScope: resolveBrandScope({ isShared: false }),
      brand: BRAND,
      channels: [{ channel: "facebook", audience: "Sinh viên" }]
    });

    for (const placeholder of PLACEHOLDERS) {
      expect(prompt).not.toContain(placeholder);
    }
    expect(prompt).toContain("UEH Mentoring");
  });

  it("keeps placeholders out of every user prompt", () => {
    const prompts = [
      buildMasterPlanPrompt({
        brandName: "BK Mentoring",
        month: "2026-09",
        weekStarts: ["2026-09-07", "2026-09-14"]
      }),
      buildWeekPlanPrompt({ brandName: "BK Mentoring", weekStart: "2026-09-14", slots: SLOTS }),
      buildPostRewritePrompt({
        brandName: "BK Mentoring",
        post: { postDate: "2026-09-14", channel: "facebook" }
      })
    ];

    for (const prompt of prompts) {
      for (const placeholder of PLACEHOLDERS) {
        expect(prompt).not.toContain(placeholder);
      }
      expect(prompt).toContain("BK Mentoring");
    }
  });

  it("never addresses one programme by another programme's name", () => {
    const prompt = buildWeekPlanPrompt({
      brandName: resolveBrandName({ programName: "Banking Mentoring" }),
      weekStart: "2026-09-14",
      slots: SLOTS
    });

    expect(prompt).toContain("Banking Mentoring");
    expect(prompt).not.toContain("UEH Mentoring");
    expect(prompt).not.toContain("BK Mentoring");
  });
});

// ── The steering block ───────────────────────────────────────────────────────

describe("buildDirectionBlock — always printed, never dropped", () => {
  it("prints all five lines as 'chưa có' when nothing is set", () => {
    const block = buildDirectionBlock();
    expect(block.match(/chưa có/g)).toHaveLength(5);
  });

  it("prints the same five lines when the object is empty", () => {
    expect(buildDirectionBlock({})).toBe(buildDirectionBlock());
  });

  it("carries what is set", () => {
    const block = buildDirectionBlock({
      monthTheme: "Tháng của mentor",
      weekTopic: "Tuyển mentor đợt 2"
    });

    expect(block).toContain("Tháng của mentor");
    expect(block).toContain("Tuyển mentor đợt 2");
    // The three still unset remain visible as "chưa có" rather than vanishing.
    expect(block.match(/chưa có/g)).toHaveLength(3);
  });

  it("tells the model what to do when direction and brand disagree", () => {
    expect(buildDirectionBlock()).toContain("ưu tiên định");
  });
});

describe("the steering block reaches the rewrite prompt too", () => {
  it("carries month and week context into a single-post rewrite", () => {
    // The failure this prevents: a rewrite that receives only day, channel,
    // pillar and idea, and drifts onto its own topic every time.
    const prompt = buildPostRewritePrompt({
      brandName: "UEH Mentoring",
      post: { postDate: "2026-09-14", channel: "facebook" },
      direction: { monthTheme: "Tháng của mentor", weekTopic: "Tuyển mentor đợt 2" }
    });

    expect(prompt).toContain("ĐỊNH HƯỚNG PHẢI BÁM");
    expect(prompt).toContain("Tháng của mentor");
    expect(prompt).toContain("Tuyển mentor đợt 2");
  });

  it("carries it into the week plan prompt as well", () => {
    const prompt = buildWeekPlanPrompt({
      brandName: "UEH Mentoring",
      weekStart: "2026-09-14",
      slots: SLOTS,
      direction: { weekFocus: "Câu chuyện mentee" }
    });

    expect(prompt).toContain("ĐỊNH HƯỚNG PHẢI BÁM");
    expect(prompt).toContain("Câu chuyện mentee");
  });
});

// ── Channels ─────────────────────────────────────────────────────────────────

describe("buildChannelBlock", () => {
  it("warns in capitals when a channel speaks to a different audience", () => {
    const block = buildChannelBlock([
      { channel: "linkedin", audience: "Doanh nghiệp", distinctAudience: true }
    ]);

    expect(block).toContain("ĐỐI TƯỢNG KHÁC HẲN");
    expect(block).toContain("LinkedIn");
  });

  it("does not warn for an ordinary channel", () => {
    const block = buildChannelBlock([{ channel: "facebook", audience: "Sinh viên" }]);
    expect(block).not.toContain("ĐỐI TƯỢNG KHÁC HẲN");
  });

  it("tells the model to pick the channel before the idea", () => {
    const block = buildChannelBlock([{ channel: "facebook" }]);
    expect(block).toContain("xác định kênh của bài TRƯỚC");
  });

  it("prints 'chưa có' for a brief that was never filled in", () => {
    const block = buildChannelBlock([{ channel: "facebook" }]);
    expect(block).toContain("chưa có");
  });

  it("says so plainly when a space has no channels at all", () => {
    expect(buildChannelBlock([])).toContain("chưa có");
  });
});

describe("formatPillars", () => {
  it("carries the percentages so a week comes out balanced", () => {
    const text = formatPillars(BRAND.pillars);
    expect(text).toContain("Câu chuyện mentee (30%)");
    expect(text).toContain("kết quả thật");
  });

  it("omits a percentage that was never set rather than printing zero", () => {
    expect(formatPillars([{ name: "Hậu trường" }])).toBe("  - Hậu trường");
  });

  it("says 'chưa có' when there are none", () => {
    expect(formatPillars([])).toContain("chưa có");
    expect(formatPillars(undefined)).toContain("chưa có");
  });
});

// ── Requests ─────────────────────────────────────────────────────────────────

const ORDERS = [
  {
    id: "aaaaaaaa-0000-4000-8000-000000000001",
    title: "Nhắc hạn nộp đơn mentee",
    body: "Hạn nộp đơn là 30/09, cần nhắc trước một tuần.",
    contentPriority: "normal",
    createdAt: "2026-09-01T00:00:00Z"
  },
  {
    id: "bbbbbbbb-0000-4000-8000-000000000002",
    title: "Tuyển mentor đợt 2",
    body: "Cần thêm 20 mentor ngành tài chính.",
    contentPriority: "high",
    createdAt: "2026-09-05T00:00:00Z"
  },
  {
    id: "cccccccc-0000-4000-8000-000000000003",
    title: "Buổi training kỹ năng",
    body: "Training ngày 20/09 tại hội trường B1.",
    contentPriority: "priority",
    createdAt: "2026-09-02T00:00:00Z"
  }
];

describe("sortOrders — code sorts, the model creates", () => {
  it("puts high before priority before normal", () => {
    expect(sortOrders(ORDERS).map((order) => order.contentPriority)).toEqual([
      "high",
      "priority",
      "normal"
    ]);
  });

  it("serves whoever asked first when priority ties", () => {
    const sorted = sortOrders([
      { id: "b", title: "sau", contentPriority: "high", createdAt: "2026-09-05T00:00:00Z" },
      { id: "a", title: "trước", contentPriority: "high", createdAt: "2026-09-01T00:00:00Z" }
    ]);

    expect(sorted.map((order) => order.id)).toEqual(["a", "b"]);
  });

  it("treats a missing priority as normal rather than crashing", () => {
    const sorted = sortOrders([
      { id: "a", title: "x" },
      { id: "b", title: "y", contentPriority: "high" }
    ]);
    expect(sorted[0].id).toBe("b");
  });

  it("does not mutate the list it was given", () => {
    const input = [...ORDERS];
    sortOrders(input);
    expect(input.map((order) => order.id)).toEqual(ORDERS.map((order) => order.id));
  });
});

describe("formatOrders", () => {
  it("numbers the list and labels the priority", () => {
    const text = formatOrders(ORDERS);
    expect(text).toContain("1. ");
    expect(text).toContain("ƯU TIÊN CAO");
    expect(text).toContain("Tuyển mentor đợt 2");
  });

  it("says so when there are none", () => {
    expect(formatOrders([])).toContain("Không có đề nghị");
  });

  it("removes a student's contact details an organiser pasted in", () => {
    const text = formatOrders([
      {
        id: "dddddddd-0000-4000-8000-000000000004",
        title: "Bài về bạn Hương",
        body: "Liên hệ bạn ấy qua huong@example.com hoặc 0912345678, MSSV UEHEM11104.",
        contentPriority: "normal"
      }
    ]);

    expect(text).not.toContain("huong@example.com");
    expect(text).not.toContain("0912345678");
    expect(text).not.toContain("UEHEM11104");
    // The substance of the request survives.
    expect(text).toContain("Liên hệ bạn ấy qua");
  });

  it("caps a very long brief rather than sending the whole essay", () => {
    const text = formatOrders([
      {
        id: "eeeeeeee-0000-4000-8000-000000000005",
        title: "Dài",
        body: "x".repeat(2000),
        contentPriority: "normal"
      }
    ]);

    expect(text).not.toContain("x".repeat(600));
  });
});

describe("the order instructions", () => {
  it("forbid silently dropping a request", () => {
    const prompt = buildWeekPlanPrompt({
      brandName: "UEH Mentoring",
      weekStart: "2026-09-14",
      slots: SLOTS,
      orders: ORDERS
    });

    expect(prompt).toContain("KHÔNG bỏ đề nghị");
    expect(prompt).toContain("orders_unplaced");
    expect(prompt).toContain("Đừng im lặng bỏ qua");
  });

  it("ask the model to report what it did with each one", () => {
    const prompt = buildWeekPlanPrompt({
      brandName: "UEH Mentoring",
      weekStart: "2026-09-14",
      slots: SLOTS,
      orders: ORDERS
    });

    expect(prompt).toContain("order_review");
  });
});

// ── The real calendar ────────────────────────────────────────────────────────

describe("formatCalendar", () => {
  it("lists what is genuinely happening", () => {
    const text = formatCalendar([
      { label: "Training kỹ năng lắng nghe", date: "2026-09-20", kind: "training" }
    ]);

    expect(text).toContain("2026-09-20");
    expect(text).toContain("Training kỹ năng lắng nghe");
  });

  it("says so plainly when nothing is scheduled", () => {
    expect(formatCalendar([])).toContain("Không có hoạt động");
  });

  it("scrubs a personal detail that made it into an event name", () => {
    const text = formatCalendar([{ label: "Gặp bạn Hương 0912345678", date: "2026-09-20" }]);
    expect(text).not.toContain("0912345678");
  });
});

// ── The prompts as a whole ───────────────────────────────────────────────────

describe("buildWeekPlanPrompt", () => {
  it("lists every slot and states the exact count expected back", () => {
    const prompt = buildWeekPlanPrompt({
      brandName: "UEH Mentoring",
      weekStart: "2026-09-14",
      slots: SLOTS
    });

    for (const slot of SLOTS) {
      expect(prompt).toContain(slot.postDate);
      expect(prompt).toContain(slot.variantGroup);
    }
    expect(prompt).toContain(`đúng ${SLOTS.length} phần tử`);
  });

  it("forbids the model from changing the schedule", () => {
    const prompt = buildWeekPlanPrompt({
      brandName: "UEH Mentoring",
      weekStart: "2026-09-14",
      slots: SLOTS
    });

    expect(prompt).toContain("không được thêm, bớt hay đổi ngày/kênh");
  });

  it("explains what a variant group means", () => {
    const prompt = buildWeekPlanPrompt({
      brandName: "UEH Mentoring",
      weekStart: "2026-09-14",
      slots: SLOTS
    });

    expect(prompt).toContain("MỘT ý tưởng ở nhiều dạng");
  });
});

describe("buildMasterPlanPrompt", () => {
  it("names every week of the month in order", () => {
    const prompt = buildMasterPlanPrompt({
      brandName: "UEH Mentoring",
      month: "2026-09",
      weekStarts: ["2026-09-07", "2026-09-14", "2026-09-21"]
    });

    expect(prompt).toContain("Tuần 1: 2026-09-07");
    expect(prompt).toContain("Tuần 3: 2026-09-21");
    expect(prompt).toContain("bằng đúng số tuần");
  });

  it("asks the model not to repeat last month", () => {
    const prompt = buildMasterPlanPrompt({
      brandName: "UEH Mentoring",
      month: "2026-09",
      weekStarts: ["2026-09-07"],
      previousTheme: "Tháng của mentee"
    });

    expect(prompt).toContain("Tháng của mentee");
    expect(prompt).toContain("Đừng lặp lại");
  });
});

// ── Writing rules ────────────────────────────────────────────────────────────

describe("HUMAN_VOICE_RULES", () => {
  it("bans the clichés that make Vietnamese copy read as machine-written", () => {
    for (const phrase of ["không chỉ… mà còn", "chắp cánh ước mơ", "đồng hành cùng"]) {
      expect(HUMAN_VOICE_RULES).toContain(phrase);
    }
  });

  it("carries the rule that is about risk rather than taste", () => {
    // Inventing a student testimonial on a public fanpage is the failure that
    // costs more than a dull sentence ever does.
    expect(HUMAN_VOICE_RULES).toContain("TUYỆT ĐỐI KHÔNG BỊA");
    expect(HUMAN_VOICE_RULES).toContain("Thà viết câu nhạt mà thật");
  });

  it("is short enough not to dominate every request", () => {
    // The source material runs to hundreds of lines, most of it English phrase
    // lists that catch nothing in Vietnamese and cost thousands of tokens.
    expect(HUMAN_VOICE_RULES.split("\n").length).toBeLessThan(50);
  });

  it("is loaded into the system prompt", () => {
    const prompt = buildSystemPrompt({
      brandName: "UEH Mentoring",
      brandScope: "x",
      brand: BRAND
    });
    expect(prompt).toContain("VIẾT NHƯ NGƯỜI THẬT");
  });
});

describe("buildSystemPrompt — block order", () => {
  const prompt = buildSystemPrompt({
    brandName: "UEH Mentoring",
    brandScope: resolveBrandScope({ isShared: false }),
    brand: BRAND,
    channels: [{ channel: "facebook", audience: "Sinh viên" }]
  });

  it("puts who-am-I-writing-for before how-do-I-write", () => {
    const channelAt = prompt.indexOf("ĐỊNH HƯỚNG RIÊNG TỪNG KÊNH");
    const rulesAt = prompt.indexOf("VIẾT NHƯ NGƯỜI THẬT");
    const brandAt = prompt.indexOf("HỒ SƠ THƯƠNG HIỆU");

    expect(brandAt).toBeGreaterThan(-1);
    expect(channelAt).toBeGreaterThan(brandAt);
    expect(rulesAt).toBeGreaterThan(channelAt);
  });

  it("carries the diagnosis, so the model improves rather than imitates", () => {
    expect(prompt).toContain("Trang 12.000 người theo dõi");
  });

  it("prints 'chưa có' for an empty brand rather than omitting the line", () => {
    const empty = buildSystemPrompt({ brandName: "UEH Mentoring", brandScope: "x" });
    expect(empty).toContain("chưa có");
    expect(empty).toContain("UEH Mentoring");
  });
});

describe("draftNeedsChecking", () => {
  it("passes ordinary copy", () => {
    expect(draftNeedsChecking("Tuần này chương trình mở đăng ký cho các bạn năm 3.").ok).toBe(true);
  });

  it("passes a multi-line caption", () => {
    expect(draftNeedsChecking("Dòng một.\n\nDòng hai.").ok).toBe(true);
  });

  it("flags a draft that came back holding a phone number", () => {
    const result = draftNeedsChecking("Gọi 0912345678 để đăng ký");
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("kiểm tra");
  });

  it("flags a draft holding an email", () => {
    expect(draftNeedsChecking("Gửi mail về ai.do@example.com").ok).toBe(false);
  });

  it("refuses an empty draft", () => {
    expect(draftNeedsChecking("").ok).toBe(false);
    expect(draftNeedsChecking(null).ok).toBe(false);
  });
});
