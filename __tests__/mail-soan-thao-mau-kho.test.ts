/**
 * VAM00038 — kho mẫu thư (lib/email-templates.ts) với cột mới body_html / source_template_id:
 * đọc lùi về cột cũ khi migration chưa áp, và mẫu chữ thuần không bao giờ ghi vào cột mới.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({ getSupabaseServiceRoleClient: vi.fn() }));

import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import { createEmailTemplate, getEmailTemplate, listEmailTemplates, updateEmailTemplate } from "@/lib/email-templates";
import { VI_CHUA_AP_MIGRATION_THIET_KE } from "@/lib/mail-soan-thao-core";

const SEASON = "00000000-0000-4000-8000-0000000000aa";
const ID = "00000000-0000-4000-8000-0000000000c1";

type Raw = Record<string, unknown>;

function rawRow(overrides: Raw = {}): Raw {
  return {
    id: ID,
    season_id: SEASON,
    kind: "general_announcement",
    name: "Mẫu",
    subject: "Tiêu đề",
    body: "Chào",
    status: "draft",
    created_by: null,
    approved_by: null,
    approved_at: null,
    created_at: "",
    updated_at: "",
    ...overrides
  };
}

const selects: string[] = [];
const writes: Array<{ op: string; payload: Raw }> = [];

function fakeClient(world: { migrated: boolean; row: Raw; writeError?: { code?: string; message?: string } }) {
  return {
    from(table: string) {
      let columns = "";
      let single = false;
      const chain: Record<string, unknown> = {};
      chain.select = vi.fn((value?: string) => {
        if (value && table === "email_templates" && value !== "id") {
          columns = value;
          selects.push(value);
        }
        return chain;
      });
      for (const method of ["eq", "neq", "order", "in"]) chain[method] = vi.fn(() => chain);
      chain.maybeSingle = vi.fn(() => {
        single = true;
        return chain;
      });
      chain.single = vi.fn(() => Promise.resolve({ data: { id: ID }, error: world.writeError ?? null }));
      chain.insert = vi.fn((payload: Raw) => {
        writes.push({ op: "insert", payload });
        return chain;
      });
      chain.update = vi.fn((payload: Raw) => {
        writes.push({ op: "update", payload });
        return chain;
      });
      chain.then = (resolve: (value: unknown) => unknown) => {
        if (table !== "email_templates") return Promise.resolve(resolve({ data: null, error: null }));
        if (writes.length && !columns) return Promise.resolve(resolve({ data: null, error: world.writeError ?? null }));
        if (!world.migrated && /body_html/.test(columns)) {
          return Promise.resolve(resolve({ data: null, error: { code: "42703", message: "column email_templates.body_html does not exist" } }));
        }
        const data = single ? world.row : [world.row];
        return Promise.resolve(resolve({ data, error: null }));
      };
      return chain;
    }
  };
}

function useWorld(world: Parameters<typeof fakeClient>[0]) {
  vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(fakeClient(world) as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  selects.length = 0;
  writes.length = 0;
});

describe("đọc mẫu thư", () => {
  it("database đã có cột mới: đọc ra HTML và mẫu gốc", async () => {
    useWorld({ migrated: true, row: rawRow({ body_html: "<p>Chào</p>", source_template_id: "goc" }) });
    const { row } = await getEmailTemplate(ID);
    expect(row).toMatchObject({ bodyHtml: "<p>Chào</p>", sourceTemplateId: "goc" });
  });

  it("migration chưa áp: đọc lại bằng cột cũ, mẫu ra là chữ thuần, màn hình không vỡ", async () => {
    useWorld({ migrated: false, row: rawRow() });
    const listed = await listEmailTemplates(SEASON);
    expect(listed.error).toBeNull();
    expect(listed.rows).toHaveLength(1);
    expect(listed.rows[0]).toMatchObject({ body: "Chào", bodyHtml: null, sourceTemplateId: null });
    expect(selects).toHaveLength(2);
    expect(selects[0]).toContain("body_html");
    expect(selects[1]).not.toContain("body_html");
  });
});

describe("ghi mẫu thư", () => {
  it("tạo mẫu chữ thuần không chạm cột mới", async () => {
    useWorld({ migrated: false, row: rawRow() });
    const created = await createEmailTemplate({ seasonId: SEASON, kind: "general_announcement", name: "A", subject: "B", body: "C", actorAdminUserId: null });
    expect(created.error).toBeNull();
    const insert = writes.find((write) => write.op === "insert")!;
    expect(insert.payload).not.toHaveProperty("body_html");
    expect(insert.payload).not.toHaveProperty("source_template_id");
  });

  it("tạo mẫu thiết kế / bản sao ghi HTML và mẫu gốc", async () => {
    useWorld({ migrated: true, row: rawRow() });
    await createEmailTemplate({ seasonId: SEASON, kind: "general_announcement", name: "A", subject: "B", body: "C", bodyHtml: "<p>C</p>", sourceTemplateId: "goc", actorAdminUserId: null });
    expect(writes.find((write) => write.op === "insert")!.payload).toMatchObject({ body_html: "<p>C</p>", source_template_id: "goc" });
  });

  it("sửa mẫu chữ thuần ở chế độ chữ thuần: không gửi body_html (chạy được khi chưa có migration)", async () => {
    useWorld({ migrated: false, row: rawRow() });
    const result = await updateEmailTemplate({ id: ID, name: "A", subject: "B", body: "C", bodyHtml: null, actorAdminUserId: null });
    expect(result.ok).toBe(true);
    const update = writes.find((write) => write.op === "update" && "subject" in write.payload)!;
    expect(update.payload).not.toHaveProperty("body_html");
  });

  it("chuyển mẫu thiết kế về chữ thuần thì xoá HTML; lưu thiết kế thì ghi HTML", async () => {
    useWorld({ migrated: true, row: rawRow({ body_html: "<p>Cũ</p>" }) });
    await updateEmailTemplate({ id: ID, name: "A", subject: "B", body: "C", bodyHtml: null, actorAdminUserId: null });
    expect(writes.find((write) => write.op === "update" && "subject" in write.payload)!.payload).toMatchObject({ body_html: null });

    writes.length = 0;
    await updateEmailTemplate({ id: ID, name: "A", subject: "B", body: "C", bodyHtml: "<p>Mới</p>", actorAdminUserId: null });
    expect(writes.find((write) => write.op === "update" && "subject" in write.payload)!.payload).toMatchObject({ body_html: "<p>Mới</p>" });
  });

  it("lưu thiết kế khi database chưa có cột: báo rõ cần migration", async () => {
    useWorld({
      migrated: false,
      row: rawRow(),
      writeError: { code: "PGRST204", message: "Could not find the 'body_html' column of 'email_templates' in the schema cache" }
    });
    const created = await createEmailTemplate({ seasonId: SEASON, kind: "general_announcement", name: "A", subject: "B", body: "C", bodyHtml: "<p>C</p>", actorAdminUserId: null });
    expect(created.error).toBe(VI_CHUA_AP_MIGRATION_THIET_KE);
  });
});
