/**
 * Các lần quét mã QR của một sự kiện — phần thuần.
 *
 * Ba cách phần này hỏng mà không ai thấy, và bộ test canh cả ba:
 *   - một trạm có hai cách viết (`talkshow` và `talkshow_1`): người đã quét quét
 *     lại được, số đếm tách làm hai;
 *   - khoá theo số thứ tự lần quét: chèn một lần quét vào giữa là lượt Check out
 *     đã quét thành của một lần quét khác;
 *   - danh sách từ form có một ô sai bị bỏ lặng lẽ: mọi lần quét phía sau dịch số.
 */
import { describe, expect, it } from "vitest";
import {
  CHECKIN_PURPOSES,
  DEFAULT_CHECKIN_STEPS,
  ENTRANCE_STATION,
  MAX_CHECKIN_STEPS,
  buildCheckinSteps,
  checkinStepsOf,
  collectBadges,
  needsCheckInReminder,
  parseCheckinStepsInput,
  parseStation,
  stationLabel,
  summarizeStepCounts,
  type CheckinPurpose
} from "@/lib/event-checkin-steps";

describe("1. danh sách mục", () => {
  it("đúng sáu mục team chọn, đúng thứ tự và cách gọi", () => {
    expect(CHECKIN_PURPOSES.map((purpose) => purpose.label)).toEqual([
      "Check in",
      "Check quầy đổi quà",
      "Check quầy trải nghiệm",
      "Check talkshow",
      "Check seminar",
      "Check out"
    ]);
  });

  it("Check in dùng lại đúng tên trạm cửa vào cũ — lượt quét cửa vào đã có vẫn là Check in", () => {
    expect(CHECKIN_PURPOSES[0].value).toBe("entrance");
    expect(ENTRANCE_STATION).toBe("entrance");
    expect(stationLabel("entrance")).toBe("Check in");
  });

  it("tối đa 20 lần quét", () => {
    expect(MAX_CHECKIN_STEPS).toBe(20);
  });
});

describe("2. đọc thiết lập từ dòng sự kiện", () => {
  it.each([
    [undefined],
    [null],
    [{}],
    [{ checkin_steps: null }],
    [{ checkin_steps: [] }],
    [{ checkin_steps: "entrance" }],
    [{ checkin_steps: ["booth_program"] }]
  ])("%o → một lần Check in, không phải không có lần quét nào", (event) => {
    expect(checkinStepsOf(event as never)).toEqual(["entrance"]);
  });

  it("giữ nguyên thứ tự BTC đặt", () => {
    expect(checkinStepsOf({ checkin_steps: ["checkout", "entrance", "talkshow"] })).toEqual([
      "checkout",
      "entrance",
      "talkshow"
    ]);
  });

  it("bỏ giá trị lạ, giữ phần còn lại theo thứ tự", () => {
    expect(checkinStepsOf({ checkin_steps: ["entrance", "booth_program", 7, "checkout"] })).toEqual([
      "entrance",
      "checkout"
    ]);
  });

  it("cắt ở 20 lần quét", () => {
    expect(checkinStepsOf({ checkin_steps: new Array(25).fill("talkshow") })).toHaveLength(MAX_CHECKIN_STEPS);
  });

  it("sửa kết quả không sửa được mặc định dùng chung", () => {
    const steps = checkinStepsOf(null);
    steps.push("checkout");
    expect(DEFAULT_CHECKIN_STEPS).toEqual(["entrance"]);
    expect(checkinStepsOf(null)).toEqual(["entrance"]);
  });
});

describe("3. khoá trạm của từng lần quét", () => {
  it("sự kiện chỉ cần Check out: Quét lần 1 · Check out", () => {
    expect(buildCheckinSteps(["checkout"])).toEqual([
      { number: 1, purpose: "checkout", station: "checkout", label: "Quét lần 1 · Check out" }
    ]);
  });

  it("mục lặp lại mang số lần xuất hiện; lần đầu mang tên trần", () => {
    const steps = buildCheckinSteps(["entrance", "talkshow", "gift_counter", "talkshow", "checkout", "talkshow"]);
    expect(steps.map((step) => step.station)).toEqual([
      "entrance",
      "talkshow",
      "gift_counter",
      "talkshow_2",
      "checkout",
      "talkshow_3"
    ]);
    expect(steps.map((step) => step.label)).toEqual([
      "Quét lần 1 · Check in",
      "Quét lần 2 · Check talkshow",
      "Quét lần 3 · Check quầy đổi quà",
      "Quét lần 4 · Check talkshow",
      "Quét lần 5 · Check out",
      "Quét lần 6 · Check talkshow"
    ]);
  });

  it("chèn một lần quét vào giữa KHÔNG đổi khoá của các lần quét đã có", () => {
    // Khoá theo số thứ tự thì Check out đổi từ lần 2 thành lần 3, lượt đã quét
    // thành của lần quét khác và người đã Check out quét lại được.
    const before = buildCheckinSteps(["entrance", "checkout"]);
    const after = buildCheckinSteps(["entrance", "talkshow", "checkout"]);
    const checkoutBefore = before.find((step) => step.purpose === "checkout");
    const checkoutAfter = after.find((step) => step.purpose === "checkout");

    expect(checkoutAfter?.number).not.toBe(checkoutBefore?.number);
    expect(checkoutAfter?.station).toBe(checkoutBefore?.station);
  });

  it("mọi khoá sinh ra đều khác nhau, đọc ngược lại được, và vừa cột station (60 ký tự)", () => {
    for (const purpose of CHECKIN_PURPOSES) {
      const steps = buildCheckinSteps(new Array(MAX_CHECKIN_STEPS).fill(purpose.value) as CheckinPurpose[]);
      expect(new Set(steps.map((step) => step.station)).size, purpose.value).toBe(MAX_CHECKIN_STEPS);
      steps.forEach((step, index) => {
        expect(parseStation(step.station), step.station).toEqual({ purpose: purpose.value, occurrence: index + 1 });
        expect(step.station.length, step.station).toBeLessThanOrEqual(60);
      });
    }
  });

  it.each(["talkshow_1", "talkshow_01", "talkshow_02", "talkshow_21", "talkshow_2x", "entrance_", "ENTRANCE", "check_in", "booth_program", ""])(
    "%j không phải khoá của một lần quét",
    (station) => {
      // `_1` hay `_02` mà được nhận thì một trạm có hai cách viết, và bị đếm thành hai.
      expect(parseStation(station)).toBeNull();
    }
  );
});

describe("4. nhãn", () => {
  const steps = buildCheckinSteps(["entrance", "talkshow", "talkshow"]);

  it("có thiết lập: đúng chữ trên máy quét", () => {
    expect(stationLabel("talkshow_2", steps)).toBe("Quét lần 3 · Check talkshow");
  });

  it("không có thiết lập (trang vé công khai): chỉ nói mục", () => {
    expect(stationLabel("talkshow_2")).toBe("Check talkshow 2");
    expect(stationLabel("gift_counter")).toBe("Check quầy đổi quà");
  });

  it("trạm không còn trong thiết lập vẫn ra chữ, không ra mã", () => {
    expect(stationLabel("checkout", steps)).toBe("Check out");
  });

  it("trạm của máy quét cũ vẫn đọc được — 45 lượt Booth chương trình đã có trên production", () => {
    expect(stationLabel("booth_program")).toBe("Booth chương trình");
    expect(stationLabel("booth_partner")).toBe("Booth đối tác");
    expect(stationLabel("workshop")).toBe("Khu trải nghiệm");
  });

  it("trạm lạ là chính tên nó; tên trùng thuộc tính có sẵn của object không biến thành hàm", () => {
    expect(stationLabel("khu_vr")).toBe("khu_vr");
    expect(stationLabel("constructor")).toBe("constructor");
    expect(stationLabel("  ")).toBe("—");
  });
});

describe("5. huy hiệu", () => {
  it("mỗi trạm một huy hiệu, xếp theo thứ tự đã đi qua, nhãn theo thiết lập", () => {
    const steps = buildCheckinSteps(["entrance", "gift_counter", "checkout"]);
    const badges = collectBadges(
      [
        { station: "checkout", scannedAt: "2026-09-20T04:00:00Z" },
        { station: "entrance", scannedAt: "2026-09-20T01:00:00Z" },
        { station: "gift_counter", scannedAt: "2026-09-20T02:00:00Z" }
      ],
      steps
    );
    expect(badges.map((badge) => badge.label)).toEqual([
      "Quét lần 1 · Check in",
      "Quét lần 2 · Check quầy đổi quà",
      "Quét lần 3 · Check out"
    ]);
  });

  it("quét lại cùng một trạm chỉ tính một huy hiệu, giữ lần đầu", () => {
    // Thử theo CẢ HAI thứ tự đưa vào. Chỉ đưa lần muộn trước thì một bản cài đặt
    // "lần ghi sau đè lần trước" cũng cho ra đúng kết quả.
    for (const order of [
      ["2026-09-20T01:00:00Z", "2026-09-20T02:00:00Z"],
      ["2026-09-20T02:00:00Z", "2026-09-20T01:00:00Z"]
    ]) {
      const badges = collectBadges(order.map((scannedAt) => ({ station: "entrance", scannedAt })));
      expect(badges).toHaveLength(1);
      expect(badges[0].scannedAt, order.join(" rồi ")).toBe("2026-09-20T01:00:00Z");
    }
  });

  it("bỏ qua dòng không có tên trạm; chưa quét đâu thì chưa có huy hiệu", () => {
    expect(collectBadges([{ station: "  ", scannedAt: "2026-09-20T01:00:00Z" }])).toEqual([]);
    expect(collectBadges([])).toEqual([]);
  });
});

describe("6. số lượt quét", () => {
  it("mọi lần quét đang thiết lập đều hiện, kể cả khi còn 0, đúng thứ tự thiết lập", () => {
    const steps = buildCheckinSteps(["entrance", "gift_counter", "checkout"]);
    const rows = summarizeStepCounts(steps, [
      { station: "checkout", total: 3 },
      { station: "entrance", total: 40 }
    ]);
    expect(rows.map((row) => [row.label, row.total, row.configured])).toEqual([
      ["Quét lần 1 · Check in", 40, true],
      ["Quét lần 2 · Check quầy đổi quà", 0, true],
      ["Quét lần 3 · Check out", 3, true]
    ]);
  });

  it("lượt quét ở trạm không còn trong thiết lập vẫn hiện, xếp sau, nhiều trước", () => {
    const rows = summarizeStepCounts(buildCheckinSteps(["entrance"]), [
      { station: "talkshow", total: 5 },
      { station: "booth_program", total: 45 },
      { station: "entrance", total: 3 }
    ]);
    expect(rows.map((row) => [row.label, row.total, row.configured])).toEqual([
      ["Quét lần 1 · Check in", 3, true],
      ["Booth chương trình", 45, false],
      ["Check talkshow", 5, false]
    ]);
  });

  it("không có thiết lập và chưa ai quét: không có gì để hiện", () => {
    expect(summarizeStepCounts([], [])).toEqual([]);
  });
});

describe("7. danh sách gửi lên từ form", () => {
  it("nhận đúng thứ tự", () => {
    expect(parseCheckinStepsInput(["gift_counter", "entrance", "checkout"])).toEqual({
      ok: true,
      steps: ["gift_counter", "entrance", "checkout"]
    });
  });

  it("một giá trị trần cũng nhận", () => {
    expect(parseCheckinStepsInput("checkout")).toEqual({ ok: true, steps: ["checkout"] });
  });

  it.each([[[]], [undefined], [null], [""]])("%j → từ chối: phải có ít nhất một lần quét", (values) => {
    expect(parseCheckinStepsInput(values)).toEqual({ ok: false, message: "Cần ít nhất một lần quét mã QR." });
  });

  it("20 lần thì nhận, 21 lần thì từ chối", () => {
    expect(parseCheckinStepsInput(new Array(20).fill("talkshow")).ok).toBe(true);
    const tooMany = parseCheckinStepsInput(new Array(21).fill("talkshow"));
    expect(tooMany.ok).toBe(false);
    if (!tooMany.ok) expect(tooMany.message).toContain("20");
  });

  it("một ô sai thì từ chối CẢ danh sách, và nói đúng ô nào", () => {
    // Bỏ lặng lẽ ô sai thì Check out đang là lần 3 thành lần 2.
    expect(parseCheckinStepsInput(["entrance", "booth_program", "checkout"])).toEqual({
      ok: false,
      message: "Quét lần 2 chưa chọn mục hợp lệ."
    });
  });
});

describe("8. nhắc chưa Check in", () => {
  const steps = buildCheckinSteps(["entrance", "gift_counter", "checkout"]);

  it("tới quầy quà mà chưa qua Check in: nhắc", () => {
    expect(needsCheckInReminder(steps, "gift_counter", ["gift_counter"])).toBe(true);
    expect(needsCheckInReminder(steps, "checkout", ["gift_counter", "checkout"])).toBe(true);
  });

  it("đã qua Check in: không nhắc", () => {
    expect(needsCheckInReminder(steps, "gift_counter", ["entrance", "gift_counter"])).toBe(false);
  });

  it("chính lần Check in: không nhắc", () => {
    expect(needsCheckInReminder(steps, "entrance", ["entrance"])).toBe(false);
  });

  it("lần Check in thứ hai của sự kiện cũng tính là đã Check in", () => {
    const twice = buildCheckinSteps(["entrance", "entrance", "checkout"]);
    expect(needsCheckInReminder(twice, "checkout", ["entrance_2", "checkout"])).toBe(false);
  });

  it("sự kiện không có lần Check in nào (chỉ Check out): không có gì để nhắc", () => {
    expect(needsCheckInReminder(buildCheckinSteps(["checkout"]), "checkout", ["checkout"])).toBe(false);
  });
});
