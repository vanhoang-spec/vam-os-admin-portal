/**
 * Trần thư MỘT cho cả hệ thống (06/10/2026): thư đi qua Resend, mọi bộ gửi so với
 * cùng 1.000 thư/24 giờ, và mọi chữ trên màn hình nói đúng con số đó.
 *
 * Trước đó trang lời mời tài khoản dùng trần riêng 300 (gói miễn phí Brevo) trong
 * khi các bộ gửi khác dùng 1.000 — cùng một sổ thư, hai câu trả lời "còn gửi được
 * không".
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DAILY_EMAIL_LIMIT, EMAIL_PROVIDER_NAME, QUOTA_WINDOW_MS, dailyEmailLimitLabel } from "@/lib/email-quota-core";
import * as dispatchCore from "@/lib/mentee-invite-dispatch-core";
import { INVITE_DAILY_RESERVE, inviteBudgetRemaining, inviteRefusalMessage } from "@/lib/participant-invite-core";
import { HELP_GUIDES } from "@/lib/help-guides";

function files(dir: string, ext: RegExp): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path, ext);
    return ext.test(path) ? [path.replace(/\\/g, "/")] : [];
  });
}

describe("một trần cho cả hệ thống", () => {
  it("1.000 thư trong 24 giờ trượt, chữ hiện là '1.000 thư/24 giờ', gửi qua Resend", () => {
    expect(DAILY_EMAIL_LIMIT).toBe(1000);
    expect(QUOTA_WINDOW_MS).toBe(24 * 60 * 60_000);
    expect(dailyEmailLimitLabel()).toBe("1.000 thư/24 giờ");
    expect(EMAIL_PROVIDER_NAME).toBe("Resend");
  });

  it("bộ gửi thư mời mentee xuất lại ĐÚNG con số đó, không định nghĩa riêng", () => {
    expect(dispatchCore.DAILY_EMAIL_LIMIT).toBe(DAILY_EMAIL_LIMIT);
    expect(dispatchCore.QUOTA_WINDOW_MS).toBe(QUOTA_WINDOW_MS);
  });

  it("lời mời tài khoản tính phần còn lại trên trần chung, không phải 300", () => {
    expect(inviteBudgetRemaining(0)).toBe(DAILY_EMAIL_LIMIT - INVITE_DAILY_RESERVE);
    expect(inviteBudgetRemaining(DAILY_EMAIL_LIMIT - INVITE_DAILY_RESERVE - 5)).toBe(5);
    expect(inviteBudgetRemaining(DAILY_EMAIL_LIMIT)).toBe(0);
    // Không đếm được thì coi như đã đầy — fail-closed.
    expect(inviteBudgetRemaining(Number.NaN)).toBe(0);
    expect(inviteRefusalMessage("daily_budget")).toContain(`trên 1.000 thư`);
  });

  it("trong lib/ chỉ có MỘT chỗ định nghĩa trần thư theo ngày", () => {
    const definitions = files("lib", /\.ts$/).flatMap((file) =>
      readFileSync(file, "utf8")
        .split("\n")
        .filter((line) => /export const [A-Z_]*DAILY[A-Z_]*LIMIT\s*=/.test(line))
        .map((line) => `${file}: ${line.trim()}`)
    );
    expect(definitions).toEqual(["lib/email-quota-core.ts: export const DAILY_EMAIL_LIMIT = 1000;"]);
  });
});

describe("chữ trên màn hình", () => {
  const allNotes = Object.values(HELP_GUIDES).flatMap((guide) => [
    ...(guide.steps ?? []),
    ...(guide.notes ?? [])
  ]);

  it("hướng dẫn trong app nói 1.000 thư/24 giờ qua Resend, không còn Brevo 300", () => {
    const quotaNotes = allNotes.filter((text) => text.includes("thư/24 giờ"));
    expect(quotaNotes.length).toBeGreaterThanOrEqual(2);
    for (const text of quotaNotes) {
      expect(text).toContain("1.000 thư/24 giờ");
      expect(text).toContain("Resend");
    }
    expect(allNotes.filter((text) => /Brevo|300 thư|300\/24/.test(text))).toEqual([]);
  });

  it("không trang nào trong app/ còn nhắc Brevo", () => {
    const hits = files("app", /\.tsx?$/).flatMap((file) =>
      readFileSync(file, "utf8")
        .split("\n")
        .map((line, i) => [line, i] as const)
        .filter(([line]) => /Brevo|300\/24 giờ/.test(line))
        .map(([line, i]) => `${file}:${i + 1}: ${line.trim()}`)
    );
    expect(hits).toEqual([]);
  });

  it("trang cấp quyền hàng loạt đọc trần từ module chung, không gõ tay con số", () => {
    const source = readFileSync("app/reviews/reviewer-pool/bulk-grant-form.tsx", "utf8");
    expect(source).toContain("{dailyEmailLimitLabel()}");
    expect(source).toContain("{EMAIL_PROVIDER_NAME}");
  });
});
