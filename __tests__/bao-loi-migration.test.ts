/**
 * Báo lỗi — migration 20261027200000 chạy THẬT trên PostgreSQL (PGlite). Chủ chương trình 27/10/2026.
 *
 * Điều phải đúng:
 *   - hai bảng bật RLS; anon và authenticated không đọc, không ghi được (khoá công khai nằm sẵn trong mã
 *     trang web; báo lỗi có tên, email người gửi);
 *   - máy chủ thêm/sửa báo lỗi nhưng không xoá; luồng hỏi – đáp chỉ thêm, không sửa, không xoá;
 *   - mã sinh sẵn VAM00001…; ràng buộc loại, trạng thái (có cho_bo_sung), tiêu đề, tối đa 5 ảnh, không tự
 *     trùng chính mình, lượt trao đổi phải có chữ hoặc hình;
 *   - loại thư bao_loi_hoi_lai được NỐI THÊM vào ràng buộc sổ thư, loại cũ vẫn ghi được;
 *   - dán lại lần hai vẫn chạy, không mất dữ liệu.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";

const SQL = readFileSync(path.resolve("supabase/migrations/20261027200000_bao_loi.sql"), "utf8").replace(/\r/g, "");
const ADMIN = "11111111-1111-4111-8111-111111111111";

let db: PGlite;
let baoLoi = "";
const one = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows[0];

async function rejected(role: string, sql: string, params: unknown[] = []) {
  await db.exec("begin");
  try {
    await db.exec(`set local role ${role}`);
    await db.query(sql, params);
    return false;
  } catch {
    return true;
  } finally {
    await db.exec("rollback");
    await db.exec("reset role");
  }
}
async function asServer<T>(run: () => Promise<T>): Promise<T> {
  await db.exec("set role service_role");
  try {
    return await run();
  } finally {
    await db.exec("reset role");
  }
}
const insertBaoLoi = () =>
  asServer(() =>
    one<{ id: string; ma: string }>("insert into bao_loi(nguoi_gui, vai, loai, tieu_de) values ($1, 'core_team', 'de_xuat', 'Thêm nút xuất Excel') returning id, ma", [ADMIN])
  );

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    grant usage on schema public to anon, authenticated, service_role;
    create table admin_users(id uuid primary key, email text, full_name text, status text, role text);
    insert into admin_users values ('${ADMIN}', 'btc@example.test', 'BTC', 'active', 'core_team');
    -- Sổ thư như trên production: ràng buộc loại thư đã có sẵn vài loại — migration phải NỐI THÊM.
    create table outbound_emails(id uuid primary key default gen_random_uuid(), kind text not null,
      constraint outbound_emails_kind_check check (kind = any (array['custom_form_receipt'::text, 'matching_round2_reminder'::text])));
  `);
  await db.exec(SQL);
  baoLoi = (await insertBaoLoi())!.id;
}, 120_000);

afterAll(async () => {
  await db?.close();
});

describe("migration 20261027200000 — báo lỗi", () => {
  it("hai bảng bật RLS; mã sinh sẵn VAM00001; mặc định là 'moi'", async () => {
    for (const table of ["bao_loi", "bao_loi_trao_doi"]) {
      expect((await one<{ rls: boolean }>("select relrowsecurity as rls from pg_class where oid = $1::regclass", [`public.${table}`]))!.rls).toBe(true);
    }
    const row = await one<{ ma: string; trang_thai: string; anh: string[] }>("select ma, trang_thai, anh from bao_loi where id = $1", [baoLoi]);
    expect(row).toMatchObject({ ma: "VAM00001", trang_thai: "moi", anh: [] });
  });

  it("anon và authenticated: không đọc, không ghi bảng nào", async () => {
    for (const role of ["anon", "authenticated"]) {
      expect(await rejected(role, "select * from bao_loi")).toBe(true);
      expect(await rejected(role, "select * from bao_loi_trao_doi")).toBe(true);
      expect(await rejected(role, "insert into bao_loi(vai, loai, tieu_de) values ('x', 'khac', 'abc')")).toBe(true);
      expect(await rejected(role, "insert into bao_loi_trao_doi(bao_loi_id, ben, noi_dung) values ($1, 'hoi', 'x')", [baoLoi])).toBe(true);
    }
  });

  it("máy chủ: sửa được báo lỗi (kể cả sang cho_bo_sung) nhưng không xoá; luồng hỏi – đáp chỉ thêm", async () => {
    await asServer(() => db.query("update bao_loi set trang_thai = 'cho_bo_sung' where id = $1", [baoLoi]));
    expect((await one<{ t: string }>("select trang_thai as t from bao_loi where id = $1", [baoLoi]))!.t).toBe("cho_bo_sung");
    expect(await rejected("service_role", "delete from bao_loi where id = $1", [baoLoi])).toBe(true);
    await asServer(() => db.query("insert into bao_loi_trao_doi(bao_loi_id, ben, noi_dung) values ($1, 'hoi', 'Bạn chụp màn hình giúp nhé?')", [baoLoi]));
    expect(await rejected("service_role", "update bao_loi_trao_doi set noi_dung = 'sửa' where bao_loi_id = $1", [baoLoi])).toBe(true);
    expect(await rejected("service_role", "delete from bao_loi_trao_doi where bao_loi_id = $1", [baoLoi])).toBe(true);
  });

  it("ràng buộc: loại / trạng thái lạ, tiêu đề ngắn, quá 5 ảnh, tự trùng chính mình, lượt trao đổi rỗng → từ chối", async () => {
    expect(await rejected("service_role", "insert into bao_loi(vai, loai, tieu_de) values ('x', 'luong', 'abc')")).toBe(true);
    expect(await rejected("service_role", "insert into bao_loi(vai, loai, tieu_de) values ('x', 'khac', '  a ')")).toBe(true);
    expect(await rejected("service_role", "insert into bao_loi(vai, loai, tieu_de, anh) values ('x', 'khac', 'abc', array['1','2','3','4','5','6'])")).toBe(true);
    expect(await rejected("service_role", "update bao_loi set trang_thai = 'xong' where id = $1", [baoLoi])).toBe(true);
    expect(await rejected("service_role", "update bao_loi set trung_voi = id where id = $1", [baoLoi])).toBe(true);
    expect(await rejected("service_role", "insert into bao_loi_trao_doi(bao_loi_id, ben, noi_dung) values ($1, 'tra_loi', '   ')", [baoLoi])).toBe(true);
    expect(await rejected("service_role", "insert into bao_loi_trao_doi(bao_loi_id, ben, noi_dung) values ($1, 'khac', 'x')", [baoLoi])).toBe(true);
  });

  it("loại thư bao_loi_hoi_lai được nối thêm; loại cũ vẫn ghi được; loại lạ vẫn bị chặn", async () => {
    await db.query("insert into outbound_emails(kind) values ('bao_loi_hoi_lai'), ('custom_form_receipt'), ('matching_round2_reminder')");
    await expect(db.query("insert into outbound_emails(kind) values ('loai_la')")).rejects.toThrow();
  });

  it("dán lại lần hai vẫn chạy, không mất dữ liệu, mã tiếp tục tăng (không quay về VAM00001)", async () => {
    await db.exec(SQL);
    expect((await one<{ n: number }>("select count(*)::int as n from bao_loi"))!.n).toBe(1);
    expect((await one<{ n: number }>("select count(*)::int as n from bao_loi_trao_doi"))!.n).toBe(1);
    // Lần insert bị từ chối ở các ca trên vẫn tiêu số của sequence (đúng hành vi PostgreSQL): chỉ cần mã mới, không trùng.
    const ma = (await insertBaoLoi())!.ma;
    expect(ma).toMatch(/^VAM[0-9]{5}$/);
    expect(ma > "VAM00001").toBe(true);
  });
});
