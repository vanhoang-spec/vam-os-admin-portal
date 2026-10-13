import { describe, expect, it } from "vitest";

import { ACTIVE_READING_KEYS, CONFIRMATION_PHRASES, requiredCheckboxAcknowledgements } from "../lib/application-commitments";
import { RENEWAL_ONE_CLICK_MODE } from "../lib/renewal-one-click-core";
import { buildRenewalProfileDiff, buildRenewalProfileRefresh } from "../lib/renewal-profile-safety";
import { renewalPayloadFromFormData } from "../lib/renewal-runtime";

/**
 * Renewal commitments & mentee capacity.
 *
 * Từ 13/10/2026 gia hạn là "một nút": form không còn ô tick cam kết hay câu xác nhận gõ
 * tay, nên payload ghi cam kết theo DANH MỤC CHUẨN (lib/application-commitments.ts) chứ
 * không đọc từng ô. Không ca nào ở đây chép lại danh sách cam kết: giữ một bản riêng trong
 * test chính là kiểu lệch mà M073 đã gỡ khỏi runtime và khỏi form. Chi tiết của lối một nút
 * nằm ở gia-han-mot-nut.test.tsx.
 */
describe("Renewal Commitments & Mentee Capacity", () => {
  it("carries the submitted mentee capacity as a number", () => {
    const fd = new FormData();
    fd.append("mentoring_capacity_total", "1");

    const payload = renewalPayloadFromFormData(fd);
    expect(payload.mentoring_capacity_total).toBe(1);
    expect(payload.commitments_completed).toBe(true);
  });

  it("records every canonical commitment as accepted, whatever boxes the request does or does not carry", () => {
    // Trước 13/10: thiếu MỘT ô là commitments_completed = false. Form giờ không còn ô nào,
    // nên một request thiếu (hay thừa) khoá cam kết không được làm lệch điều đã ghi.
    for (const missing of requiredCheckboxAcknowledgements("mentor")) {
      const fd = new FormData();
      for (const entry of requiredCheckboxAcknowledgements("mentor")) {
        if (entry.key !== missing.key) fd.append(entry.key, "true");
      }

      const payload = renewalPayloadFromFormData(fd);
      const commitments = payload.commitments as Record<string, unknown>;
      expect(`${missing.key}:${commitments[missing.key]}`).toBe(`${missing.key}:true`);
      expect(payload.commitments_completed).toBe(true);
      expect(payload.acceptance_mode).toBe(RENEWAL_ONE_CLICK_MODE);
    }
  });

  it("no longer reads or stores the typed acknowledgement phrase", () => {
    for (const typed of [CONFIRMATION_PHRASES.mentor, "Tôi đồng ý.", ""]) {
      const fd = new FormData();
      fd.append(ACTIVE_READING_KEYS.mentor, typed);

      const commitments = renewalPayloadFromFormData(fd).commitments as Record<string, unknown>;
      expect(commitments).not.toHaveProperty(`${ACTIVE_READING_KEYS.mentor}_matched`);
      expect(commitments).not.toHaveProperty(`${ACTIVE_READING_KEYS.mentor}_text`);
      expect(JSON.stringify(commitments)).not.toContain("Tôi đồng ý.");
    }
  });

  it("Core team note optional and persists in payload but not in profile diff", () => {
    const fd = new FormData();
    fd.append("core_team_note", "I want the same mentee");

    const payload = renewalPayloadFromFormData(fd);
    expect(payload.core_team_note).toBe("I want the same mentee");

    const refresh = buildRenewalProfileRefresh(payload);
    const oldProfile = { id: "p1", person_id: "x" } as Record<string, unknown>;
    const diff = buildRenewalProfileDiff(oldProfile, refresh);

    expect(diff.find((entry) => entry.field === "core_team_note")).toBeUndefined();
    expect((refresh as Record<string, unknown>).core_team_note).toBeUndefined();
  });

  it("removal of old free-text availability_commitment does not overwrite historical data", () => {
    const fd = new FormData();

    const payload = renewalPayloadFromFormData(fd);
    expect(payload).not.toHaveProperty("availability_commitment");

    const refresh = buildRenewalProfileRefresh(payload);
    expect(refresh).not.toHaveProperty("availability_commitment");
  });
});
