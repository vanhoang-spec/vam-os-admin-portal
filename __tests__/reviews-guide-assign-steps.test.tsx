/** @vitest-environment jsdom */
/**
 * Mục "Chia hồ sơ" của /reviews/guide phải tả đúng màn hình /reviews/assign-bulk.
 *
 * Hướng dẫn từng tả luồng chia TỰ ĐỘNG — tick nhiều reviewer, thuật toán cân
 * khối lượng, tuỳ chọn "Bỏ qua hồ sơ đã có reviewer", mục D đặt hạn, mục E soát
 * bảng phân bổ — rất lâu sau khi màn hình đã chuyển sang giao tay cho đúng một
 * người. Người vận hành đọc hướng dẫn rồi đi tìm những ô không tồn tại.
 *
 * Không cổng nào bắt được chuyện đó: chữ trong hướng dẫn chỉ là chữ, qua hết
 * typecheck, lint và build. Nên hai phía được ràng với nhau ở đây — và ràng trên
 * chính thứ hai trang VẼ RA, không trên mã nguồn: một nhãn đã gỡ khỏi nút nhưng
 * còn sót trong một dòng chú thích không được tính là "có trên màn hình".
 */
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CurrentAdminUser } from "../lib/auth-constants";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const mocks = vi.hoisted(() => ({
  getCurrentAdminUser: vi.fn(),
  redirect: vi.fn(),
  getIntakeBatches: vi.fn(),
  getSeasons: vi.fn(),
  getReviewAssignableApplications: vi.fn(),
  getReviewEligibleReviewers: vi.fn(),
  getAdminScopeContext: vi.fn(),
  getScopeFilter: vi.fn()
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/admin-auth", () => ({ getCurrentAdminUser: mocks.getCurrentAdminUser }));
vi.mock("@/lib/data", () => ({
  getIntakeBatches: mocks.getIntakeBatches,
  getSeasons: mocks.getSeasons,
  getReviewAssignableApplications: mocks.getReviewAssignableApplications,
  getReviewEligibleReviewers: mocks.getReviewEligibleReviewers
}));
vi.mock("@/lib/program-scope", () => ({
  getAdminScopeContext: mocks.getAdminScopeContext,
  getScopeFilter: mocks.getScopeFilter
}));
// Giống __tests__/manual-bulk-assignment.test.tsx: React 18.3.1 bản thường
// không có `cache`, và form chạy useFormState của react-dom.
vi.mock("react", async () => {
  const original = await vi.importActual<typeof import("react")>("react");
  return { ...original, cache: <T,>(fn: T) => fn };
});
vi.mock("react-dom", async () => {
  const original = await vi.importActual<typeof import("react-dom")>("react-dom");
  return {
    ...original,
    useFormState: (action: unknown, initialState: unknown) => [initialState, action],
    useFormStatus: () => ({ pending: false })
  };
});

import ReviewerGuidePage from "../app/reviews/guide/page";
import AssignBulkPage from "../app/reviews/assign-bulk/page";

const BATCH = { id: "batch-1", name: "S12 — Đợt 1", code: "S12B1", season_id: "season-1" };

const REVIEWER = {
  id: "rev-1",
  email: "rev1@example.test",
  full_name: "Người Chấm Một",
  role: "reviewer",
  current_workload: 1
};

/**
 * Mười hai hồ sơ, hồ sơ đầu đã có người nhận. Mười một hồ sơ chưa giao là hơn
 * một lô, nên danh sách có trang thứ hai và các nút sang lô hiện ra.
 */
function applications(status: string) {
  return Array.from({ length: 12 }, (_, i) => ({
    id: `app-${i + 1}`,
    full_name: `Ứng viên ${i + 1}`,
    email_primary: `ungvien${i + 1}@example.test`,
    status,
    role_applied: "mentee",
    intake_batch_id: BATCH.id,
    submitted_at: `2026-09-${String(i + 1).padStart(2, "0")}T00:00:00Z`,
    existing_review_count: i === 0 ? 1 : 0,
    existing_reviewer_id: i === 0 ? REVIEWER.id : null,
    existing_review_id: i === 0 ? "review-1" : null
  }));
}

/**
 * Mọi nhãn trên màn hình mà mục Chia hồ sơ gọi tên.
 *
 * Viết thêm một bước nhắc tới nút hay ô mới thì thêm nhãn đó vào đây. Quên thêm
 * vào hướng dẫn thì ca thứ hai đỏ; nhãn không có thật trên màn hình thì ca thứ
 * nhất đỏ.
 */
const SCREEN_LABELS = [
  // Bước chọn đợt
  "Đợt tuyển",
  "Role ứng tuyển",
  "Vòng phân công",
  "Đánh giá hồ sơ",
  "Phỏng vấn",
  "Tiếp tục",
  "← Chọn batch / role khác",
  // Danh sách
  "Chưa giao",
  "Đã giao",
  "Tất cả",
  "Người phụ trách",
  "Chọn cả trang",
  "Đang chọn",
  "Bỏ chọn",
  // Giao
  "Giao cho người phụ trách",
  "Bạn sắp giao",
  "Xác nhận giao hồ sơ",
  "Xác nhận giao phỏng vấn",
  "Danh sách nhân sự tuyển sinh",
  // Trả về hàng chờ
  "Huỷ phân công",
  "Lý do huỷ",
  "Huỷ phân công đã chọn",
  "Sắp trả"
];

/**
 * Chữ của luồng chia tự động đã gỡ khỏi màn hình. Soi cả trang hướng dẫn, không
 * chỉ mục Chia hồ sơ: mục bảo mật từng bảo tắt "Bỏ qua hồ sơ đã có reviewer" khi
 * một reviewer rời giữa mùa, và mục dữ liệu test từng chỉ tới phần "Hồ sơ sẽ
 * được giao".
 */
const REMOVED_CONTROLS = [
  "Bỏ qua hồ sơ đã có reviewer",
  "Thuật toán",
  "workload",
  "bảng phân bổ",
  "due_at",
  "ghi chú phân công",
  "Hồ sơ sẽ được giao",
  "danh sách checklist",
  "Mục A",
  "Mục C",
  "Mục D",
  "Mục E"
];

/**
 * Tiêu đề trên màn hình viết hoa ("GIAO CHO NGƯỜI PHỤ TRÁCH"), hướng dẫn viết
 * thường. Với người đọc đó vẫn là một nhãn, nên so sau khi hạ chữ thường và gộp
 * khoảng trắng mà JSX ngắt dòng để lại.
 */
const normalise = (value: string) =>
  value.normalize("NFC").toLocaleLowerCase("vi").replace(/\s+/g, " ");

beforeEach(() => {
  vi.clearAllMocks();
  mocks.redirect.mockImplementation((path: string) => {
    throw new Error(`redirect:${path}`);
  });
  mocks.getCurrentAdminUser.mockResolvedValue({
    id: "core-1",
    email: "core@example.test",
    full_name: "Core Team",
    role: "core_team",
    status: "active"
  } as CurrentAdminUser);
  mocks.getIntakeBatches.mockResolvedValue({ data: [BATCH], error: null });
  mocks.getSeasons.mockResolvedValue({ data: [], error: null });
  mocks.getReviewAssignableApplications.mockResolvedValue({ data: [], error: null });
  mocks.getReviewEligibleReviewers.mockResolvedValue({ data: [], error: null });
  mocks.getAdminScopeContext.mockResolvedValue({});
  mocks.getScopeFilter.mockResolvedValue(null);
});

afterEach(() => {
  cleanup();
});

/**
 * Toàn bộ chữ người vận hành có thể thấy trên màn hình chia hồ sơ, kể cả
 * placeholder của ô nhập.
 *
 * Vẽ ba cảnh vì không cảnh nào tự có đủ mọi nhãn: bước chọn đợt; vòng hồ sơ có
 * người phụ trách và đã chọn một lô (số "Đang chọn" chỉ hiện sau khi tick); vòng
 * phỏng vấn chưa ai được cấp quyền (nút xác nhận đổi chữ, và trang chỉ đường tới
 * Danh sách nhân sự tuyển sinh).
 */
async function assignScreenText(): Promise<string> {
  const parts: string[] = [];
  const collect = (container: HTMLElement) => {
    parts.push(container.textContent ?? "");
    container.querySelectorAll("[placeholder]").forEach((el) => {
      parts.push(el.getAttribute("placeholder") ?? "");
    });
    cleanup();
  };

  collect(render(await AssignBulkPage({ searchParams: Promise.resolve({}) })).container);

  mocks.getReviewAssignableApplications.mockResolvedValue({ data: applications("submitted"), error: null });
  mocks.getReviewEligibleReviewers.mockResolvedValue({ data: [REVIEWER], error: null });
  const profileRound = render(
    await AssignBulkPage({
      searchParams: Promise.resolve({
        intake_batch_id: BATCH.id,
        role_applied: "mentee",
        review_round: "profile_screening"
      })
    })
  );
  fireEvent.click(screen.getByRole("button", { name: /Chọn cả trang/ }));
  collect(profileRound.container);

  mocks.getReviewAssignableApplications.mockResolvedValue({
    data: applications("invited_to_interview"),
    error: null
  });
  mocks.getReviewEligibleReviewers.mockResolvedValue({ data: [], error: null });
  collect(
    render(
      await AssignBulkPage({
        searchParams: Promise.resolve({
          intake_batch_id: BATCH.id,
          role_applied: "mentee",
          review_round: "interview"
        })
      })
    ).container
  );

  return parts.join("\n");
}

/** Đúng thẻ của mục Chia hồ sơ — một nhãn trùng ở mục khác không được tính. */
async function guideAssignSection(): Promise<HTMLElement> {
  render(await ReviewerGuidePage());
  const section = screen
    .getByRole("heading", { name: "Danh sách công việc — Chia hồ sơ" })
    .closest("section");
  if (!section) throw new Error("Không tìm thấy mục Chia hồ sơ trong hướng dẫn.");
  return section;
}

describe("mục Chia hồ sơ trong hướng dẫn tả đúng màn hình /reviews/assign-bulk", () => {
  it("SCREEN_LABELS_EXIST: mọi nhãn hướng dẫn gọi tên đều có thật trên màn hình", async () => {
    const onScreen = normalise(await assignScreenText());

    const missing = SCREEN_LABELS.filter((label) => !onScreen.includes(normalise(label)));
    expect(missing).toEqual([]);
  });

  it("GUIDE_NAMES_EACH_LABEL: mục Chia hồ sơ thật sự gọi tên từng nhãn đó", async () => {
    const section = normalise((await guideAssignSection()).textContent ?? "");

    const unnamed = SCREEN_LABELS.filter((label) => !section.includes(normalise(label)));
    expect(unnamed).toEqual([]);
  });

  it("NO_AUTOMATIC_DISTRIBUTION: cả trang hướng dẫn không còn nhắc điều khiển nào của luồng chia tự động", async () => {
    render(await ReviewerGuidePage());
    const page = document.body.textContent ?? "";

    const stale = REMOVED_CONTROLS.filter((phrase) => page.includes(phrase));
    expect(stale).toEqual([]);
  });
});
