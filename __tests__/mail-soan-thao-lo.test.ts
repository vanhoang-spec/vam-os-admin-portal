/**
 * VAM00038 — gửi hàng loạt một mẫu thiết kế: mỗi người nhận một thân thư HTML điền đúng dữ liệu của
 * chính họ, đã escape; lô chữ thuần không mang `html`. sendTemplatedEmail là bản giả: không gửi gì.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({ getSupabaseServiceRoleClient: vi.fn() }));
vi.mock("@/lib/email", () => ({ sendTemplatedEmail: vi.fn() }));

import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import { sendTemplatedEmail } from "@/lib/email";
import { runEmailBatch, type EmailBatchRow } from "@/lib/bulk-mail";

const SEASON = "00000000-0000-4000-8000-0000000000aa";
const BATCH = "00000000-0000-4000-8000-0000000000bb";

const PEOPLE = [
  { id: "p0", full_name: "Nguyễn Văn A", email_primary: "a@example.com" },
  { id: "p1", full_name: 'Trần <b>"B"</b>', email_primary: "b@example.com" },
  { id: "p2", full_name: "", email_primary: "c@example.com" }
];

function fakeClient() {
  return {
    from(table: string) {
      const chain: Record<string, unknown> = {};
      for (const method of ["select", "in", "order", "limit", "range", "eq", "neq", "gte", "is"]) {
        chain[method] = vi.fn(() => chain);
      }
      chain.update = vi.fn(() => chain);
      chain.insert = vi.fn(() => Promise.resolve({ data: null, error: null }));
      chain.then = (resolve: (value: unknown) => unknown) => {
        const data =
          table === "person_season_memberships"
            ? PEOPLE.map((row) => ({ person_id: row.id, role: "mentee" }))
            : table === "people"
              ? PEOPLE
              : [];
        return Promise.resolve(resolve({ data, error: null }));
      };
      return chain;
    }
  };
}

function batch(): EmailBatchRow {
  return {
    id: BATCH,
    seasonId: SEASON,
    kind: "general_announcement",
    templateId: "t1",
    audience: "mentee",
    audienceEventId: null,
    audienceCoversSeries: false,
    status: "running",
    requestedCount: 0,
    sentCount: 0,
    skippedCount: 0,
    failedCount: 0,
    note: null,
    createdAt: "",
    completedAt: null
  };
}

const BODY = "Chào {{ten_nguoi_nhan}}.";
const BODY_HTML =
  '<p>Chào <strong>{{ten_nguoi_nhan}}</strong></p><div data-vam-anh=""><img src="https://kho.test/a.png" width="300"></div><script>alert(1)</script>';

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(fakeClient() as never);
  vi.mocked(sendTemplatedEmail).mockResolvedValue({ ok: true, skipped: false } as never);
});

const calls = () => vi.mocked(sendTemplatedEmail).mock.calls.map((call) => call[0]);

describe("lô gửi mẫu thiết kế", () => {
  it("mỗi người nhận một HTML điền đúng tên mình, đã escape và đã lọc", async () => {
    const result = await runEmailBatch({ batch: batch(), seasonCode: "UEHM-S12", subject: "Thông báo {{mua}}", body: BODY, bodyHtml: BODY_HTML });
    const byEmail = new Map(calls().map((call) => [call.toEmail, call]));

    expect(byEmail.get("a@example.com")?.html).toContain("<strong>Nguyễn Văn A</strong>");
    expect(byEmail.get("a@example.com")?.body).toBe("Chào Nguyễn Văn A.");
    const b = String(byEmail.get("b@example.com")?.html ?? "");
    expect(b).toContain("&lt;b&gt;&quot;B&quot;&lt;/b&gt;");
    expect(b).not.toContain("Nguyễn Văn A");
    for (const call of calls()) {
      expect(call.html).not.toMatch(/<script|\{\{/);
      expect(call.html).toContain('src="https://kho.test/a.png"');
    }
    // Người thiếu tên không được gửi một thư HTML "Chào ," — cùng luật với phần chữ.
    expect(byEmail.has("c@example.com")).toBe(false);
    expect(result.sent).toBe(2);
  });

  it("lô chữ thuần không mang html: thư đi y như trước", async () => {
    await runEmailBatch({ batch: batch(), seasonCode: "UEHM-S12", subject: "Thông báo", body: BODY });
    await runEmailBatch({ batch: batch(), seasonCode: "UEHM-S12", subject: "Thông báo", body: BODY, bodyHtml: null });
    expect(calls().length).toBeGreaterThan(0);
    for (const call of calls()) expect(call).not.toHaveProperty("html");
  });

  it("ô chỉ có trong HTML mà không có giá trị thì chặn bức thư, dù phần chữ đủ", async () => {
    const result = await runEmailBatch({
      batch: batch(),
      seasonCode: "UEHM-S12",
      subject: "Thông báo",
      body: "Xin chào.",
      bodyHtml: "<p>Chào {{o_khong_co_du_lieu}}</p>"
    });
    expect(sendTemplatedEmail).not.toHaveBeenCalled();
    expect(result.failed).toBe(2);
    expect(result.problems.join(" ")).toContain("{{o_khong_co_du_lieu}}");
  });
});
