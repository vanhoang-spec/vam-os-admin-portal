/**
 * Lời mời tài khoản — phần thuần: gửi hay không, gửi loại link nào, và màn hình
 * hiện trạng thái gì.
 *
 * Mỗi luật trong thứ tự quyết định có một ca riêng. Ca nào cũng là một lỗi có
 * thể xảy ra thật: mời người của mùa khác, mời một email trùng, gửi link khôi
 * phục cho người đã vào, gọi một mối nối chưa từng đăng nhập là "đã vào".
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({ getSupabaseServiceRoleClient: vi.fn() }));

import { VISIBLE_MEMBERSHIP_STATUSES } from "@/lib/participant-home";
import {
  ACCOUNT_STATUS_LABELS,
  INVITE_BULK_RETRY_AFTER_MINUTES,
  INVITE_CLAIM_STALE_MINUTES,
  INVITE_MEMBERSHIP_STATUSES,
  INVITE_RESEND_COOLDOWN_MINUTES,
  ROSTER_BLOCK_LABELS,
  checkGeneratedLink,
  decideParticipantInvite,
  deriveRosterRow,
  describeBulkRun,
  inviteBudgetRemaining,
  inviteOutcomeMessage,
  inviteRefusalMessage,
  isBulkEligible,
  linkStateAfterUniqueViolation,
  rosterRowAction,
  selectBulkCandidates,
  summarizeSends,
  type InviteDecision,
  type InviteFacts,
  type InviteRefusalReason,
  type RosterRow,
  type SendDecision
} from "@/lib/participant-invite-core";

const NOW = Date.parse("2026-09-11T03:00:00.000Z");
const SEASON = "11111111-1111-4111-8111-111111111111";
const OTHER_SEASON = "22222222-2222-4222-8222-222222222222";
const PERSON = "33333333-3333-4333-8333-333333333333";
const MINUTE = 60_000;

const ago = (minutes: number) => new Date(NOW - minutes * MINUTE).toISOString();

function facts(overrides: Partial<InviteFacts> = {}): InviteFacts {
  return {
    personId: PERSON,
    seasonId: SEASON,
    person: { fullName: "Nguyễn Văn An", emailPrimary: " An@Example.com " },
    memberships: [{ seasonId: SEASON, role: "mentor", status: "active" }],
    sameEmailPeople: [{ id: PERSON, emailPrimary: "an@example.com" }],
    staffRows: [],
    authUsers: [],
    linkByPerson: null,
    linkByAuthUser: null,
    sends: [],
    ...overrides
  };
}

function decide(input: InviteFacts, mode: "invite" | "reset" | "bulk" = "invite", nowMs = NOW): InviteDecision {
  return decideParticipantInvite(input, { mode, nowMs });
}

function outcome(decision: InviteDecision): string {
  return decision.kind === "refuse" ? decision.reason : decision.kind;
}

const activeLink = (overrides: Record<string, unknown> = {}) => ({
  authUserId: "auth-1",
  personId: PERSON,
  status: "active",
  activatedAt: null as string | null,
  ...overrides
});

describe("gửi được thì gửi đúng loại link", () => {
  it("người chưa có tài khoản: link mời, ghi mối nối, email đã chuẩn hoá", () => {
    const decision = decide(facts());
    expect(decision).toEqual({
      kind: "send",
      linkType: "invite",
      writeLink: true,
      expectedAuthUserId: null,
      email: "an@example.com",
      recipientName: "Nguyễn Văn An"
    });
  });

  it("đã có tài khoản mà chưa nối: link khôi phục, và vẫn ghi mối nối", () => {
    const decision = decide(facts({ authUsers: [{ id: "auth-1", email: "an@example.com" }] }));
    expect(decision).toMatchObject({ kind: "send", linkType: "recovery", writeLink: true, expectedAuthUserId: "auth-1" });
  });

  it("đã nối mà chưa đăng nhập: link khôi phục, KHÔNG ghi mối nối lần nữa", () => {
    const decision = decide(
      facts({
        authUsers: [{ id: "auth-1", email: "an@example.com" }],
        linkByPerson: activeLink(),
        linkByAuthUser: activeLink()
      })
    );
    expect(decision).toMatchObject({ kind: "send", linkType: "recovery", writeLink: false });
  });
});

describe("danh tính: từ chối trước khi nghĩ tới chuyện gửi", () => {
  it("không có trong danh bạ", () => {
    expect(outcome(decide(facts({ person: null })))).toBe("person_not_found");
  });

  it("chưa có email, hoặc email hỏng", () => {
    expect(outcome(decide(facts({ person: { fullName: "A", emailPrimary: "  " } })))).toBe("no_email");
    expect(outcome(decide(facts({ person: { fullName: "A", emailPrimary: "khong-phai-email" } })))).toBe("invalid_email");
  });

  it("chỉ thuộc mùa KHÁC thì không mời, dù câu truy vấn quên lọc mùa", () => {
    const decision = decide(facts({ memberships: [{ seasonId: OTHER_SEASON, role: "mentor", status: "active" }] }));
    expect(outcome(decision)).toBe("not_in_season");
  });

  it("đã rút khỏi mùa này thì không mời", () => {
    const decision = decide(facts({ memberships: [{ seasonId: SEASON, role: "mentor", status: "withdrawn" }] }));
    expect(outcome(decision)).toBe("not_in_season");
  });

  it("mùa đã hoàn thành vẫn mời được", () => {
    const decision = decide(facts({ memberships: [{ seasonId: SEASON, role: "mentee", status: "completed" }] }));
    expect(decision.kind).toBe("send");
  });

  it("vai trò không phải mentor/mentee thì không mời", () => {
    const decision = decide(facts({ memberships: [{ seasonId: SEASON, role: "supporter", status: "active" }] }));
    expect(outcome(decision)).toBe("role_not_invitable");
  });

  it("email trùng CHÍNH XÁC với một người khác thì từ chối", () => {
    const decision = decide(
      facts({
        sameEmailPeople: [
          { id: PERSON, emailPrimary: "an@example.com" },
          { id: "person-khac", emailPrimary: "AN@example.com" }
        ]
      })
    );
    expect(outcome(decision)).toBe("email_shared");
  });

  it("một người chỉ na ná email thì không phải trùng", () => {
    const decision = decide(
      facts({ sameEmailPeople: [{ id: PERSON, emailPrimary: "an@example.com" }, { id: "x", emailPrimary: "an@example.co" }] })
    );
    expect(decision.kind).toBe("send");
  });

  it("hai tài khoản đăng nhập cùng email thì từ chối, không chọn bừa một cái", () => {
    const decision = decide(
      facts({ authUsers: [{ id: "auth-1", email: "an@example.com" }, { id: "auth-2", email: "AN@example.com" }] })
    );
    expect(outcome(decision)).toBe("auth_ambiguous");
  });

  it("là nhân sự theo email — kể cả dòng đã khoá", () => {
    const decision = decide(facts({ staffRows: [{ email: "AN@EXAMPLE.COM", authUserId: null }] }));
    expect(outcome(decision)).toBe("is_staff");
  });

  it("là nhân sự theo tài khoản, dù email nhân sự đã đổi", () => {
    const decision = decide(
      facts({
        authUsers: [{ id: "auth-1", email: "an@example.com" }],
        staffRows: [{ email: "email-cu@vam.org", authUserId: "auth-1" }]
      })
    );
    expect(outcome(decision)).toBe("is_staff");
  });

  it("email có dấu gạch dưới KHÔNG khớp nhầm một email nhân sự khác", () => {
    // `_` là ký tự đại diện của ilike. So chính xác thì nguyen_van ≠ nguyenxvan.
    const decision = decide(
      facts({
        person: { fullName: "Văn", emailPrimary: "nguyen_van@x.vn" },
        sameEmailPeople: [{ id: PERSON, emailPrimary: "nguyen_van@x.vn" }],
        staffRows: [{ email: "nguyenxvan@x.vn", authUserId: null }]
      })
    );
    expect(decision.kind).toBe("send");
  });

  it("người này đã nối với một tài khoản KHÁC", () => {
    expect(
      outcome(
        decide(
          facts({
            authUsers: [{ id: "auth-1", email: "an@example.com" }],
            linkByPerson: activeLink({ authUserId: "auth-9" })
          })
        )
      )
    ).toBe("person_linked_to_other_account");
    expect(outcome(decide(facts({ linkByPerson: activeLink({ authUserId: "auth-9" }) })))).toBe(
      "person_linked_to_other_account"
    );
  });

  it("tài khoản của email này đang nối với một người KHÁC", () => {
    const decision = decide(
      facts({
        authUsers: [{ id: "auth-1", email: "an@example.com" }],
        linkByAuthUser: activeLink({ personId: "nguoi-khac" })
      })
    );
    expect(outcome(decision)).toBe("auth_linked_to_other_person");
  });

  it("mối nối đã bị ngắt thì không gửi gì", () => {
    const decision = decide(
      facts({
        authUsers: [{ id: "auth-1", email: "an@example.com" }],
        linkByPerson: activeLink({ status: "inactive" })
      })
    );
    expect(outcome(decision)).toBe("link_inactive");
  });

  it("một phép từ chối về danh tính thắng mọi phép kiểm về thư", () => {
    const decision = decide(
      facts({ staffRows: [{ email: "an@example.com", authUserId: null }], sends: [{ status: "queued", createdAt: ago(1) }] })
    );
    expect(outcome(decision)).toBe("is_staff");
  });
});

describe("người đã đăng nhập", () => {
  const signedIn = () =>
    facts({
      authUsers: [{ id: "auth-1", email: "an@example.com" }],
      linkByPerson: activeLink({ activatedAt: ago(60 * 24) }),
      linkByAuthUser: activeLink({ activatedAt: ago(60 * 24) }),
      sends: [{ status: "sent", createdAt: ago(60 * 24 * 7) }]
    });

  it("Mời và mời hàng loạt: không gửi thêm thư", () => {
    expect(decide(signedIn(), "invite").kind).toBe("already_active");
    expect(decide(signedIn(), "bulk").kind).toBe("already_active");
  });

  it("Gửi link đặt lại mật khẩu: link khôi phục, không ghi mối nối", () => {
    expect(decide(signedIn(), "reset")).toMatchObject({ kind: "send", linkType: "recovery", writeLink: false });
  });
});

describe("sổ thư của một người", () => {
  it("một lượt đang giữ chỗ, còn mới: không gửi chồng lên", () => {
    expect(outcome(decide(facts({ sends: [{ status: "queued", createdAt: ago(INVITE_CLAIM_STALE_MINUTES - 1) }] })))).toBe(
      "in_flight"
    );
  });

  it("chỗ giữ đã quá hạn thì không chặn nữa", () => {
    expect(decide(facts({ sends: [{ status: "queued", createdAt: ago(INVITE_CLAIM_STALE_MINUTES + 1) }] })).kind).toBe(
      "send"
    );
  });

  it("vừa gửi chưa đủ thời gian chờ thì từ chối; đủ rồi thì gửi", () => {
    expect(
      outcome(decide(facts({ sends: [{ status: "sent", createdAt: ago(INVITE_RESEND_COOLDOWN_MINUTES - 5) }] })))
    ).toBe("recently_sent");
    expect(decide(facts({ sends: [{ status: "sent", createdAt: ago(INVITE_RESEND_COOLDOWN_MINUTES + 1) }] })).kind).toBe(
      "send"
    );
  });

  it("mốc gửi không đọc được thì coi như vừa gửi", () => {
    expect(outcome(decide(facts({ sends: [{ status: "sent", createdAt: "chưa rõ" }] })))).toBe("recently_sent");
  });

  it("mời hàng loạt không bao giờ gửi lại cho người đã nhận thư", () => {
    const old = facts({ sends: [{ status: "sent", createdAt: ago(60 * 24 * 3) }] });
    expect(outcome(decide(old, "bulk"))).toBe("bulk_already_invited");
    expect(decide(old, "invite").kind).toBe("send");
  });

  it("thư `skipped` không phải một lá thư đã đi", () => {
    const skipped = facts({ sends: [{ status: "skipped", createdAt: ago(1) }] });
    expect(decide(skipped, "invite").kind).toBe("send");
    expect(decide(skipped, "bulk").kind).toBe("send");
  });

  it("lá thư gần nhất tính theo thời gian, không theo thứ tự trả về", () => {
    const summary = summarizeSends(
      [
        { status: "failed", createdAt: ago(5), error: "Brevo HTTP 500" },
        { status: "sent", createdAt: ago(60) }
      ],
      NOW
    );
    expect(summary.latest?.outcome).toBe("failed");
    expect(summary.everSent).toBe(true);
    expect(summary.lastSentAt).toBe(ago(60));
  });
});

describe("link vừa tạo có đúng là của người sắp nhận thư không", () => {
  const decision: SendDecision = {
    kind: "send",
    linkType: "recovery",
    writeLink: false,
    expectedAuthUserId: "auth-1",
    email: "an@example.com",
    recipientName: "An"
  };
  const good = { userId: "auth-1", userEmail: "AN@example.com", hashedToken: "hash-1", verificationType: "recovery" };

  it("khớp thì trả về tài khoản và mã", () => {
    expect(checkGeneratedLink(decision, good)).toEqual({ ok: true, authUserId: "auth-1", tokenHash: "hash-1" });
  });

  it.each([
    ["missing_token", { hashedToken: "" }],
    ["account_mismatch", { userId: "auth-9" }],
    ["account_mismatch", { userId: "" }],
    ["email_mismatch", { userEmail: "nguoi-khac@example.com" }],
    ["type_mismatch", { verificationType: "signup" }]
  ])("%s", (problem, change) => {
    expect(checkGeneratedLink(decision, { ...good, ...change })).toEqual({ ok: false, problem });
  });
});

describe("ghi mối nối gặp 23505", () => {
  const expected = { personId: PERSON, authUserId: "auth-1" };

  it("đã nối đúng rồi thì đi tiếp", () => {
    expect(linkStateAfterUniqueViolation({ byPerson: activeLink(), byAuthUser: activeLink() }, expected)).toEqual({ ok: true });
  });

  it("tài khoản đang nối với người khác thì dừng", () => {
    expect(
      linkStateAfterUniqueViolation({ byPerson: null, byAuthUser: activeLink({ personId: "nguoi-khac" }) }, expected)
    ).toEqual({ ok: false, reason: "auth_linked_to_other_person" });
  });

  it("người này đang nối với tài khoản khác thì dừng", () => {
    expect(
      linkStateAfterUniqueViolation({ byPerson: activeLink({ authUserId: "auth-9" }), byAuthUser: null }, expected)
    ).toEqual({ ok: false, reason: "person_linked_to_other_account" });
  });

  it("mối nối đúng cặp nhưng đã bị ngắt thì dừng", () => {
    expect(
      linkStateAfterUniqueViolation({ byPerson: activeLink({ status: "inactive" }), byAuthUser: null }, expected)
    ).toEqual({ ok: false, reason: "link_inactive" });
  });

  it("đọc lại không thấy gì thì không đoán", () => {
    expect(linkStateAfterUniqueViolation({ byPerson: null, byAuthUser: null }, expected)).toEqual({ ok: false, reason: null });
  });
});

describe("hạn mức", () => {
  it("chừa chỗ cho thư khác, và không bao giờ âm", () => {
    expect(inviteBudgetRemaining(0)).toBe(240);
    expect(inviteBudgetRemaining(239)).toBe(1);
    expect(inviteBudgetRemaining(240)).toBe(0);
    expect(inviteBudgetRemaining(900)).toBe(0);
    expect(inviteBudgetRemaining(Number.NaN)).toBe(0);
  });
});

describe("trạng thái trên màn hình", () => {
  const staffEmails = new Set<string>();
  const counts = new Map<string, number>([["an@example.com", 1]]);
  const base = {
    personId: PERSON,
    roles: ["mentor" as const],
    person: { fullName: "Nguyễn Văn An", emailPrimary: "an@example.com" },
    link: null,
    sends: [],
    staffEmails,
    cohortEmailCounts: counts,
    nowMs: NOW
  };

  it("có mối nối mà chưa từng đăng nhập thì KHÔNG phải 'Đã vào'", () => {
    const row = deriveRosterRow({ ...base, link: activeLink(), sends: [{ status: "sent", createdAt: ago(60) }] });
    expect(row.status).toBe("invited_pending");
  });

  it("có mốc đăng nhập đầu thì là 'Đã vào'", () => {
    expect(deriveRosterRow({ ...base, link: activeLink({ activatedAt: ago(10) }) }).status).toBe("active");
  });

  it("mối nối đã ngắt thắng mốc đăng nhập", () => {
    const row = deriveRosterRow({ ...base, link: activeLink({ status: "inactive", activatedAt: ago(10) }) });
    expect(row).toMatchObject({ status: "blocked", blockReason: "link_inactive" });
  });

  it("email nhân sự so sau khi chuẩn hoá", () => {
    const row = deriveRosterRow({
      ...base,
      person: { fullName: "An", emailPrimary: " AN@example.com " },
      staffEmails: new Set(["an@example.com"])
    });
    expect(row).toMatchObject({ status: "blocked", blockReason: "is_staff" });
  });

  it("trùng email trong mùa thì không mời được", () => {
    const row = deriveRosterRow({ ...base, cohortEmailCounts: new Map([["an@example.com", 2]]) });
    expect(row).toMatchObject({ status: "blocked", blockReason: "email_shared" });
  });

  it("không có trong danh bạ vẫn giữ dòng, để tổng số khớp với mùa", () => {
    const row = deriveRosterRow({ ...base, person: null });
    expect(row).toMatchObject({ status: "blocked", blockReason: "person_not_found", fullName: "(Chưa có tên)" });
  });

  it("thư gần nhất lỗi thì là 'Thư lỗi', và vẫn nhớ là đã từng gửi được", () => {
    const row = deriveRosterRow({
      ...base,
      sends: [
        { status: "sent", createdAt: ago(600) },
        { status: "failed", createdAt: ago(5) }
      ]
    });
    expect(row).toMatchObject({ status: "send_failed", everSent: true });
  });

  it("mọi trạng thái và lý do đều có nhãn", () => {
    for (const label of Object.values(ACCOUNT_STATUS_LABELS)) expect(label).toBeTruthy();
    for (const label of Object.values(ROSTER_BLOCK_LABELS)) expect(label).toBeTruthy();
  });
});

function row(index: number, overrides: Partial<RosterRow> = {}): RosterRow {
  return {
    personId: `p-${index}`,
    fullName: `Người ${String(index).padStart(3, "0")}`,
    email: `p${index}@example.com`,
    roles: ["mentor"],
    status: "not_invited",
    blockReason: null,
    inFlight: false,
    everSent: false,
    lastSentAt: null,
    latest: null,
    activatedAt: null,
    ...overrides
  };
}

describe("nút trên một dòng", () => {
  it("chưa mời → Mời; đã từng gửi → Gửi lại; đã vào → đặt lại mật khẩu", () => {
    expect(rosterRowAction(row(1), NOW).action).toBe("invite");
    expect(rosterRowAction(row(2, { status: "invited_pending", everSent: true, lastSentAt: ago(600) }), NOW).action).toBe(
      "resend"
    );
    expect(rosterRowAction(row(3, { status: "active", activatedAt: ago(10) }), NOW).action).toBe("reset");
  });

  it("không mời được hoặc đang gửi ở lượt khác thì không có nút", () => {
    expect(rosterRowAction(row(1, { status: "blocked", blockReason: "no_email" }), NOW).action).toBeNull();
    expect(rosterRowAction(row(2, { inFlight: true }), NOW).action).toBeNull();
  });

  it("vừa gửi thì khoá tới hết thời gian chờ", () => {
    const locked = rosterRowAction(row(1, { status: "invited_pending", everSent: true, lastSentAt: ago(3) }), NOW);
    expect(locked.lockedUntil).toBe(new Date(NOW + (INVITE_RESEND_COOLDOWN_MINUTES - 3) * MINUTE).toISOString());
  });
});

describe("ai vào lượt mời hàng loạt", () => {
  it("chỉ người chưa từng nhận thư", () => {
    expect(isBulkEligible(row(1), NOW)).toBe(true);
    expect(isBulkEligible(row(2, { status: "invited_pending", everSent: true }), NOW)).toBe(false);
    expect(isBulkEligible(row(3, { status: "active" }), NOW)).toBe(false);
    expect(isBulkEligible(row(4, { status: "blocked", blockReason: "is_staff" }), NOW)).toBe(false);
    expect(isBulkEligible(row(5, { inFlight: true }), NOW)).toBe(false);
  });

  it("thư lỗi: đợi đủ thời gian mới thử lại, và không bao giờ nếu đã từng gửi được", () => {
    const failed = (minutes: number, everSent = false) =>
      row(1, { status: "send_failed", everSent, latest: { outcome: "failed", at: ago(minutes), error: null } });
    expect(isBulkEligible(failed(INVITE_BULK_RETRY_AFTER_MINUTES + 1), NOW)).toBe(true);
    expect(isBulkEligible(failed(INVITE_BULK_RETRY_AFTER_MINUTES - 1), NOW)).toBe(false);
    expect(isBulkEligible(failed(INVITE_BULK_RETRY_AFTER_MINUTES + 1, true), NOW)).toBe(false);
  });

  it("người chưa mời trước, thư lỗi sau, trong nhóm theo tên", () => {
    const failed = row(1, { status: "send_failed", latest: { outcome: "failed", at: ago(90), error: null } });
    const ordered = selectBulkCandidates([row(3), failed, row(2)], NOW).map((candidate) => candidate.personId);
    expect(ordered).toEqual(["p-2", "p-3", "p-1"]);
  });
});

describe("lời báo", () => {
  const REASONS: InviteRefusalReason[] = [
    "person_not_found",
    "no_email",
    "invalid_email",
    "not_in_season",
    "role_not_invitable",
    "email_shared",
    "auth_ambiguous",
    "is_staff",
    "person_linked_to_other_account",
    "auth_linked_to_other_person",
    "link_inactive",
    "in_flight",
    "bulk_already_invited",
    "recently_sent",
    "daily_budget"
  ];

  it("mọi lý do từ chối có một câu tiếng Việt, không lộ mã", () => {
    for (const reason of REASONS) {
      const message = inviteRefusalMessage(reason, { lastSentAt: ago(2) });
      expect(message.length, reason).toBeGreaterThan(20);
      expect(message, reason).not.toContain(reason);
    }
  });

  it("thư khôi phục nói khác thư mời", () => {
    const invite = inviteOutcomeMessage("sent", { name: "An", linkType: "invite" });
    const recovery = inviteOutcomeMessage("sent", { name: "An", linkType: "recovery" });
    expect(invite).not.toBe(recovery);
    expect(recovery).toContain("không còn dùng được");
  });

  it("hết hạn mức thì nói rõ là hết hạn mức", () => {
    expect(inviteOutcomeMessage("send_failed", { name: "An", quota: true })).toContain("hạn mức");
  });

  it("lượt hàng loạt: còn người thì bảo Gửi tiếp, chạm hạn mức thì bảo ngày mai", () => {
    const tally = { sent: 20, alreadyActive: 0, refused: 0, notSent: 0 };
    expect(describeBulkRun({ tally, stoppedBy: null, remaining: 12 })).toContain("Gửi tiếp");
    const budget = describeBulkRun({ tally, stoppedBy: "daily_budget", remaining: 12 });
    expect(budget).toContain("ngày mai");
    expect(budget).not.toContain("Gửi tiếp");
    expect(describeBulkRun({ tally, stoppedBy: null, remaining: null })).toContain("Chưa đếm lại");
  });
});

describe("một định nghĩa cho 'thành viên chính thức'", () => {
  it("trạng thái được mời trùng với trạng thái trang /ct cho xem", () => {
    expect([...INVITE_MEMBERSHIP_STATUSES]).toEqual([...VISIBLE_MEMBERSHIP_STATUSES]);
  });
});
