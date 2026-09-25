/**
 * __tests__/email-automation-core.test.ts
 *
 * Nội dung sửa được của thư tự động.
 *
 * ---------------------------------------------------------------------------
 * CA QUAN TRỌNG NHẤT Ở ĐÂY: MỤC 2
 * ---------------------------------------------------------------------------
 * Bản mặc định suy ra từ chính hàm dựng thư, và nó phải TỰ QUA ĐƯỢC phép kiểm
 * lúc lưu. Đó là một hợp đồng hai chiều giữa `lib/email-core.ts` và danh mục ô
 * trong `lib/email-automation-core.ts`:
 *
 *   - Ai đó sửa hàm dựng thư và bỏ mất đường dẫn riêng → bản mặc định thiếu ô
 *     bắt buộc → đỏ.
 *   - Ai đó thêm một ô bắt buộc vào danh mục mà hàm dựng thư không có → đỏ.
 *
 * Không có ca này thì màn hình "Thư tự động" có thể mở ra với một bản mặc định
 * mà chính hệ thống từ chối lưu — và người vận hành chỉ biết khi bấm Lưu.
 */
import { describe, expect, it } from "vitest";

import {
  AUTOMATION_SLOTS,
  automationSlotsByGroup,
  findAutomationSlot,
  renderAutomationContent,
  validateAutomationContent
} from "@/lib/email-automation-core";
import { defaultAutomationContent } from "@/lib/email-automation-defaults";

/** Giá trị mẫu cho mọi ô của một lá thư, để dựng thử một bức thư thật. */
function sampleValues(slotId: string): Record<string, string> {
  const slot = findAutomationSlot(slotId)!;
  const values: Record<string, string> = {};
  for (const p of slot.placeholders) values[p.key] = `gia-tri-${p.key}`;
  return values;
}

describe("1. danh mục", () => {
  it("có đúng 17 lá thư và không id nào trùng", () => {
    expect(AUTOMATION_SLOTS).toHaveLength(17);
    const ids = AUTOMATION_SLOTS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("mỗi lá thư có ít nhất một ô bắt buộc", () => {
    for (const slot of AUTOMATION_SLOTS) {
      expect(slot.placeholders.some((p) => p.required), slot.id).toBe(true);
    }
  });

  it("không ô nào vừa bắt buộc vừa tuỳ chọn — hai cờ đó nói ngược nhau", () => {
    for (const slot of AUTOMATION_SLOTS) {
      for (const p of slot.placeholders) {
        expect(p.required && p.optional === true, `${slot.id}.${p.key}`).toBe(false);
      }
    }
  });

  it("gom nhóm không bỏ sót lá thư nào", () => {
    const grouped = automationSlotsByGroup().flatMap((row) => row.slots);
    expect(grouped).toHaveLength(AUTOMATION_SLOTS.length);
  });

  it("id lạ trả về null, không trả về lá thư đầu danh sách", () => {
    expect(findAutomationSlot("khong-co-that")).toBeNull();
    expect(findAutomationSlot("")).toBeNull();
    expect(findAutomationSlot(null)).toBeNull();
  });
});

describe("2. bản mặc định suy ra từ hàm dựng thư", () => {
  it.each(AUTOMATION_SLOTS.map((s) => s.id))("%s dựng được bản mặc định", (slotId) => {
    const content = defaultAutomationContent(slotId);
    expect(content).not.toBeNull();
    expect(content!.subject.length).toBeGreaterThan(0);
    expect(content!.body.length).toBeGreaterThan(0);
  });

  it.each(AUTOMATION_SLOTS.map((s) => s.id))(
    "%s: bản mặc định TỰ QUA ĐƯỢC phép kiểm lúc lưu",
    (slotId) => {
      const content = defaultAutomationContent(slotId)!;
      const result = validateAutomationContent({ slotId, ...content });

      // Thông điệp lỗi đi kèm, để lần đỏ đầu tiên nói luôn thiếu ô nào.
      expect(result.ok ? "" : result.message, slotId).toBe("");
      expect(result.ok).toBe(true);
    }
  );

  it.each(AUTOMATION_SLOTS.map((s) => s.id))("%s: không sót chuỗi mồi", (slotId) => {
    const content = defaultAutomationContent(slotId)!;
    const all = `${content.subject}\n${content.body}`;
    // Mồi chữ.
    expect(all).not.toContain("@@");
    // Mồi số — lọt ra ngoài là người nhận đọc thấy "987654321 hồ sơ".
    expect(all).not.toContain("987654321");
  });

  it("id lạ không dựng ra một bản thư rỗng trông như hợp lệ", () => {
    expect(defaultAutomationContent("khong-co-that")).toBeNull();
  });
});

describe("3. phép kiểm lúc lưu", () => {
  const ID = "interview_slot_invite";

  it("thiếu ô bắt buộc là LỖI, không phải cảnh báo", () => {
    const result = validateAutomationContent({
      slotId: ID,
      subject: "Mời chọn giờ",
      body: "Chào {{ten_nguoi_nhan}}, mùa {{mua}} đã mở. Hạn {{han_chot}}."
    });

    expect(result.ok).toBe(false);
    // Đây là ô mà thiếu nó thì cả lá thư vô nghĩa.
    expect(result.ok ? "" : result.message).toContain("link_dat_lich");
  });

  it("ô lạ bị từ chối — không gì điền được nó", () => {
    const result = validateAutomationContent({
      slotId: ID,
      subject: "Mời chọn giờ {{mua}}",
      body: "Chào {{ten_nguoi_nhan}} {{link_dat_lich}} {{han_chot}} {{so_dien_thoai_me}}"
    });

    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.message).toContain("so_dien_thoai_me");
  });

  it("thẻ HTML bị từ chối ở cả tiêu đề lẫn thân thư", () => {
    const body = "Chào {{ten_nguoi_nhan}} {{mua}} {{link_dat_lich}} {{han_chot}}";
    expect(validateAutomationContent({ slotId: ID, subject: "<b>Mời</b>", body }).ok).toBe(false);
    expect(
      validateAutomationContent({ slotId: ID, subject: "Mời", body: `${body} <a href=x>` }).ok
    ).toBe(false);
  });

  it("tiêu đề và thân thư rỗng bị từ chối", () => {
    expect(validateAutomationContent({ slotId: ID, subject: "", body: "x" }).ok).toBe(false);
    expect(validateAutomationContent({ slotId: ID, subject: "x", body: "   " }).ok).toBe(false);
  });

  it("xuống dòng trong tiêu đề bị gộp lại — một số máy chủ thư hiểu đó là ranh giới header", () => {
    const result = validateAutomationContent({
      slotId: ID,
      subject: "Mời chọn giờ\nBcc: nguoi-la@example.com",
      body: "{{ten_nguoi_nhan}} {{mua}} {{link_dat_lich}} {{han_chot}}"
    });

    expect(result.ok).toBe(true);
    expect(result.ok && result.subject).not.toContain("\n");
  });

  it("id lạ bị từ chối trước khi đọc nội dung", () => {
    expect(validateAutomationContent({ slotId: "khong-co-that", subject: "a", body: "b" }).ok).toBe(
      false
    );
  });
});

describe("4. dựng thư thật từ nội dung đã lưu", () => {
  it.each(AUTOMATION_SLOTS.map((s) => s.id))("%s: bản mặc định dựng ra thư không còn ô nào", (slotId) => {
    const content = defaultAutomationContent(slotId)!;
    const result = renderAutomationContent({ slotId, ...content, values: sampleValues(slotId) });

    expect(result.ok, slotId).toBe(true);
    if (!result.ok) return;
    expect(result.subject).not.toContain("{{");
    expect(result.text).not.toContain("{{");
  });

  it("dòng chứa ô tuỳ chọn không có dữ liệu thì BIẾN MẤT cả dòng", () => {
    const slotId = "interview_scheduled_candidate";
    const values = sampleValues(slotId);
    delete values.sdt_nguoi_trao_doi;

    const content = defaultAutomationContent(slotId)!;
    const result = renderAutomationContent({ slotId, ...content, values });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Không còn nhãn đứng trơ một mình.
    expect(result.text).not.toContain("Số điện thoại:");
    expect(result.text).not.toContain("{{");
  });

  it("dòng trống là dòng ngăn đoạn hợp lệ, không phải dòng thiếu dữ liệu", () => {
    const result = renderAutomationContent({
      slotId: "interview_round_invite",
      subject: "Chào {{ten_nguoi_nhan}}",
      body: "Chào {{ten_nguoi_nhan}},\n\nMùa {{mua}} đã mở.\n\nTrân trọng.",
      values: { ten_nguoi_nhan: "Anh A", mua: "UEHM-S12" }
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.text).toBe("Chào Anh A,\n\nMùa UEHM-S12 đã mở.\n\nTrân trọng.");
  });

  it("ô BẮT BUỘC không có dữ liệu thì báo hỏng, để nơi gọi gửi bản mặc định", () => {
    const result = renderAutomationContent({
      slotId: "interview_slot_invite",
      subject: "Mời {{ten_nguoi_nhan}}",
      body: "Đặt lịch tại {{link_dat_lich}}",
      values: { ten_nguoi_nhan: "Anh A" }
    });

    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.reason).toBe("missing_value");
  });

  it("ô tuỳ chọn nằm trong TIÊU ĐỀ cũng tính là thiếu — tiêu đề không bỏ dòng được", () => {
    const result = renderAutomationContent({
      slotId: "interview_scheduled_candidate",
      subject: "Hẹn {{sdt_nguoi_trao_doi}}",
      body: "Chào {{ten_nguoi_nhan}}",
      values: { ten_nguoi_nhan: "Anh A" }
    });

    expect(result.ok).toBe(false);
  });

  it("giá trị chỉ toàn khoảng trắng tính là không có", () => {
    const result = renderAutomationContent({
      slotId: "interview_round_invite",
      subject: "Chào {{ten_nguoi_nhan}}",
      body: "Mùa {{mua}}",
      values: { ten_nguoi_nhan: "   ", mua: "Mùa 12" }
    });

    expect(result.ok).toBe(false);
  });

  it("id lạ không dựng ra thư", () => {
    const result = renderAutomationContent({
      slotId: "khong-co-that",
      subject: "a",
      body: "b",
      values: {}
    });
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.reason).toBe("slot_unknown");
  });
});
