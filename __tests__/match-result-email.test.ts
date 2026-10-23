/**
 * Thư kết quả Matching mùa 12 — chữ nguyên văn Doc của BTC, link hồ sơ riêng, thư thử.
 *
 * Lá thư là thứ duy nhất của tính năng rời khỏi hệ thống, gửi tới hơn một nghìn người thật. Phải soi:
 * nói đúng chữ BTC đã chốt, mang đúng số link hồ sơ (mentor có tới 3 mentee), không bao giờ mang SĐT
 * hay email của ai trong thân thư, tên người không thoát được HTML, và thư thử không mang link thật nào.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({ getSupabaseServiceRoleClient: vi.fn(), getSupabaseServerClient: vi.fn() }));

import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import { sendMatchResultMentee, sendMatchResultMenteeLate, sendMatchResultMentor, sendMatchResultMentorLate } from "@/lib/email";
import {
  MATCH_RESULT_MENTEE_TRAINING_URL,
  MATCH_RESULT_MENTOR_TRAINING_URL,
  MATCH_RESULT_SUBJECT,
  buildMatchResultMenteeEmail,
  buildMatchResultMenteeLateEmail,
  buildMatchResultMentorEmail,
  buildMatchResultMentorLateEmail
} from "@/lib/email-core";
import { outboundEmailKindLabel } from "@/lib/outbound-emails-core";
import { HANDBOOKS } from "@/lib/handbook";

const REAL_READY = { mentee: HANDBOOKS.mentee.ready, mentor: HANDBOOKS.mentor.ready };

const ORIGIN = "https://os.alumni-mentoring.edu.vn";
const HANDBOOK = "https://drive.example.test/handbook";
const MENTEE_INPUT = {
  menteeName: "Trần Mỹ Anh",
  mentorName: "Nguyễn Văn Bình",
  mentorProfileUrl: `${ORIGIN}/ho-so/MA-MENTOR`,
  handbookUrl: HANDBOOK,
  kickoffRegisterUrl: null
};
const MENTOR_INPUT = {
  mentorName: "Nguyễn Văn Bình",
  mentees: [
    { name: "Trần Mỹ Anh", profileUrl: `${ORIGIN}/ho-so/MA-1` },
    { name: "Lê Hoà", profileUrl: `${ORIGIN}/ho-so/MA-2` }
  ],
  handbookUrl: HANDBOOK,
  kickoffRegisterUrl: null
};

describe("1. thư gửi mentee", () => {
  it("đúng tiêu đề và các câu chốt của mẫu MENTEE", () => {
    const mail = buildMatchResultMenteeEmail(MENTEE_INPUT);
    expect(mail.subject).toBe("THÔNG BÁO KẾT QUẢ MATCHING THÀNH CÔNG - UEH MENTORING MÙA 12");
    for (const line of [
      "Thân gửi bạn Trần Mỹ Anh,",
      "Ban Tổ chức UEH Mentoring Mùa 12 xin chúc mừng bạn đã matching thành công và chính thức trở thành Mentee của chương trình UEH Mentoring Mùa 12.",
      "1. THÔNG TIN MENTOR ĐỒNG HÀNH",
      "BTC khuyến khích bạn tìm hiểu thông tin về Mentor và chủ động liên hệ Mentor, tạo tiền đề thuận lợi cho quá trình kết nối và trao đổi giữa hai bên.",
      "2. MENTEE HANDBOOK",
      `Tài liệu hướng dẫn: ${HANDBOOK}`,
      "3. TRAINING MENTEE ĐẦU VÀO",
      "Buổi 1: 08:00 - 11:30, Chủ nhật, ngày 01/11/2026.",
      "Buổi 2: 08:00 - 11:30, Chủ nhật, ngày 08/11/2026.",
      "Buổi 3: 14:00 - 17:00, Chủ nhật, ngày 15/11/2026.",
      "Địa điểm: Phòng A.103, Cơ sở A UEH - 59C Nguyễn Đình Chiểu, phường Xuân Hòa, TP. Hồ Chí Minh.",
      `Link đăng ký tham gia: ${MATCH_RESULT_MENTEE_TRAINING_URL}`,
      "4. CHƯƠNG TRÌNH KICK - OFF UEH MENTORING MÙA 12",
      "Thời gian: 16:30 - 20:30, thứ Sáu, ngày 20/11/2026.",
      "Địa điểm: Hội trường A.116, Cơ sở A - 59C Nguyễn Đình Chiểu, phường Xuân Hòa, TP. Hồ Chí Minh.",
      "Hẹn gặp bạn trong các hoạt động sắp tới!",
      "BAN TỔ CHỨC UEH MENTORING MÙA 12"
    ]) {
      expect(mail.text, line).toContain(line);
    }
  });

  it("link Training mentee là link cố định trong Doc", () => {
    expect(MATCH_RESULT_MENTEE_TRAINING_URL).toBe("https://os.alumni-mentoring.edu.vn/register/eba60bb2-57b6-4e4f-b786-5e7a6f517584");
    expect(buildMatchResultMenteeEmail(MENTEE_INPUT).html).toContain(`href="${MATCH_RESULT_MENTEE_TRAINING_URL}"`);
  });

  it("mang đúng một link hồ sơ, kèm tên mentor, ở cả bản chữ và HTML", () => {
    const mail = buildMatchResultMenteeEmail(MENTEE_INPUT);
    expect(mail.text).toContain(`Hồ sơ Mentor: Nguyễn Văn Bình — ${ORIGIN}/ho-so/MA-MENTOR`);
    expect(mail.html.split(`href="${ORIGIN}/ho-so/MA-MENTOR"`).length - 1).toBe(1);
    expect(mail.html.match(/\/ho-so\//g)).toHaveLength(1);
  });
});

describe("2. thư gửi mentor", () => {
  it("đúng các câu chốt của mẫu MENTOR, kèm link Training mentor cố định", () => {
    const mail = buildMatchResultMentorEmail(MENTOR_INPUT);
    expect(mail.subject).toBe(MATCH_RESULT_SUBJECT);
    for (const line of [
      "Kính gửi Anh/Chị Nguyễn Văn Bình,",
      "BTC trân trọng thông báo Anh/Chị đã matching thành công với Mentee và chính thức bắt đầu hành trình đồng hành tại UEH Mentoring Mùa 12.",
      "1. THÔNG TIN MENTEE ĐỒNG HÀNH",
      "2. MENTOR HANDBOOK",
      "3. TRAINING MENTOR",
      "Thời gian: 08:30 - 12:00, Chủ nhật, 15/11/2026.",
      `Link đăng ký tham gia: ${MATCH_RESULT_MENTOR_TRAINING_URL}`,
      "Buổi Mentor Training này là hoạt động khuyến nghị bắt buộc đối với tất cả Mentor tham gia chương trình.",
      "4. CHƯƠNG TRÌNH KICK - OFF UEH MENTORING MÙA 12",
      "Kính chúc Anh/Chị và Mentee sẽ có một hành trình 09 tháng thật ý nghĩa, cùng nhau tạo nên những giá trị thiết thực và những trải nghiệm đáng nhớ.",
      "BAN TỔ CHỨC UEH MENTORING MÙA 12"
    ]) {
      expect(mail.text, line).toContain(line);
    }
    expect(MATCH_RESULT_MENTOR_TRAINING_URL).toBe("https://os.alumni-mentoring.edu.vn/register/5663ff34-358d-4949-9ef8-f1bab428ae64");
  });

  it.each([1, 2, 3])("%i mentee → đúng %i dòng Mentee n, mỗi dòng một link riêng", (n) => {
    const mentees = Array.from({ length: n }, (_, i) => ({ name: `Mentee số ${i + 1}`, profileUrl: `${ORIGIN}/ho-so/MA-${i + 1}` }));
    const mail = buildMatchResultMentorEmail({ ...MENTOR_INPUT, mentees });
    for (let i = 1; i <= n; i++) expect(mail.text).toContain(`Mentee ${i}: Mentee số ${i} — ${ORIGIN}/ho-so/MA-${i}`);
    expect(mail.text).not.toContain(`Mentee ${n + 1}:`);
    expect(mail.text).not.toContain("(nếu có)");
    expect(mail.html.match(/\/ho-so\//g)).toHaveLength(n);
  });
});

describe("3. chung cho hai thư", () => {
  const both = () => [buildMatchResultMenteeEmail(MENTEE_INPUT), buildMatchResultMentorEmail(MENTOR_INPUT)];

  it("chưa có link Kick-off: ghi đúng câu “BTC sẽ cập nhật sau.”; có link thì mang link", () => {
    for (const mail of both()) expect(mail.text).toContain("Link đăng ký tham gia: BTC sẽ cập nhật sau.");
    const kickoff = "https://os.alumni-mentoring.edu.vn/register/kick-off";
    const withLink = [
      buildMatchResultMenteeEmail({ ...MENTEE_INPUT, kickoffRegisterUrl: kickoff }),
      buildMatchResultMentorEmail({ ...MENTOR_INPUT, kickoffRegisterUrl: kickoff })
    ];
    for (const mail of withLink) {
      expect(mail.text).toContain(`Link đăng ký tham gia: ${kickoff}`);
      expect(mail.text).not.toContain("BTC sẽ cập nhật sau");
      expect(mail.html).toContain(`href="${kickoff}"`);
    }
  });

  it("tên người không thoát được HTML", () => {
    const evil = '<img src=x onerror="alert(1)">';
    const mentee = buildMatchResultMenteeEmail({ ...MENTEE_INPUT, menteeName: evil, mentorName: evil });
    const mentor = buildMatchResultMentorEmail({ ...MENTOR_INPUT, mentorName: evil, mentees: [{ name: evil, profileUrl: `${ORIGIN}/ho-so/x` }] });
    for (const mail of [mentee, mentor]) {
      expect(mail.html).not.toContain("<img");
      expect(mail.html).toContain("&lt;img");
    }
  });

  it("thân thư không có SĐT hay email nào — những thứ đó chỉ nằm sau link hồ sơ", () => {
    for (const mail of both()) {
      expect(mail.text).not.toMatch(/[^\s@]+@[^\s@]+\.[a-z]{2,}/i);
      expect(mail.text).not.toMatch(/\b0\d{2}[ .]?\d{3}[ .]?\d{3,4}\b/);
    }
  });

  it("nhắc đường dẫn hồ sơ là riêng, không chuyển tiếp", () => {
    for (const mail of both()) expect(mail.text).toMatch(/không chuyển tiếp/);
  });
});

// ── Gửi qua nhà cung cấp (giả lập fetch) ─────────────────────────────────────

const logged: { payloads: Record<string, unknown>[] } = { payloads: [] };
function makeClient() {
  const chain: Record<string, unknown> = {};
  chain.insert = (payload: Record<string, unknown>) => {
    logged.payloads.push(payload);
    return Promise.resolve({ data: null, error: null });
  };
  return { from: vi.fn(() => chain) } as unknown as ReturnType<typeof getSupabaseServiceRoleClient>;
}

const TOUCHED_ENV = ["VAM_OS_EMAIL_ENABLED", "VERCEL_ENV", "VAM_OS_EMAIL_PROVIDER", "BREVO_API_KEY", "RESEND_API_KEY", "VAM_OS_EMAIL_FROM", "VAM_OS_EMAIL_REPLY_TO", "VAM_OS_PUBLIC_BASE_URL"];
const ORIGINAL_ENV = new Map<string, string | undefined>();
let fetchMock: Mock;
const body = () => JSON.parse((fetchMock.mock.calls[0] as [string, { body: string }])[1].body) as Record<string, any>;
const TOKEN_A = "A".repeat(43);
const TOKEN_B = "B".repeat(43);
const NOTICE = "dddddddd-0000-4000-8000-000000000001";

describe("4. gửi thư", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    logged.payloads = [];
    for (const key of TOUCHED_ENV) ORIGINAL_ENV.set(key, process.env[key]);
    process.env.VAM_OS_EMAIL_ENABLED = "true";
    process.env.VERCEL_ENV = "production";
    process.env.VAM_OS_EMAIL_PROVIDER = "resend";
    process.env.RESEND_API_KEY = "re_test";
    process.env.BREVO_API_KEY = "xkeysib-test";
    process.env.VAM_OS_EMAIL_FROM = "Ban tổ chức VAM <no-reply@vam.test>";
    process.env.VAM_OS_EMAIL_REPLY_TO = "btc@vam.test";
    delete process.env.VAM_OS_PUBLIC_BASE_URL;
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(makeClient());
    fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 201, json: async () => ({ id: "x" }) });
    vi.stubGlobal("fetch", fetchMock);
    // Giả lập Handbook đã có file trên VAM OS; ca "chưa có file" tự tắt.
    HANDBOOKS.mentee.ready = true;
    HANDBOOKS.mentor.ready = true;
  });
  afterEach(() => {
    for (const key of TOUCHED_ENV) {
      const value = ORIGINAL_ENV.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    vi.unstubAllGlobals();
    HANDBOOKS.mentee.ready = REAL_READY.mentee;
    HANDBOOKS.mentor.ready = REAL_READY.mentor;
  });

  const MENTEE_SEND = {
    toEmail: "sv@example.test", menteeName: "Trần Mỹ Anh", mentorName: "Nguyễn Văn Bình", mentorToken: TOKEN_A,
    kickoffRegisterUrl: null, noticeId: NOTICE, requestOrigin: ORIGIN
  };
  const MENTOR_SEND = {
    toEmail: "mentor@example.test", mentorName: "Nguyễn Văn Bình",
    mentees: [{ name: "Trần Mỹ Anh", token: TOKEN_A }, { name: "Lê Hoà", token: TOKEN_B }],
    kickoffRegisterUrl: null, noticeId: NOTICE, requestOrigin: ORIGIN
  };

  it("thư thật gửi mentee: link /ho-so/<mã> dựng từ địa chỉ hệ thống; sổ thư gắn đúng dòng thông báo", async () => {
    expect((await sendMatchResultMentee(MENTEE_SEND)).ok).toBe(true);
    expect(String(body().html)).toContain(`${ORIGIN}/ho-so/${TOKEN_A}`);
    expect(JSON.stringify(body().to)).toContain("sv@example.test");
    expect(logged.payloads[0]).toMatchObject({ kind: "mentee_mentor_intro", status: "sent", related_table: "match_result_notices", related_id: NOTICE });
  });

  it("thư thật gửi mentor: một link cho mỗi mentee", async () => {
    await sendMatchResultMentor(MENTOR_SEND);
    const html = String(body().html);
    expect(html).toContain(`${ORIGIN}/ho-so/${TOKEN_A}`);
    expect(html).toContain(`${ORIGIN}/ho-so/${TOKEN_B}`);
    expect(logged.payloads[0]).toMatchObject({ kind: "mentor_mentee_package", related_table: "match_result_notices", related_id: NOTICE });
  });

  it("thư thử (mọi mã null): ghi rõ thư thử, không link hồ sơ thật nào, không href nào bấm được tới câu giữ chỗ", async () => {
    await sendMatchResultMentor({ ...MENTOR_SEND, toEmail: "btc@example.test", mentees: MENTOR_SEND.mentees.map((m) => ({ ...m, token: null })), noticeId: null });
    const sent = body();
    expect(String(sent.subject)).toMatch(/^\[THƯ THỬ\] THÔNG BÁO KẾT QUẢ MATCHING/);
    expect(String(sent.html)).not.toContain("/ho-so/");
    expect(String(sent.html)).not.toMatch(/href="\(/);
    expect(String(sent.text)).toContain("chỉ có trong thư thật");
    // Link Handbook và Training là link công khai — thư thử vẫn mang để BTC bấm thử.
    expect(String(sent.html)).toContain(`href="${ORIGIN}/tai-lieu/handbook-mentor.pdf"`);
    expect(logged.payloads[0].related_id ?? null).toBeNull();
  });

  it("link Handbook trong thư là file trên VAM OS, đúng vai người nhận", async () => {
    await sendMatchResultMentee(MENTEE_SEND);
    await sendMatchResultMentor(MENTOR_SEND);
    const sentBody = (i: number) => JSON.parse((fetchMock.mock.calls[i] as [string, { body: string }])[1].body) as Record<string, any>;
    expect(String(sentBody(0).text)).toContain(`Tài liệu hướng dẫn: ${ORIGIN}/tai-lieu/handbook-mentee.pdf`);
    expect(String(sentBody(1).text)).toContain(`Tài liệu hướng dẫn: ${ORIGIN}/tai-lieu/handbook-mentor.pdf`);
  });

  it("thư thử khi chưa có file Handbook: câu giữ chỗ, không href nào trỏ tới nó", async () => {
    HANDBOOKS.mentee.ready = false;
    await sendMatchResultMentee({ ...MENTEE_SEND, toEmail: "btc@example.test", mentorToken: null, noticeId: null });
    const sent = body();
    expect(String(sent.text)).toContain("(Handbook đang được cập nhật trên VAM OS)");
    expect(String(sent.html)).not.toMatch(/href="\(/);
    expect(String(sent.html)).not.toContain("/tai-lieu/");
  });

  it("thư THẬT khi chưa có file Handbook: không gửi", async () => {
    HANDBOOKS.mentee.ready = false;
    HANDBOOKS.mentor.ready = false;
    expect((await sendMatchResultMentee(MENTEE_SEND)).ok).toBe(false);
    expect((await sendMatchResultMentor(MENTOR_SEND)).ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("thư thử của một nhóm: tiêu đề mang người nhận thật, để Gmail không gom các thư cùng phút", async () => {
    await sendMatchResultMentee({ ...MENTEE_SEND, toEmail: "btc@example.test", mentorToken: null, noticeId: null, testFor: "mentee Trần Mỹ Anh" });
    expect(String(body().subject)).toMatch(/^\[THƯ THỬ\] THÔNG BÁO KẾT QUẢ MATCHING THÀNH CÔNG - UEH MENTORING MÙA 12 — bản gửi mentee Trần Mỹ Anh \(gửi lúc /);
  });

  it("thư thật không bao giờ mang nhãn thư thử dù nơi gọi truyền testFor", async () => {
    await sendMatchResultMentee({ ...MENTEE_SEND, testFor: "x" });
    expect(String(body().subject)).toBe("THÔNG BÁO KẾT QUẢ MATCHING THÀNH CÔNG - UEH MENTORING MÙA 12");
  });

  it("lẫn lộn mã và câu giữ chỗ: không gửi gì", async () => {
    const result = await sendMatchResultMentor({ ...MENTOR_SEND, mentees: [{ name: "A", token: TOKEN_A }, { name: "B", token: null }] });
    expect(result.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("mentor không có mentee nào: không gửi", async () => {
    expect((await sendMatchResultMentor({ ...MENTOR_SEND, mentees: [] })).ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sổ thư có nhãn tiếng Việt cho hai loại thư", () => {
    expect(outboundEmailKindLabel("mentee_mentor_intro")).toBe("Kết quả Matching — gửi mentee");
    expect(outboundEmailKindLabel("mentor_mentee_package")).toBe("Kết quả Matching — gửi mentor");
  });
});

describe("5. mẫu sau 15/11 (nhóm mentor cần Training 15/11)", () => {
  const menteeLate = () => buildMatchResultMenteeLateEmail({ menteeName: "Trần Mỹ Anh", handbookUrl: HANDBOOK, kickoffRegisterUrl: null });
  const mentorLate = (names = ["Trần Mỹ Anh", "Lê Hoà"]) =>
    buildMatchResultMentorLateEmail({ mentorName: "Nguyễn Văn Bình", menteeNames: names, handbookUrl: HANDBOOK, kickoffRegisterUrl: null });

  it("mentee: đúng các câu của mẫu MENTEE MATCHING SAU 15/11, chưa có thông tin mentor", () => {
    const mail = menteeLate();
    expect(mail.subject).toBe(MATCH_RESULT_SUBJECT);
    for (const line of [
      "Thân gửi bạn Trần Mỹ Anh,",
      "Sau quá trình tuyển chọn và kết nối, BTC hy vọng rằng hành trình Mentoring kéo dài 09 tháng sắp tới sẽ mang đến cho bạn những trải nghiệm ý nghĩa",
      "1. MENTOR ĐỒNG HÀNH",
      "Bạn sẽ nhận được thông tin Mentor đồng hành và chính thức kết nối với anh/chị sau ngày 15/11/2026.",
      "2. MENTEE HANDBOOK",
      `Tài liệu hướng dẫn: ${HANDBOOK}`,
      "3. TRAINING MENTEE ĐẦU VÀO",
      "(nội dung mỗi buổi đều giống nhau):",
      `Link đăng ký tham gia: ${MATCH_RESULT_MENTEE_TRAINING_URL}`,
      "4. CHƯƠNG TRÌNH KICK - OFF UEH MENTORING MÙA 12",
      "Link đăng ký tham gia: BTC sẽ cập nhật sau.",
      "Hẹn gặp bạn trong các hoạt động sắp tới!"
    ]) {
      expect(mail.text, line).toContain(line);
    }
    expect(mail.text).not.toContain("THÔNG TIN MENTOR ĐỒNG HÀNH");
    expect(mail.text).not.toContain("Hồ sơ Mentor");
    expect(mail.html).not.toContain("/ho-so/");
    // Không có link hồ sơ thì không có dòng nhắc "đường dẫn hồ sơ là riêng".
    expect(mail.text).not.toContain("Đường dẫn hồ sơ");
  });

  it("mentor: chỉ họ tên mentee, không link; không có mục Training Mentor; Kick-off là mục 3", () => {
    const mail = mentorLate();
    for (const line of [
      "Kính gửi Anh/Chị Nguyễn Văn Bình,",
      "1. THÔNG TIN MENTEE ĐỒNG HÀNH",
      "Mentee 1: Trần Mỹ Anh",
      "Mentee 2: Lê Hoà",
      "Hiện tại, Anh/Chị vẫn cần hoàn thành chương trình Training ngày 15/11 để được trở thành mentor chính thức mùa 12. Vì vậy, sau khi Anh/Chị tham gia Training, BTC sẽ kết nối chính thức giữa Mentor và Mentee.",
      "Mùa 12 tất cả mentee đều được training từ 1/11 đến 15/11 để xác định mục tiêu phát triển cá nhân",
      "2. MENTOR HANDBOOK",
      "3. CHƯƠNG TRÌNH KICK - OFF UEH MENTORING MÙA 12",
      "Kính chúc Anh/Chị và Mentee sẽ có một hành trình 09 tháng thật ý nghĩa"
    ]) {
      expect(mail.text, line).toContain(line);
    }
    expect(mail.text).not.toContain("TRAINING MENTOR");
    expect(mail.text).not.toContain(MATCH_RESULT_MENTOR_TRAINING_URL);
    expect(mail.text).not.toContain("4. CHƯƠNG TRÌNH");
    expect(mail.html).not.toContain("/ho-so/");
    expect(mail.text).not.toContain("Mentee 3:");
  });

  it("tên mentee không thoát được HTML", () => {
    const mail = mentorLate(['<img src=x onerror="alert(1)">']);
    expect(mail.html).not.toContain("<img");
  });
});

describe("6. gửi mẫu sau 15/11", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    logged.payloads = [];
    for (const key of TOUCHED_ENV) ORIGINAL_ENV.set(key, process.env[key]);
    process.env.VAM_OS_EMAIL_ENABLED = "true";
    process.env.VERCEL_ENV = "production";
    process.env.VAM_OS_EMAIL_PROVIDER = "resend";
    process.env.RESEND_API_KEY = "re_test";
    process.env.VAM_OS_EMAIL_FROM = "Ban tổ chức VAM <no-reply@vam.test>";
    delete process.env.VAM_OS_PUBLIC_BASE_URL;
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(makeClient());
    fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 201, json: async () => ({ id: "x" }) });
    vi.stubGlobal("fetch", fetchMock);
    HANDBOOKS.mentee.ready = true;
    HANDBOOKS.mentor.ready = true;
  });
  afterEach(() => {
    for (const key of TOUCHED_ENV) {
      const value = ORIGINAL_ENV.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    vi.unstubAllGlobals();
    HANDBOOKS.mentee.ready = REAL_READY.mentee;
    HANDBOOKS.mentor.ready = REAL_READY.mentor;
  });

  it("thư thật: đúng loại thư, gắn đúng dòng thông báo, link Handbook trên VAM OS, không link hồ sơ", async () => {
    await sendMatchResultMentorLate({ toEmail: "mentor@example.test", mentorName: "Bình", menteeNames: ["An"], kickoffRegisterUrl: null, noticeId: NOTICE, requestOrigin: ORIGIN, test: false });
    const sent = body();
    expect(String(sent.text)).toContain(`Tài liệu hướng dẫn: ${ORIGIN}/tai-lieu/handbook-mentor.pdf`);
    expect(String(sent.html)).not.toContain("/ho-so/");
    expect(String(sent.subject)).toBe(MATCH_RESULT_SUBJECT);
    expect(logged.payloads[0]).toMatchObject({ kind: "mentor_mentee_package", related_table: "match_result_notices", related_id: NOTICE });
  });

  it("thư thử: nói rõ là thư thử, không gắn dòng nào", async () => {
    await sendMatchResultMenteeLate({ toEmail: "btc@example.test", menteeName: "An", kickoffRegisterUrl: null, noticeId: null, requestOrigin: ORIGIN, test: true, testFor: "mentee An" });
    const sent = body();
    expect(String(sent.subject)).toMatch(/^\[THƯ THỬ\] .* — bản gửi mentee An \(gửi lúc /);
    expect(logged.payloads[0]).toMatchObject({ kind: "mentee_mentor_intro" });
    expect(logged.payloads[0].related_id ?? null).toBeNull();
  });

  it("thư thật không có dòng thông báo, hoặc chưa có file Handbook, hoặc mentor không có mentee: không gửi", async () => {
    expect((await sendMatchResultMenteeLate({ toEmail: "a@x.test", menteeName: "An", kickoffRegisterUrl: null, noticeId: null, requestOrigin: ORIGIN, test: false })).ok).toBe(false);
    expect((await sendMatchResultMentorLate({ toEmail: "a@x.test", mentorName: "B", menteeNames: [], kickoffRegisterUrl: null, noticeId: NOTICE, requestOrigin: ORIGIN, test: false })).ok).toBe(false);
    HANDBOOKS.mentee.ready = false;
    expect((await sendMatchResultMenteeLate({ toEmail: "a@x.test", menteeName: "An", kickoffRegisterUrl: null, noticeId: NOTICE, requestOrigin: ORIGIN, test: false })).ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
