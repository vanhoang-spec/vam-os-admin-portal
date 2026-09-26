/**
 * __tests__/mentee-invite-dispatch-core.test.ts
 *
 * Phần thuần của bộ gửi thư mời mentee chọn ca, và bộ lọc đề xuất trên màn mời
 * hàng loạt — hai thứ quyết định AI nhận thư mời và BAO NHIÊU thư đi một lúc.
 */
import { describe, expect, it } from "vitest";

import {
  DAILY_EMAIL_LIMIT,
  DISPATCH_MAX_PER_RUN,
  DISPATCH_RESERVE,
  dispatchAllowance,
  isInviteRecipient
} from "@/lib/mentee-invite-dispatch-core";
import {
  MIXED_RECOMMENDATION,
  PROFILE_RECOMMENDATION_FILTERS,
  isProfileRecommendationFilter,
  profileRecommendationLabel,
  profileRecommendationOf
} from "@/lib/bulk-invite-interview";

describe("1. hạn mức mỗi lần bấm — chừa chỗ cho thư xác nhận", () => {
  it("chưa gửi gì thì gửi tối đa một lượt", () => {
    expect(dispatchAllowance(0)).toBe(DISPATCH_MAX_PER_RUN);
  });

  it("không bao giờ ăn vào phần chừa cho thư xác nhận", () => {
    const ceiling = DAILY_EMAIL_LIMIT - DISPATCH_RESERVE;
    // Còn đúng 20 chỗ trước phần chừa → chỉ gửi 20, dù một lượt cho tới 40.
    expect(dispatchAllowance(ceiling - 20)).toBe(20);
    expect(dispatchAllowance(ceiling)).toBe(0);
    expect(dispatchAllowance(ceiling + 1)).toBe(0);
  });

  it("đã chạm trần 300 thì không gửi — kể cả khi con số đếm vượt trần", () => {
    expect(dispatchAllowance(DAILY_EMAIL_LIMIT)).toBe(0);
    expect(dispatchAllowance(DAILY_EMAIL_LIMIT + 50)).toBe(0);
  });

  it("không bao giờ trả số âm", () => {
    for (const sent of [0, 100, 219, 220, 221, 299, 300, 10_000]) {
      expect(dispatchAllowance(sent)).toBeGreaterThanOrEqual(0);
      expect(dispatchAllowance(sent)).toBeLessThanOrEqual(DISPATCH_MAX_PER_RUN);
    }
  });

  it("giá trị lạ tính như chưa gửi gì, không làm nổ phép tính", () => {
    expect(dispatchAllowance(Number.NaN)).toBe(DISPATCH_MAX_PER_RUN);
    expect(dispatchAllowance(-5)).toBe(DISPATCH_MAX_PER_RUN);
  });

  it("phần chừa thật sự tồn tại — không phải số 0", () => {
    expect(DISPATCH_RESERVE).toBeGreaterThan(0);
    expect(DISPATCH_RESERVE).toBeLessThan(DAILY_EMAIL_LIMIT);
  });
});

describe("2. ai nhận thư mời chọn ca", () => {
  const ok = {
    roleApplied: "mentee",
    source: "vam_os_form",
    status: "invited_to_interview",
    hasActiveBooking: false,
    sendCount: null as number | null
  };

  it("mentee đã được mời phỏng vấn, chưa có ca, chưa nhận thư → nhận", () => {
    expect(isInviteRecipient(ok)).toBe(true);
    expect(isInviteRecipient({ ...ok, sendCount: 0 })).toBe(true);
  });

  it("hồ sơ còn nằm ở trạng thái screening_passed của luồng cũ cũng nhận", () => {
    expect(isInviteRecipient({ ...ok, status: "screening_passed" })).toBe(true);
  });

  /**
   * Đây là ca quan trọng nhất của mục này. `screening_completed` là trạng thái
   * của CẢ 548 đơn đã chấm — gồm cả những bạn bị đề xuất không phù hợp. Người
   * nhận thư phải là người BTC đã bấm "Mời phỏng vấn", không phải người đã chấm.
   */
  it("mới chấm xong, chưa được BTC mời → KHÔNG nhận", () => {
    expect(isInviteRecipient({ ...ok, status: "screening_completed" })).toBe(false);
  });

  it("đã có ca (interview_scheduled) → KHÔNG nhận thư 'mời bạn chọn ca'", () => {
    expect(isInviteRecipient({ ...ok, status: "interview_scheduled" })).toBe(false);
  });

  it("đang giữ một chỗ → KHÔNG nhận, dù trạng thái đơn chưa kịp đổi", () => {
    expect(isInviteRecipient({ ...ok, hasActiveBooking: true })).toBe(false);
  });

  it("đã nhận thư mời một lần → bấm lại nút KHÔNG gửi thêm", () => {
    expect(isInviteRecipient({ ...ok, sendCount: 1 })).toBe(false);
  });

  it("mentor, hay đơn không nộp qua form, → KHÔNG nhận", () => {
    expect(isInviteRecipient({ ...ok, roleApplied: "mentor" })).toBe(false);
    expect(isInviteRecipient({ ...ok, source: "legacy_import" })).toBe(false);
  });

  it("đơn bị từ chối hay đã rút → KHÔNG nhận", () => {
    expect(isInviteRecipient({ ...ok, status: "rejected_or_not_fit" })).toBe(false);
    expect(isInviteRecipient({ ...ok, status: "withdrawn" })).toBe(false);
  });
});

describe("3. đề xuất chung của một hồ sơ, cho bộ lọc mời hàng loạt", () => {
  it("một phiếu → đúng đề xuất của phiếu đó", () => {
    expect(profileRecommendationOf(["pass_to_interview"])).toBe("pass_to_interview");
  });

  it("nhiều phiếu cùng đề xuất → đề xuất đó", () => {
    expect(profileRecommendationOf(["pass_to_interview", "pass_to_interview"])).toBe("pass_to_interview");
  });

  /**
   * Một người bảo mời, một người bảo loại: hồ sơ đó không được lọt vào danh
   * sách "mời vào vòng phỏng vấn" để bị mời bằng một cú bấm hàng loạt.
   */
  it("đề xuất khác nhau → 'mixed', KHÔNG phải phiếu mới nhất hay đa số", () => {
    expect(profileRecommendationOf(["pass_to_interview", "reject"])).toBe(MIXED_RECOMMENDATION);
    expect(profileRecommendationOf(["pass_to_interview", "pass_to_interview", "reject"])).toBe(
      MIXED_RECOMMENDATION
    );
  });

  it("'mixed' không bao giờ trùng một giá trị lọc — không bị chọn nhầm", () => {
    expect(isProfileRecommendationFilter(MIXED_RECOMMENDATION)).toBe(false);
  });

  it("chưa có phiếu → null; ô trống không tính là một đề xuất", () => {
    expect(profileRecommendationOf([])).toBeNull();
    expect(profileRecommendationOf([null, "", "  "])).toBeNull();
  });

  it("bộ lọc chỉ nhận đúng bốn đề xuất của phiếu chấm hồ sơ", () => {
    expect(PROFILE_RECOMMENDATION_FILTERS.map((row) => row.value).sort()).toEqual(
      ["needs_admin_review", "pass_to_interview", "reject", "waitlist"]
    );
    expect(isProfileRecommendationFilter("approve_recommended")).toBe(false);
    expect(isProfileRecommendationFilter("")).toBe(false);
    expect(isProfileRecommendationFilter("pass_to_interview; drop")).toBe(false);
  });

  it("nhãn tiếng Việt cho mọi trường hợp", () => {
    expect(profileRecommendationLabel("pass_to_interview")).toBe("Mời vào vòng phỏng vấn");
    expect(profileRecommendationLabel(MIXED_RECOMMENDATION)).toBe("Người chấm đề xuất khác nhau");
    expect(profileRecommendationLabel(null)).toBe("Chưa có đề xuất");
  });
});
