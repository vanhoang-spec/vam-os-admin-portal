import { describe, it, expect } from "vitest";
import type { CurrentAdminUser } from "../lib/auth-constants";
import { buildNavGroups, isActiveRoute, allNavHrefs, navItemsOf } from "../lib/nav-model";

function makeUser(role: CurrentAdminUser["role"]): CurrentAdminUser {
  return { id: "u1", email: "test@vam.org", full_name: null, role, status: "active", auth_user_id: null };
}

const ROUTES_ALL = [
  "/", "/operations",
  "/people", "/mentors", "/mentees",
  "/applications", "/reviews", "/interviews",
  "/matches", "/events", "/data-issues",
  "/admin", "/team", "/admin/users",
];

const ROUTES_BASE = [
  "/", "/operations",
  "/people", "/mentors", "/mentees",
  "/applications",
  "/matches", "/events", "/data-issues",
];

// H2 fix: canBrowseOperations gates both /operations and /matches nav
// visibility now (super_admin/admin/core_team/support_team only). viewer,
// reviewer and an unauthenticated (null) user no longer see either link.
const ROUTES_BASE_NO_OPS_MATCHES = ROUTES_BASE.filter((r) => r !== "/operations" && r !== "/matches");

// ── isActiveRoute ─────────────────────────────────────────────────────────────

describe("isActiveRoute", () => {
  it("matches root exactly", () => {
    expect(isActiveRoute("/", "/")).toBe(true);
  });

  it("does not prefix-match root for other routes", () => {
    expect(isActiveRoute("/operations", "/")).toBe(false);
    expect(isActiveRoute("/operations/monthly", "/")).toBe(false);
  });

  it("prefix-matches non-root routes", () => {
    expect(isActiveRoute("/operations/monthly", "/operations")).toBe(true);
    expect(isActiveRoute("/admin/users", "/admin")).toBe(true);
  });

  it("does not match a different route that starts with the same characters", () => {
    expect(isActiveRoute("/admins", "/admin")).toBe(false);
    expect(isActiveRoute("/operations-overview", "/operations")).toBe(false);
  });

  it("matches exact non-root path", () => {
    expect(isActiveRoute("/matches", "/matches")).toBe(true);
    expect(isActiveRoute("/events", "/events")).toBe(true);
  });
});

// ── buildNavGroups — super_admin ──────────────────────────────────────────────

describe("buildNavGroups — super_admin", () => {
  const groups = buildNavGroups(makeUser("super_admin"));
  const hrefs = allNavHrefs(groups);

  // The cap moved from 8 to 9 when "Công việc của tôi" was added as a
  // top-level entry. It is deliberately top-level: the requirement is that an
  // operator sees their assigned work immediately after login, which a link
  // nested inside "Ứng tuyển" does not achieve. The cap still exists to stop
  // the sidebar growing without a decision.
  it("has ≤ 9 top-level groups", () => {
    expect(groups.length).toBeLessThanOrEqual(9);
  });

  it("contains all 14 routes", () => {
    ROUTES_ALL.forEach((r) => expect(hrefs).toContain(r));
  });

  it("includes admin group with user management sub-item", () => {
    const admin = groups.find((g) => g.key === "admin");
    expect(admin).toBeDefined();
    expect(navItemsOf(admin!).map((i) => i.href)).toContain("/admin/users");
  });

  // Nhóm “Tuyển Mentor/Mentee” (06/10/2026): các trang nằm trong hai nhánh con,
  // allNavHrefs gom cả tầng ba và bỏ bộ lọc ?role_applied=.
  it("applications group has reviews and interviews sub-items", () => {
    const apps = groups.find((g) => g.key === "applications");
    const subHrefs = allNavHrefs(apps ? [apps] : []);
    expect(subHrefs).toContain("/reviews");
    expect(subHrefs).toContain("/interviews");
    expect(subHrefs).toContain("/applications");
  });

  it("operations group is an accordion with all 6 sub-items for super_admin", () => {
    const ops = groups.find((g) => g.key === "operations");
    expect(ops!.items).toBeDefined();
    const opHrefs = navItemsOf(ops!).map((i) => i.href);
    expect(opHrefs).toContain("/operations");
    expect(opHrefs).toContain("/operations/tasks");
    expect(opHrefs).toContain("/operations/monthly");
    expect(opHrefs).toContain("/operations/intelligence");
    expect(opHrefs).toContain("/operations/mail");
    expect(opHrefs).toContain("/recaps/create");
  });
});

// ── buildNavGroups — admin ────────────────────────────────────────────────────

describe("buildNavGroups — admin", () => {
  const groups = buildNavGroups(makeUser("admin"));
  const hrefs = allNavHrefs(groups);

  it("has ≤ 9 top-level groups", () => expect(groups.length).toBeLessThanOrEqual(9));
  it("does NOT include /admin/users", () => expect(hrefs).not.toContain("/admin/users"));
  it("retains unrelated admin routes", () => {
    expect(hrefs).toContain("/admin");
    expect(hrefs).toContain("/admin/renewals");
    expect(hrefs).toContain("/admin/seasons-forms");
  });
  it("includes /reviews and /interviews", () => {
    expect(hrefs).toContain("/reviews");
    expect(hrefs).toContain("/interviews");
  });
});

// ── buildNavGroups — core_team ────────────────────────────────────────────────

describe("buildNavGroups — core_team", () => {
  const groups = buildNavGroups(makeUser("core_team"));
  const hrefs = allNavHrefs(groups);

  it("has ≤ 9 top-level groups", () => expect(groups.length).toBeLessThanOrEqual(9));

  it("does NOT include /admin/users", () => expect(hrefs).not.toContain("/admin/users"));

  it("includes admin group but without user management", () => {
    const admin = groups.find((g) => g.key === "admin");
    expect(admin).toBeDefined();
    expect(navItemsOf(admin!).map((i) => i.href)).not.toContain("/admin/users");
    expect(navItemsOf(admin!).map((i) => i.href)).toContain("/admin");
    expect(navItemsOf(admin!).map((i) => i.href)).toContain("/team");
  });

  it("includes /reviews and /interviews", () => {
    expect(hrefs).toContain("/reviews");
    expect(hrefs).toContain("/interviews");
  });
});

// ── buildNavGroups — reviewer ─────────────────────────────────────────────────

describe("buildNavGroups — reviewer", () => {
  const groups = buildNavGroups(makeUser("reviewer"));
  const hrefs = allNavHrefs(groups);

  it("has ≤ 9 top-level groups", () => expect(groups.length).toBeLessThanOrEqual(9));

  it("does NOT include admin group", () => {
    expect(groups.find((g) => g.key === "admin")).toBeUndefined();
  });

  it("does NOT include /team, /admin, or /admin/users", () => {
    expect(hrefs).not.toContain("/team");
    expect(hrefs).not.toContain("/admin");
    expect(hrefs).not.toContain("/admin/users");
  });

  it("includes /reviews and /interviews", () => {
    expect(hrefs).toContain("/reviews");
    expect(hrefs).toContain("/interviews");
  });

  // S12 helper boundary: a standalone recruitment reviewer is offered only the
  // surfaces they can actually use. Every browse route below already refused a
  // reviewer at the page — nav simply had not caught up, so a helper invited to
  // score mentee applications was shown six links that bounced them back.
  it("is offered only its own recruitment surfaces", () => {
    expect(sortedRoutes(hrefs)).toEqual(
      sortedRoutes([
        "/", "/my-work", "/reviews", "/interviews", "/interviews/lich",
        "/interviews/ket-qua-mentor", "/interviews/mentee-offline"
      ])
    );
  });

  it("is NOT offered browse routes its pages refuse", () => {
    [
      "/people", "/mentors", "/mentees",
      "/applications", "/applications/mentor-review", "/applications/mentee-review",
      "/events", "/data-issues", "/participant-accounts"
    ].forEach((r) => expect(hrefs).not.toContain(r));
  });

  // H2: a reviewer's season "review" grant is not canBrowseOperations —
  // these routes previously leaked to any reviewer regardless of scope.
  it("does NOT include /operations or /matches (H2)", () => {
    expect(hrefs).not.toContain("/operations");
    expect(hrefs).not.toContain("/matches");
    expect(groups.find((g) => g.key === "operations")).toBeUndefined();
  });
});

// ── buildNavGroups — viewer ───────────────────────────────────────────────────

describe("buildNavGroups — viewer", () => {
  const groups = buildNavGroups(makeUser("viewer"));
  const hrefs = allNavHrefs(groups);

  it("has ≤ 9 top-level groups", () => expect(groups.length).toBeLessThanOrEqual(9));

  it("does NOT include review, interview, or admin routes", () => {
    ["/reviews", "/interviews", "/admin", "/team", "/admin/users", "/participant-accounts"].forEach((r) =>
      expect(hrefs).not.toContain(r)
    );
  });

  // viewer is excluded from every lib/read-access predicate, so the same trim
  // that fixed the reviewer's dead links removes viewer's too. No access
  // changes — every one of these routes already redirected a viewer.
  it("is offered only the dashboard", () => {
    expect(sortedRoutes(hrefs)).toEqual(["/"]);
  });

  it("has no applications group at all", () => {
    expect(groups.find((g) => g.key === "applications")).toBeUndefined();
  });

  // H2: viewer is not in canBrowseOperations, so the operations nav entry
  // (previously a standalone fallback link shown to every non-admin-tier
  // role) and the /matches link are both omitted entirely now.
  it("has no operations group and no /matches link (H2)", () => {
    expect(groups.find((g) => g.key === "operations")).toBeUndefined();
    expect(hrefs).not.toContain("/operations");
    expect(hrefs).not.toContain("/matches");
  });
});

// ── buildNavGroups — support_team ─────────────────────────────────────────────

describe("buildNavGroups — support_team", () => {
  const groups = buildNavGroups(makeUser("support_team"));
  const hrefs = allNavHrefs(groups);

  it("has ≤ 9 top-level groups", () => expect(groups.length).toBeLessThanOrEqual(9));

  it("does NOT include review or admin routes", () => {
    ["/reviews", "/interviews", "/admin", "/team", "/admin/users"].forEach((r) =>
      expect(hrefs).not.toContain(r)
    );
  });

  it("includes all base routes", () => {
    ROUTES_BASE.forEach((r) => expect(hrefs).toContain(r));
  });
});

// ── buildNavGroups — null user ────────────────────────────────────────────────

describe("buildNavGroups — null user", () => {
  const groups = buildNavGroups(null);
  const hrefs = allNavHrefs(groups);

  it("returns no admin group", () => {
    expect(groups.find((g) => g.key === "admin")).toBeUndefined();
  });

  it("returns no gated routes", () => {
    ["/reviews", "/interviews", "/admin", "/team", "/admin/users", "/operations", "/matches", "/participant-accounts"].forEach((r) =>
      expect(hrefs).not.toContain(r)
    );
  });

  it("is offered only the dashboard", () => {
    expect(sortedRoutes(hrefs)).toEqual(["/"]);
  });
});

describe("buildNavGroups — inactive super_admin", () => {
  const inactiveSuperAdmin = {
    ...makeUser("super_admin"),
    status: "inactive"
  } as unknown as CurrentAdminUser;

  it("fails closed and does NOT include /admin/users", () => {
    expect(allNavHrefs(buildNavGroups(inactiveSuperAdmin))).not.toContain("/admin/users");
  });
});

// ── Route coverage unchanged from Batch 1 ────────────────────────────────────

describe("route coverage — no routes removed by nav grouping", () => {
  it("super_admin can reach all 14 original routes", () => {
    const hrefs = allNavHrefs(buildNavGroups(makeUser("super_admin")));
    ROUTES_ALL.forEach((r) => expect(hrefs).toContain(r));
  });

  // The community group now follows lib/read-access, the same policy its three
  // pages enforce. Roles that may browse still see all three; roles whose pages
  // would redirect them are no longer offered the link.
  it("community group exposes /people, /mentors, /mentees for every role that may browse them", () => {
    const roles: CurrentAdminUser["role"][] = ["super_admin", "admin", "core_team", "support_team"];
    roles.forEach((role) => {
      const hrefs = allNavHrefs(buildNavGroups(makeUser(role)));
      expect(hrefs).toContain("/people");
      expect(hrefs).toContain("/mentors");
      expect(hrefs).toContain("/mentees");
    });
  });

  it("hides the community group from roles whose pages refuse them", () => {
    (["reviewer", "viewer"] as CurrentAdminUser["role"][]).forEach((role) => {
      const hrefs = allNavHrefs(buildNavGroups(makeUser(role)));
      expect(hrefs).not.toContain("/people");
      expect(hrefs).not.toContain("/mentors");
      expect(hrefs).not.toContain("/mentees");
    });
  });
});

// ── allNavHrefs ───────────────────────────────────────────────────────────────

describe("allNavHrefs", () => {
  it("flattens standalone hrefs and sub-item hrefs", () => {
    const groups = buildNavGroups(makeUser("super_admin"));
    const hrefs = allNavHrefs(groups);
    expect(hrefs).toContain("/");
    expect(hrefs).toContain("/people");
    expect(hrefs).toContain("/admin/users");
  });

  it("produces no duplicates for any role", () => {
    const roles: CurrentAdminUser["role"][] = ["super_admin", "admin", "core_team", "reviewer", "viewer"];
    roles.forEach((role) => {
      const hrefs = allNavHrefs(buildNavGroups(makeUser(role)));
      const unique = new Set(hrefs);
      expect(unique.size).toBe(hrefs.length);
    });
  });
});

// ── Explicit per-role route set equivalence ───────────────────────────────────
//
// Batch-3 additions: admin-tier roles (core_team, admin, super_admin) get
// operations sub-nav items (tasks, monthly, intelligence, recaps/create) via
// the Vận hành accordion group.
//
// M090 R1 / H2: /operations and /matches are gated by canBrowseOperations
// (super_admin, admin, core_team, support_team). viewer and reviewer no
// longer see either link — a reviewer's season "review" scope grant is not
// a general-operations role, and viewer never had any operations access to
// begin with.
//
// Source of truth: lib/nav-model.ts buildNavGroups()
//   navItems (all roles):        /, /people, /mentors, /mentees,
//                                 /applications, /events, /data-issues
//   canBrowseOperations:         + /operations, /matches (support_team gets
//                                 the plain links; admin-tier gets the
//                                 accordion below)
//   showAdminTier (+core):       /operations → accordion; adds /operations/tasks,
//                                 /operations/monthly, /operations/intelligence,
//                                 /recaps/create; also + /admin, /team
//   canReview (+reviewer):       + /applications/mentor-review,
//                                 /applications/mentee-review, /reviews, /interviews
//   active super_admin only:     + /admin/users

const BASE_ROUTE_ARR = [
  "/", "/operations", "/people", "/mentors", "/mentees",
  "/applications", "/matches", "/events", "/data-issues",
  // Ghép cặp Vòng 2 (07/10/2026): mục con của "Ghép cặp", cùng cổng canBrowseOperations.
  "/matches/vong-2", "/matches/vong-2/bao-cao",
];

// H2 fix: /operations and /matches are gated by canBrowseOperations
// (super_admin/admin/core_team/support_team). viewer and reviewer no
// longer receive either link.
const BASE_ROUTE_ARR_NO_OPS_MATCHES = BASE_ROUTE_ARR.filter((r) => r !== "/operations" && !r.startsWith("/matches"));

const SUPER_ADMIN_BASE_ROUTES = ["/portfolio", ...BASE_ROUTE_ARR];

const OPS_ADMIN_ROUTES = [
  "/operations/tasks",
  "/operations/monthly",
  "/operations/intelligence",
  // Module Mail. Sổ thư đã gửi (/operations/emails) vẫn là route mở được,
  // nhưng nav trỏ vào module chứ không vào một trang bên trong nó — vào đó
  // bằng dải tab của module.
  "/operations/mail",
  "/recaps/create",
];

// M069 added /admin/seasons-forms to the admin-tier group. It is visible to
// core_team as well, because the screen is useful read-only; the ability to
// CHANGE a form's state is gated separately by canToggleApplicationForm plus
// season scope, not by nav visibility.
const ADMIN_TIER_ROUTES = ["/admin", "/admin/renewals", "/admin/seasons-forms", "/team"];

const REVIEW_ROUTES = [
  // My Work rides the same `showReviews` gate as the rest of this set: it is
  // the personal view of the assignments those screens hand out, so any role
  // that can hold one sees it and no other role does.
  "/my-work",
  "/applications/mentor-review",
  "/applications/mentee-review",
  "/reviews",
  "/interviews",
  // Lịch phỏng vấn mentor 1:1 (22/09/2026): cùng khán giả showReviews — trang
  // tự gate bằng canSelfClaimInterview, tài khoản reviewer còn phải được cấp
  // vai trò interviewer của mùa ở tầng lib.
  "/interviews/lich",
  "/interviews/ket-qua-mentor",
  "/interviews/mentee-offline",
];

// Xem tình hình 28 ca phỏng vấn mentee (24/09, mở rộng đọc cho support_team
// 01/10/2026). CỐ Ý tách khỏi REVIEW_ROUTES: trang gate bằng
// canViewMenteeSessionStatus, hẹp hơn nhóm nav REVIEW_ROUTES (reviewer không
// được mời vào một trang chỉ trả về câu từ chối) nhưng RỘNG hơn canAssignReview
// theo chiều khác — support_team thấy link này dù không thuộc REVIEW_ROUTES.
// Sửa ghế/địa điểm/gửi thư mời vẫn hẹp hơn nữa (canAssignReview); trang tự ẩn
// các nút đó cho support_team, không phải việc của nav.
// Tiến độ phỏng vấn mentee (03/10/2026) đi cùng cổng: BTC xem kết quả mọi bạn,
// mentor phỏng vấn (reviewer) thì không.
// Báo cáo phỏng vấn mentee theo đợt (06/10/2026) cũng vậy: có điểm theo từng người phỏng vấn.
const MENTEE_SESSION_STATUS_ROUTES = ["/interviews/ca-mentee", "/interviews/tien-do-mentee", "/interviews/tien-do-mentor", "/interviews/bao-cao-mentee"];
// Chỉ quản trị viên (canSendBulkEmail) — core_team/support_team không thấy.
const MENTOR_CONFIRMATION_ROUTES = ["/interviews/thu-xac-nhan-mentor"];

// Menu Tuyển Mentor/Mentee (06/10/2026): “Danh sách nhân sự tuyển sinh” đứng đầu nhóm và
// “Giao hồ sơ mentor / mentee” trong hai nhánh — Ban điều hành giờ cũng thấy hai màn hình
// này trên menu (trước chỉ vào từ nút trên trang Đánh giá). support_team đã thấy từ trước.
const STAFFING_ROUTES = ["/reviews/assign-bulk", "/reviews/reviewer-pool"];

// Phiếu chấm + Handbook phỏng vấn mentee theo mùa (02/10/2026). Ba vai trò của
// canEditInterviewRubric — support_team xem phiếu trên màn hình phỏng vấn nhưng
// không sửa, nên KHÔNG thấy link này; reviewer và viewer cũng không.
const INTERVIEW_RUBRIC_ROUTES = ["/interviews/phieu-cham-mentee"];

// S12 helper boundary: the browse routes in the base set are now gated on the
// SAME predicates their pages enforce (lib/read-access for the community and
// application directories, canBrowseOperations for /events and /data-issues).
// support_team satisfies all of them and its set is unchanged. viewer and
// reviewer satisfy none, so both keep only what they can actually open —
// reviewer plus its recruitment surfaces. No route's access changed; only what
// the nav offers.
const HELPER_REVIEW_ROUTES = [
  "/my-work", "/reviews", "/interviews", "/interviews/lich",
  "/interviews/ket-qua-mentor", "/interviews/mentee-offline"
];

// Mời mentor/mentee lập tài khoản (11/09/2026). Bốn vai trò của
// canInviteParticipants — support_team có mặt theo quyết định của chủ chương
// trình, reviewer và viewer thì không.
const LOGIN_ACCOUNT_ROUTES = ["/participant-accounts"];

// Công cụ AI (14/09/2026). Bốn vai trò của canUseAiTools — support_team có mặt
// theo quyết định của chủ chương trình; reviewer và viewer thì không, vì mỗi lần
// bấm là gửi nội dung ra nước ngoài và tốn tiền khoá API. Mục nằm trong nhóm
// "Vận hành" chứ không thành nhóm riêng: admin tier đã chạm trần 9 nhóm.
const AI_TOOL_ROUTES = ["/ai"];

// Điểm cộng theo ngày nộp (16/09/2026). Bốn vai trò của canManageSubmissionBonus —
// support_team có mặt vì đó là nhóm được giao đặt mốc; reviewer và viewer thì không:
// mốc đổi điểm mà Core Team dùng để xếp hạng.
const SUBMISSION_BONUS_ROUTES = ["/admin/seasons-forms/bonus-points"];

const EXPECTED_ROUTES: Record<CurrentAdminUser["role"], string[]> = {
  viewer:       ["/"],
  // support_team là nhóm thật sự viết thư cho người tham gia, nên nó soạn
  // được mẫu thư (canComposeEmailTemplate) dù không thuộc admin tier. Nó KHÔNG
  // duyệt và KHÔNG gửi được, và không thấy sổ thư đã gửi — đó là các cổng khác.
  //
  // Từ 11/09/2026 support_team cũng mời reviewer và giao hồ sơ, nên thấy đúng
  // hai màn hình đó — nhưng vẫn không thấy /reviews hay /interviews.
  support_team: [...BASE_ROUTE_ARR, "/interviews/ket-qua-mentor", "/interviews/mentee-offline", "/operations/mail", "/reviews/assign-bulk", "/reviews/reviewer-pool", ...LOGIN_ACCOUNT_ROUTES, ...AI_TOOL_ROUTES, ...SUBMISSION_BONUS_ROUTES, ...MENTEE_SESSION_STATUS_ROUTES],
  reviewer:     ["/", ...HELPER_REVIEW_ROUTES],
  core_team:    [...BASE_ROUTE_ARR, ...OPS_ADMIN_ROUTES, ...REVIEW_ROUTES, ...STAFFING_ROUTES, ...ADMIN_TIER_ROUTES, ...LOGIN_ACCOUNT_ROUTES, ...AI_TOOL_ROUTES, ...SUBMISSION_BONUS_ROUTES, ...MENTEE_SESSION_STATUS_ROUTES, ...INTERVIEW_RUBRIC_ROUTES],
  admin:        [...BASE_ROUTE_ARR, ...OPS_ADMIN_ROUTES, ...REVIEW_ROUTES, ...STAFFING_ROUTES, ...ADMIN_TIER_ROUTES, ...LOGIN_ACCOUNT_ROUTES, ...AI_TOOL_ROUTES, ...SUBMISSION_BONUS_ROUTES, ...MENTEE_SESSION_STATUS_ROUTES, ...INTERVIEW_RUBRIC_ROUTES, ...MENTOR_CONFIRMATION_ROUTES],
  super_admin:  [...SUPER_ADMIN_BASE_ROUTES, ...OPS_ADMIN_ROUTES, ...REVIEW_ROUTES, ...STAFFING_ROUTES, ...ADMIN_TIER_ROUTES, "/admin/users", ...LOGIN_ACCOUNT_ROUTES, ...AI_TOOL_ROUTES, ...SUBMISSION_BONUS_ROUTES, ...MENTEE_SESSION_STATUS_ROUTES, ...INTERVIEW_RUBRIC_ROUTES, ...MENTOR_CONFIRMATION_ROUTES],
};

function sortedRoutes(arr: string[]) {
  return [...arr].sort();
}

describe("Explicit per-role route set — equivalence with nav-model permission gates", () => {
  const roles = Object.keys(EXPECTED_ROUTES) as CurrentAdminUser["role"][];

  roles.forEach((role) => {
    it(`${role}: exact route set matches base commit (${EXPECTED_ROUTES[role].length} routes)`, () => {
      const actual = sortedRoutes(allNavHrefs(buildNavGroups(makeUser(role))));
      const expected = sortedRoutes(EXPECTED_ROUTES[role]);
      expect(actual).toEqual(expected);
    });
  });

  it("null user has exactly the same routes as viewer", () => {
    const actual = sortedRoutes(allNavHrefs(buildNavGroups(null)));
    const expected = sortedRoutes(EXPECTED_ROUTES.viewer);
    expect(actual).toEqual(expected);
  });
});
