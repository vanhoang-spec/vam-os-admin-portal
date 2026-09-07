import { describe, expect, it } from "vitest";

import {
  addDays,
  canApprove,
  CHANNEL_LABELS,
  channelsForSpace,
  derivedStatus,
  evaluateMktAiGate,
  generateWeekSlots,
  isOptionalChannel,
  isSharedChannel,
  mergeIntoSlots,
  MKT_CHANNELS,
  mondayOf,
  nextStep,
  readJsonObject,
  suggestScheduledAt,
  vietnamInstant,
  vietnamNow,
  weeklyLoad
} from "@/lib/mkt-core";

/**
 * The schedule is arithmetic. These tests are what lets the module trust that
 * a bad answer from a model costs some ideas rather than the shape of a week.
 */

describe("channels — who owns what", () => {
  it("gives a programme space Facebook, TikTok and YouTube, and never LinkedIn", () => {
    const channels = channelsForSpace(false);
    expect(channels).toEqual(["facebook", "tiktok", "youtube"]);
    expect(channels).not.toContain("linkedin");
  });

  it("gives the shared VAM space LinkedIn and nothing else", () => {
    // The owner's rule: one LinkedIn account for the organisation, not one per
    // school. The database enforces the same thing with a CHECK.
    expect(channelsForSpace(true)).toEqual(["linkedin"]);
  });

  it("agrees with isSharedChannel for every channel", () => {
    for (const channel of MKT_CHANNELS) {
      const shared = isSharedChannel(channel);
      expect(channelsForSpace(shared)).toContain(channel);
      expect(channelsForSpace(!shared)).not.toContain(channel);
    }
  });

  it("treats TikTok as optional — the support team decides later", () => {
    expect(isOptionalChannel("tiktok")).toBe(true);
    expect(isOptionalChannel("facebook")).toBe(false);
  });

  it("has a Vietnamese-facing label for every channel", () => {
    for (const channel of MKT_CHANNELS) {
      expect(CHANNEL_LABELS[channel]).toBeTruthy();
    }
  });
});

describe("dates — no timezone drift", () => {
  it("finds the Monday of a week from any day in it", () => {
    // 2026-09-16 is a Wednesday.
    expect(mondayOf("2026-09-16")).toBe("2026-09-14");
    expect(mondayOf("2026-09-14")).toBe("2026-09-14");
    // Sunday belongs to the week that started six days earlier, not the next one.
    expect(mondayOf("2026-09-20")).toBe("2026-09-14");
  });

  it("returns an empty string for nonsense rather than a wrong Monday", () => {
    expect(mondayOf("không phải ngày")).toBe("");
    expect(mondayOf(null)).toBe("");
  });

  it("adds days without crossing a month boundary wrongly", () => {
    expect(addDays("2026-09-30", 1)).toBe("2026-10-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
  });

  it("reads the clock as Vietnam sees it, not as the host machine does", () => {
    // 03:00 UTC is 10:00 in Ho Chi Minh City.
    const now = vietnamNow(new Date("2026-09-15T03:00:00Z"));
    expect(now.date).toBe("2026-09-15");
    expect(now.time).toBe("10:00");
  });

  it("rolls the Vietnamese date forward late in the UTC day", () => {
    // 18:00 UTC is already 01:00 the next morning in Vietnam. This is the case
    // toISOString() gets wrong and why nothing here uses it for local dates.
    const now = vietnamNow(new Date("2026-09-15T18:00:00Z"));
    expect(now.date).toBe("2026-09-16");
    expect(now.time).toBe("01:00");
  });

  it("writes an instant with an explicit offset", () => {
    expect(vietnamInstant("2026-09-15", "20:00")).toBe("2026-09-15T20:00:00+07:00");
  });

  it("repairs a malformed hour instead of producing an invalid instant", () => {
    expect(vietnamInstant("2026-09-15", "9:5")).toBe("2026-09-15T09:00:00+07:00");
    expect(vietnamInstant("2026-09-15", "")).toBe("2026-09-15T09:00:00+07:00");
    expect(vietnamInstant("2026-09-15", "99:99")).toBe("2026-09-15T23:59:00+07:00");
  });
});

describe("generateWeekSlots", () => {
  const facebook = { channel: "facebook" as const, postsPerWeek: 3, bestTimes: ["12:00", "20:00"] };

  it("produces exactly as many slots as the mix asks for", () => {
    const slots = generateWeekSlots({ weekStart: "2026-09-14", channels: [facebook] });
    expect(slots).toHaveLength(3);
  });

  it("never puts two posts on one channel on one day", () => {
    const slots = generateWeekSlots({
      weekStart: "2026-09-14",
      channels: [{ ...facebook, postsPerWeek: 7 }]
    });

    const keys = slots.map((slot) => `${slot.channel}:${slot.postDate}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(slots).toHaveLength(7);
  });

  it("caps at seven even when the mix asks for more", () => {
    const slots = generateWeekSlots({
      weekStart: "2026-09-14",
      channels: [{ ...facebook, postsPerWeek: 20 }]
    });
    expect(slots).toHaveLength(7);
  });

  it("spreads three Facebook posts across the week rather than clustering them", () => {
    const slots = generateWeekSlots({ weekStart: "2026-09-14", channels: [facebook] });
    expect(slots.map((slot) => slot.postDate)).toEqual([
      "2026-09-14", // Monday
      "2026-09-16", // Wednesday
      "2026-09-18" // Friday
    ]);
  });

  it("cycles through the golden hours", () => {
    const slots = generateWeekSlots({ weekStart: "2026-09-14", channels: [facebook] });
    expect(slots.map((slot) => slot.slotTime)).toEqual(["12:00", "20:00", "12:00"]);
  });

  it("falls back to a sane hour when a channel has none configured", () => {
    const slots = generateWeekSlots({
      weekStart: "2026-09-14",
      channels: [{ channel: "facebook", postsPerWeek: 1, bestTimes: [] }]
    });
    expect(slots[0].slotTime).toBe("09:00");
  });

  it("normalises a mid-week start date to that week's Monday", () => {
    const fromWednesday = generateWeekSlots({ weekStart: "2026-09-16", channels: [facebook] });
    const fromMonday = generateWeekSlots({ weekStart: "2026-09-14", channels: [facebook] });
    expect(fromWednesday).toEqual(fromMonday);
  });

  it("produces nothing for a channel switched off", () => {
    const slots = generateWeekSlots({
      weekStart: "2026-09-14",
      channels: [facebook, { channel: "tiktok", postsPerWeek: 0, bestTimes: ["20:00"] }]
    });
    expect(slots.every((slot) => slot.channel !== "tiktok")).toBe(true);
    expect(slots).toHaveLength(3);
  });

  it("gives channels on the same day one shared variant group", () => {
    const slots = generateWeekSlots({
      weekStart: "2026-09-14",
      channels: [
        { channel: "facebook", postsPerWeek: 1, bestTimes: ["12:00"] },
        { channel: "tiktok", postsPerWeek: 7, bestTimes: ["20:00"] }
      ]
    });

    const monday = slots.filter((slot) => slot.postDate === "2026-09-14");
    expect(monday).toHaveLength(2);
    expect(monday[0].variantGroup).toBe(monday[1].variantGroup);
  });

  it("gives a channel with a different audience its own group", () => {
    const slots = generateWeekSlots({
      weekStart: "2026-09-14",
      channels: [
        { channel: "facebook", postsPerWeek: 1, bestTimes: ["12:00"] },
        {
          channel: "tiktok",
          postsPerWeek: 7,
          bestTimes: ["20:00"],
          distinctAudience: true
        }
      ]
    });

    const monday = slots.filter((slot) => slot.postDate === "2026-09-14");
    expect(monday[0].variantGroup).not.toBe(monday[1].variantGroup);
  });

  it("returns nothing for an unusable week start", () => {
    expect(generateWeekSlots({ weekStart: "hôm nào đó", channels: [facebook] })).toEqual([]);
  });

  it("sorts by date, then by a stable channel order", () => {
    const slots = generateWeekSlots({
      weekStart: "2026-09-14",
      channels: [
        { channel: "youtube", postsPerWeek: 7, bestTimes: ["19:00"] },
        { channel: "facebook", postsPerWeek: 7, bestTimes: ["12:00"] }
      ]
    });

    const dates = slots.map((slot) => slot.postDate);
    expect([...dates].sort()).toEqual(dates);

    const monday = slots.filter((slot) => slot.postDate === "2026-09-14");
    expect(monday.map((slot) => slot.channel)).toEqual(["facebook", "youtube"]);
  });

  it("reports the weekly load a design team actually feels", () => {
    expect(
      weeklyLoad([
        { channel: "facebook", postsPerWeek: 3, bestTimes: [] },
        { channel: "tiktok", postsPerWeek: 2, bestTimes: [] }
      ])
    ).toBe(5);
  });
});

describe("nextStep — who has the ball", () => {
  it("asks for content first", () => {
    expect(nextStep({ status: "planned" }).waitingOn).toBe("ai");
  });

  it("asks the designer once there are words", () => {
    expect(nextStep({ status: "planned", content: "Bài viết" }).waitingOn).toBe("designer");
  });

  it("is ready to approve once there are words and artwork", () => {
    const step = nextStep({ status: "planned", content: "Bài viết", assetUrls: ["https://x/y.png"] });
    expect(step.waitingOn).toBe("approver");
  });

  it("waits for a person to publish after approval — nothing auto-posts", () => {
    expect(nextStep({ status: "approved" }).waitingOn).toBe("publisher");
  });

  it("is done once posted or skipped", () => {
    expect(nextStep({ status: "posted" }).waitingOn).toBe("done");
    expect(nextStep({ status: "skipped" }).waitingOn).toBe("done");
  });

  it("treats whitespace-only content as no content", () => {
    expect(nextStep({ status: "planned", content: "   " }).waitingOn).toBe("ai");
  });

  it("always returns a Vietnamese label", () => {
    for (const status of ["planned", "content_ready", "approved", "posted", "skipped"]) {
      expect(nextStep({ status }).label.length).toBeGreaterThan(0);
    }
  });
});

describe("derivedStatus and canApprove", () => {
  it("moves a post along as it gains content and artwork", () => {
    expect(derivedStatus({ status: "planned" })).toBe("planned");
    expect(derivedStatus({ status: "planned", content: "x" })).toBe("content_ready");
    expect(derivedStatus({ status: "planned", content: "x", assetUrls: ["u"] })).toBe("draft_ready");
  });

  it("never recomputes a decision somebody already made", () => {
    // Approved is a person's act, not a property of the row's contents.
    expect(derivedStatus({ status: "approved" })).toBe("approved");
    expect(derivedStatus({ status: "posted", content: "" })).toBe("posted");
    expect(derivedStatus({ status: "skipped" })).toBe("skipped");
  });

  it("refuses approval until there are both words and artwork", () => {
    expect(canApprove({ status: "planned" })).toBe(false);
    expect(canApprove({ status: "planned", content: "x" })).toBe(false);
    expect(canApprove({ status: "planned", content: "x", assetUrls: ["u"] })).toBe(true);
  });
});

describe("suggestScheduledAt", () => {
  const now = new Date("2026-09-15T03:00:00Z"); // 10:00 in Vietnam

  it("leaves a future slot exactly where the plan put it", () => {
    expect(
      suggestScheduledAt({ postDate: "2026-09-18", slotTime: "20:00", bestTimes: ["12:00", "20:00"], now })
    ).toBe("2026-09-18T20:00:00+07:00");
  });

  it("keeps today's slot when its hour has not arrived", () => {
    expect(
      suggestScheduledAt({ postDate: "2026-09-15", slotTime: "20:00", bestTimes: ["12:00", "20:00"], now })
    ).toBe("2026-09-15T20:00:00+07:00");
  });

  it("moves a slot whose hour has passed to the next golden hour today", () => {
    expect(
      suggestScheduledAt({ postDate: "2026-09-15", slotTime: "08:00", bestTimes: ["12:00", "20:00"], now })
    ).toBe("2026-09-15T12:00:00+07:00");
  });

  it("moves to tomorrow when no golden hour is left today", () => {
    const late = new Date("2026-09-15T14:00:00Z"); // 21:00 in Vietnam
    expect(
      suggestScheduledAt({ postDate: "2026-09-15", slotTime: "12:00", bestTimes: ["12:00", "20:00"], now: late })
    ).toBe("2026-09-16T12:00:00+07:00");
  });

  it("never schedules a stale slot into the past", () => {
    const suggestion = suggestScheduledAt({
      postDate: "2026-09-07",
      slotTime: "12:00",
      bestTimes: ["12:00", "20:00"],
      now
    });

    expect(new Date(suggestion).getTime()).toBeGreaterThan(now.getTime());
  });

  it("always carries an explicit offset rather than a bare local string", () => {
    const suggestion = suggestScheduledAt({ postDate: "2026-09-18", slotTime: "20:00", now });
    expect(suggestion).toMatch(/\+07:00$/);
  });
});

describe("evaluateMktAiGate", () => {
  it("is off unless deliberately switched on", () => {
    const gate = evaluateMktAiGate({ DEEPSEEK_API_KEY: "k" });
    expect(gate.canRun).toBe(false);
    if (!gate.canRun) expect(gate.reason).toContain("VAM_OS_MKT_AI_ENABLED");
  });

  it("refuses without a DeepSeek key", () => {
    const gate = evaluateMktAiGate({ VAM_OS_MKT_AI_ENABLED: "true" });
    expect(gate.canRun).toBe(false);
    if (!gate.canRun) expect(gate.reason).toContain("DEEPSEEK_API_KEY");
  });

  it("refuses a base URL that is not https", () => {
    const gate = evaluateMktAiGate({
      VAM_OS_MKT_AI_ENABLED: "true",
      DEEPSEEK_API_KEY: "k",
      DEEPSEEK_BASE_URL: "http://api.deepseek.com"
    });
    expect(gate.canRun).toBe(false);
  });

  it("runs on DeepSeek with a sensible default model", () => {
    const gate = evaluateMktAiGate({ VAM_OS_MKT_AI_ENABLED: "true", DEEPSEEK_API_KEY: "k" });
    expect(gate.canRun).toBe(true);
    if (gate.canRun) {
      expect(gate.model).toBe("deepseek-chat");
      expect(gate.baseUrl).toBe("https://api.deepseek.com");
    }
  });

  it("has its own switch, separate from assisted matching", () => {
    // A programme may want help writing posts and no help pairing people.
    const gate = evaluateMktAiGate({
      VAM_OS_AI_MATCHING_ENABLED: "true",
      DEEPSEEK_API_KEY: "k"
    } as never);
    expect(gate.canRun).toBe(false);
  });
});

describe("readJsonObject", () => {
  it("reads a bare object", () => {
    expect(readJsonObject('{"a":1}')).toEqual({ a: 1 });
  });

  it("unwraps a fenced block", () => {
    expect(readJsonObject('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it("ignores a sentence before the object", () => {
    expect(readJsonObject('Đây là kết quả:\n{"a":1}')).toEqual({ a: 1 });
  });

  it("throws on something that is not JSON at all", () => {
    expect(() => readJsonObject("xin chào")).toThrow();
  });
});

describe("mergeIntoSlots — the last line of defence", () => {
  const slots = generateWeekSlots({
    weekStart: "2026-09-14",
    channels: [{ channel: "facebook", postsPerWeek: 3, bestTimes: ["12:00"] }]
  });

  it("matches an answer to its slot by date and channel", () => {
    const { merged, missing } = mergeIntoSlots(slots, [
      { date: "2026-09-14", channel: "facebook", content: "một" },
      { date: "2026-09-16", channel: "facebook", content: "hai" },
      { date: "2026-09-18", channel: "facebook", content: "ba" }
    ]);

    expect(missing).toBe(0);
    expect(merged.map((item) => item.answer?.content)).toEqual(["một", "hai", "ba"]);
  });

  it("leaves a slot empty and counts it rather than inventing something", () => {
    const { merged, missing } = mergeIntoSlots(slots, [
      { date: "2026-09-14", channel: "facebook", content: "một" }
    ]);

    expect(missing).toBe(2);
    expect(merged[1].answer).toBeNull();
    expect(merged[2].answer).toBeNull();
  });

  it("drops an answer for a date that was never a slot", () => {
    const { merged, missing } = mergeIntoSlots(slots, [
      { date: "2026-09-15", channel: "facebook", content: "ngày không có slot" }
    ]);

    expect(missing).toBe(3);
    expect(merged.every((item) => item.answer === null)).toBe(true);
  });

  it("drops an answer for a channel this space does not run", () => {
    const { missing } = mergeIntoSlots(slots, [
      { date: "2026-09-14", channel: "linkedin", content: "sai kênh" }
    ]);
    expect(missing).toBe(3);
  });

  it("falls back to the variant group when the model got the date wrong", () => {
    const { merged, missing } = mergeIntoSlots(slots, [
      { variant_group: slots[0].variantGroup, channel: "facebook", content: "cứu được" }
    ]);

    expect(missing).toBe(2);
    expect(merged[0].answer?.content).toBe("cứu được");
  });

  it("never uses one answer for two slots", () => {
    const { merged } = mergeIntoSlots(slots, [
      { date: "2026-09-14", channel: "facebook", content: "một" }
    ]);

    const used = merged.filter((item) => item.answer).length;
    expect(used).toBe(1);
  });

  it("survives an empty or malformed answer list", () => {
    expect(mergeIntoSlots(slots, []).missing).toBe(3);
    expect(mergeIntoSlots(slots, null as never).missing).toBe(3);
  });
});
