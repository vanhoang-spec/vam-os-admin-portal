/**
 * Nhãn mùa trong thư gửi ra — một định nghĩa, không hai.
 *
 * Bài này sinh ra từ một lỗi thật. Ba luồng gửi thư (nộp đơn, gửi bù, mời
 * phỏng vấn) từng mỗi nơi tự dựng chuỗi nhãn mùa. Khi đổi tên thương hiệu,
 * hai nơi được sửa còn một nơi bị sót, và 25 lá thư gửi bù ra đời với tiêu đề
 * lặp tên chương trình hai lần:
 *
 *     [UEH Mentoring] Đã nhận đơn đăng ký mentee — UEH Mentoring Mùa 12
 *     [UEH Mentoring] Đã nhận đơn đăng ký mentee — Mùa 12          <- đúng
 *
 * Không có gì báo, vì ba bản sao không ràng buộc gì với nhau. Kiểm kiểu và
 * test đều xanh — chúng chỉ thấy ba hằng số hợp lệ.
 *
 * Hai khẳng định dưới đây chặn đúng hai nửa của lỗi đó: nội dung nhãn phải
 * đúng, VÀ không nơi nào được dựng lại nhãn của riêng mình.
 *
 * Phân loại: DIRECT PRODUCTION TESTS + STRUCTURAL ASSERTION.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CURRENT_APPLICATION_SEASON_LABEL, seasonLabel } from "@/lib/season-labels";
import { SEASON_CONFIG } from "@/lib/season-config";

const ROOT = join(__dirname, "..");

/** Ba file thật sự gửi thư và phải dùng chung một nhãn. */
const SENDER_FILES = [
  "app/actions/apply.ts",
  "lib/confirmation-backfill.ts",
  "lib/interview-invite-notifications.ts"
] as const;

describe("CURRENT_APPLICATION_SEASON_LABEL", () => {
  it("là nhãn người đọc được, không phải mã nội bộ", () => {
    expect(CURRENT_APPLICATION_SEASON_LABEL).toBe(
      seasonLabel(SEASON_CONFIG.CURRENT_APPLICATION_SEASON_CODE)
    );
    expect(CURRENT_APPLICATION_SEASON_LABEL).not.toContain("UEHM-S");
    expect(CURRENT_APPLICATION_SEASON_LABEL).toMatch(/^Mùa \d+$/);
  });

  it("KHÔNG mang tên chương trình — tiêu đề thư đã có tiền tố rồi", () => {
    // "[UEH Mentoring] ... — UEH Mentoring Mùa 12" là lỗi mà bài này chặn.
    expect(CURRENT_APPLICATION_SEASON_LABEL).not.toContain("Mentoring");
    expect(CURRENT_APPLICATION_SEASON_LABEL).not.toContain("UEH");
    expect(CURRENT_APPLICATION_SEASON_LABEL).not.toContain("VAM");
  });
});

describe("không nơi nào dựng lại nhãn của riêng mình", () => {
  for (const file of SENDER_FILES) {
    it(`${file} dùng hằng số chung`, () => {
      const source = readFileSync(join(ROOT, file), "utf8");
      expect(source).toContain("CURRENT_APPLICATION_SEASON_LABEL");
      // Tự gọi seasonLabel(...) nghĩa là đang dựng bản sao thứ hai.
      expect(source).not.toMatch(/seasonLabel\s*\(/);
    });
  }

  it("chỉ có ĐÚNG MỘT định nghĩa trong toàn kho", () => {
    const definitions = SENDER_FILES.map((file) =>
      readFileSync(join(ROOT, file), "utf8")
    ).filter((source) => /CURRENT_APPLICATION_SEASON_LABEL\s*=/.test(source));

    // Ba file gửi thư chỉ được ĐỌC hằng số, không được gán lại.
    expect(definitions).toHaveLength(0);

    const home = readFileSync(join(ROOT, "lib", "season-labels.ts"), "utf8");
    expect(home).toMatch(/export const CURRENT_APPLICATION_SEASON_LABEL\s*=/);
  });
});
