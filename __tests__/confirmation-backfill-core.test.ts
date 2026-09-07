/**
 * Phần thuần của việc gửi bù thư xác nhận.
 *
 * Chọn sai người ở đây là gửi thư thật cho người thật, nên các ca dưới đây khoá
 * đúng những chỗ dễ sai: bỏ sót người đã có thư, gửi cho đơn thiếu email, và
 * quan trọng nhất là tôn trọng trần mỗi lượt.
 *
 * Phân loại: DIRECT PRODUCTION TESTS.
 */
import { describe, expect, it } from "vitest";
import {
  CONFIRMATION_BACKFILL_ELIGIBLE_STATUSES,
  CONFIRMATION_BACKFILL_MAX_PER_RUN,
  backfillResultMessage,
  emptyBackfillSummary,
  selectBackfillCandidates,
  summarizeBackfillOutcomes,
  type BackfillApplicationRow
} from "@/lib/confirmation-backfill-core";

function row(over: Partial<BackfillApplicationRow> & { id: string }): BackfillApplicationRow {
  return {
    role_applied: "mentee",
    full_name: "Người Nộp Đơn",
    email_primary: "a@example.test",
    submitted_at: "2026-08-20",
    status: "submitted",
    ...over
  };
}

describe("selectBackfillCandidates", () => {
  it("gán đúng loại thư theo vai trò", () => {
    const { candidates } = selectBackfillCandidates({
      applications: [row({ id: "1", role_applied: "mentor" }), row({ id: "2", role_applied: "mentee" })],
      alreadyLiveIds: new Set(),
      max: 10
    });

    expect(candidates.map((c) => c.kind)).toEqual([
      "mentor_application_confirmation",
      "mentee_application_confirmation"
    ]);
  });

  it("bỏ qua đơn đã có thư còn sống", () => {
    const { candidates } = selectBackfillCandidates({
      applications: [row({ id: "1" }), row({ id: "2" }), row({ id: "3" })],
      alreadyLiveIds: new Set(["2"]),
      max: 10
    });

    expect(candidates.map((c) => c.applicationId)).toEqual(["1", "3"]);
  });

  it("bỏ qua đơn không có email và đếm lại", () => {
    const { candidates, skippedNoEmail } = selectBackfillCandidates({
      applications: [row({ id: "1", email_primary: "   " }), row({ id: "2", email_primary: null })],
      alreadyLiveIds: new Set(),
      max: 10
    });

    expect(candidates).toHaveLength(0);
    expect(skippedNoEmail).toBe(2);
  });

  it("bỏ qua vai trò lạ thay vì đoán", () => {
    const { candidates, skippedUnknownRole } = selectBackfillCandidates({
      applications: [row({ id: "1", role_applied: "observer" }), row({ id: "2", role_applied: null })],
      alreadyLiveIds: new Set(),
      max: 10
    });

    expect(candidates).toHaveLength(0);
    expect(skippedUnknownRole).toBe(2);
  });

  it("giữ nguyên thứ tự vào — người chờ lâu nhất được gửi trước", () => {
    const { candidates } = selectBackfillCandidates({
      applications: [
        row({ id: "cu", submitted_at: "2026-08-16" }),
        row({ id: "giua", submitted_at: "2026-08-20" }),
        row({ id: "moi", submitted_at: "2026-09-01" })
      ],
      alreadyLiveIds: new Set(),
      max: 10
    });

    expect(candidates.map((c) => c.applicationId)).toEqual(["cu", "giua", "moi"]);
  });

  it("dừng đúng ở trần, không gửi thừa dù còn ứng viên", () => {
    const { candidates } = selectBackfillCandidates({
      applications: Array.from({ length: 40 }, (_, i) => row({ id: `a${i}` })),
      alreadyLiveIds: new Set(),
      max: 3
    });

    expect(candidates).toHaveLength(3);
  });

  it("trần 0 nghĩa là không ai cả", () => {
    const { candidates } = selectBackfillCandidates({
      applications: [row({ id: "1" })],
      alreadyLiveIds: new Set(),
      max: 0
    });

    expect(candidates).toHaveLength(0);
  });
});

describe("danh sách trạng thái đủ điều kiện", () => {
  it("dừng trước vòng phỏng vấn, vì thư viết bước tiếp theo mới là phỏng vấn", () => {
    const eligible = new Set<string>(CONFIRMATION_BACKFILL_ELIGIBLE_STATUSES);

    for (const status of [
      "invited_to_interview",
      "interview_scheduled",
      "interview_in_progress",
      "interview_completed",
      "interview_passed",
      "approved_as_mentor",
      "approved_as_mentee",
      "waitlisted",
      "rejected_or_not_fit",
      "withdrawn"
    ]) {
      expect(eligible.has(status)).toBe(false);
    }

    expect(eligible.has("submitted")).toBe(true);
    expect(eligible.has("screening_in_progress")).toBe(true);
    expect(eligible.has("ready_for_final_decision")).toBe(true);
  });
});

describe("summarizeBackfillOutcomes", () => {
  it("đếm đủ năm loại kết quả", () => {
    const summary = summarizeBackfillOutcomes([
      "sent",
      "sent",
      "failed",
      "skipped",
      "claimed_elsewhere",
      "claim_failed"
    ]);

    expect(summary).toEqual({
      sent: 2,
      failed: 1,
      skipped: 1,
      claimed_elsewhere: 1,
      claim_failed: 1
    });
  });

  it("không có kết quả nào thì mọi ô đều là 0", () => {
    expect(summarizeBackfillOutcomes([])).toEqual(emptyBackfillSummary());
  });
});

describe("backfillResultMessage", () => {
  it("nói thẳng khi cổng gửi đang tắt, thay vì báo thành công", () => {
    const summary = { ...emptyBackfillSummary(), skipped: 4 };
    const message = backfillResultMessage(summary, {
      requested: 4,
      remainingAfter: 4,
      gateOpen: false,
      stoppedByBudget: false
    });

    expect(message).toContain("đang tắt");
    expect(message).not.toContain("Đã gửi 4");
  });

  it("không còn ai thì nói vậy, không nói đã gửi 0 thư", () => {
    const message = backfillResultMessage(emptyBackfillSummary(), {
      requested: 0,
      remainingAfter: 0,
      gateOpen: true,
      stoppedByBudget: false
    });

    expect(message).toContain("Không còn đơn nào");
  });

  it("báo số còn lại để người vận hành biết phải bấm tiếp", () => {
    const summary = { ...emptyBackfillSummary(), sent: 25 };
    const message = backfillResultMessage(summary, {
      requested: 25,
      remainingAfter: 12,
      gateOpen: true,
      stoppedByBudget: false
    });

    expect(message).toContain("Đã gửi 25/25");
    expect(message).toContain("12");
  });

  it("nói rõ khi dừng sớm vì hết thời gian", () => {
    const summary = { ...emptyBackfillSummary(), sent: 6 };
    const message = backfillResultMessage(summary, {
      requested: 20,
      remainingAfter: 14,
      gateOpen: true,
      stoppedByBudget: true
    });

    expect(message).toContain("hết thời gian");
  });
});

describe("trần mỗi lượt", () => {
  it("đủ nhỏ để nằm gọn trong ngân sách thời gian của một lượt", () => {
    // Mỗi lời gọi nhà cung cấp có thể treo tới 20 giây trước khi bị cắt, và
    // trang đặt maxDuration 60 giây. Trần này là trần thời gian, không phải
    // trần lịch sự.
    expect(CONFIRMATION_BACKFILL_MAX_PER_RUN).toBeLessThanOrEqual(25);
    expect(CONFIRMATION_BACKFILL_MAX_PER_RUN).toBeGreaterThan(0);
  });
});
