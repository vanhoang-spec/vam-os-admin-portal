import type { AdminRole, CurrentAdminUser } from "@/lib/auth-constants";
import {
  canSendBulkEmail,
  canAssignReviewLots,
  canBrowseOperations,
  canComposeEmailTemplate,
  canInviteParticipants,
  canManageReviewers,
  canManageSubmissionBonus,
  canUseAiTools,
  canEditInterviewRubric,
  canViewMenteeSessionStatus
} from "@/lib/permissions";
import {
  canBrowseApplications,
  canBrowseParticipants,
  canBrowsePeople
} from "@/lib/read-access";
import { SUBMISSION_BONUS_PATH } from "@/lib/submission-bonus-core";

export type NavItemDef = { href: string; label: string };

/** Nhánh con trong một nhóm — tầng thứ ba của menu (BTC 06/10/2026: Tuyển Mentor / Tuyển Mentee). */
export type NavSubGroupDef = { key: string; label: string; items: NavItemDef[] };

export type NavEntryDef = NavItemDef | NavSubGroupDef;

export type NavGroupDef = {
  key: string;
  label: string;
  href?: string;
  items?: NavEntryDef[];
};

/** Nhãn của nhóm tuyển sinh và hai nhánh — tài liệu hướng dẫn trích đúng các chữ này. */
export const RECRUITMENT_NAV_LABEL = "Tuyển Mentor/Mentee";
export const MENTOR_RECRUITMENT_LABEL = "Tuyển Mentor";
export const MENTEE_RECRUITMENT_LABEL = "Tuyển Mentee";

export function isNavSubGroup(entry: NavEntryDef): entry is NavSubGroupDef {
  return "items" in entry;
}

/** Mọi mục link của một nhóm, kể cả mục nằm trong nhánh con. */
export function navItemsOf(group: Pick<NavGroupDef, "items">): NavItemDef[] {
  return (group.items ?? []).flatMap((entry) => (isNavSubGroup(entry) ? entry.items : [entry]));
}

/** Phần đường dẫn của một href, bỏ ?query — hướng dẫn và biểu tượng theo trang, không theo bộ lọc. */
export function navPath(href: string): string {
  const at = href.indexOf("?");
  return at < 0 ? href : href.slice(0, at);
}

export function isActiveRoute(pathname: string, href: string): boolean {
  if (pathname === href) return true;
  if (href === "/") return false;
  // Segment-aware: require a path separator, query, or fragment after the prefix
  const next = pathname[href.length];
  return pathname.startsWith(href) && (next === "/" || next === "?" || next === "#");
}

/**
 * Mục menu ứng với trang đang mở — MỘT mục, mục cụ thể nhất.
 *
 * Trước đây mỗi mục tự so tiền tố, nên ở /applications/mentor-review cả “Duyệt
 * Mentor S12” lẫn “Ứng tuyển (Tất cả)” cùng sáng, và ở /admin/renewals cả “Quản
 * trị” lẫn “Gia hạn mentor”. Giờ mục có đường dẫn dài nhất thắng.
 *
 * Mục mang ?query (Đánh giá mentor = /reviews?role_applied=mentor) chỉ sáng khi
 * URL hiện tại có đúng các tham số đó — cùng một trang /reviews là hai mục khác
 * nhau ở hai nhánh. Trang không mang tham số nào thì không mục nào trong hai mục
 * đó sáng, thay vì sáng cả hai.
 */
export function activeNavHref(groups: readonly NavGroupDef[], pathname: string, search: string): string | null {
  const current = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  let best: string | null = null;
  let bestScore = -1;
  const consider = (href: string) => {
    const path = navPath(href);
    if (!isActiveRoute(pathname, path)) return;
    const wanted = new URLSearchParams(href.slice(path.length + 1));
    let params = 0;
    let matches = true;
    wanted.forEach((value, key) => {
      params += 1;
      if (current.get(key) !== value) matches = false;
    });
    if (!matches) return;
    const score = path.length * 10 + params;
    if (score > bestScore) {
      best = href;
      bestScore = score;
    }
  };
  for (const group of groups) {
    if (group.href) consider(group.href);
    for (const item of navItemsOf(group)) consider(item.href);
  }
  return best;
}

/**
 * “Module” chứa trang đang mở, cho hộp Hướng dẫn: nhánh con nếu trang nằm trong
 * nhánh con, không thì cả nhóm. Nhóm chỉ có một link thì là chính link đó.
 */
export function navModuleFor(groups: readonly NavGroupDef[], activeHref: string | null): { label: string; items: NavItemDef[] } | null {
  if (!activeHref) return null;
  for (const group of groups) {
    if (group.href === activeHref) return { label: group.label, items: [{ href: group.href, label: group.label }] };
    for (const entry of group.items ?? []) {
      if (isNavSubGroup(entry) && entry.items.some((i) => i.href === activeHref)) return { label: entry.label, items: entry.items };
    }
    const direct = (group.items ?? []).filter((e): e is NavItemDef => !isNavSubGroup(e));
    if (direct.some((i) => i.href === activeHref)) return { label: group.label, items: direct };
  }
  return null;
}

function roleIn(role: string | undefined, allowed: string[]) {
  return allowed.includes(role ?? "");
}

/**
 * Nhóm “Tuyển Mentor/Mentee” (BTC 06/10/2026). Trước đây là nhóm “Ứng tuyển” mở
 * thêm từng mục một, cộng “Ghép cặp” đứng riêng ở menu chính. Giờ theo đúng quy
 * trình mỗi mùa:
 *
 *   Danh sách nhân sự tuyển sinh   — dùng chung, đứng đầu, không gom nhánh
 *   ▸ Tuyển Mentor                 — mọi trang chỉ về mentor
 *   ▸ Tuyển Mentee                 — mọi trang chỉ về mentee
 *   Ghép cặp                       — bước cuối của cả quá trình
 *
 * Trang dùng chung cho cả hai vai trò (hồ sơ, đánh giá, giao hồ sơ, phỏng vấn) được
 * tách thành hai mục, mỗi mục mở sẵn bộ lọc ?role_applied= của chính trang đó.
 *
 * Ai thấy mục nào KHÔNG đổi: mỗi mục giữ đúng predicate trước đây của nó, trùng với
 * cổng trang tự kiểm. Thêm có chủ ý: Ban điều hành giờ thấy cả “Danh sách nhân sự
 * tuyển sinh” và “Giao hồ sơ” trên menu (trước chỉ vào được từ trang Đánh giá).
 * “Gia hạn mentor S12” chuyển từ “Quản trị” sang nhánh Mentor, cùng người xem.
 */
function buildRecruitmentGroup(
  role: string | undefined,
  gates: { showReviews: boolean; showAdminTier: boolean; showApplicationOps: boolean; showOperations: boolean }
): NavGroupDef | null {
  const { showReviews, showAdminTier, showApplicationOps, showOperations } = gates;
  const isSupport = role === "support_team";
  // Trang tiến độ / ca / báo cáo phỏng vấn: BTC xem kết quả của mọi người.
  const sessionStatus = canViewMenteeSessionStatus(role);
  // Hai danh sách duyệt S12 vẫn chỉ cho nhóm thấy “Đánh giá” như trước — support_team
  // không được mời vào bước quyết định cuối qua menu.
  const decisionLists = showApplicationOps && showReviews;
  const assignLots = canAssignReviewLots(role);
  const when = (ok: boolean, item: NavItemDef): NavItemDef[] => (ok ? [item] : []);

  const mentor: NavItemDef[] = [
    ...when(showApplicationOps, { href: "/applications?role_applied=mentor", label: "Hồ sơ mentor" }),
    ...when(showAdminTier, { href: "/admin/renewals", label: "Gia hạn mentor S12" }),
    ...when(assignLots, { href: "/reviews/assign-bulk?role_applied=mentor", label: "Giao hồ sơ mentor" }),
    ...when(showReviews, { href: "/reviews?role_applied=mentor", label: "Đánh giá mentor" }),
    // Lịch 1:1 cùng khán giả với trang Phỏng vấn: trang tự gate bằng canSelfClaimInterview.
    ...when(showReviews, { href: "/interviews/lich", label: "Lịch phỏng vấn" }),
    // Thư tới hàng chục mentor một lúc: cùng cổng với gửi thư hàng loạt.
    ...when(canSendBulkEmail(role), { href: "/interviews/thu-xac-nhan-mentor", label: "Thư xác nhận lịch PV cho mentor" }),
    ...when(showReviews, { href: "/interviews?role_applied=mentor", label: "Phỏng vấn mentor" }),
    ...when(sessionStatus, { href: "/interviews/tien-do-mentor", label: "Tiến độ phỏng vấn mentor" }),
    ...when(showReviews || isSupport, { href: "/interviews/ket-qua-mentor", label: "Kết quả phỏng vấn Mentor S12" }),
    ...when(decisionLists, { href: "/applications/mentor-review", label: "Duyệt Mentor S12" })
  ];

  // Phỏng vấn mentee làm tại màn hình trực tiếp theo ca, không qua trang Phỏng vấn
  // chung — nên nhánh Mentee không có mục “Phỏng vấn mentee” thứ hai.
  const mentee: NavItemDef[] = [
    ...when(showApplicationOps, { href: "/applications?role_applied=mentee", label: "Hồ sơ mentee" }),
    // Điểm cộng theo ngày nộp chỉ áp cho đơn mentee (BTC 06/10/2026).
    ...when(canManageSubmissionBonus(role), { href: SUBMISSION_BONUS_PATH, label: "Điểm cộng theo ngày nộp" }),
    ...when(assignLots, { href: "/reviews/assign-bulk?role_applied=mentee", label: "Giao hồ sơ mentee" }),
    ...when(showReviews, { href: "/reviews?role_applied=mentee", label: "Đánh giá mentee" }),
    // Phiếu chấm + Handbook theo mùa: trang tự gate bằng canEditInterviewRubric.
    ...when(canEditInterviewRubric(role), { href: "/interviews/phieu-cham-mentee", label: "Phiếu chấm & hướng dẫn mentee" }),
    ...when(sessionStatus, { href: "/interviews/ca-mentee", label: "Ca phỏng vấn mentee" }),
    ...when(showReviews || isSupport, { href: "/interviews/mentee-offline", label: "Phỏng vấn mentee trực tiếp" }),
    ...when(sessionStatus, { href: "/interviews/tien-do-mentee", label: "Tiến độ phỏng vấn mentee" }),
    // Có điểm theo từng người phỏng vấn: mentor phỏng vấn (reviewer) không xem.
    ...when(sessionStatus, { href: "/interviews/bao-cao-mentee", label: "Báo cáo phỏng vấn mentee" }),
    ...when(decisionLists, { href: "/applications/mentee-review", label: "Duyệt Mentee S12" })
  ];

  const entries: NavEntryDef[] = [
    ...when(canManageReviewers(role), { href: "/reviews/reviewer-pool", label: "Danh sách nhân sự tuyển sinh" }),
    ...(mentor.length ? [{ key: "mentor", label: MENTOR_RECRUITMENT_LABEL, items: mentor }] : []),
    ...(mentee.length ? [{ key: "mentee", label: MENTEE_RECRUITMENT_LABEL, items: mentee }] : []),
    // Ghép cặp là bước cuối của tuyển sinh, không còn là mục riêng ở menu chính.
    // Cùng predicate canBrowseOperations như trang /matches.
    ...when(showOperations, { href: "/matches", label: "Ghép cặp" })
  ];
  return entries.length ? { key: "applications", label: RECRUITMENT_NAV_LABEL, items: entries } : null;
}

export function buildNavGroups(adminUser: CurrentAdminUser | null): NavGroupDef[] {
  const role = adminUser?.role;
  const showReviews = roleIn(role, ["super_admin", "admin", "core_team", "reviewer"]);
  const showAdminTier = roleIn(role, ["super_admin", "admin", "core_team"]);
  const showUserMgmt = role === "super_admin" && adminUser?.status === "active";
  // H2 fix: the operations/matches nav entries used to fall back to a plain
  // link (operations) or render unconditionally (matches) for every role
  // that wasn't admin-tier, which included reviewer. Both must follow the
  // same canBrowseOperations allowlist as the page-level H2 gate, or nav
  // visibility and route access disagree.
  const showOperations = canBrowseOperations(role);

  // Nav must offer only what the route will actually serve.
  //
  // These four mirror the page-level guards exactly — lib/read-access.ts for the
  // community, participant and application directories, canBrowseOperations for
  // the events index and the data-quality screen. All of those routes already
  // refuse a standalone recruitment reviewer; the nav simply had not caught up,
  // so a helper invited to score mentee applications was shown six links that
  // bounced them straight back.
  //
  // This changes what is OFFERED, never what is permitted: every predicate here
  // is the same one its page enforces, so nav and route can no longer disagree.
  //
  // The read-access predicates take a definite AdminRole, while nav is built for
  // a possibly-null user. An absent role is not a role that may browse anything,
  // so it resolves to false here rather than widening those signatures.
  const readAccess = (check: (value: AdminRole) => boolean) => (role ? check(role) : false);

  const showCommunity = readAccess(canBrowsePeople) || readAccess(canBrowseParticipants);
  const showApplicationOps = readAccess(canBrowseApplications);
  const showEvents = canBrowseOperations(role);
  const showDataIssues = canBrowseOperations(role);

  const recruitment = buildRecruitmentGroup(role, { showReviews, showAdminTier, showApplicationOps, showOperations });

  const groups: (NavGroupDef | null)[] = [
    // "Công việc của tôi" sits at the very top, above Tổng quan, for everyone
    // who can hold a recruitment assignment. The requirement is that assigned
    // work is obvious immediately after login, and a link buried inside
    // "Ứng tuyển" is exactly the manual hunt this screen replaces.
    showReviews ? { key: "my-work", label: "Công việc của tôi", href: "/my-work" } : null,
    role === "super_admin"
      ? {
          key: "dashboard",
          label: "Tổng quan",
          items: [
            { href: "/portfolio", label: "Danh mục chương trình" },
            { href: "/", label: "Tổng quan vận hành hiện tại" },
          ],
        }
      : { key: "dashboard", label: "Tổng quan", href: "/" },
    showAdminTier
      ? {
          key: "operations",
          label: "Vận hành",
          items: [
            { href: "/operations", label: "Tổng quan vận hành" },
            { href: "/operations/tasks", label: "Nhiệm vụ & phân công" },
            { href: "/operations/monthly", label: "Báo cáo tháng" },
            { href: "/operations/intelligence", label: "Phân tích mùa" },
            // canComposeEmailTemplate phủ đủ ba vai trò của showAdminTier, nên
            // nav và route không thể lệch nhau. Sổ thư đã gửi giờ là một tab
            // bên trong module này, không còn là một mục nav riêng.
            { href: "/operations/mail", label: "Mail" },
            { href: "/recaps/create", label: "Tạo báo cáo" },
            // Công cụ AI (14/09/2026) nằm trong nhóm này chứ không thành nhóm riêng:
            // ba vai trò admin tier đã chạm trần 9 nhóm của sidebar. Gate theo đúng
            // predicate trang /ai tự kiểm.
            ...(canUseAiTools(role) ? [{ href: "/ai", label: "Công cụ AI" }] : []),
          ],
        }
      : showOperations
        ? // support_team không thuộc showAdminTier nhưng vẫn soạn được mẫu thư —
          // đó là nhóm thật sự viết thư cho người tham gia. Nav phải mở đúng
          // một cửa cho họ, nếu không route mở mà không đường nào tới.
          canComposeEmailTemplate(role)
          ? {
              key: "operations",
              label: "Vận hành",
              items: [
                { href: "/operations", label: "Tổng quan vận hành" },
                { href: "/operations/mail", label: "Mail" },
                ...(canUseAiTools(role) ? [{ href: "/ai", label: "Công cụ AI" }] : []),
              ],
            }
          : { key: "operations", label: "Vận hành", href: "/operations" }
        : null,
    showCommunity
      ? {
          key: "community",
          label: "Cộng đồng VAM",
          items: [
            { href: "/people", label: "Cộng đồng VAM" },
            { href: "/mentors", label: "Mentor" },
            { href: "/mentees", label: "Mentee" },
            // Mời mentor/mentee lập tài khoản. Theo đúng predicate trang
            // /participant-accounts tự kiểm, không theo cổng của cả nhóm: hôm nay
            // hai cổng trùng nhau, nhưng ngày nhóm này mở cho một vai trò đọc
            // thôi, mục này không được mở theo.
            ...(canInviteParticipants(role)
              ? [{ href: "/participant-accounts", label: "Tài khoản đăng nhập" }]
              : []),
          ],
        }
      : null,
    // Tuyển Mentor/Mentee (BTC 06/10/2026) — thay nhóm “Ứng tuyển” và mục “Ghép cặp”
    // riêng lẻ. Xem buildRecruitmentGroup.
    recruitment,
    showEvents ? { key: "events", label: "Sự kiện", href: "/events" } : null,
    showDataIssues ? { key: "data", label: "Rà soát dữ liệu", href: "/data-issues" } : null,
  ];

  if (showAdminTier) {
    groups.push({
      key: "admin",
      label: "Quản trị",
      items: [
        { href: "/admin", label: "Quản trị" },
        // M069. Visible to the admin tier (core_team included) because the
        // screen is useful read-only; the toggle itself is gated separately
        // by canToggleApplicationForm + season scope.
        { href: "/admin/seasons-forms", label: "Mùa & Form đăng ký" },
        { href: "/team", label: "Phân công & Trách nhiệm" },
        ...(showUserMgmt ? [{ href: "/admin/users", label: "Quản lý người dùng" }] : []),
      ],
    });
  }

  return groups.filter((g): g is NavGroupDef => g !== null);
}

/** Mọi link trên menu, nguyên văn (kể cả ?role_applied=). */
export function allNavLinks(groups: NavGroupDef[]): string[] {
  return groups.flatMap((g) => (g.href ? [g.href] : navItemsOf(g).map((i) => i.href)));
}

/**
 * Các TRANG menu dẫn tới — đường dẫn không kèm bộ lọc, mỗi trang một lần. Đây là
 * thứ các phép kiểm quyền cần: “Đánh giá mentor” và “Đánh giá mentee” cùng dẫn tới
 * trang /reviews, và trang đó tự gác cổng bất kể bộ lọc.
 */
export function allNavHrefs(groups: NavGroupDef[]): string[] {
  return Array.from(new Set(allNavLinks(groups).map(navPath)));
}
