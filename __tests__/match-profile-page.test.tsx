/**
 * Trang /ho-so/<token> — hồ sơ người đồng hành gửi kèm thư kết quả ghép cặp.
 *
 * Trang này mở được khi CHƯA đăng nhập và mang SĐT/email của một người thật, nên cổng là tất cả:
 * link chỉ còn hiệu lực khi cặp còn hoạt động, đúng hai người của cặp, người được xem chưa rút.
 * Mọi nhánh hỏng phải ra CÙNG một câu báo và KHÔNG ghi gì — người cầm một link sai không được
 * biết nó sai vì đâu, và một link sai không được để lại dấu "đã mở" trên link của người khác.
 */
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { createFakeDb, fakeClient } from "./support/fake-postgrest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({ getSupabaseServiceRoleClient: vi.fn(), getSupabaseServerClient: vi.fn() }));

import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import { mintBearerToken } from "@/lib/bearer-token";
import { PROFILE_LINK_FAILURE_MESSAGE } from "@/lib/match-profile-core";
import { getMatchProfilePage } from "@/lib/match-profile";
import MatchProfilePage, { metadata } from "@/app/ho-so/[token]/page";
import { middleware } from "@/middleware";

const S12 = "5e000000-0000-4000-8000-000000000012";
const S11 = "5e000000-0000-4000-8000-000000000011";
const MATCH = "aa000000-0000-4000-8000-000000000001";
const LINK = "11000000-0000-4000-8000-000000000001";
const MENTOR = "0e000000-0000-4000-8000-00000000000a";
const MENTEE = "0e000000-0000-4000-8000-00000000000b";
const STRANGER = "0e000000-0000-4000-8000-00000000000c";

const MENTOR_PHONE = "0901 234 567";
const MENTOR_EMAIL = "mentor.that@example.com";

const db = createFakeDb();
let token = "";

function seed(over: { link?: Record<string, unknown>; match?: Record<string, unknown>; membership?: Record<string, unknown> } = {}) {
  db.reset();
  const minted = mintBearerToken();
  token = minted.token;
  db.tables.seasons = [
    { id: S12, code: "UEHM-S12" },
    { id: S11, code: "UEHM-S11" }
  ];
  db.tables.matches = [
    { id: MATCH, season_id: S12, status: "active", mentor_person_id: MENTOR, mentee_person_id: MENTEE, ...over.match }
  ];
  db.tables.match_profile_links = [
    {
      id: LINK,
      season_id: S12,
      match_id: MATCH,
      viewer_person_id: MENTEE,
      subject_person_id: MENTOR,
      subject_role: "mentor",
      token_hash: minted.tokenHash,
      revoked_at: null,
      first_viewed_at: null,
      last_viewed_at: null,
      ...over.link
    }
  ];
  db.tables.person_season_memberships = [
    { id: "ab000000-0000-4000-8000-000000000001", person_id: MENTOR, season_id: S12, role: "mentor", status: "active", ...over.membership }
  ];
  db.tables.people = [
    { id: MENTOR, full_name: "Nguyễn Văn Mentor", email_primary: MENTOR_EMAIL, phone_primary: MENTOR_PHONE },
    { id: MENTEE, full_name: "Trần Thị Mentee", email_primary: "mentee@example.com", phone_primary: "0911 000 000" }
  ];
  db.tables.applications = [
    {
      id: "a1000000-0000-4000-8000-000000000001",
      person_id: MENTOR,
      season_id: S12,
      role_applied: "mentor",
      status: "approved_as_mentor",
      source: "s12_mentor",
      full_name: "Nguyễn Văn Mentor",
      email_primary: MENTOR_EMAIL,
      phone_primary: MENTOR_PHONE,
      created_at: "2026-09-01T00:00:00Z",
      raw_payload: { title_current: "Giám đốc Tài chính", company_current: "Công ty Mẫu", core_team_note: "GHI CHU NOI BO" }
    }
  ];
  db.tables.matching_industry_assignments = [
    { id: "a2000000-0000-4000-8000-000000000001", person_id: MENTOR, season_id: S12, role: "mentor", group_code: 3 }
  ];
  db.tables.mentor_profiles = [];
  db.tables.mentee_profiles = [];
  db.tables.application_reviews = [];
}

async function renderPage(raw: string) {
  const element = await MatchProfilePage({ params: Promise.resolve({ token: raw }) });
  return renderToStaticMarkup(element);
}

/** Phần thẻ của một trường — soi đúng hàng đó, không tìm chung cả trang. */
function fieldRow(html: string, key: string) {
  const start = html.indexOf(`data-field="${key}"`);
  if (start < 0) return null;
  const end = html.indexOf("</div>", start);
  return html.slice(start, end);
}

beforeEach(() => {
  (getSupabaseServiceRoleClient as Mock).mockReturnValue(fakeClient(db));
  seed();
});

describe("link hợp lệ: thẻ hiện đủ, SĐT/email nằm trong thẻ", () => {
  it("mentee mở link hồ sơ mentor của mình: thấy tên, chức danh, và SĐT/email ở đúng hàng", async () => {
    const html = await renderPage(token);
    expect(html).toContain('data-testid="match-profile-card"');
    expect(html).toContain("Hồ sơ Mentor đồng hành");
    expect(fieldRow(html, "full_name")).toContain("Nguyễn Văn Mentor");
    expect(fieldRow(html, "title_current")).toContain("Giám đốc Tài chính");
    expect(fieldRow(html, "phone")).toContain(MENTOR_PHONE);
    expect(fieldRow(html, "email")).toContain(MENTOR_EMAIL);
    expect(html).toContain('data-testid="profile-privacy-note"');
    expect(html).not.toContain('data-testid="profile-invalid"');
  });

  it("ghi chú nội bộ trong đơn không bao giờ lên trang", async () => {
    const html = await renderPage(token);
    expect(html).not.toContain("GHI CHU NOI BO");
  });

  it("ghi mốc mở link: chỉ hai lệnh hẹp trên đúng dòng link, first_viewed_at chỉ ghi khi còn trống", async () => {
    await renderPage(token);
    expect(db.writes.map((w) => [w.table, w.kind, Object.keys(w.rows[0])])).toEqual([
      ["match_profile_links", "update", ["first_viewed_at"]],
      ["match_profile_links", "update", ["last_viewed_at"]]
    ]);
    expect(db.writes[0].filters).toContain(LINK);
    expect(db.writes[0].filters).toContain('"kind":"isNull","column":"first_viewed_at"');
    expect(db.writes[1].filters).toContain(LINK);
  });

  it("ghi mốc mở link hỏng thì trang vẫn hiện", async () => {
    db.errors["update:match_profile_links"] = { message: "boom" };
    const html = await renderPage(token);
    expect(fieldRow(html, "phone")).toContain(MENTOR_PHONE);
  });

  it("chiều ngược lại: mentor mở link hồ sơ mentee của mình", async () => {
    db.tables.match_profile_links[0] = {
      ...db.tables.match_profile_links[0],
      viewer_person_id: MENTOR,
      subject_person_id: MENTEE,
      subject_role: "mentee"
    };
    db.tables.person_season_memberships = [
      { id: "ab000000-0000-4000-8000-000000000002", person_id: MENTEE, season_id: S12, role: "mentee", status: "active" }
    ];
    const html = await renderPage(token);
    expect(html).toContain("Hồ sơ Mentee đồng hành");
    expect(fieldRow(html, "full_name")).toContain("Trần Thị Mentee");
    expect(fieldRow(html, "phone")).toContain("0911 000 000");
  });
});

describe("mọi link hỏng: cùng một câu báo, không lộ gì, không ghi gì", () => {
  const cases: [string, () => string][] = [
    ["mã sai định dạng", () => "abc"],
    ["mã thiếu một ký tự", () => token.slice(1)],
    ["mã đúng định dạng nhưng không có trong bảng", () => mintBearerToken().token],
    ["link đã thu hồi (gửi lại thư thì link cũ hết hiệu lực)", () => { seed({ link: { revoked_at: "2026-10-22T05:00:00Z" } }); return token; }],
    ["link của mùa khác", () => { seed({ link: { season_id: S11 } }); return token; }],
    ["cặp đã huỷ", () => { seed({ match: { status: "cancelled" } }); return token; }],
    ["cặp đã kết thúc", () => { seed({ match: { status: "ended" } }); return token; }],
    ["cặp thuộc mùa khác", () => { seed({ match: { season_id: S11 } }); return token; }],
    ["cặp đã đổi mentee (người xem không còn trong cặp)", () => { seed({ match: { mentee_person_id: STRANGER } }); return token; }],
    ["cặp đã đổi mentor (người được xem không còn trong cặp)", () => { seed({ match: { mentor_person_id: STRANGER } }); return token; }],
    ["vai trong link không khớp vai trong cặp", () => { seed({ link: { subject_role: "mentee" } }); return token; }],
    ["vai lạ trong link", () => { seed({ link: { subject_role: "admin" } }); return token; }],
    ["người được xem đã rút", () => { seed({ membership: { status: "withdrawn" } }); return token; }],
    ["người được xem đã xin dừng", () => { seed({ membership: { status: "opted_out" } }); return token; }],
    ["đọc bảng link lỗi", () => { db.errors.match_profile_links = { message: "down" }; return token; }],
    ["đọc cặp lỗi", () => { db.errors.matches = { message: "down" }; return token; }],
    ["đọc trạng thái thành viên lỗi (fail-closed)", () => { db.errors.person_season_memberships = { message: "down" }; return token; }],
    ["đọc hồ sơ lỗi", () => { db.errors.applications = { message: "down" }; return token; }]
  ];

  it.each(cases)("%s", async (_label, makeToken) => {
    const raw = makeToken();
    const result = await getMatchProfilePage(raw, fakeClient(db));
    expect(result).toEqual({ state: "invalid", message: PROFILE_LINK_FAILURE_MESSAGE, seasonLabel: expect.any(String) });

    const html = await renderPage(raw);
    expect(html).toContain('data-testid="profile-invalid"');
    expect(html).not.toContain('data-testid="match-profile-card"');
    expect(html).not.toContain(MENTOR_PHONE);
    expect(html).not.toContain(MENTOR_EMAIL);
    expect(html).not.toContain("Nguyễn Văn Mentor");
    expect(db.writes).toEqual([]);
  });

  it("mã sai định dạng không chạm database", async () => {
    await getMatchProfilePage("abc", fakeClient(db));
    expect(db.requests).toEqual([]);
  });
});

describe("tiêu đề trang và middleware", () => {
  it("không cho máy tìm kiếm lập chỉ mục; referrer same-origin, không phải no-referrer", () => {
    expect(metadata.robots).toEqual({ index: false, follow: false });
    expect(metadata.referrer).toBe("same-origin");
  });

  it("mở được khi chưa đăng nhập, mang nhãn trang công khai, không lưu cache", async () => {
    const response = await middleware(new NextRequest(`https://os.test/ho-so/${token}`));
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("x-middleware-request-x-vam-public-route")).toBe("match_profile");
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(response.headers.get("Referrer-Policy")).toBe("same-origin");
  });

  it("chỉ đúng tiền tố /ho-so/ là công khai: đường trông giống vẫn đòi đăng nhập", async () => {
    for (const path of ["/ho-so", "/ho-sox/a", "/matches/ket-qua"]) {
      const response = await middleware(new NextRequest(`https://os.test${path}`));
      expect(response.headers.get("x-middleware-request-x-vam-public-route"), path).toBeNull();
      expect(response.headers.get("location"), path).toContain("/login");
    }
  });

  it("layout nhận nhãn này làm khung trần (không vẽ menu ban tổ chức quanh trang)", () => {
    expect(readFileSync("app/layout.tsx", "utf8")).toContain('publicRoute === "match_profile"');
  });
});
