/**
 * Migration 20261007234500 — chạy THẬT trên PostgreSQL (PGlite).
 *
 * Hai việc, hai cách hỏng lặng lẽ:
 *   1. Nới ràng buộc nhóm nhận thư: viết đè thì mất nhóm cũ, mọi lô của nhóm đó
 *      lặng lẽ không mở được.
 *   2. Sửa nội dung mẫu thư: không được ghi đè lên bản BTC đã tự sửa sau lúc rà,
 *      và mẫu đang duyệt mà đổi nội dung thì phải quay về nháp.
 */
import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";

const SQL = readFileSync(path.resolve("supabase/migrations/20261007234500_nhom_nhan_thu_mentee_rot_ho_so.sql"), "utf8");
const TEMPLATE = "d96e97c8-f029-43a9-a442-df02b5e730e7";

/** Nội dung mẫu đúng như trên production lúc rà (07/10/2026 23:0x). */
const ORIGINAL = [
  "Chào bạn {{ten_nguoi_nhan}},",
  "",
  "Lời đầu tiên, Ban tổ chức UEH Mentoring xin gửi lời cảm ơn chân thành đến bạn vì đã dành thời gian quan tâm và nộp hồ sơ đăng ký tham gia chương trình TUYỂN MENTEE MÙA 12 - THE TAPESTRY",
  "",
  "Ban tổ chức rất trân trọng sự chuẩn bị chỉn chu, tinh thần học hỏi cũng như mong muốn đồng hành của bạn đối với cộng đồng. Tuy nhiên, do số lượng hồ sơ nhận được trong mùa này rất lớn và chỉ tiêu kết nối có giới hạn, Ban tổ chức rất tiếc khi chưa thể chọn hồ sơ của bạn để bước tiếp vào vòng phỏng vấn lần này.",
  "",
  "Dù chưa thể đồng hành cùng bạn với vai trò {{vai_tro}} trong mùa 12, Ban tổ chức tin rằng đây chỉ là một bước dừng chân tạm thời trên hành trình phát triển của bạn. Những trải nghiệm, sự nghiêm túc và tinh thần sẵn sàng nâng cao bản thân mà bạn thể hiện qua hồ sơ đều rất đáng ghi nhận.",
  "",
  "Ban tổ chức rất hy vọng sẽ có cơ hội được đón nhận sự quay trở lại của bạn ở các mùa tiếp theo, cũng như trong các hoạt động cộng đồng sắp tới của chương trình.",
  "",
  "Nếu cần hỗ trợ hoặc có thắc mắc thêm, bạn có thể nhắn tin qua Zalo Ban tổ chức Mỹ Anh (0394983679), Hoàng Vy (0936359670) hoặc phản hồi trực tiếp qua email này.",
  "",
  "Chúc bạn luôn giữ vững nhiệt huyết và đạt được nhiều thành công trên con đường sắp tới!",
  "",
  "Thân ái,",
  "",
  "Ban tổ chức UEH Mentoring"
].join("\n");

const EXPECTED = ORIGINAL.replace(
  "đăng ký tham gia chương trình TUYỂN MENTEE MÙA 12 - THE TAPESTRY",
  "đăng ký làm Mentee của UEH Mentoring mùa 12 – The Tapestry."
)
  .replace("với vai trò {{vai_tro}} trong mùa 12", "với vai trò Mentee trong mùa 12")
  .replace("Mỹ Anh (0394983679), Hoàng Vy (0936359670)", "Mỹ Anh (0394 983 679), Hoàng Vy (0936 359 670)");

const PROD_AUDIENCE_CHECK =
  "check ((audience is null) or (audience = any (array['mentee'::text, 'mentor'::text, 'both'::text, 'staff'::text, 'returning_mentor'::text, 'event'::text])))";

let db: PGlite | null = null;

async function fresh(template: { body: string; status: "draft" | "approved" } | null = { body: ORIGINAL, status: "draft" }) {
  db = new PGlite();
  await db.exec(`
    create table email_batches (id uuid primary key default gen_random_uuid(), audience text,
      constraint email_batches_audience_check ${PROD_AUDIENCE_CHECK});
    create table email_templates (id uuid primary key, body text not null, status text not null,
      approved_by uuid, approved_at timestamptz, updated_at timestamptz,
      constraint email_templates_approved_shape_check check (
        (status = 'approved' and approved_at is not null) or (status <> 'approved' and approved_at is null)));
    create table email_template_log (id uuid primary key default gen_random_uuid(), template_id uuid,
      action text check (action in ('created','ai_drafted','edited','approved','archived')),
      detail jsonb, actor_admin_user_id uuid, created_at timestamptz default now());
  `);
  if (template) {
    await db.query(
      "insert into email_templates (id, body, status, approved_by, approved_at) values ($1, $2, $3, $4, $5)",
      [
        TEMPLATE,
        template.body,
        template.status,
        template.status === "approved" ? "a3f45586-8747-49d9-860a-4b903cfdc7bc" : null,
        template.status === "approved" ? "2026-10-07T16:00:00Z" : null
      ]
    );
  }
  return db;
}

const accepts = async (audience: string) => {
  try {
    await db!.query("insert into email_batches (audience) values ($1)", [audience]);
    return true;
  } catch {
    return false;
  }
};
const templateRow = async () =>
  (await db!.query<{ body: string; status: string; approved_at: string | null; approved_by: string | null }>(
    "select body, status, approved_at, approved_by from email_templates where id = $1",
    [TEMPLATE]
  )).rows[0];
const logs = async () =>
  (await db!.query<{ action: string; detail: { revoked_approval: boolean } }>(
    "select action, detail from email_template_log where template_id = $1",
    [TEMPLATE]
  )).rows;

afterEach(async () => {
  await db?.close();
  db = null;
});

describe("1. nhóm nhận thư mentee_cv_rejected", () => {
  it("trước migration bị từ chối; sau migration nhận, nhóm cũ vẫn nhận, giá trị lạ vẫn bị chặn", async () => {
    await fresh();
    expect(await accepts("mentee_cv_rejected")).toBe(false);
    await db!.exec(SQL);
    expect(await accepts("mentee_cv_rejected")).toBe(true);
    for (const old of ["mentee", "mentor", "both", "staff", "returning_mentor", "event"]) {
      expect(await accepts(old)).toBe(true);
    }
    expect(await accepts("tat_ca_moi_nguoi")).toBe(false);
  });

  it("chạy lại không nhân đôi giá trị", async () => {
    await fresh();
    await db!.exec(SQL);
    await db!.exec(SQL);
    const def = (await db!.query<{ d: string }>(
      "select pg_get_constraintdef(oid) d from pg_constraint where conname = 'email_batches_audience_check'"
    )).rows[0].d;
    expect(def.split("'mentee_cv_rejected'").length - 1).toBe(1);
  });
});

describe("2. sửa mẫu thư rớt vòng hồ sơ", () => {
  it("bản nội dung trong test đúng là bản trên production (md5 khớp với chốt chặn trong file)", async () => {
    await fresh();
    const md5 = (await db!.query<{ m: string }>("select md5($1) m", [ORIGINAL])).rows[0].m;
    expect(md5).toBe("08485ea0c37243bdc070e0f36c2b9857");
  });

  it("sửa đúng 3 chỗ, phần còn lại giữ nguyên từng chữ, ghi một dòng nhật ký", async () => {
    await fresh();
    await db!.exec(SQL);
    const row = await templateRow();
    expect(row.body).toBe(EXPECTED);
    expect(row.body).not.toContain("{{vai_tro}}");
    expect(row.status).toBe("draft");
    expect(await logs()).toEqual([{ action: "edited", detail: expect.objectContaining({ revoked_approval: false }) }]);
  });

  it("chạy lại không sửa thêm, không ghi thêm nhật ký", async () => {
    await fresh();
    await db!.exec(SQL);
    await db!.exec(SQL);
    expect((await templateRow()).body).toBe(EXPECTED);
    expect(await logs()).toHaveLength(1);
  });

  it("mẫu đang được duyệt: đổi nội dung thì quay về nháp và bỏ duyệt", async () => {
    await fresh({ body: ORIGINAL, status: "approved" });
    await db!.exec(SQL);
    const row = await templateRow();
    expect(row).toMatchObject({ body: EXPECTED, status: "draft", approved_at: null, approved_by: null });
    expect((await logs())[0].detail.revoked_approval).toBe(true);
  });

  it("BTC đã tự sửa mẫu sau lúc rà: KHÔNG ghi đè, không ghi nhật ký — phần nhóm nhận thư vẫn chạy", async () => {
    const edited = ORIGINAL.replace("Thân ái,", "Trân trọng,");
    await fresh({ body: edited, status: "draft" });
    await db!.exec(SQL);
    expect((await templateRow()).body).toBe(edited);
    expect(await logs()).toHaveLength(0);
    expect(await accepts("mentee_cv_rejected")).toBe(true);
  });

  it("không có mẫu: không lỗi, phần nhóm nhận thư vẫn chạy", async () => {
    await fresh(null);
    await db!.exec(SQL);
    expect(await accepts("mentee_cv_rejected")).toBe(true);
  });
});
