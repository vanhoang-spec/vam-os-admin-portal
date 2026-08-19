/**
 * Reading a Facebook recap post.
 *
 * Every rule under test here is a guess about text somebody else wrote, so the
 * cases are drawn from what the posts actually look like: three host spellings
 * for the same link, timestamps written as "Hôm qua", headers that follow the
 * house format and headers that plainly do not.
 */
import { describe, it, expect } from "vitest";

import {
  daysInMonth,
  groupIdFromPermalink,
  hasOnlyTrackingParams,
  looksTruncated,
  mapMeetingType,
  monthFromDate,
  normalizePermalink,
  normalizeStudentId,
  parsePostHeader,
  parseRelativeVietnameseTime,
  parseWrittenDate,
  preparePayload,
  resolveCollectionPeriod,
  toVnDate,
  MAX_ITEMS_PER_BATCH
} from "@/lib/recap-import-core";

/** A fixed "now" so relative timestamps resolve to something assertable. */
const NOW = new Date("2026-03-20T10:00:00+07:00");

describe("normalizePermalink — one post, one string", () => {
  const canonical = "https://www.facebook.com/groups/123456789/posts/987654321";

  it("collapses every host spelling Facebook hands out", () => {
    for (const host of ["www.facebook.com", "m.facebook.com", "web.facebook.com", "mbasic.facebook.com"]) {
      expect(normalizePermalink(`https://${host}/groups/123456789/posts/987654321`)).toBe(canonical);
    }
  });

  it("drops the tracking query and the fragment", () => {
    expect(
      normalizePermalink(
        `${canonical}/?__cft__[0]=AZW9x&__tn__=%2CO%2CP-R&comment_id=42#comments`
      )
    ).toBe(canonical);
  });

  it("treats a trailing slash as the same post", () => {
    expect(normalizePermalink(`${canonical}/`)).toBe(canonical);
  });

  it("accepts the older /permalink/ shape", () => {
    expect(normalizePermalink("https://www.facebook.com/groups/vam/permalink/555/")).toBe(
      "https://www.facebook.com/groups/vam/permalink/555"
    );
  });

  it("refuses anything that is not a group post", () => {
    for (const value of [
      "",
      null,
      undefined,
      "not a url",
      "https://facebook.com/someuser/posts/1",
      "https://example.com/groups/1/posts/2",
      "javascript:alert(1)",
      "https://www.facebook.com/groups/123456789"
    ]) {
      expect(normalizePermalink(value), String(value)).toBeNull();
    }
  });

  it("reads the group id back out", () => {
    expect(groupIdFromPermalink(canonical)).toBe("123456789");
    expect(groupIdFromPermalink("https://example.com")).toBeNull();
  });

  it("recognises a URL carrying only Facebook's own noise", () => {
    expect(hasOnlyTrackingParams(`${canonical}?__cft__[0]=abc&__tn__=R`)).toBe(true);
    expect(hasOnlyTrackingParams(`${canonical}?comment_id=42`)).toBe(false);
  });
});

describe("dates", () => {
  it("reads a date the Vietnamese way — day first", () => {
    expect(parseWrittenDate("14/03/2026")).toBe("2026-03-14");
    expect(parseWrittenDate("03/04/2026")).toBe("2026-04-03");
    expect(parseWrittenDate("14-3-26")).toBe("2026-03-14");
    expect(parseWrittenDate("2026-03-14")).toBe("2026-03-14");
  });

  it("fills in the current year when the writer left it out", () => {
    expect(parseWrittenDate("14/03", NOW)).toBe("2026-03-14");
  });

  it("refuses a date that does not exist", () => {
    expect(parseWrittenDate("31/02/2026")).toBeNull();
    expect(parseWrittenDate("45/13/2026")).toBeNull();
    expect(parseWrittenDate("")).toBeNull();
  });

  it("resolves the relative timestamps Facebook prints", () => {
    expect(parseRelativeVietnameseTime("2 giờ", NOW)).toBe("2026-03-20");
    expect(parseRelativeVietnameseTime("45 phút", NOW)).toBe("2026-03-20");
    expect(parseRelativeVietnameseTime("Hôm qua lúc 21:30", NOW)).toBe("2026-03-19");
    expect(parseRelativeVietnameseTime("3 ngày", NOW)).toBe("2026-03-17");
    expect(parseRelativeVietnameseTime("2 tuần", NOW)).toBe("2026-03-06");
  });

  it("prefers an absolute date in the label over anything relative", () => {
    expect(parseRelativeVietnameseTime("5 Tháng 3, 2026", NOW)).toBe("2026-03-05");
    expect(parseRelativeVietnameseTime("14/03/2026", NOW)).toBe("2026-03-14");
  });

  it("says nothing rather than guessing", () => {
    expect(parseRelativeVietnameseTime("", NOW)).toBeNull();
    expect(parseRelativeVietnameseTime("Đã chỉnh sửa", NOW)).toBeNull();
  });

  it("reads an instant into a Vietnamese calendar day", () => {
    // 23:30 UTC is already the next morning in Ho Chi Minh City.
    expect(toVnDate("2026-03-14T23:30:00Z")).toBe("2026-03-15");
    expect(toVnDate("nonsense")).toBeNull();
  });

  it("files a recap into its month", () => {
    expect(monthFromDate("2026-03-14")).toBe("2026-03");
    expect(monthFromDate(null)).toBeNull();
  });
});

describe("parsePostHeader — the first lines of a post", () => {
  const post = [
    "#UEHEM11104 #mentoring",
    "[RECAP BUỔI 3 - 14/03/2026]",
    "Mentor: Nguyễn Văn A",
    "Mentee: Trần Thị B",
    "Thời gian: 19h00 - 20h30",
    "Địa điểm: The Coffee House Nguyễn Huệ",
    "-------------",
    "Buổi này em và mentor trao đổi về định hướng nghề nghiệp...",
    "Em học được rất nhiều điều."
  ].join("\n");

  it("reads every field the house format asks for", () => {
    const parsed = parsePostHeader(post, NOW);
    expect(parsed.mssv).toBe("UEHEM11104");
    expect(parsed.meetingType).toBe("1on1_primary");
    expect(parsed.topic).toBe("RECAP BUỔI 3 - 14/03/2026");
    expect(parsed.mentorNames).toBe("Nguyễn Văn A");
    expect(parsed.menteeNames).toBe("Trần Thị B");
    expect(parsed.meetingTimeRaw).toBe("19h00 - 20h30");
    expect(parsed.location).toBe("The Coffee House Nguyễn Huệ");
  });

  it("takes the meeting date from the header, not from the posting time", () => {
    // Written up on the 20th, about a meeting on the 14th.
    expect(parsePostHeader(post, NOW).writtenDate).toBe("2026-03-14");
  });

  it("keeps both names when a cross-mentoring post lists two mentors", () => {
    const cross = [
      "#HAM2045 #crossmentoring",
      "[Cross mentoring - chủ đề Data]",
      "Mentor: Lê Văn C",
      "Mentor: Phạm Thị D",
      "Mentee: Trần Thị B"
    ].join("\n");

    const parsed = parsePostHeader(cross, NOW);
    expect(parsed.meetingType).toBe("1on1_cross");
    expect(parsed.mentorNames).toBe("Lê Văn C, Phạm Thị D");
    expect(parsed.mssv).toBe("HAM2045");
  });

  it("still produces a row when the post ignores the format entirely", () => {
    const parsed = parsePostHeader("Hôm nay em gặp mentor, rất vui ạ!", NOW);
    expect(parsed.mssv).toBeNull();
    expect(parsed.meetingType).toBeNull();
    expect(parsed.mentorNames).toBeNull();
    // Nothing threw — a post nobody can parse is still a post worth reviewing.
  });

  it("does not mistake the student id hashtag for the meeting type", () => {
    expect(parsePostHeader("#UEHEM11104\nnội dung", NOW).meetingType).toBeNull();
  });

  it("maps the hashtags the programme actually uses", () => {
    expect(mapMeetingType("#mentoring")).toBe("1on1_primary");
    expect(mapMeetingType("crossmentoring")).toBe("1on1_cross");
    expect(mapMeetingType("groupmentoring")).toBe("group");
    expect(mapMeetingType("online")).toBe("online");
    expect(mapMeetingType("chuyenlinhtinh")).toBeNull();
  });

  it("reads a header written with CRLF line endings", () => {
    const parsed = parsePostHeader("#UEHEM11104 #mentoring\r\nMentor: Nguyễn Văn A\r\n", NOW);
    expect(parsed.mentorNames).toBe("Nguyễn Văn A");
  });
});

describe("looksTruncated — half a recap is worse than a flagged one", () => {
  it("spots the ways Facebook cuts text off", () => {
    expect(looksTruncated("Buổi này em học được… Xem thêm")).toBe(true);
    expect(looksTruncated("Nội dung dài quá…")).toBe(true);
    expect(looksTruncated("Nội dung dài quá...")).toBe(true);
    expect(looksTruncated("See more")).toBe(true);
  });

  it("leaves a complete post alone", () => {
    expect(looksTruncated("Em cảm ơn mentor rất nhiều!")).toBe(false);
    expect(looksTruncated("")).toBe(false);
  });
});

describe("normalizeStudentId", () => {
  it("compares ids the way people write them", () => {
    expect(normalizeStudentId("uehem-11104")).toBe("UEHEM11104");
    expect(normalizeStudentId(" 31201 023456 ")).toBe("31201023456");
    expect(normalizeStudentId(null)).toBe("");
  });
});

describe("preparePayload — what the extension is allowed to send", () => {
  const item = (permalink: string, content = "#UEHEM11104 #mentoring\nnội dung") => ({
    permalink,
    content,
    author_name: "Trần Thị B",
    posted_at: "2026-03-14T12:00:00Z"
  });

  it("accepts a well-formed batch and parses each post", () => {
    const result = preparePayload(
      {
        group_id: "123456789",
        items: [item("https://m.facebook.com/groups/123456789/posts/1?__cft__[0]=x")]
      },
      NOW
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.groupId).toBe("123456789");
    expect(result.items).toHaveLength(1);
    expect(result.items[0].permalink).toBe("https://www.facebook.com/groups/123456789/posts/1");
    expect(result.items[0].mssv_raw).toBe("UEHEM11104");
    expect(result.items[0].meeting_type).toBe("1on1_primary");
    expect(result.items[0].author_name).toBe("Trần Thị B");
  });

  it("collapses a post the feed rendered twice in one scan", () => {
    const result = preparePayload(
      {
        group_id: "123456789",
        items: [
          item("https://www.facebook.com/groups/123456789/posts/1"),
          item("https://m.facebook.com/groups/123456789/posts/1/?__tn__=R")
        ]
      },
      NOW
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.items).toHaveLength(1);
  });

  it("names what it could not file rather than dropping it silently", () => {
    const result = preparePayload(
      {
        group_id: "123456789",
        items: [item("https://www.facebook.com/groups/123456789/posts/1"), item("khong-phai-url")]
      },
      NOW
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.items).toHaveLength(1);
    expect(result.skipped).toEqual(["khong-phai-url"]);
  });

  it("refuses a payload with no usable group id", () => {
    expect(preparePayload({ group_id: "", items: [item("x")] }, NOW)).toMatchObject({ ok: false });
    expect(preparePayload({ group_id: "a b/c", items: [item("x")] }, NOW)).toMatchObject({
      ok: false
    });
  });

  it("refuses an empty or oversized batch", () => {
    expect(preparePayload({ group_id: "123456789", items: [] }, NOW)).toMatchObject({ ok: false });

    const many = Array.from({ length: MAX_ITEMS_PER_BATCH + 1 }, (_unused, index) =>
      item(`https://www.facebook.com/groups/123456789/posts/${index}`)
    );
    expect(preparePayload({ group_id: "123456789", items: many }, NOW)).toMatchObject({ ok: false });
  });

  it("refuses a payload where nothing had a usable link", () => {
    const result = preparePayload({ group_id: "123456789", items: [item("nope")] }, NOW);
    expect(result.ok).toBe(false);
  });

  it("caps how much text one post can store", () => {
    const result = preparePayload(
      {
        group_id: "123456789",
        items: [item("https://www.facebook.com/groups/123456789/posts/1", "x".repeat(50_000))]
      },
      NOW
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect((result.items[0].content_full ?? "").length).toBeLessThanOrEqual(20_000);
  });
});

describe("resolveCollectionPeriod — the twice-monthly rhythm", () => {
  it("closes the first half on the 15th", () => {
    expect(resolveCollectionPeriod("2026-03-15")).toEqual({
      label: "Kỳ 1 tháng 03/2026",
      start: "2026-03-01",
      end: "2026-03-15"
    });
  });

  it("closes the second half on the last day, whatever day that is", () => {
    expect(resolveCollectionPeriod("2026-03-31")?.end).toBe("2026-03-31");
    expect(resolveCollectionPeriod("2026-04-30")?.end).toBe("2026-04-30");
    expect(resolveCollectionPeriod("2026-02-28")?.end).toBe("2026-02-28");
    // A leap year: the 28th is no longer the last day.
    expect(resolveCollectionPeriod("2028-02-28")).toBeNull();
    expect(resolveCollectionPeriod("2028-02-29")?.start).toBe("2028-02-16");
  });

  it("does nothing on every other day", () => {
    for (const day of ["2026-03-01", "2026-03-14", "2026-03-16", "2026-03-30"]) {
      expect(resolveCollectionPeriod(day), day).toBeNull();
    }
    expect(resolveCollectionPeriod("khong-phai-ngay")).toBeNull();
  });

  it("counts the days in a month, February included", () => {
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2028, 2)).toBe(29);
    expect(daysInMonth(2026, 4)).toBe(30);
    expect(daysInMonth(2026, 12)).toBe(31);
  });
});
