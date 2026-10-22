/**
 * Thư kết quả ghép cặp — phần thuần: ai nhận thư, vì sao chưa nhận, khi nào nút gửi bị khoá.
 *
 * Sai ở đây là gửi nhầm người thật: một mentor trong nhóm 17 người BTC dặn giữ lại nhận thư thường,
 * một mentee nhận link tới mentor đã rút, một mentor có 3 mentee nhận thư chỉ mang 2 link vì BTC vừa
 * ghép người thứ ba. Mỗi ca dưới đây khoá một trong những đường đó.
 */
import { describe, expect, it } from "vitest";
import {
  SETTLE_MINUTES,
  batchSize,
  buildRecipients,
  dispatchGroups,
  countByStatus,
  holdsFingerprint,
  missingFieldLabels,
  parseHoldEmailInput,
  planDispatchBatch,
  profileCoverage,
  resolveHoldEmails,
  sendBlockedReasons,
  validateHttpsUrl,
  type ActiveMatch,
  type MatchResultRecipient,
  type NoticeInfo,
  type RecipientPerson
} from "@/lib/match-result-core";

const NOW = Date.parse("2026-10-22T10:00:00Z");
const OLD = "2026-10-20T00:00:00Z";
const minutesAgo = (n: number) => new Date(NOW - n * 60 * 1000).toISOString();

function match(id: string, mentor: string, mentee: string, over: Partial<ActiveMatch> = {}): ActiveMatch {
  return { id, mentorPersonId: mentor, menteePersonId: mentee, createdAt: OLD, round: 1, ...over };
}

const PEOPLE = new Map<string, RecipientPerson>([
  ["mt-a", { fullName: "Anh Mentor A", email: "a@example.com" }],
  ["mt-b", { fullName: "Bình Mentor B", email: "B@Example.com" }],
  ["me-1", { fullName: "Chi Mentee 1", email: "c1@example.com" }],
  ["me-2", { fullName: "An Mentee 2", email: "c2@example.com" }],
  ["me-3", { fullName: "Bảo Mentee 3", email: "c3@example.com" }],
  ["me-4", { fullName: "Dung Mentee 4", email: "c4@example.com" }]
]);

function build(over: Partial<Parameters<typeof buildRecipients>[0]> = {}) {
  return buildRecipients({
    matches: [
      match("m1", "mt-a", "me-1", { round: 1 }),
      match("m2", "mt-a", "me-2", { round: 3 }),
      match("m3", "mt-a", "me-3", { round: null }),
      match("m4", "mt-b", "me-4", { round: 2 })
    ],
    people: PEOPLE,
    heldMentorIds: new Set(),
    inactiveKeys: new Set(),
    notices: [],
    now: NOW,
    ...over
  });
}

function find(list: MatchResultRecipient[], role: "mentor" | "mentee", personId: string) {
  const r = list.find((x) => x.role === role && x.personId === personId);
  if (!r) throw new Error(`không có ${role}:${personId}`);
  return r;
}

describe("gộp người nhận", () => {
  it("mentor 3 mentee nhận MỘT thư mang cả 3, mọi vòng (1, 3, ghép tay) đều tính", () => {
    const list = build();
    const a = find(list, "mentor", "mt-a");
    expect(a.partners.map((p) => p.personId)).toEqual(["me-2", "me-3", "me-1"]); // theo tên: An, Bảo, Chi
    expect(a.matchIds).toEqual(["m1", "m2", "m3"]);
    expect(a.status).toBe("pending");
    expect(list.filter((r) => r.role === "mentor" && r.personId === "mt-a")).toHaveLength(1);
  });

  it("mỗi mentee một thư, mang đúng mentor của mình", () => {
    const list = build();
    expect(list.filter((r) => r.role === "mentee")).toHaveLength(4);
    expect(find(list, "mentee", "me-4").partners).toEqual([{ personId: "mt-b", fullName: "Bình Mentor B", matchId: "m4", round: 2 }]);
  });

  it("email chuẩn hoá chữ thường", () => {
    expect(find(build(), "mentor", "mt-b").email).toBe("b@example.com");
  });

  it("mentor đứng trước, rồi theo tên", () => {
    expect(build().map((r) => `${r.role}:${r.personId}`)).toEqual([
      "mentor:mt-a", "mentor:mt-b", "mentee:me-2", "mentee:me-3", "mentee:me-1", "mentee:me-4"
    ]);
  });
});

describe("giữ lại", () => {
  it("mentor bị giữ: thư của mentor VÀ của mọi mentee của họ đều bị giữ; cặp khác vẫn chờ gửi", () => {
    const list = build({ heldMentorIds: new Set(["mt-a"]) });
    expect(find(list, "mentor", "mt-a")).toMatchObject({ status: "held", holdReason: "mentor_held" });
    for (const id of ["me-1", "me-2", "me-3"]) expect(find(list, "mentee", id)).toMatchObject({ status: "held", holdReason: "partner_held" });
    expect(find(list, "mentor", "mt-b").status).toBe("pending");
    expect(find(list, "mentee", "me-4").status).toBe("pending");
  });

  it("không đọc được danh sách giữ lại: KHÔNG ai chờ gửi (fail-closed)", () => {
    const list = build({ heldMentorIds: null });
    expect(list.every((r) => r.status === "held" && r.holdReason === "holds_unreadable")).toBe(true);
  });

  it("giữ lại xếp trước thiếu email và cặp mới", () => {
    const people = new Map(PEOPLE);
    people.set("mt-a", { fullName: "Anh Mentor A", email: null });
    const list = build({ people, heldMentorIds: new Set(["mt-a"]), matches: [match("m1", "mt-a", "me-1", { createdAt: minutesAgo(1) })] });
    expect(find(list, "mentor", "mt-a").status).toBe("held");
    expect(find(list, "mentee", "me-1").status).toBe("held");
  });

  it("người đã rút: thư của họ bị giữ, và thư của người đồng hành cũng bị giữ (link sẽ báo hết hiệu lực)", () => {
    const list = build({ inactiveKeys: new Set(["mentee:me-2"]) });
    expect(find(list, "mentee", "me-2")).toMatchObject({ status: "held", holdReason: "self_inactive" });
    expect(find(list, "mentor", "mt-a")).toMatchObject({ status: "held", holdReason: "partner_inactive" });
    expect(find(list, "mentee", "me-1").status).toBe("pending");
  });

  it("trạng thái rút theo đúng vai: rút ở vai mentee không giữ thư mentor của cùng người", () => {
    const list = build({ inactiveKeys: new Set(["mentee:mt-a"]) });
    expect(find(list, "mentor", "mt-a").status).toBe("pending");
  });
});

describe("thiếu email và cặp mới", () => {
  it("thiếu email hoặc email hỏng → thiếu email", () => {
    const people = new Map(PEOPLE);
    people.set("me-1", { fullName: "Chi Mentee 1", email: null });
    people.set("me-4", { fullName: "Dung Mentee 4", email: "khong-phai-email" });
    const list = build({ people });
    expect(find(list, "mentee", "me-1").status).toBe("missing_email");
    expect(find(list, "mentee", "me-4").status).toBe("missing_email");
    expect(find(list, "mentor", "mt-a").status).toBe("pending");
  });

  it(`một cặp mới hơn ${SETTLE_MINUTES} phút giữ CẢ thư của mentor; mentee cặp cũ vẫn đi`, () => {
    const list = build({
      matches: [match("m1", "mt-a", "me-1"), match("m2", "mt-a", "me-2", { createdAt: minutesAgo(10) })]
    });
    expect(find(list, "mentor", "mt-a").status).toBe("too_new");
    expect(find(list, "mentee", "me-2").status).toBe("too_new");
    expect(find(list, "mentee", "me-1").status).toBe("pending");
  });

  it(`đúng ${SETTLE_MINUTES} phút thì gửi được; thiếu giờ tạo thì coi là mới`, () => {
    expect(find(build({ matches: [match("m1", "mt-a", "me-1", { createdAt: minutesAgo(SETTLE_MINUTES) })] }), "mentor", "mt-a").status).toBe("pending");
    expect(find(build({ matches: [match("m1", "mt-a", "me-1", { createdAt: minutesAgo(SETTLE_MINUTES - 1) })] }), "mentor", "mt-a").status).toBe("too_new");
    expect(find(build({ matches: [match("m1", "mt-a", "me-1", { createdAt: null })] }), "mentor", "mt-a").status).toBe("too_new");
  });
});

describe("đã gửi và đổi cặp", () => {
  const sent = (personId: string, role: "mentor" | "mentee", matchIds: string[], over: Partial<NoticeInfo> = {}): NoticeInfo => ({
    personId, role, matchIds, sentAt: "2026-10-22T08:00:00Z", lastError: null, ...over
  });

  it("đã gửi với đúng các cặp hiện có (thứ tự khác) → đã gửi", () => {
    const list = build({ notices: [sent("mt-a", "mentor", ["m3", "m1", "m2"])] });
    expect(find(list, "mentor", "mt-a")).toMatchObject({ status: "sent", sentAt: "2026-10-22T08:00:00Z" });
  });

  it("BTC ghép thêm mentee sau khi gửi → đổi cặp sau khi gửi", () => {
    const list = build({ notices: [sent("mt-a", "mentor", ["m1", "m2"])] });
    expect(find(list, "mentor", "mt-a").status).toBe("changed_since_sent");
  });

  it("đã gửi rồi mới bị giữ lại: vẫn là đã gửi (thư đã đi)", () => {
    const list = build({ heldMentorIds: new Set(["mt-b"]), notices: [sent("mt-b", "mentor", ["m4"])] });
    expect(find(list, "mentor", "mt-b").status).toBe("sent");
  });

  it("thư đã chiếm chỗ nhưng chưa gửi được → tính như chưa gửi", () => {
    const list = build({ notices: [sent("mt-b", "mentor", ["m4"], { sentAt: null, lastError: "429" })] });
    expect(find(list, "mentor", "mt-b")).toMatchObject({ status: "pending", lastError: "429" });
  });

  it("đã nhận thư nhưng giờ không còn cặp nào → vẫn hiện, ở đổi cặp sau khi gửi", () => {
    const list = build({ notices: [sent("me-9", "mentee", ["m9"])] });
    const gone = list.find((r) => r.personId === "me-9");
    expect(gone).toMatchObject({ role: "mentee", status: "changed_since_sent", partners: [], matchIds: [] });
  });

  it("đếm theo vai và trạng thái", () => {
    const counts = countByStatus(build({ heldMentorIds: new Set(["mt-a"]), notices: [sent("mt-b", "mentor", ["m4"])] }));
    expect(counts.mentor).toMatchObject({ held: 1, sent: 1, pending: 0 });
    expect(counts.mentee).toMatchObject({ held: 3, pending: 1 });
  });
});

describe("danh sách mentor giữ lại", () => {
  it("tách theo xuống dòng, dấu phẩy, chấm phẩy, khoảng trắng; chữ thường; bỏ trùng; báo mục hỏng", () => {
    const parsed = parseHoldEmailInput("A@x.com\nb@y.com, a@x.com;  c@z.vn\tkhong-hop-le  \r\n");
    expect(parsed.emails).toEqual(["a@x.com", "b@y.com", "c@z.vn"]);
    expect(parsed.invalid).toEqual(["khong-hop-le"]);
  });

  it("mỗi email phải khớp đúng một mentor: không khớp và khớp hai người đều báo lại, không đoán", () => {
    const res = resolveHoldEmails(["a@x.com", "phu@x.com", "chung@x.com", "khong@x.com"], [
      { personId: "p1", fullName: "Một", emails: ["A@X.com", "phu@x.com"] },
      { personId: "p2", fullName: "Hai", emails: ["chung@x.com"] },
      { personId: "p3", fullName: "Ba", emails: ["chung@x.com", null as unknown as string] }
    ]);
    expect(res.matched).toEqual([{ email: "a@x.com", personId: "p1", fullName: "Một" }]); // phu@ cùng người: không thêm lần hai
    expect(res.unmatched).toEqual([
      { email: "chung@x.com", reason: "ambiguous", names: ["Hai", "Ba"] },
      { email: "khong@x.com", reason: "not_found", names: [] }
    ]);
  });

  it("dấu danh sách không phụ thuộc thứ tự, bỏ trùng", () => {
    expect(holdsFingerprint(["b", "a", "b"])).toBe(holdsFingerprint(["a", "b"]));
    expect(holdsFingerprint(["a"])).not.toBe(holdsFingerprint(["a", "b"]));
  });
});

describe("link trong cài đặt", () => {
  it.each([
    ["", true, null],
    ["  https://drive.google.com/file/d/abc/view  ", true, "https://drive.google.com/file/d/abc/view"],
    ["http://drive.google.com/x", false, null],
    ["javascript:alert(1)", false, null],
    ["https://a b.com", false, null],
    ["https://", false, null],
    [`https://x.com/${"a".repeat(490)}`, false, null]
  ])("%j → hợp lệ: %s", (raw, ok, value) => {
    const r = validateHttpsUrl(raw);
    expect(r.ok).toBe(ok);
    if (r.ok) expect(r.value).toBe(value);
  });
});

describe("lý do khoá gửi", () => {
  const ready = {
    menteeHandbookUrl: "https://example.com/mentee",
    mentorHandbookUrl: "https://example.com/mentor",
    kickoffRegisterUrl: null,
    holdsConfirmedAt: "2026-10-22T09:00:00Z"
  };

  it("đủ hai Handbook và đã xác nhận danh sách giữ lại → gửi được; thiếu Kick-off không chặn", () => {
    expect(sendBlockedReasons({ settings: ready, settingsReadOk: true, holdsReadOk: true })).toEqual([]);
  });

  it.each([
    ["thiếu Handbook mentee", { ...ready, menteeHandbookUrl: null }, "Chưa nhập link Handbook cho mentee."],
    ["thiếu Handbook mentor", { ...ready, mentorHandbookUrl: null }, "Chưa nhập link Handbook cho mentor."],
    ["Handbook lưu sẵn không phải https", { ...ready, mentorHandbookUrl: "http://x.com" }, "Chưa nhập link Handbook cho mentor."],
    ["chưa xác nhận danh sách giữ lại", { ...ready, holdsConfirmedAt: null }, "Danh sách mentor giữ lại chưa được xác nhận."]
  ])("%s", (_label, settings, reason) => {
    expect(sendBlockedReasons({ settings, settingsReadOk: true, holdsReadOk: true })).toEqual([reason]);
  });

  it("chưa có dòng cài đặt nào → khoá vì cả ba", () => {
    expect(sendBlockedReasons({ settings: null, settingsReadOk: true, holdsReadOk: true })).toHaveLength(3);
  });

  it("không đọc được cài đặt hoặc danh sách giữ lại → khoá (fail-closed)", () => {
    expect(sendBlockedReasons({ settings: null, settingsReadOk: false, holdsReadOk: true })).toEqual(["Không đọc được cài đặt thư — tạm khoá gửi."]);
    expect(sendBlockedReasons({ settings: ready, settingsReadOk: true, holdsReadOk: false })).toEqual([
      "Không đọc được danh sách mentor giữ lại — tạm khoá gửi."
    ]);
  });
});

describe("độ phủ hồ sơ", () => {
  const card = (keys: string[]) => ({ role: "mentor" as const, fields: keys.map((key) => ({ key, label: key, value: "x" })) });

  it("đếm mỗi trường có ở bao nhiêu thẻ, đúng thứ tự BTC", () => {
    const cov = profileCoverage("mentor", [card(["full_name", "linkedin"]), card(["full_name"])]);
    expect(cov.total).toBe(2);
    expect(cov.fields[0]).toEqual({ key: "full_name", label: "Họ và tên", present: 2 });
    expect(cov.fields.find((f) => f.key === "linkedin")?.present).toBe(1);
    expect(cov.fields).toHaveLength(13);
  });

  it("nhãn các trường bị ẩn trên một thẻ", () => {
    const missing = missingFieldLabels(card(["full_name", "group", "phone", "email", "title_current", "company_current", "industry", "years", "strengths", "mentoring_topics", "motivation_text"]));
    expect(missing).toEqual(["Mong muốn về Mentee đồng hành", "LinkedIn / Hồ sơ nghề nghiệp"]);
  });
});

describe("chia lô theo nhóm mentor (mentor + mentee của họ cùng một lần bấm)", () => {
  // mt-a: 3 mentee (me-1, me-2, me-3); mt-b: 1 mentee (me-4).
  const groupsOf = (over: Partial<Parameters<typeof buildRecipients>[0]> = {}) => dispatchGroups(build(over));
  const ids = (g: { members: MatchResultRecipient[] }) => g.members.map((m) => `${m.role}:${m.personId}`);

  it("mỗi mentor một nhóm, mentor đứng trước rồi các mentee của mình", () => {
    const groups = groupsOf();
    expect(groups.map((g) => g.mentorPersonId)).toEqual(["mt-a", "mt-b"]);
    expect(ids(groups[0])).toEqual(["mentor:mt-a", "mentee:me-2", "mentee:me-3", "mentee:me-1"]);
    expect(ids(groups[1])).toEqual(["mentor:mt-b", "mentee:me-4"]);
  });

  it("nhóm có cặp mới: CẢ nhóm chờ, kể cả mentee của cặp cũ; nhóm khác vẫn đi", () => {
    const groups = groupsOf({
      matches: [match("m1", "mt-a", "me-1"), match("m2", "mt-a", "me-2", { createdAt: minutesAgo(5) }), match("m4", "mt-b", "me-4")]
    });
    expect(groups.map((g) => g.mentorPersonId)).toEqual(["mt-b"]);
  });

  it("mentor bị giữ: cả nhóm không có ai để gửi", () => {
    expect(groupsOf({ heldMentorIds: new Set(["mt-a"]) }).map((g) => g.mentorPersonId)).toEqual(["mt-b"]);
  });

  it("mentor thiếu email: mentee của họ vẫn đi; mentee thiếu email không chặn mentor", () => {
    const people = new Map(PEOPLE);
    people.set("mt-b", { fullName: "Bình Mentor B", email: null });
    people.set("me-1", { fullName: "Chi Mentee 1", email: null });
    const groups = groupsOf({ people });
    expect(ids(groups.find((g) => g.mentorPersonId === "mt-b")!)).toEqual(["mentee:me-4"]);
    expect(ids(groups.find((g) => g.mentorPersonId === "mt-a")!)).toEqual(["mentor:mt-a", "mentee:me-2", "mentee:me-3"]);
  });

  it("mentor đã nhận thư, BTC ghép thêm mentee mới: chỉ mentee mới trong nhóm (mentor gửi lại riêng)", () => {
    const groups = groupsOf({ notices: [{ personId: "mt-b", role: "mentor", matchIds: ["m4"], sentAt: "2026-10-22T08:00:00Z", lastError: null }, { personId: "me-4", role: "mentee", matchIds: ["m4"], sentAt: "2026-10-22T08:00:00Z", lastError: null }],
      matches: [match("m1", "mt-a", "me-1"), match("m4", "mt-b", "me-4"), match("m5", "mt-b", "me-3")] });
    expect(ids(groups.find((g) => g.mentorPersonId === "mt-b")!)).toEqual(["mentee:me-3"]);
  });

  it("lô lấy trọn từng nhóm, không bao giờ cắt đôi; nhóm không vừa thì thử nhóm nhỏ hơn phía sau", () => {
    const groups = groupsOf();
    expect(planDispatchBatch(groups, 40).map((g) => g.mentorPersonId)).toEqual(["mt-a", "mt-b"]);
    // Còn 3 chỗ: nhóm mt-a (4 người) không vừa → bỏ qua, nhóm mt-b (2 người) vừa.
    const three = planDispatchBatch(groups, 3);
    expect(three.map((g) => g.mentorPersonId)).toEqual(["mt-b"]);
    expect(batchSize(three)).toBe(2);
    expect(planDispatchBatch(groups, 4).map((g) => g.mentorPersonId)).toEqual(["mt-a"]);
    expect(planDispatchBatch(groups, 1)).toEqual([]);
    expect(planDispatchBatch(groups, 0)).toEqual([]);
  });

  it("thứ tự nhóm cố định giữa các lần bấm (theo tên mentor)", () => {
    expect(groupsOf().map((g) => g.mentorPersonId)).toEqual(groupsOf().map((g) => g.mentorPersonId));
  });
});
